-- Why is a classic team's lineup still empty? (v0.247.0 diagnostic)
--
-- autoSlotClassicLineups fills a spot only when it has NO STORED ROW — a row
-- holding NULL is a manager who emptied that spot on purpose, and re-filling it
-- would un-do a decision on every worker tick. That rule is right, but it makes
-- "nothing happened" ambiguous from the outside: a seat with a full set of NULL
-- rows and a seat the worker never reached look identical on the board.
--
-- This tells them apart. Read-only. For each seat of every scheduled classic
-- matchup it prints the four things that decide whether a lineup gets written:
--   has_user   — false means no app_user_id, so sealed_pick has nowhere to hang
--                the row and the seat is skipped by design
--   roster_n   — 0 means undrafted (or everyone taxi/IR), nothing to slot
--   wk_rows    — how many spots already have a row AT ALL
--   wk_filled  — how many of those hold a player
-- wk_rows = spots and wk_filled = 0 is the interesting one: every spot reads as
-- "deliberately emptied" and the auto-slot will never touch that seat again.

\echo ''
\echo '── classic leagues: mode, policy, shape ──'
select l.id,
       left(l.name, 28)                                            as name,
       l.settings_json ->> 'game_mode'                             as mode,
       l.lineup_policy,
       jsonb_array_length(l.settings_json -> 'roster_slots')        as builder_spots,
       (select count(*) from league_pool  p where p.league_id = l.id) as pool_n,
       (select count(*) from native_roster r
         where r.league_id = l.id and r.spot = 'active')            as active_n
  from league l
 where coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
 order by l.created_at desc nulls last
 limit 20;

\echo ''
\echo '── every seat of every SCHEDULED classic matchup ──'
select m.week,
       m.status,
       left(m.id::text, 8)                as matchup,
       s.roster_id,
       (mem.app_user_id is not null)      as has_user,
       (select count(*) from native_roster r
         where r.league_id = m.league_id
           and r.roster_id = s.roster_id
           and r.spot = 'active')         as roster_n,
       (select count(*) from sealed_pick sp
         where sp.matchup_id = m.id
           and sp.app_user_id = mem.app_user_id
           and sp.game_window = 'wk')     as wk_rows,
       (select count(*) from sealed_pick sp
         where sp.matchup_id = m.id
           and sp.app_user_id = mem.app_user_id
           and sp.game_window = 'wk'
           and sp.player_slug is not null) as wk_filled
  from matchup m
  join league l on l.id = m.league_id
 cross join lateral (values (m.home_roster_id), (m.away_roster_id)) as s(roster_id)
  left join league_membership mem
         on mem.league_id = m.league_id
        and mem.sleeper_roster_id = s.roster_id
 where coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
   and m.status = 'scheduled'
 order by m.week, m.id, s.roster_id
 limit 80;
