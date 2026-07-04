-- 0058: fix admin_audit statement timeouts ("canceling statement due to
-- statement timeout" on the super-admin page).
--
-- Two compounding problems:
--   1. audit_log has no index on `at` (only the PK), so admin_audit's
--      `order by at desc limit N` full-scans and sorts the whole table.
--   2. The applied_state trigger audits EVERY live scoring tick with full
--      old+new row jsonb. applied_state is machine-written scoring state, not
--      a human edit — during live games/sims it floods the log, growing it
--      until the sort blows the (~8s) statement timeout.
--
-- Fix: stop auditing applied_state (matchup + sealed_pick — the actual human
-- edits — stay audited), and index the timeline so "latest N" is an index
-- scan regardless of table size. `concurrently` avoids blocking live writes;
-- the migration runner applies files statement-by-statement in autocommit, so
-- it's allowed here.
--
-- Existing applied_state audit rows are kept (harmless once indexed). If the
-- table's size ever matters, purge them with:
--   delete from audit_log where table_name = 'applied_state';

drop trigger if exists audit_applied_state on applied_state;

-- admin_audit: latest-N by time.
create index concurrently if not exists audit_log_at_idx
  on audit_log (at desc);

-- commish_audit: latest-N matchup rows by time.
create index concurrently if not exists audit_log_table_at_idx
  on audit_log (table_name, at desc);
