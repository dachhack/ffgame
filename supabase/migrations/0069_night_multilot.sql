-- 0069: OVERNIGHT QUIET HOURS (both draft types) + PARALLEL AUCTION LOTS.
--
-- OVERNIGHT — night-aware clocks, not frozen ones. Every deadline the engine
-- sets (pick clock, nomination window, bid bell) is computed by
-- awake_deadline(), which counts only "awake" time in ET: a 2h clock set at
-- 9pm with 10pm–10am quiet hours lands at 11am tomorrow. Consequences:
--   • no deadline can ever EXPIRE during quiet hours (no 3am autopicks and no
--     10:00:01am avalanche — everyone gets their remaining clock in daylight);
--   • manual picks and bids stay ALLOWED at night — acting early is always
--     legal; a night bid gives rivals until morning + the full window;
--   • ET = America/New_York, so DST is handled by Postgres.
--
-- PARALLEL LOTS — the auction lot moves off the draft row into auction_lot;
-- draft.max_lots (1–4) lots may run at once. The nomination turn still rotates
-- but advances on NOMINATION (not award), so the room fills to capacity. The
-- money rules that keep simultaneous bidding safe:
--   committed(seat) = Σ bids on lots the seat currently holds (may win all);
--   capacity(seat)  = roster spots left − lots held;
--   max bid on another lot = budget − committed − ($1 × (capacity − 1));
--   a seat with no free capacity can't bid or nominate.
-- So a seat can never win its way into a negative budget or an overfull
-- roster. Proxies (hidden maxes) become per-lot. Awards stay independent per
-- lot at each lot's own quiet-window bell.

-- ─────────────────────────────────────────────────────────────────────────────
-- Schema
-- ─────────────────────────────────────────────────────────────────────────────

alter table draft add column if not exists max_lots int not null default 1
  check (max_lots between 1 and 4);
alter table draft add column if not exists night_start_min int;   -- minutes since midnight ET
alter table draft add column if not exists night_end_min int;

create table if not exists auction_lot (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references league(id) on delete cascade,
  slug            text not null,
  bid             int  not null,
  roster_id       int  not null,             -- current high bidder
  nominator       int  not null,
  deadline        timestamptz not null,
  pause_remaining int,
  created_at      timestamptz not null default now(),
  unique (league_id, slug)
);
create index if not exists auction_lot_league on auction_lot(league_id, deadline);
alter table auction_lot enable row level security;
drop policy if exists auction_lot_read on auction_lot;
create policy auction_lot_read on auction_lot for select using (is_league_member(league_id));

-- Proxies become per-lot. Closed testing ⇒ no live rows to migrate.
drop table if exists lot_proxy;
create table lot_proxy (
  lot_id     uuid not null references auction_lot(id) on delete cascade,
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  max_amount int  not null,
  created_at timestamptz not null default now(),
  primary key (lot_id, roster_id)
);
alter table lot_proxy enable row level security;  -- no policies: hidden at rest

-- Migrate any in-flight single lot off the draft row (idempotent).
insert into auction_lot (league_id, slug, bid, roster_id, nominator, deadline)
select d.league_id, d.lot_slug, coalesce(d.lot_bid, 1), d.lot_roster, d.lot_roster,
       coalesce(d.lot_deadline, now() + make_interval(secs => d.lot_seconds))
from draft d
where d.lot_slug is not null
on conflict (league_id, slug) do nothing;
update draft set lot_slug = null, lot_bid = null, lot_roster = null, lot_deadline = null
where lot_slug is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- Night-aware clock arithmetic (pure functions — probe-tested directly)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function et_minutes(ts timestamptz) returns int
  language sql stable as $$
  select (extract(hour from ts at time zone 'America/New_York') * 60
        + extract(minute from ts at time zone 'America/New_York'))::int;
$$;

create or replace function is_night_minute(m int, ns int, ne int) returns boolean
  language sql immutable as $$
  select case when ns is null or ne is null or ns = ne then false
              when ns > ne then (m >= ns or m < ne)      -- wraps midnight (22:00→10:00)
              else (m >= ns and m < ne) end;
$$;

/** now() + p_secs of AWAKE time: quiet hours [ns, ne) (minutes, ET) don't burn
 *  clock. Null/equal bounds ⇒ plain addition. */
