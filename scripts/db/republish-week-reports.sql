-- REPUBLISH A WEEK'S REPORTS after a stamp taken too early. WRITES — run with
-- allow_writes ON. Idempotent, and safe to run twice; it is MEANT to be run
-- twice.
--
-- The damage: `stampFinals` stamps a final matchup once and never revisits it
-- (resolve.js), so a week closed while a game was still on froze every final
-- at the score it had mid-game — in the standings, in the header records and
-- in the frozen `league_report` payload. v0.457.0 stops it happening again
-- (the scoreboard is checked against the slate, finals re-resolve until the
-- 4 AM release); this repairs the week it already happened to.
--
-- TWO STEPS, ONE FILE, BY DESIGN:
--   1. clears every stale stamp for the week. The worker's stampFinals then
--      re-resolves them from the plays it has NOW, within a tick or two.
--   2. queues a report rebuild for every league whose STORED report still
--      disagrees with its finals — which, on the first run, is nobody, because
--      step 1 has just nulled them.
-- So: run it, wait a few minutes for the worker, run it again. The second run
-- finds nothing stale (step 1 writes nothing) and queues the rebuilds (step 2).
-- A third run does nothing at all.
--
-- The rebuild goes through `report_request`, the same queue the admin console
-- files: the worker replaces the stored payload AND deletes the old chat line
-- before posting the new one, so the league sees one report, corrected.
\set QUIET on
\pset pager off
\pset format aligned
\pset null '·'
\set ON_ERROR_STOP on
\set wk 2

-- ── the safety: refuse while the week is still being played ────────────────
-- Clearing a stamp mid-game is exactly what put this week wrong. ON_ERROR_STOP
-- means this raise ends the script before anything is written.
select (select count(*) from nfl_slate
         where week = :wk and season = (select max(season) from nfl_slate where week = :wk))::text as slate_n,
       (select count(*) from game_feed where week = :wk)::text as feed_n,
       (select count(*) from game_feed where week = :wk and state is distinct from 'post')::text as live_n
\gset
select (((:slate_n = 0) or (:feed_n >= :slate_n)) and :live_n = 0)::text as week_over \gset
\if :week_over
\echo '  week' :wk 'looks complete — proceeding.'
\else
\echo '  REFUSING — the week is still being played.'
\echo '  the feed holds' :feed_n 'of' :slate_n 'scheduled games ·' :live_n 'not yet post.'
\echo '  Clearing a stamp mid-game is exactly what put this week wrong. Nothing written.'
\q
\endif

\echo
\echo '════ STEP 1 · clear the stale stamps (the worker re-resolves them) ════'
with stale as (
  select m.id,
         round(m.home_final, 1) as was_home, round(m.away_final, 1) as was_away,
         round((select sum(s.home_score) from matchup_state s where s.matchup_id = m.id), 1) as now_home,
         round((select sum(s.away_score) from matchup_state s where s.matchup_id = m.id), 1) as now_away
    from matchup m join league l on l.id = m.league_id
   where m.week = :wk and m.status = 'final' and not coalesce(l.is_mock, false)
     and m.home_final is not null and m.away_final is not null
     and coalesce(nullif(regexp_replace(l.season, '\D', '', 'g'), '')::int, 0)
         >= extract(year from now())::int - case when extract(month from now()) < 3 then 1 else 0 end
     and (abs(coalesce((select sum(s.home_score) from matchup_state s where s.matchup_id = m.id), 0) - m.home_final) > 0.15
       or abs(coalesce((select sum(s.away_score) from matchup_state s where s.matchup_id = m.id), 0) - m.away_final) > 0.15)
)
update matchup m set home_final = null, away_final = null
  from stale x where m.id = x.id
returning left((select name from league where id = m.league_id), 20) as league,
          x.was_home, x.was_away, x.now_home, x.now_away;

\echo
\echo '════ STEP 2 · queue a rebuild where the STORED report still disagrees ════'
with cur as (
  select m.league_id, m.home_roster_id as hr, m.away_roster_id as ar,
         round(m.home_final, 1) as hf, round(m.away_final, 1) as af
    from matchup m join league l on l.id = m.league_id
   where m.week = :wk and m.status = 'final' and not coalesce(l.is_mock, false)
     and m.home_final is not null and m.away_final is not null
), rep as (
  select r.league_id,
         (g -> 'home' ->> 'roster')::int as hr, round((g -> 'home' ->> 'score')::numeric, 1) as hs,
         (g -> 'away' ->> 'roster')::int as ar, round((g -> 'away' ->> 'score')::numeric, 1) as a_s
    from league_report r, jsonb_array_elements(coalesce(r.payload -> 'results', '[]'::jsonb)) g
   where r.week = :wk
), drift as (
  select distinct c.league_id
    from cur c join rep p on p.league_id = c.league_id and p.hr = c.hr and p.ar = c.ar
   where abs(p.hs - c.hf) > 0.05 or abs(p.a_s - c.af) > 0.05
)
insert into report_request (league_id, week)
select d.league_id, :wk from drift d
 where not exists (select 1 from report_request q
                    where q.league_id = d.league_id and q.week = :wk and q.done_at is null)
returning (select left(name, 20) from league where id = league_id) as league, week, id as request_id;

\echo
\echo '════ where the week stands now ════'
select left(l.name, 20) as league,
       count(*) as matchups,
       count(*) filter (where m.home_final is null) as awaiting_restamp,
       count(*) filter (where m.home_final is not null
         and abs(coalesce((select sum(s.home_score) from matchup_state s where s.matchup_id = m.id), 0) - m.home_final) > 0.15) as still_stale,
       (select count(*) from report_request q where q.league_id = l.id and q.week = :wk and q.done_at is null) as rebuild_queued,
       (select created_at from league_report r where r.league_id = l.id and r.week = :wk) as report_built
  from matchup m join league l on l.id = m.league_id
 where m.week = :wk and not coalesce(l.is_mock, false) and m.status = 'final'
 group by l.id, l.name order by l.name;
\echo
\echo 'Step 1 wrote rows? Wait a few minutes for the worker, then run this again.'
\echo 'Step 2 wrote rows? The corrected reports post within a minute.'
\echo 'Neither wrote anything and still_stale is 0? The week is repaired.'
