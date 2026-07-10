-- 0086: ENTITLEMENT LEDGER — applies may never exceed purchases. 0060/0085's
-- apply_targeted was an UNCHARGED state-setter that trusted the client to have
-- consumed inventory; a client that skipped its consume (or never bought) could
-- record targeted plays for free, bounded only by the per-play caps. This
-- closes that gap with a pure DERIVATION — no new tables, no backfill:
--
--   purchases(play) = count of coin_ledger rows with reason 'spend:<id>' for
--                     the caller's team. EVERY purchase already writes one:
--                     the shop (wallet_buy_powerup, 0047/0048) and the AI
--                     budget pass (lock.js → spend_from_wallet) both spend
--                     with that exact reason, and nothing else grants targeted
--                     power-ups (refund_inventory restores stock without a
--                     ledger row, which is correct — the purchase still counts;
--                     sell_extra_slot only touches extra slots).
--   applies(play)   = entries for that play summed across EVERY matchup of
--                     the caller's in this league — a consumable spent in one
--                     week stays spent. clear_targeted removes entries, so
--                     backing out releases the entitlement for a re-apply.
--   gate            = applies + 1 <= purchases, checked before recording.
--
-- Move semantics: don / byeSteal are single-slot keys that a re-apply REPLACES
-- (the client remaps the stake when the player moves spots) — a move is not a
-- second use, so those gate only when the key is being CREATED. Swap entries
-- carry their kind (metric-swap / player-swap / mulligan are separately priced
-- purchases) and gate per kind. Spy is untouched — use_spy already consumes
-- the caller's inventory itself (0060), the original entitlement pattern.

-- Current applies of one play inside a targeted payload.
create or replace function targeted_applies(t jsonb, p_powerup_id text) returns int
  language sql immutable as $$
  select case p_powerup_id
    when 'double-or-nothing' then case when t ? 'don' then 1 else 0 end
    when 'bye-steal'         then case when t ? 'byeSteal' then 1 else 0 end
    when 'rivalry'           then coalesce(jsonb_array_length(t->'rivalry'), 0)
    when 'ghost'             then coalesce(jsonb_array_length(t->'ghost'), 0)
    when 'lead-change'       then coalesce(jsonb_array_length(t->'leadChange'), 0)
    when 'grudge'            then coalesce(jsonb_array_length(t->'grudge'), 0)
    when 'jinx'              then coalesce(jsonb_array_length(t->'jinx'), 0)
    when 'red-herring'       then coalesce(jsonb_array_length(t->'redHerring'), 0)
    when 'clutch-don'        then coalesce(jsonb_array_length(t->'clutchDon'), 0)
    when 'emp'               then (select count(*)::int from jsonb_object_keys(coalesce(t->'emp', '{}'::jsonb)))
    when 'surge'             then (select count(*)::int from jsonb_object_keys(coalesce(t->'surge', '{}'::jsonb)))
    when 'cold-snap'         then (select count(*)::int from jsonb_object_keys(coalesce(t->'coldSnap', '{}'::jsonb)))
    when 'napalm'            then (select count(*)::int from jsonb_object_keys(coalesce(t->'napalm', '{}'::jsonb)))
    when 'bunker'            then (select count(*)::int from jsonb_object_keys(coalesce(t->'bunker', '{}'::jsonb)))
    when 'clutch-encore'     then (select count(*)::int from jsonb_object_keys(coalesce(t->'clutchEncore', '{}'::jsonb)))
    when 'clutch-counter'    then (select count(*)::int from jsonb_object_keys(coalesce(t->'clutchCounter', '{}'::jsonb)))
    when 'metric-swap'       then (select count(*)::int from jsonb_each(coalesce(t->'swaps', '{}'::jsonb)) e where e.value->>'kind' = 'metric-swap')
    when 'player-swap'       then (select count(*)::int from jsonb_each(coalesce(t->'swaps', '{}'::jsonb)) e where e.value->>'kind' = 'player-swap')
    when 'mulligan'          then (select count(*)::int from jsonb_each(coalesce(t->'swaps', '{}'::jsonb)) e where e.value->>'kind' = 'mulligan')
    else 0 end;
$$;

-- Lifetime purchases of one power-up by a team (the append-only coin ledger is
-- the source of truth; indexed by (league_id, roster_id) since 0025).
create or replace function powerup_purchases(p_league_id uuid, p_roster_id int, p_powerup_id text) returns int
  language sql stable security definer set search_path = public as $$
  select count(*)::int from coin_ledger
    where league_id = p_league_id and roster_id = p_roster_id and reason = 'spend:' || p_powerup_id;
$$;

-- apply_targeted, re-created from 0085 with the entitlement gate. The gate runs
-- after the participant check and before any recording; a MOVE of an existing
-- don/byeSteal key skips it (not a new use).
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
  if not (p_powerup_id = 'double-or-nothing' and t ? 'don')
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
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    t := jsonb_set(t, '{don}', jsonb_build_object('win', v_win, 'slot', v_slot));

  elsif p_powerup_id = 'bye-steal' then
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    v_slug := p_payload->>'slug';
    v_pts  := least(greatest(coalesce((p_payload->>'pts')::numeric, 0), 0), 16);
    if v_win is null or v_slot is null or v_slug is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if not caller_pool_has(p_matchup_id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not your player'); end if;
    t := jsonb_set(t, '{byeSteal}', jsonb_build_object('win', v_win, 'slot', v_slot, 'slug', v_slug, 'pts', v_pts));

  elsif p_powerup_id = 'rivalry' then
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    if v_win is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if coalesce(t->'rivalry', '[]'::jsonb) @> to_jsonb(array[v_win]) then return jsonb_build_object('ok', false, 'error', 'already armed'); end if;
    if jsonb_array_length(coalesce(t->'rivalry', '[]'::jsonb)) >= 5 then return jsonb_build_object('ok', false, 'error', 'cap reached'); end if;
    t := jsonb_set(t, '{rivalry}', coalesce(t->'rivalry', '[]'::jsonb) || to_jsonb(v_win));

  elsif p_powerup_id in ('ghost', 'lead-change', 'grudge', 'jinx', 'red-herring') then
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
