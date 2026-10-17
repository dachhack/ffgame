-- Kickoff League, "Team 4" (an AI seat): the founder reports it "just added
-- players over their roster limit". Which limit, by how many, and which moves
-- put it there? The adds can come from the seat wire (server/src/seatWire.js:
-- add_free_agent into an "open seat", submit_waiver_claim) or the waiver run;
-- each is gated on the ACTIVE seats (roster_seat_error), so this reads every
-- count the league holds a roster to — active vs seats, each shelf vs its cap,
-- the whole roster vs the draft's rounds — and the moves since Oct 12.
-- Read only. Seats and players only, never member names (the log is public).
\pset pager off
set search_path = public;
\set lid '''5ae08e35-c852-42a6-b944-69779cb012d0'''
select sleeper_roster_id as rid from league_membership
 where league_id = :lid and team_name = 'Team 4' limit 1 \gset
\echo '── 1. the limits: rounds, active seats, the shape (shelves), the seat''s controller'
select :rid as rid, d.rounds, league_active_seats(:lid) as active_seats, _roster_shape(:lid) as shape,
       m.controller, exists (select 1 from seat_agent a where a.league_id = :lid and a.roster_id = :rid) as agent_row
  from draft d, league_membership m
 where d.league_id = :lid and m.league_id = :lid and m.sleeper_roster_id = :rid;
\echo '── 2. what it holds, by spot, and in all'
select coalesce(spot, 'ALL') as spot, count(*) as n
  from native_roster where league_id = :lid and roster_id = :rid
 group by rollup(spot) order by spot nulls last;
\echo '── 3. what the league says about it now'
select roster_illegal_reason(:lid, :rid) as illegal_now,
       roster_seat_error(:lid, :rid, null) as seat_full,
       add_limit_reason(:lid, :rid) as add_limit,
       wire_block_reason(:lid, :rid) as wire_block;
\echo '── 4. every team in the league: counts against the same limits (is it only Team 4?)'
select m.sleeper_roster_id as rid, m.controller,
       count(nr.*) filter (where nr.spot = 'active') as active,
       count(nr.*) filter (where nr.spot <> 'active') as shelved,
       count(nr.*) as total,
       roster_illegal_reason(:lid, m.sleeper_roster_id) as illegal_now
  from league_membership m left join native_roster nr on nr.league_id = m.league_id and nr.roster_id = m.sleeper_roster_id
 where m.league_id = :lid and m.sleeper_roster_id is not null
 group by m.sleeper_roster_id, m.controller order by m.sleeper_roster_id;
\echo '── 5. its roster: spot, how acquired, position, and when it arrived (latest add txn)'
select nr.slug, lp.pos, lp.team, nr.spot, nr.acquired,
       (select max(t.at) from league_txn t where t.league_id = :lid and t.roster_id = :rid and t.slug = nr.slug) as added_at
  from native_roster nr left join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
 where nr.league_id = :lid and nr.roster_id = :rid
 order by added_at desc nulls last, nr.spot, lp.pos;
\echo '── 6. its roster moves since Oct 12, oldest first'
select t.at, t.kind, t.slug, t.from_roster from league_txn t
 where t.league_id = :lid and (t.roster_id = :rid or t.from_roster = :rid) and t.at > '2026-10-12'
 order by t.at;
\echo '── 7. its waiver claims since Oct 12 (an add with no drop takes a seat if it wins)'
select w.created_at, w.processed_at, w.status, w.note, w.add_slug, w.drop_slug, w.bid
  from waiver_claim w where w.league_id = :lid and w.roster_id = :rid and w.created_at > '2026-10-12'
 order by w.created_at;
\echo '── 8. the house lines for its moves since Oct 12 (one line per decision: an add and its drop, if any)'
select lm.created_at, lm.txn ->> 'kind' as kind, lm.txn ->> 'add' as add, lm.txn ->> 'drop' as drop
  from league_message lm
 where lm.league_id = :lid and lm.kind = 'txn' and lm.txn ->> 'roster_id' = :'rid'
   and lm.created_at > '2026-10-12'
 order by lm.created_at;
