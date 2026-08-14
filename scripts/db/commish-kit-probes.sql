-- 0141 commish-kit probes: the league note and player flags.
--
-- What must hold:
--   • only the commissioner (or admin) writes; every member reads; outsiders
--     get nothing, read or write;
--   • the note is ONE standing announcement: set overwrites, empty clears,
--     and can_edit tells the banner whether to show the pencil;
--   • flags upsert by (league, player): re-flagging re-labels, empty label
--     deletes, length limits hold.
-- Fixture is a native league purely for convenience (creator = commissioner);
-- the functions themselves are league-kind-agnostic by design.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

-- ── 0. fixture: b commissions a league, c joins, d stays outside ────────────
-- (b, not a: 'a' is a probe ADMIN from earlier suites in the shared scratch
-- DB, and these probes need a non-admin non-commish member to prove the gate.)
do $$
declare r jsonb; lid uuid; code text;
begin
  -- b needs the 'native' feature flag to found a league (0095 gate)
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Commish Kit League', '2026', 4, 7, 60);
  perform assert_ok(r, 'k0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.ck_lid', lid::text, false);
  perform probe_as('c'); perform assert_ok(native_join(code, 'CK-C'), 'k1 c joins');
end $$;

-- ── 1. the note: commish writes, members read, outsiders bounce ─────────────
do $$
declare lid uuid := current_setting('probe.ck_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_league_note(lid, '  Practice week is OPEN — set your boards.  '), 'k2 commish sets note');
  r := league_note(lid);
  perform assert_ok(r, 'k3 commish reads note');
  perform assert_true(r ->> 'text' = 'Practice week is OPEN — set your boards.', 'k4 note trimmed + stored');
  perform assert_true((r ->> 'can_edit')::boolean, 'k5 commish can_edit');
  perform assert_true((r ->> 'at') is not null, 'k6 note is stamped');

  perform probe_as('c');
  r := league_note(lid);
  perform assert_ok(r, 'k7 member reads note');
  perform assert_true(r ->> 'text' = 'Practice week is OPEN — set your boards.', 'k8 member sees the text');
  perform assert_true(not (r ->> 'can_edit')::boolean, 'k9 member cannot edit');
  perform assert_err(set_league_note(lid, 'coup attempt'), 'forbidden', 'k10 member cannot write');

  perform probe_as('d');
  perform assert_true(league_note(lid) ->> 'error' = 'forbidden', 'k11 outsider reads nothing');
  perform assert_err(set_league_note(lid, 'drive-by'), 'forbidden', 'k12 outsider cannot write');
  reset role;
end $$;

-- ── 2. the note is ONE announcement: overwrite, length cap, clear ───────────
do $$
declare lid uuid := current_setting('probe.ck_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_league_note(lid, 'Second note replaces the first.'), 'k13 overwrite');
  perform assert_true(league_note(lid) ->> 'text' = 'Second note replaces the first.', 'k14 only the latest stands');
  perform assert_err(set_league_note(lid, repeat('x', 501)), '500', 'k15 length cap');
  perform assert_ok(set_league_note(lid, '   '), 'k16 blank clears');
  r := league_note(lid);
  perform assert_ok(r, 'k17 read after clear');
  perform assert_true(r ->> 'text' is null, 'k18 cleared note reads empty');
  reset role;
end $$;

-- ── 3. flags: commish-only writes, upsert-by-player, empty deletes ──────────
do $$
declare lid uuid := current_setting('probe.ck_lid')::uuid; r jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  perform assert_ok(set_player_flag(lid, 'flagged-guy', 'keeper'), 'k19 flag set');
  perform assert_ok(set_player_flag(lid, 'other-guy', 'out for season'), 'k20 second flag');
  perform assert_ok(set_player_flag(lid, 'flagged-guy', 'RULED INELIGIBLE'), 'k21 re-flag re-labels');
  perform assert_true((select count(*) from player_flag where league_id = lid) = 2, 'k22 upsert, not append');
  perform assert_err(set_player_flag(lid, 'flagged-guy', repeat('x', 41)), '40', 'k23 label cap');
  perform assert_err(set_player_flag(lid, '  ', 'nobody'), 'which player', 'k24 slug required');

  perform probe_as('c');
  r := player_flags(lid);
  perform assert_true(jsonb_typeof(r) = 'array' and jsonb_array_length(r) = 2, 'k25 member sees both flags');
  perform assert_true((select e ->> 'label' from jsonb_array_elements(r) e where e ->> 'slug' = 'flagged-guy') = 'RULED INELIGIBLE',
    'k26 latest label wins');
  perform assert_err(set_player_flag(lid, 'flagged-guy', 'member graffiti'), 'forbidden', 'k27 member cannot flag');

  perform probe_as('d');
  perform assert_true(player_flags(lid) ->> 'error' = 'forbidden', 'k28 outsider reads nothing');

  perform probe_as('b');
  perform assert_ok(set_player_flag(lid, 'flagged-guy', ''), 'k29 empty label deletes');
  perform assert_true((select count(*) from player_flag where league_id = lid) = 1, 'k30 one flag left');
  reset role;
end $$;

select 'ALL COMMISH-KIT PROBES PASSED' as result;
