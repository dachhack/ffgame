-- THE BOARD SAYS ONE SCORE, THE REPORT SAYS ANOTHER. READ-ONLY diagnostic.
--
-- Symptom (Kickoff League, wk 2, 2026-09-22 ~03:20Z): the matchup screen reads
-- Hewy13 162.50 – 160.50 Team 2 with one game still LIVE, while 📋 Week 2
-- report reads 127.5 – 143.5 and calls it "Team 2 by 16.0" — and the header's
-- records (0-1-1, #5) and the standings agree with the REPORT, not the board.
--
-- Those are not two opinions. `league_standings` (0073), the report's
-- standings and its RESULTS all read ONE pair of columns —
-- `matchup.home_final` / `away_final` — and the board reads the live engine
-- over `live_play`. So the question is only ever: are those two columns stale?
--
-- WHY THEY CAN BE, AND STAY THAT WAY. `stampFinals` (resolve.js:724) selects
--   .eq('status','final').is('home_final', null)
-- so a matchup is stamped EXACTLY ONCE, from whatever plays existed at that
-- instant, and that statement can never correct it. Re-stamping then depends
-- on the week still being resolved by the live loop (index.js: matchups in
-- ('live','final') for the CURRENT context's week) — and if the context has
-- rolled on, `closePriorWeek` returns early while any prior-week game is
-- incomplete, so the week gets no resolve at all and the one stamp is final
-- in both senses.
--
-- WHICH LEAVES ONE QUESTION: what closed the week mid-game? `finalizeMatchups`
-- is only ever called with completed = true, guarded at both call sites by
-- `games.every((g) => g.completed)` over the scoreboard ESPN returned. That
-- guard is vacuously TRUE over a SHORT list: if the week-2 scoreboard came
-- back without its Monday game, every game in it was complete. Section 4
-- checks exactly that — the slate's game count against the feed's.
--
-- The screenshot already says the stamp happened mid-game: every player cell
-- carries "Final ·" except K. Williams (RB · LA), and the away side's board −
-- report gap is 17.0 against his live 17.2.
--
-- Run: Actions → "Run a database query" → this path, allow_writes OFF.
-- PRIVACY: this repository is public and this workflow logs in public. No
-- emails, no account ids.
\set QUIET on
\pset pager off
\pset format aligned
\pset null '·'
\set ON_ERROR_STOP on

select coalesce(
    (select l.id from league l where l.name = 'Kickoff League' and not coalesce(l.is_mock, false)
      order by l.created_at desc limit 1),
    (select m.league_id from matchup m join league l on l.id = m.league_id
      where not coalesce(l.is_mock, false) and m.status in ('live', 'final')
      order by m.week desc, m.created_at desc limit 1),
    '00000000-0000-0000-0000-000000000000'::uuid
  )::text as lid,
  (select coalesce(max(m.week), 0) from matchup m join league l on l.id = m.league_id
    where not coalesce(l.is_mock, false) and m.week < 100 and m.status in ('live', 'final'))::text as wk,
  (exists (select 1 from matchup m join league l on l.id = m.league_id
            where not coalesce(l.is_mock, false) and m.status in ('live', 'final')))::text as found
\gset

\if :found
\else
\echo 'No live or final matchup on this database — nothing to diagnose.'
\q
\endif

\echo
\echo '════ 1. THE TWO NUMBERS, side by side ════'
\echo '   stamped_* is what the report, the standings and the header records read.'
\echo '   state_*  is the sum of the resolver''s per-window rows — what the board draws.'
\echo '   A gap here IS the bug, and `stamped_age` says how long the stamp has stood.'
select left(l.name, 20) as league, m.week, m.status,
       (select left(team_name, 14) from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id) as home_team,
       (select left(team_name, 14) from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id) as away_team,
       round(m.home_final, 1) as stamped_home, round(m.away_final, 1) as stamped_away,
       round((select sum(home_score) from matchup_state s where s.matchup_id = m.id), 1) as state_home,
       round((select sum(away_score) from matchup_state s where s.matchup_id = m.id), 1) as state_away,
       round((select sum(home_score) from matchup_state s where s.matchup_id = m.id) - m.home_final, 1) as home_gap,
       round((select sum(away_score) from matchup_state s where s.matchup_id = m.id) - m.away_final, 1) as away_gap,
       (select max(updated_at) from matchup_state s where s.matchup_id = m.id) as last_resolve,
       age(now(), (select max(updated_at) from matchup_state s where s.matchup_id = m.id)) as resolve_age
  from matchup m join league l on l.id = m.league_id
 where m.league_id = :'lid' and m.week = :'wk'
 order by home_team;

\echo
\echo '   …and per window, so a stamp taken mid-slate shows which window it missed:'
select (select left(team_name, 12) from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id) as home_team,
       s.game_window, round(s.home_score, 1) as home, round(s.away_score, 1) as away,
       jsonb_array_length(coalesce(s.slot_scores, '[]'::jsonb)) as slots, s.updated_at
  from matchup_state s join matchup m on m.id = s.matchup_id
 where m.league_id = :'lid' and m.week = :'wk'
 order by home_team, s.updated_at;

\echo
\echo '════ 2. what the STORED report says, and WHEN it was built ════'
\echo '   The payload is frozen at build time (league_report). If created_at lands'
\echo '   inside the live game, the report was written from a mid-game stamp.'
select week, created_at, age(now(), created_at) as built_ago,
       payload -> 'closest' ->> 'margin' as closest_margin,
       jsonb_array_length(coalesce(payload -> 'results', '[]'::jsonb)) as results
  from league_report where league_id = :'lid' and week = :'wk';
select (g -> 'home' ->> 'name') as home, round((g -> 'home' ->> 'score')::numeric, 1) as home_score,
       (g -> 'away' ->> 'name') as away, round((g -> 'away' ->> 'score')::numeric, 1) as away_score
  from league_report r, jsonb_array_elements(coalesce(r.payload -> 'results', '[]'::jsonb)) g
 where r.league_id = :'lid' and r.week = :'wk';

\echo
\echo '════ 3. the standings the app shows — the same stamped columns ════'
select (e ->> 'roster_id')::int as roster, left(e ->> 'team', 16) as team,
       e ->> 'w' as w, e ->> 'l' as l, e ->> 't' as t, e ->> 'pf' as pf, e ->> 'pa' as pa
  from jsonb_array_elements(league_standings(:'lid')) e;

\echo
\echo '════ 4. IS THE WEEK ACTUALLY OVER? the guard that closed it ════'
\echo '   slate_games is the schedule; feed_games is what the worker has ingested.'
\echo '   feed < slate means the scoreboard ESPN handed the worker was SHORT, and'
\echo '   `games.every(completed)` was true over a list missing the live game.'
select :'wk' as week,
       (select count(*) from nfl_slate where week = :'wk'::int
         and season = (select max(season) from nfl_slate where week = :'wk'::int)) as slate_games,
       (select count(*) from game_feed where week = :'wk'::int) as feed_games,
       (select count(*) from game_feed where week = :'wk'::int and state = 'post') as feed_post,
       (select count(*) from game_feed where week = :'wk'::int and state is distinct from 'post') as feed_not_post;
\echo '   …every game the feed holds for the week, newest touch first:'
select game_id, away, home, key, state, left(coalesce(status #>> '{}', ''), 28) as status, jsonb_array_length(coalesce(plays,'[]'::jsonb)) as plays, updated_at
  from game_feed where week = :'wk'::int order by updated_at desc;
\echo '   …and any scheduled game with NO feed row at all (the short-list case):'
select s.season, s.away, s.home, s.win, s.kickoff
  from nfl_slate s
 where s.week = :'wk'::int and s.season = (select max(season) from nfl_slate where week = :'wk'::int)
   and not exists (select 1 from game_feed f where f.week = s.week
                    and (f.game_id = s.game_id or (f.home = s.home and f.away = s.away)))
 order by s.kickoff;

\echo
\echo '════ 5. whose points are still moving — the slots in a game that is not post ════'
with rows_ as (
  select m.id, s.game_window, r ->> 'side' as side, r ->> 'slot' as slot,
         r ->> 'slug' as slug, (r ->> 'score')::numeric as score
    from matchup m join matchup_state s on s.matchup_id = m.id,
         jsonb_array_elements(coalesce(s.slot_scores, '[]'::jsonb)) r
   where m.league_id = :'lid' and m.week = :'wk'
)
select side, slot, left(slug, 22) as player, round(score, 1) as score, game_window
  from rows_ order by score desc limit 20;

\echo
\echo '════ 6. the same staleness, league-wide — is this one matchup or the week? ════'
select left(l.name, 20) as league, m.week, count(*) as matchups,
       count(*) filter (where m.status = 'final') as final_,
       count(*) filter (where m.home_final is null) as unstamped,
       count(*) filter (where abs(coalesce((select sum(home_score) from matchup_state s where s.matchup_id = m.id), 0) - coalesce(m.home_final, 0)) > 0.15
                          or abs(coalesce((select sum(away_score) from matchup_state s where s.matchup_id = m.id), 0) - coalesce(m.away_final, 0)) > 0.15) as stale_stamps
  from matchup m join league l on l.id = m.league_id
 where m.week = :'wk'::int and not coalesce(l.is_mock, false) and m.status = 'final'
 group by l.name, m.week order by stale_stamps desc, l.name;

\echo
\echo 'done — read-only. Nothing above was modified.'
\echo
\echo 'THE REPAIR, deliberately not run here (the pattern orphan-window-picks.sql set):'
\echo '  clearing the stamp is all it takes — stampFinals re-resolves any final'
\echo '  matchup whose home_final is NULL, from the plays it has NOW, and the'
\echo '  report rebuilds from an admin request (admin_request_week_report).'
\echo '    -- update matchup set home_final = null, away_final = null'
\echo '    --  where league_id = ''<league>'' and week = <wk> and status = ''final'';'
\echo '    -- delete from league_report where league_id = ''<league>'' and week = <wk>;'
\echo '  Do it only once the week''s last game reads post in section 4 — a stamp'
\echo '  taken mid-game is exactly what put us here.'
