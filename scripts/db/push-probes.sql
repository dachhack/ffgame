-- 0150 push probes: token registry + prefs, RPC-only access.
--
-- What must hold:
--   • register upserts BY TOKEN and moves a token between accounts (a phone
--     that switches users must stop notifying the old one);
--   • prefs sanitize to the known boolean keys (0273 adds `format`);
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

  -- 0152: the draft mute key is a known key now
  perform assert_ok(set_push_prefs('device-token-abc123', '{"draft": false, "junk": true}'::jsonb), 'pu6a set draft pref');
  perform assert_true(my_push_tokens() -> 0 -> 'prefs' = '{"draft": false}'::jsonb, 'pu6b draft key survives sanitize');

  -- 0273: the FORMAT key (the guillotine's blade, the vampire's bite) mutes
  -- like any other kind, and the outbox accepts it as a kind.
  perform assert_ok(set_push_prefs('device-token-abc123', '{"format": false, "junk": true}'::jsonb), 'pu6c set format pref');
  perform assert_true(my_push_tokens() -> 0 -> 'prefs' = '{"format": false}'::jsonb, 'pu6d format key survives sanitize');
  -- The outbox is worker-only (deny-all RLS), so its kind list is read from
  -- the CONSTRAINT rather than probed with an insert the caller may not make.
  perform assert_true(
    position('format' in (select pg_get_constraintdef(oid) from pg_constraint
                          where conname = 'push_outbox_kind_check')) > 0,
    'pu6e the outbox accepts the format kind');
  perform assert_true(
    position('members' in (select pg_get_constraintdef(oid) from pg_constraint
                           where conname = 'push_outbox_kind_check')) > 0,
    'pu6f …without dropping the kinds that came before');

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

-- ── 0276: a test push and the delivery log ─────────────────────────────────
do $$
declare r jsonb; lg jsonb; tid bigint;
begin
  set local role authenticated;
  perform probe_as('c');
  r := push_test();
  perform assert_true(coalesce((r ->> 'ok')::boolean, false) is false and r ->> 'error' like 'no device%',
    'pu14 no device registered: the test says so instead of queuing into the void');
  perform assert_ok(register_push_token('device-token-c'), 'pu15 c registers a phone');
  r := push_test();
  perform assert_ok(r, 'pu16 a test push queues');
  perform assert_true((r ->> 'devices')::int = 1, 'pu17 and says how many devices it reaches');
  tid := (r ->> 'id')::bigint;
  r := push_test();
  perform assert_true(coalesce((r ->> 'ok')::boolean, false) is false and r ->> 'error' like '%30 seconds%',
    'pu18 a second test inside 30s is refused');
  lg := my_push_log();
  perform assert_ok(lg, 'pu19 the log reads');
  perform assert_true(jsonb_array_length(lg -> 'rows') = 1, 'pu20 one row queued');
  perform assert_true(lg -> 'rows' -> 0 ->> 'title' like '🔔 Test push%' and lg -> 'rows' -> 0 -> 'sent_at' = 'null'::jsonb,
    'pu21 the row is the test, not yet sent');
  perform assert_true(jsonb_array_length(lg -> 'devices') = 1 and lg -> 'devices' -> 0 ->> 'platform' = 'android',
    'pu22 the log lists the devices');
  perform probe_as('b');
  lg := my_push_log();
  perform assert_true(jsonb_array_length(lg -> 'rows') = 0, 'pu23 another account sees none of it');
  reset role;
  -- the worker delivers (service role writes the outbox directly)
  update push_outbox set sent_at = now(), error = null where id = tid;
  set local role authenticated;
  perform probe_as('c');
  lg := my_push_log();
  perform assert_true(lg -> 'rows' -> 0 -> 'sent_at' <> 'null'::jsonb, 'pu24 the log shows it went');
  reset role;
  perform set_config('app.uid', '', false);
  set local role authenticated;
  perform assert_true(coalesce((push_test() ->> 'ok')::boolean, true) is false, 'pu25 signed out cannot test');
  reset role;
end $$;

select 'ALL PUSH PROBES PASSED' as result;
