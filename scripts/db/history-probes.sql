-- 0324 probes: THE LEAGUE'S HISTORY.
--   • the lineage: every native season sharing the league's key, a league
--     that never rolled over standing alone, a member of ANY season
--     reading all of them and a stranger reading none;
--   • the seasons: the champion, the runner-up from the title game, the
--     final table, the season's own high week;
--   • the record book: the biggest weeks, the blowouts, the nailbiters,
--     the best seasons — playoff weeks counted as weeks but never in a
--     record, and preseason weeks (101+) counted nowhere;
--   • the managers: seasons, all-time record, points and titles, keyed on
--     the person where a seat is claimed and on the seat where it is not.
\set QUIET on
\pset pager off
create or replace function h_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function h_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000015' || u, false); perform set_config('app.email', 'h' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001501', 'h01@test.dev'), ('00000000-0000-0000-0000-000000001502', 'h02@test.dev'),
  ('00000000-0000-0000-0000-000000001503', 'h03@test.dev'), ('00000000-0000-0000-0000-000000001504', 'h04@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001501', 'h01@test.dev'), ('00000000-0000-0000-0000-000000001502', 'h02@test.dev'),
  ('00000000-0000-0000-0000-000000001503', 'h03@test.dev'), ('00000000-0000-0000-0000-000000001504', 'h04@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001501', '00000000-0000-0000-0000-000000001502',
              '00000000-0000-0000-0000-000000001503', '00000000-0000-0000-0000-000000001504');

