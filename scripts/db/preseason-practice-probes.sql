-- 0110 preseason-practice probes. Run with ON_ERROR_STOP; every failed assertion
-- raises. Companion suite to native-league-probes.sql, driven by the same
-- scratch-DB harness (scripts/db/run-scratch-probes.sh).
--
-- What this pins down: the preseason board weeks (101 … 100 + preseason_week_
-- count()) are THROWAWAY — they never move real coin, real inventory, or a real
-- record — a league's commissioner (not just a super-admin) can open and close
-- practice, pairings are drawn at random per week (no schedule needed),
-- already-played weeks are skipped,
-- practice spending runs on its own weekly 120-coin purse (0115), and the
-- lineup cap covers every slot the practice board renders (0118), while the
-- regular season keeps base 8 + purchased.
\set QUIET on
\pset pager off

grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

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
create or replace function assert_eq(a numeric, b numeric, msg text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception 'PROBE FAIL % — expected %, got %', msg, b, a; end if; end $$;

create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000010' || u, false);
  perform set_config('app.email', 'p' || u || '@test.dev', false);
end $$;

-- ── fixtures ─────────────────────────────────────────────────────────────────
-- p1 = commissioner (also the home seat), p2 = a plain member (away seat),
-- p3 = an outsider. Nobody is an app_admin: every allow below has to come from
-- the commissioner path, not is_admin().
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000101', 'p1@test.dev'),
  ('00000000-0000-0000-0000-000000000102', 'p2@test.dev'),
  ('00000000-0000-0000-0000-000000000103', 'p3@test.dev') on conflict do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000000101', 'p1@test.dev'),
  ('00000000-0000-0000-0000-000000000102', 'p2@test.dev'),
  ('00000000-0000-0000-0000-000000000103', 'p3@test.dev') on conflict do nothing;

insert into league (id, sleeper_league_id, season, name, commissioner_id)
values ('00000000-0000-0000-0000-0000000009f1', 'PRESEASON-PROBE', '2026', 'Practice Probe League',
        '00000000-0000-0000-0000-000000000101');
insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name) values
  ('00000000-0000-0000-0000-0000000009f1', 1, '00000000-0000-0000-0000-000000000101', true, 'Home'),
  ('00000000-0000-0000-0000-0000000009f1', 2, '00000000-0000-0000-0000-000000000102', true, 'Away');
-- A Week-1 pairing (no longer required to open practice — see 2c/2b1).
insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
values ('00000000-0000-0000-0000-0000000009f1', 1, 1, 2, 'scheduled');
-- A couple more regular-season weeks. Since 0114 these no longer drive the
-- practice pairings (those are drawn at random) — they only stand in as the
-- lineup fallback, and prove a synced league still behaves.
insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values
  ('00000000-0000-0000-0000-0000000009f1', 2, 2, 1, 'scheduled'),
  ('00000000-0000-0000-0000-0000000009f1', 3, 1, 2, 'scheduled'),
  ('00000000-0000-0000-0000-0000000009f1', 4, 2, 1, 'scheduled');

-- Preseason slate rows so the pool seeder has teams. Week 101's kickoff is in the
-- PAST (the real Hall of Fame game, Aug 2026) — 0113 must skip it; the rest are
-- pushed far enough out that these probes keep passing after the real preseason.
insert into nfl_slate (season, week, home, away, win, kickoff) values
  ('2026', 101, 'ARI', 'CAR', 'tnf', '2026-08-07T00:00Z'),
  ('2026', 102, 'CIN', 'DET', 'tnf', (now() + interval '30 days')::timestamptz),
  ('2026', 103, 'HOU', 'LV',  'tnf', (now() + interval '37 days')::timestamptz),
  ('2026', 104, 'BUF', 'PIT', 'tnf', (now() + interval '44 days')::timestamptz)
on conflict do nothing;

