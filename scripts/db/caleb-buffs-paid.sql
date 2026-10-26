-- Gridiron Gang seat 11, week 7: what Double or Nothing and Grudge Match cost
-- (founder: "make them follow the player, and refund them"). Read only: the
-- seat's ledger rows for those two cards since Oct 20, its hand of them, and
-- the week-7 matchup's TNF/SNF window scores, so the refund and the re-score
-- under v0.734.0 can be weighed. Seats by number; no names printed.
\pset pager off
set search_path = public;
\echo '── seat 11 buys of the two cards since Oct 20 (coin_ledger)'
select c.id, c.created_at, c.week, c.delta, c.reason, c.idem_key, c.matchup_id
  from coin_ledger c
 where c.league_id = '798acff0-e0bb-4e11-9e1b-4a3bb29525bd' and c.roster_id = 11
   and c.created_at >= '2026-10-20'
   and (c.reason ilike '%double-or-nothing%' or c.reason ilike '%grudge%' or c.reason ilike 'refund%')
 order by c.created_at;
\echo '── its hand of those cards and wallet'
select i.powerup_id, i.qty,
       (select w.coins from team_wallet w where w.league_id = i.league_id and w.roster_id = i.roster_id) as wallet
  from team_inventory i
 where i.league_id = '798acff0-e0bb-4e11-9e1b-4a3bb29525bd' and i.roster_id = 11
   and i.powerup_id in ('double-or-nothing', 'grudge');
\echo '── the week-7 matchup: seat side, status, window scores'
select m.id, m.status, case when m.home_roster_id = 11 then 'home' else 'away' end as seat_side,
       s.game_window, s.home_score, s.away_score, s.slot_scores
  from matchup m
  left join matchup_state s on s.matchup_id = m.id and s.game_window in ('tnf', 'snf')
 where m.league_id = '798acff0-e0bb-4e11-9e1b-4a3bb29525bd' and m.week = 7
   and 11 in (m.home_roster_id, m.away_roster_id)
 order by s.game_window;
