-- 0131: league-wide coin levers — grant to every team at once, or zero the lot.
--
-- The commissioner had exactly one coin write: commish_seed_coin, one team at a
-- time. Real adjustments are usually league-wide — "everyone gets 100 for the
-- playoffs", "reset the economy after the test week" — and doing that seat by
-- seat is 12 taps and 12 chances to typo. Two additions, both thin wrappers
-- over adjust_wallet so every move stays on the ledger and the
-- sum(delta) == team_wallet.coins invariant holds:
--
--   · commish_bulk_coin(league, amount) — signed, like commish_seed_coin:
--     positive grants, negative claws back, every seat in the league. Null
--     idem on purpose: each press is an intentional additive move, exactly
--     like the single-seat lever it generalizes.
--   · commish_clear_coin(league) — every wallet to exactly 0, by ledgering
--     the offsetting delta (never by UPDATE-ing coins, which would desync the
--     ledger). Rows are locked while read so a concurrent credit can't slip
--     between the read and the offset.
--
-- The weekly allowance needs nothing new: commish_set_weekly_budget +
-- commish_grant_weekly_budget (0052) already cover set-and-grant; the app just
-- didn't surface them outside the settings sheet.

create or replace function commish_bulk_coin(p_league_id uuid, p_amount numeric)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0; rid int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_amount is null or p_amount = 0 then return jsonb_build_object('ok', false, 'error', 'amount required'); end if;
  for rid in select distinct sleeper_roster_id from league_membership where league_id = p_league_id loop
    perform adjust_wallet(p_league_id, rid, null, null, p_amount, 'commish_bulk', null);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'teams', n, 'amount', p_amount);
end $$;
grant execute on function commish_bulk_coin(uuid, numeric) to authenticated;

create or replace function commish_clear_coin(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int := 0; w record;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  for w in select roster_id, coins from team_wallet
             where league_id = p_league_id and coins <> 0 for update loop
    perform adjust_wallet(p_league_id, w.roster_id, null, null, -w.coins, 'commish_clear', null);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'cleared', n);
end $$;
grant execute on function commish_clear_coin(uuid) to authenticated;
