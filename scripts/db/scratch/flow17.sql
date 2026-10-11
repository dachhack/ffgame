\set ON_ERROR_STOP on
\i scripts/db/scratch/flow10.sql
-- 0475: the no-show rule and the entry deadline. H is head-to-head (B
-- commissions), G the golf board.
select set_config('t.uid', :'B', false);
select 'F0 plain rules again', set_contest_rules((select id from H), 'high', null, 60000) ->> 'ok';
-- flow10 flips G to head-to-head on its way through; a fresh golf board for the board cases
select 'F1 a golf board', create_contest_league('Golf Board', 'golf', 'board', 'season', 12, 50000) ->> 'ok';
create temp table GB as select id from league where name = 'Golf Board';
select 'L0 defaults', (contest_league((select id from H)) -> 'bullseye') ->> 'late_entry', (contest_league((select id from H)) -> 'bullseye') ->> 'entry_deadline',
       (contest_league((select id from GB)) -> 'bullseye') ->> 'late_entry';
select 'L1 bad word', set_contest_rules((select id from H), null, null, null, null, null, 'maybe') ->> 'error';
select 'L2 h2h cannot drop', set_contest_rules((select id from H), null, null, null, null, null, 'drop') ->> 'error';
select 'L3 h2h zero', set_contest_rules((select id from H), null, null, null, null, null, 'zero') -> 'bullseye' ->> 'late_entry';
select 'L4 golf zero needs the penalty', set_contest_rules((select id from GB), null, null, null, null, null, 'zero') ->> 'error';
update league set settings_json = jsonb_set(settings_json, '{roster_slots}', (select jsonb_agg(d || '{"zero_pts": 20}') from jsonb_array_elements(coalesce(settings_json -> 'roster_slots', _contest_default_slots())) d)) where id = (select id from GB);
select 'L5 golf zero with it', set_contest_rules((select id from GB), null, null, null, null, null, 'zero') -> 'bullseye' ->> 'late_entry';
select 'L6 board drop', set_contest_rules((select id from GB), null, null, null, null, null, 'drop') -> 'bullseye' ->> 'late_entry';
select 'L7 deadline', set_contest_rules((select id from H), null, null, null, null, null, null, 'first') -> 'bullseye' ->> 'entry_deadline',
       set_contest_rules((select id from H), null, null, null, null, null, null, 'sometime') ->> 'error';
-- the deadline: Eve has no squad; the week kicks off
select set_config('t.uid', :'C', false);
select 'D1 before kickoff she may enter', save_contest_entry((select id from H), 6, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'ok';
delete from sleeper_lineup where league_id = (select id from H) and roster_id = 2;
update nfl_slate set kickoff = now() - interval '1 hour' where week = 6 and home = 'NYJ';
select 'D2 after it, no new squad', save_contest_entry((select id from H), 6, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'error';
-- the worker wrote her the empty squad (zero): still no entry
insert into sleeper_lineup (league_id, week, roster_id, starters_json) values ((select id from H), 6, 2, '[]');
select 'D3 an empty no-show squad is no squad', save_contest_entry((select id from H), 6, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'error';
-- a saved squad still swaps its unlocked players
update sleeper_lineup set starters_json = '[{"slot":"S1","player_slug":"hurts","pos":"QB"},{"slot":"S2","player_slug":"barkley","pos":"RB"},{"slot":"S3","player_slug":"hall","pos":"RB"},{"slot":"S4","player_slug":"lamb","pos":"WR"},{"slot":"S5","player_slug":"brown","pos":"WR"},{"slot":"S6","player_slug":"kelce-wr","pos":"WR"},{"slot":"S7","player_slug":"kittle","pos":"TE"},{"slot":"S8","player_slug":"phi-k","pos":"K"},{"slot":"S9","player_slug":"sf-dst","pos":"DEF"}]' where league_id = (select id from H) and roster_id = 2;
-- (Barkley out, McCaffrey in — neither has kicked off; Hall stays, he has)
select 'D4 a saved squad still swaps', save_contest_entry((select id from H), 6, '{"S1":"hurts","S2":"mccaffrey","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'ok';
select set_config('t.uid', :'B', false);
select 'D5 open again', set_contest_rules((select id from H), null, null, null, null, null, null, 'open') -> 'bullseye' ->> 'entry_deadline';
delete from sleeper_lineup where league_id = (select id from H) and roster_id = 2;
select set_config('t.uid', :'C', false);
-- (the Jets have kicked off, so no Breece Hall in a late squad)
select 'D6 open: a late squad goes in', save_contest_entry((select id from H), 6, '{"S1":"hurts","S2":"barkley","S3":"mccaffrey","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'ok';
select 'W1 one overload', count(*) from pg_proc where proname = 'set_contest_rules';
