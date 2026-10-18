-- Issue #1365 (Kickoff League chat): "@computer what are you doing here. AJ
-- Brown is about to make a return" — after "🔻 Team 4 dropped A.J. Brown"
-- (Oct 17 20:56 UTC). Team 4 is an AI seat; the seat wire's only bare drops
-- are its IR-legalising cuts (seatWire.js), which judge by rest-of-season
-- value, and that value is 0 for any IR tag. Which path cut him, and with
-- what tag? Read only; seats and players only.
\pset pager off
set search_path = public;
\set lid '''5ae08e35-c852-42a6-b944-69779cb012d0'''
select sleeper_roster_id as rid from league_membership where league_id = :lid and team_name = 'Team 4' limit 1 \gset
\echo '── 1. A.J. Brown now: his injury row and where he is'
select i.player_slug, i.status, i.return_date, i.updated_at, left(i.comment, 160) as comment, i.source
  from injury_status i where i.player_slug in (select slug from league_pool where league_id = :lid and full_name ilike 'A.J. Brown');
select lp.slug, lp.team, lp.pos, lp.waived_until,
       (select string_agg(nr.roster_id::text || ':' || nr.spot, ', ') from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug) as held_by
  from league_pool lp where lp.league_id = :lid and lp.full_name ilike 'A.J. Brown';
\echo '── 2. Team 4''s moves Oct 15 on (the drop and whatever came with it)'
select t.at, t.kind, t.slug, t.from_roster from league_txn t
 where t.league_id = :lid and (t.roster_id = :rid or t.from_roster = :rid) and t.at > '2026-10-15'
 order by t.at;
\echo '── 3. Team 4''s roster now, with spots and tags'
select nr.slug, lp.pos, nr.spot, i.status as inj, i.return_date
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  left join injury_status i on i.player_slug = nr.slug
 where nr.league_id = :lid and nr.roster_id = :rid order by nr.spot, lp.pos, nr.slug;
\echo '── 4. the league''s IR/OUT rules and shape'
select settings_json -> 'roster_shape' as shape, settings_json -> 'ir_tags' as ir_tags, settings_json -> 'out_tags' as out_tags
  from league where id = :lid;
\echo '── 5. Team 4''s claims Oct 15 on'
select w.created_at, w.status, w.add_slug, w.drop_slug, w.note from waiver_claim w
 where w.league_id = :lid and w.roster_id = :rid and w.created_at > '2026-10-15' order by w.created_at;
