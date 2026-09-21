-- 0286 probes: who is actually in the draft room.
--
-- What must hold:
--   • one call does both jobs — it marks the caller present and returns
--     everyone's last beat, so a client needs no second fetch;
--   • a seat is reported by SEAT, keyed by PERSON: a co-managed seat is here
--     while either of them is, and going quiet ages rather than disappearing;
--   • a member with no seat (a spectator, an admin) may look without lighting
--     one, and a stranger may not look at all;
--   • presence is per LEAGUE — being in one room is not being in another.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function pz_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function pz_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function pz_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000e5e0' || u, false);
  perform set_config('app.email', 'pz' || u || '@test.dev', false);
end $$;
-- is this seat in the list the RPC just returned, and how stale?
create or replace function pz_secs(r jsonb, seat int) returns int language sql as $$
  select (x ->> 'secs')::int from jsonb_array_elements(r -> 'here') x
   where (x ->> 'roster_id')::int = seat $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e5e01', 'pz1@test.dev'),
  ('00000000-0000-0000-0000-0000000e5e02', 'pz2@test.dev'),
  ('00000000-0000-0000-0000-0000000e5e03', 'pz3@test.dev'),
  ('00000000-0000-0000-0000-0000000e5e09', 'pz9@test.dev')
on conflict (id) do nothing;

