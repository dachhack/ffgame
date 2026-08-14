-- 0137: backup assignments become REAL — server-held, worker-scored.
--
-- The founder assigned a backup on one device and another device didn't show
-- it. The investigation found three layers, each worse than the last:
--   1. Assignments synced through hero_applied, whose RLS accepts writes only
--      while the matchup is 'scheduled' — but backups are assigned AT LOCK by
--      design (the prompt fires when the window kicks), so every post-lock
--      assignment was refused by the DB and silently swallowed by the client.
--   2. Each device therefore kept its own localStorage copy.
--   3. And none of it mattered anyway: the worker's resolver auto-maximizes
--      backups and never read assignments at all, while the client engine
--      treated unassigned backups as scoring 0 — two resolvers, two answers.
--
-- The founder's ruling on the mechanic: AUTO at lock (the system subs the
-- best backup and says so), then the manager may REASSIGN — and the
-- reassignment must count. This migration is the server half: assignments
-- live in applied_state.payload_json.targeted.backups, the same store the
-- worker already loads per side, writable while the matchup is scheduled OR
-- live (reassignment is a mid-window act; only 'final' refuses).
--
-- Keys are the engine's slot keys ("win#slot" for both ends): backup slot →
-- the starter slot it should sub for. A null target clears the assignment,
-- returning that backup to the auto pass.
create or replace function set_backup_assign(p_matchup_id uuid, p_backup_key text, p_target_key text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; t jsonb; b jsonb;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if m.status = 'final' then return jsonb_build_object('ok', false, 'error', 'matchup is final'); end if;
  if p_backup_key is null or p_backup_key !~ '^[a-z0-9_-]+#[0-9]+$' then
    return jsonb_build_object('ok', false, 'error', 'bad backup key');
  end if;
  if p_target_key is not null and p_target_key !~ '^[a-z0-9_-]+#[0-9]+$' then
    return jsonb_build_object('ok', false, 'error', 'bad target key');
  end if;

  select coalesce(payload_json->'targeted', '{}'::jsonb) into t
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if t is null then t := '{}'::jsonb; end if;
  b := coalesce(t->'backups', '{}'::jsonb);
  if p_target_key is null then b := b - p_backup_key;
  else b := b || jsonb_build_object(p_backup_key, p_target_key);
  end if;
  t := jsonb_set(t, '{backups}', b);

  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('targeted', t))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{targeted}', t), week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'backups', b);
end $$;
grant execute on function set_backup_assign(uuid, text, text) to authenticated;
