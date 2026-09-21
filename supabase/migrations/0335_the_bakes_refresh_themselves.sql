-- 0335: THE OTHER TWO BAKES REFRESH THEMSELVES — dynasty values, rookie-pick
-- values, and the season projection.
--
-- 0334 did this for ADP and the founder's next sentence was the obvious one:
-- "now automate the dynasty and projection rebakes too." The same question
-- decides each of them — what can the worker actually fetch, keyed by an id —
-- and this time the answers are different for the two.
--
-- ── DYNASTY: fully reproducible, so we reproduce it ──────────────────────
-- The value dyn2026.ts holds is not a black box: it is KTC's board rescaled
-- onto FantasyCalc's scale by a per-player ratio, with a positional-median
-- fallback below a value floor of 500. Both halves are published —
-- `ktc_rankings_1qb.json` (500 rows: 416 players AND the 84 rookie-pick rows
-- pickValues2026 holds) and `dynasty-fc-rescale.json` (371 per-player ratios
-- plus the positional medians) — and the rule is written down in the
-- upstream's own client. The worker applies it verbatim. That is not
-- inventing a model; it is running theirs.
--
-- Unsupported positions keep their raw value, which is how the PICK rows come
-- through untouched — the same rule the upstream states.
--
-- ── PROJECTION: the multiplier trick, again ──────────────────────────────
-- The season projection cannot be overlaid the same way, and the reason is
-- the whole point of v0.308.0: `projectedPoints` scores a BAKED COMPONENT
-- LINE under each league's own 64-field catalog, and those components are not
-- published. Dropping a live PPR scalar on top would throw away every
-- league's scoring — the exact bug that version existed to kill.
--
-- So the same answer as the weekly number (0330): store the live PPR season
-- RATE, and let the client take the ratio against its own baked PPR rate and
-- apply THAT to the league-scored number. Scoring is linear in the line, so a
-- league-scored rate times (live PPR ÷ baked PPR) is that league's own
-- number, moved by exactly what the model moved. The components stay baked,
-- the catalog stays applied, and the level tracks the source.
--
-- It costs no new fetch either: the weekly feed the worker already pulls
-- daily (0330) carries `ppg` and `gp` per player with a sleeper id on every
-- row. The season line was in our hands the whole time.
--
-- THE LADDER is the same as everywhere else: the live board, then the bake,
-- per player. A feed that stops costs freshness, never the column.

