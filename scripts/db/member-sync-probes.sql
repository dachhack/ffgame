-- 0133 probes: members sync themselves (the claim-flow self-heal).
--
-- The stakes: _upsert_membership_rows is now the ONE write path for member
-- lists — the commissioner's button, the worker's sweep, and the worker's
-- import all land here. If its guards slip, a routine background sync could
-- unlink an enrolled manager; if its grants slip, any signed-in user could
-- rewrite a league's roster→owner mapping and seat themselves anywhere. And
-- the poke path is what turns "it says im not in the league" from a dead end
-- into a sub-minute wait, so the due/stamp plumbing has to actually converge.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000201', 'commish@test.dev'),
  ('00000000-0000-0000-0000-000000000202', 'seated@test.dev'),
  ('00000000-0000-0000-0000-000000000203', 'late@test.dev')
on conflict (id) do nothing;
insert into app_user (id, email, sleeper_user_id, sleeper_username) values
  ('00000000-0000-0000-0000-000000000201', 'commish@test.dev', 'SL-COMMISH', 'commish'),
  ('00000000-0000-0000-0000-000000000202', 'seated@test.dev',  'SL-SEATED',  'seated'),
  ('00000000-0000-0000-0000-000000000203', 'late@test.dev',    'SL-LATE',    'latejoiner')
on conflict (id) do nothing;

-- A sleeper-provider league whose member list predates a join, plus a native
-- league (no upstream to sync) and a stale prior-season league.
insert into league (id, sleeper_league_id, season, name, provider, commissioner_id) values
  ('00000000-0000-0000-0000-000000000af1', 'MEMBER-SYNC-PROBE', '2026', 'Member Sync Probe', 'sleeper', '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000af2', 'MEMBER-SYNC-NATIVE', '2026', 'Native No-Sync', 'native', '00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000af3', 'MEMBER-SYNC-OLD', '2025', 'Last Season', 'sleeper', '00000000-0000-0000-0000-000000000201');
insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name) values
  ('00000000-0000-0000-0000-000000000af1', 1, 'SL-SEATED', '00000000-0000-0000-0000-000000000202', true, 'Seated Squad'),
  ('00000000-0000-0000-0000-000000000af1', 2, 'SL-GHOST', null, false, 'Roster 2');

