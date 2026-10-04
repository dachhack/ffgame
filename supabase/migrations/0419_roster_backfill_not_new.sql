-- ═══════════════════════════════════════════════════════════════════════════
-- 0419 · PLAYERS THE ROSTER SWEEP MISSED ARE NOT "NEW" (v0.603.0).
--
-- Founder, over the devy values list: "How do we have guys with no schools?"
-- ESPN's roster endpoint returns 100 athletes unless asked for more, and a big
-- program carries 120+, so since 0365 the rest of every big roster never
-- reached college_player: Bryant Wesco Jr. (Clemson), Ryan Wingo (Texas),
-- Bryce Underwood (Michigan) and Demond Williams Jr. (Washington) among them.
-- With no college_player row they had no school or class, no devy price (the
-- 1-point floor), and no place in a league's college pool.
--
-- The worker now asks for ?limit=300. The catch: a player first seen after a
-- league's market opened is a NEW LISTING (0407), held for a launch window.
-- These players were on their rosters all along, so the backfill must not list
-- hundreds of them as new. Until Oct 5, 2026 (covering the sweep this release
-- runs, ops 029), a newly inserted player is dated 2026-01-01, the same
-- baseline 0407 gave everyone already known. After that date the trigger does
-- nothing and new players list as before.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _college_roster_backfill() returns trigger
  language plpgsql as $$
begin
  if now() < timestamptz '2026-10-05 00:00+00' then new.first_seen := timestamptz '2026-01-01'; end if;
  return new;
end $$;

drop trigger if exists college_player_roster_backfill on college_player;
create trigger college_player_roster_backfill before insert on college_player
  for each row execute function _college_roster_backfill();
