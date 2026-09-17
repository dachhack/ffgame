-- 0285: A SEAT THAT RUNS OUT THE CLOCK GOES ON AUTODRAFT (v0.396.0).
--
-- Founder, mid-draft: "We need a way that teams that time out and auto get
-- set to auto draft."
--
-- Until now a clock that ran out cost the room ONE pick's wait, then the seat
-- went back to being a live human and the next turn waited the full clock
-- again. A manager who has wandered off makes everyone sit through every one
-- of their picks. Every platform flips the seat to autodraft on the first
-- timeout and lets the manager switch it back; now this one does too.
--
-- WHERE: the one place in draft_tick where a live human's PICK deadline is
-- found to be behind us — the snake/linear branch. The helper runs before the
-- autopick, so the pick that follows is already an autodraft pick and the
-- seat is not waited for again until the manager turns it off (the AUTODRAFT
-- chip in the room, which both hosts already show, with a banner while it is
-- on).
--
-- NOT THE AUCTION NOMINATION CLOCK, deliberately. In an auction "autodraft"
-- is not a queue pick: resolve_lot_proxies bids on behalf of every seat that
-- is not a live human, so flipping a nominator who missed one bell would hand
-- the AI their BUDGET — and it would start spending it on the very lot they
-- just nominated (auction-engine probe ae7t caught exactly that). Missing a
-- nomination already costs nothing but the nomination: the tick nominates
-- from the queue and the standing maxes bid as they were set. A manager who
-- wants the machine to bid for them turns autodraft on themselves.
--
-- WHAT THE HELPER DOES: flips league_membership.autodraft, writes a 'timeout'
-- line to the draft log (0284) and sets a transaction-local flag so the log's
-- autodraft trigger stays quiet — one line, "ran out of time", not two — and
-- pushes the seat's manager a note, because the person who timed out is by
-- definition not looking at the room. The push mirrors the worker's
-- on-the-clock push (same kind, same data, its own dedupe key), and is
-- skipped in a practice room, where the only human is the one practising.
--
-- draft_tick's body is 0228's verbatim, plus the one call.

create or replace function _timeout_to_autodraft(p_league_id uuid, p_roster int, p_overall int, p_round int)
  returns void language plpgsql security definer set search_path = public as $$
declare owner uuid; nm text; mock boolean;
begin
  perform set_config('drip.timeout_flip', '1', true);
  update league_membership set autodraft = true
    where league_id = p_league_id and sleeper_roster_id = p_roster and not autodraft;
  perform _draft_log(p_league_id, 'timeout', p_roster, null, p_overall, p_round, null,
    jsonb_build_object('autodraft', true));
  select m.app_user_id, l.name, l.is_mock into owner, nm, mock
    from league_membership m join league l on l.id = m.league_id
    where m.league_id = p_league_id and m.sleeper_roster_id = p_roster;
  if owner is not null and not coalesce(mock, false) then
    insert into push_outbox (app_user_id, kind, title, body, data, dedupe_key)
    values (owner, 'draft', '⛏ ' || coalesce(nm, 'your league'),
      'Your clock ran out on pick ' || p_overall || ' — autodraft is picking for you now. Open the room to take it back.',
      jsonb_build_object('league_id', p_league_id, 'open', 'draft'),
      'draft:' || p_league_id || ':timeout:' || p_roster || ':' || p_overall)
    on conflict (dedupe_key) do nothing;
  end if;
end $$;
revoke all on function _timeout_to_autodraft(uuid, int, int, int) from public, anon, authenticated;

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
      -- 0285: this is the moment a PERSON'S clock has just run out — the seat
      -- was live a line ago and the deadline is behind us. Flip it before the
      -- autopick, so the pick that follows is already an autodraft pick.
      if seat_is_live_human(p_league_id, oc) and d.deadline_at is not null and d.deadline_at <= now() then
        perform _timeout_to_autodraft(p_league_id, oc, d.current_overall, ((d.current_overall - 1) / n) + 1);
      end if;
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