-- ── 1. the predicate ─────────────────────────────────────────────────────────
do $$
begin
  perform assert_true(is_practice_week(101), '1a 101 is practice');
  perform assert_true(is_practice_week(103), '1b 103 is practice');
  perform assert_true(not is_practice_week(1), '1c week 1 is not practice');
  perform assert_true(not is_practice_week(18), '1d week 18 is not practice');
  -- The season wallet seed passes a NULL week; it must still bank.
  perform assert_true(not is_practice_week(null), '1e null week is not practice');
end $$;

-- ── 2. the one-click: who may open practice ──────────────────────────────────
do $$
declare r jsonb; n int;
begin
  perform probe_as('3');  -- outsider
  perform assert_err(set_preseason_practice('00000000-0000-0000-0000-0000000009f1', true), 'forbidden', '2a outsider gated');
  perform probe_as('2');  -- ordinary member, not the commish
  perform assert_err(set_preseason_practice('00000000-0000-0000-0000-0000000009f1', true), 'forbidden', '2b member gated');

  perform probe_as('1');  -- the commissioner — no admin bit anywhere
  r := set_preseason_practice('00000000-0000-0000-0000-0000000009f1', true);
  perform assert_ok(r, '2c commish opens practice');
  perform assert_true((r ->> 'preseason_at') is not null, '2d stamped');
  -- Four board weeks for 2026 (0112), but week 101 is already played, so only
  -- 102-104 are built. Read from the helper so extending the preseason can't
  -- silently under-assert here.
  perform assert_true(101 = any(preseason_board_weeks()) and 104 = any(preseason_board_weeks()), '2f weeks 101-104 in range');
  select count(*) into n from matchup
    where league_id = '00000000-0000-0000-0000-0000000009f1' and week = any(preseason_board_weeks());
  perform assert_eq(n, 3, '2g one matchup per PLAYABLE preseason week');
  perform assert_eq((select count(*) from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 101),
    0, '2h the already-played week was skipped');
  perform assert_true((r -> 'skipped') @> '101'::jsonb, '2i skip reported to the caller');
  perform assert_true((r -> 'weeks') @> '102'::jsonb and (r -> 'weeks') @> '104'::jsonb, '2j seeded weeks reported');
end $$;

-- ── 2b. pairings are RANDOM, and differ week to week (0114) ─────────────────
-- Practice no longer clones the league's schedule: seats are shuffled
-- deterministically per (league, board week) and paired off. Uses a 6-seat league
-- so "the pairings actually differ" is a real assertion rather than a coin flip
-- on two teams.
do $$
declare lid uuid := '00000000-0000-0000-0000-0000000009f4'; r jsonb; n int; k102 text; k103 text; k104 text;
begin
  insert into league (id, sleeper_league_id, season, name, commissioner_id)
  values (lid, 'PRESEASON-PROBE-4', '2026', 'Six Seat League', '00000000-0000-0000-0000-000000000101');
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name)
    select lid, g, null, false, 'Team ' || g from generate_series(1, 6) g;
  -- Deliberately NO matchup rows at all: this league has never been synced.
  perform probe_as('1');
  r := set_preseason_practice(lid, true);
  perform assert_ok(r, '2b1 opens with no schedule at all');

  select count(*) into n from matchup where league_id = lid and week = 102;
  perform assert_eq(n, 3, '2b2 six seats paired into three matchups');

  -- The pairing SET per week, order-independent, as a comparable string.
  select string_agg(k, ',' order by k) into k102 from (
    select least(home_roster_id, away_roster_id) || '-' || greatest(home_roster_id, away_roster_id) as k
      from matchup where league_id = lid and week = 102) t;
  select string_agg(k, ',' order by k) into k103 from (
    select least(home_roster_id, away_roster_id) || '-' || greatest(home_roster_id, away_roster_id) as k
      from matchup where league_id = lid and week = 103) t;
  select string_agg(k, ',' order by k) into k104 from (
    select least(home_roster_id, away_roster_id) || '-' || greatest(home_roster_id, away_roster_id) as k
      from matchup where league_id = lid and week = 104) t;
  perform assert_true(k102 is distinct from k103 or k103 is distinct from k104,
    '2b3 practice weeks are not all the same pairing');
  perform assert_true(k102 is not null and k103 is not null and k104 is not null, '2b4 every playable week paired');

  -- Deterministic: rebuilding reproduces the same draw rather than reshuffling.
  perform assert_ok(set_preseason_practice(lid, true), '2b5 rebuild while already on');
  perform assert_eq((select count(*) from matchup where league_id = lid and week = 102), 3, '2b6 still three matchups');
  perform assert_true(k102 = (select string_agg(k, ',' order by k) from (
      select least(home_roster_id, away_roster_id) || '-' || greatest(home_roster_id, away_roster_id) as k
        from matchup where league_id = lid and week = 102) t),
    '2b7 rebuild is idempotent — same pairing, not a reshuffle');

  -- Every seat plays exactly once per week (6 seats, no byes).
  select count(*) into n from (
    select home_roster_id rid from matchup where league_id = lid and week = 102
    union all select away_roster_id from matchup where league_id = lid and week = 102) t;
  perform assert_eq(n, 6, '2b8 every seat is paired exactly once');

  perform assert_ok(set_preseason_practice(lid, false), '2b9 cleanup');
