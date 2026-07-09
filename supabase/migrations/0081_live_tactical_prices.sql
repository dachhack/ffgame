-- 0081: prices for the three live tactical power-ups — Surge (◎55), Cold Snap
-- (◎60), Bunker (◎65). Fired mid-window, reacting to the live state:
--   • surge     — your slot scores ×2 for the next 10 game-minutes.
--   • cold-snap — freeze ALL of an opponent slot's scoring for 10 game-minutes.
--   • bunker    — your slot goes nuke/erase-immune for the rest of the game.
-- Kept in lockstep with src/data/powerups.ts by scripts/check-powerup-prices.mjs.
create or replace function powerup_price(p_id text) returns numeric language sql immutable as $$
  select case p_id
    -- whole-lineup buffs
    when 'momentum' then 70  when 'garbage-time' then 75 when 'floodgates' then 85
    when 'overtime' then 60  when 'ot-shield' then 70    when 'fg-stack' then 85
    when 'counter-nuke' then 95 when 'insurance' then 80
    when 'amp-2' then 40 when 'amp-3' then 60
    -- metric unlocks + slot purchases
    when 'unlock-combo-drip' then 65 when 'unlock-return' then 60 when 'unlock-pass-td10' then 40
    when 'unlock-carries-wipe' then 70
    when 'extra-slot' then 80
    -- flat-bonus arms
    when 'trick-play' then 90 when 'pick-six' then 45 when 'hail-mary' then 35
    when 'turnover-boost' then 55
    -- targeted pre-kickoff plays
    when 'double-or-nothing' then 80 when 'spy' then 40 when 'bye-steal' then 55
    when 'rivalry' then 70
    when 'lead-change' then 45 when 'grudge' then 60 when 'jinx' then 55 when 'red-herring' then 90
    -- reactive / in-game
    when 'metric-swap' then 30 when 'player-swap' then 50 when 'mulligan' then 30
    when 'emp' then 65
    when 'surge' then 55 when 'cold-snap' then 60 when 'bunker' then 65
    else 9999 end;
$$;
