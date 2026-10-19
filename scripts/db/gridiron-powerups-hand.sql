-- #1372, second read. Probe 071 found seat 11's week 6 Grudge and Double or
-- Nothing paid for (Oct 18 19:39 UTC) but absent from its applied_state. The
-- web board spends the card (consume_inventory) before apply_targeted answers;
-- a refused apply then leaves the card gone and nothing armed. This reads the
-- hand, the web's saved board (hero_applied), the week 6 picks and the window
-- kickoffs. READ ONLY; seats and players only.
\pset pager off
set search_path = public;
\set lg '798acff0-e0bb-4e11-9e1b-4a3bb29525bd'

\echo '── 1. seat 11''s hand: DoN / Grudge (qty 0 + updated Oct 18 ~19:39 = spent)'
select powerup_id, qty, updated_at from team_inventory
 where league_id = :'lg' and roster_id = 11 order by updated_at desc limit 12;

\echo '── 2. the web board''s saved state for week 6 (hero_applied), DoN/Grudge keys only'
select left(h.matchup_id::text, 8) as mid, h.updated_at,
       (select string_agg(k, ',') from jsonb_object_keys(h.payload_json) k) as keys,
       h.payload_json -> 'doubleOrNothing' as don, h.payload_json -> 'grudge' as grudge,
       h.payload_json -> 'backups' as backups
  from hero_applied h join matchup m on m.id = h.matchup_id
  join league_membership lm on lm.league_id = m.league_id and lm.app_user_id = h.app_user_id
 where m.league_id = :'lg' and m.week = 6 and lm.sleeper_roster_id = 11;

\echo '── 3. seat 11''s week 6 picks'
select sp.game_window, sp.roster_slot, sp.player_slug, sp.locked, sp.updated_at
  from sealed_pick sp join matchup m on m.id = sp.matchup_id
  join league_membership lm on lm.league_id = m.league_id and lm.app_user_id = sp.app_user_id
 where m.league_id = :'lg' and m.week = 6 and lm.sleeper_roster_id = 11
 order by sp.game_window, sp.roster_slot;

\echo '── 4. week 6 window kickoffs'
select w, window_kickoff(6, w) as kick from unnest(array['tnf','am','early','late','snf','mnf']) w;
