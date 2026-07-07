-- 0061: COMBO DRIP is SINGLE-USE — one combodrip slot per lineup per week.
-- The catalog blurb always said "unlock a Rush + Receiving combo drip for ONE
-- player", but enforcement was a boolean unlock: own it once, field it on as
-- many players as you like. That stack is the hindsight adversary's #1 exploit
-- line (findings §3). The engine now downgrades extras at resolve
-- (resolveLiveMatchup/buildMatchup) and the AI keeps only its best dual-threat;
-- this migration closes the write path: a second combodrip sealed pick is
-- rejected, and a live metric-swap/mulligan INTO combodrip is rejected when
-- another slot already runs it.

create or replace function enforce_single_combodrip() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.metric_id is distinct from 'combodrip' then return new; end if;
  if tg_op = 'UPDATE' and new.metric_id is not distinct from old.metric_id then return new; end if;
  if exists (
    select 1 from sealed_pick sp
    where sp.matchup_id = new.matchup_id and sp.app_user_id = new.app_user_id
      and sp.metric_id = 'combodrip' and sp.id is distinct from new.id
  ) then
    raise exception 'Combo Drip is single-use — one slot per lineup'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists enforce_single_combodrip on sealed_pick;
create trigger enforce_single_combodrip before insert or update on sealed_pick
  for each row execute function enforce_single_combodrip();

-- apply_targeted v2 (0060 + the single-combodrip check on metric swaps): a swap
-- or mulligan to combodrip is rejected when ANOTHER slot already runs it — as a
-- sealed pick or as an earlier swap target (re-picking the combo slot's own
-- metric is fine). Body otherwise identical to 0060.
create or replace function apply_targeted(p_matchup_id uuid, p_powerup_id text, p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matchup%rowtype; t jsonb; entry jsonb; k text;
  v_win text; v_slot text; v_clock numeric; v_slug text; v_pts numeric;
  kick timestamptz;
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
      -- COMBO DRIP single-use: reject a swap into combodrip when another slot
      -- already runs it (sealed) or an earlier swap already targets it.
      if p_payload->>'toMetric' = 'combodrip' and (
        exists (
          select 1 from sealed_pick sp3
          where sp3.matchup_id = p_matchup_id and sp3.app_user_id = auth.uid()
            and sp3.metric_id = 'combodrip'
            and not (sp3.game_window = v_win and sp3.roster_slot = v_slot)
        )
        or exists (
          select 1 from jsonb_each(coalesce(t->'swaps', '{}'::jsonb)) e
          where e.value->>'toMetric' = 'combodrip'
        )
      ) then return jsonb_build_object('ok', false, 'error', 'combo drip is single-use'); end if;
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
