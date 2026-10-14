-- 0501: COPIES (0500), part 2 — the draft room is told how many copies of
-- each player the league runs, so the board can say "1 of 2 left" and the
-- commissioner's draft setup can show the setting.

create or replace function draft_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; d draft%rowtype; pl record; nrook int; lseas text;
begin
  r := _draft_state_0269(p_league_id);
  if r ? 'error' then return r; end if;
  select * into d from draft where league_id = p_league_id;
  if d.status = 'pending' then
    select * into pl from _draft_plan(p_league_id);
    select season into lseas from league where id = p_league_id;
    select count(distinct pa.round) into nrook from pick_asset pa
     where pa.league_id = p_league_id and pa.season = lseas and pa.round < 100;
    r := r || jsonb_build_object('devy_rounds', pl.devy,
      'rounds', case when d.mode = 'snake' and nrook > 0 then to_jsonb(nrook + pl.devy)
                     when pl.devy > 0 then to_jsonb(greatest(pl.main, 0) + pl.devy)
                     else (r -> 'rounds') end);
  else
    r := r || jsonb_build_object('devy_rounds', d.devy_rounds, 'devy_from', d.devy_from);
  end if;
  return r || jsonb_build_object('copies', league_copies(p_league_id));
end $$;
grant execute on function draft_state(uuid) to authenticated;

-- league_game_mode: 0450's, plus the copies count — every screen that
-- filters the wire or names a player's owner already reads this.
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
      'copies', league_copies(p_league_id),
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league l where l.id = p_league_id);
end $$;
