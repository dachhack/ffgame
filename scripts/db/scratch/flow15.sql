\set ON_ERROR_STOP on
\i scripts/db/scratch/flow10.sql
-- 0473: "where am I" and a search. G is the golf board (lower ring wins); B is
-- seat 1, C seat 2 from flow10. Eight more seats by hand, and a week-6 board
-- row per seat (the worker makes those in production), so C ties 6th of 10
-- (golf: 5,8,11,14,17,20,20,23,26,29).
insert into league_membership (league_id, sleeper_roster_id, enrolled, team_name)
select (select id from G), s, true, case when s % 2 = 0 then 'Squad ' || s else 'Crew ' || s end from generate_series(3, 10) s;
insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, home_final, away_final)
select (select id from G), 6, null, s, s, 'final', v, v
  from (values (1, 20), (2, 20), (3, 5), (4, 8), (5, 11), (6, 14), (7, 17), (8, 23), (9, 26), (10, 29)) as x(s, v);
-- the stub's week 6 kicks off in three hours: pull the first game back so the week has started
update nfl_slate set kickoff = now() - interval '1 hour' where week = 6 and home = 'NYJ';
update league_membership set team_name = 'Eve Squad' where league_id = (select id from G) and sleeper_roster_id = 2;
select set_config('t.uid', :'C', false);
-- top 3 only, two either side of me
create temp table N as select contest_board((select id from G), 6, 3, 2) as b;
select 'N1 top rows', jsonb_array_length(b -> 'rows'), b -> 'rows' -> 0 ->> 'team_name', b -> 'rows' -> 2 ->> 'rank' from N;
select 'N2 me', b -> 'me' ->> 'rank', b -> 'me' ->> 'team_name', b -> 'me' ->> 'me' from N;
select 'N3 near', r ->> 'rank', r ->> 'team_name', r ->> 'ring', r ->> 'me' from N, jsonb_array_elements(b -> 'near') r;
select 'N4 near is 5 rows around me', jsonb_array_length(b -> 'near') = 5 and (b -> 'near' -> 2 ->> 'me') = 'true' from N;
select 'N5 season near', r ->> 'rank', r ->> 'team_name', r ->> 'total' from N, jsonb_array_elements(b -> 'season' -> 'near') r;
select 'N6 no near when I am in the top', jsonb_array_length(contest_board((select id from G), 6, 100, 2) -> 'near') = 0,
       jsonb_array_length(contest_board((select id from G), 6, 100, 2) -> 'rows') = 10;
select 'N7 near 0 is just my row', jsonb_array_length(contest_board((select id from G), 6, 3, 0) -> 'near') = 1, contest_board((select id from G), 6, 3, 0) -> 'near' -> 0 ->> 'me';
-- search
select 'F1 find squad', r ->> 'rank', r ->> 'team_name' from jsonb_array_elements(contest_board((select id from G), 6, 3, 2, 'squad') -> 'found') r;
select 'F2 find season', jsonb_array_length(contest_board((select id from G), 6, 3, 2, 'SQUAD') -> 'season' -> 'found');
select 'F3 find nothing', contest_board((select id from G), 6, 3, 2, 'zzz') -> 'found', contest_board((select id from G), 6, 3, 2, '  ') -> 'found';
select 'F4 wildcard escaped', jsonb_array_length(contest_board((select id from G), 6, 3, 2, '%') -> 'found'),
       jsonb_array_length(contest_board((select id from G), 6, 3, 2, '_') -> 'found');
-- the old 3-arg call still works through the wrapper, and the overload is gone
select 'W1 wrapper', bullseye_league_board((select id from G), 6, 3) -> 'rows' -> 0 ->> 'team_name';
select 'W2 one overload', count(*) from pg_proc where proname = 'contest_board';
select 'I1 index', count(*) from pg_indexes where tablename = 'matchup' and indexname = 'matchup_league_id_week_idx';
