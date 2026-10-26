-- Founder, league chat (member's question): "do the buffs i apply to caleb not
-- work if he gets subbed into another window?" Read only: every week-7
-- matchup where that member (matched by Sleeper username / display name, not
-- printed) started Caleb Williams: the league and its mode, his picks (window,
-- slot, locked), and the member's applied_state payload (the buffs and the
-- backup assignments). Seats by number; no names or account ids printed.
\pset pager off
set search_path = public;
\echo '── the matchups and Caleb''s picks'
select l.name as league, l.settings_json ->> 'game_mode' as mode, m.week, m.status,
       lm.sleeper_roster_id as seat, sp.game_window, sp.roster_slot, sp.metric_id, sp.locked
  from app_user u
  join league_membership lm on lm.app_user_id = u.id
  join league l on l.id = lm.league_id
  join matchup m on m.league_id = l.id and m.week = 7
   and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
  join sealed_pick sp on sp.matchup_id = m.id and sp.app_user_id = u.id and sp.player_slug = 'caleb-williams'
 where u.sleeper_username ilike 'asianbruja' or u.display_name ilike 'asianbruja';
\echo '── the member''s applied state on those matchups'
select l.name as league, lm.sleeper_roster_id as seat, a.week, a.updated_at, jsonb_pretty(a.payload_json) as payload
  from app_user u
  join league_membership lm on lm.app_user_id = u.id
  join league l on l.id = lm.league_id
  join matchup m on m.league_id = l.id and m.week = 7
   and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
  join applied_state a on a.matchup_id = m.id and a.app_user_id = u.id
 where (u.sleeper_username ilike 'asianbruja' or u.display_name ilike 'asianbruja')
   and exists (select 1 from sealed_pick sp where sp.matchup_id = m.id and sp.app_user_id = u.id and sp.player_slug = 'caleb-williams');
\echo '── the member''s whole week-7 lineup there (window, slot, player)'
select l.name as league, sp.game_window, sp.roster_slot, sp.player_slug, sp.metric_id, sp.locked
  from app_user u
  join league_membership lm on lm.app_user_id = u.id
  join league l on l.id = lm.league_id
  join matchup m on m.league_id = l.id and m.week = 7
   and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
  join sealed_pick sp on sp.matchup_id = m.id and sp.app_user_id = u.id
 where (u.sleeper_username ilike 'asianbruja' or u.display_name ilike 'asianbruja')
   and exists (select 1 from sealed_pick c where c.matchup_id = m.id and c.app_user_id = u.id and c.player_slug = 'caleb-williams')
 order by 1, 2, 3;