end $$;

-- ── 2c. a league with fewer than two seats can't be paired ──────────────────
do $$
declare lid uuid := '00000000-0000-0000-0000-0000000009f3';
begin
  insert into league (id, sleeper_league_id, season, name, commissioner_id)
  values (lid, 'PRESEASON-PROBE-3', '2026', 'One Seat League', '00000000-0000-0000-0000-000000000101');
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name)
  values (lid, 1, '00000000-0000-0000-0000-000000000101', true, 'Solo');
  perform probe_as('1');
  perform assert_err(set_preseason_practice(lid, true), 'at least two seats', '2o one-seat league refused');
  perform assert_true((select preseason_at from league where id = lid) is null, '2p refusal left no stamp');
end $$;

-- ── 3. the deep pool, seeded by the commissioner ─────────────────────────────
do $$
declare r jsonb; n int;
begin
  perform probe_as('1');
  perform assert_err(seed_preseason_pool('00000000-0000-0000-0000-0000000009f1', 5, '[{"slot":0}]'::jsonb),
    'preseason board weeks only', '3a regular week refused');
  perform assert_err(seed_preseason_pool('00000000-0000-0000-0000-0000000009f1', 100 + preseason_week_count() + 1, '[{"slot":0}]'::jsonb),
    'preseason board weeks only', '3a2 past the last preseason week refused');
  perform assert_err(seed_preseason_pool('00000000-0000-0000-0000-0000000009f1', 102, '[]'::jsonb),
    'non-empty array', '3b empty pool refused');
  r := seed_preseason_pool('00000000-0000-0000-0000-0000000009f1', 102,
    '[{"slot":0,"player_slug":"kyler-murray","pos":"QB","team":"ARI"}]'::jsonb);
  perform assert_ok(r, '3c commish seeds the pool');
  perform assert_eq((r ->> 'seats')::numeric, 2, '3d every seat got the pool');
  select count(*) into n from sleeper_lineup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 102;
  perform assert_eq(n, 2, '3e two lineup rows at week 102');

  perform probe_as('3');
  perform assert_err(seed_preseason_pool('00000000-0000-0000-0000-0000000009f1', 102, '[{"slot":0}]'::jsonb),
    'forbidden', '3f outsider cannot seed');
end $$;

-- ── 4. the internal helpers are NOT callable by a signed-in user ─────────────
do $$
begin
  perform assert_true(not has_function_privilege('authenticated', '_set_preseason(uuid, boolean)', 'execute'),
    '4a _set_preseason revoked from authenticated');
  perform assert_true(not has_function_privilege('authenticated', '_clone_preseason_weeks(uuid)', 'execute'),
    '4b _clone_preseason_weeks revoked from authenticated');
