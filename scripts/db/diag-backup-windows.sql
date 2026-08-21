-- READ-ONLY diagnostic: why did a seat play nobody in a window?
-- Run via the "Run a database query" workflow WITHOUT allow_writes.
--
-- Set the league below, and the week floor. 100 covers the PRESEASON board
-- weeks (PRE 1..4 are 101..104); use 0 for a regular season.
--
-- Answers, per seat and window: who controls the seat, whether it has an
-- account at all, how many picks it fielded, and whether the auto-fill had any
-- pool rows to draw from — i.e. which branch of materializeAutoLineups, or
-- which data gap, left the window empty.
--
-- THE TWO THINGS THAT MAKE A DRIP SEAT FIELD NOTHING, both visible below:
--
--   1. NO ACCOUNT ON THE SEAT. `sealed_pick.app_user_id` is NOT NULL, so an
--      unclaimed seat has nowhere to store a lineup and materializeAutoLineups
--      skips it outright (lock.js: "empty seat → resolver auto-backup"). It
--      then depends entirely on the resolve-time rebuild. Seat agents (0180)
--      solve this — but ONLY for classic leagues; a drip league's unclaimed
--      seat has no agent, so `has_account = false` here means every lineup it
--      ever fields is recomputed at resolve rather than stored.
--
--   2. NO POOL FOR THAT WEEK. Both the lock-time fill and the resolve-time
--      rebuild draw their players from `sleeper_lineup.starters_json` for that
--      EXACT week (lock.js startersByRoster; resolve.js lineupSlugs). No row,
--      or an empty one, and neither path can field anybody however healthy the
--      roster is. In preseason those rows come from `seedPreseasonPool`, and
--      toggling preseason OFF DELETES them — so a re-toggle without a re-seed
--      leaves exactly this shape: `pool_rows` null or 0, picks 0.
--
-- `picks = 0` with `has_account = true` and `pool_rows > 0` is a THIRD case and
-- a real bug: the fill could have run and didn't. Check lineup_policy first —
-- 'empty' is the commissioner opting out, and then zero is correct.

\set league_name 'Turf Warriors'
\set week_floor 100

-- The league's fill policy and mode. 'empty' means missed/partial seats are
-- NEVER auto-filled, whatever the materializer thinks; classic and drip take
-- entirely different fill paths, so which one this is decides what to read.
select name,
       lineup_policy,
       coalesce(settings_json ->> 'game_mode', 'drip') as game_mode,
       (preseason_at is not null) as preseason_toggle_on
  from league where name = :'league_name';

select l.name league, m.week, m.status, m.id matchup_id
  from matchup m join league l on l.id = m.league_id
  where l.name = :'league_name' and m.week >= :week_floor order by m.week;

-- Seats: who controls them, enrollment, per-window pick counts.
-- Picks are counted under the seat's OWN identity — its account, or its agent
-- (0180) when an unclaimed classic seat has one. Joining on app_user_id alone
-- would report every agent-held seat as having fielded nothing.
select l.name league, m.week, lm.sleeper_roster_id seat, lm.team_name,
       lm.controller, lm.enrolled, (lm.app_user_id is not null) has_account,
       (sa.agent_user_id is not null) has_agent,
       sp.game_window, count(sp.id) picks,
       bool_or(sp.locked) any_locked
  from matchup m
  join league l on l.id = m.league_id
  join league_membership lm on lm.league_id = m.league_id
    and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
  left join seat_agent sa on sa.league_id = m.league_id
    and sa.roster_id = lm.sleeper_roster_id
  left join sealed_pick sp on sp.matchup_id = m.id
    and sp.app_user_id = coalesce(lm.app_user_id, sa.agent_user_id)
    and sp.player_slug is not null
  where l.name = :'league_name' and m.week >= :week_floor
  group by l.name, m.week, lm.sleeper_roster_id, lm.team_name, lm.controller,
           lm.enrolled, lm.app_user_id, sa.agent_user_id, sp.game_window
  order by m.week, seat, sp.game_window;

-- Pool depth per seat (can the auto-fill even field anyone?): starters_json
-- entry counts. A seat MISSING from these rows entirely has no lineup row at
-- all for that week, which is not the same as having an empty one — and is the
-- commonest cause of a silent unopposed window in preseason.
select sl.week, sl.roster_id seat, jsonb_array_length(sl.starters_json) pool_rows
  from sleeper_lineup sl join league l on l.id = sl.league_id
  where l.name = :'league_name' and sl.week >= :week_floor
  order by sl.week, seat;

-- THE SUMMARY: every seat that fielded NOTHING, with its diagnosis beside it.
-- This is the one to read first; the queries above are the detail behind it.
select m.week, lm.sleeper_roster_id seat, lm.team_name,
       (lm.app_user_id is not null) has_account,
       (sa.agent_user_id is not null) has_agent,
       lm.controller, lm.enrolled,
       coalesce(jsonb_array_length(sl.starters_json), -1) pool_rows,  -- -1 = no lineup row at all
       l.lineup_policy,
       case
         when lm.app_user_id is null and sa.agent_user_id is null
           then 'unclaimed seat — cannot store picks; resolve-time rebuild only'
         when sl.starters_json is null
           then 'NO lineup row for this week — nothing to field from (re-seed the pool)'
         when coalesce(jsonb_array_length(sl.starters_json), 0) = 0
           then 'lineup row is EMPTY — nothing to field from'
         when l.lineup_policy = 'empty'
           then 'commissioner policy is empty — zero is correct'
         else 'HAS an account and a pool — the fill should have run; this is a bug'
       end as diagnosis
  from matchup m
  join league l on l.id = m.league_id
  join league_membership lm on lm.league_id = m.league_id
    and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
  left join seat_agent sa on sa.league_id = m.league_id
    and sa.roster_id = lm.sleeper_roster_id
  left join sleeper_lineup sl on sl.league_id = m.league_id
    and sl.week = m.week and sl.roster_id = lm.sleeper_roster_id
  where l.name = :'league_name' and m.week >= :week_floor
    and not exists (
      select 1 from sealed_pick sp
      where sp.matchup_id = m.id
        and sp.app_user_id = coalesce(lm.app_user_id, sa.agent_user_id)
        and sp.player_slug is not null)
  order by m.week, seat;

-- The applied backup assignments on those matchups (0137).
select m.week, a.app_user_id, a.payload_json->'targeted'->'backups' backups
  from applied_state a join matchup m on m.id = a.matchup_id
  join league l on l.id = m.league_id
  where l.name = :'league_name' and m.week >= :week_floor
    and a.payload_json->'targeted' ? 'backups';
