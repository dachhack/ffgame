-- READ-ONLY diagnostic: why did a seat play nobody in a window?
-- Run via the "Run a database query" workflow WITHOUT allow_writes.
-- Scope: the practice-week matchups of the league named below.
--
-- Answers, per seat and window: controller (human/ai), enrolled, picks per
-- window, and whether the auto-fill had pool rows to draw from — i.e. which
-- branch of materializeAutoLineups (or which data gap) left a window empty.

\set league_name 'Turf Warriors'

-- The league's fill policy — 'empty' means missed/partial seats are NEVER
-- auto-filled, whatever the materializer thinks.
select name, lineup_policy from league where name = :'league_name';

select l.name league, m.week, m.status, m.id matchup_id
  from matchup m join league l on l.id = m.league_id
  where l.name = :'league_name' and m.week >= 100 order by m.week;

-- Seats: who controls them, enrollment, per-window pick counts.
select l.name league, m.week, lm.sleeper_roster_id seat, lm.team_name,
       lm.controller, lm.enrolled, (lm.app_user_id is not null) has_account,
       sp.game_window, count(sp.id) picks,
       bool_or(sp.locked) any_locked
  from matchup m
  join league l on l.id = m.league_id
  join league_membership lm on lm.league_id = m.league_id
    and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
  left join sealed_pick sp on sp.matchup_id = m.id and sp.app_user_id = lm.app_user_id
    and sp.player_slug is not null
  where l.name = :'league_name' and m.week >= 100
  group by l.name, m.week, lm.sleeper_roster_id, lm.team_name, lm.controller, lm.enrolled, lm.app_user_id, sp.game_window
  order by m.week, seat, sp.game_window;

-- Pool depth per seat for the practice weeks (can the auto-fill even field
-- anyone?): starters_json entry counts.
select sl.week, sl.roster_id seat, jsonb_array_length(sl.starters_json) pool_rows
  from sleeper_lineup sl join league l on l.id = sl.league_id
  where l.name = :'league_name' and sl.week >= 100
  order by sl.week, seat;

-- The applied backup assignments on those matchups (0137).
select m.week, a.app_user_id, a.payload_json->'targeted'->'backups' backups
  from applied_state a join matchup m on m.id = a.matchup_id
  join league l on l.id = m.league_id
  where l.name = :'league_name' and m.week >= 100
    and a.payload_json->'targeted' ? 'backups';
