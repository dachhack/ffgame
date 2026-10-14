-- #1311: why did a 1-for-1 claim on CAR Defense lose as "roster over limits"
-- in the Kickoff League's Oct 14 waiver run? Read only. Seats and players
-- only — never member names or user ids (public logs).
\pset pager off
set search_path = public;
\set lid '''5ae08e35-c852-42a6-b944-69779cb012d0'''
\echo '── the seat'
select sleeper_roster_id as rid from league_membership
 where league_id = :lid and team_name ilike 'mooney%' limit 1 \gset
select :rid as rid;
\echo '── the league: shape, caps, draft length, IR/OUT tags'
select settings_json -> 'roster_shape' as shape, settings_json -> 'pos_caps' as pos_caps,
       settings_json -> 'roster_slots' is not null as has_slots,
       (select rounds from draft where league_id = :lid) as rounds,
       league_active_seats(:lid) as active_seats,
       league_ir_tags(:lid) as ir_tags, league_out_tags(:lid) as out_tags
  from league where id = :lid;
\echo '── every claim this seat had in the Oct 14 run (and any since Oct 7)'
select w.id, w.status, w.note, w.add_slug, w.drop_slug, w.bid, w.created_at, w.processed_at
  from waiver_claim w where w.league_id = :lid and w.roster_id = :rid
   and w.created_at > '2026-10-07' order by w.created_at;
\echo '── the roster now, with injury designations'
select nr.slug, lp.pos, lp.team, nr.spot, nr.acquired, i.status as inj, i.updated_at as inj_at,
       classic_slug_started(:lid, nr.slug) as started
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  left join injury_status i on i.player_slug = nr.slug
 where nr.league_id = :lid and nr.roster_id = :rid
 order by nr.spot, lp.pos, nr.slug;
\echo '── what is illegal about it now'
select roster_illegal_reason(:lid, :rid) as illegal_now, roster_seat_error(:lid, :rid, null) as seat_error;
\echo '── every roster move for this seat since Oct 7 (to rebuild the roster at 08:00 Oct 14)'
select t.at, t.kind, t.slug, t.from_roster from league_txn t
 where t.league_id = :lid and (t.roster_id = :rid or t.from_roster = :rid)
   and t.at > '2026-10-07' order by t.at;
\echo '── position counts and caps for the seat now'
select lp.pos, count(*) as n, league_pos_cap(:lid, lp.pos) as cap
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
 where nr.league_id = :lid and nr.roster_id = :rid group by lp.pos order by lp.pos;
