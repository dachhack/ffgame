-- 0183: DYNASTY, PHASE 3 — PICK ASSETS. Rookie-draft rounds, each pick an
-- asset a team OWNS, and ownership that trades and is then honored on the
-- clock when the draft actually runs.
--
-- THE MODEL. `pick_asset` rows are (league, season, round, original seat) →
-- owning seat. The SEASON tag is what makes one table serve both halves of a
-- pick's life:
--   • On league L (season S), assets tagged S+1 are FUTURES — the picks of
--     the rookie draft L will roll into. These are the tradeable ones: the
--     existing trade system moves their ownership all season long.
--   • At rollover, those rows COPY to the new league L' (season S+1), where
--     their tag now equals the league's own season — which is exactly the
--     rule `_start_draft_now` uses to find "the assets for THIS draft". It
--     builds `draft.pick_owners`, an explicit per-overall owner list, and
--     `draft_on_clock` returns the OWNER of the pick on the clock instead of
--     the snake seat. Rollover then re-provisions S+2 futures on L' from the
--     copied `rookie_rounds` setting, so the cycle continues by itself.
--
-- WHY AN EXPLICIT pick_owners LIST and not a smarter draft_on_clock: with
-- traded picks the on-clock seat is a lookup, not arithmetic — and the lookup
-- belongs to draft START (when the base order is fixed), not to every clock
-- read. A draft with owned picks runs LINEAR rounds in the base order (the
-- dynasty rookie-draft convention — a pick asset is "round R, seat X's
-- original slot", which snaking would relabel every other round). A draft
-- with NO assets keeps the exact snake behavior it has always had.
--
-- WHAT DOES NOT CHANGE: roster caps (a team that traded FOR extra picks can
-- draft past its cap and lands in the existing over-limit lockout — adds and
-- lineups freeze until it cuts down, 0179's machinery); the auction (assets
-- are a snake-draft concept; an auction league ignores them); the trade cap
-- rules (picks occupy no roster spot).
--
-- Provisioning is `set_rookie_rounds` (commish): creates one asset per seat
-- per round for season S+1, owner = original. Growing adds rounds; shrinking
-- deletes only rounds whose picks ALL still sit with their original owners —
-- a traded pick is someone's acquired property and cannot be deleted out
-- from under them by a settings change.

-- ─────────────────────────────────────────────────────────────────────────────
-- Schema
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists pick_asset (
  league_id       uuid not null references league(id) on delete cascade,
  season          text not null,          -- the draft season this pick belongs to
  round           int  not null check (round between 1 and 10),
  original_roster int  not null,          -- whose slot in the round order this is
  owner_roster    int  not null,          -- who drafts with it (trades move this)
  created_at      timestamptz not null default now(),
  primary key (league_id, season, round, original_roster)
);
create index if not exists pick_asset_owner on pick_asset(league_id, owner_roster);

alter table pick_asset enable row level security;
drop policy if exists pick_asset_read on pick_asset;
create policy pick_asset_read on pick_asset for select using (is_league_member(league_id));
-- No write policies: ownership moves only through the RPCs below.

-- Trades carry picks beside players. [{season, round, orig}] each way.
alter table trade_proposal add column if not exists give_picks jsonb not null default '[]'::jsonb;
alter table trade_proposal add column if not exists get_picks  jsonb not null default '[]'::jsonb;

-- The explicit per-overall owner list, built at draft start when assets exist.
alter table draft add column if not exists pick_owners jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- Provisioning
-- ─────────────────────────────────────────────────────────────────────────────

-- The season a league's TRADEABLE picks belong to: its next rookie draft.
create or replace function _future_pick_season(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when season ~ '^\d{4}$' then ((season)::int + 1)::text end
  from league where id = p_league_id;
$$;

-- Internal: make season-p_season assets exist for rounds 1..p_rounds on every
-- seat (owner = original; existing rows — traded or not — are left alone),
-- and delete rounds above p_rounds if none of their picks have been traded.
create or replace function _provision_pick_assets(p_league_id uuid, p_season text, p_rounds int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare made int; gone int;
begin
  if p_season is null then return jsonb_build_object('ok', false, 'error', 'league season is not a year'); end if;
  if exists (select 1 from pick_asset pa
             where pa.league_id = p_league_id and pa.season = p_season
               and pa.round > p_rounds and pa.owner_roster <> pa.original_roster) then
    return jsonb_build_object('ok', false, 'error',
      'trades already moved picks in the rounds being removed — undo those first');
  end if;
  delete from pick_asset
    where league_id = p_league_id and season = p_season and round > p_rounds;
  get diagnostics gone = row_count;
  insert into pick_asset (league_id, season, round, original_roster, owner_roster)
  select p_league_id, p_season, r, m.sleeper_roster_id, m.sleeper_roster_id
  from league_membership m, generate_series(1, greatest(p_rounds, 0)) r
  where m.league_id = p_league_id
  on conflict (league_id, season, round, original_roster) do nothing;
  get diagnostics made = row_count;
  return jsonb_build_object('ok', true, 'created', made, 'removed', gone);
end $$;

-- Commissioner: how many rounds the NEXT season's rookie draft runs. Creates
-- the pick assets (one per seat per round) that become tradeable immediately.
create or replace function set_rookie_rounds(p_league_id uuid, p_rounds int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; n int; r jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if lg.is_mock or lg.kind <> 'league' then
    return jsonb_build_object('ok', false, 'error', 'rookie drafts belong to full leagues');
  end if;
  n := coalesce(p_rounds, 0);
  if n < 0 or n > 10 then
    return jsonb_build_object('ok', false, 'error', 'rookie rounds must be 0–10');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  r := _provision_pick_assets(p_league_id, _future_pick_season(p_league_id), n);
  if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  update league set settings_json =
      case when n = 0 then coalesce(settings_json, '{}'::jsonb) - 'rookie_rounds'
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('rookie_rounds', n) end
    where id = p_league_id;
  return jsonb_build_object('ok', true, 'rookie_rounds', n,
    'season', _future_pick_season(p_league_id)) || r;
end $$;

-- One-shot read for the UI: the setting plus every asset this league holds
-- (both the pending draft's, on a rolled league, and the tradeable futures).
create or replace function pick_assets(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return jsonb_build_object(
    'ok', true,
    'rookie_rounds', coalesce((select (settings_json ->> 'rookie_rounds')::int from league where id = p_league_id), 0),
    'future_season', _future_pick_season(p_league_id),
    'picks', coalesce((select jsonb_agg(jsonb_build_object(
        'season', pa.season, 'round', pa.round,
        'orig', pa.original_roster, 'owner', pa.owner_roster)
        order by pa.season, pa.round, pa.original_roster)
      from pick_asset pa where pa.league_id = p_league_id), '[]'::jsonb));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trades carry picks (0072 bodies, extended — copied from the live migration)
-- ─────────────────────────────────────────────────────────────────────────────

-- Clean a client picks array into [{season, round, orig}] rows of the
-- league's tradeable season, or raise with a message. Internal.
create or replace function _clean_trade_picks(p_league_id uuid, p_picks jsonb)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare seas text; el jsonb; rnd int; orig int; cleaned jsonb := '[]'::jsonb;
begin
  if p_picks is null then return '[]'::jsonb; end if;
  if jsonb_typeof(p_picks) <> 'array' then
    raise exception 'picks must be a list';
  end if;
  seas := _future_pick_season(p_league_id);
  for el in select * from jsonb_array_elements(p_picks) loop
    begin rnd := (el ->> 'round')::int; orig := (el ->> 'orig')::int;
    exception when others then rnd := null; orig := null; end;
    if rnd is null or orig is null then raise exception 'each pick needs round and orig'; end if;
    if not exists (select 1 from pick_asset pa where pa.league_id = p_league_id
                   and pa.season = seas and pa.round = rnd and pa.original_roster = orig) then
      raise exception 'no such pick: % round %', seas, rnd;
    end if;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object('season', seas, 'round', rnd, 'orig', orig));
  end loop;
  return cleaned;
end $$;

-- Does p_roster own every pick in the (cleaned) list? Null if yes, else why not.
create or replace function _pick_ownership_error(p_league_id uuid, p_roster int, p_picks jsonb)
  returns text language sql stable security definer set search_path = public as $$
  select 'the ' || (el ->> 'season') || ' round-' || (el ->> 'round')
      || ' pick (Team ' || (el ->> 'orig') || ' original) isn''t theirs to move'
  from jsonb_array_elements(p_picks) el
  where not exists (select 1 from pick_asset pa
    where pa.league_id = p_league_id and pa.season = el ->> 'season'
      and pa.round = (el ->> 'round')::int and pa.original_roster = (el ->> 'orig')::int
      and pa.owner_roster = p_roster)
  limit 1;
$$;

-- execute_trade v2: 0072's body verbatim, plus pick re-validation + transfer.
create or replace function execute_trade(p_trade_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare t trade_proposal%rowtype; err text; el jsonb;
begin
  select * into t from trade_proposal where id = p_trade_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such trade'); end if;
  -- every piece must still be where the deal said it was
  if exists (select 1 from jsonb_array_elements_text(t.give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.from_roster and nr.slug = s.slug))
     or exists (select 1 from jsonb_array_elements_text(t.get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = t.league_id and nr.roster_id = t.to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'players moved since the deal was struck — re-propose');
  end if;
  if _pick_ownership_error(t.league_id, t.from_roster, t.give_picks) is not null
     or _pick_ownership_error(t.league_id, t.to_roster, t.get_picks) is not null then
    return jsonb_build_object('ok', false, 'error', 'picks moved since the deal was struck — re-propose');
  end if;
  err := coalesce(trade_cap_error(t.league_id, t.from_roster, t.give, t.get),
                  trade_cap_error(t.league_id, t.to_roster, t.get, t.give));
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;

  update native_roster nr set roster_id = t.to_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.from_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.give));
  update native_roster nr set roster_id = t.from_roster, acquired = 'trade'
    where nr.league_id = t.league_id and nr.roster_id = t.to_roster
      and nr.slug in (select value from jsonb_array_elements_text(t.get));
  for el in select * from jsonb_array_elements(t.give_picks) loop
    update pick_asset set owner_roster = t.to_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;
  for el in select * from jsonb_array_elements(t.get_picks) loop
    update pick_asset set owner_roster = t.from_roster
      where league_id = t.league_id and season = el ->> 'season'
        and round = (el ->> 'round')::int and original_roster = (el ->> 'orig')::int;
  end loop;
  update trade_proposal set status = 'executed', resolved_at = now() where id = p_trade_id;
  perform native_materialize(t.league_id);
  return jsonb_build_object('ok', true, 'executed', true);
end $$;

-- propose_trade v2: 0072's body + the two pick lists. The old signature must
-- go — a new parameter with a default creates an OVERLOAD, and the 6-argument
-- call every existing client makes would then match both definitions.
drop function if exists propose_trade(uuid, int, int, jsonb, jsonb, text);
create or replace function propose_trade(
  p_league_id uuid, p_from_roster int, p_to_roster int,
  p_give jsonb, p_get jsonb, p_note text default null,
  p_give_picks jsonb default null, p_get_picks jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; tid uuid; gp jsonb; tp jsonb; err text;
begin
  if not (owns_roster(p_league_id, p_from_roster) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'wait for the draft to finish');
  end if;
  if p_from_roster = p_to_roster
     or not exists (select 1 from league_membership m where m.league_id = p_league_id and m.sleeper_roster_id = p_to_roster) then
    return jsonb_build_object('ok', false, 'error', 'pick another team to trade with');
  end if;
  begin
    gp := _clean_trade_picks(p_league_id, p_give_picks);
    tp := _clean_trade_picks(p_league_id, p_get_picks);
  exception when others then
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  if jsonb_typeof(p_give) <> 'array' or jsonb_typeof(p_get) <> 'array'
     or jsonb_array_length(p_give) > 10 or jsonb_array_length(p_get) > 10
     or jsonb_array_length(gp) > 10 or jsonb_array_length(tp) > 10
     or jsonb_array_length(p_give) + jsonb_array_length(p_get)
      + jsonb_array_length(gp) + jsonb_array_length(tp) < 1 then
    return jsonb_build_object('ok', false, 'error', 'a trade moves 1–10 players or picks each way');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_give || p_get))
     <> jsonb_array_length(p_give) + jsonb_array_length(p_get) then
    return jsonb_build_object('ok', false, 'error', 'a player can only appear once');
  end if;
  if (select count(distinct value) from jsonb_array_elements(gp || tp))
     <> jsonb_array_length(gp) + jsonb_array_length(tp) then
    return jsonb_build_object('ok', false, 'error', 'a pick can only appear once');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_give) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_from_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only offer your own players');
  end if;
  if exists (select 1 from jsonb_array_elements_text(p_get) s(slug)
             where not exists (select 1 from native_roster nr
               where nr.league_id = p_league_id and nr.roster_id = p_to_roster and nr.slug = s.slug)) then
    return jsonb_build_object('ok', false, 'error', 'you can only ask for their players');
  end if;
  err := _pick_ownership_error(p_league_id, p_from_roster, gp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only offer picks you own — ' || err); end if;
  err := _pick_ownership_error(p_league_id, p_to_roster, tp);
  if err is not null then return jsonb_build_object('ok', false, 'error', 'you can only ask for picks they own — ' || err); end if;
  insert into trade_proposal (league_id, from_roster, to_roster, give, get, give_picks, get_picks, note, created_by)
    values (p_league_id, p_from_roster, p_to_roster, p_give, p_get, gp, tp,
            nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning id into tid;
  return jsonb_build_object('ok', true, 'trade_id', tid);
end $$;
grant execute on function propose_trade(uuid, int, int, jsonb, jsonb, text, jsonb, jsonb) to authenticated;

-- league_trades v2: 0072's body + the pick lists in each row.
create or replace function league_trades(p_league_id uuid, p_limit int default 30)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', t.id, 'from_roster', t.from_roster, 'to_roster', t.to_roster,
      'give', t.give, 'get', t.get,
      'give_picks', t.give_picks, 'get_picks', t.get_picks,
      'status', t.status, 'note', t.note,
      'created_at', t.created_at, 'resolved_at', t.resolved_at)
      order by t.created_at desc)
    from (select * from trade_proposal where league_id = p_league_id
          order by created_at desc limit least(p_limit, 100)) t), '[]'::jsonb);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The draft honors ownership
-- ─────────────────────────────────────────────────────────────────────────────

-- draft_on_clock v2: 0064's snake arithmetic, preceded by the owned-pick
-- lookup. pick_owners[overall-1] IS the seat on the clock when it exists.
create or replace function draft_on_clock(d draft) returns int
  language plpgsql immutable as $$
declare n int; rnd int; idx int;
begin
  if d.pick_owners is not null then
    if d.current_overall > jsonb_array_length(d.pick_owners) then return null; end if;
    return (d.pick_owners ->> (d.current_overall - 1))::int;
  end if;
  n := jsonb_array_length(d.draft_order);
  if n is null or n = 0 then return null; end if;
  rnd := ((d.current_overall - 1) / n) + 1;
  idx := (d.current_overall - 1) % n;
  if rnd % 2 = 0 then idx := n - 1 - idx; end if;   -- even rounds reverse
  return (d.draft_order ->> idx)::int;
end $$;

-- _start_draft_now v3: 0182's body, plus the owner list. When this league's
-- OWN season has pick assets (a rolled dynasty league) and the draft is a
-- snake, the picks run LINEAR in the base order, each owned by its asset's
-- holder; total picks = the asset count, and the free-pool check sizes
-- against that. No assets ⇒ exactly the 0182 behavior.
create or replace function _start_draft_now(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ids int[]; ord jsonb; n int; i int; preset boolean := false;
  lseas text; owners jsonb := null; total_picks int; maxr int; r int; orig int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;
  if d.rounds - d.keeper_slots < 1 then
    return jsonb_build_object('ok', false, 'error', 'keepers fill the whole roster — no rounds left to draft');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;

  if p_order is not null then
    if jsonb_typeof(p_order) <> 'array' or jsonb_array_length(p_order) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    if (select count(distinct v.x) from (select (jsonb_array_elements_text(p_order))::int as x) v
        where v.x = any(ids)) <> n then
      return jsonb_build_object('ok', false, 'error', 'order must list every roster once');
    end if;
    ord := p_order;
  else
    -- a pre-set order (0176), but only if it still covers exactly these seats
    if d.draft_order is not null
      and jsonb_typeof(d.draft_order) = 'array'
      and jsonb_array_length(d.draft_order) = n
      and (select count(distinct v.x) from (select (jsonb_array_elements_text(d.draft_order))::int as x) v
           where v.x = any(ids)) = n
    then
      ord := d.draft_order; preset := true;
    else
      select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
    end if;
  end if;

  -- Owned picks (0183): this league's own season carries assets ⇒ linear
  -- rounds in the base order, each overall owned by its asset's holder.
  select season into lseas from league where id = p_league_id;
  if d.mode = 'snake' and exists (select 1 from pick_asset pa
      where pa.league_id = p_league_id and pa.season = lseas) then
    select max(round) into maxr from pick_asset
      where league_id = p_league_id and season = lseas;
    owners := '[]'::jsonb;
    for r in 1..maxr loop
      for i in 0..(n - 1) loop
        orig := (ord ->> i)::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    total_picks := jsonb_array_length(owners);
  else
    total_picks := (d.rounds - d.keeper_slots) * n;
  end if;

  if (select count(*) from league_pool lp
      where lp.league_id = p_league_id
        and not exists (select 1 from native_roster nr
                        where nr.league_id = lp.league_id and nr.slug = lp.slug))
     < total_picks then
    return jsonb_build_object('ok', false, 'error', 'pool smaller than the draft');
  end if;

  update draft set status = 'live', draft_order = ord, pick_owners = owners,
    current_overall = 1, nom_idx = 0,
    deadline_at = awake_deadline(now(), d.pick_seconds, d.night_start_min, d.night_end_min),
    started_at = now(), paused = false
    where league_id = p_league_id;
  if d.mode = 'auction' then
    update league_membership set draft_budget = d.budget where league_id = p_league_id;
  end if;

  for i in 0..(n - 1) loop
    update league_membership set waiver_priority = n - i
      where league_id = p_league_id and sleeper_roster_id = (ord ->> i)::int;
  end loop;

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode, 'preset', preset,
    'owned_picks', owners is not null);
end $$;

-- native_exec_pick v5: 0182's body, with completion keyed on the owner list
-- when one exists (the asset count IS the pick count), else on
-- (rounds − keeper_slots) × teams as before.
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int; err text; total int;
begin
  select * into d from draft where league_id = p_league_id;
  if d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  n := jsonb_array_length(d.draft_order);
  rnd := ((d.current_overall - 1) / n) + 1;
  total := case when d.pick_owners is not null then jsonb_array_length(d.pick_owners)
                else (d.rounds - d.keeper_slots) * n end;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  if not p_auto then
    err := pos_cap_error(p_league_id, oc, p_slug);
    if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  end if;

  insert into draft_pick (league_id, overall, round, roster_id, slug, auto)
  values (p_league_id, d.current_overall, rnd, oc, p_slug, p_auto);
  insert into native_roster (league_id, roster_id, slug, acquired)
  values (p_league_id, oc, p_slug, 'draft');

  if d.current_overall >= total then
    update draft set status = 'complete', completed_at = now(), deadline_at = null,
      current_overall = d.current_overall + 1
      where league_id = p_league_id;
    perform native_materialize(p_league_id);
    return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc,
      'slug', p_slug, 'complete', true);
  end if;

  update draft set current_overall = d.current_overall + 1,
    deadline_at = draft_deadline(d, d.pick_seconds)
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'overall', d.current_overall, 'roster_id', oc, 'slug', p_slug);
end $$;

