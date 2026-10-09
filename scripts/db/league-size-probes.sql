-- 0458 probes: THE LEAGUE CAN CHANGE SIZE BEFORE THE DRAFT.
--   • commissioner only, 2–32, refused once the draft starts;
--   • grow adds open seats, extends a set draft order, says so in chat;
--   • shrink removes empty seats, moves a claimed seat above the new size into
--     a freed lower number (people, picks, co-manager, draft slot with it),
--     renames it only if it still wore its old default name;
--   • refused when too few seats are empty, or a move would touch rosters;
--   • the playoff field shrinks to fit; a drawn schedule is redrawn.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function lz_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function lz_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function lz_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function lz_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000065' || u, false); perform set_config('app.email', 'lz' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000006501', 'lz01@test.dev'), ('00000000-0000-0000-0000-000000006502', 'lz02@test.dev'), ('00000000-0000-0000-0000-000000006503', 'lz03@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000006501', 'lz01@test.dev'), ('00000000-0000-0000-0000-000000006502', 'lz02@test.dev'), ('00000000-0000-0000-0000-000000006503', 'lz03@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id::text like '00000000-0000-0000-0000-00000000650_';

do $$
declare r jsonb; lid uuid; code text; n int;
begin
  perform lz_as('01');
  r := create_native_league('SizeLeague', '2026', 6, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform lz_ok(r, 'lz0 a 6-team league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform seed_league_pool(lid, (select jsonb_agg(jsonb_build_object('slug', 'lz-' || g, 'full', 'Size ' || g, 'pos', 'RB', 'team', 'LZT', 'exp', 0)) from generate_series(1, 10) g));
  perform lz_as('02'); perform lz_ok(native_join(code, 'LZ-B'), 'lz0 B joins (seat 2)');
  -- C sits in seat 6, with a co-manager row, still wearing the default name
  update league_membership set app_user_id = '00000000-0000-0000-0000-000000006503', enrolled = true
   where league_id = lid and sleeper_roster_id = 6;
  insert into team_manager (league_id, roster_id, app_user_id) values (lid, 6, '00000000-0000-0000-0000-000000006502');

  -- ── lz1. who and when ──
  perform lz_as('02');
  perform lz_refused(commish_set_league_size(lid, 8), 'commissioner only', 'lz1 a member cannot');
  perform lz_as('01');
  perform lz_refused(commish_set_league_size(lid, 1), '2–32', 'lz1a not below 2');
  perform lz_refused(commish_set_league_size(lid, 33), '2–32', 'lz1b not above 32');
  perform lz_ok(commish_set_league_size(lid, 6), 'lz1c the same size is a no-op');

  -- ── lz2. grow ──
  update draft set draft_order = '[6,1,2,3,4,5]' where league_id = lid;
  r := commish_set_league_size(lid, 8);
  perform lz_ok(r, 'lz2 grow to 8');
  perform lz_true((select count(*) from league_membership where league_id = lid) = 8, 'lz2a eight seats');
  perform lz_true((select team_name from league_membership where league_id = lid and sleeper_roster_id = 8) = 'Team 8'
              and not (select enrolled from league_membership where league_id = lid and sleeper_roster_id = 8), 'lz2b the new ones are open');
  perform lz_true((select settings_json ->> 'teams' from league where id = lid) = '8', 'lz2c settings follow');
  perform lz_true((select draft_order from draft where league_id = lid) = '[6,1,2,3,4,5,7,8]', 'lz2d a set draft order gains the new seats at the end');
  perform lz_true((select body from league_message where league_id = lid and txn ->> 'kind' = 'league_size' order by id desc limit 1)
                  = '🏈 The commissioner made this a 8-team league — 2 open seats added.', 'lz2e the league hears it');

  -- ── lz3. shrink, moving the claimed seat 6 down ──
  update league set settings_json = settings_json || '{"playoff_teams": 6}' where id = lid;
  r := commish_set_league_size(lid, 4);
  perform lz_ok(r, 'lz3 shrink to 4');
  perform lz_true((select array_agg(sleeper_roster_id order by sleeper_roster_id) from league_membership where league_id = lid) = '{1,2,3,4}', 'lz3a seats 1–4 remain');
  perform lz_true((select app_user_id from league_membership where league_id = lid and sleeper_roster_id = 4) = '00000000-0000-0000-0000-000000006503',
    'lz3b C moved from seat 6 to seat 4 (the freed number)');
  perform lz_true((select team_name from league_membership where league_id = lid and sleeper_roster_id = 4) = 'Team 4', 'lz3c "Team 6" became "Team 4"');
  perform lz_true(exists (select 1 from team_manager where league_id = lid and roster_id = 4) and not exists (select 1 from team_manager where league_id = lid and roster_id = 6),
    'lz3d the co-manager moved with it');
  perform lz_true((select app_user_id from league_membership where league_id = lid and sleeper_roster_id = 2) = '00000000-0000-0000-0000-000000006502', 'lz3e B never moved');
  perform lz_true((select draft_order from draft where league_id = lid) = '[4,1,2,3]', 'lz3f the draft order drops the removed and renumbers the moved — got ' || (select draft_order::text from draft where league_id = lid));
  perform lz_true((select settings_json ->> 'playoff_teams' from league where id = lid) = '4', 'lz3g a 6-team playoff shrinks to 4');
  perform lz_true((r -> 'moved' -> 0 ->> 'from')::int = 6 and (r -> 'moved' -> 0 ->> 'to')::int = 4, 'lz3h the answer says who moved');
  perform lz_true((select body from league_message where league_id = lid and txn ->> 'kind' = 'league_size' order by id desc limit 1)
                  like '🏈 The commissioner made this a 4-team league — 4 empty seats removed (Team 4 is now seat 4).', 'lz3i the league hears it');

  -- ── lz4. refusals ──
  perform lz_refused(commish_set_league_size(lid, 2), 'seats are empty', 'lz4 too few empty seats to reach 2');
  r := native_generate_schedule(lid, 3);
  perform lz_ok(r, 'lz4a draw a 3-week schedule at 4 teams');
  perform lz_ok(commish_set_league_size(lid, 6), 'lz4b grow to 6 with a schedule drawn');
  select count(*) into n from matchup where league_id = lid and week = (select min(week) from matchup where league_id = lid);
  perform lz_true(n = 3, 'lz4c the schedule is redrawn for 6 teams — got ' || n || ' matchups a week');
  -- a seat would have to move while players are rostered
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, 1, 'lz-1', 'draft');
  update league_membership set claim_email = 'lz-invite@test.dev' where league_id = lid and sleeper_roster_id = 6;
  perform lz_refused(commish_set_league_size(lid, 5), 'players are already on rosters', 'lz4d no moving seats once players are on rosters');
  perform lz_true((select count(*) from league_membership where league_id = lid) = 6, 'lz4d2 …and nothing changed');
  update draft set status = 'live' where league_id = lid;
  perform lz_refused(commish_set_league_size(lid, 8), 'locks once the draft starts', 'lz4e locked once the draft starts');
  raise notice 'league-size probes done';
end $$;

select 'ALL LEAGUE-SIZE PROBES PASSED' as result;
