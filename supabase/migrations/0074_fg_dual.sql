-- 0074: DUAL THREAT (fg-dual, ◎40) — a pre-kickoff arm that counts the Field
-- General QB's RUSHING yards toward the window multiplier alongside passing
-- yards. Priced from the fg-study Dual Threat arm: +9.3 avg pts for a true
-- scrambler week (40+ rush yds, full drip cast) ≈ 2.3 pts/◎10 — in line with
-- the amplifiers' 2.0-2.5 — and near-zero (+0.3) under a pocket passer, so
-- it's a conditional read, not an auto-buy. The engine reads it as
-- windowFgMult({ combo }) via buffs.has('fg-dual'); kept in lockstep with
-- src/data/powerups.ts by scripts/check-powerup-prices.mjs.

-- is_live_buff v3 (0063 list + fg-dual): armable in-slot buffs the live
-- resolver understands.
create or replace function is_live_buff(p_buff text) returns boolean
  language sql immutable as $$
  select p_buff in (
    'overtime', 'ot-shield', 'momentum', 'garbage-time',
    'floodgates', 'counter-nuke', 'insurance', 'fg-stack', 'fg-dual',
    'amp-2', 'amp-3'
  );
$$;

-- Full price list (0065 + fg-dual ◎40).
create or replace function powerup_price(p_id text) returns numeric language sql immutable as $$
  select case p_id
    -- whole-lineup buffs
    when 'momentum' then 70  when 'garbage-time' then 75 when 'floodgates' then 85
    when 'overtime' then 60  when 'ot-shield' then 70    when 'fg-stack' then 85
    when 'fg-dual' then 40
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