end $$;

-- ── 5. practice weeks never move the wallet ──────────────────────────────────
do $$
declare r jsonb; bal numeric; rows_before int; rows_after int;
begin
  -- A real week banks.
  r := credit_wallet('00000000-0000-0000-0000-0000000009f1', 1, null, 1, 40, 'earn-real');
  perform assert_ok(r, '5a real week credits');
  perform assert_true((r ->> 'credited')::boolean, '5b real week credited');
  select coins into bal from team_wallet where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 1;
  perform assert_eq(bal, 40, '5c balance banked');

  -- A practice week does not — no ledger row, no balance change.
  select count(*) into rows_before from coin_ledger where league_id = '00000000-0000-0000-0000-0000000009f1';
  r := credit_wallet('00000000-0000-0000-0000-0000000009f1', 1, null, 101, 999, 'earn-practice');
  perform assert_ok(r, '5d practice credit reports ok');
  perform assert_true(not (r ->> 'credited')::boolean, '5e practice credited nothing');
  perform assert_true((r ->> 'practice')::boolean, '5f flagged as practice');
  select count(*) into rows_after from coin_ledger where league_id = '00000000-0000-0000-0000-0000000009f1';
  perform assert_eq(rows_after, rows_before, '5g no ledger row for practice');
  select coins into bal from team_wallet where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 1;
  perform assert_eq(bal, 40, '5h balance untouched by practice');

  -- Spending draws on the PRACTICE BUDGET (0115), not the season wallet: real
  -- prices, real scarcity, and a purse that starts at 120 every practice week
  -- regardless of what the team actually has.
  r := spend_from_wallet('00000000-0000-0000-0000-0000000009f1', 2, 85, null, 103, 'spend:floodgates', null);
  perform assert_ok(r, '5i practice spend allowed with an empty season wallet');
  perform assert_eq((r ->> 'charged')::numeric, 85, '5j practice spend charged the real price');
  perform assert_true((select coins from team_wallet where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 2) is null,
    '5k practice spend never opened a SEASON wallet');
  perform assert_eq((select coins from practice_wallet
      where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 2 and week = 103),
    practice_budget() - 85, '5m the practice purse carries the debit');
  -- And the budget BITES: 120 - 85 = 35 left, so an 85 buy is refused.
  perform assert_err(spend_from_wallet('00000000-0000-0000-0000-0000000009f1', 2, 85, null, 103, 'spend:floodgates', null),
    'insufficient', '5n practice budget runs out');
  -- Each week is its own purse — overspending PRE 3 can't cripple PRE 4.
  perform assert_ok(spend_from_wallet('00000000-0000-0000-0000-0000000009f1', 2, 85, null, 104, 'spend:floodgates', null),
    '5o a different practice week starts fresh');
  -- The same spend on a real week still enforces the balance guard.
  perform assert_err(spend_from_wallet('00000000-0000-0000-0000-0000000009f1', 2, 85, null, 1, 'spend:floodgates', null),
    'insufficient', '5l real spend still guarded');
end $$;

-- ── 6. the weekly budget refuses a practice week ─────────────────────────────
do $$
begin
  perform probe_as('1');
  perform assert_ok(commish_set_weekly_budget('00000000-0000-0000-0000-0000000009f1', 25), '6a budget set');
  perform assert_err(commish_grant_weekly_budget('00000000-0000-0000-0000-0000000009f1', 102),
    'practice', '6b practice week refused');
  perform assert_ok(commish_grant_weekly_budget('00000000-0000-0000-0000-0000000009f1', 2), '6c real week granted');
end $$;

