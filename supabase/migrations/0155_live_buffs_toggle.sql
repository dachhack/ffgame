-- 0155: REAL-TIME POWER-UPS, A LEAGUE SWITCH — the commissioner can turn the
-- live buffs (armed mid-game: overtime, momentum, amps, counters…) on or off
-- for their league.
--
-- One setting, enforced at the money chokepoint: settings_json.live_buffs
-- ('on' default / 'off'). arm_buff refuses BEFORE the wallet is touched, so a
-- league that turns them off can never charge a coin for one — the shop's
-- pre-game power-ups are untouched (they're a different lever; the founder's
-- ask was the REAL-TIME set). disarm_buff stays open either way: a buff armed
-- before the switch flipped must remain reclaimable.

create or replace function set_league_live_buffs(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_on is null then return jsonb_build_object('ok', false, 'error', 'on or off'); end if;
  update league
    set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('live_buffs', case when p_on then 'on' else 'off' end)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'on', p_on);
end $$;

/** The switch, readable by any member — the board hides the buff rail on off. */
create or replace function league_live_buffs(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true,
    'on', coalesce((select settings_json ->> 'live_buffs' from league where id = p_league_id), 'on') <> 'off');
end $$;

-- arm_buff v4 (0063 body + the league switch, checked before any spend)
create or replace function arm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; sp jsonb; price numeric; amps int; cap int;
begin
  if not is_live_buff(p_buff) then return jsonb_build_object('ok', false, 'error', 'unknown buff'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce((select settings_json ->> 'live_buffs' from league where id = m.league_id), 'on') = 'off' then
    return jsonb_build_object('ok', false, 'error', 'live power-ups are turned off in this league');
  end if;
  select coalesce(array(select jsonb_array_elements_text(payload_json->'buffs')), '{}') into cur
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if cur is null then cur := '{}'; end if;
  if p_buff = any(cur) then return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur), 'dup', true); end if;

  if p_buff = 'amp-3' and not ('amp-2' = any(cur)) then
    return jsonb_build_object('ok', false, 'error', 'amp order', 'detail', 'Arm Second Amp before Third Amp');
  end if;
  if is_amplifier(p_buff) then
    select count(*) into amps from unnest(cur) b where is_amplifier(b);
    cap := 1 + (case when 'amp-2' = any(cur) then 1 else 0 end)
             + (case when 'amp-2' = any(cur) and 'amp-3' = any(cur) then 1 else 0 end);
    if amps >= cap then
      return jsonb_build_object('ok', false, 'error', 'amp limit', 'detail',
        'Amplifiers are limited to ' || cap || ' — arm ' || case when cap = 1 then 'Second Amp' else 'Third Amp' end || ' to run more');
    end if;
  end if;

  rid := caller_roster(p_matchup_id);
  price := powerup_price(p_buff);
  sp := spend_from_wallet(m.league_id, rid, price, p_matchup_id, m.week, 'spend:' || p_buff, null);
  if not (sp->>'ok')::boolean then
    return jsonb_build_object('ok', false, 'error', 'insufficient', 'balance', sp->'balance', 'price', price);
  end if;

  cur := cur || p_buff;
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('buffs', to_jsonb(cur)))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{buffs}', to_jsonb(cur)), week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'buffs', to_jsonb(cur), 'charged', price);
end $$;

-- hero_set_buffs v2 (0049 body + the league switch). The hero path SETS the
-- whole list, so the honest off-rule is: shrinking (disarms) stays allowed —
-- a buff armed before the flip must remain reclaimable — but any ADDITION is
-- refused.
create or replace function hero_set_buffs(p_matchup_id uuid, p_buffs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur jsonb;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if coalesce((select settings_json ->> 'live_buffs' from league where id = m.league_id), 'on') = 'off' then
    select coalesce(payload_json -> 'buffs', '[]'::jsonb) into cur
      from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
    cur := coalesce(cur, '[]'::jsonb);
    if exists (select 1 from jsonb_array_elements_text(coalesce(p_buffs, '[]'::jsonb)) nb
                 where not cur ? nb.value) then
      return jsonb_build_object('ok', false, 'error', 'live power-ups are turned off in this league');
    end if;
  end if;
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('buffs', coalesce(p_buffs, '[]'::jsonb)))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{buffs}', coalesce(p_buffs, '[]'::jsonb)),
        week = m.week, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

grant execute on function set_league_live_buffs(uuid, boolean) to authenticated;
grant execute on function league_live_buffs(uuid) to authenticated;
