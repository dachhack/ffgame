-- 0333: THE WEEK KNOWS HE IS OUT — two things the source audit found by
-- putting our feeds beside each other (scripts/audit-sources.mjs).
--
-- ── 1. THE POOL'S ESPN IDS ARE MOSTLY MISSING ────────────────────────────
-- league_pool.espn_id is filled from the Sleeper directory (playerIndex),
-- and the audit counted what that actually yields: Sleeper carries an
-- espn_id for 213 of 846 rosterable players, and for only 84 of the top 300
-- by search rank. Jahmyr Gibbs, Ja'Marr Chase and Bijan Robinson all come
-- back null.
--
-- Everything we key on that id has therefore been reaching about a quarter
-- of a roster, and missing the best players in it: the ESPN weekly
-- projection (0329), the player-news feed (0329, `player_news_for(espn_id)`)
-- and the live headshot. Nobody noticed because a missing id degrades to
-- "no row", which looks exactly like "nothing to say about him".
--
-- 0331 already publishes the crosswalk that knows those ids. This backfills
-- the pool from it — both directions, because a pool built from an ESPN
-- import has the opposite hole — and the worker calls it after each
-- crosswalk sweep so a new league fills in too.
--
-- ── 2. THE WEEKLY NUMBER DOES NOT KNOW WHO IS OUT ────────────────────────
-- The audit compared ESPN's week-3 projections against StatHead's for the
-- same 500 players and found 73 where one says zero and the other does not.
-- Reading the names is enough to see what it is: Joe Burrow, Brock Purdy,
-- George Kittle, Rashee Rice, Jayden Daniels. ESPN prices this week's injury
-- report; StatHead's weekly strip zeroes only ROSTER status (IR, practice
-- squad, released) and says in its own documentation that a consumer should
-- apply the week's designations itself — Out to zero, Doubtful to a quarter,
-- Questionable as a flag.
--
-- v0.447.0 made StatHead the primary source, so that became our problem the
-- moment it shipped. We already poll the designations (injury_status, ESPN's
-- live report, every few minutes). This applies them.
--
-- ONLY FOR THE WEEK BEING PLAYED. A designation is a statement about THIS
-- week. Applying today's "Out" to week 9 would be a lie in the other
-- direction, so the discount lands only when the week asked for is the one
-- the schedule says is current — every later week is served untouched, with
-- the designation attached as a flag and nothing else.

-- ── 0. AND THE WRITE PATH NEVER RAN AT ALL ──────────────────────────────
-- 0330's upsert names twelve columns and selects eleven values: `updated_at`
-- was given a default in the column list and nothing in the select, so EVERY
-- call raised "INSERT has more target columns than expressions" and not one
-- row was ever written — by either source.
--
-- Two things hid it. The worker logs an upsert error and carries on, because
-- a stale projection is not worth a crash. And the probe suite that covers
-- this asserted it happily: a psql script without ON_ERROR_STOP keeps going
-- after a failed statement, so the DO block aborted and the file's closing
-- `select 'ALL … PROBES PASS'` printed anyway — the exact trap v0.450.0
-- documented one version earlier, walked into again in the same session.
-- Fixed in both places: the column list here, and `\set ON_ERROR_STOP on` at
-- the top of every suite so no future run can print a pass it did not earn.
create or replace function upsert_week_projections(p_season text, p_week int, p_rows jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_season is null or p_week is null or jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'season, week and a list of rows');
  end if;
  insert into nfl_week_proj (season, week, source, player_key, espn_id, pts, mult, line, opp, home, status, updated_at)
  select p_season, p_week, coalesce(r ->> 'source', 'espn'),
         coalesce(nullif(r ->> 'key', ''), nullif(r ->> 'espn_id', '')),
         nullif(r ->> 'espn_id', ''),
         nullif(r ->> 'pts', '')::numeric, nullif(r ->> 'mult', '')::numeric,
         r -> 'line', nullif(r ->> 'opp', ''), (r ->> 'home')::boolean, nullif(r ->> 'status', ''),
         now()
    from jsonb_array_elements(p_rows) r
   where coalesce(nullif(r ->> 'key', ''), nullif(r ->> 'espn_id', '')) is not null
  on conflict (season, week, source, player_key) do update
    set pts = excluded.pts, mult = excluded.mult, line = excluded.line,
        opp = excluded.opp, home = excluded.home, status = excluded.status,
        espn_id = coalesce(excluded.espn_id, nfl_week_proj.espn_id), updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n, 'season', p_season, 'week', p_week);
end $$;
revoke all on function upsert_week_projections(text, int, jsonb) from public, anon, authenticated;
grant execute on function upsert_week_projections(text, int, jsonb) to service_role;

