-- TEST WEDDING, WEEK 5, seat 1 scored 0.0: the sealed rows behind the score. Read only; no names, no user ids.
\pset pager off
set search_path = public;
\echo '── sealed rows of the week-5 matchups (whose seat: the home or away roster via membership / agent)'
select m.week, m.home_roster_id as home, m.away_roster_id as away,
       case when sp.app_user_id = mem.app_user_id then 'seat ' || mem.sleeper_roster_id when sp.app_user_id = ag.agent_user_id then 'cpu ' || ag.roster_id else 'other' end as whose,
       sp.game_window, sp.roster_slot, sp.player_slug, sp.locked, sp.created_at, sp.updated_at, sp.revealed_at
  from sealed_pick sp join matchup m on m.id = sp.matchup_id join league l on l.id = m.league_id
  left join league_membership mem on mem.league_id = l.id and mem.app_user_id = sp.app_user_id
  left join seat_agent ag on ag.league_id = l.id and ag.agent_user_id = sp.app_user_id
 where l.name = 'Test Wedding' and m.week in (5, 6)
 order by m.week, m.home_roster_id, whose, sp.roster_slot;
\echo '── counts per matchup and seat'
select m.week, m.home_roster_id as home, m.away_roster_id as away, sp.app_user_id = mem.app_user_id as human, count(*) as rows_, count(sp.player_slug) as with_player, bool_or(sp.locked) as any_locked
  from sealed_pick sp join matchup m on m.id = sp.matchup_id join league l on l.id = m.league_id
  left join league_membership mem on mem.league_id = l.id and mem.app_user_id = sp.app_user_id
 where l.name = 'Test Wedding' and m.week in (5, 6) group by 1, 2, 3, 4 order by 1, 2, 4;
\echo '── the draft'
select d.status, d.rounds from draft d join league l on l.id = d.league_id where l.name = 'Test Wedding';
