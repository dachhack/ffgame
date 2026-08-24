-- 0228: the queue bids for you — standing maxes become lot proxies
--
-- Founder: "For auction drafts, can you set a max bid in your queue for
-- missed nom and bid rounds?" — then "let's do proxy bidding with the queue
-- as well."
--
-- The queue already NOMINATES for an absent seat (draft_tick opens its top
-- entry at $1), but a live human's willingness in the resolver is only the
-- hidden max they set BY HAND on an already-open lot — so an absent manager
-- nominated their own guy and then watched (asleep) as anyone took him for
-- $2, and never bid at all when a rival opened a player they had queued.
--
-- One column and one bridge, everything else already existed:
--
--   • draft_queue.max_bid — an optional standing ceiling per queued player.
--   • _queue_proxies(league, lot) — the moment a lot opens (nominate, or
--     either of draft_tick's auto-nomination sites), every seat that queued
--     this player with a max gets it installed as that lot's hidden proxy.
--     An explicit proxy already on the lot is never overwritten, and from
--     here the existing machinery owns everything: second-price resolution,
--     the legal-max clamp at resolve time, cascade delete at the bell.
--   • set_queue_max(league, roster, slug, max) — set/clear the ceiling; if
--     that player's lot is ALREADY open, the max steps in as its proxy too
--     (again only where no explicit proxy stands).
--   • set_draft_queue respin (0067 body): the client replaces the whole
--     queue on every reorder — maxes now ride across the replace.
--
-- Privacy matches the proxy it becomes: draft_queue's RLS already shows a
-- queue only to its own seat, and lot_proxy is hidden at rest.

alter table draft_queue add column if not exists max_bid int
  check (max_bid is null or max_bid >= 1);

-- The bridge: queued standing maxes → this lot's hidden proxies. Idempotent
-- and silent where an explicit proxy already stands.
create or replace function _queue_proxies(p_league_id uuid, p_lot_id uuid)
  returns void language plpgsql security definer set search_path = public as $$
declare lot auction_lot%rowtype;
begin
  select * into lot from auction_lot where id = p_lot_id and league_id = p_league_id;
  if not found then return; end if;
  insert into lot_proxy (lot_id, league_id, roster_id, max_amount)
  select p_lot_id, p_league_id, q.roster_id, q.max_bid
  from draft_queue q
  where q.league_id = p_league_id and q.slug = lot.slug and q.max_bid is not null
  on conflict (lot_id, roster_id) do nothing;
end $$;

-- Set or clear a queued player's standing max. Null clears. If his lot is
-- already on the block, the max steps in as its proxy immediately — the
-- window where "I queued him with a ceiling" and "his lot is open" overlap
-- is exactly when a manager most wants the ceiling live.
create or replace function set_queue_max(p_league_id uuid, p_roster_id int, p_slug text, p_max int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_max is not null and p_max < 1 then
    return jsonb_build_object('ok', false, 'error', 'a standing max is at least $1');
  end if;
  update draft_queue set max_bid = p_max
    where league_id = p_league_id and roster_id = p_roster_id and slug = p_slug;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'queue him first — the max rides the queue entry');
  end if;
  if p_max is not null then
    select id into lid from auction_lot where league_id = p_league_id and slug = p_slug;
    if found then
      insert into lot_proxy (lot_id, league_id, roster_id, max_amount)
      values (lid, p_league_id, p_roster_id, p_max)
      on conflict (lot_id, roster_id) do nothing;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'max_bid', p_max);
end $$;
grant execute on function set_queue_max(uuid, int, text, int) to authenticated;

create or replace function set_draft_queue(p_league_id uuid, p_roster_id int, p_slugs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; maxes jsonb;
begin
  if not (owns_roster(p_league_id, p_roster_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_slugs is null or jsonb_typeof(p_slugs) <> 'array' or jsonb_array_length(p_slugs) > 100 then
    return jsonb_build_object('ok', false, 'error', 'queue must be a list of up to 100 players');
  end if;
  -- 0228: the client replaces the WHOLE queue on every add/remove/reorder —
  -- standing maxes must ride across the replace, not die with the old rows.
  select coalesce(jsonb_object_agg(q.slug, q.max_bid), '{}'::jsonb) into maxes
  from draft_queue q
  where q.league_id = p_league_id and q.roster_id = p_roster_id and q.max_bid is not null;
  delete from draft_queue where league_id = p_league_id and roster_id = p_roster_id;
  insert into draft_queue (league_id, roster_id, slug, pos)
  select p_league_id, p_roster_id, t.slug, min(t.ord)
  from jsonb_array_elements_text(p_slugs) with ordinality as t(slug, ord)
  where exists (select 1 from league_pool lp where lp.league_id = p_league_id and lp.slug = t.slug)
    and not exists (select 1 from native_roster nr where nr.league_id = p_league_id and nr.slug = t.slug)
  group by t.slug;
  get diagnostics n = row_count;
  update draft_queue set max_bid = (maxes ->> slug)::int
    where league_id = p_league_id and roster_id = p_roster_id and maxes ? slug;
  return jsonb_build_object('ok', true, 'queued', n);
end $$;

create or replace function nominate(p_league_id uuid, p_slug text, p_bid int default 1)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; nom int; lid uuid; err text;
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
  err := pos_cap_error(p_league_id, nom, p_slug, true);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  if p_bid is null or p_bid < 1 or p_bid > auction_lot_max(p_league_id, nom, d.rounds, null) then
    return jsonb_build_object('ok', false, 'error', 'opening bid exceeds your max');
  end if;
  insert into auction_lot (league_id, slug, bid, roster_id, nominator, deadline)
  values (p_league_id, p_slug, p_bid, nom, nom, draft_deadline(d, d.lot_seconds))
  returning id into lid;
  -- 0228: queued standing maxes become this lot's hidden proxies before the
  -- first resolution, so an absent manager's ceiling answers from bid one.
  perform _queue_proxies(p_league_id, lid);
  update draft set nom_idx = d.nom_idx + 1,
    deadline_at = case when (select count(*) from auction_lot where league_id = p_league_id) < d.max_lots
                       then draft_deadline(d, d.pick_seconds) end
    where league_id = p_league_id;
  perform resolve_lot_proxies(p_league_id, lid);
  return jsonb_build_object('ok', true, 'lot_id', lid, 'lot', p_slug, 'bid', p_bid, 'roster_id', nom);
end $$;

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
  -- AUTODRAFT RUNS THROUGH A PAUSE (0191). The loop below exits on `d.paused`,
  -- which is right for everyone waiting on a clock and wrong for the seats that
  -- asked not to be waited for. Their picks are made first; if the draft is not
  -- paused this does nothing at all.
  made := made + _autodraft_through_pause(p_league_id);
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
                perform _queue_proxies(p_league_id, (select id from auction_lot where league_id = p_league_id and slug = pick));  -- 0228: standing maxes arm first
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
              perform _queue_proxies(p_league_id, (select id from auction_lot where league_id = p_league_id and slug = pick));  -- 0228: standing maxes arm first
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
