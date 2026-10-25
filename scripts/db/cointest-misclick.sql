-- Mooney's Cointest misclick (founder: "tapped to try and see if it opened up
-- to see more it bought it immediately so now I have two power ups of
-- something"). The seat's account is found through Kickoff League seat 6
-- (ops 082), then its seats in every contest league whose name says
-- Cointest. Read only: each seat's buys since Oct 23, its hand and wallet.
-- Seats by number; no names, no account ids printed.
\pset pager off
set search_path = public;
\echo '── the seat in each Cointest league'
select l.id as league, l.name as league_name, m.sleeper_roster_id as seat
  from league_membership k
  join league_membership m on m.app_user_id = k.app_user_id
  join league l on l.id = m.league_id
 where k.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and k.sleeper_roster_id = 6
   and l.name ilike '%cointest%';
\echo '── its buys since Oct 23 (coin_ledger)'
select c.id, l.name as league_name, c.roster_id as seat, c.created_at, c.week, c.delta, c.reason, c.idem_key
  from league_membership k
  join league_membership m on m.app_user_id = k.app_user_id
  join league l on l.id = m.league_id and l.name ilike '%cointest%'
  join coin_ledger c on c.league_id = m.league_id and c.roster_id = m.sleeper_roster_id
 where k.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and k.sleeper_roster_id = 6
   and c.created_at >= '2026-10-23' order by c.created_at;
\echo '── its hand and wallet'
select l.name as league_name, m.sleeper_roster_id as seat, i.powerup_id, i.qty,
       (select w.coins from team_wallet w where w.league_id = m.league_id and w.roster_id = m.sleeper_roster_id) as wallet
  from league_membership k
  join league_membership m on m.app_user_id = k.app_user_id
  join league l on l.id = m.league_id and l.name ilike '%cointest%'
  left join team_inventory i on i.league_id = m.league_id and i.roster_id = m.sleeper_roster_id and i.qty > 0
 where k.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and k.sleeper_roster_id = 6
 order by 1, 3;
