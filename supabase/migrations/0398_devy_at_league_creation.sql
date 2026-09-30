-- ═══════════════════════════════════════════════════════════════════════════
-- 0398 · DEVY IS A CHOICE WHEN THE LEAGUE IS MADE.
--
-- Founder: "It's not clear that you are creating a devy league in the league
-- creation. That should be a step."
--
-- College players (COLLEGE, 0365) were an ADMIN switch in the commissioner's
-- tools, so a devy league took an admin and three settings after creation.
-- commish_setup_devy(league, mode) lets the league's own commissioner make
-- it one: before the draft starts, in a classic league on the NFL calendar,
--   'spots'  → COLLEGE on and p_spots devy roster spots added on top of the
--              bench the league already has;
--   'shares' → COLLEGE on and the devy market (set_league_devy_mode, which
--              keeps its own rules: snake/linear draft, no devy spots).
-- Anything after the draft stays an admin/commissioner-tools matter.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function commish_setup_devy(p_league_id uuid, p_mode text, p_spots int default 3)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; r jsonb; sh jsonb; st int; drounds int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode not in ('spots', 'shares') then
    return jsonb_build_object('ok', false, 'error', 'devy is spots or shares');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'devy needs a classic league');
  end if;
  if exists (select 1 from draft where league_id = p_league_id and status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'devy is set up before the draft — after it, ask an admin');
  end if;
  if league_is_college_calendar(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'devy is for leagues on the NFL schedule');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('positions_extra',
           (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
              from jsonb_array_elements_text(coalesce(settings_json -> 'positions_extra', '[]'::jsonb) || '["COLLEGE"]'::jsonb) v))
   where id = p_league_id;
  if p_mode = 'spots' and coalesce(p_spots, 0) > 0 then
    -- The bench a league that never saved a shape implies is its draft rounds
    -- less the starters — the same default set_league_roster_shape uses.
    sh := _roster_shape(p_league_id); st := _classic_starters(p_league_id);
    select rounds into drounds from draft where league_id = p_league_id;
    r := set_league_roster_shape(p_league_id,
      case when sh = '{}'::jsonb then greatest(0, coalesce(drounds, 0) - st) else coalesce((sh ->> 'bench')::int, 0) end,
      coalesce((sh ->> 'taxi')::int, 0), coalesce((sh ->> 'ir')::int, 0), coalesce((sh ->> 'out')::int, 0),
      least(10, p_spots));
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;
  if p_mode = 'shares' then
    r := set_league_devy_mode(p_league_id, 'shares');
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;
grant execute on function commish_setup_devy(uuid, text, int) to authenticated;
