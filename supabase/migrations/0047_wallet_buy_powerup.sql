-- 0047: the hero board buys power-ups against the REAL team wallet. Charges
-- powerup_price from the caller's team wallet for a matchup (interactive, so no
-- idem key). The owned item lives in the client's local inventory; this call only
-- moves coin. Mirrors buy_extra_slot's guards (participant + priced powerup).
create or replace function wallet_buy_powerup(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; rid int; price numeric; sp jsonb; bal numeric;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  rid := caller_roster(p_matchup_id);
  price := powerup_price(p_powerup_id);
  if price >= 9999 then return jsonb_build_object('ok', false, 'error', 'unknown powerup'); end if;
  sp := spend_from_wallet(m.league_id, rid, price, p_matchup_id, m.week, 'spend:' || p_powerup_id, null);
  if not (sp->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', coalesce(sp->'balance', to_jsonb(0)), 'price', price);
  end if;
  select coins into bal from team_wallet where league_id = m.league_id and roster_id = rid;
  return jsonb_build_object('ok', true, 'balance', coalesce(bal, 0), 'charged', price);
end $$;
grant execute on function wallet_buy_powerup(uuid, text) to authenticated;
