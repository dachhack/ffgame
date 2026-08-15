-- 0157: NORMIE MODE — a league can play CLASSIC fantasy: standard scoring
-- across every stat, a traditional starter lineup (QB/RB/RB/WR/WR/TE/FLEX/K/DEF),
-- no window bonuses, no power-ups.
--
-- The founder's call: "drop bonuses and power ups in normie mode. Let's do
-- both normal fantasy scoring mechanics and the league roster/starter
-- structure." One setting carries it: settings_json.game_mode
-- ('drip' default | 'classic'), plus settings_json.ppr (0 | 0.5 | 1; classic
-- only, defaults to full PPR).
--
-- What deliberately does NOT change: the pick spine. A classic lineup is
-- sealed_pick rows under the pseudo-window 'wk' with position-named slots
-- (QB / RB1 / RB2 / WR1 / WR2 / TE / FLEX / K / DEF) — game_window was always
-- free text, the locked-metric guard passes null metrics untouched, and the
-- worker seals 'wk' at the week's first kickoff (the classic weekly lock).
-- Scoring lives in the engine (packages/core/src/engine/classic.ts); the
-- worker branches per league mode at resolve time.
--
-- Power-ups in classic are refused at the same chokepoints 0155 built, via
-- one shared predicate so the two switches can't drift apart.

