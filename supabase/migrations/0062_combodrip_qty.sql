-- 0062: COMBO DRIP is one-for-one, PURCHASABLE MULTIPLE TIMES. 0061 read
-- "single-use" as a hard cap of one combodrip slot per lineup; the intended
-- rule is one slot PER UNLOCK PURCHASED — buy two (◎130) and you may field
-- two. The tight coin economy is the stack limiter (three slots = ◎195 ≈
-- three weeks of income), not a cap.
--
-- Model: applied_state.payload_json.unlockQty->>'unlock-combo-drip' holds the
-- number bought this week (the `unlocks` set still gates pickability; absent
-- qty with the flag set reads as 1, so rows armed before this migration keep
-- working). arm_unlock on combo-drip always buys ONE MORE (charge + qty+1);
-- disarm_unlock refunds one and clears any now-excess picks. The sealed_pick
-- trigger and the metric-swap path enforce picks ≤ qty.

create or replace function combo_qty(p_matchup_id uuid, p_user uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (payload_json->'unlockQty'->>'unlock-combo-drip')::int,
    case when (payload_json->'unlocks') ? 'unlock-combo-drip' then 1 else 0 end,
    0)
  from applied_state where matchup_id = p_matchup_id and app_user_id = p_user;
$$;

-- Trigger body v2 (same name/wiring as 0061): allow up to combo_qty picks.
create or replace function enforce_single_combodrip() returns trigger
  language plpgsql security definer set search_path = public as $$
declare have int; q int;
begin
  if new.metric_id is distinct from 'combodrip' then return new; end if;
  if tg_op = 'UPDATE' and new.metric_id is not distinct from old.metric_id then return new; end if;
  select count(*) into have from sealed_pick sp
    where sp.matchup_id = new.matchup_id and sp.app_user_id = new.app_user_id
      and sp.metric_id = 'combodrip' and sp.id is distinct from new.id;
  q := coalesce(combo_qty(new.matchup_id, new.app_user_id), 0);
  if have >= q then
    raise exception 'Combo Drip is one per unlock — you own %, buy another to field more', q
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- arm_unlock v3 (0026 body + combo quantity): arming combo-drip when already
-- armed buys ANOTHER (new charge, qty+1) instead of the free dup no-op.
create or replace function arm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; sp jsonb; price numeric; q int := 0;
begin
  if not is_live_unlock(p_unlock) then return jsonb_build_object('ok', false, 'error', 'unknown unlock'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
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

-- disarm_unlock v3: combo-drip disarms ONE at a time (refund one, qty-1); the
-- set flag clears at 0. Dependent picks are cleared only when they now exceed
-- the quantity (highest slots first). Other unlocks keep the 0026 behavior.
create or replace function disarm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; q int := 0; have int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
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
      perform credit_wallet(m.league_id, caller_roster(p_matchup_id), p_matchup_id, m.week,
        powerup_price(p_unlock), 'refund:' || p_unlock || ':' || extract(epoch from clock_timestamp())::text);
    end if;
    -- Clear only the EXCESS picks (highest window/slot first) so remaining
    -- purchases keep their picks.
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
    perform credit_wallet(m.league_id, caller_roster(p_matchup_id), p_matchup_id, m.week, powerup_price(p_unlock), 'refund:' || p_unlock || ':' || extract(epoch from clock_timestamp())::text);
  end if;
  update sealed_pick set metric_id = null
    where matchup_id = p_matchup_id and app_user_id = auth.uid()
      and locked_metric_unlock(metric_id) = p_unlock;
  return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur));
end $$;

