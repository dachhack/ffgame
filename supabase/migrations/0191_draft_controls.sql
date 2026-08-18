-- 0191: THE REST OF THE DRAFT CONTROLS — start over, reseat a team mid-draft,
-- and let autodraft run through a pause.
--
-- Founder's list was seven controls. FOUR ALREADY EXISTED in 0067 and are
-- worth naming so nobody rebuilds them:
--   • back out a pick            → commish_undo_pick
--   • force a pick from queue    → commish_force_pick(league, null)
--     (queue first, then best available — exactly the asked-for fallback)
--   • assign a player to a pick  → commish_force_pick(league, slug)
--   • put a team on autodraft    → set_autodraft, which has always accepted
--     the COMMISSIONER as well as the seat's owner
-- Their gaps were in the UI, not the database. Three things were genuinely
-- missing, and they are what this migration is.
--
-- (1) TRASH THE DRAFT AND START OVER. There was no reset anywhere — a draft
--     that went wrong could be unwound one pick at a time and no other way.
--     KEEPERS SURVIVE: they land on native_roster as acquired='keeper' BEFORE
--     the draft (0182), so a reset deletes acquired='draft' only. A keeper was
--     never drafted and must not be un-drafted. TRADES SURVIVE TOO: pick
--     ownership is an agreement between two managers, not part of the draft's
--     state, and re-running the draft does not un-agree it. So does every
--     manager's QUEUE — the wishlist is theirs, not the draft's.
--
-- (2) MOVE A TEAM'S DRAFT POSITION, mid-draft. `set_draft_order` (0176) is
--     pending-only and rightly so for a wholesale re-cut. Moving ONE team is a
--     different act — the commissioner's answer to "he joined late, put him at
--     the end" — and it has to work while the room is running. Picks already
--     made are history and keep their seats; everything from the clock forward
--     follows the new order, which for a league with owned picks (0183/0190)
--     means REBUILDING pick_owners, or the order would move and the clock
--     would keep calling the old seats.
--
-- (3) AUTODRAFT THROUGH A PAUSE. `draft_tick` exits its whole loop on
--     `d.paused`, so a paused draft stops for everyone — including the seats
--     that explicitly asked not to be waited for. A commissioner pauses to give
--     PEOPLE time; a robot does not need it. Autodraft seats now keep picking
--     while the room is paused, and the clock stays frozen for everyone else.

-- ─────────────────────────────────────────────────────────────────────────────
-- (1) Start over
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function commish_reset_draft(p_league_id uuid, p_confirm text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; wiped int; kept int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status = 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the draft has not started');
  end if;
  -- Typed, like deleting a league (0188). Every pick in the room goes; a
  -- second tap is not proportional to that.
  if lower(btrim(coalesce(p_confirm, ''))) is distinct from 'reset' then
    return jsonb_build_object('ok', false, 'error', 'type RESET to start the draft over');
  end if;

  select count(*) into wiped from draft_pick where league_id = p_league_id;
  select count(*) into kept from native_roster
    where league_id = p_league_id and acquired = 'keeper';

  delete from draft_pick where league_id = p_league_id;
  -- ONLY the drafted rows. Keepers (0182) were never drafted, and anything
  -- picked up on waivers or in a trade since is not the draft's to undo.
  delete from native_roster where league_id = p_league_id and acquired = 'draft';
  delete from auction_lot where league_id = p_league_id;

  update draft set
    status = 'pending', current_overall = 1, nom_idx = 0,
    deadline_at = null, started_at = null, completed_at = null,
    paused = false, pause_remaining = null,
    pick_owners = null,
    lot_slug = null, lot_bid = null, lot_roster = null, lot_deadline = null
    where league_id = p_league_id;
  update league_membership set draft_budget = null where league_id = p_league_id;

  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'picks_cleared', wiped, 'keepers_kept', kept);
