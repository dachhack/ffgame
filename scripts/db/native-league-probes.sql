-- 0064 native-league probes. Run with ON_ERROR_STOP; every failed assertion raises.
\set QUIET on
\pset pager off

-- Supabase-style default table grants (prod has these; shim doesn't).
grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

-- helper: assert a jsonb rpc result has ok=true
create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

-- Switch probe identity: sets BOTH the uid and the email claim. is_admin() reads
-- the email — switching only the uid would leave the previous user's admin bit.
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

-- identity helpers
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev');
select probe_as('a');
-- A is a super admin: league creation is gated to admins while in closed testing.
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- 2026 slate row so week-1 lock_at resolves
insert into nfl_slate (season, week, home, away, win, kickoff)
values ('2026', 1, 'SEA', 'KC', 'snf', '2026-09-09T20:20:00-04:00') on conflict do nothing;

-- ── 1. create league ─────────────────────────────────────────────────────────
do $$
declare r jsonb; lid uuid;
begin
  -- closed-testing gate: a non-admin may not create a native league
  perform probe_as('b');
  perform assert_err(create_native_league('X', '2026', 4), 'closed testing', '1a0 non-admin create gated');
  perform probe_as('a');
  perform assert_err(create_native_league('X', '2026', 1), 'team count', '1a team-count gate');
  perform assert_err(create_native_league('X', '2026', 4, 3), 'roster size', '1b rounds gate');
  perform assert_err(create_native_league('  ', '2026', 4), 'name', '1c name gate');
  r := create_native_league('Probe League', '2026', 4, 7, 60);
  perform assert_ok(r, '1d create');
  lid := (r ->> 'league_id')::uuid;
  perform set_config('probe.lid', lid::text, false);
  perform assert_true(length(r ->> 'invite_code') = 8, '1e invite code');
  perform assert_true((select b.provider from league_by_invite(r ->> 'invite_code') b) = 'native', '1e2 league_by_invite provider');
  perform assert_true((select count(*) from league_membership where league_id = lid) = 4, '1f four seats');
  perform assert_true((select count(*) from league_membership where league_id = lid and enrolled) = 1, '1g creator seated');
  perform assert_true((select provider from league where id = lid) = 'native', '1h provider');
  perform assert_true((select status from draft where league_id = lid) = 'pending', '1i draft pending');
end $$;

-- ── 2. joining ───────────────────────────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; code text; r jsonb;
begin
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  r := native_join(code, 'Bravo Squad');
  perform assert_ok(r, '2a B joins');
  perform assert_true((r ->> 'roster_id')::int = 2, '2b B gets seat 2');
  r := native_join(code);
  perform assert_true((r ->> 'roster_id')::int = 2 and (r ->> 'status') = 'enrolled', '2c idempotent rejoin');
  perform probe_as('c');
  r := native_join(code);
  perform assert_true((r ->> 'roster_id')::int = 3, '2d C gets seat 3');
  perform assert_err(native_join('ZZZZZZZZ'), 'invalid', '2e bad code');
  perform assert_true((select team_name from league_membership where league_id = lid and sleeper_roster_id = 2) = 'Bravo Squad', '2f team name set');
end $$;

-- ── 3. pool seeding ──────────────────────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; pool jsonb := '[]'::jsonb; i int; r jsonb;
begin
  -- as B (not commish) → forbidden
  r := seed_league_pool(lid, '[]'::jsonb);
  perform assert_err(r, 'forbidden', '3a non-commish seed');
  perform probe_as('a');
  -- ranked pool: qb1 rb1 wr1 te1 qb2 rb2 wr2 te2 … then K/DEF at the bottom
  for i in 1..6 loop
    pool := pool || jsonb_build_object('slug', 'qb' || i, 'full', 'QB ' || i, 'pos', 'QB', 'team', 'T' || i);
    pool := pool || jsonb_build_object('slug', 'rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T' || i);
    pool := pool || jsonb_build_object('slug', 'wr' || i, 'full', 'WR ' || i, 'pos', 'WR', 'team', 'T' || i);
    pool := pool || jsonb_build_object('slug', 'te' || i, 'full', 'TE ' || i, 'pos', 'TE', 'team', 'T' || i);
  end loop;
  for i in 7..10 loop
    pool := pool || jsonb_build_object('slug', 'rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T' || i);
    pool := pool || jsonb_build_object('slug', 'wr' || i, 'full', 'WR ' || i, 'pos', 'WR', 'team', 'T' || i);
  end loop;
  for i in 1..4 loop
    pool := pool || jsonb_build_object('slug', 'k' || i, 'full', 'K ' || i, 'pos', 'K', 'team', 'K' || i);
  end loop;
  for i in 1..4 loop
    pool := pool || jsonb_build_object('slug', 'dst' || i, 'full', 'DST ' || i, 'pos', 'DEF', 'team', 'D' || i);
  end loop;
  r := seed_league_pool(lid, pool);
  perform assert_ok(r, '3b seed');
  perform assert_true((r ->> 'players')::int = 40, '3c 40 players');
  perform assert_true((select rank from league_pool where league_id = lid and slug = 'qb1') = 1, '3d rank 1');
end $$;

-- ── 4. schedule ──────────────────────────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; r jsonb;
begin
  r := native_generate_schedule(lid, 14);
  perform assert_ok(r, '4a schedule');
  perform assert_true((select count(*) from matchup where league_id = lid) = 28, '4b 28 matchups');
  perform assert_true((select count(*) from matchup where league_id = lid and week = 1) = 2, '4c 2 per week');
  -- every roster appears exactly once per week
  perform assert_true(not exists (
    select 1 from (
      select week, rid, count(*) c from (
        select week, home_roster_id rid from matchup where league_id = lid
        union all select week, away_roster_id from matchup where league_id = lid
      ) x group by week, rid
    ) y where c <> 1), '4d each roster once per week');
  perform assert_true((select lock_at from matchup where league_id = lid and week = 1 limit 1) is not null, '4e lock_at from slate');
  perform assert_true((select distinct lock_at from matchup where league_id = lid and week = 2)
    = (select min(kickoff) from nfl_slate where season = '2026' and week = 2), '4f lock_at = week-2 first kickoff');
end $$;

-- ── 5. draft start ───────────────────────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; r jsonb;
begin
  perform probe_as('b');
  perform assert_err(start_draft(lid), 'forbidden', '5a non-commish start');
  perform probe_as('a');
  perform assert_err(start_draft(lid, '[3,1,4]'::jsonb), 'every roster', '5b short order');
  perform assert_err(start_draft(lid, '[3,1,4,4]'::jsonb), 'every roster', '5c dup order');
  r := start_draft(lid, '[3,1,4,2]'::jsonb);
  perform assert_ok(r, '5d start');
  perform assert_true((select status from draft where league_id = lid) = 'live', '5e live');
  -- waiver priority = reverse draft order: 2→1, 4→2, 1→3, 3→4
  perform assert_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = 2) = 1, '5f wp roster2');
  perform assert_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = 3) = 4, '5g wp roster3');
  perform assert_err(start_draft(lid), 'already started', '5h restart gate');
end $$;