create table if not exists dyn_board (
  key         text primary key,            -- sleeper id, or 'pick:<label>'
  kind        text not null default 'player' check (kind in ('player', 'pick')),
  sleeper_id  text,
  slug        text,
  label       text,                        -- the pick's own name ('2027 Early 1st')
  v1qb        numeric,
  vsf         numeric,
  source      text not null default 'ktc-fc',
  fetched_at  timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists dyn_board_slug on dyn_board(slug) where slug is not null;
alter table dyn_board enable row level security;
drop policy if exists dyn_board_read on dyn_board;
create policy dyn_board_read on dyn_board for select using (true);

create table if not exists proj_board (
  sleeper_id  text primary key,
  slug        text,
  -- The source's own season line: points per game it plays, and how many it
  -- is projected to play. `per_week` is the two combined over a 17-week
  -- season, which is the shape proj2026.ts stores and therefore the only one
  -- a ratio against it is meaningful in.
  ppg         numeric,
  gp          numeric,
  per_week    numeric,
  ros_ppg     numeric,
  games_left  numeric,
  source      text not null default 'stathead',
  fetched_at  timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists proj_board_slug on proj_board(slug) where slug is not null;
alter table proj_board enable row level security;
drop policy if exists proj_board_read on proj_board;
create policy proj_board_read on proj_board for select using (true);

-- ── the worker's writes ──────────────────────────────────────────────────
-- Both take the same shape as 0334's: a stamp from the SOURCE, and a prune
-- the caller asks for on its last chunk only, so no reader sees a half-built
-- board.
create or replace function upsert_dyn_board(p_rows jsonb, p_fetched_at text default null,
                                            p_prune boolean default true)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; stamp timestamptz; gone int := 0;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  stamp := coalesce(nullif(p_fetched_at, '')::timestamptz, now());
  insert into dyn_board (key, kind, sleeper_id, slug, label, v1qb, vsf, source, fetched_at, updated_at)
  select r ->> 'key', coalesce(r ->> 'kind', 'player'),
         nullif(r ->> 'sleeper_id', ''), nullif(r ->> 'slug', ''), nullif(r ->> 'label', ''),
         nullif(r ->> 'v1qb', '')::numeric, nullif(r ->> 'vsf', '')::numeric,
         coalesce(r ->> 'source', 'ktc-fc'), stamp, now()
    from jsonb_array_elements(p_rows) r
   where nullif(r ->> 'key', '') is not null
  on conflict (key) do update
    set kind = excluded.kind, sleeper_id = excluded.sleeper_id,
        slug = coalesce(excluded.slug, dyn_board.slug), label = excluded.label,
        v1qb = excluded.v1qb, vsf = excluded.vsf,
        source = excluded.source, fetched_at = excluded.fetched_at, updated_at = now();
  get diagnostics n = row_count;
  if p_prune then
    delete from dyn_board where fetched_at < stamp;
    get diagnostics gone = row_count;
  end if;
  return jsonb_build_object('ok', true, 'rows', n, 'pruned', gone, 'fetched_at', stamp);
end $$;
revoke all on function upsert_dyn_board(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function upsert_dyn_board(jsonb, text, boolean) to service_role;

create or replace function upsert_proj_board(p_rows jsonb, p_fetched_at text default null,
                                             p_prune boolean default true)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; stamp timestamptz; gone int := 0;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  stamp := coalesce(nullif(p_fetched_at, '')::timestamptz, now());
  insert into proj_board (sleeper_id, slug, ppg, gp, per_week, ros_ppg, games_left, source, fetched_at, updated_at)
  select r ->> 'sleeper_id', nullif(r ->> 'slug', ''),
         nullif(r ->> 'ppg', '')::numeric, nullif(r ->> 'gp', '')::numeric,
         nullif(r ->> 'per_week', '')::numeric, nullif(r ->> 'ros_ppg', '')::numeric,
         nullif(r ->> 'games_left', '')::numeric,
         coalesce(r ->> 'source', 'stathead'), stamp, now()
    from jsonb_array_elements(p_rows) r
   where nullif(r ->> 'sleeper_id', '') is not null
  on conflict (sleeper_id) do update
    set slug = coalesce(excluded.slug, proj_board.slug),
        ppg = excluded.ppg, gp = excluded.gp, per_week = excluded.per_week,
        ros_ppg = excluded.ros_ppg, games_left = excluded.games_left,
        source = excluded.source, fetched_at = excluded.fetched_at, updated_at = now();
  get diagnostics n = row_count;
  if p_prune then
    delete from proj_board where fetched_at < stamp;
    get diagnostics gone = row_count;
  end if;
  return jsonb_build_object('ok', true, 'rows', n, 'pruned', gone, 'fetched_at', stamp);
end $$;
revoke all on function upsert_proj_board(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function upsert_proj_board(jsonb, text, boolean) to service_role;

create or replace function dyn_board_is_fresh() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select max(fetched_at) > now() - interval '10 days' from dyn_board), false);
$$;
create or replace function proj_board_is_fresh() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select max(fetched_at) > now() - interval '10 days' from proj_board), false);
$$;
grant execute on function dyn_board_is_fresh() to authenticated;
grant execute on function proj_board_is_fresh() to authenticated;

