\set ON_ERROR_STOP on
-- the flow10 setup, then: an injured new pick is refused; one already saved may stay
\i scripts/db/scratch/flow10.sql
insert into injury_status (player_slug, status) values ('lamb', 'O') on conflict (player_slug) do update set status = 'O';
select 'A out pick refused', save_contest_entry((select id from league where kind = 'dfs' and settings_json ->> 'contest_format' = 'h2h' order by created_at limit 1), 6, '{"S1":"hurts","S2":"barkley","S3":"hall","S4":"lamb","S5":"brown","S6":"kelce-wr","S7":"kittle","S8":"phi-k","S9":"sf-dst"}') ->> 'error';
select 'B priced_proj backfilled', count(*) = count(priced_proj) from pod_salary;
