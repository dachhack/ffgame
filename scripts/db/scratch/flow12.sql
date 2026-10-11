\set ON_ERROR_STOP on
-- 0469: the cap is optional; golf gets a floor. After the flow10 setup.
\i scripts/db/scratch/flow10.sql
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
select set_config('t.uid', :'B', false);
select 'sums', (select sum(salary) from pod_salary where slug in ('hurts','barkley','hall','lamb','brown','kelce-wr','kittle','phi-k','sf-dst')) as cheap,
               (select sum(salary) from pod_salary where slug in ('allen','mccaffrey','barkley','lamb','brown','wilson','kittle','phi-k','sf-dst')) as pricey;
select 'A no cap create', create_contest_league('NC','bullseye','board','season',4, 0) -> 'bullseye' ->> 'budget';
create temp table NC as select id, invite_code from league where name='NC';
select 'B golf floor create', create_contest_league('GF','golf','board','season',4, 0, 'slots', 10, null, '2026', 45000) -> 'bullseye' ->> 'min_spend';
create temp table GF as select id, invite_code from league where name='GF';
select 'C floor above cap refused', create_contest_league('X','golf','board','season',4, 30000, 'slots', 10, null, '2026', 45000) ->> 'error';
select 'C2 bad cap refused', create_contest_league('X','high','board','season',4, 5000) ->> 'error';
select 'E0 floor raised to $50k', set_contest_rules((select id from GF), null, null, null, 50000) -> 'bullseye' ->> 'min_spend';
select set_config('t.uid', :'C', false);
select 'D join', join_contest((select invite_code from GF)) ->> 'roster_id', join_contest((select invite_code from NC)) ->> 'roster_id';
select 'E under floor refused', save_contest_entry((select id from GF), 6, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'error';
select 'E2 cheap squad under a $50k floor by $1,700', save_contest_entry((select id from GF), 6, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'error';
select 'F pricey squad clears the floor (no cap)', save_contest_entry((select id from GF), 6, '{"S1":"allen","S2":"mccaffrey","S3":"barkley","S4":"lamb","S5":"brown","S6":"wilson","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') - 'roster_id';
select 'G no cap bullseye saves the pricey squad', save_contest_entry((select id from NC), 6, '{"S1":"allen","S2":"mccaffrey","S3":"barkley","S4":"lamb","S5":"brown","S6":"wilson","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'ok';
select set_config('t.uid', :'B', false);
select 'H rules: floor set', set_contest_rules((select id from G), null, null, null, 20000) -> 'bullseye' ->> 'min_spend';
select 'I rules: cap off', set_contest_rules((select id from H), null, null, 0) -> 'bullseye' ->> 'budget';
select 'J rules: floor above cap refused', set_contest_rules((select id from H), null, null, 30000, 45000) ->> 'error';
select 'K rules: bad floor refused', set_contest_rules((select id from H), null, null, null, 2000) ->> 'error';
select 'L state carries the floor', contest_state((select id from GF)) ->> 'min_spend', contest_state((select id from GF)) ->> 'budget';
select 'M info', _bullseye_info(l.*) ->> 'min_spend' from league l where id=(select id from GF);
