-- 0255: purchases are never blocked — only power-up USAGE is gated.
--
-- Founder, right after 0254 relaxed arm_unlock to final-only: "we shouldn't
-- ever block purchases, just power up usages." The principle, stated: coin is
-- the player's to spend, and the shop never second-guesses the timing; the
-- rules live where the power-up lands on the board.
--
-- So arm_unlock loses its status gate altogether. Arming a metric unlock is
-- the purchase — it grants pickability, changes nothing on the board by
-- itself, and never touches existing picks. The usage gates that actually
-- protect the game are untouched and sufficient:
--   · enforce_window_lock (0058) — no pick enters a window that has kicked off;
--   · enforce_locked_metric (0024) — no pick carries a metric that isn't armed;
--   · apply/arm paths for buffs and the extra slot keep their own timing rules,
--     because those DO mutate the live board (the extra slot restructures every
--     window for both players — its card says pre-match, and that is a usage
--     rule, not a shop rule).
-- Arming with the matchup already final buys nothing useful; that is the
-- buyer's call, exactly like any other late purchase (wallet_buy_powerup has
-- never gated on status).
--
-- Body is 0254's with the status gate removed.

create or replace function arm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; sp jsonb; price numeric; q int := 0;
begin
  if not is_live_unlock(p_unlock) then return jsonb_build_object('ok', false, 'error', 'unknown unlock'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(array(select jsonb_array_elements_text(payload_json->'unlocks')), '{}') into cur
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if p_unlock = any(cur) and p_unlock <> 'unlock-combo-drip' then
    return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur), 'dup', true);
  end if;

  rid := caller_roster(p_matchup_id);
  price := powerup_price(p_unlock);
  sp := spend_from_wallet(m.league_id, rid, price, p_matchup_id, m.week, 'spend:' || p_unlock, null);
  if not (sp->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', sp->'balance', 'price', price);
  end if;

  if not (p_unlock = any(cur)) then cur := cur || p_unlock; end if;
  q := case when p_unlock = 'unlock-combo-drip' then coalesce(combo_qty(p_matchup_id, auth.uid()), 0) + 1 else 0 end;
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week,
      jsonb_build_object('unlocks', to_jsonb(cur))
      || case when q > 0 then jsonb_build_object('unlockQty', jsonb_build_object('unlock-combo-drip', q)) else '{}'::jsonb end)
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(
          case when q > 0
            then jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{unlockQty}',
                   coalesce(applied_state.payload_json->'unlockQty', '{}'::jsonb) || jsonb_build_object('unlock-combo-drip', q))
            else coalesce(applied_state.payload_json, '{}'::jsonb) end,
          '{unlocks}', to_jsonb(cur)),
        week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur), 'comboQty', q, 'charged', price);
end $$;
grant execute on function arm_unlock(uuid, text) to authenticated;