create or replace function awake_deadline(p_from timestamptz, p_secs int, ns int, ne int)
  returns timestamptz language plpgsql stable as $$
declare
  t timestamptz := p_from; rem numeric := p_secs; i int; m int;
  day_local timestamp; night_end_local timestamp; next_start_local timestamp; nstart timestamptz;
begin
  if ns is null or ne is null or ns = ne then return p_from + make_interval(secs => p_secs); end if;
  for i in 1..10 loop
    m := et_minutes(t);
    day_local := date_trunc('day', t at time zone 'America/New_York');
    if is_night_minute(m, ns, ne) then
      -- sleep to the end of the night that contains t
      night_end_local := case when ns > ne and m >= ns
        then day_local + interval '1 day' + make_interval(mins => ne)
        else day_local + make_interval(mins => ne) end;
      t := night_end_local at time zone 'America/New_York';
      continue;
    end if;
    -- t is awake; the next night begins at the next occurrence of ns
    next_start_local := case when m < ns then day_local + make_interval(mins => ns)
                             else day_local + interval '1 day' + make_interval(mins => ns) end;
    nstart := next_start_local at time zone 'America/New_York';
    if t + make_interval(secs => rem::int) <= nstart then
      return t + make_interval(secs => rem::int);
    end if;
    rem := rem - extract(epoch from nstart - t);
    t := nstart;
  end loop;
  return t + make_interval(secs => greatest(0, rem)::int);   -- safety valve
end $$;

