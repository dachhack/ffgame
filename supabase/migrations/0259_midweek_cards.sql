-- 0259: PRE-MATCH plays go per-window — "still can't play cards".
--
-- Founder, Saturday of PRE 4, Thursday's window final, Saturday's games hours
-- away, a hand full of cards all reading "Before lock-in": the whole-week
-- lock predates late swap (0058). If a window hasn't kicked off, a card that
-- targets it — or a buff that would only count it — is a legitimate play.
--
-- Fairness is the reason the whole-week gate existed: arming Hail Mary AFTER
-- watching Thursday's 40-yard TD land must not score Thursday. So the gates
-- relax and the TIMESTAMPS carry the fairness:
--
--   · hero_set_buffs — armable until the matchup is FINAL. Each buff armed
--     after the week's first kickoff (status past 'scheduled') is stamped
--     with its arm time in payload 'buffsAt'; the resolvers (buffsForWindow,
--     both engines) count a stamped buff only in windows kicking AFTER the
--     stamp. A pre-lock arm carries no stamp = the full week, exactly the
--     legacy meaning.
--   · apply_targeted — the pre-match branches (DoN / Bye Steal / Rivalry /
--     Ghost / Lead Change / Grudge / Jinx / Red Herring) gate on THEIR TARGET
--     WINDOW's kickoff instead of week status: an un-kicked window accepts
--     the play mid-week; a kicked one refuses. Moving a DoN/Bye-Steal stake
--     OFF a window that is already playing is refused too — pulling a losing
--     stake after watching it lose is the same exploit from the other side.
--     Live branches (surge/EMP/swaps/clutch) are untouched. Body is 0258's.

create or replace function hero_set_buffs(p_matchup_id uuid, p_buffs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur jsonb; cur_at jsonb; new_at jsonb := '{}'::jsonb; b text; now_ms numeric;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status = 'final' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(payload_json -> 'buffs', '[]'::jsonb), coalesce(payload_json -> 'buffsAt', '{}'::jsonb)
    into cur, cur_at
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  cur := coalesce(cur, '[]'::jsonb); cur_at := coalesce(cur_at, '{}'::jsonb);
  if league_powerups_off(m.league_id) then
    if exists (select 1 from jsonb_array_elements_text(coalesce(p_buffs, '[]'::jsonb)) nb
                 where not cur ? nb.value) then
      return jsonb_build_object('ok', false, 'error', 'live power-ups are turned off in this league');
    end if;
  end if;
  -- Arm stamps: a buff retained keeps its stamp; a NEW buff armed after the
  -- week's first kickoff gets now(); a pre-lock arm gets none (= full week).
  -- Stamps for removed buffs drop with them.
  now_ms := extract(epoch from now()) * 1000;
  for b in select jsonb_array_elements_text(coalesce(p_buffs, '[]'::jsonb)) loop
    if cur_at ? b then new_at := new_at || jsonb_build_object(b, cur_at -> b);
    elsif m.status <> 'scheduled' then new_at := new_at || jsonb_build_object(b, now_ms);
    end if;
  end loop;
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('buffs', coalesce(p_buffs, '[]'::jsonb), 'buffsAt', new_at))
  on conflict (matchup_id, app_user_id) do update
    set payload_json = jsonb_set(
          jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{buffs}', coalesce(p_buffs, '[]'::jsonb)),
          '{buffsAt}', new_at),
        week = m.week, updated_at = now();
  return jsonb_build_object('ok', true, 'buffsAt', new_at);
end $$;
grant execute on function hero_set_buffs(uuid, jsonb) to authenticated;

