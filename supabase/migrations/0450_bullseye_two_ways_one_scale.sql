-- ═══════════════════════════════════════════════════════════════════════════
-- 0450 · BULLSEYE: TWO WAYS TO PLAY, ONE WAY TO SCORE.
--
-- Founder, the morning after 0448: "Let's only do smooth rings so no setting
-- needed and no need to say rings anywhere. … Lets not do hybrid."
--
--   • The FIXED-rings knob (bullseye_rings) goes. A dart banks radius −
--     distance plus the bullseye bonus, and that is the only way it banks.
--     The key is removed from every league that carried it.
--   • The HYBRID variant goes. A league on it is moved to SLOTS (nobody has
--     played a week under it; the test league was set up today).
--   • set_league_bullseye loses its rings argument: (league, variant,
--     radius, deal). The 0448 five-argument form is dropped so a call can't
--     be ambiguous.
--   • league_game_mode, bullseye_card and bullseye_global_board stop
--     reporting rings and admitting hybrid.
-- The per-team deal (0448) stays.
-- ═══════════════════════════════════════════════════════════════════════════

update league set settings_json = settings_json || '{"bullseye": "slots"}'::jsonb
 where settings_json ->> 'bullseye' = 'hybrid';
update league set settings_json = settings_json - 'bullseye_rings'
 where settings_json ? 'bullseye_rings';

create or replace function league_bullseye(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when (select settings_json ->> 'bullseye' from league where id = p_league_id) in ('slots', 'total')
              then (select settings_json ->> 'bullseye' from league where id = p_league_id) end;
$$;

drop function if exists set_league_bullseye(uuid, text, int, text, text);
create or replace function set_league_bullseye(p_league_id uuid, p_variant text, p_radius int default null, p_deal text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; v text := lower(nullif(btrim(coalesce(p_variant, '')), '')); r int := p_radius;
        dl text := lower(nullif(btrim(coalesce(p_deal, '')), ''));
        patch jsonb := '{}'::jsonb; cur jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'bullseye is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'bullseye locks once the draft starts — you draft a bullseye league for floor, not ceiling');
  end if;
  if v = 'off' then v := null; end if;
  if v is not null and v not in ('slots', 'total') then
    return jsonb_build_object('ok', false, 'error', 'bullseye is slots, total or off');
  end if;
  if r is not null and (r < 2 or r > 50) then
    return jsonb_build_object('ok', false, 'error', 'the radius must be 2-50 points');
  end if;
  if dl is not null and dl not in ('shared', 'team') then
    return jsonb_build_object('ok', false, 'error', 'the deal is shared or team');
  end if;
  if v is not null and league_golf(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'bullseye and golf cannot both be on — the lowest score winning would reward the worst aim');
  end if;
  if v is null then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) - 'bullseye' - 'bullseye_radius' - 'bullseye_rings' - 'bullseye_deal'
      where id = p_league_id;
  else
    patch := jsonb_build_object('bullseye', v);
    if r is not null then patch := patch || jsonb_build_object('bullseye_radius', r); end if;
    if dl is not null then patch := patch || jsonb_build_object('bullseye_deal', dl); end if;
    update league set settings_json = (coalesce(settings_json, '{}'::jsonb) - 'bullseye_rings') || patch where id = p_league_id;
  end if;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  select settings_json into cur from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'bullseye', v,
    'radius', (cur ->> 'bullseye_radius')::int,
    'deal', cur ->> 'bullseye_deal');
end $$;
grant execute on function set_league_bullseye(uuid, text, int, text) to authenticated;

create or replace function bullseye_card(p_league_id uuid, p_week int) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare cur jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select settings_json into cur from league where id = p_league_id;
  return jsonb_build_object('ok', true, 'bullseye', league_bullseye(p_league_id),
    'radius', (cur ->> 'bullseye_radius')::int,
    'deal', cur ->> 'bullseye_deal',
    'card', coalesce((
      select jsonb_agg(jsonb_build_object('slot', c.slot, 'target', c.target, 'roster_id', c.roster_id) order by c.roster_id, (c.slot = 'TOTAL'), c.slot)
        from bullseye_card c where c.league_id = p_league_id and c.week = p_week), '[]'::jsonb));
end $$;

create or replace function league_game_mode(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return (select jsonb_build_object('ok', true,
      'mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
      'ppr',  coalesce((l.settings_json ->> 'ppr')::numeric, 1),
      'classic_ok', coalesce((l.settings_json ->> 'classic_ok')::boolean, false),
      'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
      'scoring', coalesce(l.settings_json -> 'scoring_classic', '{}'::jsonb),
      'roster', coalesce(l.settings_json -> 'roster_classic', '{}'::jsonb),
      'slots', l.settings_json -> 'roster_slots',
      'shape', l.settings_json -> 'roster_shape',
      'rounds', (select rounds from draft d where d.league_id = l.id),
      'positions', l.settings_json -> 'positions_extra',
      'pool_filter', l.settings_json -> 'pool_filter',
      'golf', league_golf(p_league_id),
      'bullseye', league_bullseye(p_league_id),
      'bullseye_radius', (l.settings_json ->> 'bullseye_radius')::int,
      'bullseye_deal', l.settings_json ->> 'bullseye_deal',
      'sport', coalesce(l.sport, 'nfl'),
      'sport_settings', l.settings_json -> 'sport',
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league l where l.id = p_league_id);
end $$;

create or replace function bullseye_global_board(p_week int, p_season text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  return jsonb_build_object('ok', true, 'week', p_week,
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
          'rank', z.rk, 'team', z.team_name, 'final', z.fin,
          'league', case when z.member then z.lname end,
          'variant', z.variant,
          'mine', z.member and z.app_user_id = uid)
        order by z.rk, z.lname, z.team_name)
      from (
        select x.fin, m.team_name, m.app_user_id, l.name as lname, l.settings_json ->> 'bullseye' as variant,
               exists (select 1 from league_membership me where me.league_id = l.id and me.app_user_id = uid and me.enrolled) as member,
               rank() over (order by x.fin desc) as rk
        from (
          select mu.league_id, mu.home_roster_id as rid, mu.home_final as fin from matchup mu
           where mu.week = p_week and mu.status = 'final' and mu.home_final is not null
          union all
          select mu.league_id, mu.away_roster_id, mu.away_final from matchup mu
           where mu.week = p_week and mu.status = 'final' and mu.away_final is not null
             and mu.away_roster_id <> mu.home_roster_id
        ) x
        join league l on l.id = x.league_id
          and coalesce(l.settings_json ->> 'game_mode', 'drip') = 'classic'
          and l.settings_json ->> 'bullseye' in ('slots', 'total')
          and (p_season is null or l.season = p_season)
        join league_membership m on m.league_id = l.id and m.sleeper_roster_id = x.rid
      ) z), '[]'::jsonb));
end $$;
