-- Fill lock_at on scheduled matchups that have none.
--
-- WRITES. Run with allow_writes = true. Read it first — that is what the
-- read-only default is for.
--
-- WHY THIS EXISTS, rather than the sync workflow. A scheduled matchup with a
-- null lock_at can never lock: the worker's sweep selects
-- `.not('lock_at','is',null).lte('lock_at', now)`, so a null simply never
-- matches. Picks never seal, cards never reveal, resolve never runs — and the
-- board still shows a countdown, because the client derives that label from the
-- slate rather than from this column. It looks completely fine right up until
-- nothing happens.
--
-- The obvious fix — the sync workflow — CANNOT do it for a preseason week.
-- `sync-week` mirrors Sleeper, and Sleeper has no preseason pairings, so
-- week 102 (our offset week for preseason 2) comes back empty:
--
--   synced week 102 { matchups: 0, lineups: 0, lockAt: null }
--
-- Green run, no effect. Our preseason matchups come from the practice-seeding
-- path, not from Sleeper, so there is nothing at Sleeper to re-mirror.
--
-- The worker's own backfillLockAt would do this, but only for the week ESPN
-- currently reports as active — a week whose games are tomorrow may not be
-- "current" until tomorrow, which is too late to be the plan.
--
-- So take it from nfl_slate, which already holds every kickoff for these weeks
-- and is what the board itself reads. First kickoff of the week minus one hour,
-- the same rule as LOCK_LEAD_MS in core, server config.lockLeadMs, and the
-- enforce_window_lock trigger.
--
-- Scoped hard: only `scheduled`, only where lock_at IS NULL, only weeks the
-- slate actually knows kickoffs for. It cannot move a lock that already exists
-- and it cannot touch a live or final matchup.

\echo ''
\echo '── BEFORE: scheduled matchups with no lock_at, and what they would get ──'
select
  l.name                              as league,
  m.week,
  count(*)                            as matchups,
  min(s.first_kick)                   as first_kickoff,
  min(s.first_kick) - interval '1 hour' as would_set_lock_at
from matchup m
join league l on l.id = m.league_id
join (select season, week, min(kickoff) as first_kick
        from nfl_slate where kickoff is not null group by season, week) s
  on s.week = m.week and s.season = l.season
where m.status = 'scheduled' and m.lock_at is null
group by l.name, m.week
order by m.week;

\echo ''
\echo '── APPLYING ──'
update matchup m
   set lock_at = s.first_kick - interval '1 hour'
  from (select season, week, min(kickoff) as first_kick
          from nfl_slate where kickoff is not null group by season, week) s,
       league l
 where l.id = m.league_id
   and s.week = m.week
   and s.season = l.season
   and m.status = 'scheduled'
   and m.lock_at is null;

\echo ''
\echo '── AFTER: every scheduled matchup, so a remaining null is visible ──'
select
  l.name    as league,
  m.week,
  count(*)  as matchups,
  count(m.lock_at) as with_lock_at,
  min(m.lock_at)   as locks_at
from matchup m
join league l on l.id = m.league_id
where m.status = 'scheduled'
group by l.name, m.week
order by m.week, l.name;
