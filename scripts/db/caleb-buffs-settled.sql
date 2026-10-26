-- After v0.734.0 (a backup's stakes follow him): Gridiron Gang week 7, seat
-- 11's matchup. Read only: each window's scores and slot scores, so the SNF
-- spot Caleb Williams covered shows Double or Nothing and Grudge settled.
-- Seats by number; no names printed.
\pset pager off
set search_path = public;
select m.status, case when m.home_roster_id = 11 then 'home' else 'away' end as seat_side,
       s.game_window, s.home_score, s.away_score, s.updated_at, s.slot_scores
  from matchup m
  join matchup_state s on s.matchup_id = m.id
 where m.league_id = '798acff0-e0bb-4e11-9e1b-4a3bb29525bd' and m.week = 7
   and 11 in (m.home_roster_id, m.away_roster_id)
 order by s.game_window;
