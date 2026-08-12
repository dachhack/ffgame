-- Does everyone actually have a lineup in?
--
-- The question this answers: for each upcoming matchup, has each side written
-- COMPLETE picks — a player AND a metric in every slot the week has?
--
-- Worth asking now rather than on a Sunday, because two things could have eaten
-- a lineup and neither of them raises an error at the time:
--
--   · Builds before b1af50d required pressing SEAL. A lineup you filled in and
--     walked away from was never written at all.
--   · Before migration 0120 the slot cap was a flat base_slot_count(), so a week
--     with more windows than the cap rejected the save of the slots past it —
--     silently, from the client's point of view.
--
-- A half-written lineup looks identical to a finished one on the board you left
-- open. It only shows up here, or at kickoff.
--
-- A slot counts as SET only with both a player and a metric. A player with no
-- metric scores nothing, so counting it as filled would be the same lie the
-- board used to tell.

\echo ''
\echo '── 1. Every enrolled manager, every week with a matchup ──'
\echo '   set = slots with BOTH a player and a metric. partial = a player but no'
\echo '   metric — filled in and never finished, which scores zero.'
select
  l.name                                                   as league,
  m.week,
  coalesce(lm.team_name, 'roster ' || lm.sleeper_roster_id) as team,
  coalesce(au.sleeper_username, au.email, '(unclaimed)')    as manager,
  m.status,
  count(sp.id) filter (where sp.player_slug is not null and sp.metric_id is not null) as set,
  count(sp.id) filter (where sp.player_slug is not null and sp.metric_id is null)     as partial,
  count(sp.id)                                             as rows_total,
  count(sp.id) filter (where sp.locked)                    as locked
from matchup m
join league l  on l.id = m.league_id
join league_membership lm
  on lm.league_id = m.league_id
 and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
left join app_user au on au.id = lm.app_user_id
left join sealed_pick sp
  on sp.matchup_id = m.id
 and sp.app_user_id = lm.app_user_id
where lm.enrolled
group by l.name, m.week, lm.team_name, lm.sleeper_roster_id, au.sleeper_username, au.email, m.status
order by m.week, l.name, team;

\echo ''
\echo '── 2. Anyone enrolled with NOTHING written for a scheduled week ──'
\echo '   The row that matters. An empty lineup at lock is an auto-pilot lineup'
\echo '   at best, and a forfeit-shaped scoreline at worst.'
select
  l.name                                                   as league,
  m.week,
  coalesce(lm.team_name, 'roster ' || lm.sleeper_roster_id) as team,
  coalesce(au.sleeper_username, au.email, '(unclaimed)')    as manager,
  m.lock_at
from matchup m
join league l on l.id = m.league_id
join league_membership lm
  on lm.league_id = m.league_id
 and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
left join app_user au on au.id = lm.app_user_id
where lm.enrolled
  and m.status = 'scheduled'
  and not exists (
    select 1 from sealed_pick sp
     where sp.matchup_id = m.id and sp.app_user_id = lm.app_user_id
       and sp.player_slug is not null
  )
order by m.week, l.name, team;

\echo ''
\echo '── 3. Which windows are covered, per manager, most recent week ──'
\echo '   A lineup can be complete in the windows it wrote and still be missing a'
\echo '   window entirely — which is exactly what the old slot cap produced.'
with latest as (select max(week) as w from matchup where status = 'scheduled')
select
  l.name                                                   as league,
  coalesce(lm.team_name, 'roster ' || lm.sleeper_roster_id) as team,
  sp.game_window,
  count(*)                                                  as slots,
  count(*) filter (where sp.metric_id is not null)          as with_metric
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league l on l.id = m.league_id
join league_membership lm
  on lm.league_id = m.league_id and lm.app_user_id = sp.app_user_id
where m.week = (select w from latest)
group by l.name, lm.team_name, lm.sleeper_roster_id, sp.game_window
order by l.name, team, sp.game_window;

\echo ''
\echo '── 4. What the week EXPECTS, for comparison with section 3 ──'
\echo '   Windows derived from the real slate (nfl_slate), which is what the'
\echo '   board builds its slots from. A window here with no row above is a'
\echo '   window nobody has set.'
select season, week, win as game_window, count(*) as games,
       least(3, ceil(count(*)::numeric / 3))::int as slots_per_window
from nfl_slate
group by season, week, win
order by week desc, win
limit 20;
