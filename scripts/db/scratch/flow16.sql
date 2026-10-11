\set ON_ERROR_STOP on
\i scripts/db/scratch/flow10.sql
-- 0474: the commissioner fixes a week. H is the 4-seat head-to-head league (B
-- commissions it, seat 1; C is seat 2 "Eve"). Two finished weeks by hand, as
-- flow14; week 6 is the live one with squads saved.
select set_config('t.uid', :'B', false);
select 'F0 plain rules again', set_contest_rules((select id from H), 'high', null, 50000) ->> 'ok';
select set_config('t.uid', :'C', false);
select 'F1 eve saves a squad', save_contest_entry((select id from H), 6, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'ok';
insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, home_final, away_final)
values ((select id from H), 4, null, 1, 2, 'final', 120, 100), ((select id from H), 4, null, 3, 4, 'final', 90, 95),
       ((select id from H), 5, null, 3, 1, 'final', 110, 130), ((select id from H), 5, null, 4, 2, 'final', 80, 80),
       ((select id from H), 6, null, 1, 2, 'live', null, null), ((select id from H), 6, null, 3, 4, 'live', null, null);
select set_config('t.uid', :'C', false);
select 'V0 not the commissioner', commish_void_week((select id from H), 4, true, 'nope') ->> 'error';
select set_config('t.uid', :'B', false);
select 'V1 no reason', commish_void_week((select id from H), 4, true, ' ') ->> 'error';
select 'V2 no such week', commish_void_week((select id from H), 9, true, 'x') ->> 'error';
select 'V3 not final', commish_void_week((select id from H), 6, true, 'x') ->> 'error';
select 'V4 before', r ->> 'team_name', r ->> 'wins', r ->> 'losses', r ->> 'total' from jsonb_array_elements(contest_board((select id from H)) -> 'season' -> 'rows') r;
select 'V5 void', commish_void_week((select id from H), 4, true, 'the feed died Sunday') - 'week';
select 'V6 after', r ->> 'team_name', r ->> 'wins', r ->> 'losses', r ->> 'total', r ->> 'weeks' from jsonb_array_elements(contest_board((select id from H)) -> 'season' -> 'rows') r;
select 'V7 board says so', contest_board((select id from H), 4) ->> 'void', contest_board((select id from H), 4) -> 'voided', contest_board((select id from H), 5) ->> 'void';
select 'V8 chat', body from league_message where league_id = (select id from H) order by id desc limit 1;
select 'V9 again is a no-op', commish_void_week((select id from H), 4, true, 'x') ->> 'already';
select 'V10 week list', w ->> 'week', w ->> 'status', w ->> 'void', w ->> 'stamped' from jsonb_array_elements(contest_week_list((select id from H)) -> 'weeks') w;
select set_config('t.uid', :'C', false);
select 'V11 my weeks carry it', w ->> 'week', w ->> 'void' from jsonb_array_elements(bullseye_my_weeks((select id from H)) -> 'weeks') w order by 2;
select set_config('t.uid', :'B', false);
select 'V12 restore', commish_void_week((select id from H), 4, false) ->> 'void', (select count(*) from week_void);
select 'V13 counts again', r ->> 'team_name', r ->> 'wins', r ->> 'losses' from jsonb_array_elements(contest_board((select id from H)) -> 'season' -> 'rows') r;
-- the stat correction reaches the board
select 'A1 not on board', commish_set_player_adjustment((select id from H), 6, 'nobody', 3, 'why') ->> 'error';
select 'A2 adjust', commish_set_player_adjustment((select id from H), 6, 'hurts', 6, 'the TD the feed missed') - 'note';
select 'A3 search the board', jsonb_array_length(league_player_adjustments((select id from H), 6, 'hurts') -> 'found'),
       league_player_adjustments((select id from H), 6, 'hurts') -> 'found' -> 0 ->> 'owner', league_player_adjustments((select id from H), 6) -> 'adjustments' -> 0 ->> 'name';
-- the commissioner sets a squad
select 'S1 reads the seat', commish_contest_squad((select id from H), 6, 2) ->> 'team', jsonb_array_length(commish_contest_squad((select id from H), 6, 2) -> 'entry');
select 'S2 no reason', commish_set_contest_squad((select id from H), 6, 2, '{"S1":"allen","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}', '') ->> 'error';
select 'S3 still the rules', commish_set_contest_squad((select id from H), 6, 2, '{"S1":"allen","S2":"mccaffrey","S3":"barkley","S4":"lamb","S5":"brown","S6":"wilson","S7":"kittle","S8":"phi-k","S9":"sf-dst"}', 'why') ->> 'error';
select 'S4 past the kickoff lock', commish_set_contest_squad((select id from H), 6, 2, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"wilson","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}', 'his app died at 12:58') - 'spent';
select 'S5 written', e ->> 'player_slug' from sleeper_lineup, jsonb_array_elements(starters_json) e where league_id = (select id from H) and week = 6 and roster_id = 2 and e ->> 'slot' = 'S4';
select 'S6 logged', roster_id, note, before -> 3 ->> 'player_slug', after -> 3 ->> 'player_slug' from lineup_edit_log;
select 'S7 chat', body from league_message where league_id = (select id from H) order by id desc limit 1;
-- a stamped week: the board for week 4 is week 6's, copied
insert into pod_salary select season, 4, slug, name, pos, team, salary, proj, exp, priced_proj from pod_salary where week = 6;
select 'S8 rescore flag on a final week', commish_set_contest_squad((select id from H), 4, 2, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"wilson","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}', 'ruling') ->> 'rescore';
-- a member's save still runs through the one check
select set_config('t.uid', :'C', false);
select 'M1 member save ok', save_contest_entry((select id from H), 6, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'ok';
select 'M2 member budget', save_contest_entry((select id from H), 6, '{"S1":"allen","S2":"mccaffrey","S3":"barkley","S4":"lamb","S5":"brown","S6":"wilson","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'error';
select 'M3 member dup', save_contest_entry((select id from H), 6, '{"S1":"hurts","S2":"barkley","S3":"barkley","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'error';
select 'M4 not the commish', commish_set_contest_squad((select id from H), 6, 1, '{}', 'x') ->> 'error';
