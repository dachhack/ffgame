-- What is actually in sleeper_lineup for a league, and in what shape.
--
-- WHY THIS EXISTS: a roster showed on the web and was empty in the app for the
-- same league and week. Two theories were reasoned out from the code and both
-- were wrong — first "the league hasn't synced", then "myPool only reads
-- `slug` and Sleeper rows use `player_slug`". The second was a real bug and
-- worth fixing, but it did not fix this, which means the difference is in the
-- DATA and guessing at it from the client is the wrong instrument.
--
-- So: read the rows. Which weeks have lineups, for which rosters, how many
-- entries each holds, and which keys those entries actually use. Every theory
-- about why one client sees a roster and the other doesn't has to survive
-- contact with this output.
--
-- Read-only. Set the league below; the LIKE match saves needing the uuid.

\set league_name 'Console Warriors%'

-- ── 1. The league ────────────────────────────────────────────────────────────
select id, name, season
from league
where name like :'league_name';

-- ── 2. Which weeks and rosters have lineup rows, and how big ─────────────────
-- A roster missing from a week is the simple explanation for an empty pool.
-- `entries` counts what the sync wrote; 0 means a row exists but is empty,
-- which is NOT the same as no row and fails in a different place.
select
  sl.week,
  sl.roster_id,
  jsonb_array_length(sl.starters_json) as entries
from sleeper_lineup sl
join league l on l.id = sl.league_id
where l.name like :'league_name'
order by sl.week, sl.roster_id;

-- ── 3. The SHAPE of the entries ──────────────────────────────────────────────
-- starters_json is written in at least two shapes — ESPN's {slug,...} and
-- Sleeper's {player_slug,...} — and a reader that knows only one silently drops
-- every row of the other. This prints the keys actually present, per week, so
-- the shape is a fact rather than an assumption.
select
  sl.week,
  sl.roster_id,
  (select string_agg(distinct k, ', ' order by k)
     from jsonb_array_elements(sl.starters_json) e,
          jsonb_object_keys(e) k)                    as keys_present,
  sl.starters_json -> 0                              as first_entry
from sleeper_lineup sl
join league l on l.id = sl.league_id
where l.name like :'league_name'
  and jsonb_array_length(sl.starters_json) > 0
order by sl.week, sl.roster_id
limit 20;

-- ── 4. Membership, so the roster ids can be lined up with the entries above ──
-- The app reads league_membership.sleeper_roster_id and queries sleeper_lineup
-- with it. If those two sets of ids don't overlap, that is the whole bug.
select lm.app_user_id, lm.sleeper_roster_id, lm.team_name, lm.enrolled
from league_membership lm
join league l on l.id = lm.league_id
where l.name like :'league_name'
order by lm.sleeper_roster_id;