-- ── 6. picking + snake + proxy rights ────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; r jsonb;
begin
  -- on the clock: roster 3 (C). B may not pick.
  perform probe_as('b');
  perform assert_err(make_draft_pick(lid, 'qb1'), 'not your pick', '6a turn gate');
  perform probe_as('c');
  perform assert_err(make_draft_pick(lid, 'nope'), 'not in pool', '6b unknown slug');
  r := make_draft_pick(lid, 'qb1');
  perform assert_ok(r, '6c C picks qb1');
  -- next: roster 1 (A) — commish; C may not proxy
  perform assert_err(make_draft_pick(lid, 'rb1'), 'not your pick', '6d no proxy for player');
  perform probe_as('a');
  perform assert_err(make_draft_pick(lid, 'qb1'), 'already rostered', '6e dup player');
  r := make_draft_pick(lid, 'rb1');
  perform assert_ok(r, '6f A picks rb1');
  -- next: roster 4 (vacant) → draft_state flags it, draft_tick autopicks (wr1)
  r := draft_state(lid);
  perform assert_true((r ->> 'on_clock')::int = 4 and (r ->> 'on_clock_auto')::boolean, '6f2 vacant seat flagged auto');
  r := draft_tick(lid);
  perform assert_true((r ->> 'autopicks')::int = 1, '6g vacant autopick fired');
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 3) = 'wr1', '6h vacant took wr1');
  perform assert_true((select auto from draft_pick where league_id = lid and overall = 3), '6i marked auto');
  -- next: roster 2 (B, human, clock in future) → tick must NOT pick
  r := draft_tick(lid);
  perform assert_true((r ->> 'autopicks')::int = 0, '6j human clock respected');
  perform probe_as('b');
  r := make_draft_pick(lid, 'te1');
  perform assert_ok(r, '6k B picks te1');
  -- round 2 snake: roster 2 again
  r := make_draft_pick(lid, 'qb2');
  perform assert_ok(r, '6l snake: B picks back-to-back');
  -- roster 4 vacant → tick, takes rb2 (best free)
  r := draft_tick(lid);
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 6) = 'rb2', '6m vacant rb2');
  -- roster 1 (A): expire the clock → tick autopicks wr2 for A
  update draft set deadline_at = now() - interval '1 second' where league_id = lid;
  r := draft_tick(lid);
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 7) = 'wr2', '6n expired human autopicked wr2');
  perform assert_true((select roster_id from draft_pick where league_id = lid and overall = 7) = 1, '6o …for roster 1');
end $$;

-- ── 7. run out the draft; caps + forced K/DEF + completion + materialize ─────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; r jsonb; i int;
begin
  for i in 1..30 loop
    update draft set deadline_at = now() - interval '1 second' where league_id = lid and status = 'live';
    r := draft_tick(lid);
    exit when (select status from draft where league_id = lid) = 'complete';
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', '7a complete');
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 28, '7b 28 picks');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 28, '7c 28 rostered');
  perform assert_true(not exists (
    select 1 from (select roster_id, count(*) c from native_roster where league_id = lid group by roster_id) x
    where c <> 7), '7d 7 per roster');
  -- fully-auto roster 4: exactly one K + one DEF, ≤3 QB, ≤3 TE
  perform assert_true((select count(*) from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid and nr.roster_id = 4 and lp.pos = 'K') = 1, '7e auto roster has 1 K');
  perform assert_true((select count(*) from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid and nr.roster_id = 4 and lp.pos = 'DEF') = 1, '7f auto roster has 1 DEF');
  perform assert_true((select count(*) from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid and nr.roster_id = 4 and lp.pos = 'QB') <= 3, '7g QB cap');
  -- materialized: 14 weeks × 4 rosters, 7 starters each, engine-shaped entries
  perform assert_true((select count(*) from sleeper_lineup where league_id = lid) = 56, '7h 56 lineup rows');
  perform assert_true((select jsonb_array_length(starters_json) from sleeper_lineup where league_id = lid and week = 3 and roster_id = 2) = 7, '7i 7 starters');
  perform assert_true((select starters_json -> 0 ->> 'player_slug' from sleeper_lineup where league_id = lid and week = 3 and roster_id = 2) is not null, '7j player_slug present');
  perform assert_err(make_draft_pick(lid, 'rb9'), 'not live', '7k draft closed');
end $$;

-- ── 8. free agency + drops + waivers ─────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; r jsonb; freeslug text; dropb text; dropc text; claim1 uuid;
begin
  select lp.slug into freeslug from league_pool lp
    where lp.league_id = lid and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  select slug into dropb from native_roster where league_id = lid and roster_id = 2 order by added_at limit 1;
  -- B adds the best free agent, dropping someone (roster is at cap)
  perform probe_as('b');
  r := add_free_agent(lid, 2, freeslug);
  perform assert_err(r, 'roster full', '8a cap enforced');
  r := add_free_agent(lid, 2, freeslug, dropb);
  perform assert_ok(r, '8b add with drop');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = freeslug), '8c added');
  perform assert_true((select waived_until from league_pool where league_id = lid and slug = dropb) > now(), '8d dropped → waived');
  -- the dropped player can't be re-added directly
  r := add_free_agent(lid, 2, dropb, freeslug);
  perform assert_err(r, 'waivers', '8e waived blocks FA add');
  -- C claims the waived player (with a drop)
  perform probe_as('c');
  select slug into dropc from native_roster where league_id = lid and roster_id = 3 order by added_at limit 1;
  r := submit_waiver_claim(lid, 3, dropb, dropc);
  perform assert_ok(r, '8f claim by C');
  r := submit_waiver_claim(lid, 3, dropb, dropc);
  perform assert_err(r, 'already pending', '8g dup claim');
  -- B claims the same player too (priority 1 → should win at clear)
  perform probe_as('b');
  r := submit_waiver_claim(lid, 2, dropb, freeslug);
  perform assert_ok(r, '8h claim by B');
  -- process before the window closes → nothing happens
  r := process_waivers(lid);
  perform assert_true((r ->> 'won')::int = 0, '8i not due yet');
  perform assert_true((select count(*) from waiver_claim where league_id = lid and status = 'pending') = 2, '8j both pending');
  -- close the window → B (priority 1) wins, C loses 'player taken'
  update league_pool set waived_until = now() - interval '1 second' where league_id = lid and slug = dropb;
  r := process_waivers(lid);
  perform assert_true((r ->> 'won')::int = 1 and (r ->> 'lost')::int = 1, '8k one won one lost');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = dropb), '8l B got him');
  perform assert_true((select note from waiver_claim where league_id = lid and roster_id = 3 and add_slug = dropb) = 'player taken', '8m C lost: taken');
  -- winner rotates to the back of the waiver order
  perform assert_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = 2) = 5, '8n priority rotated');
  -- roster stayed at cap (the claim's drop executed)
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = 2) = 7, '8o cap held');
  -- materialize picked up the change in a scheduled week
  perform assert_true(exists (select 1 from sleeper_lineup where league_id = lid and week = 5 and roster_id = 2
    and starters_json::text like '%' || dropb || '%'), '8p lineups refreshed');
end $$;

