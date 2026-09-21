-- 0331: ONE PLAYER, EVERY ID — the crosswalk, published.
--
-- 0326 shipped a public read API whose stated promise is "readable by
-- anything", and handed a third party exactly ONE identifier to join on:
-- `espn_id`. Everything else about a player — his nflverse gsis id, his
-- Sleeper id, his pro-football-reference id — a consumer had to recover by
-- MATCHING HIS NAME.
--
-- This repo has been bitten by that twice and written it down both times:
-- dyn2026 silently dropped Kenneth/Kenny Gainwell, and still carries a
-- hand-edit because one board spells a man "Chigoziem Okonkwo" and our index
-- spells him "Chig Okonkwo". We fixed it for ourselves by going id-first
-- everywhere (0200, 0205). Publishing one id and expecting the internet to
-- name-match the rest is handing our own solved bug to every consumer.
--
-- WHAT LANDS HERE. `player_xref`, filled by the worker from StatHead's public
-- player crosswalk (the same file the `stathead` Python client reads), keyed
-- on the nflverse gsis id and carrying the ids every other fantasy and
-- statistics source uses. Our pool reaches it by espn_id or sleeper_id — the
-- two ids league_pool already holds — so nothing in this migration matches a
-- name either.
--
-- WHAT IT IS NOT. It is not private data and it does not widen what the
-- public API serves by one inch beyond identity: these are public sports
-- ids for public athletes, and every rule 0326 set about sealed picks,
-- pending bids, live offers, emails and chat is untouched. No new endpoint;
-- `api_players` simply answers the question it was already being asked.

create table if not exists player_xref (
  gsis_id         text primary key,         -- nflverse, and the pbp key
  full_name       text,
  pos             text,
  sleeper_id      text,
  espn_id         text,
  pfr_id          text,
  yahoo_id        text,
  sportradar_id   text,
  pff_id          text,
  rotowire_id     text,
  fantasy_data_id text,
  esb_id          text,
  -- The last season the source saw him. The worker only publishes recent
  -- players; this is what lets it say so.
  latest_season   int,
  updated_at      timestamptz not null default now()
);
create index if not exists player_xref_espn on player_xref(espn_id) where espn_id is not null;
create index if not exists player_xref_sleeper on player_xref(sleeper_id) where sleeper_id is not null;
alter table player_xref enable row level security;
drop policy if exists player_xref_read on player_xref;
-- Readable by any signed-in account. The public API reaches it through
-- `api_players`, which is security definer and gated by _api_open.
create policy player_xref_read on player_xref for select using (auth.uid() is not null);

-- ── the worker's write ───────────────────────────────────────────────────
-- Whole batches, like every other poller here. A row the source stops
-- publishing is LEFT ALONE rather than deleted: an id does not stop being
-- true when a player retires, and a league that still holds his history
-- still wants to join it.
create or replace function upsert_player_xref(p_rows jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'a list of rows');
  end if;
  insert into player_xref (gsis_id, full_name, pos, sleeper_id, espn_id, pfr_id, yahoo_id,
                           sportradar_id, pff_id, rotowire_id, fantasy_data_id, esb_id,
                           latest_season, updated_at)
  select r ->> 'gsis_id', nullif(r ->> 'full_name', ''), nullif(r ->> 'pos', ''),
         nullif(r ->> 'sleeper_id', ''), nullif(r ->> 'espn_id', ''), nullif(r ->> 'pfr_id', ''),
         nullif(r ->> 'yahoo_id', ''), nullif(r ->> 'sportradar_id', ''), nullif(r ->> 'pff_id', ''),
         nullif(r ->> 'rotowire_id', ''), nullif(r ->> 'fantasy_data_id', ''), nullif(r ->> 'esb_id', ''),
         nullif(r ->> 'latest_season', '')::int, now()
    from jsonb_array_elements(p_rows) r
   where nullif(r ->> 'gsis_id', '') is not null
  on conflict (gsis_id) do update
    set full_name = coalesce(excluded.full_name, player_xref.full_name),
        pos = coalesce(excluded.pos, player_xref.pos),
        sleeper_id = coalesce(excluded.sleeper_id, player_xref.sleeper_id),
        espn_id = coalesce(excluded.espn_id, player_xref.espn_id),
        pfr_id = coalesce(excluded.pfr_id, player_xref.pfr_id),
        yahoo_id = coalesce(excluded.yahoo_id, player_xref.yahoo_id),
        sportradar_id = coalesce(excluded.sportradar_id, player_xref.sportradar_id),
        pff_id = coalesce(excluded.pff_id, player_xref.pff_id),
        rotowire_id = coalesce(excluded.rotowire_id, player_xref.rotowire_id),
        fantasy_data_id = coalesce(excluded.fantasy_data_id, player_xref.fantasy_data_id),
        esb_id = coalesce(excluded.esb_id, player_xref.esb_id),
        latest_season = greatest(coalesce(excluded.latest_season, 0), coalesce(player_xref.latest_season, 0)),
        updated_at = now();
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'rows', n);
end $$;
revoke all on function upsert_player_xref(jsonb) from public, anon, authenticated;
grant execute on function upsert_player_xref(jsonb) to service_role;

