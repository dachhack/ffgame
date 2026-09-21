-- 0315: REFRESH EVERY LEAGUE'S WEEK POOLS NOW (v0.434.5). A data migration.
--
-- Founder, the morning after 0314: "Can we refresh the week 2 pool now?"
--
-- 0314 taught native_materialize to refresh a LIVE week add-only, but it
-- runs when a roster changes — and the live week's pools in every native
-- league were last written at the week's first kickoff, before Sunday's
-- waiver run. Rather than wait for the next transaction in each league,
-- run the refresh once for every native league here. Idempotent and safe
-- by construction: scheduled weeks are rewritten from the rosters (as any
-- transaction would do), live weeks only gain the players missing from
-- them, final weeks are never touched. Prints a NOTICE per league.
do $$
declare l record; n int; total int := 0;
begin
  for l in select id, name from league where is_native_league(id) order by created_at loop
    n := native_materialize(l.id);
    total := total + n;
    raise notice '0315: % — % week pool(s) refreshed', l.name, n;
  end loop;
  raise notice '0315: done — % week pool(s) across native leagues', total;
end $$;