create or replace function draft_deadline(d draft, p_secs int) returns timestamptz
  language sql stable as $$
  select awake_deadline(now(), p_secs, d.night_start_min, d.night_end_min);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Parallel-lot money helpers
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function auction_committed(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(sum(bid), 0)::int from auction_lot
  where league_id = p_league_id and roster_id = p_roster_id;
$$;

create or replace function auction_held(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from auction_lot
  where league_id = p_league_id and roster_id = p_roster_id;
$$;

-- Highest legal bid on a given lot (or a NEW nomination when p_lot_id is null):
-- exclude the lot itself when the seat already holds it (raising a defense),
-- reserve $1 for every OTHER spot the seat could still fill.
create or replace function auction_lot_max(p_league_id uuid, p_roster_id int, p_rounds int, p_lot_id uuid)
  returns int language plpgsql stable security definer set search_path = public as $$
declare
  bud int; committed int; held int; this_bid int := 0; this_held int := 0; cap int;
begin
  select draft_budget into bud from league_membership
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  committed := auction_committed(p_league_id, p_roster_id);
  held := auction_held(p_league_id, p_roster_id);
  if p_lot_id is not null then
    select bid, 1 into this_bid, this_held from auction_lot
      where id = p_lot_id and roster_id = p_roster_id;
    this_bid := coalesce(this_bid, 0); this_held := coalesce(this_held, 0);
  end if;
  cap := auction_spots_left(p_league_id, p_roster_id, p_rounds) - (held - this_held);
  if cap < 1 then return 0; end if;   -- no capacity to win one more lot
  return coalesce(bud, 0) - (committed - this_bid) - (cap - 1);
end $$;

-- ai_lot_willingness v2: UNCAPPED model value (0 when the seat has no use for
-- the player). The per-lot budget cap now lives in resolve_lot_proxies via
-- auction_lot_max, which understands committed parallel-lot money.
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
    return 0;
  end if;
  v := ai_player_value(p_league_id, p_slug, p_budget)
       * (0.85 + (abs(hashtext(p_league_id::text || ':' || p_roster_id || ':' || p_slug)) % 31) / 100.0);
  return greatest(1, round(v)::int);
end $$;

-- Nominator rotation v2: skip seats without capacity for one more lot.
create or replace function auction_nominator(d draft) returns int
  language plpgsql stable security definer set search_path = public as $$
declare n int; i int; rid int;
begin
  n := jsonb_array_length(d.draft_order);
  if n is null or n = 0 then return null; end if;
  for i in 0..(n - 1) loop
    rid := (d.draft_order ->> ((d.nom_idx + i) % n))::int;
    if auction_lot_max(d.league_id, rid, d.rounds, null) >= 1 then return rid; end if;
  end loop;
  return null;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Per-lot second-price proxy resolution (AI willingness + human hidden maxes)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function resolve_lot_proxies(p_league_id uuid, p_lot_id uuid)
  returns boolean language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; lot auction_lot%rowtype; win_r int; win_w int; second_w int; price int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.paused then return false; end if;
  select * into lot from auction_lot where id = p_lot_id and league_id = p_league_id;
  if not found then return false; end if;

  with cand as (
    select m.sleeper_roster_id as rid,
      least(
        greatest(
          case when m.sleeper_roster_id = lot.roster_id then lot.bid else 0 end,
          case when seat_is_live_human(p_league_id, m.sleeper_roster_id)
            then coalesce((select px.max_amount from lot_proxy px
                           where px.lot_id = p_lot_id and px.roster_id = m.sleeper_roster_id), 0)
            else ai_lot_willingness(p_league_id, m.sleeper_roster_id, lot.slug, d.rounds, d.budget) end
        ),
        greatest(case when m.sleeper_roster_id = lot.roster_id then lot.bid else 0 end,
                 auction_lot_max(p_league_id, m.sleeper_roster_id, d.rounds, p_lot_id))
      ) as willing
    from league_membership m
    where m.league_id = p_league_id
  ),
  ranked as (
    select rid, willing,
      row_number() over (order by willing desc, (rid <> lot.roster_id)::int, rid) as rn
    from cand where willing > 0
  )
  select r1.rid, r1.willing, coalesce(r2.willing, 0)
    into win_r, win_w, second_w
  from ranked r1 left join ranked r2 on r2.rn = 2
  where r1.rn = 1;

  if win_r is null then return false; end if;
  price := least(win_w, greatest(lot.bid, second_w + 1));
  if win_r = lot.roster_id and price <= lot.bid then return false; end if;
  price := greatest(price, lot.bid + case when win_r = lot.roster_id then 0 else 1 end);
  if price > win_w then return false; end if;

  update auction_lot set bid = price, roster_id = win_r,
    deadline = draft_deadline(d, d.lot_seconds)      -- FULL awake window on any change
    where id = p_lot_id;
  return true;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Auction RPCs v3 (lot-id aware; default = the oldest open lot)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function default_lot(p_league_id uuid) returns uuid
  language sql stable security definer set search_path = public as $$
  select id from auction_lot where league_id = p_league_id order by created_at limit 1;
$$;

create or replace function nominate(p_league_id uuid, p_slug text, p_bid int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; nom int; lid uuid; nxt int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' then
    return jsonb_build_object('ok', false, 'error', 'no live auction');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  if (select count(*) from auction_lot where league_id = p_league_id) >= d.max_lots then
    return jsonb_build_object('ok', false, 'error', 'all ' || d.max_lots || ' lots are open — wait for a bell');
  end if;
  nom := auction_nominator(d);
  if nom is null then return jsonb_build_object('ok', false, 'error', 'no seat can nominate'); end if;
  if not (owns_roster(p_league_id, nom) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your nomination');
  end if;
  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug)
     or exists (select 1 from auction_lot al where al.league_id = p_league_id and al.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered or on the block');
  end if;
  if p_bid is null or p_bid < 1 or p_bid > auction_lot_max(p_league_id, nom, d.rounds, null) then
    return jsonb_build_object('ok', false, 'error', 'opening bid exceeds your max');
  end if;
  insert into auction_lot (league_id, slug, bid, roster_id, nominator, deadline)
  values (p_league_id, p_slug, p_bid, nom, nom, draft_deadline(d, d.lot_seconds))
  returning id into lid;
  -- the turn advances on NOMINATION; open the next nominator's window if the
  -- room still has lot capacity
  update draft set nom_idx = d.nom_idx + 1,
    deadline_at = case when (select count(*) from auction_lot where league_id = p_league_id) < d.max_lots
                       then draft_deadline(d, d.pick_seconds) end
    where league_id = p_league_id;
  perform resolve_lot_proxies(p_league_id, lid);
  return jsonb_build_object('ok', true, 'lot_id', lid, 'lot', p_slug, 'bid', p_bid, 'roster_id', nom);
end $$;

create or replace function place_bid(p_league_id uuid, p_roster_id int, p_amount int, p_lot_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; lot auction_lot%rowtype; lid uuid;
begin
  if not (owns_roster(p_league_id, p_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' then
    return jsonb_build_object('ok', false, 'error', 'no live auction');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  lid := coalesce(p_lot_id, default_lot(p_league_id));
  select * into lot from auction_lot where id = lid and league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no open lot'); end if;
  if lot.deadline <= now() then return jsonb_build_object('ok', false, 'error', 'lot closed'); end if;
  if lot.roster_id = p_roster_id then return jsonb_build_object('ok', false, 'error', 'you are the high bidder'); end if;
  if p_amount is null or p_amount <= lot.bid then
    return jsonb_build_object('ok', false, 'error', 'bid must beat $' || lot.bid);
  end if;
  if p_amount > auction_lot_max(p_league_id, p_roster_id, d.rounds, lid) then
    return jsonb_build_object('ok', false, 'error', 'over your max bid of $' || auction_lot_max(p_league_id, p_roster_id, d.rounds, lid));
  end if;
  update auction_lot set bid = p_amount, roster_id = p_roster_id,
    deadline = draft_deadline(d, d.lot_seconds)
    where id = lid;
  perform resolve_lot_proxies(p_league_id, lid);
  select * into lot from auction_lot where id = lid;
  return jsonb_build_object('ok', true, 'bid', lot.bid, 'roster_id', lot.roster_id,
    'outbid', lot.roster_id <> p_roster_id);
end $$;

create or replace function set_lot_proxy(p_league_id uuid, p_roster_id int, p_max int, p_lot_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; lid uuid;
begin
  if not owns_roster(p_league_id, p_roster_id) then
    return jsonb_build_object('ok', false, 'error', 'not your seat');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or d.mode <> 'auction' then
    return jsonb_build_object('ok', false, 'error', 'no open lot');
  end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'draft is paused'); end if;
  lid := coalesce(p_lot_id, default_lot(p_league_id));
  if lid is null or not exists (select 1 from auction_lot where id = lid and league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'no open lot');
  end if;
  if p_max is null or p_max < 1 then
    delete from lot_proxy where lot_id = lid and roster_id = p_roster_id;
    return jsonb_build_object('ok', true, 'max', null);
  end if;
  if p_max > auction_lot_max(p_league_id, p_roster_id, d.rounds, lid) then
    return jsonb_build_object('ok', false, 'error', 'over your max bid of $' || auction_lot_max(p_league_id, p_roster_id, d.rounds, lid));
  end if;
  insert into lot_proxy (lot_id, league_id, roster_id, max_amount) values (lid, p_league_id, p_roster_id, p_max)
    on conflict (lot_id, roster_id) do update set max_amount = excluded.max_amount, created_at = now();
  perform resolve_lot_proxies(p_league_id, lid);
  return jsonb_build_object('ok', true, 'max', p_max);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- draft_tick v4: night-aware, multi-lot (resolve → award due bells →
-- completion → fill nomination capacity)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function draft_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; lot auction_lot%rowtype; oc int; pick text; made int := 0; r jsonb;
  n int; nom int; won int := 0; changed boolean;
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  loop
    select * into d from draft where league_id = p_league_id;
    exit when not found or d.status <> 'live' or d.paused;
    n := jsonb_array_length(d.draft_order);
    changed := false;

    if d.mode = 'auction' then
      -- 1. proxies answer on every open lot (a change restarts that lot's bell)
      for lot in select * from auction_lot where league_id = p_league_id loop
        if resolve_lot_proxies(p_league_id, lot.id) then changed := true; made := made + 1; end if;
      end loop;
      -- 2. award every lot whose bell has gone quiet
      for lot in select * from auction_lot where league_id = p_league_id and deadline <= now() order by created_at loop
        insert into draft_pick (league_id, overall, round, roster_id, slug, auto, price)
        values (p_league_id, d.current_overall, ((d.current_overall - 1) / n) + 1, lot.roster_id, lot.slug, false, lot.bid);
        insert into native_roster (league_id, roster_id, slug, acquired)
        values (p_league_id, lot.roster_id, lot.slug, 'draft');
        update league_membership set draft_budget = draft_budget - lot.bid
          where league_id = p_league_id and sleeper_roster_id = lot.roster_id;
        delete from auction_lot where id = lot.id;   -- cascades this lot's proxies
        update draft set current_overall = current_overall + 1 where league_id = p_league_id;
        select * into d from draft where league_id = p_league_id;
        won := won + 1; changed := true;
      end loop;
      -- 3. complete when every roster is full
      if not exists (select 1 from league_membership m where m.league_id = p_league_id
                     and auction_spots_left(p_league_id, m.sleeper_roster_id, d.rounds) > 0) then
        delete from auction_lot where league_id = p_league_id;
        update draft set status = 'complete', completed_at = now(), deadline_at = null
          where league_id = p_league_id;
        perform native_materialize(p_league_id);
        exit;
      end if;
      -- 4. fill nomination capacity
      if (select count(*) from auction_lot where league_id = p_league_id) < d.max_lots then
        nom := auction_nominator(d);
        if nom is not null then
          if seat_is_live_human(p_league_id, nom) then
            if d.deadline_at is null then
              update draft set deadline_at = draft_deadline(d, d.pick_seconds) where league_id = p_league_id;
              changed := true;
            elsif d.deadline_at <= now() then
              pick := coalesce(native_queue_pick(p_league_id, nom), native_autopick_slug(p_league_id, nom, d.rounds));
              if pick is not null then
                insert into auction_lot (league_id, slug, bid, roster_id, nominator, deadline)
                values (p_league_id, pick, 1, nom, nom, draft_deadline(d, d.lot_seconds));
                update draft set nom_idx = nom_idx + 1, deadline_at = null where league_id = p_league_id;
                perform resolve_lot_proxies(p_league_id, (select id from auction_lot where league_id = p_league_id and slug = pick));
                made := made + 1; changed := true;
              end if;
            end if;
          else
            pick := coalesce(native_queue_pick(p_league_id, nom), native_autopick_slug(p_league_id, nom, d.rounds));
            if pick is not null then
              insert into auction_lot (league_id, slug, bid, roster_id, nominator, deadline)
              values (p_league_id, pick, 1, nom, nom, draft_deadline(d, d.lot_seconds));
              update draft set nom_idx = nom_idx + 1, deadline_at = null where league_id = p_league_id;
              perform resolve_lot_proxies(p_league_id, (select id from auction_lot where league_id = p_league_id and slug = pick));
              made := made + 1; changed := true;
            end if;
          end if;
        end if;
      end if;
      exit when not changed;
    else
      -- snake (night-aware deadlines set in native_exec_pick v2 below)
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

-- native_exec_pick v2: the next snake pick clock skips quiet hours.
create or replace function native_exec_pick(p_league_id uuid, p_slug text, p_auto boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; n int; rnd int; oc int;
begin
  select * into d from draft where league_id = p_league_id;
  if d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  oc := draft_on_clock(d);
  n := jsonb_array_length(d.draft_order);
  rnd := ((d.current_overall - 1) / n) + 1;

  if not exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player not in pool');
  end if;
  if exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = p_slug) then
    return jsonb_build_object('ok', false, 'error', 'player already rostered');
  end if;

  insert into draft_pick (league_id, overall, round, roster_id, slug, auto)
  values (p_league_id, d.current_overall, rnd, oc, p_slug, p_auto);
  insert into native_roster (league_id, roster_id, slug, acquired)
  values (p_league_id, oc, p_slug, 'draft');

  if d.current_overall >= d.rounds * n then
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

-- start_draft v3: first clock is night-aware.
create or replace function start_draft(p_league_id uuid, p_order jsonb default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; ids int[]; ord jsonb; n int; i int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'draft already started'); end if;
  if not exists (select 1 from league_pool where league_id = p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'player pool not seeded');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id) into ids
    from league_membership where league_id = p_league_id;
  n := coalesce(array_length(ids, 1), 0);
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  if (select count(*) from league_pool where league_id = p_league_id) < d.rounds * n then
    return jsonb_build_object('ok', false, 'error', 'pool smaller than the draft');
  end if;

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
    select jsonb_agg(to_jsonb(x) order by random()) into ord from unnest(ids) as x;
  end if;

  update draft set status = 'live', draft_order = ord, current_overall = 1, nom_idx = 0,
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

  return jsonb_build_object('ok', true, 'order', ord, 'mode', d.mode);
end $$;

-- Pause/resume v2: per-lot remaining seconds; resume restores awake-aware.
create or replace function commish_pause_draft(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'draft not live'); end if;
  if d.paused then return jsonb_build_object('ok', false, 'error', 'already paused'); end if;
  update auction_lot set pause_remaining = greatest(1, extract(epoch from deadline - now())::int)
    where league_id = p_league_id;
  update draft set paused = true,
    pause_remaining = case when d.deadline_at is not null
      then greatest(1, extract(epoch from d.deadline_at - now())::int) end
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'paused', true);
end $$;

create or replace function commish_resume_draft(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'live' or not d.paused then return jsonb_build_object('ok', false, 'error', 'not paused'); end if;
  update auction_lot set deadline = awake_deadline(now(), coalesce(pause_remaining, d.lot_seconds), d.night_start_min, d.night_end_min),
    pause_remaining = null
    where league_id = p_league_id;
  update draft set paused = false,
    deadline_at = case when d.pause_remaining is not null
      then awake_deadline(now(), d.pause_remaining, d.night_start_min, d.night_end_min) end,
    pause_remaining = null
    where league_id = p_league_id;
  return jsonb_build_object('ok', true, 'paused', false);
end $$;

-- commish_undo_pick v2: night-aware clock on the reopened pick.
create or replace function commish_undo_pick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; last draft_pick%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found or d.status not in ('live', 'complete') then return jsonb_build_object('ok', false, 'error', 'no draft to unwind'); end if;
  if d.mode <> 'snake' then return jsonb_build_object('ok', false, 'error', 'snake drafts only'); end if;
  select * into last from draft_pick where league_id = p_league_id order by overall desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'nothing to undo'); end if;
  delete from draft_pick where league_id = p_league_id and overall = last.overall;
  delete from native_roster where league_id = p_league_id and roster_id = last.roster_id and slug = last.slug;
  update draft set status = 'live', completed_at = null, current_overall = last.overall,
    deadline_at = case when d.paused then null else draft_deadline(d, d.pick_seconds) end
    where league_id = p_league_id;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'undone_overall', last.overall, 'slug', last.slug, 'roster_id', last.roster_id);
end $$;

-- create_native_league v4: max lots + overnight quiet hours.
drop function if exists create_native_league(text, text, int, int, int, text, int, int);
create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15, p_max_lots int default 1,
  p_night_start_min int default null, p_night_end_min int default null
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
  if p_mode = 'auction' and (p_max_lots is null or p_max_lots < 1 or p_max_lots > 4) then
    return jsonb_build_object('ok', false, 'error', 'lots at once must be 1–4');
  end if;
  if (p_night_start_min is null) <> (p_night_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'overnight pause needs both a start and an end');
  end if;
  if p_night_start_min is not null and (
       p_night_start_min < 0 or p_night_start_min > 1439
    or p_night_end_min < 0 or p_night_end_min > 1439
    or p_night_start_min = p_night_end_min) then
    return jsonb_build_object('ok', false, 'error', 'overnight hours must be two different times of day');
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

  insert into draft (league_id, rounds, pick_seconds, mode, budget, lot_seconds, max_lots, night_start_min, night_end_min)
  values (lid, p_rounds, p_pick_seconds, coalesce(p_mode, 'snake'), coalesce(p_budget, 200),
          coalesce(p_lot_seconds, 15), coalesce(p_max_lots, 1), p_night_start_min, p_night_end_min);

  return jsonb_build_object('ok', true, 'league_id', lid, 'roster_id', 1,
    'invite_code', (select invite_code from league where id = lid));
end $$;

-- draft_state v6: lots array (with the caller's per-lot proxy + max), night info.
create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; picks jsonb; oc int; my_r int; lots jsonb; open_lots int;
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
    'status', d.status, 'mode', d.mode, 'rounds', d.rounds, 'pick_seconds', d.pick_seconds,
    'lot_seconds', d.lot_seconds, 'max_lots', d.max_lots, 'paused', d.paused,
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

grant execute on function create_native_league(text, text, int, int, int, text, int, int, int, int, int) to authenticated;
grant execute on function place_bid(uuid, int, int, uuid) to authenticated;
grant execute on function set_lot_proxy(uuid, int, int, uuid) to authenticated;
drop function if exists place_bid(uuid, int, int);
drop function if exists set_lot_proxy(uuid, int, int);
drop function if exists resolve_lot_proxies(uuid);
drop function if exists auction_max_bid(uuid, int, int);  -- superseded by auction_lot_max
