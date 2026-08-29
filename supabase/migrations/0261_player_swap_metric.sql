-- 0261: a Player Swap lands with a metric its position can score.
--
-- Founder, mid-PRE-4: "I swapped out Dobbs using the player swap power up but
-- when I went to apply metric swap to the spot, it was still Dobbs. The
-- player swap also loaded no metric. it should have a default metric per
-- position."
--
-- The player-swap entry never carried a metric, so the swapped-in player
-- inherited the outgoing one's — a QB metric on an RB scores nothing and the
-- slot read NO METRIC. Now the clients send `toMetric` (kept when the new
-- position can score it, else the position's default) and this branch records
-- it, with the same locked-metric gate metric-swap uses. Both engines also
-- grew a fallback (swapMetricFor) so a legacy entry without toMetric scores
-- the position default rather than 0. The stale-modal half of the report is
-- client-only (the swap menu now reads the post-swap identity).
--
-- Body is 0260's verbatim; only the player-swap branch grew the toMetric block.

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
    if m.status = 'final' or (window_locks_at(m.week, v_win) is not null and window_locks_at(m.week, v_win) <= now()) then
      return jsonb_build_object('ok', false, 'error', 'window already locked');
    end if;
    if t ? 'don' and window_locks_at(m.week, t->'don'->>'win') is not null and window_locks_at(m.week, t->'don'->>'win') <= now() then
      return jsonb_build_object('ok', false, 'error', 'stake already playing');
    end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    t := jsonb_set(t, '{don}', jsonb_build_object('win', v_win, 'slot', v_slot));

  elsif p_powerup_id = 'bye-steal' then
    if m.status = 'final' or (window_locks_at(m.week, v_win) is not null and window_locks_at(m.week, v_win) <= now()) then
      return jsonb_build_object('ok', false, 'error', 'window already locked');
    end if;
    if t ? 'byeSteal' and window_locks_at(m.week, t->'byeSteal'->>'win') is not null and window_locks_at(m.week, t->'byeSteal'->>'win') <= now() then
      return jsonb_build_object('ok', false, 'error', 'stake already playing');
    end if;
    v_slug := p_payload->>'slug';
    v_pts  := least(greatest(coalesce((p_payload->>'pts')::numeric, 0), 0), 16);
    if v_win is null or v_slot is null or v_slug is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if not caller_pool_has(p_matchup_id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not your player'); end if;
    t := jsonb_set(t, '{byeSteal}', jsonb_build_object('win', v_win, 'slot', v_slot, 'slug', v_slug, 'pts', v_pts));

  elsif p_powerup_id = 'rivalry' then
    if m.status = 'final' or (window_locks_at(m.week, v_win) is not null and window_locks_at(m.week, v_win) <= now()) then
      return jsonb_build_object('ok', false, 'error', 'window already locked');
    end if;
    if v_win is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if coalesce(t->'rivalry', '[]'::jsonb) @> to_jsonb(array[v_win]) then return jsonb_build_object('ok', false, 'error', 'already armed'); end if;
    if jsonb_array_length(coalesce(t->'rivalry', '[]'::jsonb)) >= 5 then return jsonb_build_object('ok', false, 'error', 'cap reached'); end if;
    t := jsonb_set(t, '{rivalry}', coalesce(t->'rivalry', '[]'::jsonb) || to_jsonb(v_win));

  elsif p_powerup_id in ('ghost', 'lead-change', 'grudge', 'jinx', 'red-herring') then
    if m.status = 'final' or (window_locks_at(m.week, v_win) is not null and window_locks_at(m.week, v_win) <= now()) then
      return jsonb_build_object('ok', false, 'error', 'window already locked');
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
      -- The landing metric rides along (0261): a cross-position swap arrives on
      -- the new position's default instead of a metric it can't score. Locked
      -- metrics still demand their armed unlock, exactly like metric-swap; the
      -- engines fall back to the position default when it's absent or invalid.
      if p_payload ? 'toMetric' then
        if locked_metric_unlock(p_payload->>'toMetric') is not null and not exists (
          select 1 from applied_state a where a.matchup_id = p_matchup_id and a.app_user_id = auth.uid()
            and (a.payload_json->'unlocks') ? locked_metric_unlock(p_payload->>'toMetric')
        ) then return jsonb_build_object('ok', false, 'error', 'metric locked'); end if;
        entry := entry || jsonb_build_object('toMetric', p_payload->>'toMetric');
      end if;
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
