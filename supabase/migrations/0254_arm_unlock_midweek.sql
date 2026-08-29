-- 0254: metric unlocks can be bought mid-week — the shop honors late swap.
--
-- Founder, PRE 4, Friday, 645 practice coin in hand: "I can't buy anything
-- 'metric - 1 week'." Every METRIC · 1 WK card refused with 'locked'.
--
-- arm_unlock still carried the pre-0058 whole-week gate: refuse unless
-- matchup.status = 'scheduled', i.e. the shop closed at the week's FIRST
-- kickoff. But 0058 made picks per-window ("late swap"): a Sunday or Monday
-- slot is editable until ITS window kicks off, so arming Return Yards on
-- Friday for a Saturday window is exactly the play the rulebook promises —
-- and the save gate (enforce_locked_metric) would accept the pick if only
-- the shop would sell the unlock.
--
-- The gate becomes: refuse only a FINAL matchup. Window integrity needs no
-- week-level shop gate — 0058's enforce_window_lock trigger already rejects
-- any pick for a window that has kicked off, and arming an unlock never
-- touches existing picks (locked rows passed the metric gate when they were
-- saved). Buying with every window already underway wastes coin the same way
-- any late inventory buy does; that is the buyer's call, not the shop's.
--
-- Body is 0062's, gate line only changed.

create or replace function arm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; sp jsonb; price numeric; q int := 0;
begin
  if not is_live_unlock(p_unlock) then return jsonb_build_object('ok', false, 'error', 'unknown unlock'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status = 'final' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
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