end $$;
grant execute on function commish_reset_draft(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (2) Move one team's draft position
-- ─────────────────────────────────────────────────────────────────────────────
/** Move p_roster to 1-based position p_to in the order, sliding the others
 *  along. Works pending OR live; live rebuilds the owner list from the clock
 *  forward. */
create or replace function commish_move_draft_slot(p_league_id uuid, p_roster int, p_to int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; ord jsonb; n int; i int; from_i int := null;
  rest jsonb := '[]'::jsonb; new_ord jsonb := '[]'::jsonb;
  lseas text; maxr int; r int; orig int; owners jsonb; snake_kind boolean;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if d.status = 'complete' then
    return jsonb_build_object('ok', false, 'error', 'the draft is over');
  end if;
  if d.mode <> 'snake' then
    return jsonb_build_object('ok', false, 'error', 'snake drafts only — an auction has no order to move');
  end if;

  ord := d.draft_order;
  if ord is null then
    -- Pending with no order drawn yet: nothing to move within.
    return jsonb_build_object('ok', false, 'error', 'set the draft order first');
  end if;
  n := jsonb_array_length(ord);
  for i in 0..(n - 1) loop
    if (ord ->> i)::int = p_roster then from_i := i; exit; end if;
  end loop;
  if from_i is null then return jsonb_build_object('ok', false, 'error', 'that team is not in the order'); end if;
  if p_to < 1 or p_to > n then
    return jsonb_build_object('ok', false, 'error', format('position must be 1–%s', n));
  end if;

  -- Pull the team out, then splice it back in at the target. Sliding rather
  -- than SWAPPING is the founder's "move teams in and out of positions": a
  -- swap would move a second team nobody asked to move.
  for i in 0..(n - 1) loop
    if i <> from_i then rest := rest || jsonb_build_array((ord ->> i)::int); end if;
  end loop;
  for i in 0..(n - 2) loop
    if i = p_to - 1 then new_ord := new_ord || jsonb_build_array(p_roster); end if;
    new_ord := new_ord || jsonb_build_array((rest ->> i)::int);
  end loop;
  if p_to = n then new_ord := new_ord || jsonb_build_array(p_roster); end if;

  update draft set draft_order = new_ord where league_id = p_league_id;

  -- A live draft with owned picks reads pick_owners, not the arithmetic, so a
  -- new order that didn't rebuild it would move the ORDER and leave the CLOCK
  -- calling the old seats — the change would look applied and do nothing.
  if d.pick_owners is not null then
    select season into lseas from league where id = p_league_id;
    select max(round) into maxr from pick_asset where league_id = p_league_id and season = lseas;
    select bool_or(kind = 'startup') into snake_kind from pick_asset
      where league_id = p_league_id and season = lseas;
    owners := '[]'::jsonb;
    for r in 1..coalesce(maxr, 0) loop
      for i in 0..(n - 1) loop
        orig := (new_ord ->> (case when coalesce(snake_kind, false) and r % 2 = 0 then n - 1 - i else i end))::int;
        owners := owners || to_jsonb(coalesce(
          (select owner_roster from pick_asset pa
            where pa.league_id = p_league_id and pa.season = lseas
              and pa.round = r and pa.original_roster = orig),
          orig));
      end loop;
    end loop;
    update draft set pick_owners = owners where league_id = p_league_id;
  end if;

  return jsonb_build_object('ok', true, 'order', new_ord, 'moved', p_roster, 'to', p_to);
end $$;
grant execute on function commish_move_draft_slot(uuid, int, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- (3) Autodraft keeps running while the room is paused
-- ─────────────────────────────────────────────────────────────────────────────
/** Make every pick that an AUTODRAFT seat is due while the draft is paused.
 *
 *  A pause freezes the CLOCK — that is its whole meaning, and it stays true
 *  here: nothing picks because time ran out. An autodraft seat picks because it
 *  asked to be picked FOR, which is a standing instruction, not a deadline, and
 *  making it wait for a pause aimed at humans is the bug.
 *
 *  The guard is a real bound, not superstition: this loop is the one place a
 *  pick can be made without a clock to stop it, so it cannot be allowed to spin
 *  if some future change makes a pick that doesn't advance the draft. */
create or replace function _autodraft_through_pause(p_league_id uuid) returns int
  language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; oc int; pick text; made int := 0; guard int := 0; before int;
begin
  loop
    guard := guard + 1;
    exit when guard > 600;
    select * into d from draft where league_id = p_league_id;
    exit when not found or d.status <> 'live' or not d.paused or d.mode <> 'snake';
    oc := draft_on_clock(d);
    exit when oc is null;
    exit when not exists (select 1 from league_membership m
      where m.league_id = p_league_id and m.sleeper_roster_id = oc and m.autodraft);
    pick := coalesce(native_queue_pick(p_league_id, oc),
                     native_autopick_slug(p_league_id, oc, d.rounds));
    exit when pick is null;
    before := d.current_overall;
    perform native_exec_pick(p_league_id, pick, true);
    -- Belt and braces: if the pick did not advance the clock, stop rather than
    -- pick again for the same overall.
    exit when (select current_overall from draft where league_id = p_league_id) = before;
    made := made + 1;
  end loop;
  -- native_exec_pick sets a fresh deadline through draft_deadline, which knows
  -- nothing about pauses. Put the clock back where a paused draft belongs.
  update draft set deadline_at = null where league_id = p_league_id and paused;
  return made;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- draft_tick v5: make the autodraft picks a pause was swallowing
-- ─────────────────────────────────────────────────────────────────────────────
-- draft_tick v5 (0191): 0069's body, with one call added before the loop.
-- Everything else is verbatim.
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
