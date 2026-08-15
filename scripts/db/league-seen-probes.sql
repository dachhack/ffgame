-- 0151 league-seen probes: presence touch + the commissioner's list.
--
-- What must hold:
--   • a member's open writes a row; re-opening moves last_at forward;
--   • an outsider's touch is a silent no-op (ok, but nothing written);
--   • the commissioner sees every member with a last_at (null = never);
--   • a plain member is refused the list; the admin is not;
--   • the table answers nothing to the caller role directly.
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
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; m jsonb; c_at timestamptz;
begin
  -- fixture: b commissions, c joins, d stays outside
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Seen League', '2026', 4, 7, 60);
  perform assert_ok(r, 'ls0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'LS-C'), 'ls1 c joins');

  set local role authenticated;

  -- c opens the league
  perform probe_as('c');
  r := league_touch(lid);
  perform assert_ok(r, 'ls2 member touch');
  perform assert_true((r ->> 'seen')::boolean, 'ls3 member touch writes');

  -- an outsider's touch answers ok but writes nothing
  perform probe_as('d');
  r := league_touch(lid);
  perform assert_ok(r, 'ls4 outsider touch is calm');
  perform assert_true(not (r ->> 'seen')::boolean, 'ls5 outsider touch writes nothing');

  -- a plain member is refused the list
  perform probe_as('c');
  perform assert_err(league_last_seen(lid), 'commissioner', 'ls6 member refused the list');

  -- the commissioner reads it: c has a timestamp, b (never opened) has null
  perform probe_as('b');
  r := league_last_seen(lid);
  perform assert_ok(r, 'ls7 commish reads');
  select x into m from jsonb_array_elements(r -> 'members') x
    where x ->> 'id' = '00000000-0000-0000-0000-00000000000c';
  perform assert_true(m is not null and m ->> 'last_at' is not null, 'ls8 c seen with a timestamp');
  select x into m from jsonb_array_elements(r -> 'members') x
    where x ->> 'id' = '00000000-0000-0000-0000-00000000000b';
  perform assert_true(m is not null and m ->> 'last_at' is null, 'ls9 b listed as never');

  -- re-touch moves last_at forward (rewind the row as superuser first —
  -- RLS silently no-ops caller-role fixture writes)
  reset role;
  select ls.last_at into c_at from league_seen ls
    where ls.league_id = lid and ls.app_user_id = '00000000-0000-0000-0000-00000000000c';
  update league_seen set last_at = last_at - interval '1 hour'
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000c';
  set local role authenticated;
  perform probe_as('c');
  perform assert_ok(league_touch(lid), 'ls10 re-touch');
  reset role;
  perform assert_true(
    (select ls.last_at from league_seen ls
      where ls.league_id = lid and ls.app_user_id = '00000000-0000-0000-0000-00000000000c') >= c_at - interval '1 minute',
    'ls11 re-touch moved last_at forward');

  -- deny-all: the caller role reads nothing directly
  set local role authenticated;
  perform probe_as('c');
  perform assert_true(not exists (select 1 from league_seen), 'ls12 league_seen closed');
  reset role;
end $$;

select 'ALL LEAGUE-SEEN PROBES PASSED' as result;
