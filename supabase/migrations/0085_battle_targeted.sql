-- 0085: server-side scoring for the BATTLE-LAYER targeted power-ups. The engine
-- (resolveLiveMatchup) and the worker mapping (resolve.js toExtras) already
-- score every one of these from applied_state.payload_json.targeted — the AI's
-- lock-time budget pass writes them directly — but apply_targeted still
-- whitelisted only the 0060 set, so a HUMAN arming one in a live league got a
-- local-display-only effect that vanished at the authoritative resolve. This
-- extends the whitelist:
--
--   rivalry:       [ "<win>", ... ]                 -- pre · one per window
--   ghost:         [ "<win>|<slot>", ... ]          -- pre · open slot, flat 14
--   leadChange:    [ "<win>|<slot>", ... ]          -- pre · own slot
--   grudge:        [ "<win>|<slot>", ... ]          -- pre · own slot
--   jinx:          [ "<win>|<slot>", ... ]          -- pre · opponent slot (blind)
--   redHerring:    [ "<win>|<slot>", ... ]          -- pre · own decoy slot
--   surge:         { "<win>|<slot>": <clock> }      -- live · own slot
--   coldSnap:      { "<win>|<slot>": <clock> }      -- live · opponent slot
--   napalm:        { "<win>|<slot>": <clock> }      -- live · opponent slot
--   bunker:        { "<win>|<slot>": <clock> }      -- live · own slot
--   clutchDon:     [ "<win>|<slot>", ... ]          -- live · own slot (×2/0)
--   clutchEncore:  { "<win>|<slot>": <arm clock> }  -- live · own slot (+12 next TD)
--   clutchCounter: { "<win>|<slot>": <wipe clock> } -- live · own slot (negate a nuke)
--
-- Economy/trust model unchanged from 0060: UNCHARGED state-setters (the client
-- charges at purchase and consumes inventory on apply); the value here is
-- validation — timing gates, slot-ownership checks, one-per-target caps, and
-- numeric clamps. Like 0060's byeSteal, a client that skips its consume could
-- apply without owning; per-play caps below bound that exposure the same way
-- the single don/byeSteal keys always have. A purchase-vs-applies entitlement
-- ledger is future work.
--
-- Clutch conditions (halftime lead / first-half TD / a nuke landing) live in
-- play data the DB doesn't hold — the recorded clock is trusted the way 0060
-- trusts a swap's atClock; the resolver re-clamps and the engine only pays when
-- the condition actually materializes in the play-by-play (an Encore with no
-- later TD, or a Counter-Wipe clock matching no nuke, simply whiffs).

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
    -- Clamped at BYE_STEAL_CAP (16, retuned v0.126.0) here AND in the engine.
    v_pts  := least(greatest(coalesce((p_payload->>'pts')::numeric, 0), 0), 16);
    if v_win is null or v_slot is null or v_slug is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if not caller_pool_has(p_matchup_id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not your player'); end if;
    t := jsonb_set(t, '{byeSteal}', jsonb_build_object('win', v_win, 'slot', v_slot, 'slug', v_slug, 'pts', v_pts));

  elsif p_powerup_id = 'rivalry' then
    -- Pre-kickoff, one per window, capped at 5 windows a week.
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    if v_win is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if coalesce(t->'rivalry', '[]'::jsonb) @> to_jsonb(array[v_win]) then return jsonb_build_object('ok', false, 'error', 'already armed'); end if;
    if jsonb_array_length(coalesce(t->'rivalry', '[]'::jsonb)) >= 5 then return jsonb_build_object('ok', false, 'error', 'cap reached'); end if;
    t := jsonb_set(t, '{rivalry}', coalesce(t->'rivalry', '[]'::jsonb) || to_jsonb(v_win));

  elsif p_powerup_id in ('ghost', 'lead-change', 'grudge', 'jinx', 'red-herring') then
    -- Pre-kickoff slot lists. Ghost needs the caller's slot EMPTY; the own-slot
    -- plays (lead-change / grudge / red-herring) need the caller's pick there.
    -- Jinx points at the opponent blind — no ownership check (an empty target
    -- simply whiffs). One entry per slot per play; lists capped at 6.
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
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
    -- Live slot fires: window kicked off, one per slot per play, clock clamped.
    -- Own-slot plays (surge / bunker / clutch-*) need the caller's pick there.
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
    -- Halftime Gamble: a live-armed ×2/0 stake on the caller's slot.
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

-- Back out a PRE-kickoff targeted application. The 2-arg form (0060) still
-- clears the single-entry keys (don / byeSteal); this 3-arg overload removes
-- ONE entry from a battle-play list (rivalry a window; the slot plays a
-- win|slot) so removing one armed slot doesn't drop the rest. Uncharged — the
-- client refunds its inventory the way it consumed it. Live fires (EMP, swaps,
-- tacticals, clutch) are fired, not armed — no back-out.
create or replace function clear_targeted(p_matchup_id uuid, p_powerup_id text, p_payload jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; t jsonb; k text; ent text;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  k := case p_powerup_id
    when 'rivalry' then 'rivalry' when 'ghost' then 'ghost'
    when 'lead-change' then 'leadChange' when 'grudge' then 'grudge'
    when 'jinx' then 'jinx' when 'red-herring' then 'redHerring'
    else null end;
  if k is null then return jsonb_build_object('ok', false, 'error', 'not clearable'); end if;
  ent := case when p_powerup_id = 'rivalry' then p_payload->>'win' else (p_payload->>'win') || '|' || (p_payload->>'slot') end;
  if ent is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
  select coalesce(payload_json->'targeted', '{}'::jsonb) into t
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if t is null then t := '{}'::jsonb; end if;
  t := jsonb_set(t, array[k], coalesce((
    select jsonb_agg(e) from jsonb_array_elements(coalesce(t->k, '[]'::jsonb)) e where e #>> '{}' <> ent
  ), '[]'::jsonb));
  update applied_state set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{targeted}', t), updated_at = now()
    where matchup_id = p_matchup_id and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'targeted', t);
end $$;
grant execute on function clear_targeted(uuid, text, jsonb) to authenticated;
