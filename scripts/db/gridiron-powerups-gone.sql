-- #1372 (asked from chat in Gridiron Gang, Oct 19 00:13 UTC): "Looks like the
-- power ups disappeared" — a team says it played Double or Nothing and Grudge
-- Match. READ ONLY. Seats, players and ids only: no names, no team names, no
-- messages (the log is public).
\pset pager off
\set lg '798acff0-e0bb-4e11-9e1b-4a3bb29525bd'

\echo '── 1. the league'
select kind, provider, sport, season, league_powerups_off(id) as powerups_off,
       settings_json -> 'tiers' as tiers, settings_json ->> 'format' as format,
       (select count(*) from league_membership where league_id = l.id) as seats
  from league l where id = :'lg';

\echo '── 2. seats'
select sleeper_roster_id as seat, controller, enrolled, app_user_id is not null as has_user, division
  from league_membership where league_id = :'lg' order by 1;

\echo '── 3. matchups, weeks 5-8 (created_at shows a rebuild)'
select week, left(id::text, 8) as mid, home_roster_id as home, away_roster_id as away, status, created_at, lock_at
  from matchup where league_id = :'lg' and week between 5 and 8 order by week, home_roster_id;

\echo '── 4. armed loadouts, weeks 5-8 (seat = the row owner''s seat)'
select a.week, left(a.matchup_id::text, 8) as mid, lm.sleeper_roster_id as seat, a.updated_at,
       (select string_agg(k, ',') from jsonb_object_keys(a.payload_json) k) as keys,
       a.payload_json -> 'targeted' as targeted, a.payload_json -> 'buffs' as buffs
  from applied_state a join matchup m on m.id = a.matchup_id
  left join league_membership lm on lm.league_id = m.league_id and lm.app_user_id = a.app_user_id
 where m.league_id = :'lg' and m.week between 5 and 8 order by a.week, seat;

\echo '── 5. coin ledger since Oct 12 (matchup null = its matchup was deleted)'
select roster_id as seat, week, left(matchup_id::text, 8) as mid, delta, reason, created_at
  from coin_ledger where league_id = :'lg' and created_at > '2026-10-12'
 order by created_at;

\echo '── 6. Double or Nothing / Grudge: bought vs armed, per seat, season'
select lm.sleeper_roster_id as seat, p.id as powerup,
       powerup_purchases(:'lg', lm.sleeper_roster_id, p.id) as bought,
       coalesce((select sum(targeted_applies(coalesce(a.payload_json -> 'targeted', '{}'::jsonb), p.id))::int
                   from applied_state a join matchup m2 on m2.id = a.matchup_id
                  where a.app_user_id = lm.app_user_id and m2.league_id = :'lg'), 0) as armed
  from league_membership lm cross join (values ('double-or-nothing'), ('grudge')) p(id)
 where lm.league_id = :'lg' order by 1, 2;

\echo '── 7. the picks under each armed DoN / Grudge (does a pick still sit at that window|slot?)'
with t as (
  select a.matchup_id, a.app_user_id, m.week, 'don' as kind,
         a.payload_json -> 'targeted' -> 'don' ->> 'win' as win, a.payload_json -> 'targeted' -> 'don' ->> 'slot' as slot
    from applied_state a join matchup m on m.id = a.matchup_id
   where m.league_id = :'lg' and m.week between 5 and 8 and a.payload_json -> 'targeted' ? 'don'
  union all
  select a.matchup_id, a.app_user_id, m.week, 'grudge', split_part(g, '|', 1), split_part(g, '|', 2)
    from applied_state a join matchup m on m.id = a.matchup_id
    cross join lateral jsonb_array_elements_text(coalesce(a.payload_json -> 'targeted' -> 'grudge', '[]'::jsonb)) g
   where m.league_id = :'lg' and m.week between 5 and 8)
select t.week, left(t.matchup_id::text, 8) as mid, lm.sleeper_roster_id as seat, t.kind, t.win, t.slot,
       sp.player_slug, sp.locked, sp.updated_at as pick_updated, window_kickoff(t.week, t.win) as window_kick
  from t
  left join league_membership lm on lm.league_id = :'lg' and lm.app_user_id = t.app_user_id
  left join sealed_pick sp on sp.matchup_id = t.matchup_id and sp.app_user_id = t.app_user_id
                          and sp.game_window = t.win and sp.roster_slot = t.slot
 order by 1, 3;

\echo '── 8. scored state for week 6 (windows, and whether events mention the plays)'
select left(ms.matchup_id::text, 8) as mid, ms.game_window, ms.home_score, ms.away_score, ms.updated_at,
       (select count(*) from jsonb_array_elements(ms.events_json) e where e::text ~* 'grudge|double|don') as play_events
  from matchup_state ms join matchup m on m.id = ms.matchup_id
 where m.league_id = :'lg' and m.week = 6 order by 1, 2;

\echo '── 9. tier moves'
select after_week, roster_id as seat, direction, from_tier, to_tier, created_at
  from league_tier_move where league_id = :'lg' order by created_at;
