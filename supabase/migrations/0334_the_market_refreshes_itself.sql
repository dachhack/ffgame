-- 0334: THE MARKET REFRESHES ITSELF — the ADP board stops being a bake that
-- somebody has to remember.
--
-- v0.453.0 rebaked adp2026.ts for the first time since 26 August, and the
-- founder's reading of the result is the reason this exists: "these look like
-- post week one ADPs?" They were. The bake is a file, a file is refreshed by a
-- person, and a person forgets — so the number a draft board shows drifts from
-- the market by exactly as long as it has been since anybody thought about it.
--
-- WHAT THE WORKER CAN ACTUALLY REACH. The consensus blend our bake holds is
-- computed inside StatHead's MCP tool and published nowhere, so the worker
-- cannot have THAT number. But one of its three inputs is published daily,
-- keyed by sleeper id, and is arguably the closest market to this app:
-- `sleeper-adp-<season>.json` — Sleeper's own draft rooms, 2,877 players, with
-- a separate ADP per FORMAT (ppr, half, standard, 2QB, dynasty). Plain HTTPS,
-- no key.
--
-- THAT LAST PART IS THE FEATURE, not the freshness. Until now a superflex
-- league read a 1QB ADP and a standard-scoring league read a PPR one, because
-- the bake holds a single PPR/1QB column. This board prices each format, and
-- `_league_adp_format` picks the one the league actually plays — a lineup that
-- starts more than one quarterback reads the 2QB market, and a league at 0.5
-- or 0 PPR reads its own.
--
-- THE LADDER, per player, same shape as the weekly projections (0330):
--   1. Sleeper's draft rooms, in this league's format — fresh, id-keyed.
--   2. ESPN's draft rooms (player_market.adp, 0203) — what was here before.
--   3. The baked consensus, client-side, which is where it has always been.
-- Each rung answers for the players the one above it does not price, so a
-- feed that stops degrades to a slightly older number instead of a blank
-- column.

create table if not exists adp_board (
  sleeper_id  text primary key,
  slug        text,                        -- our engine slug, resolved by the worker
  adp_ppr     numeric,
  adp_half    numeric,
  adp_std     numeric,
  adp_2qb     numeric,
  adp_dyn     numeric,
  source      text not null default 'sleeper',
  -- The SOURCE's own stamp, not ours: what matters is when the market was
  -- measured, not when we copied it.
  fetched_at  timestamptz,
  updated_at  timestamptz not null default now()
);
create index if not exists adp_board_slug on adp_board(slug) where slug is not null;
alter table adp_board enable row level security;
drop policy if exists adp_board_read on adp_board;
-- Public reference data, like market_board: a market is not anybody's secret.
create policy adp_board_read on adp_board for select using (true);

-- ── the worker's write ───────────────────────────────────────────────────
create or replace function upsert_adp_board(p_rows jsonb, p_fetched_at text default null,
                                           p_prune boolean default true)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; stamp timestamptz; gone int := 0;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  stamp := coalesce(nullif(p_fetched_at, '')::timestamptz, now());
  insert into adp_board (sleeper_id, slug, adp_ppr, adp_half, adp_std, adp_2qb, adp_dyn, source, fetched_at, updated_at)
  select r ->> 'sleeper_id', nullif(r ->> 'slug', ''),
         nullif(r ->> 'adp_ppr', '')::numeric, nullif(r ->> 'adp_half', '')::numeric,
         nullif(r ->> 'adp_std', '')::numeric, nullif(r ->> 'adp_2qb', '')::numeric,
         nullif(r ->> 'adp_dyn', '')::numeric,
         coalesce(r ->> 'source', 'sleeper'), stamp, now()
    from jsonb_array_elements(p_rows) r
   where nullif(r ->> 'sleeper_id', '') is not null
  on conflict (sleeper_id) do update
    set slug = coalesce(excluded.slug, adp_board.slug),
        adp_ppr = excluded.adp_ppr, adp_half = excluded.adp_half, adp_std = excluded.adp_std,
        adp_2qb = excluded.adp_2qb, adp_dyn = excluded.adp_dyn,
        source = excluded.source, fetched_at = excluded.fetched_at, updated_at = now();
  get diagnostics n = row_count;
  -- A player the market stops pricing drops out rather than sitting at last
  -- month's number: anything still carrying an OLDER pull's stamp was not in
  -- this one. Keyed on the stamp rather than on wall-clock age, so the rule
  -- means the same thing a second after a pull as a day after it.
  --
  -- The worker sends the board in chunks and asks to prune on the last one
  -- only: pruning after chunk 1 would briefly delete the players chunk 2 is
  -- about to re-write, and a reader mid-sweep would see a board with a hole
  -- in it.
  if p_prune then
    delete from adp_board where source = 'sleeper' and fetched_at < stamp;
    get diagnostics gone = row_count;
  end if;
  return jsonb_build_object('ok', true, 'rows', n, 'pruned', gone, 'fetched_at', stamp);
end $$;
revoke all on function upsert_adp_board(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function upsert_adp_board(jsonb, text, boolean) to service_role;

-- ── which market is this league's ────────────────────────────────────────
-- A lineup that starts more than one quarterback IS a superflex league — the
-- same question the trade grade asks of the same spec (v0.448.0), asked here
-- in SQL. Everything else reads its own PPR value, defaulting to full PPR,
-- which is what this app's default scoring pays.
create or replace function _league_adp_format(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  with l as (select settings_json as s from league where id = p_league_id),
  qb as (
    select count(*) as n from l, jsonb_array_elements(coalesce(l.s -> 'roster_slots', '[]'::jsonb)) spot
     where spot -> 'pos' ? 'QB'
  )
  select case
    when (select n from qb) > 1 then '2qb'
    when coalesce((select (s ->> 'ppr')::numeric from l), 1) >= 0.75 then 'ppr'
    when coalesce((select (s ->> 'ppr')::numeric from l), 1) >= 0.25 then 'half'
    else 'std' end;
$$;
grant execute on function _league_adp_format(uuid) to authenticated;

/** Is the published board recent enough to show? The source refreshes daily;
 *  ten days is the point at which "the market" is really "a market from before
 *  two games ago". */
create or replace function adp_board_is_fresh() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select max(fetched_at) > now() - interval '10 days' from adp_board), false);
$$;
grant execute on function adp_board_is_fresh() to authenticated;

-- ── what the screens read ────────────────────────────────────────────────
-- Re-emitted from 0203. The ownership half is untouched; the ADP half now
-- answers from the published board where it can, from ESPN where it cannot,
-- and says which of the two it used and in which format.
create or replace function league_market(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare fresh boolean; board boolean; fmt text; adp jsonb;
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
  -- Per player: the board's number for THIS format, else ESPN's, else absent
  -- (and absent is the client's cue to keep the baked consensus showing).
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
    -- What answered the ADP column, which is not always what answered ownership.
    'adp_source', case when board then 'sleeper' when fresh then 'espn' else null end,
    'adp_format', case when board then fmt else null end,
    'adp_as_of', (select max(fetched_at) from adp_board),
    'adp', adp,
    'own', case when fresh then coalesce(
      (select jsonb_object_agg(slug, owned_pct) from player_market where owned_pct is not null), '{}'::jsonb)
      else '{}'::jsonb end);
end $$;
grant execute on function league_market(uuid) to authenticated;
