\set ON_ERROR_STOP on
\i scripts/db/scratch/flow12.sql
select set_config('t.uid', :'B', false);
select 'N auto-sub on', set_contest_rules((select id from G), null, null, null, null, true) -> 'bullseye' ->> 'auto_sub';
select 'N2 auto-sub off', set_contest_rules((select id from G), null, null, null, null, false) -> 'bullseye' ->> 'auto_sub';
select 'N3 info default', _bullseye_info(l.*) ->> 'auto_sub' from league l where id=(select id from GF);
select 'O first lock is the first kickoff', _week_first_lock('2026', 6) = (select min(kickoff) from nfl_slate where season='2026' and week=6);
select 'P the rules still take the floor', set_contest_rules((select id from G), null, null, null, 25000) -> 'bullseye' ->> 'min_spend';
