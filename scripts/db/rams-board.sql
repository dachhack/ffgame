-- THE RAMS ON THE WEEK-6 BOARD (v0.707.0 follow-up). Read only.
-- Did the deployed worker's top-up add the Rams' people to the frozen week-6 board?
\pset pager off
set search_path = public;
\echo '── Rams rows on the week-6 board'
select week, slug, pos, team, salary, proj, exp from pod_salary where season = '2026' and week = 6 and team in ('LA', 'LAR') order by pos, salary desc;
\echo '── people per slate team, week 6 (every team that plays should have some)'
select s.team, count(p.slug) filter (where p.pos in ('QB','RB','WR','TE')) as people
  from (select home as team from nfl_slate where season = '2026' and week = 6 union select away from nfl_slate where season = '2026' and week = 6) s
  left join pod_salary p on p.season = '2026' and p.week = 6 and _nfl_team(p.team) = _nfl_team(s.team)
 group by s.team order by people, s.team;
\echo '── Stafford, any week'
select week, slug, pos, team, salary, proj from pod_salary where season = '2026' and slug like '%stafford%' order by week;
