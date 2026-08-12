-- Is the Fly worker running, and is it running the CURRENT code?
--
-- Two questions that look the same and aren't. A machine can be `started` and
-- have died on the first line of main(); a machine can be running last month's
-- image. `flyctl status` answers neither. These do, from the only side that
-- matters — what actually landed in the database.
--
--   fly deploy → green            says an image shipped
--   flyctl status → started       says a process exists
--   league.synced_at moved        says the worker BOOTED, reached main(), ran
--                                 syncTick, reached Sleeper AND reached us
--
-- league.synced_at is stamped by server/src/sync.js and by nothing else — the
-- client-side syncWeek (packages/core/data/sleeperAdmin.ts) doesn't write it.
-- So a fresh synced_at cannot come from someone pressing a button in the app.
-- It is the worker or it is nobody.

\echo ''
\echo '── 1. When did the worker last sync each pilot league? ──'
\echo '   syncTick runs on boot, so this should be within a minute or two of a'
\echo '   deploy. Anything older than weeklySyncRefreshMs means it is not ticking.'
select
  l.name,
  l.sleeper_league_id,
  l.season,
  l.synced_at,
  case
    when l.synced_at is null then 'NEVER — the worker has not synced this league'
    else age(now(), l.synced_at)::text || ' ago'
  end as last_sync
from league l
order by l.synced_at desc nulls last
limit 10;

\echo ''
\echo '── 2. Is the pool the WHOLE roster, or just starters? ──'
\echo '   The `grp` key and the bench/ir/taxi buckets only exist in the current'
\echo '   sync. A week with no `grp` at all was written by the old code, which is'
\echo '   what "I should have players available for TNF" looked like.'
select
  l.name,
  sl.week,
  count(distinct sl.roster_id)                              as rosters,
  sum(jsonb_array_length(sl.starters_json))                 as entries,
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
  (select max(ingested_at) from live_play)         as last_play_ingest,
  (select count(*) from live_play)                 as live_plays,
  (select count(*) from matchup where status = 'live')  as live_matchups,
  (select count(*) from matchup where status = 'final') as final_matchups;