-- ── 9. mid-season freeze: locked weeks never rematerialize ───────────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; r jsonb; before text; dropped text;
begin
  update matchup set status = 'live' where league_id = lid and week = 1;
  select starters_json::text into before from sleeper_lineup where league_id = lid and week = 1 and roster_id = 3;
  perform probe_as('c');
  select slug into dropped from native_roster where league_id = lid and roster_id = 3 order by added_at desc limit 1;
  r := drop_player(lid, 3, dropped);
  perform assert_ok(r, '9a drop');
  perform assert_true((select starters_json::text from sleeper_lineup where league_id = lid and week = 1 and roster_id = 3) = before, '9b live week frozen');
  perform assert_true((select starters_json::text from sleeper_lineup where league_id = lid and week = 2 and roster_id = 3) not like '%' || dropped || '%', '9c future week updated');
  perform assert_true((select jsonb_array_length(starters_json) from sleeper_lineup where league_id = lid and week = 2 and roster_id = 3) = 6, '9d future week is 6 deep');
end $$;

-- ── 10. state RPCs + RLS visibility ──────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; r jsonb;
begin
  perform probe_as('b');
  r := draft_state(lid);
  perform assert_true((r ->> 'status') = 'complete' and jsonb_array_length(r -> 'picks') = 28, '10a draft_state');
  r := native_team_state(lid);
  perform assert_true((r ->> 'my_roster_id')::int = 2 and (r ->> 'roster_cap')::int = 7, '10b team_state');
  perform assert_true(jsonb_array_length(r -> 'waiver_order') = 4, '10c waiver order');
  -- non-member: RPCs refuse
  perform probe_as('d');
  r := draft_state(lid);
  perform assert_true((r ->> 'error') = 'forbidden', '10d outsider draft_state');
  r := native_team_state(lid);
  perform assert_true((r ->> 'error') = 'forbidden', '10e outsider team_state');
end $$;

-- table-level RLS as the `authenticated` role
set role authenticated;
select probe_as('d');
do $$
begin
  perform assert_true((select count(*) from league_pool) = 0, '10f outsider sees no pool');
  perform assert_true((select count(*) from native_roster) = 0, '10g outsider sees no rosters');
  perform assert_true((select count(*) from draft_pick) = 0, '10h outsider sees no picks');
end $$;
select probe_as('b');
do $$
declare lid uuid := current_setting('probe.lid')::uuid;
begin
  perform assert_true((select count(*) from league_pool where league_id = lid) = 40, '10i member sees pool');
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 28, '10j member sees picks');
  perform assert_true((select count(*) from waiver_claim where league_id = lid and status = 'pending') = 0, '10k no pending leak');
end $$;
reset role;

-- ── 11. media (0066): espn_id in the pool + team/league avatars ──────────────
do $$
declare lid uuid := current_setting('probe.lid')::uuid; lid2 uuid; r jsonb;
begin
  -- espn_id flows through seed_league_pool (fresh league — lid's draft is closed)
  perform probe_as('a');
  r := create_native_league('Media League', '2026', 2, 5, 60);
  perform assert_ok(r, '11a create second league');
  lid2 := (r ->> 'league_id')::uuid;
  r := seed_league_pool(lid2, '[{"slug":"x-one","full":"X One","pos":"QB","team":"KC","espn_id":"12345"},{"slug":"x-two","full":"X Two","pos":"RB","team":"SF"}]'::jsonb);
  perform assert_ok(r, '11b seed with espn_id');
  perform assert_true((select espn_id from league_pool where league_id = lid2 and slug = 'x-one') = '12345', '11c espn_id stored');
  perform assert_true((select espn_id from league_pool where league_id = lid2 and slug = 'x-two') is null, '11d espn_id optional');

  -- team avatar: own seat yes, someone else's no, bad scheme rejected, clearable
  perform probe_as('b');
  r := set_team_avatar(lid, 2, 'https://example.com/crest.png');
  perform assert_ok(r, '11e own avatar');
  perform assert_true((select avatar_url from league_membership where league_id = lid and sleeper_roster_id = 2) = 'https://example.com/crest.png', '11f avatar stored');
  perform assert_err(set_team_avatar(lid, 3, 'https://example.com/x.png'), 'forbidden', '11g not your seat');
  perform assert_err(set_team_avatar(lid, 2, 'http://example.com/x.png'), 'https', '11h https only');
  r := set_team_avatar(lid, 2, null);
  perform assert_ok(r, '11i clear avatar');
  perform assert_true((select avatar_url from league_membership where league_id = lid and sleeper_roster_id = 2) is null, '11j cleared');
  r := set_team_avatar(lid, 2, 'https://example.com/crest2.png');
  perform assert_ok(r, '11k re-set avatar');

  -- league avatar: commissioner only
  perform assert_err(set_league_avatar(lid, 'https://example.com/league.png'), 'forbidden', '11l non-commish league avatar');
  perform probe_as('a');
  r := set_league_avatar(lid, 'https://example.com/league.png');
  perform assert_ok(r, '11m commish league avatar');

  -- native_team_state v2 identity fields
  perform probe_as('b');
  r := native_team_state(lid);
  perform assert_true((r ->> 'my_team') = 'Bravo Squad', '11n my_team');
  perform assert_true((r ->> 'my_avatar') = 'https://example.com/crest2.png', '11o my_avatar');
  perform assert_true((r ->> 'league_avatar') = 'https://example.com/league.png', '11p league_avatar');
  perform assert_true((r ->> 'is_commish')::boolean = false, '11q not commish');
  perform assert_true(r -> 'waiver_order' -> 0 ? 'avatar', '11r waiver_order carries avatar');
  perform probe_as('a');
  r := native_team_state(lid);
  perform assert_true((r ->> 'is_commish')::boolean, '11s commish flag');
end $$;

-- ── 12. draft features (0067): queue, autodraft, pause/force/undo ────────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  perform probe_as('a');
  r := create_native_league('Snake Two', '2026', 2, 5, 60);
  perform assert_ok(r, '12a create');
  lid := (r ->> 'league_id')::uuid;
  perform set_config('probe.lid3', lid::text, false);
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Team'), '12b B joins');
  perform probe_as('a');
  for i in 1..4 loop pool := pool || jsonb_build_object('slug', 's-qb' || i, 'full', 'S QB ' || i, 'pos', 'QB', 'team', 'T'); end loop;
  for i in 1..8 loop pool := pool || jsonb_build_object('slug', 's-rb' || i, 'full', 'S RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  for i in 1..8 loop pool := pool || jsonb_build_object('slug', 's-wr' || i, 'full', 'S WR ' || i, 'pos', 'WR', 'team', 'T'); end loop;
  for i in 1..4 loop pool := pool || jsonb_build_object('slug', 's-te' || i, 'full', 'S TE ' || i, 'pos', 'TE', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), '12c seed');
end $$;
do $$
declare lid uuid := current_setting('probe.lid3')::uuid; r jsonb;
begin
  perform probe_as('d');
  perform assert_err(set_draft_queue(lid, 2, '["s-rb2"]'::jsonb), 'forbidden', '12d outsider queue');
  perform probe_as('b');
  r := set_draft_queue(lid, 2, '["s-rb2","nope","s-wr3","s-rb2"]'::jsonb);
  perform assert_ok(r, '12e B sets queue');
  perform assert_true((r ->> 'queued')::int = 2, '12f unknown + dup dropped');
  perform probe_as('a');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), '12g start');
  -- A picks 1st
  perform assert_ok(make_draft_pick(lid, 's-qb1'), '12h A picks');
  -- B on the clock: expire → tick must take B's QUEUE head (s-rb2), not best rank
  update draft set deadline_at = now() - interval '1 second' where league_id = lid;
  r := draft_tick(lid);
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 2) = 's-rb2', '12i queue autopick');
  -- snake: B again (round 2). autodraft toggle → instant pick from queue (s-wr3)
  perform probe_as('b');
  perform assert_ok(set_autodraft(lid, 2, true), '12j autodraft on');
  r := draft_state(lid);
  perform assert_true((r ->> 'on_clock')::int = 2 and (r ->> 'on_clock_auto')::boolean, '12k autodraft seat flagged');
  r := draft_tick(lid);
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 3) = 's-wr3', '12l autodraft queue pick');
  perform assert_ok(set_autodraft(lid, 2, false), '12m autodraft off');

  -- A on the clock (overall 4): pause gates
  perform probe_as('b');
  perform assert_err(commish_pause_draft(lid), 'forbidden', '12n pause is commish-only');
  perform probe_as('a');
  perform assert_ok(commish_pause_draft(lid), '12o pause');
  perform assert_err(make_draft_pick(lid, 's-rb1'), 'paused', '12p no picks while paused');
  update draft set deadline_at = now() - interval '1 hour' where league_id = lid;
  r := draft_tick(lid);
  perform assert_true((r ->> 'autopicks')::int = 0, '12q tick frozen while paused');
  perform assert_ok(commish_resume_draft(lid), '12r resume');
  perform assert_true((select deadline_at from draft where league_id = lid) > now(), '12s clock restored');
  -- force pick: explicit slug, then undo it
  r := commish_force_pick(lid, 's-te1');
  perform assert_ok(r, '12t force pick');
  perform assert_true((select slug from draft_pick where league_id = lid and overall = 4) = 's-te1', '12u forced onto board');
  r := commish_undo_pick(lid);
  perform assert_ok(r, '12v undo');
  perform assert_true(not exists (select 1 from draft_pick where league_id = lid and overall = 4), '12w pick removed');
  perform assert_true(not exists (select 1 from native_roster where league_id = lid and slug = 's-te1'), '12x roster unwound');
  perform assert_true((select current_overall from draft where league_id = lid) = 4, '12y back on the clock');
  -- force with NO slug → queue/best-available
  r := commish_force_pick(lid);
  perform assert_ok(r, '12z force best');
  -- run it out
  for i in 1..12 loop
    update draft set deadline_at = now() - interval '1 second' where league_id = lid and status = 'live';
    perform draft_tick(lid);
    exit when (select status from draft where league_id = lid) = 'complete';
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', '12zz snake completes');
end $$;

