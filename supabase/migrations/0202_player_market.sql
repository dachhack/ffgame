-- 0202: REAL OWNERSHIP, FROM THE MARKET RATHER THAN FROM OUR OWN TWO LEAGUES.
--
-- v0.302.0 answered the founder's "sort by ownership % would be good too" with
-- the only number this platform had: the share of ITS OWN drafted leagues
-- rostering a player. The reasoning was sound as far as it went — a percentage
-- that counted only your own twelve teams would read 0% for everyone on the
-- waiver wire — but the denominator is still the handful of leagues that exist
-- here, so a player rostered in one of two reads 50%, and that is not what
-- anybody means by ownership.
--
-- ESPN publishes the real thing, free, on a host this worker already lives on:
-- `ownership.percentOwned` across ESPN's whole fantasy population. 105KB a pull
-- for the top 400 players (the light `players_wl` view), which is cheap enough
-- to keep genuinely current.
--
-- ONE DEFINITION AT A TIME. When the market table has fresh rows, it answers
-- alone — the legacy count is not blended in, because a player ESPN doesn't
-- price is genuinely near-zero owned, and falling back to "rostered in one of
-- our two leagues, so 50%" would put a louder wrong number next to a quieter
-- right one. When the feed has never run or has gone stale, the old
-- league-derived answer comes back, so the app degrades to what it did before
-- rather than to nothing.
--
-- `adp` rides along in the table and is deliberately LEFT NULL for now. ESPN
-- publishes ADP too, but on the heavy view (12MB vs 105KB) and — measured
-- against the baked consensus — it is a DIFFERENT market, ~13 picks off at the
-- median. Swapping the draft board's ordering onto another market is a decision
-- about the product, not a data refresh, so the column is here and the poller
-- leaves it alone until that decision is made.

create table if not exists player_market (
  slug        text primary key,
  adp         numeric,          -- null until the ADP source is decided (see above)
  owned_pct   int,              -- 0..100, the share of the market rostering him
  source      text not null default 'espn',
  updated_at  timestamptz not null default now()
);
alter table player_market enable row level security;
-- Public NFL market data, same posture as injury_status (0001): any member may
-- read it; only the worker's service key writes.
drop policy if exists player_market_read on player_market;
create policy player_market_read on player_market for select using (auth.role() = 'authenticated');

-- How stale is too stale. A feed that stopped a week ago is not "the market",
-- and the league-derived answer is a better wrong number than a frozen one.
create or replace function market_is_fresh() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from player_market
                  where owned_pct is not null and updated_at > now() - interval '7 days');
$$;
grant execute on function market_is_fresh() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- player_ownership — 0199's body, preferring the real market when it is fresh
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function player_ownership(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare total int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  -- THE MARKET, when we have it (0202).
  if market_is_fresh() then
    return coalesce((select jsonb_object_agg(slug, owned_pct)
                       from player_market where owned_pct is not null), '{}'::jsonb);
  end if;
  -- Otherwise 0199's own answer: the share of THIS platform's drafted leagues.
  select count(*)::int into total from draft where status = 'complete';
  if coalesce(total, 0) = 0 then return '{}'::jsonb; end if;
  return coalesce((
    select jsonb_object_agg(x.slug, x.pct) from (
      select nr.slug, round(count(distinct nr.league_id) * 100.0 / total)::int as pct
      from native_roster nr
      join draft dr on dr.league_id = nr.league_id and dr.status = 'complete'
      group by nr.slug
    ) x), '{}'::jsonb);
end $$;
grant execute on function player_ownership(uuid) to authenticated;
