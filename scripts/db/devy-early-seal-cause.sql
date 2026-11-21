-- Devy Test 1, college week 212: why were a seat's weekly picks sealed on
-- Tuesday Nov 17, 20:19–20:28 UTC, days before their games (ops 097, 0533)?
-- Read only. The audit trail of those picks (who wrote each change, and when:
-- a null actor is the worker), any commissioner lineup fix that week, the
-- slate rows of the games involved (when each was last written), how the
-- week's first kickoff sits against the seal times, and whether earlier weeks
-- sealed early too. Seats by number; an actor is shown only as worker /
-- the seat's own account / another account.
\pset pager off
set search_path = public;
\echo '── audit trail of seat 1''s week-212 picks (Nov 17 onward)'
with mine as (
  select sp.id, sp.roster_slot, sp.app_user_id
    from sealed_pick sp join matchup m on m.id = sp.matchup_id join league l on l.id = m.league_id
    join league_membership lm on lm.league_id = l.id and lm.app_user_id = sp.app_user_id and lm.sleeper_roster_id = 1
   where l.name = 'Devy Test 1' and m.week = 212 and sp.game_window = 'wk')
select a.at, a.op, mine.roster_slot,
       case when a.actor is null then 'worker' when a.actor = mine.app_user_id then 'seat' else 'other account' end as actor,
       a.old_row ->> 'player_slug' as old_slug, a.new_row ->> 'player_slug' as new_slug,
       a.old_row ->> 'locked' as was_locked, a.new_row ->> 'locked' as now_locked
  from audit_log a join mine on a.row_id = mine.id::text
 where a.table_name = 'sealed_pick' and a.at >= '2026-11-16'
 order by a.at, mine.roster_slot;
\echo '── every week-212 pick in the league: when sealed against its own kickoff'
select lm.sleeper_roster_id as seat, count(*) as picks,
       count(*) filter (where sp.revealed_at is not null) as sealed_rows,
       min(sp.revealed_at) as first_seal, max(sp.revealed_at) as last_seal
  from sealed_pick sp join matchup m on m.id = sp.matchup_id join league l on l.id = m.league_id
  left join league_membership lm on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
 where l.name = 'Devy Test 1' and m.week = 212 and sp.game_window = 'wk'
 group by 1 order by 1;
\echo '── commissioner lineup fixes in the league since Nov 10'
select e.set_at, e.week, e.roster_id as seat, left(coalesce(e.note, ''), 60) as note
  from lineup_edit_log e join league l on l.id = e.league_id
 where l.name = 'Devy Test 1' and e.set_at >= '2026-11-10' order by e.set_at;
\echo '── slate rows of the games involved, weeks 211–213'
select s.week, s.away, s.home, s.win, s.kickoff, s.time_tbd, s.updated_at, s.game_id
  from nfl_slate s
 where s.week between 211 and 213
   and (upper(s.home) in ('TEX','UTAH','TCU','GT','UVA','MSST','ORE','LSU') or upper(s.away) in ('TEX','UTAH','TCU','GT','UVA','MSST','ORE','LSU'))
 order by s.week, s.kickoff;
\echo '── each college week''s slate: games, first and last kickoff, first and last write'
select s.season, s.week, count(*) as games, min(s.kickoff) as first_kick, max(s.kickoff) as last_kick, min(s.updated_at) as first_write, max(s.updated_at) as last_write,
       count(*) filter (where s.time_tbd) as tbd
  from nfl_slate s where s.week between 209 and 214 group by 1, 2 order by 1, 2;
\echo '── earlier weeks in the league: picks sealed more than 10 minutes before their own kickoff'
select m.week, count(*) as picks,
       count(*) filter (where sp.revealed_at < classic_kickoff_for(m.league_id, m.week, sp.player_slug) - interval '10 minutes') as sealed_early,
       min(sp.revealed_at) as first_seal, min(classic_kickoff_for(m.league_id, m.week, sp.player_slug)) as first_kick
  from sealed_pick sp join matchup m on m.id = sp.matchup_id join league l on l.id = m.league_id
 where l.name = 'Devy Test 1' and m.week between 206 and 212 and sp.game_window = 'wk' and sp.player_slug is not null
 group by 1 order by 1;
\echo '── the week-212 matchups: status changes on the audit trail'
select a.at, case when a.actor is null then 'worker' else 'account' end as actor, a.old_row ->> 'status' as was, a.new_row ->> 'status' as now, a.new_row ->> 'lock_at' as lock_at
  from audit_log a join matchup m on a.row_id = m.id::text join league l on l.id = m.league_id
 where a.table_name = 'matchup' and l.name = 'Devy Test 1' and m.week = 212
   and (a.old_row ->> 'status') is distinct from (a.new_row ->> 'status')
 order by a.at limit 20;
