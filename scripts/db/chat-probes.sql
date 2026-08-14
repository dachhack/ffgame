-- 0147 chat probes: league chat + DMs.
--
-- What must hold:
--   • members (and the commissioner) post and read; outsiders get nothing;
--   • body rules bite (empty, >500) with clear errors; flood guard bites;
--   • authors delete their own, the commissioner deletes anything,
--     a member cannot delete someone else's;
--   • fetching the LATEST page marks the surface read; the badge RPC
--     never does;
--   • DMs: same-league gate both directions, pair maps to ONE thread per
--     league, unread counts flow and clear;
--   • RLS: direct table reads return nothing to the caller role.
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

-- ── 0. fixture: b commissions, c joins, d stays outside ─────────────────────
do $$
declare r jsonb; lid uuid; code text;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Chat League', '2026', 4, 7, 60);
  perform assert_ok(r, 'ch0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.ch_lid', lid::text, false);
  perform probe_as('c'); perform assert_ok(native_join(code, 'CH-C'), 'ch1 c joins');
end $$;

-- age every message so the flood guard never trips between probe posts
create or replace function _probe_age_chat() returns void language sql as $$
  update league_message set created_at = created_at - interval '10 seconds';
  update dm_message set created_at = created_at - interval '10 seconds';
$$;

-- ── 1. league chat: post, read, gates, body rules, flood ────────────────────
do $$
declare lid uuid := current_setting('probe.ch_lid')::uuid; r jsonb; ms jsonb;
begin
  set local role authenticated;
  perform probe_as('c');
  perform assert_ok(chat_post(lid, '  hello league  '), 'ch2 member posts');
  perform assert_err(chat_post(lid, 'too soon'), 'every couple of seconds', 'ch3 flood guard bites');
  reset role; perform _probe_age_chat(); set local role authenticated;
  perform probe_as('c');
  perform assert_err(chat_post(lid, '   '), 'empty', 'ch4 empty refused');
  perform assert_err(chat_post(lid, repeat('x', 501)), '500', 'ch5 long refused');
  perform probe_as('b');
  perform assert_ok(chat_post(lid, 'commish here'), 'ch6 commissioner posts');
  perform probe_as('d');
  perform assert_err(chat_post(lid, 'let me in'), 'forbidden', 'ch7 outsider cannot post');
  perform assert_err(chat_messages(lid), 'forbidden', 'ch8 outsider cannot read');
  perform probe_as('c');
  r := chat_messages(lid);
  perform assert_ok(r, 'ch9 member reads');
  ms := r -> 'messages';
  perform assert_true(jsonb_array_length(ms) = 2, 'ch10 both messages back');
  perform assert_true(ms -> 0 ->> 'body' = 'commish here', 'ch11 newest first');
  perform assert_true(ms -> 1 ->> 'body' = 'hello league', 'ch12 body trimmed');
  perform assert_true((ms -> 1 ->> 'mine')::boolean and not (ms -> 0 ->> 'mine')::boolean, 'ch13 mine flags');
  perform assert_true(ms -> 1 ->> 'author' = 'CH-C', 'ch14 author shows the team name');
  reset role;
end $$;

-- ── 2. unread: badge counts, latest-page fetch clears, badge never marks ────
do $$
declare lid uuid := current_setting('probe.ch_lid')::uuid; r jsonb;
begin
  perform _probe_age_chat();
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(chat_post(lid, 'anyone up for a trade?'), 'ch15 b posts again');
  perform probe_as('c');
  r := chat_unread(lid);
  perform assert_true((r ->> 'league')::int = 1, 'ch16 one unread for c');
  r := chat_unread(lid);
  perform assert_true((r ->> 'league')::int = 1, 'ch17 badge RPC does not mark read');
  perform assert_ok(chat_messages(lid), 'ch18 open the chat');
  perform assert_true((chat_unread(lid) ->> 'league')::int = 0, 'ch19 latest-page fetch marked read');
  reset role;
end $$;

