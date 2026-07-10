-- 0087: UNDERDOG becomes a paid metric unlock (unlock-underdog, ◎35) — and it
-- stays pickable ANY TIME BEFORE KICKOFF. The §19 sweep showed the comeback
-- metric is a specialist gamble (fair on a player you expect to trail, a trap
-- on a stud) — exactly the profile of a Combo-Drip-style unlock, not a free
-- default. Timing: per-window seals already let a not-yet-kicked window's
-- metric change (enforce_window_lock rejects only kicked-off windows), so the
-- lock period is open server-side by construction; enforce_locked_metric just
-- needs to know underdog's unlock, and the shop needs its price.

-- Metric → unlock mapping (enforce_locked_metric + apply_targeted's swap check).
create or replace function locked_metric_unlock(p_metric text) returns text
  language sql immutable as $$
  select case p_metric
    when 'combodrip' then 'unlock-combo-drip'
    when 'retyd'     then 'unlock-return'
    when 'passbig'   then 'unlock-pass-td10'
    when 'underdog'  then 'unlock-underdog'
    else null end;
$$;

-- The metric unlocks a human may arm.
create or replace function is_live_unlock(p_unlock text) returns boolean
  language sql immutable as $$
  select p_unlock in ('unlock-combo-drip', 'unlock-return', 'unlock-pass-td10', 'unlock-underdog');
$$;

-- Price ◎35 (cheapest unlock — the sweep puts its intended-use EV at ~fair, so
-- it's priced as a drama pick, not an edge). Kept in lockstep with
-- src/data/powerups.ts by scripts/check-powerup-prices.mjs.
create or replace function powerup_price(p_id text) returns numeric language sql immutable as $$
  select case p_id
    -- whole-lineup buffs
    when 'momentum' then 70  when 'garbage-time' then 75 when 'floodgates' then 85
    when 'overtime' then 60  when 'ot-shield' then 70    when 'fg-stack' then 85
    when 'counter-nuke' then 95 when 'insurance' then 80
    when 'amp-2' then 40 when 'amp-3' then 60
    -- metric unlocks + slot purchases
    when 'unlock-combo-drip' then 65 when 'unlock-return' then 60 when 'unlock-pass-td10' then 40
    when 'unlock-underdog' then 35
    when 'unlock-carries-wipe' then 70
    when 'extra-slot' then 80
    -- flat-bonus arms
    when 'trick-play' then 90 when 'pick-six' then 45 when 'hail-mary' then 35
    when 'turnover-boost' then 55
    -- targeted pre-kickoff plays
    when 'double-or-nothing' then 80 when 'spy' then 40 when 'bye-steal' then 55 when 'ghost' then 75
    when 'rivalry' then 70
    when 'lead-change' then 45 when 'grudge' then 60 when 'jinx' then 55 when 'red-herring' then 90
    -- reactive / in-game
    when 'metric-swap' then 30 when 'player-swap' then 50 when 'mulligan' then 30
    when 'emp' then 65
    when 'surge' then 55 when 'cold-snap' then 60 when 'napalm' then 60 when 'bunker' then 65
    -- clutch (conditional, transient) plays
    when 'clutch-don' then 50 when 'clutch-encore' then 45 when 'clutch-counter' then 55
    else 9999 end;
$$;
