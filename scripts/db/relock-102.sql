-- The manual admin lock that ends the 0134 emergency hold on practice week 102.
-- Run via the "Run a database query" workflow WITH allow_writes — it is the
-- deliberate act the hold was waiting for.
--
-- Order matters: drop the hold first so the trigger's kickoff gate is back,
-- then hand the matchups to the worker by making lock_at "now" — its next tick
-- (~25s) flips them live, seals every kicked-off window's picks, and
-- materializes auto-lineups for AI seats exactly as a natural lock would.
delete from lock_hold where week = 102;

update matchup set lock_at = now()
  where week = 102 and status = 'scheduled';

-- Receipts.
select status, count(*) matchups from matchup where week = 102 group by status;
select count(*) as still_unsealed from sealed_pick
  where not locked and matchup_id in (select id from matchup where week = 102);
