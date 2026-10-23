-- Test Wedding, week 7: "Still can't move them" after 0520 reopened 11 bye
-- spots. Are J. Allen / J. Croskey-Merritt's spots sealed, WHEN were they
-- sealed (revealed_at after 0520's 20:46:44 UTC run = re-sealed by the
-- worker), does the league pool know their teams (classic_pick_lock NULL =
-- a pooled bye), and how many league_pool rows do the classic leagues hold
-- (over 1000 = the worker's one-shot select was truncated). Read only; seats
-- by number, no member names.
\pset pager off
set search_path = public;
\echo '── Test Wedding'
select l.id, l.settings_json ->> 'game_mode' as mode from league l where l.name = 'Test Wedding';
\echo '── week-7 weekly spots holding Allen / Croskey-Merritt'
select m.id as matchup, m.status, sp.roster_slot, sp.player_slug, sp.locked, sp.revealed_at,
       lp.team as pool_team,
       classic_player_kickoff(sp.matchup_id, sp.player_slug) as his_kickoff,
       classic_pick_lock(sp.matchup_id, sp.player_slug, window_kickoff(m.week, 'wk')) as lock_at
  from league l
  join matchup m on m.league_id = l.id and m.week = 7
  join sealed_pick sp on sp.matchup_id = m.id and sp.game_window = 'wk'
  left join league_pool lp on lp.league_id = l.id and lp.slug = sp.player_slug
 where l.name = 'Test Wedding' and (sp.player_slug ilike '%allen%' or sp.player_slug ilike '%croskey%')
 order by sp.player_slug;
\echo '── every sealed week-7 bye spot (classic_pick_lock NULL) and when it sealed'
select sp.player_slug, sp.revealed_at
  from sealed_pick sp join matchup m on m.id = sp.matchup_id and m.week = 7 and m.status = 'live'
 where sp.game_window = 'wk' and sp.locked and sp.player_slug is not null
   and classic_pick_lock(sp.matchup_id, sp.player_slug, window_kickoff(m.week, 'wk')) is null
 order by sp.revealed_at;
\echo '── league_pool rows across classic leagues with a live week-7 matchup'
select count(*) as pool_rows
  from league_pool lp
 where lp.league_id in (select l.id from league l join matchup m on m.league_id = l.id and m.week = 7
                         where coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic');