-- ── 13. auction mode (0067) ───────────────────────────────────────────────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  perform probe_as('a');
  r := create_native_league('Auction House', '2026', 2, 5, 60, 'auction', 20);
  perform assert_ok(r, '13a create auction');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Bids'), '13b B joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'a-rb' || i, 'full', 'A RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), '13c seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), '13d start');
  perform assert_true((select draft_budget from league_membership where league_id = lid and sleeper_roster_id = 2) = 20, '13e budgets seeded');
  r := draft_state(lid);
  perform assert_true((r ->> 'mode') = 'auction' and (r ->> 'on_clock')::int = 1, '13f nominator is seat 1');
  perform assert_true((r -> 'budgets' -> 0 ->> 'max_bid')::int = 16, '13g max bid reserves $1/spot');

  -- nomination gates
  perform probe_as('b');
  perform assert_err(nominate(lid, 'a-rb1', 1), 'not your nomination', '13h wrong seat');
  perform probe_as('a');
  perform assert_err(nominate(lid, 'a-rb1', 25), 'max', '13i opening bid over max');
  perform assert_ok(nominate(lid, 'a-rb1', 3), '13j nominate at $3');
  r := draft_state(lid);
  perform assert_true((r -> 'lots' -> 0 ->> 'slug') = 'a-rb1' and (r -> 'lots' -> 0 ->> 'bid')::int = 3, '13k lot open');

  -- bidding gates
  perform assert_err(place_bid(lid, 1, 4), 'high bidder', '13l cannot outbid yourself');
  perform probe_as('b');
  perform assert_err(place_bid(lid, 2, 3), 'beat', '13m must beat current bid');
  perform assert_err(place_bid(lid, 2, 19), 'max bid', '13n over max');
  perform assert_ok(place_bid(lid, 2, 5), '13o B bids $5');
  -- pause freezes the lot; resume restores its clock
  perform probe_as('a');
  perform assert_ok(commish_pause_draft(lid), '13p pause lot');
  perform assert_err(place_bid(lid, 1, 6), 'paused', '13p2 no bids while paused');
  perform assert_ok(commish_resume_draft(lid), '13q resume lot');
  perform assert_true((select deadline from auction_lot where league_id = lid) > now(), '13r lot clock restored');
  -- award at the bell
  update auction_lot set deadline = now() - interval '1 second' where league_id = lid;
  r := draft_tick(lid);
  perform assert_true((r ->> 'lots_awarded')::int = 1, '13s lot awarded');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = 'a-rb1'), '13t B owns him');
  perform assert_true((select draft_budget from league_membership where league_id = lid and sleeper_roster_id = 2) = 15, '13u paid $5');
  perform assert_true((select price from draft_pick where league_id = lid and overall = 1) = 5, '13v price recorded');
  -- next nominator (seat 2, human): expire the nomination clock → auto-nominate at $1
  update draft set deadline_at = now() - interval '1 second' where league_id = lid;
  r := draft_tick(lid);
  perform assert_true((select count(*) from auction_lot where league_id = lid) = 1, '13w auto-nominated');
  perform assert_true((select bid from auction_lot where league_id = lid) = 1 and (select roster_id from auction_lot where league_id = lid) = 2, '13x $1 by seat 2');
  -- run the auction out: expire everything until complete
  for i in 1..20 loop
    update auction_lot set deadline = deadline - interval '1 hour' where league_id = lid;
    update draft set deadline_at = coalesce(deadline_at, now()) - interval '1 hour'
      where league_id = lid and status = 'live';
    perform draft_tick(lid);
    exit when (select status from draft where league_id = lid) = 'complete';
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', '13y auction completes');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 10, '13z all 10 spots filled');
  perform assert_true(not exists (select 1 from league_membership where league_id = lid and draft_budget < 0), '13zz no negative budgets');
end $$;

-- ── 14. AI counter-bidding + slow clocks (0068) ──────────────────────────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
  ai_bid int; ai_holder int;
