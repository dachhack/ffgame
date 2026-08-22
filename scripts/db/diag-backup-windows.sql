-- READ-ONLY diagnostic: why did a seat play nobody in a window?
-- Run via the "Run a database query" workflow WITHOUT allow_writes.
--
-- Runs across EVERY league by default — `league_name` is a LIKE pattern and '%'
-- matches all of them. That is deliberate: narrowing it means editing and
-- committing this file before you can ask the question, which is the wrong
-- shape for "why is this window empty" at 7am. Narrow it only if the output is
-- noisy: '%Dytesty%' and the like work.
--
-- `week_floor` 100 covers the PRESEASON board weeks (PRE 1..4 are 101..104);
-- use 0 for a regular season.
--
-- Answers, per seat and window: who controls the seat, whether it has an
-- account at all, how many picks it fielded, and whether the auto-fill had any
-- pool rows to draw from — i.e. which branch of materializeAutoLineups, or
-- which data gap, left the window empty.
--
-- THE TWO THINGS THAT MAKE A DRIP SEAT FIELD NOTHING, both visible below:
--
--   1. NO ACCOUNT **AND NO AGENT**. `sealed_pick.app_user_id` is NOT NULL, so
--      such a seat has nowhere to store a lineup at all and the lock-time fill
--      skips it, leaving it on the resolve-time rebuild.
--
--      As of v0.339.0 seat agents cover EVERY mode, not just classic — so a
--      seat showing `has_account = f` AND `has_agent = f` today is one the
--      worker has not minted an agent for yet (it runs each tick), or an AI
--      seat, which is excluded on purpose: an AI seat's lineup comes from
--      `aiSide` at resolve, and that is where its persona and bought buffs
--      live. `has_agent = t` means the seat stores its lineup like any other.
--
--      Before v0.339.0 this was the whole story for drip: eight of twenty-four
--      seats across the two live drip leagues were in exactly this state.
--
--   2. NO POOL FOR THAT WEEK. Both the lock-time fill and the resolve-time
--      rebuild draw their players from `sleeper_lineup.starters_json` for that
--      EXACT week (lock.js startersByRoster; resolve.js lineupSlugs). No row,
--      or an empty one, and neither path can field anybody however healthy the
--      roster is. In preseason those rows come from `seedPreseasonPool`, and
--      toggling preseason OFF DELETES them — so a re-toggle without a re-seed
--      leaves exactly this shape: `pool_rows` null or 0, picks 0.
--
-- `picks = 0` with `has_account = true` and `pool_rows > 0` is a THIRD case,
-- and the only one worth chasing — but read the STATUS column before you do:
--
--   • a SCHEDULED matchup has not locked, and the fill runs at lock, so zero
--     picks there is a week that has not started, not a miss. The first run of
--     this file reported a whole scheduled week as bugs;
--   • `has_account` is read NOW. A seat that was unclaimed when the window
--     sealed could not store picks at all, and a human claiming it later makes
--     the history read as an accounted seat that fielded nothing. On a past
--     week, check when the seat was claimed before calling it a bug.
--
-- And check lineup_policy — 'empty' is the commissioner opting out, and then
-- zero is correct.

\set league_name '%'
\set week_floor 100

-- The league's fill policy and mode. 'empty' means missed/partial seats are
-- NEVER auto-filled, whatever the materializer thinks; classic and drip take
-- entirely different fill paths, so which one this is decides what to read.
select name,
       lineup_policy,
       coalesce(settings_json ->> 'game_mode', 'drip') as game_mode,
       (preseason_at is not null) as preseason_toggle_on
  from league where name like :'league_name' order by name;

select l.name league, m.week, m.status, m.id matchup_id
  from matchup m join league l on l.id = m.league_id
  where l.name like :'league_name' and m.week >= :week_floor order by m.week;

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
  where l.name like :'league_name' and m.week >= :week_floor
  group by l.name, m.week, lm.sleeper_roster_id, lm.team_name, lm.controller,
           lm.enrolled, lm.app_user_id, sa.agent_user_id, sp.game_window
  order by m.week, seat, sp.game_window;

-- Pool depth per seat (can the auto-fill even field anyone?): starters_json
-- entry counts. A seat MISSING from these rows entirely has no lineup row at
-- all for that week, which is not the same as having an empty one — and is the
-- commonest cause of a silent unopposed window in preseason.
select l.name league, sl.week, sl.roster_id seat,
       jsonb_array_length(sl.starters_json) pool_rows
  from sleeper_lineup sl join league l on l.id = sl.league_id
  where l.name like :'league_name' and sl.week >= :week_floor
  order by l.name, sl.week, seat;

-- THE SUMMARY: every seat that fielded NOTHING, with its diagnosis beside it.
-- This is the one to read first; the queries above are the detail behind it.
select l.name league, m.week, lm.sleeper_roster_id seat, lm.team_name,
       (lm.app_user_id is not null) has_account,
       (sa.agent_user_id is not null) has_agent,
       lm.controller, lm.enrolled,
       coalesce(jsonb_array_length(sl.starters_json), -1) pool_rows,  -- -1 = no lineup row at all
       l.lineup_policy,
       m.status,
       case
         -- FIRST, because it is the commonest false positive and it fooled the
         -- author of this file: the fill runs AT LOCK, so a scheduled matchup
         -- having no picks is not a miss, it is a week that has not started.
         when m.status = 'scheduled'
           then 'not locked yet — the fill runs at lock, nothing is wrong'
         when lm.app_user_id is null and sa.agent_user_id is null
           then 'unclaimed seat — cannot store picks; resolve-time rebuild only'
         when sl.starters_json is null
           then 'NO lineup row for this week — nothing to field from (re-seed the pool)'
         when coalesce(jsonb_array_length(sl.starters_json), 0) = 0
           then 'lineup row is EMPTY — nothing to field from'
         when l.lineup_policy = 'empty'
           then 'commissioner policy is empty — zero is correct'
         -- CAVEAT, and it matters: `app_user_id` is read NOW, not as it was at
         -- lock. A seat that was UNCLAIMED when the window sealed could not
         -- store picks, and if a human took it afterwards this reads as an
         -- accounted seat that fielded nothing. So on a past week this is
         -- "worth investigating", not "proven bug" — check whether the seat
         -- was claimed before or after that week locked.
         else 'account + pool + locked and still empty — investigate (see caveat: was the seat claimed AFTER this week locked?)'
       end as diagnosis
  from matchup m
  join league l on l.id = m.league_id
  join league_membership lm on lm.league_id = m.league_id
    and lm.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)
  left join seat_agent sa on sa.league_id = m.league_id
    and sa.roster_id = lm.sleeper_roster_id
  left join sleeper_lineup sl on sl.league_id = m.league_id
    and sl.week = m.week and sl.roster_id = lm.sleeper_roster_id
  where l.name like :'league_name' and m.week >= :week_floor
    and not exists (
      select 1 from sealed_pick sp
      where sp.matchup_id = m.id
        and sp.app_user_id = coalesce(lm.app_user_id, sa.agent_user_id)
        and sp.player_slug is not null)
  order by l.name, m.week, seat;

-- The applied backup assignments on those matchups (0137).
select l.name league, m.week, a.app_user_id, a.payload_json->'targeted'->'backups' backups
  from applied_state a join matchup m on m.id = a.matchup_id
  join league l on l.id = m.league_id
  where l.name like :'league_name' and m.week >= :week_floor
    and a.payload_json->'targeted' ? 'backups';
