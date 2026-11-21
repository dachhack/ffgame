-- Devy Test 1, week 212, second look (follows ops 098). The worker sealed 27
-- picks on Tuesday Nov 17, 20:18–20:28 UTC, in batches a few minutes apart,
-- with no pick changed — and by the migrations the only per-player seal is
-- seal_due_college_picks, whose rule cannot answer "kicked off" before the
-- week's first game. Read only: that function and the three it calls AS THEY
-- ARE IN PRODUCTION, every early seal with its school and game (does the
-- order follow games?), the matchup rows' own changes that afternoon, and the
-- week's game feeds (was something walking the games then?).
\pset pager off
set search_path = public;
\echo '── the seal rule as production has it'
select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname in ('seal_due_college_picks', 'classic_pick_lock', 'classic_player_kickoff', 'classic_kickoff_for', 'window_kickoff')
 order by p.proname;
\echo '── every seal of a week-212 pick in the league before the first kickoff, in order'
select a.at, lm.sleeper_roster_id as seat, a.new_row ->> 'roster_slot' as slot, cp.school_abbr, cp.full_name,
       classic_kickoff_for(m.league_id, m.week, a.new_row ->> 'player_slug') as his_kickoff,
       (select string_agg(s.away || '@' || s.home, ',') from nfl_slate s where s.week = 212 and upper(cp.school_abbr) in (upper(s.home), upper(s.away))) as game
  from audit_log a
  join sealed_pick sp on sp.id::text = a.row_id
  join matchup m on m.id = sp.matchup_id and m.week = 212
  join league l on l.id = m.league_id and l.name = 'Devy Test 1'
  left join league_membership lm on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
  left join college_player cp on 'c-' || cp.espn_id = a.new_row ->> 'player_slug'
 where a.table_name = 'sealed_pick' and a.op = 'UPDATE'
   and a.old_row ->> 'locked' = 'false' and a.new_row ->> 'locked' = 'true'
   and a.at < '2026-11-17 23:00+00'
 order by a.at, 2, 3;
\echo '── week-212 picks NOT sealed before the first kickoff: their schools and games'
select lm.sleeper_roster_id as seat, sp.roster_slot, cp.school_abbr, cp.full_name, classic_kickoff_for(m.league_id, m.week, sp.player_slug) as his_kickoff,
       (select min(a.at) from audit_log a where a.table_name = 'sealed_pick' and a.row_id = sp.id::text and a.op = 'INSERT') as inserted_at
  from sealed_pick sp join matchup m on m.id = sp.matchup_id and m.week = 212
  join league l on l.id = m.league_id and l.name = 'Devy Test 1'
  left join league_membership lm on lm.league_id = l.id and lm.app_user_id = sp.app_user_id
  left join college_player cp on 'c-' || cp.espn_id = sp.player_slug
 where sp.game_window = 'wk'
   and not exists (select 1 from audit_log a where a.table_name = 'sealed_pick' and a.row_id = sp.id::text and a.op = 'UPDATE'
                    and a.new_row ->> 'locked' = 'true' and a.at < '2026-11-17 23:00+00')
 order by 1, 2;
\echo '── the week-212 matchups: every change on Nov 17'
select a.at, case when a.actor is null then 'worker' else 'account' end as actor,
       a.old_row ->> 'week' as was_week, a.new_row ->> 'week' as week, a.old_row ->> 'status' as was, a.new_row ->> 'status' as now,
       a.old_row ->> 'lock_at' as was_lock_at, a.new_row ->> 'lock_at' as lock_at
  from audit_log a join matchup m on a.row_id = m.id::text join league l on l.id = m.league_id
 where a.table_name = 'matchup' and l.name = 'Devy Test 1' and m.week in (211, 212) and a.at >= '2026-11-17' and a.at < '2026-11-18 01:00+00'
 order by a.at limit 40;
\echo '── college players of those seals: school now, last seen, last updated'
select cp.full_name, cp.school_abbr, cp.school_id, cp.active, cp.seen_at, cp.updated_at
  from college_player cp where cp.espn_id in ('5105849','4870760','5121721','4907671','4832804','4912286','5079420','4871053') order by 1;
\echo '── schools sharing an abbreviation with those eight'
select cp.school_abbr, cp.school_id, cp.school, count(*) as players
  from college_player cp where upper(cp.school_abbr) in ('TEX','UTAH','TCU','GT','UVA','MSST','ORE','LSU') group by 1, 2, 3 order by 1, 2;
\echo '── week-212 and 211 game feeds: how many, and when written'
select week, count(*) as feeds, min(updated_at) as first_write, max(updated_at) as last_write,
       count(*) filter (where updated_at between '2026-11-17 20:10+00' and '2026-11-17 20:35+00') as written_in_the_window
  from game_feed where week in (211, 212) group by 1 order by 1;
