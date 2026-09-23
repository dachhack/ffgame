-- WHICH TEAMS ARE LOCKED RIGHT NOW (0360), and why.
--
-- 0360 widened roster_illegal_reason: a healed player on IR/OUT, a taxi player
-- past the experience ceiling, an over-full shelf, active overflow. A team it
-- flags can't add or change its lineup, and in a classic best-ball league its
-- best-ball spots stay empty. The rule applied the moment the migration did,
-- mid-week, so this is the list of who it caught.
--
-- Read-only. Run: Actions → "Run a database query" → scripts/db/illegal-rosters-now.sql
\pset pager off

-- 1. Totals, by what kind of problem.
select case
         when reason like '% is on IR but %'            then 'healed player on IR'
         when reason like '% is in an OUT spot but %'   then 'healed player in an OUT spot'
         when reason like '% is on the taxi squad with %' then 'taxi player past the experience limit'
         when reason like 'the % holds % (limit %'      then 'shelf over its spots'
         when reason like 'the active roster holds %'   then 'active roster over its room'
         when reason like 'roster holds %'              then 'roster over its size'
         when reason like 'over the % limit%'           then 'position over its cap'
         else 'other' end as problem,
       count(*) as teams,
       count(distinct league_id) as leagues
  from (select m.league_id, roster_illegal_reason(m.league_id, m.sleeper_roster_id) as reason
          from league_membership m join draft d on d.league_id = m.league_id and d.status = 'complete'
         where m.sleeper_roster_id is not null) x
 where reason is not null
 group by 1 order by 2 desc;

-- 2. Every locked team: who, where, why, and whether best ball is at stake.
select l.name as league,
       coalesce(l.settings_json ->> 'game_mode', 'drip') as mode,
       -- leagueBestball's precedence: a builder spec (roster_slots) decides on
       -- its own, per-spot `bb` flags; only without one does `bestball` count.
       (coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
        and case when jsonb_typeof(l.settings_json -> 'roster_slots') = 'array'
                      and jsonb_array_length(l.settings_json -> 'roster_slots') > 0
                 then exists (select 1 from jsonb_array_elements(l.settings_json -> 'roster_slots') s
                               where coalesce((s ->> 'bb')::boolean, false))
                 else jsonb_typeof(l.settings_json -> 'bestball') = 'array'
                      and jsonb_array_length(l.settings_json -> 'bestball') > 0 end) as loses_best_ball,
       m.sleeper_roster_id as roster,
       coalesce(nullif(m.team_name, ''), 'Team ' || m.sleeper_roster_id) as team,
       m.app_user_id is not null as has_manager,
       roster_illegal_reason(m.league_id, m.sleeper_roster_id) as reason
  from league_membership m
  join league l on l.id = m.league_id
  join draft d on d.league_id = m.league_id and d.status = 'complete'
 where m.sleeper_roster_id is not null
   and roster_illegal_reason(m.league_id, m.sleeper_roster_id) is not null
 order by l.name, m.sleeper_roster_id;

-- 3. The injury feed the IR/OUT rule reads: an empty or stale table would
--    explain a surprising count (empty flags nobody; stale could flag wrongly).
select count(*) as injury_rows, max(updated_at) as newest_row, now() - max(updated_at) as age from injury_status;