-- ── the join ─────────────────────────────────────────────────────────────
-- One pool player's other ids. ESPN id first because that is the column the
-- pool has been filling since 0066, the sleeper id second because 0205 gave
-- us a second chance at the men ESPN never indexed. Never by name.
create or replace function _xref_for(p_espn_id text, p_sleeper_id text) returns player_xref
  language sql stable set search_path = public as $$
  select x.* from player_xref x
   where (p_espn_id is not null and x.espn_id = p_espn_id)
      or (p_sleeper_id is not null and x.sleeper_id = p_sleeper_id)
   order by case when p_espn_id is not null and x.espn_id = p_espn_id then 0 else 1 end
   limit 1;
$$;

-- GET /v1/league/{id}/players — re-emitted (0326 → here) with the ids a
-- third-party tool needs to join this league to anything else without
-- guessing at a spelling. `espn_id` stays exactly where it was, so no
-- existing consumer notices anything but new keys.
create or replace function api_players(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not _api_open(p_league_id) then return null; end if;
  return jsonb_build_object('league_id', p_league_id,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'slug', lp.slug, 'name', lp.full_name, 'pos', lp.pos, 'team', lp.team,
        'rank', lp.rank, 'exp', lp.exp, 'espn_id', lp.espn_id,
        'sleeper_id', lp.sleeper_id,
        'gsis_id', x.gsis_id, 'pfr_id', x.pfr_id, 'yahoo_id', x.yahoo_id,
        'sportradar_id', x.sportradar_id,
        'roster_id', (select nr.roster_id from native_roster nr
                       where nr.league_id = p_league_id and nr.slug = lp.slug))
        order by lp.rank nulls last, lp.full_name)
      from league_pool lp
      left join lateral _xref_for(lp.espn_id, lp.sleeper_id) x on true
     where lp.league_id = p_league_id), '[]'::jsonb));
end $$;
grant execute on function api_players(uuid) to authenticated;

-- And the same for a signed-in client, which until now had to ask the public
-- endpoint for an id it was entitled to anyway.
create or replace function league_player_ids(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()
          or coalesce(league_public_api(p_league_id), false)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'ids', coalesce((select jsonb_object_agg(lp.slug, jsonb_strip_nulls(jsonb_build_object(
        'espn_id', lp.espn_id, 'sleeper_id', lp.sleeper_id, 'gsis_id', x.gsis_id,
        'pfr_id', x.pfr_id, 'yahoo_id', x.yahoo_id, 'sportradar_id', x.sportradar_id)))
      from league_pool lp
      left join lateral _xref_for(lp.espn_id, lp.sleeper_id) x on true
     where lp.league_id = p_league_id), '{}'::jsonb));
end $$;
grant execute on function league_player_ids(uuid) to authenticated;