-- draft_state v-next: 0182's body, with 'rounds' derived from the owner list
-- when one exists and the list itself exposed for the room.
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int; lots jsonb; open_lots int; eff_rounds int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'no draft'); end if;
  select sleeper_roster_id into my_r from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  select count(*)::int into open_lots from auction_lot where league_id = p_league_id;
  oc := case when d.status = 'live' then
    case when d.mode = 'auction'
      then (case when open_lots < d.max_lots then auction_nominator(d) end)
      else draft_on_clock(d) end end;
  eff_rounds := case
    when d.pick_owners is not null and jsonb_array_length(coalesce(d.draft_order, '[]'::jsonb)) > 0
      then (jsonb_array_length(d.pick_owners) + jsonb_array_length(d.draft_order) - 1)
           / jsonb_array_length(d.draft_order)
    -- pending on a rolled dynasty league: preview the asset-derived rounds
    -- the start will build, not rounds − keepers
    when d.status = 'pending' and d.mode = 'snake' then coalesce(
      (select max(pa.round) from pick_asset pa join league l on l.id = p_league_id
        where pa.league_id = p_league_id and pa.season = l.season),
      d.rounds - d.keeper_slots)
    else d.rounds - d.keeper_slots end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'overall', dp.overall, 'round', dp.round, 'roster_id', dp.roster_id,
      'slug', dp.slug, 'auto', dp.auto, 'price', dp.price) order by dp.overall), '[]'::jsonb)
    into picks from draft_pick dp where dp.league_id = p_league_id;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', al.id, 'slug', al.slug, 'bid', al.bid, 'roster_id', al.roster_id,
      'deadline_at', al.deadline,
      'my_proxy', case when my_r is not null then
        (select px.max_amount from lot_proxy px where px.lot_id = al.id and px.roster_id = my_r) end,
      'my_max', case when my_r is not null then auction_lot_max(p_league_id, my_r, d.rounds, al.id) end
    ) order by al.created_at), '[]'::jsonb)
    into lots from auction_lot al where al.league_id = p_league_id;
  return jsonb_build_object(
    'status', d.status, 'mode', d.mode, 'rounds', eff_rounds,
    'keeper_slots', d.keeper_slots, 'roster_size', d.rounds,
    'pick_owners', d.pick_owners,
    'pick_seconds', d.pick_seconds,
    'lot_seconds', d.lot_seconds, 'max_lots', d.max_lots, 'paused', d.paused,
    'is_mock', coalesce((select l.is_mock from league l where l.id = p_league_id), false),
    'pos_caps', league_pos_caps(p_league_id),
    'start_at', d.start_at,
    'night', case when d.night_start_min is not null then jsonb_build_object(
      'start_min', d.night_start_min, 'end_min', d.night_end_min,
      'is_night', is_night_minute(et_minutes(now()), d.night_start_min, d.night_end_min)) end,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', oc,
    'on_clock_auto', case when d.status = 'live' and oc is not null then not seat_is_live_human(p_league_id, oc) end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks,
    'budget', case when d.mode = 'auction' then d.budget end,
    'lots', lots,
    'budgets', case when d.mode = 'auction' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'budget', m.draft_budget,
        'committed', auction_committed(p_league_id, m.sleeper_roster_id),
        'spots_left', auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds),
        'max_bid', auction_lot_max(p_league_id, m.sleeper_roster_id, d.rounds, null))
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id) end,
    'my_autodraft', coalesce((select m.autodraft from league_membership m
      where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
      order by m.sleeper_roster_id limit 1), false));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Rollover carries the assets (0182's body, extended)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function rollover_league(
  p_league_id uuid, p_weeks int default 14, p_rookie_only boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  lg league%rowtype; d draft%rowtype; nk int; next_seas text; nlid uuid;
  kept int; sched jsonb; gm text; new_settings jsonb; rr int; carried int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));

  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'only native leagues roll over — re-import a platform league''s new season instead');
  end if;
  if lg.kind <> 'league' then
    return jsonb_build_object('ok', false, 'error', 'only full leagues roll over');
  end if;
  if lg.is_mock then
    return jsonb_build_object('ok', false, 'error', 'mock drafts don''t roll over');
  end if;
  if lg.season !~ '^\d{4}$' then
    return jsonb_build_object('ok', false, 'error', 'season "' || coalesce(lg.season, '') || '" isn''t a year');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then
    return jsonb_build_object('ok', false, 'error', 'this season''s draft never finished — nothing to roll over');
  end if;

  next_seas := ((lg.season)::int + 1)::text;
  nlid := _rollover_target(p_league_id);
  if nlid is not null then
    return jsonb_build_object('ok', false, 'error', 'already rolled into ' || next_seas, 'league_id', nlid);
  end if;

  nk := least(coalesce((lg.settings_json ->> 'keeper_count')::int, 0), d.rounds - 1);
  gm := coalesce(lg.settings_json ->> 'game_mode', 'drip');

  -- Same settings, scoring and spec — with the pool filter forced to
  -- rookies-only when this rollover feeds a rookie draft.
  new_settings := coalesce(lg.settings_json, '{}'::jsonb);
  if p_rookie_only then
    new_settings := new_settings || jsonb_build_object('pool_filter', jsonb_build_object('max_exp', 0));
  end if;

  insert into league (sleeper_league_id, season, name, provider, settings_json,
                      commissioner_id, synced_at, avatar_url, kdst_mode, weekly_budget,
                      lineup_policy, pot_ante, pot_cap, kind)
  values (lg.sleeper_league_id, next_seas, lg.name, 'native', new_settings,
          lg.commissioner_id, now(), lg.avatar_url, lg.kdst_mode, lg.weekly_budget,
          lg.lineup_policy, lg.pot_ante, lg.pot_cap, 'league')
  returning id into nlid;

  -- Memberships: same seats, same managers, same team names. Balances and
  -- priorities are season state, not identity — they start fresh.
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id,
                                 app_user_id, enrolled, team_name, claim_email,
                                 avatar_url, controller)
  select nlid, m.sleeper_roster_id, m.sleeper_owner_id,
         m.app_user_id, m.enrolled, m.team_name, m.claim_email,
         m.avatar_url, m.controller
  from league_membership m where m.league_id = p_league_id;

  -- The player pool. A rookie-only rollover carries just the kept players
  -- (their native_roster rows need the FK) and leaves the rest to the
  -- rookies-only reseed; a full rollover carries the whole pool with waiver
  -- clocks cleared. Ranks are last season's — the pre-draft reseed refreshes
  -- them, and seed_league_pool preserves rostered players.
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp)
  select nlid, lp.slug, lp.full_name, lp.pos, lp.team, lp.rank, lp.espn_id, lp.exp
  from league_pool lp
  where lp.league_id = p_league_id
    and (not p_rookie_only or exists (
      select 1 from _keeper_resolve(p_league_id, nk) kr where kr.slug = lp.slug));

  -- Keepers onto the new roster, pre-draft. acquired='keeper', spot='active'
  -- (taxi/IR are in-season designations; the manager re-declares them).
  insert into native_roster (league_id, roster_id, slug, acquired)
  select nlid, kr.roster_id, kr.slug, 'keeper'
  from _keeper_resolve(p_league_id, nk) kr;
  get diagnostics kept = row_count;

  -- A fresh pending draft: same shape as this season's, minus the kept spots.
  insert into draft (league_id, status, rounds, pick_seconds, mode, budget,
                     lot_seconds, max_lots, night_start_min, night_end_min, keeper_slots)
  values (nlid, 'pending', d.rounds, d.pick_seconds, d.mode, d.budget,
          d.lot_seconds, d.max_lots, d.night_start_min, d.night_end_min, nk);

  -- Pick assets (0183): the season the old league traded futures FOR is the
  -- season the new league is about to DRAFT — copy those rows (ownership as
  -- traded) so _start_draft_now finds them, then provision the next
  -- generation of futures from the carried rookie_rounds setting so pick
  -- trading continues without anyone re-enabling it.
  insert into pick_asset (league_id, season, round, original_roster, owner_roster)
  select nlid, pa.season, pa.round, pa.original_roster, pa.owner_roster
  from pick_asset pa where pa.league_id = p_league_id and pa.season = next_seas;
  get diagnostics carried = row_count;
  rr := coalesce((new_settings ->> 'rookie_rounds')::int, 0);
  if rr > 0 then
    perform _provision_pick_assets(nlid, ((next_seas)::int + 1)::text, rr);
  end if;

  -- The season schedule (round-robin; lock_at backfills from the live
  -- scoreboard once next season's slate exists). Best-effort: a 2-team
  -- edge case that refuses here shouldn't strand the created league.
  sched := native_generate_schedule(nlid, p_weeks);

  -- Wallets: deliberately NOT copied. team_wallet/coin_ledger key on the new
  -- league row, so every team starts next season at ◎0 and the weekly-budget
  -- machinery (auto_weekly_budget reads league.weekly_budget, which DID copy)
  -- funds the new season from week 1 — the "fresh season seed" decision.

  return jsonb_build_object(
    'ok', true, 'league_id', nlid, 'season', next_seas,
    -- the created-league confirmation must NAME the game it carries (v0.251.0)
    'game_mode', gm,
    'keeper_slots', nk, 'kept', kept,
    'draft_rounds', case when carried > 0 and d.mode = 'snake'
      then (select max(round) from pick_asset where league_id = nlid and season = next_seas)
      else d.rounds - nk end,
    'roster_size', d.rounds,
    'rookie_only', p_rookie_only,
    'picks_carried', carried,
    'schedule', sched,
    'invite_code', (select invite_code from league where id = nlid));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants
-- ─────────────────────────────────────────────────────────────────────────────
grant execute on function set_rookie_rounds(uuid, int) to authenticated;
grant execute on function pick_assets(uuid) to authenticated;
-- _future_pick_season / _provision_pick_assets / _clean_trade_picks /
-- _pick_ownership_error are internal: reached only through SECURITY DEFINER
-- functions, no grants.
