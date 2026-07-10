-- 0046: real leagues start at 0 drip coin (was 100), and the commissioner seeds
-- coin to each team. The board's coin economy (display + spend) uses the DB
-- team_wallet; this makes the season-start balance 0 and gives commissioners a
-- server-authoritative way to grant coin. All mutation goes through adjust_wallet
-- (atomic ledger + balance), so the wallet==sum(ledger) invariant holds.

-- Season-start balance → 0. wallet_seed() is the single source of truth (used by
-- ensure_wallet for humans and the worker's AI budget pass). Existing wallets keep
-- their balance (the idempotent 'seed' credit isn't re-run).
create or replace function wallet_seed() returns numeric language sql immutable as $$ select 0::numeric $$;

-- Commissioner/admin grants coin to a team (additive; negative to claw back).
create or replace function commish_seed_coin(p_league_id uuid, p_roster_id int, p_amount numeric)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_amount is null or p_amount = 0 then return jsonb_build_object('ok', false, 'error', 'amount required'); end if;
  -- null idem → always applies (each grant is additive, not deduped).
  perform adjust_wallet(p_league_id, p_roster_id, null, null, p_amount, 'commish_seed', null);
  select coins into bal from team_wallet where league_id = p_league_id and roster_id = p_roster_id;
  return jsonb_build_object('ok', true, 'balance', coalesce(bal, 0));
end $$;
grant execute on function commish_seed_coin(uuid, int, numeric) to authenticated;

-- Admin/commish: every team's current coin balance (feeds the seed UI).
create or replace function admin_league_wallets(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('roster_id', roster_id, 'coins', coins) order by roster_id), '[]'::jsonb)
    into result from team_wallet where league_id = p_league_id;
  return result;
end $$;
grant execute on function admin_league_wallets(uuid) to authenticated;