-- ── fixture: two leagues, so "here" can be proved league-scoped ────────────
do $$
declare lid uuid; lid2 uuid; r jsonb; code text;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000e5e01', 'pz1@test.dev'),
    ('00000000-0000-0000-0000-0000000e5e02', 'pz2@test.dev'),
    ('00000000-0000-0000-0000-0000000e5e03', 'pz3@test.dev'),
    ('00000000-0000-0000-0000-0000000e5e09', 'pz9@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000e5e01';
  perform pz_as('1');
  r := create_native_league('Presence', '2026', 4, 8, 60, 'snake', 200, 15, 1);
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform pz_as('2'); perform pz_ok(native_join(code, 'PZ-2'), 'pz0 pz2 takes seat 2');
  perform pz_as('1');
  r := create_native_league('Elsewhere', '2026', 4, 8, 60, 'snake', 200, 15, 1);
  lid2 := (r ->> 'league_id')::uuid;
  perform set_config('probe.pz_lid', lid::text, false);
  perform set_config('probe.pz_lid2', lid2::text, false);
end $$;

-- ── 1. the beat marks you and reports everyone ────────────────────────────
do $$
declare lid uuid := current_setting('probe.pz_lid')::uuid; r jsonb;
begin
  perform pz_as('1');
  r := draft_here(lid);
  perform pz_ok(r, 'pz1 the commissioner checks in');
  perform pz_true(jsonb_array_length(r -> 'here') = 1, 'pz1a and is the only one here');
  perform pz_true(pz_secs(r, 1) = 0, 'pz1b their own beat is fresh');
  perform pz_true((r ->> 'server_now') is not null, 'pz1c the server says what time it thinks it is');

  perform pz_as('2');
  r := draft_here(lid);
  perform pz_true(jsonb_array_length(r -> 'here') = 2, 'pz2 now both seats report');
  perform pz_true(pz_secs(r, 1) = 0 and pz_secs(r, 2) = 0, 'pz2a both fresh');
end $$;

-- ── 2. going quiet AGES; it does not vanish ───────────────────────────────
do $$
declare lid uuid := current_setting('probe.pz_lid')::uuid; r jsonb;
begin
  reset role;
  update draft_presence set seen_at = now() - interval '2 minutes'
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000e5e01';
  perform pz_as('2');
  r := draft_here(lid);
  perform pz_true(jsonb_array_length(r -> 'here') = 2, 'pz3 a quiet seat is still listed');
  perform pz_true(pz_secs(r, 1) between 115 and 125, 'pz3a with its age, so the client can call it');
  perform pz_true(pz_secs(r, 2) = 0, 'pz3b while the caller stays fresh');
  -- and the client's own rule: 40s is the line both hosts use
  perform pz_true(pz_secs(r, 1) > 40 and pz_secs(r, 2) <= 40,
    'pz3c one is past the shared staleness line and one is not');
  -- a beat that is DAYS old drops out entirely rather than pretending
  reset role;
  update draft_presence set seen_at = now() - interval '2 hours'
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000e5e01';
  perform pz_as('2');
  perform pz_true(pz_secs(draft_here(lid), 1) is null, 'pz4 a beat hours old is not reported at all');
end $$;

-- ── 3. a seat two people share is here while EITHER of them is ────────────
do $$
declare lid uuid := current_setting('probe.pz_lid')::uuid; r jsonb;
begin
  reset role;
  -- pz3 co-manages seat 2 — through team_manager (0125), which is what
  -- co-management IS; league_membership is one row per seat.
  insert into team_manager (league_id, roster_id, app_user_id)
    values (lid, 2, '00000000-0000-0000-0000-0000000e5e03') on conflict do nothing;
  update draft_presence set seen_at = now() - interval '5 minutes'
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000e5e02';
  perform pz_as('3');
  r := draft_here(lid);
  perform pz_true(pz_secs(r, 2) = 0,
    'pz5 the co-manager checking in makes the SEAT fresh, not a second row for it');
  perform pz_true((select count(*) from jsonb_array_elements(r -> 'here') x
                    where (x ->> 'roster_id')::int = 2) = 1, 'pz5a one row per seat');
end $$;

-- ── 4. who may look, and who may light a seat ─────────────────────────────
do $$
declare lid uuid := current_setting('probe.pz_lid')::uuid; lid2 uuid := current_setting('probe.pz_lid2')::uuid; r jsonb;
begin
  perform pz_as('9');
  perform pz_true(coalesce(((draft_here(lid)) ->> 'ok')::boolean, true) is false,
    'pz6 a stranger cannot see who is in the room');
  -- the commissioner of THIS league has a seat in it; in the other league he
  -- has one too, and being in one room is not being in the other
  perform pz_as('1');
  r := draft_here(lid2);
  perform pz_ok(r, 'pz7 the other room answers');
  perform pz_true(jsonb_array_length(r -> 'here') = 1, 'pz7a and only knows about itself');
  perform pz_true((select count(*) from draft_presence where league_id = lid2) = 1,
    'pz7b one row there');
  perform pz_true((select count(*) from draft_presence where league_id = lid) = 3,
    'pz7c and the first room still has its three people');
end $$;

-- ── 5. a member with no seat may watch without lighting one ───────────────
do $$
declare lid uuid := current_setting('probe.pz_lid')::uuid; r jsonb; n_before int;
begin
  reset role;
  -- pz3 stops co-managing: a member (0125 counts co-managers as members for
  -- reads, and the chat/board they keep) with no seat of their own.
  delete from team_manager where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000e5e03';
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name)
    values (lid, 4, '00000000-0000-0000-0000-0000000e5e03', false, 'PZ-SPECTATOR')
    on conflict (league_id, sleeper_roster_id) do update
      set app_user_id = excluded.app_user_id, enrolled = false;
  perform pz_as('3');
  r := draft_here(lid);
  perform pz_true(coalesce(((r) ->> 'ok')::boolean, false), 'pz8 a seatless member may still look');
  perform pz_true((select roster_id is null from draft_presence
                    where league_id = lid and app_user_id = '00000000-0000-0000-0000-0000000e5e03'),
    'pz8a their row carries no seat');
  perform pz_true(not exists (select 1 from jsonb_array_elements(r -> 'here') x
                    where x ->> 'roster_id' is null),
    'pz8b and no seatless row is reported — the board draws seats');
  reset role;
  raise notice 'presence probes done';
end $$;

select 'ALL PRESENCE PROBES PASSED' as status;