begin
  -- 3 seats: A (human), B (human), seat 3 VACANT → AI-driven bidder.
  -- Slow clocks accepted: 12h nomination window, 8h bell.
  perform probe_as('a');
  r := create_native_league('Proxy Wars', '2026', 3, 5, 43200, 'auction', 20, 28800);
  perform assert_ok(r, '14a create slow auction');
  lid := (r ->> 'league_id')::uuid;
  perform assert_true((select lot_seconds from draft where league_id = lid) = 28800, '14b slow bell stored');
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Bids'), '14c B joins seat 2');
  perform probe_as('a');
  for i in 1..18 loop pool := pool || jsonb_build_object('slug', 'p-rb' || i, 'full', 'P RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), '14d seed');
  perform assert_ok(start_draft(lid, '[1,2,3]'::jsonb), '14e start');

  -- A nominates the RANK-1 player at $1 → the vacant AI seat counters at once
  -- (its model values rank 1 at ~$6-8 on a $20 budget; nominator max was $1).
  perform assert_ok(nominate(lid, 'p-rb1', 1), '14f nominate rank 1 at $1');
  select bid, roster_id into ai_bid, ai_holder from auction_lot where league_id = lid;
  perform assert_true(ai_holder = 3, '14g AI seat counter-bid and holds');
  perform assert_true(ai_bid > 1 and ai_bid <= auction_lot_max(lid, 3, 5, (select id from auction_lot where league_id = lid)), '14h AI price sane');
  -- the AI bid reset the bell to the FULL slow window (no sniping)
  perform assert_true((select deadline from auction_lot where league_id = lid) > now() + interval '7 hours', '14i full-window reset');

  -- a human beating the AI's whole valuation takes it and keeps it
  perform probe_as('b');
  perform assert_ok(place_bid(lid, 2, 9), '14j B bids $9 over AI max');
  perform assert_true((select roster_id from auction_lot where league_id = lid) = 2, '14k B holds');
  update auction_lot set deadline = now() - interval '1 second' where league_id = lid;
  perform draft_tick(lid);
  perform assert_true((select price from draft_pick where league_id = lid and overall = 1) = 9, '14l B paid $9');
  perform assert_true((select draft_budget from league_membership where league_id = lid and sleeper_roster_id = 2) = 11, '14m budget 20-9');

  -- nominator seat 2 (human) misses the window → auto-nominates; lot opens
  update draft set deadline_at = now() - interval '1 second' where league_id = lid;
  perform draft_tick(lid);
  perform assert_true((select count(*) from auction_lot where league_id = lid) = 1, '14n missed turn auto-nominates');

  -- run the slow auction out: AI keeps bidding by value, nothing goes negative
  -- slow clocks are 8h/12h — leap 2 days per iteration so every window expires
  for i in 1..80 loop
    update auction_lot set deadline = deadline - interval '2 days' where league_id = lid;
    update draft set deadline_at = coalesce(deadline_at, now()) - interval '2 days'
      where league_id = lid and status = 'live';
    perform draft_tick(lid);
    exit when (select status from draft where league_id = lid) = 'complete';
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', '14o auction completes');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 15, '14p all 15 spots filled');
  perform assert_true(not exists (select 1 from league_membership where league_id = lid and draft_budget < 0), '14q no negative budgets');
  perform assert_true(not exists (select 1 from draft_pick where league_id = lid and (price is null or price < 1)), '14r every award priced');
end $$;

-- ── 15. hidden proxy maxes: a fair human-vs-human slow-auction duel ──────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  perform probe_as('a');
  r := create_native_league('Proxy Duel', '2026', 2, 5, 43200, 'auction', 20, 28800);
  perform assert_ok(r, '15a create');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Duels'), '15b B joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'd-rb' || i, 'full', 'D RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), '15c seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), '15d start');

  perform assert_ok(nominate(lid, 'd-rb1', 1), '15e A nominates at $1');
  -- B sets a hidden max of $10 → proxy takes the lot at holder_max+1 = $2
  perform probe_as('b');
  perform assert_ok(set_lot_proxy(lid, 2, 10), '15f B sets hidden max $10');
  perform assert_true((select roster_id from auction_lot where league_id = lid) = 2, '15g proxy holds the lot');
  perform assert_true((select bid from auction_lot where league_id = lid) = 2, '15h at $2, not $10');
  r := draft_state(lid);
  perform assert_true((r -> 'lots' -> 0 ->> 'my_proxy')::int = 10, '15i B sees own proxy');
  perform probe_as('a');
  r := draft_state(lid);
  perform assert_true(r -> 'lots' -> 0 ->> 'my_proxy' is null, '15j A cannot see B''s max');
  perform assert_true((select count(*) from pg_policies where tablename = 'lot_proxy') = 0, '15k proxy table unreadable');

  -- A bids $5 manually → B's proxy answers instantly at $6, A told "outbid"
  r := place_bid(lid, 1, 5);
  perform assert_ok(r, '15l A bids $5');
  perform assert_true(coalesce((r ->> 'outbid')::boolean, false), '15m A told outbid');
  perform assert_true((select roster_id from auction_lot where league_id = lid) = 2 and (select bid from auction_lot where league_id = lid) = 6, '15n proxy defends at $6');

  -- A sets a BIGGER hidden max ($12) → beats B's $10 at second+1 = $11
  r := set_lot_proxy(lid, 1, 12);
  perform assert_ok(r, '15o A sets max $12');
  perform assert_true((select roster_id from auction_lot where league_id = lid) = 1 and (select bid from auction_lot where league_id = lid) = 11, '15p A wins the duel at $11');
  perform assert_err(set_lot_proxy(lid, 1, 17), 'max bid', '15q proxy respects budget floor');

  -- bell → A pays $11; proxies cleared for the next lot
  update auction_lot set deadline = now() - interval '1 second' where league_id = lid;
  perform draft_tick(lid);
  perform assert_true((select price from draft_pick where league_id = lid and overall = 1) = 11, '15r paid $11');
  perform assert_true((select draft_budget from league_membership where league_id = lid and sleeper_roster_id = 1) = 9, '15s budget 20-11');
  perform assert_true((select count(*) from lot_proxy where league_id = lid) = 0, '15t proxies cleared');
end $$;

-- ── 16. night-aware clock arithmetic (0069) — pure function, exact answers ──
do $$
begin
  -- July ⇒ EDT (−04). Quiet hours 22:00→10:00 (1320→600).
  -- 9pm + 2h clock: 1h awake tonight, 1h tomorrow morning → 11:00.
  perform assert_true(awake_deadline('2026-07-07 21:00:00-04', 7200, 1320, 600)
    = '2026-07-08 11:00:00-04'::timestamptz, '16a clock spans the night');
  -- set DURING the night: starts counting at 10:00 → 10:10.
  perform assert_true(awake_deadline('2026-07-08 02:00:00-04', 600, 1320, 600)
    = '2026-07-08 10:10:00-04'::timestamptz, '16b night start defers to morning');
  -- non-wrapping window 01:00→05:00: 00:30 + 1h → 30min awake + night + 30min = 05:30.
  perform assert_true(awake_deadline('2026-07-08 00:30:00-04', 3600, 60, 300)
    = '2026-07-08 05:30:00-04'::timestamptz, '16c non-wrap window');
  -- clock that fits before the night is untouched.
  perform assert_true(awake_deadline('2026-07-07 12:00:00-04', 3600, 1320, 600)
    = '2026-07-07 13:00:00-04'::timestamptz, '16d daytime clock unchanged');
  -- no config = plain addition.
  perform assert_true(awake_deadline('2026-07-07 21:00:00-04', 7200, null, null)
    = '2026-07-07 23:00:00-04'::timestamptz, '16e no quiet hours');
  -- 36h slow clock from 6pm crosses TWO nights (12h/night): 36h awake
  -- = 4h (18→22) + 12h (10→22) + 12h (10→22) + 8h → day+3 06:00... verify:
  perform assert_true(awake_deadline('2026-07-07 18:00:00-04', 129600, 1320, 600)
    = '2026-07-10 18:00:00-04'::timestamptz, '16f multi-night clock');
end $$;

