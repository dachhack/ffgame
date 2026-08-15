-- 0153 draft-night probes: the settable overnight pause.
--
-- What must hold:
--   • the commissioner sets and clears quiet hours; a member is refused;
--   • half-set bounds and equal bounds are refused;
--   • a LIVE draft's running clock is RE-BASED under the new hours — the
--     remaining wall time is preserved and pushed through awake_deadline, so
--     a deadline that would have expired inside the new quiet window lands
--     after it instead (no 3am autopick the night the pause was set);
--   • a complete draft refuses.
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
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; ns int; ne int; dl timestamptz;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Night League', '2026', 4, 7, 60);
  perform assert_ok(r, 'nd0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'ND-C'), 'nd1 c joins');

  set local role authenticated;

  -- validation + gate
  perform probe_as('c');
  perform assert_err(set_draft_night(lid, 1320, 600), 'commissioner', 'nd2 member refused');
  perform probe_as('b');
  perform assert_err(set_draft_night(lid, 1320, null), 'both a start and an end', 'nd3 half-set refused');
  perform assert_err(set_draft_night(lid, 700, 700), 'two different times', 'nd4 equal bounds refused');
  perform assert_err(set_draft_night(lid, 2000, 600), 'two different times', 'nd5 out-of-range refused');

  -- pending draft: set + clear both land
  perform assert_ok(set_draft_night(lid, 1320, 600), 'nd6 commish sets 22:00–10:00');
  reset role;
  perform assert_true(
    (select night_start_min = 1320 and night_end_min = 600 from draft where league_id = lid),
    'nd7 hours stored');
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_draft_night(lid), 'nd8 clear');
  reset role;
  perform assert_true(
    (select night_start_min is null and night_end_min is null from draft where league_id = lid),
    'nd9 cleared');

  -- LIVE re-base: fixture the draft live with a 2h clock, then set a quiet
  -- window opening 30 awake-minutes from now and lasting 5h — the re-based
  -- deadline must land well past the naive 2h mark.
  update draft set status = 'live', paused = false, draft_order = '[1,2]'::jsonb,
    current_overall = 1, deadline_at = now() + interval '2 hours'
    where league_id = lid;
  ns := (et_minutes(now()) + 30) % 1440;
  ne := (et_minutes(now()) + 330) % 1440;
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_draft_night(lid, ns, ne), 'nd10 set on a live draft');
  reset role;
  select deadline_at into dl from draft where league_id = lid;
  perform assert_true(dl > now() + interval '6 hours',
    'nd11 running clock re-based past the quiet window (got ' || dl::text || ')');

  -- complete refuses
  update draft set status = 'complete' where league_id = lid;
  set local role authenticated;
  perform probe_as('b');
  perform assert_err(set_draft_night(lid, 1320, 600), 'complete', 'nd12 complete refuses');
  reset role;
end $$;

select 'ALL DRAFT-NIGHT PROBES PASSED' as result;
