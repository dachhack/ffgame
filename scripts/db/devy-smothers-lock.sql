-- Devy Test 1, Saturday of the live college week (founder, with H. Smothers
-- (RB, TEX, Out) in the FLEX and his game still ahead: "I can't swap out
-- smothers"). The board offers a change only on a spot that is not sealed,
-- on a legal roster, whose player has not kicked off. Read only: the matchup,
-- the seat's weekly picks (sealed? when written, the player's own kickoff as
-- the server computes it, injury), the seat's roster by spot against the
-- league's shape, and the week's first kickoff. Seats by number; players are
-- public.
\pset pager off
set search_path = public;
\echo '── the matchup holding the Smothers pick'
select l.id as league, m.id as matchup, m.week, m.status, m.lock_at, m.home_roster_id, m.away_roster_id, now() as now
  from league l join matchup m on m.league_id = l.id
  join sealed_pick sp on sp.matchup_id = m.id
  join college_player cp on 'c-' || cp.espn_id = sp.player_slug
 where l.name = 'Devy Test 1' and m.status <> 'final' and cp.full_name ilike '%smothers%';
\echo '── that seat''s weekly picks'
select lm.sleeper_roster_id as seat, sp.roster_slot, sp.player_slug, cp.full_name, cp.school_abbr, sp.locked, sp.revealed_at, sp.updated_at,
       classic_kickoff_for(m.league_id, m.week, sp.player_slug) as his_kickoff,
       classic_pick_lock(m.id, sp.player_slug, window_kickoff(m.week, 'wk')) as locks_at,
       i.status as injury
  from league l join matchup m on m.league_id = l.id and m.status <> 'final'
  join sealed_pick sp on sp.matchup_id = m.id and sp.game_window = 'wk'
  join league_membership lm on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
  left join college_player cp on 'c-' || cp.espn_id = sp.player_slug
  left join injury_status i on i.player_slug = sp.player_slug
 where l.name = 'Devy Test 1'
   and sp.app_user_id in (select sp2.app_user_id from sealed_pick sp2 join college_player c2 on 'c-' || c2.espn_id = sp2.player_slug
                           where sp2.matchup_id = m.id and c2.full_name ilike '%smothers%')
 order by sp.roster_slot;
\echo '── that seat''s roster by spot, and the league''s shape'
select lm.sleeper_roster_id as seat, nr.spot, count(*) as n
  from league l join matchup m on m.league_id = l.id and m.status <> 'final'
  join sealed_pick sp on sp.matchup_id = m.id
  join college_player c2 on 'c-' || c2.espn_id = sp.player_slug and c2.full_name ilike '%smothers%'
  join league_membership lm on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
  join native_roster nr on nr.league_id = l.id and nr.roster_id = lm.sleeper_roster_id
 where l.name = 'Devy Test 1' group by 1, 2 order by 2;
select settings_json -> 'roster_shape' as roster_shape, settings_json -> 'roster_slots' as roster_slots, settings_json ->> 'calendar' as calendar
  from league where name = 'Devy Test 1';
\echo '── the week''s kickoffs: first, and how many games'
select m.week, window_kickoff(m.week, 'wk') as wk_kickoff, (select count(*) from nfl_slate s where s.week = m.week) as games
  from league l join matchup m on m.league_id = l.id and m.status <> 'final'
 where l.name = 'Devy Test 1' group by m.week order by m.week limit 3;