-- apply_targeted v4: the swap-into-combodrip check counts against combo_qty
-- (sealed combodrip picks elsewhere + earlier swap targets < qty). Body
-- otherwise identical to 0061.
create or replace function apply_targeted(p_matchup_id uuid, p_powerup_id text, p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matchup%rowtype; t jsonb; entry jsonb; k text;
  v_win text; v_slot text; v_clock numeric; v_slug text; v_pts numeric;
  kick timestamptz; combo_have int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select coalesce(payload_json->'targeted', '{}'::jsonb) into t
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if t is null then t := '{}'::jsonb; end if;

  v_win  := p_payload->>'win';
  v_slot := p_payload->>'slot';

  if p_powerup_id = 'double-or-nothing' then
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    t := jsonb_set(t, '{don}', jsonb_build_object('win', v_win, 'slot', v_slot));

  elsif p_powerup_id = 'bye-steal' then
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    v_slug := p_payload->>'slug';
    v_pts  := least(greatest(coalesce((p_payload->>'pts')::numeric, 0), 0), 25);
    if v_win is null or v_slot is null or v_slug is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if not caller_pool_has(p_matchup_id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not your player'); end if;
    t := jsonb_set(t, '{byeSteal}', jsonb_build_object('win', v_win, 'slot', v_slot, 'slug', v_slug, 'pts', v_pts));

  elsif p_powerup_id = 'emp' then
    if m.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'not live'); end if;
    v_clock := least(greatest(coalesce((p_payload->>'clock')::numeric, 0), 0), 3900);
    if v_win is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    kick := window_kickoff(m.week, v_win);
    if kick is null or kick > now() then return jsonb_build_object('ok', false, 'error', 'window not live'); end if;
    if (t->'emp') ? v_win then return jsonb_build_object('ok', false, 'error', 'already fired'); end if;
    t := jsonb_set(t, '{emp}', coalesce(t->'emp', '{}'::jsonb) || jsonb_build_object(v_win, v_clock));

  elsif p_powerup_id in ('metric-swap', 'player-swap', 'mulligan') then
    if m.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'not live'); end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    kick := window_kickoff(m.week, v_win);
    if kick is null or kick > now() then return jsonb_build_object('ok', false, 'error', 'window not live'); end if;
    if not exists (select 1 from sealed_pick sp2 where sp2.matchup_id = p_matchup_id and sp2.app_user_id = auth.uid()
                     and sp2.game_window = v_win and sp2.roster_slot = v_slot and sp2.player_slug is not null) then
      return jsonb_build_object('ok', false, 'error', 'no pick at slot');
    end if;
    k := v_win || '|' || v_slot;
    if (t->'swaps') ? k then return jsonb_build_object('ok', false, 'error', 'already swapped'); end if;
    if p_powerup_id = 'player-swap' then
      v_slug := p_payload->>'toPlayer';
      if v_slug is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
      if not caller_pool_has(p_matchup_id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not your player'); end if;
      entry := jsonb_build_object('kind', p_powerup_id, 'toPlayer', v_slug);
    else
      if p_payload->>'toMetric' is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
      if locked_metric_unlock(p_payload->>'toMetric') is not null and not exists (
        select 1 from applied_state a where a.matchup_id = p_matchup_id and a.app_user_id = auth.uid()
          and (a.payload_json->'unlocks') ? locked_metric_unlock(p_payload->>'toMetric')
      ) then return jsonb_build_object('ok', false, 'error', 'metric locked'); end if;
      -- COMBO DRIP one-for-one: sealed combodrip picks elsewhere + earlier swap
      -- targets must stay under the purchased quantity.
      if p_payload->>'toMetric' = 'combodrip' then
        select (select count(*) from sealed_pick sp3
                 where sp3.matchup_id = p_matchup_id and sp3.app_user_id = auth.uid()
                   and sp3.metric_id = 'combodrip'
                   and not (sp3.game_window = v_win and sp3.roster_slot = v_slot))
             + (select count(*) from jsonb_each(coalesce(t->'swaps', '{}'::jsonb)) e
                 where e.value->>'toMetric' = 'combodrip')
          into combo_have;
        if combo_have >= coalesce(combo_qty(p_matchup_id, auth.uid()), 0) then
          return jsonb_build_object('ok', false, 'error', 'combo drip is one per unlock — buy another');
        end if;
      end if;
      entry := jsonb_build_object('kind', p_powerup_id, 'toMetric', p_payload->>'toMetric');
    end if;
    entry := entry
      || jsonb_build_object('atClock', least(greatest(coalesce((p_payload->>'atClock')::numeric, 0), 0), 3900))
      || case when p_payload ? 'atRt' then jsonb_build_object('atRt', (p_payload->>'atRt')::numeric) else '{}'::jsonb end;
    t := jsonb_set(t, '{swaps}', coalesce(t->'swaps', '{}'::jsonb) || jsonb_build_object(k, entry));

  else
    return jsonb_build_object('ok', false, 'error', 'not targetable');
  end if;

  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('targeted', t))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{targeted}', t), week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'targeted', t);
end $$;
grant execute on function apply_targeted(uuid, text, jsonb) to authenticated;
