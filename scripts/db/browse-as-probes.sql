-- 0149 browse-as probes: the admin twins for the player path.
--
-- What must hold:
--   • admin_user_teams(u) returns U's enrolled seats — not the caller's;
--   • admin_user_waitlist(u) answers for U (empty here — shape + gate);
--   • both refuse non-admins.
-- ('a' is the shared scratch DB's probe ADMIN from earlier suites.)
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

-- ── 0. fixture: b commissions, c joins (fresh league for this suite) ────────
do $$
declare r jsonb; lid uuid; code text;
begin
  insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Browse As League', '2026', 4, 7, 60);
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL ba0 create — %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.ba_lid', lid::text, false);
  perform probe_as('c');
  r := native_join(code, 'BA-C');
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL ba1 c joins — %', r; end if;
end $$;

-- ── 1. the twins answer for the VIEWED user, admin-gated ────────────────────
do $$
declare lid uuid := current_setting('probe.ba_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('a');   -- the probe admin
  r := admin_user_teams('00000000-0000-0000-0000-00000000000c');
  perform assert_true(jsonb_typeof(r) = 'array', 'ba2 admin gets an array');
  perform assert_true(exists (
      select 1 from jsonb_array_elements(r) e
      where (e ->> 'league_id')::uuid = lid and e ->> 'team_name' = 'BA-C'),
    'ba3 c''s seat listed — the viewed user''s, not the caller''s');
  perform assert_true(not exists (
      select 1 from jsonb_array_elements(admin_user_teams('00000000-0000-0000-0000-00000000000c')) e
      where (e ->> 'pick_user_id')::uuid = '00000000-0000-0000-0000-00000000000a'),
    'ba4 nothing of the admin''s own leaks in');
  r := admin_user_waitlist('00000000-0000-0000-0000-00000000000c');
  perform assert_true(jsonb_typeof(r) = 'array' and jsonb_array_length(r) = 0, 'ba5 waitlist answers (empty) for c');

  perform probe_as('b');   -- commissioner, but NOT an admin
  perform assert_true(admin_user_teams('00000000-0000-0000-0000-00000000000c') ->> 'error' = 'forbidden', 'ba6 non-admin refused (teams)');
  perform assert_true(admin_user_waitlist('00000000-0000-0000-0000-00000000000c') ->> 'error' = 'forbidden', 'ba7 non-admin refused (waitlist)');
  reset role;
end $$;

select 'ALL BROWSE-AS PROBES PASSED' as result;
