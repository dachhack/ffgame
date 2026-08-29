-- 0256: metric unlocks are cards — buy to the hand, use from the picker.
--
-- Founder, catching v0.370.3's shop arming his Return Yards on the spot:
-- "ah. it armed it immediately. Let's not do that. Purchase goes to your power
-- up hand and then when you can use it is gated. Nothing expires. No refunds.
-- Maybe just a confirm before you use the power up."
--
-- So unlocks stop being a special shop mechanism and become what every other
-- power-up already is:
--   · BUY  — wallet_buy_powerup, unchanged: coin out, one card into the week's
--     inventory (team_inventory, or the practice purse on a practice week).
--     Cards never expire; the shop never blocks a purchase (0255).
--   · USE  — arm_unlock now consumes ONE OWNED CARD instead of spending coin:
--     no card, no arm ('not owned'). Arming grants the metric for the current
--     week (that has always been the unlock's effect); the clients put a
--     confirm in front of this, in the metric picker where the intent lives.
--     The one usage gate kept: a FINAL matchup refuses ('locked') — consuming
--     a card with nothing left to field it on protects the player, and usage
--     gating is exactly what the founder kept.
--   · NO REFUNDS — disarm_unlock stops crediting coin. It still exists for the
--     pre-week window (it edits sealed picks, which 0058 forbids mid-week) and
--     hands the CARD back instead — un-using, not refunding — so an older app
--     build that still shows a DISARM button can't strand or mint value.
--
-- The 0248 refund-proof invariant gets stronger, not weaker: with no
-- 'spend:<unlock>' ledger rows written on arm, there is no coin on the table
-- for any refund path to return.

create or replace function arm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; owned int; q int := 0;
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
  -- Consume one owned card (row locked so two taps can't split one card).
  if is_practice_week(m.week) then
    select qty into owned from practice_inventory
      where league_id = m.league_id and roster_id = rid and week = m.week and powerup_id = p_unlock for update;
  else
    select qty into owned from team_inventory
      where league_id = m.league_id and roster_id = rid and powerup_id = p_unlock for update;
  end if;
  if coalesce(owned, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'not owned', 'owned', 0);
  end if;
  if is_practice_week(m.week) then
    perform bump_practice_inventory(m.league_id, rid, m.week, p_unlock, -1);
  else
    perform bump_inventory(m.league_id, rid, p_unlock, -1);
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
  return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur), 'comboQty', q, 'used', p_unlock);
end $$;
grant execute on function arm_unlock(uuid, text) to authenticated;

create or replace function disarm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; q int := 0; have int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  rid := caller_roster(p_matchup_id);
  select coalesce(array(select jsonb_array_elements_text(payload_json->'unlocks')), '{}') into cur
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;

  if p_unlock = 'unlock-combo-drip' then
    q := coalesce(combo_qty(p_matchup_id, auth.uid()), 0);
    if q > 0 then
      q := q - 1;
      if q = 0 then cur := array_remove(cur, p_unlock); end if;
      update applied_state set payload_json = jsonb_set(
          jsonb_set(coalesce(payload_json, '{}'::jsonb), '{unlockQty}',
            coalesce(payload_json->'unlockQty', '{}'::jsonb) || jsonb_build_object('unlock-combo-drip', q)),
          '{unlocks}', to_jsonb(cur)), updated_at = now()
        where matchup_id = p_matchup_id and app_user_id = auth.uid();
      -- The card comes back; coin never does (0256).
      if is_practice_week(m.week) then perform bump_practice_inventory(m.league_id, rid, m.week, p_unlock, 1);
      else perform bump_inventory(m.league_id, rid, p_unlock, 1); end if;
    end if;
    select count(*) into have from sealed_pick
      where matchup_id = p_matchup_id and app_user_id = auth.uid() and metric_id = 'combodrip';
    if have > q then
      update sealed_pick set metric_id = null
        where id in (
          select id from sealed_pick
          where matchup_id = p_matchup_id and app_user_id = auth.uid() and metric_id = 'combodrip'
          order by game_window desc, roster_slot desc limit (have - q));
    end if;
    return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur), 'comboQty', q);
  end if;

  if p_unlock = any(cur) then
    cur := array_remove(cur, p_unlock);
    update applied_state set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{unlocks}', to_jsonb(cur)), updated_at = now()
      where matchup_id = p_matchup_id and app_user_id = auth.uid();
    if is_practice_week(m.week) then perform bump_practice_inventory(m.league_id, rid, m.week, p_unlock, 1);
    else perform bump_inventory(m.league_id, rid, p_unlock, 1); end if;
  end if;
  update sealed_pick set metric_id = null
    where matchup_id = p_matchup_id and app_user_id = auth.uid()
      and locked_metric_unlock(metric_id) = p_unlock;
  return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur));
end $$;
grant execute on function disarm_unlock(uuid, text) to authenticated;
