-- THE WEEKLY MATCHUP AUDIT, from the command line (v0.430.0). Read-only.
-- Run via dbquery.yml; prints admin_week_audit's JSON for the weeks below,
-- one line per week between markers. Render it with core's auditText:
--   npx tsx -e "import('./packages/core/src/data/weekAudit.ts').then(m => console.log(m.auditText(JSON.parse(process.argv[1]))))" '<json>'
-- (The admin console's SYSTEM → WEEKLY MATCHUP AUDIT panel is the same read.)
--
-- admin_week_audit is admin-gated on the caller's JWT email; a psql session
-- has none, so the founder's super-admin identity is set for this transaction
-- only (SET LOCAL — dbquery runs the file in one read-only transaction).
select set_config('request.jwt.claims', '{"email":"mlporritt@gmail.com","role":"authenticated"}', true);
\pset format unaligned
\pset tuples_only on
\echo === WEEK 2 ===
select admin_week_audit(2, '2026')::text;
\echo === WEEK 1 ===
select admin_week_audit(1, '2026')::text;
\echo === END ===
