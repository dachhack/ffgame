-- 0060: server-side TARGETED power-ups. 0059 made every catalog item buyable,
-- but the targeted/reactive ones (Double or Nothing, Bye Steal, EMP, Metric/
-- Player Swap, Mulligan, Spy) had no server SCORING path — the client applied
-- them locally (hero_applied working blob, frozen at lock) and the worker's
-- resolver never saw them. These RPCs record each application into
-- applied_state.payload_json.targeted (the store scoring already reads for
-- buffs/unlocks/extra); resolve.js hands `targeted` to resolveLiveMatchup.
--
-- Economy: like hero_set_buffs, these are UNCHARGED state-setters — the hero
-- board's client flow already charges at purchase (wallet_buy_powerup) and
-- consumes inventory on apply (consume_inventory). The value here is
-- VALIDATION: timing gates (a swap can't rewrite a window that hasn't started;
-- a pre-kickoff stake can't land mid-game), roster-membership checks on player
-- targets, one-per-slot/window caps, and numeric clamps. Spy is the exception:
-- its reveal reads data RLS hides, so use_spy consumes the caller's inventory
-- itself (one peek per purchased Spy) — the client skips its local consume.
--
-- payload_json.targeted shape (per app_user + matchup):
--   don:      { "win": text, "slot": text }
--   byeSteal: { "win": text, "slot": text, "slug": text, "pts": numeric≤25 }
--   emp:      { "<win>": <game-clock seconds> }              -- one per window
--   swaps:    { "<win>|<slot>": { "kind": "metric-swap"|"player-swap"|"mulligan",
--               "toMetric": text?, "toPlayer": text?, "atClock": int, "atRt": int? } }
--   spy:      [ { "win": text, "slot": text, "reveal": "player"|"metric" } ]

-- The caller's roster pool for a matchup week (their Sleeper starters) — used to
-- validate a Player Swap / Bye Steal target actually belongs to their roster.
create or replace function caller_pool_has(p_matchup_id uuid, p_slug text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matchup m
    join sleeper_lineup sl on sl.league_id = m.league_id and sl.week = m.week
      and sl.roster_id = caller_roster(p_matchup_id)
    cross join lateral jsonb_array_elements(sl.starters_json) e
    where m.id = p_matchup_id and e->>'player_slug' = p_slug
  );
$$;

-- Record one targeted application (validated; uncharged — see header).
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
    -- Pre-kickoff stake on one of your slots; re-apply MOVES the stake (the
    -- client remaps when the staked player changes spots) — still pre-lock only.
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    if v_win is null or v_slot is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    t := jsonb_set(t, '{don}', jsonb_build_object('win', v_win, 'slot', v_slot));

  elsif p_powerup_id = 'bye-steal' then
    -- Pre-kickoff flat fill of an empty slot with a bye player from YOUR pool.
    -- pts is the projection the client shows — clamped here AND in the engine.
    if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
    v_slug := p_payload->>'slug';
    v_pts  := least(greatest(coalesce((p_payload->>'pts')::numeric, 0), 0), 25);
    if v_win is null or v_slot is null or v_slug is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    if not caller_pool_has(p_matchup_id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not your player'); end if;
    t := jsonb_set(t, '{byeSteal}', jsonb_build_object('win', v_win, 'slot', v_slot, 'slug', v_slug, 'pts', v_pts));

  elsif p_powerup_id = 'emp' then
    -- Live: freeze the opponent's drips in a window that has KICKED OFF, for 10
    -- game-minutes from the recorded clock. One EMP per window, no re-aim.
    if m.status <> 'live' then return jsonb_build_object('ok', false, 'error', 'not live'); end if;
    v_clock := least(greatest(coalesce((p_payload->>'clock')::numeric, 0), 0), 3900);
    if v_win is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
    kick := window_kickoff(m.week, v_win);
    if kick is null or kick > now() then return jsonb_build_object('ok', false, 'error', 'window not live'); end if;
    if (t->'emp') ? v_win then return jsonb_build_object('ok', false, 'error', 'already fired'); end if;
    t := jsonb_set(t, '{emp}', coalesce(t->'emp', '{}'::jsonb) || jsonb_build_object(v_win, v_clock));

  elsif p_powerup_id in ('metric-swap', 'player-swap', 'mulligan') then
    -- Live: one swap per slot, on a window that has kicked off, on a slot the
    -- caller actually sealed. Cut-over stamps (atClock, atRt) recorded clamped;
    -- the resolver maps them onto the pre-swap player's timeline, and the
    -- real-time axis (atRt) is what stops a delayed-feed retro-scoop.
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
      -- A locked metric still needs its unlock armed (same rule as sealed picks).
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

-- Back out a PRE-kickoff targeted application (Double or Nothing / Bye Steal).
-- Uncharged, like the apply — the client refunds its inventory (refund_inventory)
-- the same way it consumed it. Live power-ups (EMP, swaps) are fired, not armed,
-- so they have no back-out.
create or replace function clear_targeted(p_matchup_id uuid, p_powerup_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; t jsonb; k text;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  k := case p_powerup_id when 'double-or-nothing' then 'don' when 'bye-steal' then 'byeSteal' else null end;
  if k is null then return jsonb_build_object('ok', false, 'error', 'not clearable'); end if;
  select coalesce(payload_json->'targeted', '{}'::jsonb) into t
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if t is null then t := '{}'::jsonb; end if;
  t := t - k;
  update applied_state set payload_json = jsonb_set(coalesce(payload_json, '{}'::jsonb), '{targeted}', t), updated_at = now()
    where matchup_id = p_matchup_id and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'targeted', t);
end $$;
grant execute on function clear_targeted(uuid, text) to authenticated;

-- Spy: peek at the opponent's CURRENT sealed pick in a window that hasn't
-- kicked off — player or metric, chosen per peek. The reveal reads data RLS
-- hides, so THIS function consumes a purchased Spy from team_inventory (one
-- peek per Spy; the client must NOT also call consume_inventory). A bought
-- target re-reads free — under per-window locks the opponent can still change
-- the pick until kickoff, so re-checking your own peek is part of the deal.
create or replace function use_spy(p_matchup_id uuid, p_win text, p_slot text, p_reveal text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matchup%rowtype; t jsonb; owned boolean := false; rid int; qty int;
  kick timestamptz; opp record; ent jsonb;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_reveal not in ('player', 'metric') then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
  kick := window_kickoff(m.week, p_win);
  if kick is not null and kick <= now() then return jsonb_build_object('ok', false, 'error', 'window live'); end if;

  select coalesce(payload_json->'targeted', '{}'::jsonb) into t
    from applied_state where matchup_id = p_matchup_id and app_user_id = auth.uid();
  if t is null then t := '{}'::jsonb; end if;
  select true into owned from jsonb_array_elements(coalesce(t->'spy', '[]'::jsonb)) e
    where e->>'win' = p_win and e->>'slot' = p_slot and e->>'reveal' = p_reveal limit 1;

  if not coalesce(owned, false) then
    rid := caller_roster(p_matchup_id);
    select coalesce(ti.qty, 0) into qty from team_inventory ti
      where ti.league_id = m.league_id and ti.roster_id = rid and ti.powerup_id = 'spy';
    if coalesce(qty, 0) < 1 then return jsonb_build_object('ok', false, 'error', 'no spy owned'); end if;
    perform bump_inventory(m.league_id, rid, 'spy', -1);
    ent := jsonb_build_object('win', p_win, 'slot', p_slot, 'reveal', p_reveal);
    t := jsonb_set(t, '{spy}', coalesce(t->'spy', '[]'::jsonb) || ent);
    insert into applied_state (matchup_id, app_user_id, week, payload_json)
      values (p_matchup_id, auth.uid(), m.week, jsonb_build_object('targeted', t))
    on conflict (matchup_id, app_user_id) do update
      set payload_json = jsonb_set(coalesce(applied_state.payload_json, '{}'::jsonb), '{targeted}', t), week = m.week, updated_at = now();
  end if;

  -- The peek itself: the opponent's current pick at that slate slot (may be
  -- empty — they haven't sealed one; the bought target re-reads free later).
  select sp2.player_slug, sp2.metric_id into opp
    from sealed_pick sp2
    where sp2.matchup_id = p_matchup_id and sp2.app_user_id <> auth.uid()
      and sp2.game_window = p_win and sp2.roster_slot = p_slot
    limit 1;
  return jsonb_build_object('ok', true, 'targeted', t,
    'reveal', case when p_reveal = 'player' then to_jsonb(opp.player_slug) else to_jsonb(opp.metric_id) end,
    'present', opp.player_slug is not null);
end $$;
grant execute on function use_spy(uuid, text, text, text) to authenticated;
