-- Founder, All fields box score of FLA@UGA: college players shown as
-- "C 5295814". v0.735.3 reads names from college_player; this checks the
-- directory holds the ids on that screen. Read only; public player names.
\pset pager off
set search_path = public;
select espn_id, full_name, pos, school_abbr, active
  from college_player
 where espn_id in ('5295814', '5132812', '5125593', '5079322', '4685578', '5084047', '5172095', '5215017')
 order by espn_id;
select count(*) as directory_rows, count(*) filter (where active) as active_rows from college_player;