-- config storage + state surface
do $$
declare lid uuid; r jsonb;
begin
  perform probe_as('a');
  perform assert_err(create_native_league('X', '2026', 2, 5, 60, 'snake', 200, 15, 1, 1320, null),
    'start and an end', '16g night needs both bounds');
  r := create_native_league('Night Owls', '2026', 2, 5, 60, 'snake', 200, 15, 1, 1320, 600);
  perform assert_ok(r, '16h create with quiet hours');
  lid := (r ->> 'league_id')::uuid;
  perform assert_true((select night_start_min from draft where league_id = lid) = 1320, '16i stored');
  r := draft_state(lid);
  perform assert_true((r -> 'night' ->> 'start_min')::int = 1320 and (r -> 'night' ->> 'end_min')::int = 600, '16j state exposes night');
end $$;

-- ── 17. parallel lots (0069): capacity, committed money, independence ────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
  lot1 uuid; lot2 uuid;
begin
  perform probe_as('a');
  r := create_native_league('Two Rings', '2026', 2, 5, 60, 'auction', 20, 30, 2);
  perform assert_ok(r, '17a create max_lots=2');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Rings'), '17b B joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'm-rb' || i, 'full', 'M RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), '17c seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), '17d start');

  -- A nominates lot 1; the TURN advances to B while lot 1 runs
  perform assert_ok(nominate(lid, 'm-rb1', 1), '17e A opens lot 1');
  r := draft_state(lid);
  perform assert_true((r ->> 'on_clock')::int = 2, '17f nomination turn advanced to B');
  perform assert_true(jsonb_array_length(r -> 'lots') = 1, '17g one lot open');
  -- B nominates lot 2 in parallel
  perform probe_as('b');
  perform assert_ok(nominate(lid, 'm-rb2', 2), '17h B opens lot 2');
  select id into lot1 from auction_lot where league_id = lid and slug = 'm-rb1';
  select id into lot2 from auction_lot where league_id = lid and slug = 'm-rb2';
  -- room is at capacity: a third nomination must wait for a bell
  perform probe_as('a');
  perform assert_err(nominate(lid, 'm-rb3', 1), 'lots are open', '17i capacity gate');
  perform assert_true((select deadline_at from draft where league_id = lid) is null, '17j no nomination clock at capacity');
  -- a player on the block cannot be nominated twice (would be caught by capacity
  -- anyway here, but the uniqueness rule matters once a bell frees a slot)
  perform assert_true(exists (select 1 from auction_lot where league_id = lid and slug = 'm-rb2'), '17k lot 2 exists');

  -- committed-money math: B holds lot 2 at $2 (committed 2, held 1, 5 spots)
  -- → max on lot 1 = 20 − 2 − (4−1)·$1 = 15; $16 must be rejected, $15 legal.
  perform probe_as('b');
  perform assert_true(auction_lot_max(lid, 2, 5, lot1) = 15, '17l committed max math');
  r := place_bid(lid, 2, 16, lot1);
  perform assert_err(r, 'max bid', '17m over committed max');
  perform assert_ok(place_bid(lid, 2, 15, lot1), '17n $15 legal');
  -- lots are independent: lot 2 untouched by lot-1 bidding
  perform assert_true((select bid from auction_lot where id = lot2) = 2, '17o lot 2 unaffected');

  -- award lot 1 only → capacity frees → nomination clock reopens (A's turn)
  update auction_lot set deadline = now() - interval '1 second' where id = lot1;
  r := draft_tick(lid);
  perform assert_true((r ->> 'lots_awarded')::int = 1, '17p one bell, one award');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = 'm-rb1'), '17q B won lot 1 at $15');
  perform assert_true((select draft_budget from league_membership where league_id = lid and sleeper_roster_id = 2) = 5, '17r paid from budget');
  perform assert_true(exists (select 1 from auction_lot where id = lot2), '17s lot 2 still running');
  r := draft_state(lid);
  perform assert_true((r ->> 'on_clock')::int = 1 and (r ->> 'deadline_at') is not null, '17t nomination reopened for A');

  -- run it out: both seats fill all 5 spots, money stays sane
  for i in 1..40 loop
    update auction_lot set deadline = deadline - interval '2 days' where league_id = lid;
    update draft set deadline_at = coalesce(deadline_at, now()) - interval '2 days'
      where league_id = lid and status = 'live';
    perform draft_tick(lid);
    exit when (select status from draft where league_id = lid) = 'complete';
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', '17u completes');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 10, '17v 10 spots filled');
  perform assert_true(not exists (select 1 from league_membership where league_id = lid and draft_budget < 0), '17w no negative budgets');
  perform assert_true((select count(*) from auction_lot where league_id = lid) = 0, '17x no orphan lots');
end $$;

-- ── 18. mock drafts (0070): AI opponents, solo practice, delete ──────────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  -- same closed-testing gate as real native leagues
  perform probe_as('b');
  perform assert_err(create_mock_draft(4), 'closed testing', '18a non-admin gated');

  -- SNAKE mock: creator + 3 named bots
  perform probe_as('a');
  r := create_mock_draft(4, 5, 60, 'snake');
  perform assert_ok(r, '18b create mock snake');
  lid := (r ->> 'league_id')::uuid;
  perform assert_true((select is_mock from league where id = lid), '18c is_mock set');
  perform assert_true((select count(*) from league_membership where league_id = lid and controller = 'ai') = 3, '18d three AI seats');
  perform assert_true(not exists (select 1 from league_membership where league_id = lid
    and sleeper_roster_id > 1 and team_name like 'Team %'), '18e bots have names');
  -- an invite code exists but seats nobody
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_err(native_join(code), 'solo practice', '18f join refused');

  -- pool: 16 skill + 4 K + 4 DEF (≥ 4 teams × 5 rounds)
  perform probe_as('a');
  for i in 1..8 loop
    pool := pool || jsonb_build_object('slug', 'mk-rb' || i, 'full', 'MK RB ' || i, 'pos', 'RB', 'team', 'T');
    pool := pool || jsonb_build_object('slug', 'mk-wr' || i, 'full', 'MK WR ' || i, 'pos', 'WR', 'team', 'T');
  end loop;
  for i in 1..4 loop
    pool := pool || jsonb_build_object('slug', 'mk-k' || i, 'full', 'MK K ' || i, 'pos', 'K', 'team', 'T');
    pool := pool || jsonb_build_object('slug', 'mk-d' || i, 'full', 'MK D ' || i, 'pos', 'DEF', 'team', 'T');
  end loop;
  perform assert_ok(seed_league_pool(lid, pool), '18g seed');
  perform assert_ok(start_draft(lid, '[2,1,3,4]'::jsonb), '18h start');
  r := draft_state(lid);
  perform assert_true((r ->> 'is_mock')::boolean, '18i state says mock');
  perform assert_true((r ->> 'on_clock')::int = 2 and (r ->> 'on_clock_auto')::boolean, '18j AI on the clock reads auto');

  -- one tick: the AI leadoff seat picks instantly, then it's the human's turn
  perform draft_tick(lid);
  r := draft_state(lid);
  perform assert_true((r ->> 'on_clock')::int = 1 and not (r ->> 'on_clock_auto')::boolean, '18k human up after AI pick');
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 1
    and (select auto from draft_pick where league_id = lid and overall = 1), '18l AI pick marked auto');
  -- the human drafts by hand, mid-clock
  perform assert_ok(make_draft_pick(lid, 'mk-wr1'), '18m human picks');
  -- next tick carries the AI seats to the human's round-2 turn (snake: 3,4 → 4,3)
  perform draft_tick(lid);
  r := draft_state(lid);
  perform assert_true((r ->> 'on_clock')::int = 1, '18n human up again in round 2');
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 6, '18o AI filled to my pick');

  -- run it out (expired human clocks autopick, same as a real draft)
  for i in 1..30 loop
    update draft set deadline_at = now() - interval '1 second' where league_id = lid and status = 'live';
    perform draft_tick(lid);
    exit when (select status from draft where league_id = lid) = 'complete';
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', '18p mock snake completes');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 20, '18q all 20 picks made');
  perform assert_true(not exists (
    select 1 from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid group by nr.roster_id
    having count(*) filter (where lp.pos = 'K') <> 1 or count(*) filter (where lp.pos = 'DEF') <> 1
  ), '18r every roster ends with 1 K + 1 DEF');
  -- no schedule ⇒ nothing materializes into the season pipeline
  perform assert_true(not exists (select 1 from sleeper_lineup where league_id = lid), '18s no season lineups');
  perform assert_true(not exists (select 1 from matchup where league_id = lid), '18t no schedule');

  -- deletion: only the mock's commish/admin, and only mocks
  perform probe_as('b');
  perform assert_err(delete_mock_draft(lid), 'forbidden', '18u stranger cannot delete');
  perform probe_as('a');
  perform assert_err(delete_mock_draft(current_setting('probe.lid')::uuid), 'not a mock', '18v real league refused');
  perform assert_ok(delete_mock_draft(lid), '18w delete mock');
  perform assert_true(not exists (select 1 from league where id = lid), '18x league gone');
