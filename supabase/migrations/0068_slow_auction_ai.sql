-- 0068: AI COUNTER-BIDDING + SLOW DRAFTS (snake & auction) with fair turns.
--
-- AI bidding = a value model + second-price proxy resolution:
--   • ai_player_value — dollars from pool rank: budget × 0.34 × e^(-rank/45)
--     (top pick ≈ ⅓ of budget, late-round ≈ $1), floor $1.
--   • ai_lot_willingness — that value ±15% deterministic per-seat jitter (AIs
--     disagree), zeroed when the seat's positional caps or forced-K/DEF
--     endgame make the player useless to it, capped at auction_max_bid.
--   • resolve_lot_proxies — ONE closed-form second-price step: the highest
--     willingness (AI valuations + humans' hidden max bids, holder included)
--     wins at second-highest + 1, capped at its own max; ties keep the current
--     holder. No +1 ping-pong loops, no runaway clock extensions.
--
-- Slow-mode fairness (the design decision this migration encodes):
--   1. NO SNIPING — any price/holder change resets the bell to the FULL
--      window (lot_seconds). A lot only closes after a completely quiet
--      window, so a last-second bid just restarts the auction on that lot.
--   2. NO CAMPING ADVANTAGE — humans get hidden PROXY MAX BIDS (lot_proxy),
--      the exact mechanism AI uses. The highest true max wins at
--      second-max + 1 whether or not its owner is online. Set it and sleep.
--   3. NO STALLED TURNS — a nominator who misses their (long) nomination
--      window auto-nominates from their own queue at $1 (0067 behavior), so
--      your turn happens even offline, on a player you chose.
-- Slow SNAKE needs no new mechanics (queue + autodraft + worker sweep already
-- carry it); create_native_league just accepts long clocks + a lot clock.

-- Hidden per-lot max bids. NO select policy: reads only via draft_state
-- (which returns the caller's own proxy) — a proxy must stay secret.
create table if not exists lot_proxy (
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  max_amount int  not null,
  created_at timestamptz not null default now(),
  primary key (league_id, roster_id)
);
alter table lot_proxy enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- AI value model
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function ai_player_value(p_league_id uuid, p_slug text, p_budget int)
  returns int language sql stable security definer set search_path = public as $$
  select greatest(1, round(p_budget * 0.34 * exp(-(
    select lp.rank from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug
  ) / 45.0))::int);
$$;

-- What an AI-driven seat would pay for this player, or 0 if it has no use for
-- him (positional caps mirror native_autopick_slug; forced-K/DEF endgame).
create or replace function ai_lot_willingness(p_league_id uuid, p_roster_id int, p_slug text, p_rounds int, p_budget int)
  returns int language plpgsql stable security definer set search_path = public as $$
declare
  ppos text; qb_n int; te_n int; k_n int; def_n int; total int;
  remaining int; forced int; v numeric;
begin
  select lp.pos into ppos from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug;
  if ppos is null then return 0; end if;
  select count(*) filter (where lp.pos = 'QB'), count(*) filter (where lp.pos = 'TE'),
         count(*) filter (where lp.pos = 'K'), count(*) filter (where lp.pos = 'DEF'), count(*)
    into qb_n, te_n, k_n, def_n, total
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id;
  if (ppos = 'QB' and qb_n >= 3) or (ppos = 'TE' and te_n >= 3)
     or (ppos = 'K' and k_n >= 1) or (ppos = 'DEF' and def_n >= 1) then return 0; end if;
  remaining := p_rounds - total;
  forced := (case when k_n = 0 then 1 else 0 end) + (case when def_n = 0 then 1 else 0 end);
  if remaining <= forced and forced > 0 and not (ppos = 'K' and k_n = 0) and not (ppos = 'DEF' and def_n = 0) then
    return 0;  -- endgame: only the missing K/DEF is worth anything
  end if;
  v := ai_player_value(p_league_id, p_slug, p_budget)
       * (0.85 + (abs(hashtext(p_league_id::text || ':' || p_roster_id || ':' || p_slug)) % 31) / 100.0);
  return least(greatest(1, round(v)::int), auction_max_bid(p_league_id, p_roster_id, p_rounds));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Second-price proxy resolution (AI willingness + human hidden maxes)
-- ─────────────────────────────────────────────────────────────────────────────
-- Returns true when the lot changed (price and/or holder) — the caller's clock
-- semantics: ANY change resets the bell to a full window.
create or replace function resolve_lot_proxies(p_league_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; win_r int; win_w int; second_w int; price int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.paused or d.lot_slug is null then return false; end if;

  -- every seat's effective max: humans = their hidden proxy (0 if none);
  -- AI/vacant/autodraft = model willingness; the holder's floor is the bid.
  with cand as (
    select m.sleeper_roster_id as rid,
      greatest(
        case when m.sleeper_roster_id = d.lot_roster then d.lot_bid else 0 end,
        case when seat_is_live_human(p_league_id, m.sleeper_roster_id)
          then coalesce((select px.max_amount from lot_proxy px
                         where px.league_id = p_league_id and px.roster_id = m.sleeper_roster_id), 0)
          else ai_lot_willingness(p_league_id, m.sleeper_roster_id, d.lot_slug, d.rounds, d.budget) end
      ) as willing
    from league_membership m
    where m.league_id = p_league_id
      and (m.sleeper_roster_id = d.lot_roster
           or auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds) > 0)
  ),
  ranked as (
    select rid, willing,
      row_number() over (order by willing desc, (rid <> d.lot_roster)::int, rid) as rn
    from cand
  )
  select r1.rid, r1.willing, coalesce(r2.willing, 0)
    into win_r, win_w, second_w
  from ranked r1 left join ranked r2 on r2.rn = 2
  where r1.rn = 1;

  if win_r is null then return false; end if;
  price := least(win_w, greatest(d.lot_bid, second_w + 1));
  if win_r = d.lot_roster and price <= d.lot_bid then return false; end if;
  price := greatest(price, d.lot_bid + case when win_r = d.lot_roster then 0 else 1 end);
  if price > win_w then return false; end if;  -- challenger can't legally take it

  update draft set lot_bid = price, lot_roster = win_r,
    lot_deadline = now() + make_interval(secs => d.lot_seconds)   -- FULL window on any change
    where league_id = p_league_id;
  return true;
end $$;

-- A manager's hidden max for the CURRENT lot. Null/0 clears it.
create or replace function set_lot_proxy(p_league_id uuid, p_roster_id int, p_max int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not owns_roster(p_league_id, p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' or d.lot_slug is null then
    return jsonb_build_object('ok', false, 'error', 'no open lot');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  if p_max is null or p_max < 1 then
    delete from lot_proxy where league_id = p_league_id and roster_id = p_roster_id;
    return jsonb_build_object('ok', true, 'max', null);
  end if;
  if auction_spots_left(p_league_id, p_roster_id, d.rounds) < 1 then
    return jsonb_build_object('ok', false, 'error', 'your roster is full');
  end if;
  if p_max > auction_max_bid(p_league_id, p_roster_id, d.rounds) then
    return jsonb_build_object('ok', false, 'error', 'over your max bid of $' || auction_max_bid(p_league_id, p_roster_id, d.rounds));
  end if;
  insert into lot_proxy (league_id, roster_id, max_amount) values (p_league_id, p_roster_id, p_max)
    on conflict (league_id, roster_id) do update set max_amount = excluded.max_amount, created_at = now();
  perform resolve_lot_proxies(p_league_id);
  return jsonb_build_object('ok', true, 'max', p_max);
end $$;

-- place_bid v2: proxies answer a manual bid immediately.
create or replace function place_bid(p_league_id uuid, p_roster_id int, p_amount int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (owns_roster(p_league_id, p_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' or d.lot_slug is null then
    return jsonb_build_object('ok', false, 'error', 'no open lot');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  if d.lot_deadline <= now() then return jsonb_build_object('ok', false, 'error', 'lot closed'); end if;
  if d.lot_roster = p_roster_id then return jsonb_build_object('ok', false, 'error', 'you are the high bidder'); end if;
  if auction_spots_left(p_league_id, p_roster_id, d.rounds) < 1 then
    return jsonb_build_object('ok', false, 'error', 'your roster is full');
  end if;
  if p_amount is null or p_amount <= d.lot_bid then
    return jsonb_build_object('ok', false, 'error', 'bid must beat $' || d.lot_bid);
  end if;
  if p_amount > auction_max_bid(p_league_id, p_roster_id, d.rounds) then
    return jsonb_build_object('ok', false, 'error', 'over your max bid of $' || auction_max_bid(p_league_id, p_roster_id, d.rounds));
  end if;
  update draft set lot_bid = p_amount, lot_roster = p_roster_id,
    lot_deadline = now() + make_interval(secs => d.lot_seconds)   -- FULL window (no sniping)
    where league_id = p_league_id;
  perform resolve_lot_proxies(p_league_id);
  select * into d from draft where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'bid', d.lot_bid, 'roster_id', d.lot_roster,
    'outbid', d.lot_roster <> p_roster_id);
end $$;

-- nominate v2: fresh lot clears stale proxies; AI proxies respond at once.
create or replace function nominate(p_league_id uuid, p_slug text, p_bid int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; nom int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' then
    return jsonb_build_object('ok', false, 'error', 'no live auction');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  if d.lot_slug is not null then return jsonb_build_object('ok', false, 'error', 'a lot is already open'); end if;
  nom := auction_nominator(d);
  if nom is null then return jsonb_build_object('ok', false, 'error', 'no seat can nominate'); end if;
  if not (owns_roster(p_league_id, nom) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your nomination');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;
  if p_bid is null or p_bid < 1 or p_bid > auction_max_bid(p_league_id, nom, d.rounds) then
    return jsonb_build_object('ok', false, 'error', 'opening bid exceeds your max');
  end if;
  delete from lot_proxy where league_id = p_league_id;   -- proxies are per-lot
  update draft set lot_slug = p_slug, lot_bid = p_bid, lot_roster = nom,
    lot_deadline = now() + make_interval(secs => d.lot_seconds), deadline_at = null
    where league_id = p_league_id;
  perform resolve_lot_proxies(p_league_id);
  return jsonb_build_object('ok', true, 'lot', p_slug, 'bid', p_bid, 'roster_id', nom);
end $$;

-- draft_tick v3: resolve proxies before the bell; a change restarts the
-- window (award only after a fully quiet window). Award clears proxies.
create or replace function draft_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; oc int; pick text; made int := 0; r jsonb; n int; nom int; won int := 0;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  loop
    select * into d from draft where league_id = p_league_id;
    exit when not found or d.status <> 'live' or d.paused;
    n := jsonb_array_length(d.draft_order);

    if d.mode = 'auction' then
      if d.lot_slug is not null then
        -- AI/proxy counter-bids first; a price change restarts the bell
        if resolve_lot_proxies(p_league_id) then
          made := made + 1;
          exit when made + won >= 200;
          continue;
        end if;
        exit when d.lot_deadline > now();
        insert into draft_pick (league_id, overall, round, roster_id, slug, auto, price)
        values (p_league_id, d.current_overall, ((d.current_overall - 1) / n) + 1, d.lot_roster, d.lot_slug, false, d.lot_bid);
        insert into native_roster (league_id, roster_id, slug, acquired)
        values (p_league_id, d.lot_roster, d.lot_slug, 'draft');
        update league_membership set draft_budget = draft_budget - d.lot_bid
          where league_id = p_league_id and sleeper_roster_id = d.lot_roster;
        delete from lot_proxy where league_id = p_league_id;
        update draft set current_overall = d.current_overall + 1,
          lot_slug = null, lot_bid = null, lot_roster = null, lot_deadline = null,
          nom_idx = d.nom_idx + 1,
          deadline_at = now() + make_interval(secs => d.pick_seconds)
          where league_id = p_league_id;
        won := won + 1;
        if not exists (select 1 from league_membership m where m.league_id = p_league_id
                       and auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds) > 0) then
          update draft set status = 'complete', completed_at = now(), deadline_at = null
            where league_id = p_league_id;
          perform native_materialize(p_league_id);
          exit;
        end if;
      else
        nom := auction_nominator(d);
        if nom is null then
          update draft set status = 'complete', completed_at = now(), deadline_at = null
            where league_id = p_league_id;
          perform native_materialize(p_league_id);
          exit;
        end if;
        exit when seat_is_live_human(p_league_id, nom) and coalesce(d.deadline_at > now(), false);
        pick := coalesce(native_queue_pick(p_league_id, nom), native_autopick_slug(p_league_id, nom, d.rounds));
        exit when pick is null;
        delete from lot_proxy where league_id = p_league_id;
        update draft set lot_slug = pick, lot_bid = 1, lot_roster = nom,
          lot_deadline = now() + make_interval(secs => d.lot_seconds), deadline_at = null
          where league_id = p_league_id;
        perform resolve_lot_proxies(p_league_id);
        made := made + 1;
      end if;
    else
      oc := draft_on_clock(d);
      exit when seat_is_live_human(p_league_id, oc) and coalesce(d.deadline_at > now(), false);
      pick := coalesce(native_queue_pick(p_league_id, oc), native_autopick_slug(p_league_id, oc, d.rounds));
      exit when pick is null;
      r := native_exec_pick(p_league_id, pick, true);
      exit when not coalesce((r ->> 'ok')::boolean, false);
      made := made + 1;
    end if;
    exit when made + won >= 200;
  end loop;
  return jsonb_build_object('ok', true, 'autopicks', made, 'lots_awarded', won);
end $$;

-- create_native_league v3: lot clock configurable (slow auctions use hours).
drop function if exists create_native_league(text, text, int, int, int, text, int);
create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15
) returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid; e text; nm text; i int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'native leagues are in closed testing'); end if;
  nm := nullif(btrim(coalesce(p_name, '')), '');
  if nm is null then return jsonb_build_object('ok', false, 'error', 'league needs a name'); end if;
  if p_teams is null or p_teams < 2 or p_teams > 14 then
    return jsonb_build_object('ok', false, 'error', 'team count must be 2–14');
  end if;
  if p_rounds is null or p_rounds < 5 or p_rounds > 25 then
    return jsonb_build_object('ok', false, 'error', 'roster size must be 5–25');
  end if;
  if p_pick_seconds is null or p_pick_seconds < 15 or p_pick_seconds > 172800 then
    return jsonb_build_object('ok', false, 'error', 'pick clock must be 15s–48h');
  end if;
  if coalesce(p_mode, 'snake') not in ('snake', 'auction') then
    return jsonb_build_object('ok', false, 'error', 'mode must be snake or auction');
  end if;
  if p_mode = 'auction' and (p_budget is null or p_budget < p_rounds or p_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'budget must cover at least $1 per roster spot');
  end if;
  if p_mode = 'auction' and (p_lot_seconds is null or p_lot_seconds < 10 or p_lot_seconds > 172800) then
    return jsonb_build_object('ok', false, 'error', 'bid clock must be 10s–48h');
  end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  insert into league (sleeper_league_id, season, name, provider, settings_json, commissioner_id, synced_at)
  values ('native-' || replace(gen_random_uuid()::text, '-', ''), coalesce(nullif(btrim(p_season), ''), '2026'),
          nm, 'native', jsonb_build_object('teams', p_teams, 'rounds', p_rounds, 'mode', coalesce(p_mode, 'snake')), auth.uid(), now())
  returning id into lid;

  for i in 1..p_teams loop
    insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled)
    values (lid, i, 'Team ' || i, false);
  end loop;
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e
    where league_id = lid and sleeper_roster_id = 1;

  insert into draft (league_id, rounds, pick_seconds, mode, budget, lot_seconds)
  values (lid, p_rounds, p_pick_seconds, coalesce(p_mode, 'snake'), coalesce(p_budget, 200), coalesce(p_lot_seconds, 15));

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1,
    'invite_code', (select invite_code from league where id = lid));
end $$;

-- draft_state v4: expose lot_seconds + the caller's own hidden proxy.
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int;
begin
  if not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'no draft'); end if;
  select sleeper_roster_id into my_r from league_membership
    where league_id = p_league_id and app_user_id = auth.uid() and enrolled
    order by sleeper_roster_id limit 1;
  oc := case when d.status = 'live' then
    case when d.mode = 'auction' then auction_nominator(d) else draft_on_clock(d) end end;
  select coalesce(jsonb_agg(jsonb_build_object(
      'overall', dp.overall, 'round', dp.round, 'roster_id', dp.roster_id,
      'slug', dp.slug, 'auto', dp.auto, 'price', dp.price) order by dp.overall), '[]'::jsonb)
    into picks from draft_pick dp where dp.league_id = p_league_id;
  return jsonb_build_object(
    'status', d.status, 'mode', d.mode, 'rounds', d.rounds, 'pick_seconds', d.pick_seconds,
    'lot_seconds', d.lot_seconds, 'paused', d.paused,
    'order', d.draft_order, 'current_overall', d.current_overall,
    'on_clock', oc,
    'on_clock_auto', case when d.status = 'live' and oc is not null then not seat_is_live_human(p_league_id, oc) end,
    'deadline_at', d.deadline_at, 'server_now', now(), 'picks', picks,
    'budget', case when d.mode = 'auction' then d.budget end,
    'lot', case when d.lot_slug is not null then jsonb_build_object(
      'slug', d.lot_slug, 'bid', d.lot_bid, 'roster_id', d.lot_roster, 'deadline_at', d.lot_deadline) end,
    'my_proxy', case when d.lot_slug is not null and my_r is not null then
      (select px.max_amount from lot_proxy px where px.league_id = p_league_id and px.roster_id = my_r) end,
    'budgets', case when d.mode = 'auction' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'budget', m.draft_budget,
        'spots_left', auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds),
        'max_bid', auction_max_bid(p_league_id, m.sleeper_roster_id, d.rounds))
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id) end,
    'my_autodraft', coalesce((select m.autodraft from league_membership m
      where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
      order by m.sleeper_roster_id limit 1), false));
end $$;

grant execute on function create_native_league(text, text, int, int, int, text, int, int) to authenticated;
grant execute on function set_lot_proxy(uuid, int, int) to authenticated;
