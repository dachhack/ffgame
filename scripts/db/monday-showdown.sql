-- Founder, over the commissioner page of "Monday Showdown" (2026, POD, 0/2
-- enrolled): "I want this to be a native league that runs just tonight with
-- 2 players. Do I need to sync the season to get the matchup board?" What
-- kind of league is it, which week, and does it have matchups yet? Read only;
-- seats and counts, no member names or ids.
\pset pager off
set search_path = public;
\echo '── 1. the league'
select l.id, l.kind, l.provider, l.season, l.contest_week, l.kdst_mode, l.lineup_policy, l.created_at,
       l.settings_json - 'roster_slots' as settings
  from league l where l.name = 'Monday Showdown' order by l.created_at desc limit 3;
\echo '── 2. its seats'
select m.sleeper_roster_id as seat, m.enrolled, m.controller, m.app_user_id is not null as has_account
  from league_membership m join league l on l.id = m.league_id
 where l.name = 'Monday Showdown' order by l.created_at desc, m.sleeper_roster_id limit 12;
\echo '── 3. its matchups'
select mt.week, mt.status, mt.home_roster_id, mt.away_roster_id, mt.is_playoff
  from matchup mt join league l on l.id = mt.league_id
 where l.name = 'Monday Showdown' order by mt.week limit 20;
\echo '── 4. tonight''s slate (week 7 games not yet final)'
select week, home, away, kickoff from nfl_slate where season = '2026' and kickoff > now() - interval '12 hours' order by kickoff limit 6;
