-- ═══════════════════════════════════════════════════════════════════════════
-- 0385 · A KICKOFF NOBODY HAS SET YET.
--
-- The founder's board read "Sat, 12:00 AM vs ALA" for Mississippi State: ESPN
-- lists a game whose TV slot isn't picked with the date at midnight Eastern
-- and `timeValid: false`. nfl_slate kept the date and dropped the flag, so
-- every such college game read as a midnight kickoff. time_tbd carries it;
-- the worker writes it on the college slate (the daily sweep refreshes it as
-- times are set), and the board prints "TBD".
-- college_games_in_nfl_week (0384) hands it on too.
-- ═══════════════════════════════════════════════════════════════════════════

alter table nfl_slate add column if not exists time_tbd boolean not null default false;

create or replace function college_games_in_nfl_week(p_week int) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('week', s.week, 'home', s.home, 'away', s.away, 'kickoff', s.kickoff,
                                               'time_tbd', s.time_tbd)
                            order by s.kickoff), '[]'::jsonb)
    from nfl_slate s, nfl_week_window(p_week) w
   where p_week between 1 and 100
     and s.week between 201 and 223
     and s.kickoff between w.lo and w.hi
$$;
grant execute on function college_games_in_nfl_week(int) to authenticated;