-- ── 7. practice results stay out of the record ───────────────────────────────
do $$
declare st jsonb; home jsonb;
begin
  -- Roster 1 loses in the regular season and wins twice in practice.
  update matchup set status = 'final', home_final = 80, away_final = 120
    where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 1;
  update matchup set status = 'final', home_final = 200, away_final = 10
    where league_id = '00000000-0000-0000-0000-0000000009f1' and week in (102, 104);

  perform probe_as('1');
  st := league_standings('00000000-0000-0000-0000-0000000009f1');
  select e into home from jsonb_array_elements(st) e where (e ->> 'roster_id')::int = 1;
  perform assert_eq((home ->> 'wins')::numeric, 0, '7a practice wins excluded');
  perform assert_eq((home ->> 'losses')::numeric, 1, '7b real loss counted');
  perform assert_eq((home ->> 'pf')::numeric, 80, '7c practice points excluded from PF');
  perform assert_eq((home ->> 'pa')::numeric, 120, '7d practice points excluded from PA');
end $$;

-- ── 8. inventory is untouched by practice ────────────────────────────────────
do $$
declare mid_practice uuid; mid_real uuid; r jsonb; q int;
begin
  select id into mid_practice from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 103;
  select id into mid_real from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 1;
  perform probe_as('1');  -- home seat, a participant in both

  perform assert_true(matchup_is_practice(mid_practice), '8a practice matchup detected');
  perform assert_true(not matchup_is_practice(mid_real), '8b real matchup detected');

  -- Two items bought for the real season.
  perform bump_inventory('00000000-0000-0000-0000-0000000009f1', 1, 'floodgates', 2);

  -- A practice buy is charged to the PRACTICE purse (0115) and mints nothing real…
  r := wallet_buy_powerup(mid_practice, 'floodgates');
  perform assert_ok(r, '8c practice buy allowed');
  perform assert_eq((r ->> 'charged')::numeric, powerup_price('floodgates'), '8d practice buy costs real price');
  perform assert_true((r ->> 'practice')::boolean, '8d2 flagged as practice');
  perform assert_eq((r ->> 'balance')::numeric, practice_budget() - powerup_price('floodgates'),
    '8d3 balance reported is the practice purse');
  perform assert_true((select coins from team_wallet where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 1) = 65,
    '8d4 the SEASON wallet is untouched by a practice buy');
  select qty into q from team_inventory where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 1 and powerup_id = 'floodgates';
  perform assert_eq(q, 2, '8e practice buy added no real inventory');

  -- …and arming one in practice burns nothing.
  perform consume_inventory(mid_practice, 'floodgates');
  select qty into q from team_inventory where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 1 and powerup_id = 'floodgates';
  perform assert_eq(q, 2, '8f practice arm consumed no real inventory');

  -- The real week still behaves exactly as before.
  perform consume_inventory(mid_real, 'floodgates');
  select qty into q from team_inventory where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 1 and powerup_id = 'floodgates';
  perform assert_eq(q, 1, '8g real arm consumed inventory');
end $$;

