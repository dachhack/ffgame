-- 0143: LEAGUE SCORING ADJUSTMENTS — the commissioner's layering knobs.
--
-- The engine's base scoring is measured-and-tuned and its catalog text quotes
-- the exact numbers, so leagues do not edit literals. What a commissioner
-- sets here LAYERS on top (engine/leagueScoring.ts is the authority on what
-- each knob touches):
--   • td_bonus   [-3..+6, int]  extra points on every TD a fielded player
--                               scores (defensive TDs included);
--   • yd_mult    [0.5..2, 0.1]  multiplies all yardage-derived scoring —
--                               flat per-yard points and drip-rate growth;
--   • to_penalty [0..5, int]    points removed from a player's own bank when
--                               he commits a turnover (clamped at zero — banks
--                               never go negative).
--
-- Stored in settings_json.scoring; ALL-DEFAULT settings store NOTHING (the
-- key is removed), so "no adjustments" and "never touched" are the same
-- state and every existing league scores bit-for-bit as before.
--
-- Enforcement is client + worker reading the same core parseScoring — this
-- migration only stores and gates. Changing scoring mid-week changes how the
-- CURRENT week resolves from the next tick; that is the commissioner's power
-- and their responsibility — the UI says so.

create or replace function set_league_scoring(
  p_league_id uuid, p_td_bonus int, p_yd_mult numeric, p_to_penalty int
) returns jsonb language plpgsql security definer set search_path = public as $$
declare ym numeric := round(coalesce(p_yd_mult, 1)::numeric, 1);
        tb int := coalesce(p_td_bonus, 0);
        tp int := coalesce(p_to_penalty, 0);
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if tb < -3 or tb > 6 then
    return jsonb_build_object('ok', false, 'error', 'TD bonus must be between -3 and +6');
  end if;
  if ym < 0.5 or ym > 2 then
    return jsonb_build_object('ok', false, 'error', 'yardage multiplier must be between 0.5 and 2');
  end if;
  if tp < 0 or tp > 5 then
    return jsonb_build_object('ok', false, 'error', 'turnover penalty must be between 0 and 5');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when tb = 0 and ym = 1 and tp = 0
              then jsonb_build_object('scoring', null)   -- all-default stores nothing
              else jsonb_build_object('scoring', jsonb_build_object(
                     'td_bonus', tb, 'yd_mult', ym, 'to_penalty', tp)) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'td_bonus', tb, 'yd_mult', ym, 'to_penalty', tp);
end $$;

-- The league's adjustments + whether the caller may edit — one banner read.
create or replace function league_scoring(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sc jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select settings_json -> 'scoring' into sc from league where id = p_league_id;
  return jsonb_build_object('ok', true,
    'td_bonus',   coalesce((sc ->> 'td_bonus')::int, 0),
    'yd_mult',    coalesce((sc ->> 'yd_mult')::numeric, 1),
    'to_penalty', coalesce((sc ->> 'to_penalty')::int, 0),
    'can_edit', is_admin() or is_league_commish(p_league_id));
end $$;

grant execute on function set_league_scoring(uuid, int, numeric, int) to authenticated;
grant execute on function league_scoring(uuid) to authenticated;
