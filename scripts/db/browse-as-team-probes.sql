-- 0306 probes: BROWSE-AS SEES THEIR TEAM.
--
-- What must hold:
--   • admin_user_native_team_state(u, league) answers for U — U's roster id,
--     U's team name, U's is_commish — not the caller's;
--   • native_team_state(league) is unchanged for a manager: their own seat,
--     and is_commish still true for the commissioner;
--   • the twin refuses non-admins; a null user is refused.
-- Fresh fixture league (b commissions, c joins); the admin is a probe user
-- of this suite's own, added to app_admin and removed at the end.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function bt_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

do $$
declare
  r jsonb; lid uuid; code text; ub uuid := '00000000-0000-0000-0000-00000000000b'; uc uuid := '00000000-0000-0000-0000-00000000000c';
  ua uuid := '00000000-0000-0000-0000-0000000b7a01'; c_roster int; b_roster int;
begin
  insert into auth.users (id, email) values (ub, 'b@test.dev'), (uc, 'c@test.dev'), (ua, 'bt-admin@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values (ub, 'b@test.dev'), (uc, 'c@test.dev'), (ua, 'bt-admin@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id = ub;
  perform probe_as('b');
  r := create_native_league('Browse Team League', '2026', 4, 7, 60);
  perform bt_true((r ->> 'ok')::boolean, 'bt0 create: ' || r::text);
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('c');
  r := native_join(code, 'Mooneys Munchkins');
  perform bt_true((r ->> 'ok')::boolean, 'bt1 c joins: ' || r::text);
  select sleeper_roster_id into c_roster from league_membership where league_id = lid and app_user_id = uc;
  select sleeper_roster_id into b_roster from league_membership where league_id = lid and app_user_id = ub;

  -- ── 1. the manager's own read is what it always was ──────────────────────
  r := native_team_state(lid);
  perform bt_true((r ->> 'my_roster_id')::int = c_roster and r ->> 'my_team' = 'Mooneys Munchkins' and not (r ->> 'is_commish')::boolean,
    'bt2 c sees c: ' || r::text);
  perform probe_as('b');
  r := native_team_state(lid);
  perform bt_true((r ->> 'my_roster_id')::int = b_roster and (r ->> 'is_commish')::boolean, 'bt2a the commissioner still reads as commissioner');

  -- ── 2. a non-admin cannot use the twin ───────────────────────────────────
  r := admin_user_native_team_state(uc, lid);
  perform bt_true(r ->> 'error' = 'forbidden', 'bt3 non-admin refused: ' || r::text);

  -- ── 3. THE POINT: the admin, browsing as c, sees C's seat ────────────────
  perform set_config('app.uid', ua::text, false);
  perform set_config('app.email', 'bt-admin@test.dev', false);
  insert into app_admin (email) values ('bt-admin@test.dev') on conflict do nothing;
  r := admin_user_native_team_state(uc, lid);
  perform bt_true((r ->> 'my_roster_id')::int = c_roster, 'bt4 browsing as c → c''s roster, not the admin''s (none): ' || (r ->> 'my_roster_id'));
  perform bt_true(r ->> 'my_team' = 'Mooneys Munchkins', 'bt4a …and c''s team name');
  perform bt_true(not (r ->> 'is_commish')::boolean, 'bt4b …and is_commish as C sees it (false), not as an admin');
  perform bt_true((r -> 'my_claims') is not null and (r -> 'waiver_order') is not null, 'bt4c the full desk shape rides along');
  r := admin_user_native_team_state(ub, lid);
  perform bt_true((r ->> 'my_roster_id')::int = b_roster and (r ->> 'is_commish')::boolean, 'bt5 browsing as the commissioner reads as commissioner');
  r := admin_user_native_team_state(null, lid);
  perform bt_true(r ->> 'error' = 'no user', 'bt6 a null user is refused');
  -- the admin's OWN read of a league they are not in still answers (is_admin gate) with no seat
  r := native_team_state(lid);
  perform bt_true(r ->> 'my_roster_id' is null and (r ->> 'is_commish')::boolean, 'bt7 the admin''s own read: no seat, admin-as-commish, as before');

  delete from app_admin where email = 'bt-admin@test.dev';
  delete from league where id = lid;
  delete from app_user where id = ua;
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
  raise notice 'browse-as-team probes done';
end $$;
select 'ALL BROWSE-AS-TEAM PROBES PASSED' as result;
