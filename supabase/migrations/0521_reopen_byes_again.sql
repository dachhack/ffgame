-- ═══════════════════════════════════════════════════════════════════════════
-- 0521 · REOPEN THE BYES AGAIN (v0.732.6)
--
-- Test Wedding, week 7: "Still can't move them". 0520 reopened 11 classic
-- spots holding a pooled bye, and the worker re-sealed them on its next tick:
-- its league_pool read was one select over every classic league, cut at
-- PostgREST's 1000 rows, so a bye past the cap read as unpooled and sealed at
-- Thursday's kickoff (v0.732.5 reads every page). Same repair as 0520, run
-- once more now that the v0.732.5 worker is live.
-- ═══════════════════════════════════════════════════════════════════════════

do $$ begin
  raise notice '0521: reopened % classic spot(s) holding a player on bye', _reopen_sealed_byes();
end $$;