end $$;

-- ── 19. mock AUCTION: AI nominates, counter-bids, and the room self-runs ─────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; nlots int;
begin
  perform probe_as('a');
  -- 3 teams · 5 spots · $20 · 2 parallel lots, human takes seat 1
  r := create_mock_draft(3, 5, 60, 'auction', 20, 15, 2);
  perform assert_ok(r, '19a create mock auction');
  lid := (r ->> 'league_id')::uuid;
  for i in 1..20 loop
    pool := pool || jsonb_build_object('slug', 'ma-rb' || i, 'full', 'MA RB ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  perform assert_ok(seed_league_pool(lid, pool), '19b seed');
  perform assert_ok(start_draft(lid, '[2,3,1]'::jsonb), '19c start');

  -- one tick: the two AI seats nominate both lots without waiting for a bell
  perform draft_tick(lid);
  select count(*) into nlots from auction_lot where league_id = lid;
  perform assert_true(nlots = 2, '19d AI fills both lots');
  -- regression (0070): back-to-back auto-nominations must pick DISTINCT players
  -- (autopick used to ignore the block and re-nominate the top-ranked player,
  -- aborting the tick on auction_lot's unique constraint — a frozen room)
  perform assert_true((select count(distinct slug) from auction_lot where league_id = lid) = 2
    and exists (select 1 from auction_lot where league_id = lid and slug = 'ma-rb1')
    and exists (select 1 from auction_lot where league_id = lid and slug = 'ma-rb2'), '19d2 top-2 ranked on the block');
  -- AI counter-bidding already priced the top of the board above the $1 open
  perform assert_true((select max(bid) from auction_lot where league_id = lid) > 1, '19e counter-bids landed');

  -- the human can outbid a live lot
  r := draft_state(lid);
  perform assert_true((r ->> 'is_mock')::boolean, '19f state says mock');
  perform assert_ok(place_bid(lid, 1, (select min(bid) from auction_lot where league_id = lid) + 1,
    (select id from auction_lot where league_id = lid order by bid limit 1)), '19g human bids');

  -- run it out: bells + windows expire until every roster is full
  for i in 1..40 loop
    update auction_lot set deadline = deadline - interval '2 days' where league_id = lid;
    update draft set deadline_at = coalesce(deadline_at, now()) - interval '2 days'
      where league_id = lid and status = 'live';
    perform draft_tick(lid);
    exit when (select status from draft where league_id = lid) = 'complete';
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', '19h mock auction completes');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 15, '19i 15 spots filled');
  perform assert_true(not exists (select 1 from league_membership where league_id = lid and draft_budget < 0), '19j no negative budgets');
  perform assert_true(not exists (select 1 from sleeper_lineup where league_id = lid), '19k no season lineups');
  perform assert_ok(delete_mock_draft(lid), '19l delete mock');
end $$;

-- ── 20. roster rules (0071): per-position limits, humans + AI + editor ───────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  perform probe_as('a');
  -- validation gates
  perform assert_err(create_native_league('Bad Caps', '2026', 2, 5, 60, 'snake', 200, 15, 1, null, null,
    '{"QB":1,"FLEX":2}'::jsonb), 'unknown position', '20a unknown position key');
  perform assert_err(create_native_league('Tight Caps', '2026', 2, 5, 60, 'snake', 200, 15, 1, null, null,
    '{"QB":1,"RB":1,"WR":1,"TE":1,"K":0,"DEF":0}'::jsonb), 'too tight', '20b unfillable caps');

  -- QB≤1, RB≤2, no kickers, DEF≤1 (WR/TE uncapped)
  r := create_native_league('Caps FC', '2026', 2, 5, 60, 'snake', 200, 15, 1, null, null,
    '{"QB":1,"RB":2,"K":0,"DEF":1}'::jsonb);
  perform assert_ok(r, '20c create with caps');
  lid := (r ->> 'league_id')::uuid;
  perform set_config('probe.caps_lid', lid::text, false);

  -- editor: roster size is free while pending, commish-only
  perform probe_as('b');
  perform assert_err(set_roster_rules(lid, 7, null), 'forbidden', '20d editor commish-only');
  perform probe_as('a');
  perform assert_ok(set_roster_rules(lid, 7, null), '20e resize while pending');
  perform assert_true((roster_rules(lid) ->> 'rounds')::int = 7, '20f resize stuck');
  perform assert_ok(set_roster_rules(lid, 5, null), '20g resize back');

  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Caps'), '20h B joins');
  perform probe_as('a');
  for i in 1..3 loop pool := pool || jsonb_build_object('slug', 'c-qb' || i, 'full', 'C QB ' || i, 'pos', 'QB', 'team', 'T'); end loop;
  for i in 1..6 loop
    pool := pool || jsonb_build_object('slug', 'c-rb' || i, 'full', 'C RB ' || i, 'pos', 'RB', 'team', 'T');
    pool := pool || jsonb_build_object('slug', 'c-wr' || i, 'full', 'C WR ' || i, 'pos', 'WR', 'team', 'T');
  end loop;
  for i in 1..2 loop
    pool := pool || jsonb_build_object('slug', 'c-te' || i, 'full', 'C TE ' || i, 'pos', 'TE', 'team', 'T');
    pool := pool || jsonb_build_object('slug', 'c-k' || i, 'full', 'C K ' || i, 'pos', 'K', 'team', 'T');
    pool := pool || jsonb_build_object('slug', 'c-dst' || i, 'full', 'C DST ' || i, 'pos', 'DEF', 'team', 'T');
  end loop;
  perform assert_ok(seed_league_pool(lid, pool), '20i seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), '20j start');
  r := draft_state(lid);
  perform assert_true((r -> 'pos_caps' ->> 'QB')::int = 1 and (r -> 'pos_caps' ->> 'K')::int = 0
    and r -> 'pos_caps' -> 'WR' = 'null'::jsonb, '20k caps surfaced in draft_state');

  -- human enforcement on the clock
  perform assert_ok(make_draft_pick(lid, 'c-qb1'), '20l A takes a QB');
  perform probe_as('b');
  perform assert_err(make_draft_pick(lid, 'c-k1'), 'does not roster', '20m K banned');
  perform assert_ok(make_draft_pick(lid, 'c-qb2'), '20n B takes a QB');
  perform assert_err(make_draft_pick(lid, 'c-qb3'), 'at most 1 QB', '20o QB cap binds B');
  perform assert_ok(make_draft_pick(lid, 'c-rb1'), '20p B takes an RB');
  perform probe_as('a');
  perform assert_err(make_draft_pick(lid, 'c-qb3'), 'at most 1 QB', '20q QB cap binds A');
  perform assert_ok(make_draft_pick(lid, 'c-rb2'), '20r A takes an RB');

  -- run it out: expired human clocks autopick under the same caps
  for i in 1..15 loop
    update draft set deadline_at = now() - interval '1 second' where league_id = lid and status = 'live';
    perform draft_tick(lid);
    exit when (select status from draft where league_id = lid) = 'complete';
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', '20s draft completes');
  perform assert_true(not exists (
    select 1 from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid group by nr.roster_id
    having count(*) filter (where lp.pos = 'QB') > 1
        or count(*) filter (where lp.pos = 'RB') > 2
        or count(*) filter (where lp.pos = 'K') <> 0
        or count(*) filter (where lp.pos = 'DEF') <> 1
  ), '20t every roster obeys the caps (and no K drafted)');

  -- free agency + waivers respect caps
  perform assert_err(add_free_agent(lid, 1, 'c-qb3'), 'at most 1 QB', '20u FA over cap');
  perform assert_ok(add_free_agent(lid, 1, 'c-qb3', 'c-qb1'), '20v same-position swap legal');
  -- (with a non-QB drop, so the roster-full check passes and the CAP binds)
  perform assert_err(submit_waiver_claim(lid, 1, 'c-qb1', 'c-rb2'), 'at most 1 QB', '20w claim over cap');
  -- rounds lock once live/complete; caps stay editable and take effect at once
  perform assert_err(set_roster_rules(lid, 6, null), 'locked', '20x rounds locked after start');
  perform assert_ok(set_roster_rules(lid, null, '{"QB":2,"RB":2,"K":0,"DEF":1}'::jsonb), '20y raise QB cap');
  perform assert_ok(submit_waiver_claim(lid, 1, 'c-qb1', 'c-rb2'), '20z claim fits under the new cap');
  r := native_team_state(lid);
  perform assert_true((r -> 'pos_caps' ->> 'QB')::int = 2, '20z2 caps in team state');
end $$;

-- ── 21. roster caps in auctions + league crests (0071) ───────────────────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text; av text;
begin
  -- AUCTION: a bid/nomination/hidden-max is a commitment — cap-checked
  perform probe_as('a');
  r := create_native_league('Cap Auction', '2026', 2, 5, 60, 'auction', 20, 15, 1, null, null,
    '{"QB":1}'::jsonb);
  perform assert_ok(r, '21a create capped auction');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Bids'), '21b B joins');
  perform probe_as('a');
  for i in 1..4 loop
    pool := pool || jsonb_build_object('slug', 'x-qb' || i, 'full', 'X QB ' || i, 'pos', 'QB', 'team', 'T');
    pool := pool || jsonb_build_object('slug', 'x-rb' || i, 'full', 'X RB ' || i, 'pos', 'RB', 'team', 'T');
    pool := pool || jsonb_build_object('slug', 'x-wr' || i, 'full', 'X WR ' || i, 'pos', 'WR', 'team', 'T');
  end loop;
  perform assert_ok(seed_league_pool(lid, pool), '21c seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), '21d start');

  perform assert_ok(nominate(lid, 'x-qb1', 1), '21e A nominates a QB');
  perform probe_as('b');
  perform assert_ok(place_bid(lid, 2, 2), '21f B outbids');
  update auction_lot set deadline = now() - interval '1 second' where league_id = lid;
  perform draft_tick(lid);
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = 'x-qb1'), '21g B wins the QB');
  -- B is at the QB cap: no nominating, bidding, or proxying another QB
  perform assert_err(nominate(lid, 'x-qb2', 1), 'at most 1 QB', '21h nomination cap-checked');
  perform assert_ok(nominate(lid, 'x-rb1', 1), '21i RB nomination fine');
  perform probe_as('a');
  perform assert_ok(place_bid(lid, 1, 2), '21j A takes the RB lot');
  update auction_lot set deadline = now() - interval '1 second' where league_id = lid;
  perform draft_tick(lid);
  perform assert_ok(nominate(lid, 'x-qb2', 1), '21k A (0 QB) nominates a QB');
  perform probe_as('b');
  perform assert_err(place_bid(lid, 2, 2), 'at most 1 QB', '21l bid cap-checked');
  perform assert_err(set_lot_proxy(lid, 2, 5), 'at most 1 QB', '21m hidden max cap-checked');

  -- LEAGUE CRESTS: a random first-party tile at creation…
  perform probe_as('a');
  select avatar_url into av from league where id = lid;
  perform assert_true(av like 'https://dripfantasy.com/avatars/%', '21n native league gets a crest');
  r := create_mock_draft(2, 5, 60);
  perform assert_ok(r, '21o mock created');
  perform assert_true((select avatar_url from league where id = (r ->> 'league_id')::uuid)
    like 'https://dripfantasy.com/avatars/%', '21p mock gets a crest');
  perform assert_ok(delete_mock_draft((r ->> 'league_id')::uuid), '21q mock cleaned up');

  -- …the platform's crest on import when it has one…
  r := admin_upsert_league('sleeper-av1', '2026', 'Imported One', '{}'::jsonb, 'sleeper',
    'https://sleepercdn.com/avatars/thumbs/abc123');
  perform assert_ok(r, '21r import with platform avatar');
  perform assert_true((select avatar_url from league where id = (r ->> 'league_id')::uuid)
    = 'https://sleepercdn.com/avatars/thumbs/abc123', '21s platform crest stored');
  -- …which a re-sync never clobbers…
  r := admin_upsert_league('sleeper-av1', '2026', 'Imported One', '{}'::jsonb, 'sleeper',
    'https://sleepercdn.com/avatars/thumbs/DIFFERENT');
  perform assert_true((select avatar_url from league where id = (r ->> 'league_id')::uuid)
    = 'https://sleepercdn.com/avatars/thumbs/abc123', '21t re-sync keeps the crest');
  -- …and a platform with no avatar (or a bad URL) falls back to site art.
  r := admin_upsert_league('espn-av2', '2026', 'Imported Two', '{}'::jsonb, 'espn', null);
  perform assert_true((select avatar_url from league where id = (r ->> 'league_id')::uuid)
    like 'https://dripfantasy.com/avatars/%', '21u no-avatar import gets site art');
  r := admin_upsert_league('espn-av3', '2026', 'Imported Three', '{}'::jsonb, 'espn', 'http://not-https');
  perform assert_true((select avatar_url from league where id = (r ->> 'league_id')::uuid)
    like 'https://dripfantasy.com/avatars/%', '21v bad URL falls back to site art');
end $$;

select 'ALL PROBES PASSED' as result;
