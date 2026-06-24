-- 0024: locked-metric ownership (M2). A handful of metrics are "locked" in the
-- catalog (Combo Drip, Return Yards, Air Raid) — they may only be picked once the
-- matching power-up is armed. Clients write sealed_pick directly under RLS, so the
-- gate must live in a TRIGGER on that table, not just an RPC. Unlocks are armed
-- into the same applied_state.payload_json used for buffs, as { "unlocks": [...] }.
-- Free this season (no coin yet) — arming is purely the ownership gate; a later
-- milestone charges coin and consumes inventory.

-- Locked metric_id → the power-up that unlocks it. Mirrors LOCKED_METRIC_UNLOCK in
-- src/data/metrics.ts (itself derived from the catalog `lock:` fields). Kept in
-- lockstep by scripts/check-locked-metrics.mjs.
create or replace function locked_metric_unlock(p_metric text) returns text
  language sql immutable as $$
  select case p_metric
    when 'combodrip' then 'unlock-combo-drip'
    when 'retyd'     then 'unlock-return'
    when 'passbig'   then 'unlock-pass-td10'
    else null end;
$$;

-- The metric unlocks a human may arm (the three locked metrics above).
create or replace function is_live_unlock(p_unlock text) returns boolean
  language sql immutable as $$
  select p_unlock in ('unlock-combo-drip', 'unlock-return', 'unlock-pass-td10');
$$;

-- Reject a sealed pick on a locked metric unless its unlock is armed for that
-- user+matchup. Only validates when the metric is being SET or CHANGED, so the
-- server's lock flip (locked=true, metric unchanged) and unrelated column edits
-- pass through untouched.
create or replace function enforce_locked_metric() returns trigger
  language plpgsql security definer set search_path = public as $$
declare need text;
begin
  if tg_op = 'UPDATE' and new.metric_id is not distinct from old.metric_id then
    return new;
  end if;
  need := locked_metric_unlock(new.metric_id);
  if need is null then return new; end if;
  if not exists (
    select 1 from applied_state
    where matchup_id = new.matchup_id and app_user_id = new.app_user_id
      and (payload_json->'unlocks') ? need
  ) then
    raise exception 'metric % needs the % power-up armed first', new.metric_id, need
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists enforce_locked_metric on sealed_pick;
create trigger enforce_locked_metric before insert or update on sealed_pick
  for each row execute function enforce_locked_metric();

-- Arm one metric unlock for the caller (self-serve, pre-lock, participants only).
-- Idempotent. Stored in applied_state.payload_json.unlocks (alongside buffs).
create or replace function arm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[];
begin
  if not is_live_unlock(p_unlock) then return jsonb_build_object('ok', false, 'error', 'unknown unlock'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select coalesce(array(select jsonb_array_elements_text(payload_json->'unlocks')), '{}')
    into cur from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if not (p_unlock = any(cur)) then cur := cur || p_unlock; end if;

  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('unlocks', to_jsonb(cur)))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{unlocks}', to_jsonb(cur)),
        week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur));
end $$;

-- Disarm one unlock. Also clears any of the caller's sealed picks that depended
-- on it (resets metric_id to null), so a pick can't outlive its unlock. Pre-lock.
create or replace function disarm_unlock(p_matchup_id uuid, p_unlock text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[];
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select coalesce(array(select jsonb_array_elements_text(payload_json->'unlocks')), '{}')
    into cur from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  cur := array_remove(cur, p_unlock);
  update applied_state
    set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{unlocks}', to_jsonb(cur)), updated_at = now()
    where matchup_id = p_matchup_id and app_user_id = auth.uid();
  -- Drop dependent picks so none survives without its unlock.
  update sealed_pick set metric_id = null
    where matchup_id = p_matchup_id and app_user_id = auth.uid()
      and locked_metric_unlock(metric_id) = p_unlock;
  return jsonb_build_object('ok', true, 'unlocks', to_jsonb(cur));
end $$;

-- The caller's own armed unlocks for a matchup (drives the LivePicks UI: which
-- locked metrics to surface in the per-slot dropdowns).
create or replace function my_unlocks(p_matchup_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(payload_json->'unlocks', '[]'::jsonb)
  from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
$$;

grant execute on function locked_metric_unlock(text) to authenticated;
grant execute on function is_live_unlock(text) to authenticated;
grant execute on function arm_unlock(uuid, text) to authenticated;
grant execute on function disarm_unlock(uuid, text) to authenticated;
grant execute on function my_unlocks(uuid) to authenticated;
