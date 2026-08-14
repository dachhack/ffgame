-- 0150 push probes: token registry + prefs, RPC-only access.
--
-- What must hold:
--   • register upserts BY TOKEN and moves a token between accounts (a phone
--     that switches users must stop notifying the old one);
--   • prefs sanitize to the four known boolean keys;
--   • remove and set_push_prefs bite only the caller's own token;
--   • the tables answer nothing to the caller role directly (worker-only).
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

do $$
declare r jsonb; tk jsonb;
begin
  insert into auth.users (id, email) values
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;

  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(register_push_token('device-token-abc123', 'android', '{"lineup": false, "junk": true, "chat": "yes"}'::jsonb), 'pu0 register');
  tk := my_push_tokens();
  perform assert_true(jsonb_array_length(tk) = 1, 'pu1 one token listed');
  perform assert_true(tk -> 0 -> 'prefs' = '{"lineup": false}'::jsonb, 'pu2 prefs sanitized to known booleans');

  -- re-register with no prefs keeps the stored prefs
  perform assert_ok(register_push_token('device-token-abc123'), 'pu3 re-register');
  perform assert_true(my_push_tokens() -> 0 -> 'prefs' = '{"lineup": false}'::jsonb, 'pu4 prefs survive re-register');

  perform assert_ok(set_push_prefs('device-token-abc123', '{"chat": false, "lineup": true}'::jsonb), 'pu5 set prefs');
  perform assert_true(my_push_tokens() -> 0 -> 'prefs' = '{"chat": false, "lineup": true}'::jsonb, 'pu6 prefs replaced');

  -- the same phone signs into another account: the token MOVES
  perform probe_as('c');
  perform assert_ok(register_push_token('device-token-abc123'), 'pu7 c registers same device');
  perform assert_true(jsonb_array_length(my_push_tokens()) = 1, 'pu8 c owns it now');
  perform probe_as('b');
  perform assert_true(jsonb_array_length(my_push_tokens()) = 0, 'pu9 b lost it');

  -- remove bites only your own
  r := remove_push_token('device-token-abc123');
  perform assert_true((r ->> 'removed')::boolean is false, 'pu10 b cannot remove c''s token');
  perform probe_as('c');
  r := remove_push_token('device-token-abc123');
  perform assert_true((r ->> 'removed')::boolean, 'pu11 c removes own');

  -- deny-all tables
  perform assert_true(not exists (select 1 from push_token), 'pu12 push_token closed');
  perform assert_true(not exists (select 1 from push_outbox), 'pu13 push_outbox closed');
  reset role;
end $$;

select 'ALL PUSH PROBES PASSED' as result;
