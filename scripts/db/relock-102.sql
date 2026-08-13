-- Release every remaining week-102 hold (the 2026-08-13 emergency, since
-- migrated to per-league week_lock_hold by 0136). Superseded by the AdminPage
-- 🔓 WEEK LOCK buttons — kept for the dbquery workflow as a bulk fallback.
-- Run WITH allow_writes.
--
-- Same semantics as admin_set_week_lock(…, true): drop the holds and NULL the
-- lock_at so the worker's backfill restores each league's natural lock time —
-- past due locks on the next tick, not-yet-due locks when nature says so.
delete from week_lock_hold where week = 102;

update matchup set lock_at = null
  where week = 102 and status = 'scheduled' and lock_at >= '2098-01-01';

-- Receipts.
select l.name, m.status, count(*) matchups
  from matchup m join league l on l.id = m.league_id
  where m.week = 102 group by l.name, m.status order by l.name;
