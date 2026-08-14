-- 0140 trade-signal probes: the shared trade block ('block' = my player is
-- available) and interest marks ('want' = I'd trade for yours).
--
-- What must hold:
--   • only the seat's owner writes its signals; block only on OWN players,
--     want only on SOMEONE ELSE'S; free agents refuse both;
--   • every member reads every live signal, non-members read nothing;
--   • off is idempotent delete, on is idempotent insert;
--   • STALENESS BY READ: a signal whose premise broke (player moved) stops
--     appearing without any cleanup write — and reappears if the premise
--     comes back.
-- Fixtures are inserted directly (a completed draft is heavy machinery this
-- suite doesn't need to re-prove — native-league-probes owns that).
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
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;
create or replace function probe_uid(u text) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-00000000000' || u)::uuid
$$;
-- how many signals of a kind the current caller can see for a slug
create or replace function ts_count(lid uuid, k text, s text) returns int language sql as $$
  select count(*)::int from jsonb_array_elements(
    case when jsonb_typeof(trade_signals(lid)) = 'array' then trade_signals(lid) else '[]'::jsonb end) e
  where e ->> 'kind' = k and e ->> 'slug' = s
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

-- ── 0. fixtures: a two-seat league, a small pool, split rosters ──────────────
do $$
declare r jsonb; lid uuid; code text; aseat int; bseat int;
begin
  perform probe_as('a');
  r := create_native_league('Trade Signal League', '2026', 4, 7, 60);
  perform assert_ok(r, 't0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.ts_lid', lid::text, false);
  perform probe_as('b'); perform assert_ok(native_join(code, 'TS-B'), 't1 b joins');
  select sleeper_roster_id into aseat from league_membership where league_id = lid and app_user_id = probe_uid('a');
  select sleeper_roster_id into bseat from league_membership where league_id = lid and app_user_id = probe_uid('b');
  perform set_config('probe.ts_a', aseat::text, false);
  perform set_config('probe.ts_b', bseat::text, false);

  update draft set status = 'complete' where league_id = lid;
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'ts1', 'Block Candidate One', 'WR', 'SEA', 1),
    (lid, 'ts2', 'Block Candidate Two', 'RB', 'KC', 2),
    (lid, 'ts3', 'Wanted Player', 'TE', 'DAL', 3),
    (lid, 'ts4', 'Free Agent', 'QB', 'BUF', 4);
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, aseat, 'ts1', 'draft'),
    (lid, aseat, 'ts2', 'draft'),
    (lid, bseat, 'ts3', 'draft');
end $$;

-- ── 1. the premise checks: own-only block, other-only want, no free agents ──
do $$
declare lid uuid := current_setting('probe.ts_lid')::uuid;
        aseat int := current_setting('probe.ts_a')::int;
        bseat int := current_setting('probe.ts_b')::int;
begin
  perform probe_as('a');
  perform assert_ok(set_trade_signal(lid, aseat, 'ts1', 'block', true), 't2 block own player');
  perform assert_err(set_trade_signal(lid, aseat, 'ts3', 'block', true), 'your own players', 't3 cannot block theirs');
  perform assert_err(set_trade_signal(lid, aseat, 'ts2', 'want', true), 'already on your roster', 't4 cannot want own');
  perform assert_ok(set_trade_signal(lid, aseat, 'ts3', 'want', true), 't5 want theirs');
  perform assert_err(set_trade_signal(lid, aseat, 'ts4', 'want', true), 'not on a roster', 't6 free agent refuses want');
  perform assert_err(set_trade_signal(lid, aseat, 'ts4', 'block', true), 'not on a roster', 't7 free agent refuses block');
  perform assert_err(set_trade_signal(lid, aseat, 'ts1', 'wish', true), 'block or want', 't8 unknown kind refused');
  -- b cannot sign for a's seat (a is a probe admin from an earlier suite in
  -- the shared scratch DB, and is_admin() legitimately bypasses the seat check)
  perform probe_as('b');
  perform assert_err(set_trade_signal(lid, aseat, 'ts2', 'block', true), 'not your seat', 't9 not my seat');
end $$;

-- ── 2. visibility: members see everything, non-members see nothing ──────────
do $$
declare lid uuid := current_setting('probe.ts_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  perform assert_true(ts_count(lid, 'block', 'ts1') = 1, 't10 member sees the block');
  perform assert_true(ts_count(lid, 'want', 'ts3') = 1, 't11 the owner sees who wants their player');
  perform assert_true((select e ->> 'holder_roster' from jsonb_array_elements(trade_signals(lid)) e
      where e ->> 'kind' = 'want' and e ->> 'slug' = 'ts3')::int
    = current_setting('probe.ts_b')::int, 't12 holder_roster is the current seat');
  perform probe_as('d');
  r := trade_signals(lid);
  perform assert_true(r ->> 'error' = 'forbidden', 't13 non-member reads nothing');
  perform assert_err(set_trade_signal(lid, current_setting('probe.ts_a')::int, 'ts1', 'block', true),
    'not your seat', 't14 non-member writes nothing');
  reset role;
end $$;

-- ── 3. idempotence: double-on is one row, off deletes, off again is fine ─────
do $$
declare lid uuid := current_setting('probe.ts_lid')::uuid;
        aseat int := current_setting('probe.ts_a')::int;
begin
  perform probe_as('a');
  perform assert_ok(set_trade_signal(lid, aseat, 'ts1', 'block', true), 't15 on again ok');
  perform assert_true((select count(*) from trade_signal
      where league_id = lid and roster_id = aseat and slug = 'ts1' and kind = 'block') = 1,
    't16 still one row');
  perform assert_ok(set_trade_signal(lid, aseat, 'ts1', 'block', false), 't17 off');
  perform assert_true(ts_count(lid, 'block', 'ts1') = 0, 't18 gone from reads');
  perform assert_ok(set_trade_signal(lid, aseat, 'ts1', 'block', false), 't19 off again is a no-op');
  perform assert_ok(set_trade_signal(lid, aseat, 'ts1', 'block', true), 't20 back on');
end $$;

-- ── 4. staleness by read: a moved player mutes the signal, a return revives ─
do $$
declare lid uuid := current_setting('probe.ts_lid')::uuid;
        aseat int := current_setting('probe.ts_a')::int;
        bseat int := current_setting('probe.ts_b')::int;
begin
  perform probe_as('a');
  -- a's blocked ts1 moves to b (as a trade would): the block's premise broke
  update native_roster set roster_id = bseat where league_id = lid and slug = 'ts1';
  perform assert_true(ts_count(lid, 'block', 'ts1') = 0, 't21 block muted after the move');
  -- and a's want on ts3 dies the moment a ACQUIRES ts3 (interest satisfied)
  update native_roster set roster_id = aseat where league_id = lid and slug = 'ts3';
  perform assert_true(ts_count(lid, 'want', 'ts3') = 0, 't22 want muted once acquired');
  -- the rows survive: premises restored, both signals reappear untouched
  update native_roster set roster_id = aseat where league_id = lid and slug = 'ts1';
  update native_roster set roster_id = bseat where league_id = lid and slug = 'ts3';
  perform assert_true(ts_count(lid, 'block', 'ts1') = 1, 't23 block revives');
  perform assert_true(ts_count(lid, 'want', 'ts3') = 1, 't24 want revives');
  -- a player off every roster (dropped) mutes a block too
  delete from native_roster where league_id = lid and slug = 'ts1';
  perform assert_true(ts_count(lid, 'block', 'ts1') = 0, 't25 dropped player mutes the block');
end $$;

select 'ALL TRADE-SIGNAL PROBES PASSED' as result;
