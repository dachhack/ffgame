-- 0049: the hero board persists ARMED BUFFS server-side (applied_state.buffs) so
-- they survive reload + carry across devices, and the worker scores them. Unlike
-- arm_buff, this does NOT charge the wallet — the buff was already paid for when
-- bought into inventory (team_inventory). Overwrites the whole buff set
-- (idempotent); self-only, pre-lock (mirrors the applied_self_write policy).
create or replace function hero_set_buffs(p_matchup_id uuid, p_buffs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('buffs', coalesce(p_buffs, '[]'::jsonb)))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{buffs}', coalesce(p_buffs, '[]'::jsonb)),
        week = m.week, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
grant execute on function hero_set_buffs(uuid, jsonb) to authenticated;
