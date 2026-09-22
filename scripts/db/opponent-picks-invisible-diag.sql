-- WHY IS THE OPPONENT'S HALF EMPTY? READ-ONLY diagnostic.
--
-- Symptom (Gridiron Gang, wk 2, 2026-09-22): every window shows the opponent's
-- card as "NO PLAYER — window left empty", while the WINDOW BATTLE bar credits
-- them 32.9 / 30.6 and the matchup total reads 104.2. Those two cannot both be
-- true: the bar is the resolver's own slot_scores, so somebody scored. The
-- cards come from a plain `select … from sealed_pick` (getRevealedPicks), so
-- what the board is missing is READ ACCESS, not points.
--
-- Three mechanisms could do that, and this file decides between them:
--   A. the rows are NOT `locked`. The resolver scores every row with a
--      player_slug (resolve.js:243) and never asks; the sealed_select RLS
--      (0262) shows the opponent's row only when `locked`. Unlocked =
--      scores, invisible.
--   B. `window_revealed()` says no. It is `now() >= window_kickoff(week, win)`
--      where window_kickoff takes `min(kickoff)` for `season = (select
--      max(season) from nfl_slate where week = p_week)` (0157) — so ONE stray
--      future-season row on this week moves the reveal clock for everybody,
--      and every window of the week hides at once. NULL kickoff reveals, so
--      only a FUTURE kickoff hides.
--   D. NOTHING WAS EVER STORED. `sideLineup` (resolve.js:361-388) rebuilds a
--      side at resolve time — and scores it — in three cases: an AI-controlled
--      seat with no sealed rows, a seat that is unenrolled or unclaimed, and
--      any seat with no picks under a policy other than 'empty'. That rebuild
--      is never written back to sealed_pick, and `materializeAutoLineups` (the
--      writer that would have stored it) skips an UNCLAIMED AI seat outright
--      (lock.js:703-706, deliberately — its buffs live in aiSide). The board
--      reads sealed_pick, so it has nothing to draw; the bar reads
--      matchup_state, so it has the points. Section 1 decides this one:
--      away_claimed=f / away_ctrl=ai / away_enrolled=f / no sealed rows at all
--      for the away seat is the signature.
--   C. the rows are ORPHANED under two or more authors. sealed_pick keys on
--      the account that saved it; assignSealedRows (0199.2) adopts an orphan
--      lineup only when exactly one author is orphaned, and DROPS the rows
--      otherwise — on the board and in the resolver alike.
--
-- Run: Actions → "Run a database query" → file = this path, allow_writes OFF.
--
-- PRIVACY: this repository is public and this workflow prints to a public job
-- log. No emails, no account ids — authors are labelled by SEAT, and anything
-- else is a 6-char hash.
\set QUIET on
\pset pager off
\pset format aligned
\pset null '·'
\set ON_ERROR_STOP on

-- ── the matchup in question ─────────────────────────────────────────────────
-- Named so a second run needs no edit; falls back to this account's most
-- recent non-final matchup if the name ever changes.
select coalesce(
    (select m.id from matchup m join league l on l.id = m.league_id
      where l.name = 'Gridiron Gang' and m.week = 2 and not coalesce(l.is_mock, false)
      order by m.created_at desc limit 1),
    (select m.id from matchup m join league l on l.id = m.league_id
      where not coalesce(l.is_mock, false) and m.status in ('live', 'final')
      order by m.week desc, m.created_at desc limit 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  )::text as mid,
  (exists (select 1 from matchup m join league l on l.id = m.league_id
            where not coalesce(l.is_mock, false) and m.status in ('live', 'final')))::text as found
\gset

\if :found
\else
\echo 'No live or final matchup found on this database — nothing to diagnose.'
\q
\endif

\echo
\echo '════ 1. the matchup and its two seats ════'
select left(l.name, 22) as league, m.week, m.status, l.settings_json ->> 'game_mode' as mode,
       m.home_roster_id as home, m.away_roster_id as away,
       (select left(team_name, 14) from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id) as home_team,
       (select left(team_name, 14) from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id) as away_team,
       (select controller from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id) as home_ctrl,
       (select controller from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id) as away_ctrl,
       (select app_user_id is not null from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id) as home_claimed,
       (select app_user_id is not null from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id) as away_claimed,
       (select enrolled from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id) as away_enrolled,
       coalesce(l.lineup_policy, 'best_lineup') as lineup_policy,
       (select jsonb_array_length(coalesce(starters_json, '[]'::jsonb)) from sleeper_lineup
         where league_id = m.league_id and week = m.week and roster_id = m.away_roster_id) as away_sleeper_starters,
       m.lock_at, now() as now
  from matchup m join league l on l.id = m.league_id where m.id = :'mid';

\echo
\echo '════ 2. EVERY sealed_pick row on this matchup — the answer to A and C ════'
\echo '   author: HOME/AWAY = the seat that holds it now; ORPHAN-n = an account that holds neither seat.'
\echo '   locked=f on an ORPHAN or AWAY row IS the bug (it scores and cannot be read).'
with m as (select * from matchup where id = :'mid'),
seats as (
  select mm.sleeper_roster_id as rid, mm.app_user_id,
         case when mm.sleeper_roster_id = (select home_roster_id from m) then 'HOME' else 'AWAY' end as seat
    from league_membership mm, m
   where mm.league_id = m.league_id and mm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
),
rows_ as (
  select sp.*, coalesce(s.seat,
           'ORPHAN-' || dense_rank() over (order by case when s.seat is null then sp.app_user_id end)) as author
    from sealed_pick sp left join seats s on s.app_user_id = sp.app_user_id
   where sp.matchup_id = :'mid'
)
select author, game_window, roster_slot, left(coalesce(player_slug, '—'), 20) as player,
       left(coalesce(metric_id, '—'), 18) as metric, locked, revealed_at,
       substr(md5(app_user_id::text), 1, 6) as author_hash
  from rows_
 order by game_window, author, roster_slot;

\echo
\echo '   …the same rows counted, which is what the board sees:'
with m as (select * from matchup where id = :'mid'),
seats as (
  select mm.app_user_id,
         case when mm.sleeper_roster_id = (select home_roster_id from m) then 'HOME' else 'AWAY' end as seat
    from league_membership mm, m
   where mm.league_id = m.league_id and mm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
)
select coalesce(s.seat, 'ORPHAN') as author, sp.game_window,
       count(*) as rows_, count(*) filter (where sp.player_slug is not null) as with_player,
       count(*) filter (where sp.locked) as locked_, count(*) filter (where not sp.locked) as UNLOCKED
  from sealed_pick sp left join seats s on s.app_user_id = sp.app_user_id
 where sp.matchup_id = :'mid'
 group by coalesce(s.seat, 'ORPHAN'), sp.game_window
 order by sp.game_window, author;

\echo
\echo '   C: how many DISTINCT orphan authors? 2+ and assignSealedRows drops them all (board AND resolver).'
with m as (select * from matchup where id = :'mid'),
seats as (select mm.app_user_id from league_membership mm, m
           where mm.league_id = m.league_id and mm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id))
