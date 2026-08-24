-- 0225: the auction AI paces its wallet
--
-- Founder, from a Contract Test auction where all eight seats finished with
-- $0–6 and benches full of $1 players: "seems like there was a lot of big
-- spend by the AIs up front that biased the rest of the draft to just a
-- trickle of auction dollars. Is the AI overspending at the start?"
--
-- It was, structurally. resolve_lot_proxies handed ai_lot_willingness the
-- league's STARTING budget (d.budget), so an AI seat that had already spent
-- 80% of its money still priced a top player at ~34% of the full budget —
-- its only brake was the hard legality cap (remaining minus $1 a spot),
-- which is exactly the ramp every seat rode to $0. And since the value
-- curve sums to ~15× one budget across the pool, every seat was a
-- max-willingness bidder on every early lot: the second-price rule then
-- sold each star for "whatever the second-most-flush seat could legally
-- pay", an arms race by construction, followed by a $1 trickle once
-- everyone was dry.
--
-- The fix is the seat's own wallet: pass league_membership.draft_budget —
-- already decremented at every lot close, already joined in the candidate
-- CTE — so willingness is 34%-of-what-I-HAVE, not 34%-of-what-I-STARTED-
-- with. A seat that lands a star immediately becomes a bargain hunter
-- (34% + 34%·66% + … converges; it can never spend itself to zero on
-- stars), while untouched seats stay aggressive and keep mid-tier prices
-- honest. The ±15% per-seat jitter then produces genuinely different
-- builds — stars-and-scrubs next to balanced — instead of eight copies of
-- stars-and-scrubs. Everything else (second price, pos caps, human
-- proxies, the legality cap) is byte-identical to 0071.

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
          case when m.sleeper_roster_id <> lot.roster_id
                    and pos_cap_error(p_league_id, m.sleeper_roster_id, lot.slug, true) is not null then 0
               when seat_is_live_human(p_league_id, m.sleeper_roster_id)
            then coalesce((select px.max_amount from lot_proxy px
                           where px.lot_id = p_lot_id and px.roster_id = m.sleeper_roster_id), 0)
            else ai_lot_willingness(p_league_id, m.sleeper_roster_id, lot.slug, d.rounds,
                                    coalesce(m.draft_budget, d.budget)) end
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
    deadline = draft_deadline(d, d.lot_seconds)
    where id = p_lot_id;
  return true;
end $$;