-- ── 8b. a practice week accepts every slot ITS BOARD renders (0118) ─────────
-- The preseason slot rule puts 10-11 slots on a practice board while the season's
-- cap is 8. Reported live as "the second preseason week only keeps 8 of the picks
-- I made": the board renders every slot as fillable, the autosave sends the whole
-- lineup as ONE upsert, and the trigger rejects the entire batch — so the manager
-- keeps whatever the last 8-pick save held. If the board offers a slot, the server
-- has to take it.
do $$
declare mid_practice uuid; mid_real uuid; i int;
begin
  select id into mid_practice from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 103;
  select id into mid_real from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 1;
  perform probe_as('1');

  -- 11 — what PRE 3 actually derives — must land on a practice week.
  for i in 1..11 loop
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid_practice, '00000000-0000-0000-0000-000000000101', 'w' || i, 's' || i, 'player-' || i);
  end loop;
  perform assert_eq((select count(*) from sealed_pick where matchup_id = mid_practice), 11,
    '8h eleven practice picks accepted — the whole PRE 3 board');
  perform assert_true(practice_slot_cap() >= 11, '8h2 the cap clears what the board renders');

  -- Still bounded: the cap is generous, not absent.
  for i in 12..practice_slot_cap() loop
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid_practice, '00000000-0000-0000-0000-000000000101', 'w' || i, 's' || i, 'player-' || i);
  end loop;
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid_practice, '00000000-0000-0000-0000-000000000101', 'wOver', 'sOver', 'player-over');
    raise exception 'PROBE FAIL 8i — a pick past practice_slot_cap() was accepted';
  exception when check_violation then null;
  end;

  -- The REGULAR season is untouched: 8 in, the 9th refused without an extra slot.
  for i in 1..8 loop
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid_real, '00000000-0000-0000-0000-000000000101', 'w' || i, 's' || i, 'player-' || i);
  end loop;
  perform assert_eq((select count(*) from sealed_pick where matchup_id = mid_real), 8, '8j eight real picks accepted');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid_real, '00000000-0000-0000-0000-000000000101', 'w9', 's9', 'player-9');
    raise exception 'PROBE FAIL 8k — a 9th real-week pick was accepted without an extra slot';
  exception when check_violation then null;
  end;
end $$;

-- ── 9. turning practice off removes the weeks entirely ───────────────────────
do $$
declare n int; bal numeric;
begin
  perform probe_as('1');
  perform assert_ok(set_preseason_practice('00000000-0000-0000-0000-0000000009f1', false), '9a commish closes practice');
  select count(*) into n from matchup
    where league_id = '00000000-0000-0000-0000-0000000009f1' and week = any(preseason_board_weeks());
  perform assert_eq(n, 0, '9b practice matchups gone');
  select count(*) into n from sleeper_lineup
    where league_id = '00000000-0000-0000-0000-0000000009f1' and week = any(preseason_board_weeks());
  perform assert_eq(n, 0, '9c practice lineups gone');
  perform assert_true((select preseason_at from league where id = '00000000-0000-0000-0000-0000000009f1') is null, '9d stamp cleared');
  -- The practice purse is throwaway too: it dies with the weeks it belonged to,
  -- so no practice balance can outlive its week into the season.
  select count(*) into n from practice_wallet where league_id = '00000000-0000-0000-0000-0000000009f1';
  perform assert_eq(n, 0, '9f practice purse wiped with the weeks');
  -- Nothing the practice weeks did survived them.
  select coins into bal from team_wallet where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 1;
  perform assert_eq(bal, 65, '9e wallet holds only real-week coin (40 earned + 25 budget)');
end $$;

-- ── 10. an UNSYNCED league opens practice fine (0114) ───────────────────────
-- The headline of 0114: practice used to demand a schedule, which is exactly what
-- a league mid-draft doesn't have — the moment practice is most wanted. Seats are
-- the only requirement now.
do $$
declare lid uuid := '00000000-0000-0000-0000-0000000009f2'; r jsonb; n int;
begin
  insert into league (id, sleeper_league_id, season, name, commissioner_id)
  values (lid, 'PRESEASON-PROBE-2', '2026', 'Mid-draft League', '00000000-0000-0000-0000-000000000101');
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name)
    select lid, g, null, false, 'Team ' || g from generate_series(1, 12) g;
  -- No matchup rows, no sleeper_lineup rows: nothing has been synced or drafted.
  perform probe_as('1');
  r := set_preseason_practice(lid, true);
  perform assert_ok(r, '10a unsynced league opens practice');
  select count(*) into n from matchup where league_id = lid and week = 102;
  perform assert_eq(n, 6, '10b twelve seats paired into six matchups');
  perform assert_true((r -> 'weeks') @> '104'::jsonb, '10c week 104 built too');
  perform assert_ok(set_preseason_practice(lid, false), '10d cleanup');
end $$;

select 'ALL PRESEASON PRACTICE PROBES PASS' as result;
