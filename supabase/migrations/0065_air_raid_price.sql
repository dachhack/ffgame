-- 0065: AIR RAID REPRICE ◎60 → ◎40. The first-buy variety probe (findings §15)
-- measured Air Raid at +7.0 margin lift vs the amplifiers' +14.6-16.6 — at ◎60
-- that is 1.17 pts/◎10 against the amps' 2.0-2.5, a dead buy. At ◎40 it reaches
-- 1.75 pts/◎10: a real conditional alternative (elite-QB rosters) without
-- touching its scoring. Kept in lockstep with src/data/powerups.ts by
-- scripts/check-powerup-prices.mjs.
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
    -- reactive / in-game
    when 'metric-swap' then 30 when 'player-swap' then 50 when 'mulligan' then 30
    when 'emp' then 65
    else 9999 end;
$$;
