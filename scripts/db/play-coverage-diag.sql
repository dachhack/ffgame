-- Play-data coverage for the live week (companion #3 in the Allen chase).
-- seat-adoption-check.sql proved the away seat now FIELDS josh-allen but every
-- live window scores 0.0 for BOTH sides while fri scores — so the question is
-- whether live_play (the worker's scoring input) actually holds the Saturday
-- plays it should. Read-only. Run via dbquery.yml.

-- 1) How many plays does each recent week hold?
select week, count(*) as plays, min(id) as min_id, max(id) as max_id
from live_play
group by week
order by week desc
limit 6;

-- 2) The players from the zero-scoring windows vs one who scores (fri).
select player_slug,
       count(*)                as rows,
       sum(y)                  as yards,
       sum(td)                 as tds
from live_play
where week = 102
  and player_slug in ('josh-allen','caleb-williams','devon-achane','trevor-lawrence','jahmyr-gibbs','christian-mccaffrey')
group by player_slug
order by player_slug;

-- 3) Does josh-allen exist under ANY week? (a mis-weeked write would land here)
select week, count(*) as rows, sum(y) as yards
from live_play
where player_slug = 'josh-allen'
group by week
order by week desc;

-- 4) The week's slate as the DB sees it — window labels + kickoffs.
select season, win, away, home, kickoff
from nfl_slate
where week = 102
order by kickoff nulls last;
