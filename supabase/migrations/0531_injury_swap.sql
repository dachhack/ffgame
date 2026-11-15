-- ═══════════════════════════════════════════════════════════════════════════
-- 0531 · THE INJURY SWAP (v0.738.0)
--
-- Founder, after a member could not get an injured starter out in the locked
-- hour: "We need to focus on the last minute Injury outs. What's a fair way
-- for a swap that won't break the game? We don't want to have users put in a
-- player and swap them last minute as way to trick their opponents." The
-- rules he took: a free swap the SERVER allows only for a starter the injury
-- report rules out, like for like, once per spot — and the Player Swap card
-- goes back to after kickoff.
--
-- 1. injury_swap(matchup, window, slot, to): in the LOCKED HOUR only (the
--    window has locked and has not kicked off), the caller's pick in that
--    spot is replaced when
--      • its player is Out or on IR on the injury report (injury_status);
--      • the man going in is on the caller's roster (not IR / taxi), is not
--        already in the caller's lineup, plays the SAME POSITION, and his
--        team plays in THIS window — so his game has not started, and a
--        player who already scored on Thursday cannot be walked in;
--      • the spot has not had an injury swap this week.
--    The metric stays: the swap repairs the lineup, it does not change the
--    plan. Free — no card, no coin. The pick itself changes, so he scores
--    his whole game. Cards aimed at the spot (a Jinx) stay on the spot, and
--    a Spy on it re-reads the pick as it now stands (use_spy reads live).
--    It was never Out when he was put in? That is allowed (the founder
--    dropped that rule): same position, same metric and a Spy that
--    re-reads leave a decoy nothing to gain.
-- 2. injury_swap_log: one row per swapped spot. It is what "once per spot"
--    reads, so it is written by the function only — a seat reads its own
--    rows and can write none.
-- 3. apply_targeted goes back to 0261's body: a PLAYER SWAP card plays once
--    the window has kicked off, as before 0529 (which opened it at the lock
--    for any player — the bluff this file exists to close).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists injury_swap_log (
  matchup_id   uuid not null references matchup(id) on delete cascade,
  app_user_id  uuid not null,
  game_window  text not null,
  roster_slot  text not null,
  out_slug     text not null,
  in_slug      text not null,
  out_status   text not null,
  created_at   timestamptz not null default now(),
  primary key (matchup_id, app_user_id, game_window, roster_slot)
);
alter table injury_swap_log enable row level security;
drop policy if exists injury_swap_log_own on injury_swap_log;
create policy injury_swap_log_own on injury_swap_log for select using (app_user_id = auth.uid() or is_admin());
grant select on injury_swap_log to authenticated;

