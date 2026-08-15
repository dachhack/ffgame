-- 0159: BEST BALL, a classic-league setting — the founder's "Bestball settings
-- in normie leagues. The entire roster can be Bestball or you can select to
-- make roster spots Bestball that take the highest scoring player not in a
-- non-bestball starting roster spot."
--
-- One setting: settings_json.bestball — the ARRAY of classic slot names that
-- fill themselves. All nine = full best ball (no lineup to set at all); a
-- subset = hybrid (set your locks by hand, the flagged spots chase the top
-- scorer among players you did NOT manually start). Empty/absent = off.
--
-- The selection algorithm lives in the engine (packages/core/src/engine/
-- classic.ts bestballFill), shared verbatim by the worker's resolve and both
-- boards' displays — the DB only stores WHICH slots are best ball, sanitized
-- here so nothing downstream ever sees an unknown slot name. Classic leagues
-- only (best ball has no meaning against drip's metric duels), and frozen
-- once the draft starts, the same stability rule the mode itself has.

create or replace function set_league_bestball(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare valid text[] := array['QB','RB1','RB2','WR1','WR2','TE','FLEX','K','DEF'];
declare cleaned jsonb; dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'best ball is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'best ball locks once the draft starts');
  end if;
  -- Sanitize: known slots only, canonical order, deduped.
  select coalesce(jsonb_agg(to_jsonb(v)), '[]'::jsonb) into cleaned
    from unnest(valid) v
    where exists (select 1 from jsonb_array_elements_text(coalesce(p_slots, '[]'::jsonb)) e
                   where e.value = v);
  update league set settings_json =
      case when cleaned = '[]'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'bestball')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('bestball', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'bestball', cleaned);
end $$;

-- ── league_game_mode v3: the boards need the best-ball slot set ─────────────
create or replace function league_game_mode(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return (select jsonb_build_object('ok', true,
      'mode', coalesce(settings_json ->> 'game_mode', 'drip'),
      'ppr',  coalesce((settings_json ->> 'ppr')::numeric, 1),
      'classic_ok', coalesce((settings_json ->> 'classic_ok')::boolean, false),
      'bestball', coalesce(settings_json -> 'bestball', '[]'::jsonb),
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league where id = p_league_id);
end $$;

-- ── league_preview v3: a browsing user should know lineups set themselves ───
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
    'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
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

grant execute on function set_league_bestball(uuid, jsonb) to authenticated;
