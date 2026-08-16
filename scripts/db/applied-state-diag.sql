-- Companion #6: armed power-ups (applied_state) vs the seats that should own
-- them, for the live week. The founder's Achane duel shows the client applying
-- momentum/garbage-time/overtime buff lift (+7.1) that the worker's score
-- lacks — either the rows are keyed to an account no longer on the seat (the
-- loadout edition of the vacated-seat bug) or the worker drops them in the
-- resolve. Read-only. Run via dbquery.yml.

select l.name as league,
       ap.matchup_id,
       ap.app_user_id as owner,
       case when ap.app_user_id = hm.app_user_id then 'home'
            when ap.app_user_id = am.app_user_id then 'away'
            else 'ORPHAN' end as seat,
       hm.team_name as home_team, am.team_name as away_team,
       ap.payload_json
from applied_state ap
join matchup m on m.id = ap.matchup_id
join league l on l.id = m.league_id
left join league_membership hm on hm.league_id = m.league_id and hm.sleeper_roster_id = m.home_roster_id
left join league_membership am on am.league_id = m.league_id and am.sleeper_roster_id = m.away_roster_id
where m.week = 102
order by l.name, ap.matchup_id, seat;
