-- A member in Monday Showdown (made Monday for week 6): "it says my team is
-- locked in as … who have all already played." Did the worker auto-build the
-- squads from the whole week (Sunday's players included) before anyone could
-- pick? Read only: each seat's state and its week-6 squad, each pick's team
-- and whether its game had kicked off before the league was made.
\pset pager off
set search_path = public;
select id as lid, created_at as made from league where name = 'Monday Showdown' order by created_at desc limit 1 \gset
\echo '── 1. the seats'
select sleeper_roster_id as seat, enrolled, controller, app_user_id is not null as has_account
  from league_membership where league_id = :'lid' order by 1;
\echo '── 2. the week-6 squads: each pick, its team''s kickoff, and whether that was before the league existed'
select sl.roster_id as seat, e ->> 'slot' as slot, e ->> 'player_slug' as pick, ps.team,
       (select min(kickoff) from nfl_slate s where s.season = '2026' and s.week = 6 and ps.team in (s.home, s.away)) as kickoff,
       (select min(kickoff) from nfl_slate s where s.season = '2026' and s.week = 6 and ps.team in (s.home, s.away)) < :'made'::timestamptz as before_league
  from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) e
  left join pod_salary ps on ps.season = '2026' and ps.week = 6 and ps.slug = e ->> 'player_slug'
 where sl.league_id = :'lid' and sl.week = 6 order by 1, 2;
\echo '── 3. the matchup and any plays'
select id, status, home_roster_id, away_roster_id from matchup where league_id = :'lid' and week = 6;
select roster_id, play_id, slot from contest_play where league_id = :'lid' and week = 6;
