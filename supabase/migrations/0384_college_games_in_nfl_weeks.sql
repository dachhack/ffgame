-- ═══════════════════════════════════════════════════════════════════════════
-- 0384 · THE COLLEGE GAMES INSIDE AN NFL WEEK, FOR THE BOARD.
--
-- Founder: "fix the devy game lines in NFL weeks too." A mixed league (0372)
-- starts college players in NFL weeks, and the worker already scores a
-- college player's game inside that week's window (classic_kickoff_for, the
-- mirror). The board only reads the NFL week's slate, so his row read "no
-- game listed". This hands the board the college games inside the window:
-- the same rows classic_kickoff_for looks through (201..223, bowls
-- included), and the same window (nfl_week_window, 0372).
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function college_games_in_nfl_week(p_week int) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('week', s.week, 'home', s.home, 'away', s.away, 'kickoff', s.kickoff)
                            order by s.kickoff), '[]'::jsonb)
    from nfl_slate s, nfl_week_window(p_week) w
   where p_week between 1 and 100
     and s.week between 201 and 223
     and s.kickoff between w.lo and w.hi
$$;
grant execute on function college_games_in_nfl_week(int) to authenticated;