-- ── 3. delete: own yes, commish any, member not someone else's ──────────────
do $$
declare lid uuid := current_setting('probe.ch_lid')::uuid; r jsonb; own_id bigint; b_id bigint;
begin
  perform _probe_age_chat();
  set local role authenticated;
  perform probe_as('c');
  r := chat_post(lid, 'delete me'); perform assert_ok(r, 'ch20 post to delete');
  own_id := (r ->> 'id')::bigint;
  reset role; perform _probe_age_chat(); set local role authenticated;
  perform probe_as('b');
  r := chat_post(lid, 'commish line'); perform assert_ok(r, 'ch21 commish post');
  b_id := (r ->> 'id')::bigint;
  perform probe_as('c');
  perform assert_err(chat_delete(lid, b_id), 'not yours', 'ch22 member cannot delete another''s');
  perform assert_ok(chat_delete(lid, own_id), 'ch23 author deletes own');
  perform probe_as('b');
  perform assert_ok(chat_delete(lid, b_id), 'ch24 commish deletes (own here, any in general)');
  reset role;
end $$;

-- ── 4. DMs: gates, one thread per pair, unread flow ─────────────────────────
do $$
declare lid uuid := current_setting('probe.ch_lid')::uuid; r jsonb; t1 uuid; t2 uuid; th jsonb;
begin
  perform _probe_age_chat();
  set local role authenticated;
  perform probe_as('c');
  perform assert_err(dm_send(lid, '00000000-0000-0000-0000-00000000000c', 'hi me'), 'someone else', 'dm0 no self-DM');
  perform assert_err(dm_send(lid, '00000000-0000-0000-0000-00000000000d', 'psst'), 'not in this league', 'dm1 outsider recipient refused');
  r := dm_send(lid, '00000000-0000-0000-0000-00000000000b', 'got a trade for you');
  perform assert_ok(r, 'dm2 member DMs the commissioner');
  t1 := (r ->> 'thread_id')::uuid;
  perform probe_as('d');
  perform assert_err(dm_send(lid, '00000000-0000-0000-0000-00000000000b', 'hello'), 'forbidden', 'dm3 outsider sender refused');
  perform assert_err(dm_messages(t1), 'forbidden', 'dm4 outsider cannot read a thread');
  reset role; perform _probe_age_chat(); set local role authenticated;
  perform probe_as('b');
  r := chat_unread(lid);
  perform assert_true((r ->> 'dm')::int = 1, 'dm5 b sees one unread DM');
  r := dm_threads(lid);
  th := r -> 'threads';
  perform assert_true(jsonb_array_length(th) = 1, 'dm6 one thread listed');
  perform assert_true(th -> 0 ->> 'peer' = 'CH-C', 'dm7 peer named by team');
  perform assert_true((th -> 0 ->> 'unread')::int = 1, 'dm8 thread unread count');
  perform assert_ok(dm_messages(t1), 'dm9 open the thread');
  perform assert_true((chat_unread(lid) ->> 'dm')::int = 0, 'dm10 open cleared it');
  r := dm_send(lid, '00000000-0000-0000-0000-00000000000c', 'listening…');
  perform assert_ok(r, 'dm11 reply');
  t2 := (r ->> 'thread_id')::uuid;
  perform assert_true(t1 = t2, 'dm12 same pair, same thread');
  perform probe_as('c');
  perform assert_true((chat_unread(lid) ->> 'dm')::int = 1, 'dm13 reply is unread for c');
  reset role;
end $$;

-- ── 5. RLS: the tables answer nothing directly ──────────────────────────────
do $$
begin
  set local role authenticated;
  perform probe_as('c');
  perform assert_true(not exists (select 1 from league_message), 'rls0 league_message closed');
  perform assert_true(not exists (select 1 from dm_message), 'rls1 dm_message closed');
  perform assert_true(not exists (select 1 from dm_thread), 'rls2 dm_thread closed');
  reset role;
end $$;

select 'ALL CHAT PROBES PASSED' as result;
