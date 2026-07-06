-- 0059: price EVERY cataloged power-up server-side. powerup_price() (0026) only
-- listed the whole-lineup buffs, the metric unlocks, and extra-slot; the other
-- 12 catalog items (the reactive/live tools, the targeted plays, the flat-bonus
-- arms) fell to the `else 9999` default — so wallet_buy_powerup rejected them as
-- 'unknown powerup' while the shop showed a price. The client catalog
-- (src/data/powerups.ts) is the source of truth for the numbers;
-- scripts/check-powerup-prices.mjs keeps the two in lockstep (and now also
-- fails on OMISSIONS, which is how this gap slipped by).
create or replace function powerup_price(p_id text) returns numeric language sql immutable as $$
  select case p_id
    -- whole-lineup buffs
    when 'momentum' then 70  when 'garbage-time' then 75 when 'floodgates' then 85
    when 'overtime' then 60  when 'ot-shield' then 70    when 'fg-stack' then 85
    when 'counter-nuke' then 95 when 'insurance' then 80
    -- metric unlocks + slot purchases
    when 'unlock-combo-drip' then 65 when 'unlock-return' then 60 when 'unlock-pass-td10' then 60
    when 'unlock-carries-wipe' then 70
    when 'extra-slot' then 80
    -- flat-bonus arms
    when 'trick-play' then 90 when 'pick-six' then 45 when 'hail-mary' then 35
    when 'turnover-boost' then 55
    -- targeted pre-kickoff plays
    when 'double-or-nothing' then 80 when 'spy' then 40 when 'bye-steal' then 55
    -- reactive / in-game
    when 'metric-swap' then 30 when 'player-swap' then 50 when 'mulligan' then 30
    when 'emp' then 65
    else 9999 end;
$$;