-- ── what the screens read ────────────────────────────────────────────────
-- Re-emitted from 0334. One call already carried ownership and ADP because
-- the clients fetch it once per league; the dynasty board, the pick board and
-- the season rate ride the same road rather than opening three more.
--
-- `dyn_format` follows the SAME rule as the ADP format — a lineup starting
-- more than one quarterback is a superflex market — so a league never reads
-- 1QB dynasty values beside a 2QB ADP column.
create or replace function league_market(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare fresh boolean; board boolean; fmt text; adp jsonb;
        dynb boolean; projb boolean; dfmt text;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  fresh := market_is_fresh();
  board := adp_board_is_fresh();
  fmt := _league_adp_format(p_league_id);
  -- A FORMAT THE MARKET BARELY PRICES IS NOT A MARKET. Sleeper's rooms are
  -- overwhelmingly PPR and half: the live board prices ~2,260 players in PPR
  -- and ~240 in standard. Serving those 240 and letting everybody else fall
  -- through to ESPN would put two scales in one column, ordered against each
  -- other — worse than one honest scale. A draft board is about 300 picks
  -- deep, so a format that cannot fill one cannot order one, and the league
  -- reads PPR instead. `adp_format` then reports what actually answered,
  -- because a label that names a market nobody looked at is the bug.
  if board and fmt <> 'ppr' then
    if (select count(*) from adp_board b where b.slug is not null
          and (case fmt when '2qb' then b.adp_2qb when 'half' then b.adp_half
                        else b.adp_std end) is not null) < 300 then
      fmt := 'ppr';
    end if;
  end if;
  dynb := dyn_board_is_fresh();
  projb := proj_board_is_fresh();
  dfmt := case when fmt = '2qb' then 'sf' else '1qb' end;

  select coalesce(jsonb_object_agg(slug, v), '{}'::jsonb) into adp from (
    select b.slug,
           round(case fmt when '2qb' then b.adp_2qb when 'half' then b.adp_half
                          when 'std' then b.adp_std else b.adp_ppr end, 1) as v
      from adp_board b
     where board and b.slug is not null
       and (case fmt when '2qb' then b.adp_2qb when 'half' then b.adp_half
                     when 'std' then b.adp_std else b.adp_ppr end) is not null
    union all
    select m.slug, m.adp from player_market m
     where fresh and m.adp is not null
       and not exists (
         select 1 from adp_board b2 where b2.slug = m.slug
          and board and (case fmt when '2qb' then b2.adp_2qb when 'half' then b2.adp_half
                                  when 'std' then b2.adp_std else b2.adp_ppr end) is not null)
  ) x;

  return jsonb_build_object(
    'ok', true,
    'fresh', fresh,
    'as_of', (select max(updated_at) from player_market),
    'source', (select source from player_market order by updated_at desc limit 1),
    'adp_source', case when board then 'sleeper' when fresh then 'espn' else null end,
    'adp_format', case when board then fmt else null end,
    'adp_as_of', (select max(fetched_at) from adp_board),
    'adp', adp,
    'own', case when fresh then coalesce(
      (select jsonb_object_agg(slug, owned_pct) from player_market where owned_pct is not null), '{}'::jsonb)
      else '{}'::jsonb end,
    -- 0335: the dynasty market, in this league's format.
    'dyn_format', case when dynb then dfmt else null end,
    'dyn_as_of', (select max(fetched_at) from dyn_board),
    'dyn', case when dynb then coalesce((select jsonb_object_agg(slug, round(
        case when dfmt = 'sf' then vsf else v1qb end)) from dyn_board
       where kind = 'player' and slug is not null
         and (case when dfmt = 'sf' then vsf else v1qb end) is not null), '{}'::jsonb)
      else '{}'::jsonb end,
    -- …and what a rookie pick trades for, keyed by the market's own label.
    'picks', case when dynb then coalesce((select jsonb_object_agg(label, round(
        case when dfmt = 'sf' then vsf else v1qb end)) from dyn_board
       where kind = 'pick' and label is not null
         and (case when dfmt = 'sf' then vsf else v1qb end) is not null), '{}'::jsonb)
      else '{}'::jsonb end,
    -- THE SEASON RATE, in PPR, for the client to take a ratio against its own
    -- baked PPR rate — never a replacement for the league-scored number.
    'proj_as_of', (select max(fetched_at) from proj_board),
    'proj', case when projb then coalesce((select jsonb_object_agg(slug, round(per_week, 3))
        from proj_board where slug is not null and per_week is not null), '{}'::jsonb)
      else '{}'::jsonb end);
end $$;
grant execute on function league_market(uuid) to authenticated;
