-- ═══════════════════════════════════════════════════════════════════════════
-- 0443 · THE POSITION MATCHUP TABLE.
--
-- v0.639.0 graded a matchup off the per-player week multiplier (0330), as two
-- words. The founder: "We need it to be more linear with more distinction.
-- Red / orange / yellow / yellow-green / green. Do we have strength or team
-- matchup or position matchup?"
--
-- We do. The StatHead weekly file carries `defVsPos`: for every defense and
-- every position, what that defense concedes against the league average —
-- blended across last season and this one, shrunk to what persists, clamped
-- to ±18%. It is the factor the weekly multipliers are built FROM. The worker
-- read it and threw it away; this keeps it, one row per season, and the week
-- RPC serves it beside the rows so a screen can grade a player's spot by his
-- opponent's factor against HIS position.
--
-- league_week_projections copied from 0333 with only the marked 0443 change.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists nfl_def_vs_pos (
  season     text primary key,
  -- { "KC": { "QB": 0.94, "RB": 0.956, "WR": 0.919, "TE": 1.066, "K": 1.007, "DST": 0.893, ... }, ... }
  tbl        jsonb not null default '{}'::jsonb,
  -- The feed build the table came out of.
  as_of      timestamptz,
  updated_at timestamptz not null default now()
);
alter table nfl_def_vs_pos enable row level security;
drop policy if exists nfl_def_vs_pos_read on nfl_def_vs_pos;
create policy nfl_def_vs_pos_read on nfl_def_vs_pos for select using (auth.uid() is not null);

-- ── the worker's write ───────────────────────────────────────────────────
create or replace function upsert_def_vs_pos(p_season text, p_table jsonb, p_as_of timestamptz default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_season is null or jsonb_typeof(coalesce(p_table, 'null'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'a season and a table');
  end if;
  insert into nfl_def_vs_pos (season, tbl, as_of, updated_at)
  values (p_season, p_table, p_as_of, now())
  on conflict (season) do update
    set tbl = excluded.tbl, as_of = excluded.as_of, updated_at = now();
  return jsonb_build_object('ok', true, 'season', p_season,
    'teams', (select count(*) from jsonb_object_keys(p_table)));
end $$;
revoke all on function upsert_def_vs_pos(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function upsert_def_vs_pos(text, jsonb, timestamptz) to service_role;

-- ── what the screens read: 0333's body + the table ───────────────────────
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
        'inj', inj, 'adjusted', f <> 1)) from best), '{}'::jsonb),
    -- 0443: the season's defense-vs-position table, beside the rows.
    'def_vs_pos', coalesce((select tbl from nfl_def_vs_pos where season = seas), '{}'::jsonb))
    into res;
  return res;
end $$;
grant execute on function league_week_projections(uuid, int) to authenticated;
