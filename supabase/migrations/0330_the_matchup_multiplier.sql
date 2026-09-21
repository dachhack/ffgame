-- 0330: THE MATCHUP MULTIPLIER — the week's number from the model that made
-- the season one.
--
-- 0329 shipped a weekly projection and took it from ESPN, because ESPN was
-- the only weekly feed we could reach. That was the right call for one
-- version and the wrong number for this app, for a reason that has nothing
-- to do with whose model is better:
--
--   ESPN SERVES A SCALAR IN ESPN'S SCORING. `appliedTotal` is PPR, priced
--   under ESPN's own catalog. A Drip league paying 6 for a passing
--   touchdown, 1.5 per TE reception or anything else off-stock read a number
--   computed under somebody else's rules — the exact bug v0.308.0 spent a
--   version killing on the SEASON projection, reintroduced one week at a
--   time. 0329 stored the raw stat line beside the total to make re-scoring
--   possible later; "later" is now, and the better answer turned out not to
--   need the line at all.
--
-- WHAT WE READ INSTEAD. StatHead — already the source of the season
-- projections this app ranks, drafts and grades trades with (proj2026.ts) —
-- publishes the same model split across the schedule: weekly points = season
-- PPG × the opponent's defense-vs-position multiplier × a home/away nudge
-- (or, where a market line exists, the implied team total blended 60% over
-- that), normalized so the 17 weeks sum back to the season line.
--
-- THE POINT, AND WHY THIS IS EXACT RATHER THAN CLOSE. That split scales a
-- player's WHOLE projected line by ONE multiplier — the note on the feed is
-- explicit that weekly receptions scale with it too (rec_w = recPG × pts_w /
-- ppg). Scoring is linear in the line. So for any catalog whatsoever:
--
--     week points in THIS league = (season rate in THIS league) × mult
--
-- is not an approximation of re-scoring the weekly line, it IS re-scoring
-- the weekly line. We already compute the left factor for every league
-- (engine/projScoring). What was missing was the multiplier, and it is one
-- number per player per week.
--
-- SO THE TABLE STORES THE MULTIPLIER. `pts` stays — it is the source's PPR
-- number, still right for a stock league and still what a screen falls back
-- to — and `mult`, `opp`, `home` and `status` join it. A client that knows
-- the league's scoring multiplies; one that doesn't reads `pts`.
--
-- TWO SOURCES, ONE TABLE. The key becomes (season, week, SOURCE, key), so a
-- StatHead row (keyed by sleeper id, which the feed carries and league_pool
-- has held since 0205) and an ESPN row (keyed by espn athlete id) can sit
-- beside each other. The reader prefers StatHead and falls back to ESPN per
-- player, so a man StatHead has never heard of still has a week's number,
-- and an outage on either side degrades instead of blanking.

-- ── the table grows a second key and the matchup it came from ────────────
alter table nfl_week_proj add column if not exists player_key text;
alter table nfl_week_proj add column if not exists mult   numeric;   -- week ÷ season rate
alter table nfl_week_proj add column if not exists opp    text;      -- opponent team code
alter table nfl_week_proj add column if not exists home   boolean;
alter table nfl_week_proj add column if not exists status text;      -- 'OUT'/'RES'/'backup'/…

update nfl_week_proj set player_key = espn_id where player_key is null;
delete from nfl_week_proj where player_key is null;                  -- cannot happen; belt and braces
-- The old key goes first: espn_id cannot become nullable while it is part of
-- a primary key.
alter table nfl_week_proj drop constraint if exists nfl_week_proj_pkey;
alter table nfl_week_proj alter column espn_id drop not null;
alter table nfl_week_proj alter column player_key set not null;
alter table nfl_week_proj add primary key (season, week, source, player_key);

-- ── the worker's write ───────────────────────────────────────────────────
-- Same shape as 0329 plus the new columns. `key` is the source's own id;
-- `espn_id` is still accepted so the ESPN path did not have to change its
-- rows to keep working.
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
         r -> 'line', nullif(r ->> 'opp', ''), (r ->> 'home')::boolean, nullif(r ->> 'status', '')
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

-- ── what the screens read ────────────────────────────────────────────────
-- One row per pool player: the StatHead row where the crosswalk reaches him
-- (sleeper id), else the ESPN one (athlete id), else nothing at all — an
-- absent player is honest, a zero is a lie about a bye.
--
-- `projections` (slug → PPR points) is unchanged from 0329 so every existing
-- caller keeps working. `rows` is the new half: the multiplier a client with
-- the league's catalog should apply to its own season rate, plus the
-- opponent, the home/away flag, the roster/injury status and WHICH SOURCE
-- answered — because a screen that shows a number owes the reader that.
create or replace function league_week_projections(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare seas text; res jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()
          or coalesce(league_public_api(p_league_id), false)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select season into seas from league where id = p_league_id;
  with best as (
    select lp.slug, w.pts, w.mult, w.opp, w.home, w.status, w.source, w.updated_at
      from league_pool lp
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
    'as_of', (select max(updated_at) from best),
    'projections', coalesce((select jsonb_object_agg(slug, round(pts, 2)) from best where pts is not null), '{}'::jsonb),
    'rows', coalesce((select jsonb_object_agg(slug, jsonb_build_object(
        'pts', round(pts, 2), 'mult', round(mult, 4), 'opp', opp,
        'home', home, 'status', status, 'source', source)) from best), '{}'::jsonb))
    into res;
  return res;
end $$;
grant execute on function league_week_projections(uuid, int) to authenticated;