do $$
declare r jsonb; lid uuid := '00000000-0000-0000-0000-000000000af1'; stamp timestamptz; code text;
begin
  select invite_code into code from league where id = lid;

  -- ── 1. the grants: the chokepoint and the worker helpers are worker-only ──
  perform assert_true(not has_function_privilege('authenticated', '_upsert_membership_rows(uuid, jsonb)', 'execute'),
    '1a _upsert_membership_rows not callable by authenticated');
  perform assert_true(not has_function_privilege('authenticated', 'member_sync_due(int, text)', 'execute'),
    '1b member_sync_due not callable by authenticated');
  perform assert_true(not has_function_privilege('authenticated', 'member_sync_touch(uuid)', 'execute'),
    '1c member_sync_touch not callable by authenticated');
  perform assert_true(has_function_privilege('service_role', '_upsert_membership_rows(uuid, jsonb)', 'execute'),
    '1d worker can call the chokepoint');

  -- ── 2. the commissioner shell still gates ──
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000203', false); -- not the commish
  perform set_config('app.email', 'late@test.dev', false);
  perform assert_err(admin_upsert_memberships(lid, '[]'::jsonb), 'forbidden', '2a non-commish refused');
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000201', false); -- the commish
  perform set_config('app.email', 'commish@test.dev', false);
  perform assert_true(coalesce((admin_upsert_memberships(lid, '[]'::jsonb) ->> 'ok')::boolean, false),
    '2b commish allowed through the shell');

  -- ── 3. the chokepoint's guards — the 0105 semantics, now load-bearing for
  --       every sync path. Simulate the worker re-pulling a member list where
  --       seat 1's owner didn't resolve to an app_user this time.
  r := _upsert_membership_rows(lid, jsonb_build_array(
    jsonb_build_object('roster_id', 1, 'owner_id', 'SL-SEATED', 'team_name', 'Seated Squad Renamed'),
    jsonb_build_object('roster_id', 2, 'owner_id', 'SL-GHOST',  'team_name', 'Roster 2'),
    jsonb_build_object('roster_id', 3, 'owner_id', 'SL-LATE',   'team_name', 'Late Arrivals')
  ));
  perform assert_true(coalesce((r ->> 'ok')::boolean, false), '3a upsert ok');
  perform assert_true((select app_user_id from league_membership where league_id = lid and sleeper_roster_id = 1)
    = '00000000-0000-0000-0000-000000000202', '3b existing link never clobbered');
  perform assert_true((select enrolled from league_membership where league_id = lid and sleeper_roster_id = 1),
    '3c enrolled never goes true→false');
  perform assert_true((select team_name from league_membership where league_id = lid and sleeper_roster_id = 1)
    = 'Seated Squad Renamed', '3d team name does refresh');
  -- The just-joined manager: new row, auto-linked + enrolled because an
  -- app_user already carries that sleeper id (they signed in before claiming).
  perform assert_true((select app_user_id from league_membership where league_id = lid and sleeper_roster_id = 3)
    = '00000000-0000-0000-0000-000000000203', '3e new seat auto-links by sleeper id');
  perform assert_true((select enrolled from league_membership where league_id = lid and sleeper_roster_id = 3),
    '3f auto-linked seat is enrolled');
  perform assert_true((select member_synced_at from league where id = lid) is not null,
    '3g sync stamps the league clock');

  -- ── 4. the poke: request_member_sync ──
  perform assert_err(request_member_sync('ZZZZZZZZ'), 'invalid code', '4a unknown code');
  perform assert_err(request_member_sync((select invite_code from league where id = '00000000-0000-0000-0000-000000000af2')),
    'not a Sleeper league', '4b native league has no upstream to sync');
  perform set_config('app.uid', '', false);
  perform assert_err(request_member_sync(code), 'not signed in', '4c signed-out refused');
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000203', false);
  r := request_member_sync(code);
  perform assert_true(coalesce((r ->> 'ok')::boolean, false), '4d any signed-in code holder may poke');
  select member_sync_requested_at into stamp from league where id = lid;
  perform assert_true(stamp is not null, '4e poke stamps the request');
  perform request_member_sync(code); -- immediate second poke
  perform assert_true((select member_sync_requested_at from league where id = lid) = stamp,
    '4f rate limit: a stampede of joiners collapses into one standing request');

  -- ── 5. member_sync_due: what the worker picks up ──
  -- Probe artifact: now() is frozen per transaction, so the 3g sync stamp and
  -- the 4d poke landed on the SAME instant here — in production they're
  -- separate transactions and the poke is strictly newer. Recreate that order.
  update league set member_synced_at = member_synced_at - interval '1 second' where id = lid;
  -- Poked league is due (request newer than the sync stamp).
  perform assert_true(exists (select 1 from member_sync_due(999999, '2026') d where d.league_id = lid),
    '5a poked league is due');
  perform assert_true((select d.sleeper_league_id from member_sync_due(999999, '2026') d where d.league_id = lid)
    = 'MEMBER-SYNC-PROBE', '5b due row carries the Sleeper id the worker fetches by');
  -- Native league: never due, poked or not.
  perform assert_true(not exists (select 1 from member_sync_due(0, '2026') d
    where d.league_id = '00000000-0000-0000-0000-000000000af2'), '5c native league never due');
  -- A sync consumes the poke: stamp the clock (what the worker does) and the
  -- league drops out of the due list.
  perform _upsert_membership_rows(lid, '[]'::jsonb);
  perform assert_true(not exists (select 1 from member_sync_due(999999, '2026') d where d.league_id = lid),
    '5d fresh sync clears the due flag');
  -- The safety net: current-season leagues age back in; other seasons don't.
  update league set member_synced_at = now() - interval '2 hours'
    where id in (lid, '00000000-0000-0000-0000-000000000af3');
  perform assert_true(exists (select 1 from member_sync_due(60, '2026') d where d.league_id = lid),
    '5e stale current-season league is due');
  perform assert_true(not exists (select 1 from member_sync_due(60, '2026') d
    where d.league_id = '00000000-0000-0000-0000-000000000af3'), '5f old season never ages back in');
  -- But a poke reaches an old season too (a claimant is a claimant).
  update league set member_sync_requested_at = now() where id = '00000000-0000-0000-0000-000000000af3';
  perform assert_true(exists (select 1 from member_sync_due(60, '2026') d
    where d.league_id = '00000000-0000-0000-0000-000000000af3'), '5g poked old-season league is due');
  -- Failure back-off: touch stamps without writing members.
  perform member_sync_touch('00000000-0000-0000-0000-000000000af3');
  perform assert_true(not exists (select 1 from member_sync_due(60, '2026') d
    where d.league_id = '00000000-0000-0000-0000-000000000af3'), '5h touch backs a failing league off');

  -- ── 6. end to end: the exact bounce from the league chat, healed ──
  -- A manager joins on Sleeper AFTER the last sync; their claim bounces; the
  -- worker's pull lands their seat; the same claim then goes through.
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000203', false);
  perform assert_err(redeem_preview(code, 'SL-NEWEST'), 'not a manager in this league',
    '6a pre-sync claim bounces (the bug report)');
  perform _upsert_membership_rows(lid, jsonb_build_array(
    jsonb_build_object('roster_id', 4, 'owner_id', 'SL-NEWEST', 'team_name', 'Fresh Off Sleeper')));
  r := redeem_preview(code, 'SL-NEWEST');
  perform assert_true(coalesce((r ->> 'ok')::boolean, false), '6b post-sync claim previews');
  perform assert_true(r ->> 'team' = 'Fresh Off Sleeper', '6c and lands on the right seat');
  r := redeem_invite(code, 'SL-NEWEST', 'newestjoiner');
  perform assert_true(coalesce((r ->> 'ok')::boolean, false), '6d redeem seats them');
  perform assert_true((select enrolled from league_membership where league_id = lid and sleeper_roster_id = 4),
    '6e enrolled for real');
end $$;

select 'ALL MEMBER-SYNC PROBES PASSED' as result;
