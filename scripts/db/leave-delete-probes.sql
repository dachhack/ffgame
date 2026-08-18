-- 0188 leave-league / delete-league probes.
--
-- These cover the only two IRREVERSIBLE things a member can do to their own
-- membership, so the assertions are about what SURVIVES as much as what goes:
--
--   • leaving vacates the seat in the exact shape native_join looks for, and
--     LEAVES THE ROSTER AND TEAM NAME behind for the next manager;
--   • a co-manager's leave drops only their own row — the owner keeps the seat;
--   • the commissioner cannot leave (they would orphan the league), and the
--     refusal does not half-apply;
--   • a non-member cannot "leave";
--   • delete is commissioner-only and needs the league's name typed;
--   • a wrong or empty confirmation leaves the league completely intact;
--   • a real delete takes the child rows with it (the cascade).
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
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; seat int; n int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
    ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b',
                 '00000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000d');

  perform probe_as('a');
  r := create_native_league('Leavers FC', '2024', 3, 5, 60);
  perform assert_ok(r, 'ld0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';

  perform probe_as('b'); perform assert_ok(native_join(code, 'B Team'), 'ld0a b joins');
  perform probe_as('c'); perform assert_ok(native_join(code, 'C Team'), 'ld0b c joins');
  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';

  -- Give B a player, so we can prove the roster OUTLIVES the manager.
  -- native_roster keys into league_pool, so the pool row comes first.
  insert into league_pool (league_id, slug, full_name, pos, team, rank)
    values (lid, 'probe-player', 'Probe Player', 'RB', 'PHI', 1)
  on conflict do nothing;
  insert into native_roster (league_id, roster_id, slug, acquired)
    values (lid, seat, 'probe-player', 'draft')
  on conflict do nothing;

  -- ── a non-member cannot leave ────────────────────────────────────────────
  perform probe_as('d');
  perform assert_err(leave_league(lid), 'not in this league', 'ld1 outsider refused');

  -- ── the commissioner cannot leave ────────────────────────────────────────
  perform probe_as('a');
  perform assert_err(leave_league(lid), 'commission this league', 'ld2 commish refused');
  perform assert_true(
    (select app_user_id from league_membership
      where league_id = lid and sleeper_roster_id =
        (select sleeper_roster_id from league_membership
          where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a'))
    = '00000000-0000-0000-0000-00000000000a',
    'ld2a the refusal did not vacate the commissioner');

  -- ── a CO-MANAGER leaves: only their own row goes ─────────────────────────
  perform assert_ok(commish_set_manager(lid, seat, 'd@test.dev', null, false), 'ld3 d co-manages B');
  perform assert_true((select count(*) from team_manager where league_id = lid and roster_id = seat) = 1, 'ld3a attached');
  perform probe_as('d');
  r := leave_league(lid);
  perform assert_ok(r, 'ld3b co-manager leaves');
  perform assert_true(r ->> 'as' = 'comanager', 'ld3c reported as a co-manager leave');
  perform assert_true((select count(*) from team_manager where league_id = lid and roster_id = seat) = 0, 'ld3d row gone');
  perform assert_true(
    (select app_user_id from league_membership where league_id = lid and sleeper_roster_id = seat)
    = '00000000-0000-0000-0000-00000000000b',
    'ld3e the OWNER still holds the seat');

  -- ── the seat holder leaves ───────────────────────────────────────────────
  perform probe_as('a');
  perform assert_ok(commish_set_manager(lid, seat, 'd@test.dev', null, false), 'ld4 re-attach d');
  perform probe_as('b');
  r := leave_league(lid);
  perform assert_ok(r, 'ld4a b leaves');
  perform assert_true(r ->> 'as' = 'manager', 'ld4b reported as a manager leave');
  perform assert_true(
    (select app_user_id is null and not enrolled from league_membership
      where league_id = lid and sleeper_roster_id = seat),
    'ld4c the seat is OPEN in the shape native_join looks for');
  perform assert_true((select count(*) from team_manager where league_id = lid and roster_id = seat) = 0,
    'ld4d co-managers of the vacated seat are detached');
  perform assert_true((select team_name from league_membership where league_id = lid and sleeper_roster_id = seat) = 'B Team',
    'ld4e the TEAM NAME survives for the next manager');
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = seat) = 1,
    'ld4f the ROSTER survives for the next manager');
  perform assert_true((select count(*) from jsonb_array_elements(my_teams()) e
      where (e ->> 'league_id')::uuid = lid) = 0,
    'ld4g the league is gone from their own list');

  -- ── and the empty seat is claimable again ────────────────────────────────
  perform probe_as('d');
  perform assert_ok(native_join(code, 'D Team'), 'ld5 the vacated seat is claimable');
  perform assert_true(
    (select app_user_id from league_membership where league_id = lid and sleeper_roster_id = seat)
    = '00000000-0000-0000-0000-00000000000d',
    'ld5a d took the very seat b left');

  -- ── DELETE: not a member's to make ───────────────────────────────────────
  perform assert_err(commish_delete_league(lid, 'Leavers FC'), 'forbidden', 'ld6 member refused');
  perform assert_true((select count(*) from league where id = lid) = 1, 'ld6a league still there');

  -- ── DELETE: the name has to be typed ─────────────────────────────────────
  perform probe_as('a');
  perform assert_err(commish_delete_league(lid, 'leavers'), 'type the league name', 'ld7 wrong name refused');
  perform assert_err(commish_delete_league(lid, ''), 'type the league name', 'ld7a empty refused');
  perform assert_err(commish_delete_league(lid, null), 'type the league name', 'ld7b null refused');
  perform assert_true((select count(*) from league where id = lid) = 1, 'ld7c refusals left the league intact');
  perform assert_true((select count(*) from league_membership where league_id = lid) = 3, 'ld7d …and its seats');

  -- ── DELETE: it goes, and takes its children ──────────────────────────────
  select count(*)::int into n from native_roster where league_id = lid;
  perform assert_true(n > 0, 'ld8 there were child rows to cascade');
  r := commish_delete_league(lid, '  leavers   fc  ');   -- case + whitespace forgiving
  perform assert_ok(r, 'ld8a deleted');
  perform assert_true(r ->> 'name' = 'Leavers FC', 'ld8b reported the name');
  perform assert_true((r ->> 'removed_members')::int = 2, 'ld8c counted the other managers');
  perform assert_true((select count(*) from league where id = lid) = 0, 'ld8d league gone');
  perform assert_true((select count(*) from league_membership where league_id = lid) = 0, 'ld8e memberships cascaded');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 0, 'ld8f rosters cascaded');

  raise notice 'leave-delete probes done';
end $$;

select 'ALL LEAVE-DELETE PROBES PASSED' as result;