-- ── The one predicate both arm chokepoints (and the reader) consult ─────────
create or replace function league_powerups_off(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(settings_json ->> 'live_buffs', 'on') = 'off'
      or coalesce(settings_json ->> 'game_mode', 'drip') = 'classic'
    from league where id = p_league_id
$$;

-- ── Mode setter: commissioner only, frozen once the draft starts ────────────
-- A mode flip rewrites what a lineup IS, so it must not happen under a drafted
-- roster's feet mid-season. Pending draft (or no draft row yet) = still open.
create or replace function set_league_game_mode(p_league_id uuid, p_mode text, p_ppr numeric default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode not in ('drip', 'classic') then
    return jsonb_build_object('ok', false, 'error', 'mode must be drip or classic');
  end if;
  if p_ppr is not null and p_ppr not in (0, 0.5, 1) then
    return jsonb_build_object('ok', false, 'error', 'ppr must be 0, 0.5 or 1');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'game mode locks once the draft starts');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('game_mode', p_mode)
      || case when p_ppr is null then '{}'::jsonb else jsonb_build_object('ppr', p_ppr) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;

/** The mode + PPR, readable by any member — both boards branch on it. */
create or replace function league_game_mode(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return (select jsonb_build_object('ok', true,
      'mode', coalesce(settings_json ->> 'game_mode', 'drip'),
      'ppr',  coalesce((settings_json ->> 'ppr')::numeric, 1),
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league where id = p_league_id);
end $$;

-- ── league_live_buffs v2: reports the COMBINED switch ───────────────────────
-- Classic mode implies power-ups off, and reporting it here means every rail
-- and arm button both hosts already gate on this reader hides in classic with
-- zero client changes.
create or replace function league_live_buffs(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return jsonb_build_object('ok', true, 'on', not league_powerups_off(p_league_id));
end $$;

-- ── arm_buff v5 (0155 body; the inline check becomes the shared predicate) ──
create or replace function arm_buff(p_matchup_id uuid, p_buff text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur text[]; rid int; sp jsonb; price numeric; amps int; cap int;
begin
  if not is_live_buff(p_buff) then return jsonb_build_object('ok', false, 'error', 'unknown buff'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if league_powerups_off(m.league_id) then
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

-- ── hero_set_buffs v3 (0155 body; same predicate swap; shrink stays open) ───
create or replace function hero_set_buffs(p_matchup_id uuid, p_buffs jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; cur jsonb;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if m.status <> 'scheduled' then return jsonb_build_object('ok', false, 'error', 'locked'); end if;
  if not is_matchup_participant(p_matchup_id) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if league_powerups_off(m.league_id) then
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

-- ── enforce_slot_cap: classic leagues field exactly the 9 fixed starters ────
-- (0120 body with a classic branch. The drip cap is slate-derived and extras
-- add on top; classic has neither — the lineup IS the nine named slots.)
create or replace function enforce_slot_cap() returns trigger
  language plpgsql security definer set search_path = public as $$
declare allowed int; cnt int; wk int; sea text; lid uuid; mode text;
begin
  if new.player_slug is null then return new; end if;
  if matchup_is_practice(new.matchup_id) then
    allowed := practice_slot_cap();
  else
    select m.week, l.season, l.id, coalesce(l.settings_json ->> 'game_mode', 'drip')
      into wk, sea, lid, mode
      from matchup m join league l on l.id = m.league_id
     where m.id = new.matchup_id;
    if mode = 'classic' then
      allowed := 9;
    else
      allowed := greatest(base_slot_count(), week_slot_count(sea, wk)) + coalesce(
        (select (payload_json->>'extra')::int from applied_state
          where matchup_id = new.matchup_id and app_user_id = new.app_user_id), 0);
    end if;
  end if;
  select count(*) into cnt from sealed_pick
    where matchup_id = new.matchup_id and app_user_id = new.app_user_id and player_slug is not null
      and not (game_window = new.game_window and roster_slot = new.roster_slot);
  if cnt + 1 > allowed then
    raise exception 'lineup is full — % slots max (buy an extra slot for more)', allowed
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- ── window_kickoff v2: the classic pseudo-window locks at the week's FIRST
--    kickoff ─────────────────────────────────────────────────────────────────
-- The 0058 anti-sniping trigger resolves a window's kickoff by its slate id;
-- 'wk' names no slate window, so it read NULL — "nothing kicked off yet" —
-- and a classic lineup would have stayed client-editable mid-week until the
-- worker's lock sweep caught it. For 'wk' the kickoff is the week's earliest.
create or replace function window_kickoff(p_week int, p_win text) returns timestamptz
  language sql stable as $$
  select min(kickoff) from nfl_slate
  where week = p_week and (p_win = 'wk' or win = p_win)
    and season = (select max(season) from nfl_slate where week = p_week);
$$;

-- ── league_preview v2: a browser deserves to know which GAME this is ────────
create or replace function league_preview(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l league%rowtype; d draft%rowtype; listed boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into l from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  listed := exists (select 1 from league_listing li where li.league_id = p_league_id and li.open);
  if not (listed or is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not open for browsing');
  end if;
  select * into d from draft where league_id = p_league_id;

  return jsonb_build_object(
    'ok', true,
    'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
    'game_mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
    'ppr', coalesce((l.settings_json ->> 'ppr')::numeric, 1),
    'blurb', (select li.blurb from league_listing li where li.league_id = p_league_id),
    'seats_total', (select count(*) from league_membership m where m.league_id = p_league_id),
    'seats_open',  (select count(*) from league_membership m
                     where m.league_id = p_league_id and m.app_user_id is null and not m.enrolled),
    'draft', case when d.league_id is null then null else jsonb_build_object(
      'status', d.status, 'mode', d.mode, 'rounds', d.rounds,
      'pick_seconds', d.pick_seconds,
      'budget', case when d.mode = 'auction' then d.budget end,
      'night', case when d.night_start_min is not null then jsonb_build_object(
        'start_min', d.night_start_min, 'end_min', d.night_end_min) end) end,
    'rules', jsonb_build_object(
      'waiver_mode', coalesce(l.settings_json ->> 'waiver_mode', 'rolling'),
      'faab_budget', l.settings_json -> 'faab_budget',
      'trade_review', coalesce(l.settings_json ->> 'trade_review', 'none'),
      'pos_caps', l.settings_json -> 'pos_caps',
      'live_buffs', not league_powerups_off(p_league_id)),
    'scoring', l.settings_json -> 'scoring',
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team_name', m.team_name,
        'taken', m.app_user_id is not null and m.enrolled)
        order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m where m.league_id = p_league_id));
end $$;

grant execute on function set_league_game_mode(uuid, text, numeric) to authenticated;
grant execute on function league_game_mode(uuid) to authenticated;
