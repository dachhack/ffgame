-- ═══════════════════════════════════════════════════════════════════════════
-- 0524 · REFUND THE MISCLICKED JINX (v0.733.2)
--
-- Weekly Cointest, week 7, seat 3: "Some of the descriptions are too long and
-- when I tapped to try and see if it opened up to see more it bought it
-- immediately so now I have two power ups of something I was just trying to
-- see what the power ups was." ops 083: two buy:jinx rows three seconds apart
-- (coin_ledger 5194066 at 01:07:54 UTC, 5194067 at 01:07:57), ◈55 each; the
-- hand holds 2 Jinx, the wallet ◈5. Founder: "Refund him for the power up."
--
-- The second buy is refunded: ◈55 back through adjust_wallet (reason
-- 'refund', its own idem key, so a re-run is a no-op) and one Jinx out of the
-- hand. Only while that purchase row exists and a Jinx is still in the hand:
-- if he has played it since, the refund would leave him the card AND the coin,
-- so it stands down and says so. v0.733.2's shop asks for a second tap.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare lid uuid := '5551fed6-ba4f-42e7-8326-3fe65c18c6c5'; rid int := 3; held int; done_ boolean;
begin
  if not exists (select 1 from coin_ledger where id = 5194067 and league_id = lid and roster_id = rid
                   and reason = 'buy:jinx' and delta = -55) then
    raise notice '0524: the misclicked Jinx purchase is not there — nothing changed'; return;
  end if;
  select qty into held from team_inventory where league_id = lid and roster_id = rid and powerup_id = 'jinx';
  if coalesce(held, 0) < 1 then
    raise notice '0524: no Jinx left in the hand (played?) — nothing changed'; return;
  end if;
  done_ := adjust_wallet(lid, rid, null, 7, 55, 'refund', 'refund:misclick:5194067');
  if not done_ then
    raise notice '0524: already refunded — nothing changed'; return;
  end if;
  perform bump_inventory(lid, rid, 'jinx', -1);
  raise notice '0524: refunded ◈55 and took back one Jinx (hand % → %)', held, held - 1;
end $$;
