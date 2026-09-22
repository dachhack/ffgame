-- ═══════════════════════════════════════════════════════════════════════════
-- 0340 · WHAT THE WIRE IS DOING — the trending board
--
-- Founder, holding Sleeper's PLAYERS tab up next to ours: "We can pull
-- trending from sleeper. That's not one espn or stathead has."
--
-- He is right on both halves. Sleeper publishes, anonymously and without a
-- key, how many of its leagues added or dropped each player in a rolling
-- window: `/v1/players/nfl/trending/add?lookback_hours=24`. It is the single
-- best "what is happening RIGHT NOW" signal in fantasy football, because it is
-- millions of real managers acting rather than anybody's model, and neither of
-- our other sources carries anything like it — ESPN publishes ownership
-- PERCENT (a level, not a move) and StatHead's bakes are weekly.
--
-- A level tells you who is owned. This tells you who is being grabbed this
-- morning, which is the question a waiver wire is actually for.
--
-- SAME SHAPE AS EVERY OTHER BOARD (0334 ADP, 0335 dynasty and projection):
-- a table keyed by the SOURCE's id, a service-role-only upsert the worker
-- calls, a freshness predicate, and one more key on `league_market` so a
-- screen reads it in a call it already makes. Id-first: a row we cannot place
-- is stored with a null slug rather than guessed at by name, so the next
-- player-index refresh can still claim it.
--
-- NOT LEAGUE DATA. These counts are Sleeper's whole platform, identical for
-- every league and every visitor — nothing here is about who is in YOUR
-- league, so the table reads public like the other boards.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists trend_board (
  sleeper_id  text primary key,           -- Sleeper's own id; 'TB' for a defense
  slug        text,                       -- ours, once the index can place it
  adds        bigint,
  drops       bigint,
  -- The window the counts cover, so a screen can say "in 24h" rather than
  -- implying an all-time total. Stored per row because the worker could widen
  -- it later without every reader guessing.
  hours       int not null default 24,
  source      text not null default 'sleeper',
  fetched_at  timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists trend_board_slug on trend_board(slug) where slug is not null;
alter table trend_board enable row level security;
drop policy if exists trend_board_read on trend_board;
create policy trend_board_read on trend_board for select using (true);

-- A day. The source is a rolling 24-hour window that the worker refreshes
-- hourly, so anything older than a day is a worker that has stopped — and a
-- stale "trending now" is worse than no trending at all, because the whole
-- claim of the column is that it is current.
create or replace function trend_board_is_fresh() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select max(fetched_at) > now() - interval '24 hours' from trend_board), false);
$$;
grant execute on function trend_board_is_fresh() to authenticated;

-- ── the worker's door ───────────────────────────────────────────────────────
-- One call carries both directions: the source serves adds and drops as two
-- endpoints, and a player can be in both (churn), so the worker merges them
-- and writes one row per player. A row absent from THIS pull is not trending
-- any more, so pruning is by the pull's own stamp rather than by wall-clock
-- age — the same rule 0334 uses, and for the same reason: two workers, or a
-- retry, must not delete each other's rows.
create or replace function upsert_trend_board(p_rows jsonb, p_fetched_at text default null,
                                              p_hours int default 24)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; stamp timestamptz; gone int := 0;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  stamp := coalesce(nullif(p_fetched_at, '')::timestamptz, now());
  insert into trend_board (sleeper_id, slug, adds, drops, hours, source, fetched_at, updated_at)
  select r ->> 'sleeper_id', nullif(r ->> 'slug', ''),
         nullif(r ->> 'adds', '')::bigint, nullif(r ->> 'drops', '')::bigint,
         coalesce(p_hours, 24), coalesce(r ->> 'source', 'sleeper'), stamp, now()
    from jsonb_array_elements(p_rows) r
   where nullif(r ->> 'sleeper_id', '') is not null
  on conflict (sleeper_id) do update
    set slug = coalesce(excluded.slug, trend_board.slug),
        adds = excluded.adds, drops = excluded.drops, hours = excluded.hours,
        source = excluded.source, fetched_at = excluded.fetched_at, updated_at = now();
  get diagnostics n = row_count;
  delete from trend_board where fetched_at < stamp;
  get diagnostics gone = row_count;
  return jsonb_build_object('ok', true, 'rows', n, 'pruned', gone, 'fetched_at', stamp);
end $$;
revoke all on function upsert_trend_board(jsonb, text, int) from public, anon, authenticated;
grant execute on function upsert_trend_board(jsonb, text, int) to service_role;

-- ── what the screens read ───────────────────────────────────────────────────
-- 0336's body with one key added. `trend` is keyed by slug and carries both
-- directions plus the net, because the three answer different questions: adds
-- is "who is being grabbed", drops is "who is being cut", and a player high in
-- both is churn rather than a signal. Only players the index could place are
-- served — a screen keys by slug, and a row it cannot draw is noise.
create or replace function league_market(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare fresh boolean; board boolean; fmt text; adp jsonb;
        dynb boolean; projb boolean; dfmt text; trendb boolean;
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
  trendb := trend_board_is_fresh();
  -- 0336: asked of the league, not of the ADP format — which the thin-board
  -- fallback above may just have downgraded to PPR for a reason that has
  -- nothing to do with how the league prices quarterbacks.
  dfmt := case when league_is_superflex(p_league_id) then 'sf' else '1qb' end;

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
    -- Keyed by our slug, else by the sleeper id — the client reads both
    -- (0336; the worker carries the slug now, but a board without one should
    -- still answer rather than serve the empty map every league got).
    'proj', case when projb then coalesce((select jsonb_object_agg(coalesce(slug, sleeper_id), round(per_week, 3))
        from proj_board where per_week is not null), '{}'::jsonb)
      else '{}'::jsonb end,
    -- 0340: WHAT THE WIRE IS DOING. Adds and drops over the window, per slug.
    'trend_as_of', (select max(fetched_at) from trend_board),
    'trend_hours', (select max(hours) from trend_board),
    'trend', case when trendb then coalesce((select jsonb_object_agg(slug,
        jsonb_build_object('a', coalesce(adds, 0), 'd', coalesce(drops, 0)))
        from trend_board where slug is not null
          and (coalesce(adds, 0) > 0 or coalesce(drops, 0) > 0)), '{}'::jsonb)
      else '{}'::jsonb end);
end $$;
grant execute on function league_market(uuid) to authenticated;
