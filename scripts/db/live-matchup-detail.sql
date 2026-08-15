-- The whole picture for every LIVE matchup of the current week (companion #4).
-- After 0199.3 the founder's own side scores but a Turf Warriors opponent side
-- reads 0.0 across the board while its picks pass the revealed-picks filter —
-- so dump seats, sealed rows, and the worker's output side by side and let the
-- data name the layer. Read-only. Run via dbquery.yml.

-- 1) Seats: who occupies each side of each live matchup.
select l.name as league, m.id as matchup_id,
       hm.team_name as home_team, hm.app_user_id as home_user, hm.enrolled as home_enr, hm.controller as home_ctl,
       am.team_name as away_team, am.app_user_id as away_user, am.enrolled as away_enr, am.controller as away_ctl
from matchup m
join league l on l.id = m.league_id
left join league_membership hm on hm.league_id = m.league_id and hm.sleeper_roster_id = m.home_roster_id
left join league_membership am on am.league_id = m.league_id and am.sleeper_roster_id = m.away_roster_id
where m.week = 102 and m.status = 'live'
order by l.name, m.id;

-- 2) Sealed rows per matchup, tagged by which seat each author matches.
select l.name as league, sp.matchup_id, sp.app_user_id as author,
       case when sp.app_user_id = hm.app_user_id then 'home'
            when sp.app_user_id = am.app_user_id then 'away'
            else 'ORPHAN' end as seat,
       count(*) as rows,
       count(*) filter (where sp.locked) as locked_rows,
       string_agg(distinct sp.game_window, ',') as windows
from sealed_pick sp
join matchup m on m.id = sp.matchup_id
join league l on l.id = m.league_id
left join league_membership hm on hm.league_id = m.league_id and hm.sleeper_roster_id = m.home_roster_id
left join league_membership am on am.league_id = m.league_id and am.sleeper_roster_id = m.away_roster_id
where m.week = 102 and m.status = 'live' and sp.player_slug is not null
group by l.name, sp.matchup_id, sp.app_user_id, seat
order by l.name, sp.matchup_id, seat;

-- 3) The worker's output: per-window scores + per-side slot detail for 'sat'.
select l.name as league, ms.matchup_id, ms.game_window,
       ms.home_score, ms.away_score, ms.updated_at,
       (select string_agg(s->>'slot' || ':' || coalesce(s->>'slug','—') || '=' || coalesce(s->>'score','0'), ', ')
          from jsonb_array_elements(coalesce(ms.slot_scores, '[]'::jsonb)) s
         where s->>'side' = 'home') as home_slots,
       (select string_agg(s->>'slot' || ':' || coalesce(s->>'slug','—') || '=' || coalesce(s->>'score','0'), ', ')
          from jsonb_array_elements(coalesce(ms.slot_scores, '[]'::jsonb)) s
         where s->>'side' = 'away') as away_slots
from matchup_state ms
join matchup m on m.id = ms.matchup_id
join league l on l.id = m.league_id
where m.week = 102 and m.status = 'live' and ms.game_window = 'sat'
order by l.name, ms.matchup_id;
