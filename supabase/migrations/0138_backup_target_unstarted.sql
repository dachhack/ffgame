-- 0138: clobber the backup-routing loophole — a backup may only be assigned to
-- a starter whose game HASN'T STARTED.
--
-- 0137 made reassignment real, and the founder spotted the exploit inside the
-- hour: with targets in already-started games you could watch the slate and
-- route your backup with hindsight — onto the starter who's struggling, away
-- from the one who's cooking. The whole lock system exists to prevent exactly
-- that information edge; assignments must commit BLIND, like picks do.
--
-- The gate is at WRITE time, window-kickoff granularity — the same authority
-- and the same granularity as enforce_window_lock (window_kickoff = the
-- window's first kickoff, so a started window refuses wholesale: conservative,
-- never hindsight). Assignments made before the target kicked stay valid and
-- still score — you committed before you knew. Clearing back to auto is always
-- allowed: it hands the choice to the deterministic maximizer, which is
-- choice-free and therefore edge-free. A window with no slate loaded can't be
-- judged and is allowed; the engine's outscore-or-nothing rule still gates the
-- actual sub.
create or replace function set_backup_assign(p_matchup_id uuid, p_backup_key text, p_target_key text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; t jsonb; b jsonb; kick timestamptz;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if m.status = 'final' then return jsonb_build_object('ok', false, 'error', 'matchup is final'); end if;
  if p_backup_key is null or p_backup_key !~ '^[a-z0-9_-]+#[0-9]+$' then
    return jsonb_build_object('ok', false, 'error', 'bad backup key');
  end if;
  if p_target_key is not null then
    if p_target_key !~ '^[a-z0-9_-]+#[0-9]+$' then
      return jsonb_build_object('ok', false, 'error', 'bad target key');
    end if;
    kick := window_kickoff(m.week, split_part(p_target_key, '#', 1));
    if kick is not null and kick <= now() then
      return jsonb_build_object('ok', false, 'error', 'that game already started — backups commit blind');
    end if;
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
