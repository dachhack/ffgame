-- 0136 probes: the per-league week lock switch (admin_set_week_lock) and its
-- plumbing. The stakes: UNLOCK reopens a week mid-slate — if its guards slip it
-- could reanimate finished matchups or leak into other leagues' weeks; if LOCK
-- forgot the NULL semantics a relocked week would seal at the wrong time.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000301', 'lockadmin@test.dev'),
  ('00000000-0000-0000-0000-000000000302', 'lockuser@test.dev')
on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000000301', 'lockadmin@test.dev'),
  ('00000000-0000-0000-0000-000000000302', 'lockuser@test.dev')
on conflict (id) do nothing;
insert into app_admin (email, note) values ('lockadmin@test.dev', 'probe admin') on conflict (email) do nothing;

insert into league (id, sleeper_league_id, season, name, commissioner_id) values
  ('00000000-0000-0000-0000-000000000bf1', 'LOCK-PROBE-A', '2026', 'Lock Probe A', '00000000-0000-0000-0000-000000000301'),
  ('00000000-0000-0000-0000-000000000bf2', 'LOCK-PROBE-B', '2026', 'Lock Probe B', '00000000-0000-0000-0000-000000000301');
insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at) values
  ('00000000-0000-0000-0000-000000000bf1', 7, 1, 2, 'live',      now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000bf1', 7, 3, 4, 'scheduled', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000bf1', 7, 5, 6, 'final',     now() - interval '1 hour'),
  ('00000000-0000-0000-0000-000000000bf1', 8, 1, 2, 'scheduled', now() + interval '6 days'),
  ('00000000-0000-0000-0000-000000000bf2', 7, 1, 2, 'live',      now() - interval '1 hour');

do $$
declare a uuid := '00000000-0000-0000-0000-000000000bf1';
        b uuid := '00000000-0000-0000-0000-000000000bf2';
        mid uuid; r jsonb;
begin
  select id into mid from matchup where league_id = a and week = 7 and status = 'live';
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked, revealed_at)
    values (mid, '00000000-0000-0000-0000-000000000302', 'tnf', '0', 'probe-player', 'ppr', true, now());

  -- w1. not a super-admin call → refused, nothing moves
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000302', false);
  perform set_config('app.email', 'lockuser@test.dev', false);
  perform assert_true(coalesce((admin_set_week_lock(a, 7, false) ->> 'ok')::boolean, true) = false,
    'w1 non-admin refused');
  perform assert_true((select count(*) from week_lock_hold) = 0, 'w1 no hold appeared');

  -- w2. UNLOCK: hold recorded, live matchup reopened, pick unsealed…
  perform set_config('app.email', 'lockadmin@test.dev', false);
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000301', false);
  r := admin_set_week_lock(a, 7, false);
  perform assert_true(coalesce((r ->> 'ok')::boolean, false), 'w2 unlock ok');
  perform assert_true(exists (select 1 from week_lock_hold where league_id = a and week = 7), 'w2 hold recorded');
  perform assert_true((select status from matchup where id = mid) = 'scheduled', 'w2 live matchup reopened');
  perform assert_true((select lock_at from matchup where id = mid) >= '2098-01-01', 'w2 lock_at far-future');
  perform assert_true(not (select locked from sealed_pick where matchup_id = mid), 'w2 pick unsealed');
  perform assert_true((select revealed_at from sealed_pick where matchup_id = mid) is null, 'w2 pick unrevealed');

  -- w3. …but the blast radius stops at (league, week)
  perform assert_true((select status from matchup where league_id = a and week = 7 and home_roster_id = 5) = 'final',
    'w3 final matchup left alone');
  perform assert_true((select lock_at from matchup where league_id = a and week = 8) < '2098-01-01',
    'w3 other week untouched');
  perform assert_true((select status from matchup where league_id = b and week = 7) = 'live',
    'w3 other league untouched');

  -- w4. the peephole shows the pair to any signed-in client
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000302', false);
  perform assert_true(lock_holds() @> jsonb_build_array(jsonb_build_object('league_id', a, 'week', 7)),
    'w4 lock_holds() lists the pair');
  perform assert_true(has_function_privilege('authenticated', 'lock_holds()', 'execute'), 'w4 grant');

  -- w5. the trigger honors the hold for this league only: an edit to a pick in
  -- league B week 7 (no hold, kicked off per slate = none loaded → k null →
  -- allowed) — instead prove the held path directly: editing the held pick works.
  update sealed_pick set player_slug = 'probe-player-2' where matchup_id = mid;
  perform assert_true((select player_slug from sealed_pick where matchup_id = mid) = 'probe-player-2',
    'w5 held week accepts edits through the trigger');

  -- w6. LOCK: hold gone, lock_at NULLed for the worker's backfill to restore
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000301', false);
  r := admin_set_week_lock(a, 7, true);
  perform assert_true(coalesce((r ->> 'ok')::boolean, false), 'w6 lock ok');
  perform assert_true(not exists (select 1 from week_lock_hold where league_id = a and week = 7), 'w6 hold released');
  perform assert_true((select lock_at from matchup where id = mid) is null, 'w6 lock_at NULL for natural backfill');
  perform assert_true((select lock_at from matchup where league_id = a and week = 8) is not null, 'w6 other week keeps its lock_at');

  -- w7. unknown league is a calm error
  perform assert_true(coalesce((admin_set_week_lock(gen_random_uuid(), 1, false) ->> 'ok')::boolean, true) = false,
    'w7 unknown league refused');
end $$;

select 'ALL LOCK-HOLD PROBES PASSED' as result;
