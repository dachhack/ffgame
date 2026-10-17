-- Founder: "Haynes is D in the app but healthy per reports." Justice Haynes
-- (RB #22, Georgia Tech; GT @ VT Sat Oct 17 3:30p). The ACC's Game Day
-- report (posted Sat 13:30 ET) says "Game Time Decision" → Q. What does the
-- app hold for him, from which report, and when was it written? And is the
-- college availability poll writing at all today? Read only.
\pset pager off
set search_path = public;
\echo '── 1. his row (the comment names the report it came from)'
select i.player_slug, i.status, i.source, i.designation_date, i.updated_at, i.comment
  from injury_status i
 where i.player_slug in (select 'c-' || espn_id from college_player where full_name ilike 'Justice Haynes')
    or i.player_slug in (select slug from league_pool where full_name ilike 'Justice Haynes');
\echo '── 2. the poll today: college rows by source and last write'
select source, status, count(*) as n, max(updated_at) as last_write
  from injury_status where player_slug like 'c-%' group by 1, 2 order by 1, 2;
\echo '── 3. the newest ACC Game Day rows written (is today''s game-day report in?)'
select status, count(*) as n, max(updated_at) as last_write
  from injury_status where player_slug like 'c-%' and comment like 'ACC availability report · Game Day%' group by 1;
