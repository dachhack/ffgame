-- hidden-pick-diag: A WINDOW BAR CREDITS A SIDE THE BOARD CANNOT SEE.
--
-- Opening night 2026 (v0.387.4): in one league the Wednesday bar credited the
-- opponent 8.0 while their slot read "NOT MATCHED UP" and the viewer's own
-- player rendered as an unopposed backup. The worker scored the pick; the
-- board never received the row. Two explanations survive the code: the row is
-- not LOCKED (the sealed_select RLS reveals only locked rows once the window's
-- kickoff has passed), or it is filed under a different game_window id than the
-- one the board derives ('wed' for a Wednesday opener). This prints what is
-- needed to tell them apart, for EVERY started week-1 window, plus the two
-- side questions from the same screenshot: how the slate labels the Wednesday
-- game, and where a league's pool says Romeo Doubs plays (GB in the bake, NE
-- in 2026).
--
-- Read-only. Run via the "Run a database query" workflow:
--   file = scripts/db/hidden-pick-diag.sql, allow_writes off.
\set QUIET on
\pset pager off
\pset format aligned
\set week 1

\echo
\echo '=== 1. STARTED WINDOWS WITH A SCORE, AND THE ROWS BEHIND THEM (week :week) ==='
\echo 'One line per (matchup, window, side). flag: OK | UNLOCKED (row hidden from the'
\echo 'opponent by RLS) | NO ROW IN THIS WINDOW (pick filed under another window id)'
\echo
with m as (
  select m.id, m.league_id, m.home_roster_id, m.away_roster_id, m.status, l.name as league, l.provider
  from matchup m join league l on l.id = m.league_id
  where m.week = :week and m.status in ('live', 'final')
),
sides as (
  select m.*, 'home' as side, m.home_roster_id as roster_id from m
  union all
  select m.*, 'away' as side, m.away_roster_id as roster_id from m
),
seat as (
  select s.*, lm.app_user_id, lm.controller
  from sides s
  left join league_membership lm on lm.league_id = s.league_id and lm.sleeper_roster_id = s.roster_id
),
st as (
  select matchup_id, game_window, home_score, away_score, updated_at
  from matchup_state
  where (home_score > 0 or away_score > 0)
),
rows_ as (
  select sp.matchup_id, sp.app_user_id, sp.game_window, sp.roster_slot, sp.player_slug, sp.metric_id, sp.locked, sp.revealed_at
  from sealed_pick sp
  where sp.matchup_id in (select id from m)
)
select left(s.league, 22) as league, s.provider, left(s.id::text, 8) as matchup, st.game_window as win,
       s.side, s.roster_id as roster, coalesce(s.controller, '-') as ctrl,
       case when s.side = 'home' then st.home_score else st.away_score end as score,
       r.roster_slot as slot, r.player_slug, r.metric_id, r.locked,
       case
         when r.player_slug is null then 'NO ROW IN THIS WINDOW'
         when r.locked is not true then 'UNLOCKED'
         else 'OK'
       end as flag,
       (select string_agg(distinct r2.game_window, ',' order by r2.game_window)
          from rows_ r2 where r2.matchup_id = s.id and r2.app_user_id = s.app_user_id) as windows_filed
from seat s
join st on st.matchup_id = s.id
left join rows_ r on r.matchup_id = s.id and r.game_window = st.game_window
  and (r.app_user_id = s.app_user_id
       -- an agent seat's rows carry the agent's uid, not a membership uid
       or (s.app_user_id is null and r.app_user_id not in (
            select lm2.app_user_id from league_membership lm2
            where lm2.league_id = s.league_id and lm2.app_user_id is not null)))
order by s.league, s.id, st.game_window, s.side, r.roster_slot;

\echo
\echo '=== 2. UNLOCKED ROWS IN WINDOWS THAT HAVE ALREADY KICKED OFF (should be none) ==='
\echo
with kick as (
  select win, min(kickoff) as kickoff from nfl_slate
  where week = :week and season = (select max(season) from nfl_slate where week = :week)
  group by win
)
select left(l.name, 22) as league, left(m.id::text, 8) as matchup, m.status,
       sp.game_window as win, k.kickoff, sp.roster_slot as slot, sp.player_slug, sp.locked, sp.revealed_at
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league l on l.id = m.league_id
left join kick k on k.win = sp.game_window
where m.week = :week and sp.locked is not true and sp.player_slug is not null
  and k.kickoff is not null and k.kickoff <= now()
order by l.name, m.id, sp.game_window, sp.roster_slot;

\echo
\echo '=== 3. WINDOW IDS USED BY WEEK-:week PICKS vs THE SLATE ==='
\echo
select 'picks' as source, game_window as win, count(*) as n
from sealed_pick sp join matchup m on m.id = sp.matchup_id
where m.week = :week and sp.player_slug is not null
group by game_window
union all
select 'slate', win, count(*) from nfl_slate
where week = :week and season = (select max(season) from nfl_slate where week = :week)
group by win
order by source, win;

\echo
\echo '=== 4. THE SLATE ROWS FOR WEEK :week (max season) ==='
\echo
select season, week, win, away, home, kickoff, game_id
from nfl_slate
where week = :week and season = (select max(season) from nfl_slate where week = :week)
order by kickoff, home;

\echo
\echo '=== 5. WHERE DOES ROMEO DOUBS PLAY, PER SOURCE ==='
\echo
select 'league_pool' as source, left(l.name, 22) as league, l.provider, lp.team, lp.pos
from league_pool lp join league l on l.id = lp.league_id
where lp.slug = 'romeo-doubs'
union all
select 'player_team_override', '-', '-', coalesce(team, '(null = free agent)'), '-'
from player_team_override where slug = 'romeo-doubs'
order by source, league;
