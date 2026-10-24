-- Devy Test 1, college week of 10/19 (founder: "CPU managers playing out
-- players?"). Team 4 (CPU) starts E. Dickens (O) and holds B. Brown, J.
-- Buckley and A. Dabbs as OFF ROSTER while Team 6 starts the same three.
-- Read only: the two seats' controllers; Team 4's weekly picks (when sealed,
-- the player's school + game kickoff, injury status); every add/drop/trade of
-- those players this month; and the week's first college kickoff (the AI's
-- rails read every college player as kicked off from it). Seats by number,
-- no member names; players are public.
\pset pager off
set search_path = public;
\echo '── the league and its live matchup'
select l.id as league, m.id as matchup, m.week, m.status, m.home_roster_id, m.away_roster_id
  from league l join matchup m on m.league_id = l.id
 where l.name = 'Devy Test 1' and m.status in ('live', 'scheduled') and (m.home_roster_id in (4, 6) or m.away_roster_id in (4, 6))
 order by m.week;
\echo '── seats 4 and 6: who runs them'
select m.sleeper_roster_id as seat, m.controller, m.app_user_id is not null as has_account,
       exists (select 1 from seat_agent sa where sa.league_id = m.league_id and sa.roster_id = m.sleeper_roster_id) as agent
  from league_membership m join league l on l.id = m.league_id
 where l.name = 'Devy Test 1' and m.sleeper_roster_id in (4, 6) order by 1;
\echo '── live-week weekly picks on the 4-v-6 matchup'
select exists (select 1 from seat_agent sa where sa.agent_user_id = sp.app_user_id) as by_agent, sp.roster_slot, sp.player_slug, cp.full_name, cp.school_abbr,
       sp.locked, sp.revealed_at,
       (select min(s.kickoff) from nfl_slate s where s.week = m.week and upper(cp.school_abbr) in (upper(s.home), upper(s.away))) as his_kickoff,
       i.status as injury, i.updated_at as injury_at,
       (select string_agg(nr.roster_id::text, ',') from native_roster nr where nr.league_id = m.league_id and nr.slug = sp.player_slug) as held_by
  from league l join matchup m on m.league_id = l.id and m.status = 'live'
  join sealed_pick sp on sp.matchup_id = m.id and sp.game_window = 'wk'
  left join college_player cp on 'c-' || cp.espn_id = sp.player_slug
  left join injury_status i on i.player_slug = sp.player_slug
 where l.name = 'Devy Test 1' and 4 in (m.home_roster_id, m.away_roster_id) and 6 in (m.home_roster_id, m.away_roster_id)
 order by sp.app_user_id, sp.roster_slot;
\echo '── moves of the four players since Oct 1'
select t.at, t.kind, t.roster_id as seat, t.from_roster, t.actor is null as by_worker, t.slug, cp.full_name
  from league_txn t join league l on l.id = t.league_id
  left join college_player cp on 'c-' || cp.espn_id = t.slug
 where l.name = 'Devy Test 1' and t.at >= '2026-10-01'
   and (cp.full_name ilike any (array['%brown%', '%buckley%', '%dabbs%', '%dickens%']))
 order by t.at;
\echo '── the live week''s first college kickoff'
select m.week, min(s.kickoff) as first_kickoff
  from league l join matchup m on m.league_id = l.id and m.status = 'live'
  join nfl_slate s on s.week = m.week
 where l.name = 'Devy Test 1' group by m.week;