-- A player's team, by the first source that knows him: the worker's override
-- (a mid-season move), the league's own pool, this week's price sheet, the
-- depth chart. Null when nobody can place him.
create or replace function drip_player_team(p_league_id uuid, p_week int, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select nullif(coalesce(
    (select team from player_team_override where slug = p_slug),
    (select team from league_pool where league_id = p_league_id and slug = p_slug),
    (select team from pod_salary where week = p_week and slug = p_slug order by season desc limit 1),
    (select team from player_depth where slug = p_slug limit 1)), '');
$$;

-- The window his team plays in that week (the slate's own window id), or null.
create or replace function drip_player_window(p_league_id uuid, p_week int, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select s.win from nfl_slate s
   where s.week = p_week and s.season = (select max(season) from nfl_slate where week = p_week)
     and upper(drip_player_team(p_league_id, p_week, p_slug)) in (upper(s.home), upper(s.away))
   order by s.kickoff limit 1;
$$;

create or replace function injury_swap(p_matchup_id uuid, p_win text, p_slot text, p_to text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matchup%rowtype; pick sealed_pick; rid int; st text; kick timestamptz;
  out_pos text; in_pos text; in_grp text; in_win text;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if m.status = 'final' then return jsonb_build_object('ok', false, 'error', 'matchup final'); end if;
  if p_win is null or p_slot is null or p_to is null then return jsonb_build_object('ok', false, 'error', 'bad payload'); end if;
  if coalesce(matchup_is_classic(p_matchup_id), false) then return jsonb_build_object('ok', false, 'error', 'not a drip league'); end if;

  -- The locked hour, and only it: before the lock the lineup is still yours
  -- to edit; from kickoff the Player Swap card is the tool.
  kick := window_kickoff(m.week, p_win);
  if kick is null then return jsonb_build_object('ok', false, 'error', 'window has no kickoff'); end if;
  if window_locks_at(m.week, p_win) > now() then return jsonb_build_object('ok', false, 'error', 'window not locked'); end if;
  if kick <= now() then return jsonb_build_object('ok', false, 'error', 'window kicked off'); end if;

  select * into pick from sealed_pick
   where matchup_id = p_matchup_id and app_user_id = auth.uid() and game_window = p_win and roster_slot = p_slot;
  if not found or pick.player_slug is null then return jsonb_build_object('ok', false, 'error', 'no pick at slot'); end if;
  if pick.player_slug = p_to then return jsonb_build_object('ok', false, 'error', 'same player'); end if;
  if exists (select 1 from injury_swap_log where matchup_id = p_matchup_id and app_user_id = auth.uid()
               and game_window = p_win and roster_slot = p_slot) then
    return jsonb_build_object('ok', false, 'error', 'already swapped');
  end if;

  select status into st from injury_status where player_slug = pick.player_slug;
  if st is null or st not in ('O', 'IR') then
    return jsonb_build_object('ok', false, 'error', 'not ruled out', 'status', st);
  end if;

  rid := caller_roster(p_matchup_id);
  select e ->> 'pos', coalesce(e ->> 'grp', 'start') into in_pos, in_grp
    from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e
   where sl.league_id = m.league_id and sl.week = m.week and sl.roster_id = rid and e ->> 'player_slug' = p_to limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', 'not your player'); end if;
  if in_grp in ('ir', 'taxi') then return jsonb_build_object('ok', false, 'error', 'on ir or taxi'); end if;
  if exists (select 1 from sealed_pick where matchup_id = p_matchup_id and app_user_id = auth.uid() and player_slug = p_to) then
    return jsonb_build_object('ok', false, 'error', 'already in your lineup');
  end if;

  -- Like for like. The outgoing man's position off the roster, else the
  -- league's pool (he may have been dropped since he was slotted).
  select e ->> 'pos' into out_pos
    from sleeper_lineup sl cross join lateral jsonb_array_elements(sl.starters_json) e
   where sl.league_id = m.league_id and sl.week = m.week and sl.roster_id = rid and e ->> 'player_slug' = pick.player_slug limit 1;
  if out_pos is null then select pos into out_pos from league_pool where league_id = m.league_id and slug = pick.player_slug; end if;
  if in_pos is null then select pos into in_pos from league_pool where league_id = m.league_id and slug = p_to; end if;
  if out_pos is null or in_pos is null or upper(out_pos) <> upper(in_pos) then
    return jsonb_build_object('ok', false, 'error', 'different position', 'out', out_pos, 'in', in_pos);
  end if;

  -- His team plays in THIS window, so his game has not started.
  in_win := drip_player_window(m.league_id, m.week, p_to);
  if in_win is null or in_win <> p_win then
    return jsonb_build_object('ok', false, 'error', 'not in this window', 'window', in_win);
  end if;

  insert into injury_swap_log (matchup_id, app_user_id, game_window, roster_slot, out_slug, in_slug, out_status)
    values (p_matchup_id, auth.uid(), p_win, p_slot, pick.player_slug, p_to, st);
  -- The window is locked to the seat; this one write is the exception
  -- (0356's switch, which the lock trigger and its siblings read).
  perform set_config('drip.commish_lineup', 'on', true);
  update sealed_pick set player_slug = p_to where id = pick.id;
  perform set_config('drip.commish_lineup', '', true);
  return jsonb_build_object('ok', true, 'win', p_win, 'slot', p_slot, 'out', pick.player_slug, 'in', p_to, 'metric', pick.metric_id);
end $$;
revoke all on function injury_swap(uuid, text, text, text) from public;
grant execute on function injury_swap(uuid, text, text, text) to authenticated;

-- ── 3. the Player Swap card: after kickoff again (0261's body, verbatim) ────
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
