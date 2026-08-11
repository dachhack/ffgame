-- WHO IS ACTUALLY IN MY POOL, AND WHAT DOES THIS WEEK'S SLATE LOOK LIKE.
--
-- WHY THIS EXISTS: "I should have players available for TNF" and the window
-- shows nobody. There are two very different causes and they look identical
-- from the board:
--
--   1. The pool is Sleeper's STARTERS only, and none of them play in that
--      window. Your SF/LAR guys are on the bench, and the bench isn't in the
--      pool yet. Fixed by deploying the worker and re-syncing the league.
--   2. The player IS in the pool, but their NFL team couldn't be resolved, so
--      windowPools() dropped them from every window. buildLiveLeague already
--      warns about this by name in the browser console ("[hero board] wk…: N
--      rostered player(s) have no resolvable NFL team").
--
-- Section 2 below separates them: if the pool is 11 rows and your Thursday
-- players aren't listed, it's (1). If they ARE listed and the window is still
-- empty, it's (2), and the console names them.
--
-- Read-only. Set the three variables below.

\set league_name 'Console Warriors%'
\set week 1
\set roster_id 1

-- ── 1. Pool size, and the starters/bench/IR/taxi split ───────────────────────
-- Before the whole-roster sync, `grp` is absent on every entry and this prints
-- one row: (none) = starters only. After a re-sync it should print four.
-- That single fact tells you whether the change is actually live.
select
  coalesce(e ->> 'grp', '(none — pre-whole-roster sync)') as roster_group,
  count(*)                                               as players
from sleeper_lineup sl
join league l on l.id = sl.league_id,
     lateral jsonb_array_elements(sl.starters_json) e
where l.name like :'league_name'
  and sl.week = :week
  and sl.roster_id = :roster_id
group by 1
order by 1;

-- ── 2. Every player in the pool, in slot order ───────────────────────────────
-- Read this against your own roster. A Thursday player you own who is NOT in
-- this list is cause (1) above — the bench simply isn't synced yet.
select
  (e ->> 'slot')::int                       as slot,
  coalesce(e ->> 'grp', 'start')            as grp,
  e ->> 'pos'                               as pos,
  coalesce(e ->> 'player_slug', e ->> 'slug') as player,
  e ->> 'sleeper_id'                        as sleeper_id
from sleeper_lineup sl
join league l on l.id = sl.league_id,
     lateral jsonb_array_elements(sl.starters_json) e
where l.name like :'league_name'
  and sl.week = :week
  and sl.roster_id = :roster_id
order by 1;

-- ── 3. The week's slate, by window ───────────────────────────────────────────
-- Which NFL teams play in which window — so "who could possibly fill TNF" is a
-- fact rather than a guess. The board derives its windows from these kickoffs;
-- a window missing here is a window the board cannot offer anyone for.
select
  win,
  count(*)                                   as games,
  string_agg(away || ' @ ' || home, ', ' order by kickoff) as matchups,
  min(kickoff)                               as first_kickoff
from nfl_slate
where week = :week
group by win
order by first_kickoff;
