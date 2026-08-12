-- Is the Fly worker running, and is it running the CURRENT code?
--
-- WHAT NOT TO USE: league.synced_at is NOT a worker heartbeat, however much it
-- reads like one. It is stamped by importLeague() — the one-off league import —
-- and the weekly sync never touches it. syncAllLeagues() calls syncWeek(),
-- which writes nfl_slate, matchup and sleeper_lineup and nothing else. So a
-- synced_at four days old means "this league was imported on Tuesday", not
-- "the worker is dead", and reading it the other way cost an hour here.
--
-- WHAT TO USE INSTEAD, in order of how directly it answers the question:
--
--   1. The deploy run log. `.github/workflows/deploy-worker.yml` prints the
--      worker's own output after every deploy. `weekly sync: week N — ok/total
--      leagues` is the heartbeat, from the process itself. Nothing here beats
--      that; these queries are for the days you have not just deployed.
--   2. Sections 1–3 below: did the week's mirror actually land, and does it
--      have the shape the current code produces.
--
-- There is deliberately no "when did the weekly sync last run" column. Adding
-- one to sleeper_lineup would make that a single query instead of an inference
-- — worth doing if this file gets run often.

\echo ''
\echo '── 1. Did the week mirror land? (matchup, written by syncWeek) ──'
select
  l.name,
  m.week,
  count(*)                                        as matchups,
  count(*) filter (where m.status = 'live')       as live,
  count(*) filter (where m.status = 'final')      as final,
  max(m.created_at)                               as newest_row,
  count(*) filter (where m.lock_at is not null)   as with_lock_at
from matchup m
join league l on l.id = m.league_id
group by 1, 2
order by m.week desc, 1
limit 12;

\echo ''
\echo '── 2. Is the pool the WHOLE roster, or just starters? ──'
\echo '   The `grp` key and the bench/ir/taxi buckets only exist in the current'
\echo '   sync. A week with no `grp` at all was written by the old code, which is'
\echo '   what "I should have players available for TNF" looked like.'
select
  l.name,
  sl.week,
  count(distinct sl.roster_id)                                 as rosters,
  sum(jsonb_array_length(sl.starters_json))                    as entries,
  count(*) filter (where sl.starters_json::text like '%"grp"%') as rows_with_grp
from sleeper_lineup sl
join league l on l.id = sl.league_id
group by 1, 2
order by sl.week desc, 1
limit 12;

\echo ''
\echo '── 3. Group breakdown for the most recent week ──'
\echo '   Expect start + bench, and ir/taxi where the league has those slots. A'
\echo '   row that is 100% `start` is the old shape.'
with latest as (select max(week) as w from sleeper_lineup)
select
  l.name,
  sl.week,
  coalesce(e->>'grp', '(none)') as grp,
  count(*)                      as players
from sleeper_lineup sl
join league l on l.id = sl.league_id
cross join lateral jsonb_array_elements(sl.starters_json) e
where sl.week = (select w from latest)
group by 1, 2, 3
order by 1, 3;

\echo ''
\echo '── 4. Live-side health (only moves during games) ──'
\echo '   Blank on a Wednesday is CORRECT. This is here so a Sunday run of the'
\echo '   same file answers the resolver question too — see docs/sunday-ops-runbook.md.'
select
  (select max(ingested_at) from live_play)              as last_play_ingest,
  (select count(*) from live_play)                      as live_plays,
  (select count(*) from matchup where status = 'live')  as live_matchups,
  (select count(*) from matchup where status = 'final') as final_matchups;

\echo ''
\echo '── 5. League import times (NOT a worker heartbeat — see header) ──'
select l.name, l.sleeper_league_id, l.season, l.synced_at as imported_at
from league l
order by l.synced_at desc nulls last
limit 10;
