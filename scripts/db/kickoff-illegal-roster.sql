-- Kickoff League, week 7 (founder: "How did Mooney get an illegal roster?").
-- Read only: the seat's illegal reason as the database gives it, its roster
-- by spot with each player's injury designation, the league's IR/OUT tags and
-- shape, and every move on that seat since Oct 15. Seat by number, no member
-- names (the seat is found by its team name, which is not printed).
\pset pager off
set search_path = public;
\echo '── the seat and its reason'
select m.sleeper_roster_id as seat, roster_illegal_reason(m.league_id, m.sleeper_roster_id) as reason
  from league_membership m
 where m.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and m.team_name ilike 'mooney%';
\echo '── every seat''s reason'
select m.sleeper_roster_id as seat, roster_illegal_reason(m.league_id, m.sleeper_roster_id) as reason
  from league_membership m where m.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' order by 1;
\echo '── the league''s shape and stash tags'
select _roster_shape('5ae08e35-c852-42a6-b944-69779cb012d0') as shape,
       league_ir_tags('5ae08e35-c852-42a6-b944-69779cb012d0') as ir_tags,
       league_out_tags('5ae08e35-c852-42a6-b944-69779cb012d0') as out_tags;
\echo '── the seat''s roster'
select nr.spot, nr.slug, lp.pos, lp.team, i.status as injury, i.updated_at as injury_at
  from league_membership m
  join native_roster nr on nr.league_id = m.league_id and nr.roster_id = m.sleeper_roster_id
  left join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  left join injury_status i on i.player_slug = nr.slug
 where m.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and m.team_name ilike 'mooney%'
 order by nr.spot, lp.pos, nr.slug;
\echo '── moves on that seat since Oct 15'
select t.at, t.kind, t.slug, t.from_roster, t.actor is null as by_worker
  from league_membership m
  join league_txn t on t.league_id = m.league_id and (t.roster_id = m.sleeper_roster_id or t.from_roster = m.sleeper_roster_id)
 where m.league_id = '5ae08e35-c852-42a6-b944-69779cb012d0' and m.team_name ilike 'mooney%' and t.at >= '2026-10-15'
 order by t.at;
