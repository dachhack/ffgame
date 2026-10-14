-- Stale injury rows the NFL prune never reached (v0.708.5).
--
-- Founder: Brock Bowers shows Out; Sleeper (and ESPN) have him healthy. The
-- NFL injury poll upserts every row it still designates with updated_at = now,
-- so an NFL row whose updated_at lags the newest one is a row neither source
-- designates any more: exactly what the prune should have deleted. The
-- hypothesis is that its unpaged read stopped at PostgREST's 1000 rows.
-- Read only. Player names only (public NFL data), nothing about members.

\echo '── 1. Brock Bowers'
select player_slug, status, source, team, designation_date, updated_at
from injury_status where player_slug ilike '%bowers%';

\echo '── 2. table size by kind (the prune read stopped at 1000)'
select case when player_slug like 'c-%' then 'college'
            when player_slug ~ '^(nba|wnba|nhl|mlb|epl|mls)-\d+$' then split_part(player_slug, '-', 1)
            else 'nfl' end as kind,
       count(*) as rows, min(updated_at) as oldest, max(updated_at) as newest
from injury_status group by 1 order by 2 desc;

\echo '── 3. NFL rows older than the latest NFL poll (stranded: no source designates them)'
with nfl as (
  select * from injury_status
  where player_slug not like 'c-%' and player_slug !~ '^(nba|wnba|nhl|mlb|epl|mls)-\d+$'
), latest as (select max(updated_at) as at from nfl)
select count(*) as stranded,
       count(*) filter (where status = 'O') as stranded_out,
       count(*) filter (where status = 'IR') as stranded_ir
from nfl, latest where nfl.updated_at < latest.at - interval '1 hour';

\echo '── 4. the stranded NFL rows, oldest first'
with nfl as (
  select * from injury_status
  where player_slug not like 'c-%' and player_slug !~ '^(nba|wnba|nhl|mlb|epl|mls)-\d+$'
), latest as (select max(updated_at) as at from nfl)
select player_slug, status, source, team, updated_at
from nfl, latest where nfl.updated_at < latest.at - interval '1 hour'
order by updated_at limit 60;
