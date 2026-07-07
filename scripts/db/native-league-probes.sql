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

-- identity helpers
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev');
select set_config('app.uid', '00000000-0000-0000-0000-00000000000a', false);
select set_config('app.email', 'a@test.dev', false);

-- 2026 slate row so week-1 lock_at resolves
insert into nfl_slate (season, week, home, away, win, kickoff)
values ('2026', 1, 'SEA', 'KC', 'snf', '2026-09-09T20:20:00-04:00') on conflict do nothing;

-- ── 1. create league ─────────────────────────────────────────────────────────
do $$
declare r jsonb; lid uuid;
begin
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000b', false);
  perform set_config('app.email', 'b@test.dev', false);
  r := native_join(code, 'Bravo Squad');
  perform assert_ok(r, '2a B joins');
  perform assert_true((r ->> 'roster_id')::int = 2, '2b B gets seat 2');
  r := native_join(code);
  perform assert_true((r ->> 'roster_id')::int = 2 and (r ->> 'status') = 'enrolled', '2c idempotent rejoin');
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000c', false);
  perform set_config('app.email', 'c@test.dev', false);
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000a', false);
  perform set_config('app.email', 'a@test.dev', false);
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000b', false);
  perform assert_err(start_draft(lid), 'forbidden', '5a non-commish start');
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000a', false);
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000b', false);
  perform assert_err(make_draft_pick(lid, 'qb1'), 'not your pick', '6a turn gate');
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000c', false);
  perform assert_err(make_draft_pick(lid, 'nope'), 'not in pool', '6b unknown slug');
  r := make_draft_pick(lid, 'qb1');
  perform assert_ok(r, '6c C picks qb1');
  -- next: roster 1 (A) — commish; C may not proxy
  perform assert_err(make_draft_pick(lid, 'rb1'), 'not your pick', '6d no proxy for player');
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000a', false);
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000b', false);
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000b', false);
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000c', false);
  select slug into dropc from native_roster where league_id = lid and roster_id = 3 order by added_at limit 1;
  r := submit_waiver_claim(lid, 3, dropb, dropc);
  perform assert_ok(r, '8f claim by C');
  r := submit_waiver_claim(lid, 3, dropb, dropc);
  perform assert_err(r, 'already pending', '8g dup claim');
  -- B claims the same player too (priority 1 → should win at clear)
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000b', false);
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000c', false);
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
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000b', false);
  r := draft_state(lid);
  perform assert_true((r ->> 'status') = 'complete' and jsonb_array_length(r -> 'picks') = 28, '10a draft_state');
  r := native_team_state(lid);
  perform assert_true((r ->> 'my_roster_id')::int = 2 and (r ->> 'roster_cap')::int = 7, '10b team_state');
  perform assert_true(jsonb_array_length(r -> 'waiver_order') = 4, '10c waiver order');
  -- non-member: RPCs refuse
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000d', false);
  r := draft_state(lid);
  perform assert_true((r ->> 'error') = 'forbidden', '10d outsider draft_state');
  r := native_team_state(lid);
  perform assert_true((r ->> 'error') = 'forbidden', '10e outsider team_state');
end $$;

-- table-level RLS as the `authenticated` role
set role authenticated;
select set_config('app.uid', '00000000-0000-0000-0000-00000000000d', false);
do $$
begin
  perform assert_true((select count(*) from league_pool) = 0, '10f outsider sees no pool');
  perform assert_true((select count(*) from native_roster) = 0, '10g outsider sees no rosters');
  perform assert_true((select count(*) from draft_pick) = 0, '10h outsider sees no picks');
end $$;
select set_config('app.uid', '00000000-0000-0000-0000-00000000000b', false);
do $$
declare lid uuid := current_setting('probe.lid')::uuid;
begin
  perform assert_true((select count(*) from league_pool where league_id = lid) = 40, '10i member sees pool');
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 28, '10j member sees picks');
  perform assert_true((select count(*) from waiver_claim where league_id = lid and status = 'pending') = 0, '10k no pending leak');
end $$;
reset role;

select 'ALL PROBES PASSED' as result;
