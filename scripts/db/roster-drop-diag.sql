-- A DROP THAT DIDN'T TAKE: why is a player still on a roster after the manager
-- dropped him in Sleeper?
--
-- Written for "Senz0Tanaka in Turf Warriors dropped Carson Beck yesterday but
-- he's still on the roster", with the sync demonstrably alive (Turf Warriors
-- had synced 18 minutes earlier). A live sync and a stale roster together are
-- the interesting case, because the obvious cause — the worker is dead — is
-- already ruled out.
--
-- ── THE HYPOTHESIS THIS FILE EXISTS TO TEST ────────────────────────────────
-- `syncWeek` writes ONE week: whatever `regularWeek()` returns, which is
-- ESPN's current REGULAR-season week. The board opens a different week:
-- `defaultOpenWeek` (liveApi.ts) picks the first week that isn't fully over,
-- ordered by real kickoff, and PRESEASON weeks (0110's 101+) sort ahead of the
-- regular season. So a league playing preseason has the worker refreshing
-- week N while every manager is looking at week 10x — and week 10x's
-- `sleeper_lineup` rows are frozen at whenever they were last written.
--
-- If that is what is happening, a drop can never appear, the sync log stays
-- green, and nothing anywhere reports a problem. Sections 1 and 2 answer it
-- directly: compare THE WEEK THE WORKER LAST WROTE against THE WEEK THE BOARD
-- OPENS. If they differ, that is the bug and no further looking is needed.
--
-- ── THE OTHER SHAPE TO WATCH FOR ───────────────────────────────────────────
-- Section 1 also prints entries-per-roster. A real Sleeper roster is ~15-25.
-- A week showing ~1000 per roster is not a roster at all — it is a whole-pool
-- seed (the preseason test weeks were built that way), and on such a week
-- EVERY player is "on" EVERY roster, so nothing can ever look dropped.
--
-- Edit the two lines below to ask about a different league or player.
\set LEAGUE 'Turf Warriors'
\set PLAYER 'Carson Beck'

\echo ''
\echo '── 1. Every week this league has lineups for: when written, and what SHAPE ──'
\echo '   entries_per_roster ~15-25 = a real roster. ~1000 = a whole-pool seed,'
\echo '   on which every player is on every roster and no drop can ever show.'
select
  sl.week,
  max(sl.synced_at)                                          as last_written,
  age(now(), max(sl.synced_at))::text || ' ago'              as freshness,
  count(distinct sl.roster_id)                               as rosters,
  sum(jsonb_array_length(sl.starters_json))                  as entries,
  round(sum(jsonb_array_length(sl.starters_json))::numeric
        / nullif(count(distinct sl.roster_id), 0), 0)        as entries_per_roster,
  case when sum(jsonb_array_length(sl.starters_json))
            / nullif(count(distinct sl.roster_id), 0) > 200
       then 'WHOLE-POOL SEED — nothing can look dropped here'
       else 'real roster' end                                as shape
from sleeper_lineup sl
join league l on l.id = sl.league_id
where l.name = :'LEAGUE'
group by sl.week
order by max(sl.synced_at) desc nulls last;

\echo ''
\echo '── 2. THE COMPARISON THAT USUALLY ENDS IT ──'
\echo '   left = the week the worker last refreshed (syncWeek writes ONE week).'
\echo '   right = the week the board opens, mirroring defaultOpenWeek exactly:'
\echo '   ordered by real kickoff, first week not yet fully over (+4h), and'
\echo '   preseason 101+ sorts ahead of the regular season by kickoff.'
\echo '   IF THESE DIFFER, the manager is reading a week nothing refreshes.'
with lg as (select id, season from league where name = :'LEAGUE'),
kicks as (
  select s.week, min(s.kickoff) as first_k, max(s.kickoff) as last_k
  from nfl_slate s join lg on s.season = lg.season
  where s.kickoff is not null group by s.week
),
weeks as (select distinct m.week from matchup m join lg on m.league_id = lg.id),
ordered as (
  select w.week, k.first_k, k.last_k
  from weeks w left join kicks k on k.week = w.week
  order by k.first_k nulls last, w.week
),
opens as (
  select week from ordered
  where last_k is null or now() <= last_k + interval '4 hours'
  limit 1
)
select
  (select sl.week from sleeper_lineup sl join lg on sl.league_id = lg.id
    order by sl.synced_at desc nulls last limit 1)          as worker_last_wrote_week,
  coalesce((select week from opens),
           (select week from ordered order by first_k desc nulls first limit 1)) as board_opens_week,
  case
    -- NULL on either side is "no data", not "aligned". Two nulls compare as
    -- not-distinct, so without this a misspelled league name would report a
    -- clean bill of health for a league that was never looked at.
    when (select sl.week from sleeper_lineup sl join lg on sl.league_id = lg.id
           order by sl.synced_at desc nulls last limit 1) is null
      then 'NO LINEUP ROWS — check the league name in \set LEAGUE'
    when coalesce((select week from opens),
                  (select week from ordered order by first_k desc nulls first limit 1)) is null
      then 'NO MATCHUPS — the league has no schedule to open'
    when (select sl.week from sleeper_lineup sl join lg on sl.league_id = lg.id
           order by sl.synced_at desc nulls last limit 1)
         <> coalesce((select week from opens),
                     (select week from ordered order by first_k desc nulls first limit 1))
      then 'MISMATCH — the board reads a week the worker never refreshes'
    else 'aligned — look further (sections 3-4)' end          as verdict;

\echo ''
\echo '── 3. Where does the player actually appear? ──'
\echo '   One row per (week, roster) holding him. If he is present on an OLD'
\echo '   week and absent from the freshly-synced one, the drop DID land — it'
\echo '   just landed somewhere nobody is looking.'
select
  sl.week,
  sl.roster_id,
  lm.team_name,
  sl.synced_at,
  e->>'grp'        as grp,
  e->>'player_slug' as slug,
  e->>'pos'        as pos,
  e->>'team'       as nfl_team
from sleeper_lineup sl
join league l on l.id = sl.league_id
left join league_membership lm
       on lm.league_id = sl.league_id and lm.sleeper_roster_id = sl.roster_id
cross join lateral jsonb_array_elements(sl.starters_json) e
where l.name = :'LEAGUE'
  and (e->>'full' ilike '%' || :'PLAYER' || '%'
       or e->>'player_slug' = lower(replace(:'PLAYER', ' ', '-')))
order by sl.synced_at desc nulls last, sl.week, sl.roster_id;

\echo ''
\echo '── 4. …and which weeks does he NOT appear in? ──'
\echo '   A week that has lineups but no row here is a week the drop reached.'
select sl.week, max(sl.synced_at) as last_written
from sleeper_lineup sl
join league l on l.id = sl.league_id
where l.name = :'LEAGUE'
  and not exists (
    select 1 from jsonb_array_elements(sl.starters_json) e
    where e->>'full' ilike '%' || :'PLAYER' || '%'
       or e->>'player_slug' = lower(replace(:'PLAYER', ' ', '-'))
  )
group by sl.week
order by max(sl.synced_at) desc nulls last;

\echo ''
\echo '── 5. Is this league even in the sync loop? ──'
\echo '   syncAllLeagues only walks PILOT_LEAGUE_IDS. A Sleeper league missing'
\echo '   from that env var is imported once and then never refreshed again —'
\echo '   which looks exactly like this from the board. The id below is what'
\echo '   would have to appear in PILOT_LEAGUE_IDS.'
select name, provider, sleeper_league_id, season, synced_at as imported_at
from league where name = :'LEAGUE';