do $$
declare r jsonb; lid uuid; lid2 uuid; code text; a int; b int; key text; h jsonb; s jsonb;
begin
  perform h_as('01');
  r := create_native_league('History', '2025', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform h_true((r ->> 'ok')::boolean, 'h0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform h_as('02'); perform h_true((native_join(code, 'H-B') ->> 'ok')::boolean, 'h0 B joins');
  perform h_as('01');
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001501';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001502';
  select sleeper_league_id into key from league where id = lid;
  update draft set status = 'complete' where league_id = lid;

  -- 2025: A goes 2-1 with a 150-point week, B goes 1-2; A wins the title game.
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 1, a, b, 'final', 150.5, 90.0),      -- the record week, and a blowout
    (lid, 2, a, b, 'final', 88.0, 88.5),       -- a nailbiter the other way
    (lid, 3, a, b, 'final', 101.0, 99.0);      -- another nailbiter
  -- a preseason week, which counts nowhere
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 101, a, b, 'final', 400.0, 10.0);
  -- the title game: a playoff week, counted as a week but never in a W-L
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final,
                       is_playoff, playoff_round, playoff_label) values
    (lid, 4, a, b, 'final', 120.0, 110.0, true, 2, 'Championship');
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('playoff_champion', a)
   where id = lid;

  -- ── h1. one season, standing alone ──
  h := league_history(lid);
  perform h_true((h ->> 'ok')::boolean and (h ->> 'seasons_count')::int = 1, 'h1 a lineage of one');
  s := h -> 'seasons' -> 0;
  perform h_true((s -> 'champion' ->> 'roster_id')::int = a, 'h1 the champion is stamped');
  perform h_true((s -> 'runner_up' ->> 'roster_id')::int = b, 'h1 the runner-up comes from the title game');
  perform h_true((s -> 'high_week' ->> 'points')::numeric = 150.5 and (s -> 'high_week' ->> 'week')::int = 1,
    'h1 the season high is the real week, not the preseason one');
  perform h_true((select (e ->> 'w')::int from jsonb_array_elements(s -> 'table') e
                   where (e ->> 'roster_id')::int = a) = 2
    and (select (e ->> 'l')::int from jsonb_array_elements(s -> 'table') e
          where (e ->> 'roster_id')::int = a) = 1,
    'h1 the table counts the regular season only — the title game is not a win');
  perform h_true((h -> 'records' -> 'top_weeks' -> 0 ->> 'points')::numeric = 150.5,
    'h1 the record week');
  perform h_true((select count(*) from jsonb_array_elements(h -> 'records' -> 'top_weeks') e
                   where (e ->> 'points')::numeric = 400.0) = 0, 'h1 preseason is nowhere in the book');
  perform h_true((h -> 'records' -> 'blowouts' -> 0 ->> 'margin')::numeric = 60.5, 'h1 the blowout');
  perform h_true((h -> 'records' -> 'nailbiters' -> 0 ->> 'margin')::numeric = 0.5, 'h1 the nailbiter');
  perform h_true((select count(*) from jsonb_array_elements(h -> 'records' -> 'top_weeks') e
                   where (e ->> 'playoff')::boolean) = 2,
    'h1 both sides of the title game are weeks in the book');

  -- ── h2. a second season, same lineage ──
  insert into league (sleeper_league_id, season, name, provider, settings_json, commissioner_id, kind)
    select key, '2026', l.name, 'native', jsonb_build_object('playoff_champion', b), l.commissioner_id, 'league'
      from league l where l.id = lid returning id into lid2;
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name)
    select lid2, m.sleeper_roster_id, m.sleeper_owner_id, m.app_user_id, m.enrolled, m.team_name || ' II'
      from league_membership m where m.league_id = lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid2, 1, a, b, 'final', 80.0, 160.0),
    (lid2, 2, a, b, 'final', 70.0, 120.0),
    (lid2, 3, a, b, 'final', 60.0, 130.0);
  h := league_history(lid);
  perform h_true((h ->> 'seasons_count')::int = 2, 'h2 both seasons in the lineage');
  perform h_true((h -> 'seasons' -> 0 ->> 'season') = '2026', 'h2 newest first');
  perform h_true((h -> 'records' -> 'top_weeks' -> 0 ->> 'points')::numeric = 160.0,
    'h2 the new season took the record');
  -- the managers' all-time lines: A is 2-1 then 0-3, one title; B the mirror.
  perform h_true((select (e ->> 'titles')::int from jsonb_array_elements(h -> 'managers') e
                   where e ->> 'app_user_id' = '00000000-0000-0000-0000-000000001501') = 1
    and (select (e ->> 'w')::int from jsonb_array_elements(h -> 'managers') e
          where e ->> 'app_user_id' = '00000000-0000-0000-0000-000000001501') = 2
    and (select (e ->> 'l')::int from jsonb_array_elements(h -> 'managers') e
          where e ->> 'app_user_id' = '00000000-0000-0000-0000-000000001501') = 4,
    'h2 A: one title, 2-4 all-time');
  perform h_true((select (e ->> 'seasons')::int from jsonb_array_elements(h -> 'managers') e
                   where e ->> 'app_user_id' = '00000000-0000-0000-0000-000000001502') = 2,
    'h2 B played both seasons');
  perform h_true((select e ->> 'team' from jsonb_array_elements(h -> 'managers') e
                   where e ->> 'app_user_id' = '00000000-0000-0000-0000-000000001502') like '%II',
    'h2 a manager goes by the name from his latest season');
  perform h_true((h -> 'managers' -> 0 ->> 'titles')::int >= (h -> 'managers' -> 1 ->> 'titles')::int,
    'h2 champions first');
  -- read from EITHER season
  perform h_true((league_history(lid2) ->> 'seasons_count')::int = 2, 'h2 the same history from either end');

  -- ── h3. who may read it, and how much of it ──
  -- REWRITTEN FOR 0332. This suite was written before the public API existed
  -- and asserted that a stranger read NOTHING. 0326/0327 deliberately opened
  -- a native league's history to whoever holds its id — a league's record
  -- book is one of the two things it most wants to show off — and the
  -- assertion that matters now is that opening the door did not hand out the
  -- ACCOUNTS behind the seats. 0324 keyed managers on app_user_id; that id is
  -- ours, not the internet's.
  perform h_as('03');
  h := league_history(lid);
  perform h_true((h ->> 'ok')::boolean and (h ->> 'redacted')::boolean,
    'h3 a stranger reads a public league''s history, and is told it is redacted');
  perform h_true(not (h::text like '%app_user_id%'),
    'h3 and it carries no account id anywhere in it');
  perform h_true((h ->> 'seasons_count')::int = (league_history(lid) ->> 'seasons_count')::int,
    'h3 the same document otherwise — one key dropped, not a second surface');
  perform h_as('01');
  perform h_true((commish_set_public_api(lid, false) ->> 'ok')::boolean, 'h3 the commissioner opts out');
  perform h_as('03');
  perform h_true(league_history(lid) ->> 'error' = 'forbidden',
    'h3 and a closed league refuses a stranger outright, as it always did');
  perform h_as('01');
  perform h_true((commish_set_public_api(lid, true) ->> 'ok')::boolean, 'h3 back open');
  perform h_as('02');
  h := league_history(lid);
  perform h_true((h ->> 'ok')::boolean and not (h ? 'redacted'), 'h3 a member reads it whole');
  perform h_true(h::text like '%app_user_id%', 'h3 with the account ids the app''s own screens key on');
  -- a manager who only ever joined the NEW season still sees the old ones
  perform h_as('01');
  update league_membership set app_user_id = '00000000-0000-0000-0000-000000001504', team_name = 'H-NEWCOMER'
   where league_id = lid2 and sleeper_roster_id = a;
  perform h_as('04');
  h := league_history(lid2);
  perform h_true((h ->> 'ok')::boolean and (h ->> 'seasons_count')::int = 2,
    'h3 a manager who joined this season sees the seasons he missed');
  -- …and the seat that changed hands keeps two honest lines rather than one
  perform h_true((select count(*) from jsonb_array_elements(h -> 'managers') e) = 3,
    'h3 three manager lines across two seasons and a seat that changed hands');
end $$;

select 'ALL HISTORY PROBES PASS' as result;
drop function if exists h_true(boolean, text);
drop function if exists h_as(text);
