-- 0110 preseason-practice probes. Run with ON_ERROR_STOP; every failed assertion
-- raises. Companion suite to native-league-probes.sql, driven by the same
-- scratch-DB harness (scripts/db/run-scratch-probes.sh).
--
-- What this pins down: preseason board weeks (101-103) are THROWAWAY — they never
-- move real coin, real inventory, or a real record — and a league's commissioner
-- (not just a super-admin) can open and close practice.
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
-- The Week-1 pairing the practice clone copies.
insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
values ('00000000-0000-0000-0000-0000000009f1', 1, 1, 2, 'scheduled');
-- A preseason slate row so the pool seeder has teams (week 101).
insert into nfl_slate (season, week, home, away, win, kickoff)
values ('2026', 101, 'ARI', 'CAR', 'tnf', '2026-08-07T00:00Z') on conflict do nothing;

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
  -- One per preseason board week — four of them for 2026 (0112), read from the
  -- helper so extending the preseason never silently under-asserts here.
  select count(*) into n from matchup
    where league_id = '00000000-0000-0000-0000-0000000009f1' and week = any(preseason_board_weeks());
  perform assert_eq(n, array_length(preseason_board_weeks(), 1), '2e one cloned matchup per preseason week');
  perform assert_true(101 = any(preseason_board_weeks()) and 104 = any(preseason_board_weeks()), '2f weeks 101-104 in range');
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
  perform assert_err(seed_preseason_pool('00000000-0000-0000-0000-0000000009f1', 101, '[]'::jsonb),
    'non-empty array', '3b empty pool refused');
  r := seed_preseason_pool('00000000-0000-0000-0000-0000000009f1', 101,
    '[{"slot":0,"player_slug":"kyler-murray","pos":"QB","team":"ARI"}]'::jsonb);
  perform assert_ok(r, '3c commish seeds the pool');
  perform assert_eq((r ->> 'seats')::numeric, 2, '3d every seat got the pool');
  select count(*) into n from sleeper_lineup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 101;
  perform assert_eq(n, 2, '3e two lineup rows at week 101');

  perform probe_as('3');
  perform assert_err(seed_preseason_pool('00000000-0000-0000-0000-0000000009f1', 101, '[{"slot":0}]'::jsonb),
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

  -- Spending is FREE in practice, and free even at zero balance — a broke team
  -- must still be able to exercise the whole board.
  r := spend_from_wallet('00000000-0000-0000-0000-0000000009f1', 2, 85, null, 101, 'spend:floodgates', null);
  perform assert_ok(r, '5i practice spend allowed at 0 balance');
  perform assert_eq((r ->> 'charged')::numeric, 0, '5j practice spend charged nothing');
  perform assert_true((select coins from team_wallet where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 2) is null,
    '5k practice spend never opened a wallet');
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
    where league_id = '00000000-0000-0000-0000-0000000009f1' and week in (101, 102);

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
  select id into mid_practice from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 101;
  select id into mid_real from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 1;
  perform probe_as('1');  -- home seat, a participant in both

  perform assert_true(matchup_is_practice(mid_practice), '8a practice matchup detected');
  perform assert_true(not matchup_is_practice(mid_real), '8b real matchup detected');

  -- Two items bought for the real season.
  perform bump_inventory('00000000-0000-0000-0000-0000000009f1', 1, 'floodgates', 2);

  -- A free practice buy mints nothing…
  r := wallet_buy_powerup(mid_practice, 'floodgates');
  perform assert_ok(r, '8c practice buy allowed');
  perform assert_eq((r ->> 'charged')::numeric, 0, '8d practice buy free');
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

-- ── 8b. practice grants the extra slots for free (0111) ──────────────────────
-- Preseason week 3 derives 10 slots across 9 windows against a base cap of 8, so
-- without the grant a player can't fill their own board — and can't even field
-- one player per window, handing the opponent a free +5 window-win bonus.
do $$
declare mid_practice uuid; mid_real uuid; i int;
begin
  select id into mid_practice from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 103;
  select id into mid_real from matchup where league_id = '00000000-0000-0000-0000-0000000009f1' and week = 1;
  perform probe_as('1');

  -- 10 filled picks land on a practice week (8 base + the 2 granted).
  for i in 1..10 loop
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid_practice, '00000000-0000-0000-0000-000000000101', 'w' || i, 's' || i, 'player-' || i);
  end loop;
  perform assert_eq((select count(*) from sealed_pick where matchup_id = mid_practice), 10, '8h ten practice picks accepted');

  -- The 11th is still refused — the grant is a ceiling, not an opt-out.
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid_practice, '00000000-0000-0000-0000-000000000101', 'w11', 's11', 'player-11');
    raise exception 'PROBE FAIL 8i — an 11th practice pick was accepted';
  exception when check_violation then null;
  end;

  -- A REAL week is untouched: 8 in, the 9th refused.
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
  -- Nothing the practice weeks did survived them.
  select coins into bal from team_wallet where league_id = '00000000-0000-0000-0000-0000000009f1' and roster_id = 1;
  perform assert_eq(bal, 65, '9e wallet holds only real-week coin (40 earned + 25 budget)');
end $$;

-- ── 10. a league with no Week 1 can't be cloned into silence ─────────────────
do $$
begin
  insert into league (id, sleeper_league_id, season, name, commissioner_id)
  values ('00000000-0000-0000-0000-0000000009f2', 'PRESEASON-PROBE-2', '2026', 'Unsynced League',
          '00000000-0000-0000-0000-000000000101');
  perform probe_as('1');
  perform assert_err(set_preseason_practice('00000000-0000-0000-0000-0000000009f2', true),
    'sync the season first', '10a unsynced league told why');
end $$;

select 'ALL PRESEASON PRACTICE PROBES PASS' as result;