create or replace function apply_targeted(p_matchup_id uuid, p_powerup_id text, p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matchup%rowtype; t jsonb; entry jsonb; k text;
  v_win text; v_slot text; v_clock numeric; v_slug text; v_pts numeric;
  kick timestamptz; rid int; bought int; used int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select coalesce(payload_json->'targeted', '{}'::jsonb) into t
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if t is null then t := '{}'::jsonb; end if;

  -- ── ENTITLEMENT GATE: applies + 1 must fit inside lifetime purchases. ──
  -- Applies are counted across EVERY matchup of the caller's in this league —
  -- a consumable spent in week 3 must not be re-appliable against week 4's
  -- fresh payload. clear_targeted removes entries, releasing entitlement.
  -- A don/byeSteal re-apply is a MOVE of the existing stake, not a new use.
  if not is_practice_week(m.week)
     and not (p_powerup_id = 'double-or-nothing' and t ? 'don')
     and not (p_powerup_id = 'bye-steal' and t ? 'byeSteal') then
    rid := caller_roster(p_matchup_id);
    used := coalesce((
      select sum(targeted_applies(coalesce(a.payload_json->'targeted', '{}'::jsonb), p_powerup_id))::int
      from applied_state a join matchup m2 on m2.id = a.matchup_id
      where a.app_user_id = auth.uid() and m2.league_id = m.league_id
    ), 0);
    bought := powerup_purchases(m.league_id, rid, p_powerup_id);
    if used + 1 > bought then
      return jsonb_build_object('ok', false, 'error', 'not owned', 'purchased', bought, 'applied', used);
    end if;
  end if;

  v_win  := p_payload->>'win';
  v_slot := p_payload->>'slot';

  if p_powerup_id = 'double-or-nothing' then
    if m.status = 'final' or (window_kickoff(m.week, v_win) is not null and window_kickoff(m.week, v_win) <= now()) then
      return jsonb_build_object('ok', false, 'error', 'window already kicked off');
    end if;
    if t ? 'don' and window_kickoff(m.week, t->'don'->>'win') is not null and window_kickoff(m.week, t->'don'->>'win') <= now() then
      return jsonb_build_object('ok', false, 'error', 'stake already playing');
    end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    t := jsonb_set(t, '{don}', jsonb_build_object('win', v_win, 'slot', v_slot));

  elsif p_powerup_id = 'bye-steal' then
    if m.status = 'final' or (window_kickoff(m.week, v_win) is not null and window_kickoff(m.week, v_win) <= now()) then
      return jsonb_build_object('ok', false, 'error', 'window already kicked off');
    end if;
    if t ? 'byeSteal' and window_kickoff(m.week, t->'byeSteal'->>'win') is not null and window_kickoff(m.week, t->'byeSteal'->>'win') <= now() then
      return jsonb_build_object('ok', false, 'error', 'stake already playing');
    end if;
    v_slug := p_payload->>'slug';
    v_pts  := least(greatest(coalesce((p_payload->>'pts')::numeric, 0), 0), 16);
    if v_win is null or v_slot is null or v_slug is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if not caller_pool_has(p_matchup_id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not your player'); end if;
    t := jsonb_set(t, '{byeSteal}', jsonb_build_object('win', v_win, 'slot', v_slot, 'slug', v_slug, 'pts', v_pts));

  elsif p_powerup_id = 'rivalry' then
    if m.status = 'final' or (window_kickoff(m.week, v_win) is not null and window_kickoff(m.week, v_win) <= now()) then
      return jsonb_build_object('ok', false, 'error', 'window already kicked off');
    end if;
    if v_win is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if coalesce(t->'rivalry', '[]'::jsonb) @> to_jsonb(array[v_win]) then return jsonb_build_object('ok', false, 'error', 'already armed'); end if;
    if jsonb_array_length(coalesce(t->'rivalry', '[]'::jsonb)) >= 5 then return jsonb_build_object('ok', false, 'error', 'cap reached'); end if;
    t := jsonb_set(t, '{rivalry}', coalesce(t->'rivalry', '[]'::jsonb) || to_jsonb(v_win));

  elsif p_powerup_id in ('ghost', 'lead-change', 'grudge', 'jinx', 'red-herring') then
    if m.status = 'final' or (window_kickoff(m.week, v_win) is not null and window_kickoff(m.week, v_win) <= now()) then
      return jsonb_build_object('ok', false, 'error', 'window already kicked off');
    end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    k := case p_powerup_id when 'lead-change' then 'leadChange' when 'red-herring' then 'redHerring' else p_powerup_id end;
    if p_powerup_id = 'ghost' and exists (
      select 1 from sealed_pick sp2 where sp2.matchup_id = p_matchup_id and sp2.app_user_id = auth.uid()
        and sp2.game_window = v_win and sp2.roster_slot = v_slot and sp2.player_slug is not null
    ) then return jsonb_build_object('ok', false, 'error', 'slot not empty'); end if;
    if p_powerup_id in ('lead-change', 'grudge', 'red-herring') and not exists (
      select 1 from sealed_pick sp2 where sp2.matchup_id = p_matchup_id and sp2.app_user_id = auth.uid()
        and sp2.game_window = v_win and sp2.roster_slot = v_slot and sp2.player_slug is not null
    ) then return jsonb_build_object('ok', false, 'error', 'no pick at slot'); end if;
    if coalesce(t->k, '[]'::jsonb) @> to_jsonb(array[v_win || '|' || v_slot]) then return jsonb_build_object('ok', false, 'error', 'already armed'); end if;
    if jsonb_array_length(coalesce(t->k, '[]'::jsonb)) >= 6 then return jsonb_build_object('ok', false, 'error', 'cap reached'); end if;
    t := jsonb_set(t, array[k], coalesce(t->k, '[]'::jsonb) || to_jsonb(v_win || '|' || v_slot));

  elsif p_powerup_id in ('surge', 'cold-snap', 'napalm', 'bunker', 'clutch-encore', 'clutch-counter') then
    if m.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'not live'); end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    kick := window_kickoff(m.week, v_win);
    if kick is null or kick > now() then return jsonb_build_object('ok', false, 'error', 'window not live'); end if;
    v_clock := least(greatest(coalesce((p_payload->>'clock')::numeric, 0), 0), 3900);
    k := case p_powerup_id when 'cold-snap' then 'coldSnap' when 'clutch-encore' then 'clutchEncore' when 'clutch-counter' then 'clutchCounter' else p_powerup_id end;
    if p_powerup_id in ('surge', 'bunker', 'clutch-encore', 'clutch-counter') and not exists (
      select 1 from sealed_pick sp2 where sp2.matchup_id = p_matchup_id and sp2.app_user_id = auth.uid()
        and sp2.game_window = v_win and sp2.roster_slot = v_slot and sp2.player_slug is not null
    ) then return jsonb_build_object('ok', false, 'error', 'no pick at slot'); end if;
    if (t->k) ? (v_win || '|' || v_slot) then return jsonb_build_object('ok', false, 'error', 'already fired'); end if;
    t := jsonb_set(t, array[k], coalesce(t->k, '{}'::jsonb) || jsonb_build_object(v_win || '|' || v_slot, v_clock));

  elsif p_powerup_id = 'clutch-don' then
    if m.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'not live'); end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    kick := window_kickoff(m.week, v_win);
    if kick is null or kick > now() then return jsonb_build_object('ok', false, 'error', 'window not live'); end if;
    if not exists (
      select 1 from sealed_pick sp2 where sp2.matchup_id = p_matchup_id and sp2.app_user_id = auth.uid()
        and sp2.game_window = v_win and sp2.roster_slot = v_slot and sp2.player_slug is not null
    ) then return jsonb_build_object('ok', false, 'error', 'no pick at slot'); end if;
    if coalesce(t->'clutchDon', '[]'::jsonb) @> to_jsonb(array[v_win || '|' || v_slot]) then return jsonb_build_object('ok', false, 'error', 'already staked'); end if;
    if jsonb_array_length(coalesce(t->'clutchDon', '[]'::jsonb)) >= 6 then return jsonb_build_object('ok', false, 'error', 'cap reached'); end if;
    t := jsonb_set(t, '{clutchDon}', coalesce(t->'clutchDon', '[]'::jsonb) || to_jsonb(v_win || '|' || v_slot));

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