-- ── the pool, filled in from the crosswalk ───────────────────────────────
create or replace function backfill_pool_ids() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare a int; b int; c int;
begin
  update league_pool lp set espn_id = x.espn_id
    from player_xref x
   where lp.espn_id is null and lp.sleeper_id is not null
     and x.sleeper_id = lp.sleeper_id and x.espn_id is not null;
  get diagnostics a = row_count;
  update league_pool lp set sleeper_id = x.sleeper_id
    from player_xref x
   where lp.sleeper_id is null and lp.espn_id is not null
     and x.espn_id = lp.espn_id and x.sleeper_id is not null;
  get diagnostics b = row_count;
  -- AND THE ONE WE HOLD THAT IS SOMEBODY ELSE'S. The audit found exactly one
  -- in 209 players where the two sources name different ESPN athletes, and
  -- it was decisive: Sleeper's espn_id for Tyler Conklin (3122920) is RYAN
  -- IZZO's — a different tight end from the same draft class, with his own
  -- row and his own Sleeper id. Everything ESPN-keyed about Conklin was
  -- another man's.
  --
  -- This does not overwrite a disagreement on principle; it corrects one only
  -- where the crosswalk positively identifies the id we hold as belonging to
  -- a DIFFERENT player. A mismatch we cannot explain is left alone, because
  -- "the other source disagrees" is not evidence about which is right.
  update league_pool lp set espn_id = x.espn_id
    from player_xref x, player_xref other
   where lp.sleeper_id is not null and x.sleeper_id = lp.sleeper_id
     and x.espn_id is not null and lp.espn_id is not null and lp.espn_id <> x.espn_id
     and other.espn_id = lp.espn_id and other.gsis_id <> x.gsis_id;
  get diagnostics c = row_count;
  return jsonb_build_object('ok', true, 'espn_filled', a, 'sleeper_filled', b, 'espn_corrected', c);
end $$;
revoke all on function backfill_pool_ids() from public, anon, authenticated;
grant execute on function backfill_pool_ids() to service_role;

-- ── which week is being played ───────────────────────────────────────────
-- The earliest week of this season that still has a kickoff ahead of it. In
-- the middle of a Sunday that is today's week; on a Tuesday it is the week
-- about to start, which is the one a manager is setting a lineup for.
create or replace function _current_slate_week(p_season text) returns int
  language sql stable set search_path = public as $$
  select min(week) from nfl_slate
   where season = p_season and week between 1 and 18 and kickoff is not null and kickoff >= now();
$$;

-- ── what the screens read, now with the injury report applied ────────────
-- Re-emitted from 0330. Same shape, two additions: `inj` carries the
-- designation we hold for that player, and for the week being played the
-- points and the multiplier carry it too — Out or IR to zero, Doubtful to a
-- quarter, Questionable flagged and otherwise untouched, which is what the
-- source itself says to do. `adjusted` says whether that happened, because a
-- number that has been changed should say so.
create or replace function league_week_projections(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seas text; res jsonb; cur int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()
          or coalesce(league_public_api(p_league_id), false)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select season into seas from league where id = p_league_id;
  cur := _current_slate_week(seas);
  with best as (
    select lp.slug, w.pts, w.mult, w.opp, w.home, w.status, w.source, w.updated_at,
           i.status as inj,
           -- The discount, as a factor, so points and multiplier move together
           -- and a client that scales its own season number gets the same
           -- answer as one that reads the points.
           case when p_week is distinct from cur or i.status is null then 1
                when i.status in ('O', 'IR') then 0
                when i.status = 'D' then 0.25
                else 1 end as f
      from league_pool lp
      left join injury_status i on i.player_slug = lp.slug
      join lateral (
        select p.* from nfl_week_proj p
         where p.season = seas and p.week = p_week
           and ((p.source = 'stathead' and p.player_key = lp.sleeper_id)
             or (p.source <> 'stathead' and p.player_key = lp.espn_id))
         order by case when p.source = 'stathead' then 0 else 1 end
         limit 1) w on true
     where lp.league_id = p_league_id
  )
  select jsonb_build_object('ok', true, 'season', seas, 'week', p_week,
    'current_week', cur,
    'as_of', (select max(updated_at) from best),
    'projections', coalesce((select jsonb_object_agg(slug, round(pts * f, 2)) from best where pts is not null), '{}'::jsonb),
    'rows', coalesce((select jsonb_object_agg(slug, jsonb_build_object(
        'pts', round(pts * f, 2), 'mult', round(mult * f, 4), 'opp', opp,
        'home', home, 'status', status, 'source', source,
        'inj', inj, 'adjusted', f <> 1)) from best), '{}'::jsonb))
    into res;
  return res;
end $$;
grant execute on function league_week_projections(uuid, int) to authenticated;
