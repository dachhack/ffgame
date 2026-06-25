-- 0023: live power-up loadout (M1) — let a manager ARM the in-slot team buffs the
-- live resolver already understands, so they finally fire in real H2H games
-- (until now liveResolve never passed buffs to resolveSlot). Buffs persist in the
-- pre-existing applied_state.payload_json as { "buffs": ["overtime", ...] }. No
-- coin cost yet — the spendable wallet/economy lands in a later milestone.
--
-- In scope: the buffs resolveSlot + windowFgMult read per slot. Out of scope:
-- swaps, EMP, extra-slot, unlocks (their own milestones).

-- Allow-list of armable in-slot buffs — keep in lockstep with the engine
-- (src/engine/sim.ts youBuffs/theirBuffs + windowFgMult carryOT/stack). arm_buff
-- rejects anything the live engine would silently ignore.
create or replace function is_live_buff(p_buff text) returns boolean
  language sql immutable as $$
  select p_buff in (
    'overtime', 'ot-shield', 'momentum', 'garbage-time',
    'floodgates', 'counter-nuke', 'insurance', 'fg-stack'
  );
$$;

-- Tighten applied_state writes: self-only AND only before the matchup locks
-- (status='scheduled'). The old policy let you write your row any time; combined
-- with the post-lock read policy that would let a manager read the opponent's
-- revealed buffs after lock and THEN change their own — the very exploit the
-- sealed_pick policy guards against. (The arm RPCs below are SECURITY DEFINER and
-- enforce the same gate; this is defense-in-depth for any direct table write.)
drop policy if exists applied_self_write on applied_state;
create policy applied_self_write on applied_state
  for all
  using (app_user_id = auth.uid())
  with check (
    app_user_id = auth.uid()
    and exists (select 1 from matchup m where m.id = applied_state.matchup_id and m.status = 'scheduled')
  );

-- Arm one in-slot buff for the caller in a matchup. Self-serve, pre-lock only,
-- participants only. Idempotent (re-arming is a no-op). Returns the new buff set.
create or replace function arm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[];
begin
  if not is_live_buff(p_buff) then return jsonb_build_object('ok', false, 'error', 'unknown buff'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select coalesce(array(select jsonb_array_elements_text(payload_json->'buffs')), '{}')
    into cur from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if not (p_buff = any(cur)) then cur := cur || p_buff; end if;

  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('buffs', to_jsonb(cur)))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{buffs}', to_jsonb(cur)),
        week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur));
end $$;

-- Disarm one buff for the caller. Same gates as arm_buff. Idempotent.
create or replace function disarm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[];
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select coalesce(array(select jsonb_array_elements_text(payload_json->'buffs')), '{}')
    into cur from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  cur := array_remove(cur, p_buff);
  update applied_state
    set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{buffs}', to_jsonb(cur)), updated_at = now()
    where matchup_id = p_matchup_id and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur));
end $$;

-- The caller's own armed buffs for a matchup (drives the LivePicks arming UI).
create or replace function my_buffs(p_matchup_id uuid)
  returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(payload_json->'buffs', '[]'::jsonb)
  from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
$$;

-- Re-surface both sides' armed buffs in the admin force-resolve payload so the
-- founder's preview resolves with the same buffs the live worker will use.
create or replace function admin_matchup_picks(p_matchup_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; hu uuid; au uuid;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('error', 'no matchup'); end if;
  select app_user_id into hu from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id;
  select app_user_id into au from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id;
  return jsonb_build_object(
    'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id, 'home_app_user', hu, 'away_app_user', au,
    'picks', (select coalesce(jsonb_agg(jsonb_build_object('app_user_id', app_user_id, 'game_window', game_window, 'roster_slot', roster_slot, 'player_slug', player_slug, 'metric_id', metric_id)), '[]'::jsonb) from sealed_pick where matchup_id = p_matchup_id),
    'home_lineup', (select coalesce(starters_json, '[]'::jsonb) from sleeper_lineup where league_id = m.league_id and week = m.week and roster_id = m.home_roster_id),
    'away_lineup', (select coalesce(starters_json, '[]'::jsonb) from sleeper_lineup where league_id = m.league_id and week = m.week and roster_id = m.away_roster_id),
    'home_buffs', (select coalesce(payload_json->'buffs', '[]'::jsonb) from applied_state where matchup_id = p_matchup_id and app_user_id = hu),
    'away_buffs', (select coalesce(payload_json->'buffs', '[]'::jsonb) from applied_state where matchup_id = p_matchup_id and app_user_id = au)
  );
end $$;

grant execute on function is_live_buff(text) to authenticated;
grant execute on function arm_buff(uuid, text) to authenticated;
grant execute on function disarm_buff(uuid, text) to authenticated;
grant execute on function my_buffs(uuid) to authenticated;
