-- ═══════════════════════════════════════════════════════════════════════════
-- 0455 · AN ALL-AUTODRAFT ROOM DRAFTS IN SECONDS AGAIN — AGAIN.
--
-- Founder, from a fresh classic league ("Test Wedding") with all eight seats
-- on autodraft: "Draft is pausing when everything is on auto", then "Something
-- up with the draft controls" — pick 8 at 0:00, and six minutes later only
-- pick 11, every pick waiting out its whole clock.
--
-- THE CAUSE is 0380's, back by another door. draft_tick makes up to 25
-- autodraft picks in one call, and the room calls it as the signed-in user,
-- whose statements Supabase cancels at 8 seconds — rolling back every pick in
-- the call. Reproduced on a fresh 8-team, 15-round classic draft (892-player
-- pool): the first call took 8.5 s, the second 4.7 s. Nearly all of it was
-- the autopick's "lineup before the bench" step (0377), which tests every
-- pool row against every open starting spot through the 6-argument
-- _autopick_spot_fits — 137,000 calls for 25 picks. That wrapper (0383) is
-- SECURITY DEFINER with its own search_path, so Postgres can never inline it,
-- and it always called _college_rule_ok (also definer) — 7.2 of the 9 seconds
-- went there, in a league with no college rules at all.
--
-- Before 0449 a league with no roster-builder spec skipped that step (no spec
-- → no open spots); 0449 gave every league its default lineup, so every such
-- league started paying it. The room's own tick failed silently (its catch
-- swallowed the timeout), so picks landed only when the worker's sweep or a
-- commissioner's FORCE PICK got there.
--
-- THE FIX
--   • _autopick_spot_fits (6 args) is a plain SQL function now — no definer,
--     no SET — so it inlines into the pick query, and it asks _college_rule_ok
--     only for a spot that HAS a conference or class rule. Same answers: the
--     5-argument test first, then the college rule exactly as 0383 defined it.
--     Its only callers are definer functions (the autopick), which run as the
--     owner, so nothing loses access. Same fresh draft: 8.5 s → 0.17 s per
--     25-pick call, and all 120 picks identical before and after.
--   • draft_tick also stops after 3 seconds of work, so however slow a pick
--     gets, no call can reach the 8-second limit again; the room polls every 3
--     seconds and the worker sweeps, so the draft keeps moving in batches.
--     Body otherwise 0380's.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _autopick_spot_fits(p_spot jsonb, p_pos text, p_level text, p_team text, p_exp int, p_slug text)
  returns boolean language sql stable as $$
  select case
    when not _autopick_spot_fits(p_spot, p_pos, p_level, p_team, p_exp) then false
    when coalesce(jsonb_array_length(case when jsonb_typeof(p_spot -> 'confs') = 'array' then p_spot -> 'confs' end), 0) = 0
     and coalesce(jsonb_array_length(case when jsonb_typeof(p_spot -> 'classes') = 'array' then p_spot -> 'classes' end), 0) = 0
      then true
    else _college_rule_ok(p_spot, p_slug)
  end
$$;
revoke all on function _autopick_spot_fits(jsonb, text, text, text, int, text) from public, anon, authenticated;

-- ── draft_tick — 0380's body, and a 3-second budget per call ──
create or replace function draft_tick(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d draft%rowtype; lot auction_lot%rowtype; oc int; pick text; made int := 0; r jsonb;
  n int; nom int; won int := 0; changed boolean;
  started timestamptz := clock_timestamp();   -- 0455
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
    -- 0380: 25 per call, not 200. One call is one transaction; a room of
    -- autodraft seats used to chain the whole draft into it, and a 120-pick
    -- draft ran past the 8-second statement limit a signed-in client gets —
    -- rolled back, pick after pick, so an all-auto room crawled. The room and
    -- the worker call again within seconds; each call now lands its picks.
    exit when made + won >= 25;
    -- 0455: and never more than ~3 seconds of work. The cap above counts
    -- picks; this counts time, which is what the 8-second limit counts. A
    -- pick that grows slow again shortens the batch instead of losing it.
    exit when clock_timestamp() - started > interval '3 seconds';
  end loop;
  return jsonb_build_object('ok', true, 'autopicks', made, 'lots_awarded', won);
end $$;
