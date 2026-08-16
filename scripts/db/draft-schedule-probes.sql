-- 0177 scheduled-draft-start probes.
--
-- What must hold:
--   • set_draft_start is commissioner-only, pending-only, refuses the PAST
--     (a mistyped year must not launch the draft on save) and absurd futures;
--   • null disarms;
--   • draft_autostart_sweep starts exactly the drafts whose time has come, and
--     leaves the future ones alone;
--   • a start that CAN'T succeed (unseeded pool) is reported, not half-done,
--     and retries on a later sweep once the blocker clears;
--   • but a schedule more than 2 days stale is abandoned rather than
--     detonating into an empty room;
--   • start_draft still behaves exactly as it did after the refactor into
--     _start_draft_now (auth, pre-set order, and the freeze);
--   • draft_state carries start_at so the countdown is the poll everyone
--     already makes.
\set QUIET on
\pset pager off

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
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- a pool big enough for a 4-team, 7-round draft
create or replace function probe_seed_pool(lid uuid, tag text) returns void language plpgsql as $$
begin
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', tag || '-p' || g, 'full', 'P ' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 40) g));
end $$;

do $$
declare r jsonb; lid uuid; lid2 uuid; code text; st jsonb;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Scheduled League', '2026', 4, 7, 60);
  perform assert_ok(r, 'sc0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'SC-C'), 'sc0a c joins');

  -- permissions
  perform assert_err(set_draft_start(lid, now() + interval '1 day'), 'commissioner only', 'sc1 member refused');

  perform probe_as('b');
  -- validation: the past is refused rather than fired
  perform assert_err(set_draft_start(lid, now() - interval '1 minute'), 'in the future', 'sc2 past refused');
  perform assert_err(set_draft_start(lid, now() - interval '3 years'), 'in the future', 'sc2a mistyped year refused');
  perform assert_err(set_draft_start(lid, now() + interval '2 years'), 'more than a year', 'sc2b absurd future refused');
  perform assert_true((select start_at from draft where league_id = lid) is null, 'sc2c nothing stored by a refusal');

  -- arm, read back through the poll everyone already makes, disarm
  r := set_draft_start(lid, now() + interval '3 hours');
  perform assert_ok(r, 'sc3 arms');
  perform assert_true((select start_at from draft where league_id = lid) is not null, 'sc3a stored');
  st := draft_state(lid);
  perform assert_true((st ->> 'start_at') is not null, 'sc3b draft_state carries it');
  perform assert_ok(set_draft_start(lid, null), 'sc4 disarms');
  perform assert_true((select start_at from draft where league_id = lid) is null, 'sc4a cleared');

  -- ── THE SWEEP ────────────────────────────────────────────────────────────
  perform probe_seed_pool(lid, 'sc');
  -- a FUTURE schedule is left strictly alone
  perform assert_ok(set_draft_start(lid, now() + interval '3 hours'), 'sc5 arm for later');
  r := draft_autostart_sweep();
  perform assert_ok(r, 'sc5a sweep runs');
  perform assert_true((r ->> 'started')::int = 0, 'sc5b nothing started early');
  perform assert_true((select status from draft where league_id = lid) = 'pending', 'sc5c still pending');

  -- its time comes (set directly: set_draft_start rightly refuses the past)
  reset role;
  update draft set start_at = now() - interval '1 minute' where league_id = lid;
  set local role authenticated;
  r := draft_autostart_sweep();
  perform assert_true((r ->> 'started')::int = 1, 'sc6 the sweep started it');
  perform assert_true((select status from draft where league_id = lid) = 'live', 'sc6a draft is live');
  perform assert_true((select draft_order from draft where league_id = lid) is not null, 'sc6b order drawn');
  perform assert_true((select deadline_at from draft where league_id = lid) is not null, 'sc6c clock running');
  -- start_at is KEPT: status already takes the row out of scope, and the
  -- league can still see what it was scheduled for
  perform assert_true((select start_at from draft where league_id = lid) is not null, 'sc6d schedule preserved');
  -- and a second sweep does not double-start
  r := draft_autostart_sweep();
  perform assert_true((r ->> 'started')::int = 0, 'sc6e idempotent — nothing to start twice');
  -- the schedule is frozen now, like every other pre-draft setting
  perform probe_as('b');
  perform assert_err(set_draft_start(lid, now() + interval '1 day'), 'already started', 'sc7 frozen after start');

  -- ── A START THAT CANNOT SUCCEED ──────────────────────────────────────────
  -- armed, time reached, but no player pool: reported as failed, NOT
  -- half-started, and it retries once the blocker clears.
  r := create_native_league('Unseeded League', '2026', 4, 7, 60);
  perform assert_ok(r, 'sc8 create');
  lid2 := (r ->> 'league_id')::uuid;
  reset role;
  update draft set start_at = now() - interval '1 minute' where league_id = lid2;
  set local role authenticated;
  r := draft_autostart_sweep();
  perform assert_true((r ->> 'failed')::int = 1, 'sc8a reported as failed');
  perform assert_true(r -> 'errors' -> 0 ->> 'error' = 'player pool not seeded', 'sc8b with the reason');
  perform assert_true((select status from draft where league_id = lid2) = 'pending', 'sc8c still pending, not half-started');
  -- clear the blocker → the very next sweep starts it
  perform probe_as('b');
  perform probe_seed_pool(lid2, 'us');
  r := draft_autostart_sweep();
  perform assert_true((r ->> 'started')::int = 1, 'sc8d retried and started once the pool existed');

  -- ── STALE SCHEDULES ARE ABANDONED ────────────────────────────────────────
  -- The scenario the 2-day window exists for: a league schedules, the start
  -- fails, everyone moves on, and weeks later something seeds a pool. Without
  -- the window the draft would detonate into an empty room.
  r := create_native_league('Forgotten League', '2026', 4, 7, 60);
  perform assert_ok(r, 'sc9 create');
  lid2 := (r ->> 'league_id')::uuid;
  perform probe_seed_pool(lid2, 'fg');
  reset role;
  update draft set start_at = now() - interval '9 days' where league_id = lid2;
  set local role authenticated;
  perform probe_as('b');
  r := draft_autostart_sweep();
  perform assert_true((r ->> 'started')::int = 0, 'sc9a a 9-day-stale schedule does NOT fire');
  perform assert_true((select status from draft where league_id = lid2) = 'pending', 'sc9b still pending');
  -- …and the commissioner can still start it by hand, which is the fallback
  perform assert_ok(start_draft(lid2), 'sc9c manual start still works');

  -- ── THE REFACTOR DIDN'T CHANGE start_draft ───────────────────────────────
  r := create_native_league('Refactor Check', '2026', 4, 7, 60);
  perform assert_ok(r, 'sc10 create');
  lid2 := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_seed_pool(lid2, 'rf');
  perform assert_ok(set_draft_order(lid2, '[4,3,2,1]'::jsonb), 'sc10a pre-set order (0176)');
  perform probe_as('c');
  perform assert_err(start_draft(lid2), 'forbidden', 'sc10b still commissioner-gated after the refactor');
  perform probe_as('b');
  r := start_draft(lid2);
  perform assert_ok(r, 'sc10c starts');
  perform assert_true(r -> 'order' = '[4,3,2,1]'::jsonb, 'sc10d and still honours the pre-set order');
  perform assert_true((r ->> 'preset')::boolean, 'sc10e reporting preset as before');
  perform assert_err(start_draft(lid2), 'already started', 'sc10f and refuses a second start');
end $$;

select 'ALL DRAFT-SCHEDULE PROBES PASSED' as status;
