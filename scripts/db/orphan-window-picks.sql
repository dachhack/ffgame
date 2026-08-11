-- Find (and optionally delete) sealed_pick rows filed under a game_window that
-- doesn't exist in that week's slate.
--
-- WHERE THESE COME FROM: the mobile app installed the runtime slate without
-- kickoff times, and nflSlate.deriveWeek() abandons its real clustering for the
-- fixed regular-season five (tnf/early/late/snf/mnf) unless EVERY game carries a
-- kickoff. So a preseason board that should read tnf/tnf2/fri/sat/sat2/sat3
-- rendered five invented windows instead, and SEAL wrote picks against them.
-- Fixed in apps/mobile/src/screens/LivePicks.tsx; this cleans up what shipped
-- before the fix.
--
-- WHY IT MATTERS BEYOND THE CLUTTER: enforce_slot_cap (migration 0118) counts
-- every row for a matchup+user with a player_slug, and does not care whether the
-- window is real. A practice week caps at 12 and PRE 2's board renders 10, so a
-- handful of orphans is enough to push a manager over — at which point EVERY
-- later save fails with "lineup is full — 12 slots max" and the real board
-- cannot be edited at all. The orphans also never score: the worker resolves
-- against the real window ids.
--
-- Matching is against nfl_slate rather than a re-derivation of the window rule.
-- Migration 0118 explains why at length — a second copy of deriveWeek in SQL
-- caused a live bug once already (0100). nfl_slate.win is written by the worker
-- from the same windowIdsFromKickoffs the client uses, so it is the one
-- authority both dialects already share.
--
-- SAFETY: a week with no slate rows yet would make every window look orphaned,
-- so weeks that haven't synced are excluded outright rather than trusted.

-- ── 1. LOOK FIRST ────────────────────────────────────────────────────────────
-- Run this on its own. Every row it returns is one the delete below removes.
select
  m.id            as matchup_id,
  m.week,
  sp.app_user_id,
  sp.game_window  as orphan_window,
  sp.roster_slot,
  sp.player_slug,
  sp.locked
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
where sp.player_slug is not null
  -- Only weeks whose slate has actually landed.
  and exists (select 1 from nfl_slate ns where ns.week = m.week)
  and not exists (
    select 1 from nfl_slate ns
    where ns.week = m.week and ns.win = sp.game_window
  )
order by m.week, sp.app_user_id, sp.game_window, sp.roster_slot;

-- ── 2. HOW CLOSE TO THE CAP EACH MANAGER IS ──────────────────────────────────
-- `real` is what the board can legitimately hold; `orphans` is dead weight
-- counting against the same cap. Any row where real + orphans > 12 is a manager
-- whose saves are already failing.
select
  m.id as matchup_id, m.week, sp.app_user_id,
  count(*) filter (where exists (
    select 1 from nfl_slate ns where ns.week = m.week and ns.win = sp.game_window)) as real,
  count(*) filter (where not exists (
    select 1 from nfl_slate ns where ns.week = m.week and ns.win = sp.game_window)) as orphans,
  count(*) as total
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
where sp.player_slug is not null
  and exists (select 1 from nfl_slate ns where ns.week = m.week)
group by m.id, m.week, sp.app_user_id
having count(*) filter (where not exists (
    select 1 from nfl_slate ns where ns.week = m.week and ns.win = sp.game_window)) > 0
order by total desc;

-- ── 3. DELETE ────────────────────────────────────────────────────────────────
-- Only after reading §1. Locked rows are left alone: a locked pick has been
-- sealed server-side and may already carry a scored record, so removing one
-- rewrites history rather than tidying it. Locked orphans should not exist —
-- lock.js locks by real window id — but this refuses to be the thing that
-- discovers otherwise.
--
-- begin;
-- delete from sealed_pick sp
-- using matchup m
-- where m.id = sp.matchup_id
--   and sp.locked = false
--   and exists (select 1 from nfl_slate ns where ns.week = m.week)
--   and not exists (
--     select 1 from nfl_slate ns
--     where ns.week = m.week and ns.win = sp.game_window
--   );
-- -- Re-run §1 here; it should return nothing before you commit.
-- commit;
