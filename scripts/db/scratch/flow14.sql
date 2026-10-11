\set ON_ERROR_STOP on
\i scripts/db/scratch/flow10.sql
select set_config('t.uid', :'B', false);
-- H is the 4-seat head-to-head league (B is seat 1, C seat 2). Two finished weeks by hand.
insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, home_final, away_final)
values ((select id from H), 4, null, 1, 2, 'final', 120, 100), ((select id from H), 4, null, 3, 4, 'final', 90, 95),
       ((select id from H), 5, null, 3, 1, 'final', 110, 130), ((select id from H), 5, null, 4, 2, 'final', 80, 80);
select 'R records', r ->> 'team_name', r ->> 'wins', r ->> 'losses', r ->> 'ties', r ->> 'rank', r ->> 'total'
  from jsonb_array_elements(contest_board((select id from H)) -> 'season' -> 'rows') r;
select 'R2 golf flips the record', set_contest_rules((select id from H), 'golf') ->> 'ok';
select 'R3', r ->> 'team_name', r ->> 'wins', r ->> 'losses', r ->> 'rank'
  from jsonb_array_elements(contest_board((select id from H)) -> 'season' -> 'rows') r;
select 'R4 a board league has no record', r ->> 'wins', r ->> 'rank' from jsonb_array_elements(contest_board((select id from G)) -> 'season' -> 'rows') r limit 2;