select count(distinct sp.app_user_id) as orphan_authors,
       case when count(distinct sp.app_user_id) > 1 then '⚠ AMBIGUOUS — rows dropped by rule'
            when count(distinct sp.app_user_id) = 1 then 'one author — adoptable'
            else 'no orphans' end as verdict
  from sealed_pick sp
 where sp.matchup_id = :'mid' and sp.app_user_id not in (select app_user_id from seats where app_user_id is not null);

\echo
\echo '════ 3. B: the reveal clock, per window ════'
\echo '   revealed=f while the window is FINAL on the board is the bug. NULL kickoff reveals (t).'
with m as (select * from matchup where id = :'mid'),
wins as (select distinct game_window as win from sealed_pick where matchup_id = :'mid'
         union select distinct game_window from matchup_state where matchup_id = :'mid')
select w.win, window_kickoff((select week from m), w.win) as kickoff_used,
       now() >= window_kickoff((select week from m), w.win) as kicked,
       window_revealed(:'mid', w.win) as revealed,
       (select min(kickoff) from nfl_slate s where s.week = (select week from m) and s.win = w.win
          and s.season = (select max(season) from nfl_slate where week = (select week from m))) as slate_min_kickoff
  from wins w order by w.win;

\echo
\echo '   …and the trap itself: which SEASON does this week resolve to, and what else is on it?'
select (select week from matchup where id = :'mid') as week,
       (select max(season) from nfl_slate where week = (select week from matchup where id = :'mid')) as season_used,
       (select string_agg(distinct season::text, ', ' order by season::text) from nfl_slate
         where week = (select week from matchup where id = :'mid')) as seasons_present;
select season, win, count(*) as games, min(kickoff) as first_kick, max(kickoff) as last_kick
  from nfl_slate where week = (select week from matchup where id = :'mid')
 group by season, win order by season desc, first_kick;

\echo
\echo '════ 4. what actually SCORED — the bar the app is drawing ════'
select ws.game_window, round(ws.home_score, 1) as home, round(ws.away_score, 1) as away,
       jsonb_array_length(coalesce(ws.slot_scores, '[]'::jsonb)) as slot_rows
  from matchup_state ws where ws.matchup_id = :'mid' order by ws.game_window;
\echo
\echo '   per slot, per side — a row here whose pick is invisible above is the proof:'
select ws.game_window, r ->> 'side' as side, r ->> 'slot' as slot,
       left(coalesce(r ->> 'slug', '—'), 20) as player, round((r ->> 'score')::numeric, 1) as score,
       r ->> 'hot' as hot, r ->> 'nuked' as nuked
  from matchup_state ws, jsonb_array_elements(coalesce(ws.slot_scores, '[]'::jsonb)) r
 where ws.matchup_id = :'mid'
 order by ws.game_window, side, slot;

\echo
\echo '════ 5. the same question for every OTHER live matchup this week ════'
\echo '   (is this one seat, one league, or the whole platform?)'
with m as (select week from matchup where id = :'mid'),
seats as (
  select mu.id as mid, mm.app_user_id,
         case when mm.sleeper_roster_id = mu.home_roster_id then 'HOME' else 'AWAY' end as seat
    from matchup mu join league l on l.id = mu.league_id
    join league_membership mm on mm.league_id = mu.league_id
       and mm.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id)
   where mu.week = (select week from m) and mu.status in ('live', 'final') and not coalesce(l.is_mock, false)
)
select left(l.name, 20) as league, mu.status,
       count(*) filter (where sp.player_slug is not null) as picks,
       count(*) filter (where sp.player_slug is not null and not sp.locked) as unlocked,
       count(*) filter (where sp.player_slug is not null and s.seat is null) as orphaned,
       count(distinct sp.app_user_id) filter (where s.seat is null) as orphan_authors
  from matchup mu join league l on l.id = mu.league_id
  left join sealed_pick sp on sp.matchup_id = mu.id
  left join seats s on s.mid = mu.id and s.app_user_id = sp.app_user_id
 where mu.week = (select week from m) and mu.status in ('live', 'final') and not coalesce(l.is_mock, false)
 group by l.name, mu.status, mu.id
having count(*) filter (where sp.player_slug is not null and (not sp.locked or s.seat is null)) > 0
 order by l.name;

\echo
\echo 'done — read-only. Nothing above was modified.'
