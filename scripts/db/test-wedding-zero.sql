-- TEST WEDDING, WEEK 5: the founder's seat (Team 1) scored 0.0 against a real 89.4. Read only.
-- Seats and slugs only: no names, no user ids.
\pset pager off
set search_path = public;
\echo '── the league'
select left(id::text, 8) as league, kind, season, created_at, contest_week,
       coalesce(settings_json ->> 'game_mode', 'drip') as game_mode,
       settings_json ? 'roster_slots' as has_slots, settings_json -> 'shotgun' as shotgun,
       settings_json ->> 'week_lock' as week_lock
  from league where name = 'Test Wedding' order by created_at desc;
\echo '── seats (enrolled) and the CPU seats'
select m.sleeper_roster_id as roster_id, m.enrolled, m.app_user_id is not null as claimed, exists (select 1 from seat_agent a where a.league_id = m.league_id and a.roster_id = m.sleeper_roster_id) as cpu
  from league_membership m join league l on l.id = m.league_id where l.name = 'Test Wedding' order by m.sleeper_roster_id;
\echo '── matchups, weeks 4–6'
select m.week, m.home_roster_id as home, m.away_roster_id as away, m.status, m.lock_at, m.home_final, m.away_final, m.home_tb, m.away_tb, m.created_at
  from matchup m join league l on l.id = m.league_id where l.name = 'Test Wedding' and m.week between 4 and 6 order by m.week, m.home_roster_id;
\echo '── the stored lineups, weeks 4–6 (slot@slug)'
select s.week, s.roster_id, jsonb_array_length(s.starters_json) as n,
       (select string_agg(coalesce(e ->> 'slot', e ->> 'spot', '?') || '@' || coalesce(e ->> 'player_slug', e ->> 'slug', '-'), ' ' order by coalesce(e ->> 'slot', e ->> 'spot', '?')) from jsonb_array_elements(s.starters_json) e) as starters
  from sleeper_lineup s join league l on l.id = s.league_id where l.name = 'Test Wedding' and s.week between 4 and 6 order by s.week, s.roster_id;
\echo '── native rosters of seats 1 and 8'
select r.roster_id, r.slug, r.spot, r.acquired, r.added_at
  from native_roster r join league l on l.id = r.league_id where l.name = 'Test Wedding' and r.roster_id in (1, 8) order by r.roster_id, r.added_at;
\echo '── lineup edits (the log)'
select e.week, e.roster_id, e.note, e.set_at, left(e.before::text, 160) as before, left(e.after::text, 160) as after
  from lineup_edit_log e join league l on l.id = e.league_id where l.name = 'Test Wedding' order by e.set_at;
\echo '── the week-5 matchup of seat 1, by window'
select ms.game_window, ms.home_score, ms.away_score, jsonb_array_length(ms.events_json) as events, ms.updated_at
  from matchup_state ms join matchup m on m.id = ms.matchup_id join league l on l.id = m.league_id
 where l.name = 'Test Wedding' and m.week = 5 and (m.home_roster_id = 1 or m.away_roster_id = 1) order by ms.game_window;
\echo '── the weddings'
select w.week, w.home_roster, w.away_roster, w.home_score, w.away_score, w.winner, w.status, w.deadline, w.home_gives, w.away_gives, w.counter_from
  from shotgun_wedding w join league l on l.id = w.league_id where l.name = 'Test Wedding' order by w.week;
\echo '── voids, holds, rescore requests'
select 'void' as what, v.week, v.set_at from week_void v join league l on l.id = v.league_id where l.name = 'Test Wedding'
union all select 'hold', h.week, h.created_at from week_lock_hold h join league l on l.id = h.league_id where l.name = 'Test Wedding'
order by 2;
