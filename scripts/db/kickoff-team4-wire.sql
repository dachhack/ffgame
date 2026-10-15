-- Kickoff League, "Team 4": its lineup shows the K spot empty ("—") and the
-- founder says the AI is not making moves to make the roster legal. Why did
-- the seat wire (server/src/seatWire.js) not fill it? Every gate it passes
-- through, read for this one seat. Read only. Seats and players only — never
-- member names or user ids (the log is public).
\pset pager off
set search_path = public;
\set lid '''5ae08e35-c852-42a6-b944-69779cb012d0'''
select sleeper_roster_id as rid from league_membership
 where league_id = :lid and team_name = 'Team 4' limit 1 \gset
\echo '── 1. is it the worker''s seat? (AI controller, or an agent row, and an account?)'
select :rid as rid, m.controller, m.app_user_id is not null as has_account, m.enrolled,
       exists (select 1 from seat_agent a where a.league_id = :lid and a.roster_id = :rid) as agent_row,
       m.faab_budget, m.eliminated_week
  from league_membership m where m.league_id = :lid and m.sleeper_roster_id = :rid;
\echo '── 2. the league: draft done, agent waivers on, the door, the waiver mode, the shape and caps'
select (select status from draft where league_id = :lid) as draft_status,
       league_agent_waivers(:lid) as agent_waivers, fa_window_open(:lid) as fa_open,
       league_waiver_mode(:lid) as waiver_mode, league_active_seats(:lid) as active_seats,
       settings_json -> 'roster_shape' as shape, settings_json -> 'pos_caps' as pos_caps,
       settings_json -> 'bestball' as bestball, settings_json -> 'roster_slots' as slots
  from league where id = :lid;
\echo '── 3. anything shutting this seat out of the wire'
select wire_block_reason(:lid, :rid) as wire_block,
       roster_illegal_reason(:lid, :rid) as illegal_now,
       roster_seat_error(:lid, :rid, null) as seat_error;
\echo '── 4. the roster, with positions, spots and injury tags'
select nr.slug, lp.pos, lp.team, nr.spot, nr.acquired, i.status as inj
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  left join injury_status i on i.player_slug = nr.slug
 where nr.league_id = :lid and nr.roster_id = :rid
 order by nr.spot, lp.pos, nr.slug;
\echo '── 5. position counts against the caps'
select lp.pos, count(*) as n, league_pos_cap(:lid, lp.pos) as cap
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
 where nr.league_id = :lid and nr.roster_id = :rid group by lp.pos order by lp.pos;
\echo '── 6. its claims since Oct 1 (pending ones hold its claim room)'
select w.status, w.note, w.add_slug, w.drop_slug, w.bid, w.created_at, w.processed_at
  from waiver_claim w where w.league_id = :lid and w.roster_id = :rid and w.created_at > '2026-10-01'
 order by w.created_at;
\echo '── 7. its roster moves since Oct 1'
select t.at, t.kind, t.slug, t.from_roster from league_txn t
 where t.league_id = :lid and (t.roster_id = :rid or t.from_roster = :rid) and t.at > '2026-10-01'
 order by t.at;
\echo '── 8. kickers the wire could offer: unrostered, with their hold'
select lp.slug, lp.team, lp.waived_until
  from league_pool lp
 where lp.league_id = :lid and lp.pos = 'K'
   and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
 order by lp.rank nulls last limit 12;
\echo '── 9. the saved lineup for week 6 (the seat''s own picks, or its agent''s)'
select sp.game_window, sp.roster_slot, sp.player_slug, sp.updated_at
  from sealed_pick sp join matchup m on m.id = sp.matchup_id
 where m.league_id = :lid and m.week = 6 and (m.home_roster_id = :rid or m.away_roster_id = :rid)
   and sp.app_user_id in (
     select app_user_id from league_membership where league_id = :lid and sleeper_roster_id = :rid and app_user_id is not null
     union select agent_user_id from seat_agent where league_id = :lid and roster_id = :rid)
 order by sp.roster_slot;
