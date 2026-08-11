-- WHAT DID I ACTUALLY GET CHARGED FOR, AND WHAT DO I OWN.
--
-- WHY THIS EXISTS: "I bought a bunch of power-ups, the coin was subtracted but
-- they didn't show up in my hand." The hand renders `inventory`, which on a live
-- board is team_inventory read through my_inventory(). So the question is
-- narrow and answerable: was coin taken, and did team_inventory move with it.
--
-- There are two very different ways to be charged, and they leave DIFFERENT
-- traces — which is what makes this query decisive rather than suggestive:
--
--   REAL week (<= 100): spend_from_wallet → adjust_wallet → a coin_ledger row
--                       reading 'spend:<powerup_id>', and team_wallet drops.
--                       wallet_buy_powerup then calls bump_inventory, so
--                       team_inventory should hold the item.
--
--   PRACTICE week (> 100): spend_from_wallet debits practice_wallet DIRECTLY —
--                       no coin_ledger row at all — and wallet_buy_powerup
--                       RETURNS BEFORE bump_inventory. Coin moves, inventory
--                       does not, and nothing is written to the ledger.
--
-- So: charges in section 3 with matching rows in section 4 = working as built.
-- Practice_wallet drained in section 2 with nothing in section 4 and no ledger
-- rows = the practice path, where the purchase never grants an item.
--
-- Read-only. Set the league and roster below.

\set league_name 'Console Warriors%'
\set roster_id 1

-- ── 1. The real wallet ───────────────────────────────────────────────────────
select tw.roster_id, tw.coins as real_balance, tw.updated_at
from team_wallet tw
join league l on l.id = tw.league_id
where l.name like :'league_name' and tw.roster_id = :roster_id;

-- ── 2. Practice purses, per week ─────────────────────────────────────────────
-- One throwaway purse per practice week (> 100). A drained purse here with an
-- empty section 4 is the "charged but granted nothing" path.
select pw.week, pw.coins as practice_balance, pw.updated_at
from practice_wallet pw
join league l on l.id = pw.league_id
where l.name like :'league_name' and pw.roster_id = :roster_id
order by pw.week;

-- ── 3. Every real-wallet movement, newest first ──────────────────────────────
-- `reason` is 'spend:<powerup_id>' for a purchase, 'refund:…' for a give-back.
-- This is the authoritative list of what you were charged for. Practice spends
-- never appear here — that absence is itself a finding.
select cl.created_at, cl.week, cl.delta, cl.reason
from coin_ledger cl
join league l on l.id = cl.league_id
where l.name like :'league_name' and cl.roster_id = :roster_id
order by cl.created_at desc
limit 40;

-- ── 4. What the server thinks you own ────────────────────────────────────────
-- This is exactly what my_inventory() returns and what the hand renders. A
-- power-up charged in section 3 but missing here is the bug; a power-up here
-- that isn't in the hand is a client problem instead.
select ti.powerup_id, ti.qty, ti.updated_at
from team_inventory ti
join league l on l.id = ti.league_id
where l.name like :'league_name' and ti.roster_id = :roster_id
order by ti.qty desc, ti.powerup_id;

-- ── 5. Purchases vs holdings, side by side ───────────────────────────────────
-- The one-screen answer: per power-up, how many times you were charged for it
-- and how many you now hold. `charged` well above `held` is coin that bought
-- nothing (or items consumed by arming — check `armed` on the board).
select
  right(cl.reason, length(cl.reason) - 6)      as powerup_id,
  count(*)                                     as times_charged,
  -sum(cl.delta)                               as coin_spent,
  coalesce(max(ti.qty), 0)                     as held_now
from coin_ledger cl
join league l on l.id = cl.league_id
left join team_inventory ti
  on ti.league_id = cl.league_id and ti.roster_id = cl.roster_id
 and ti.powerup_id = right(cl.reason, length(cl.reason) - 6)
where l.name like :'league_name'
  and cl.roster_id = :roster_id
  and cl.reason like 'spend:%'
group by 1
order by coin_spent desc;
