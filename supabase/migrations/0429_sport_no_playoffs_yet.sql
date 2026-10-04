-- 0429 — A SPORT LEAGUE PLAYS NO BRACKET YET (v0.620.0).
--
-- The playoff rules read NFL weeks: league_playoff_start defaults to 15 and
-- "the regular season is final" is judged over weeks up to
-- league_last_regular_week. A sport league's matchups sit at 301+, so those
-- checks are vacuously satisfied and generate_playoffs would book a bracket
-- over a season that has not begun. Until period-aware playoffs exist, the
-- wrapper (0246's) refuses for a sport league — quietly for the auto poke,
-- with a message for the commissioner's click. The worker's progression
-- sweep skips sport leagues too (server/src/native.js).
--
-- Undo: restore 0246's generate_playoffs.

create or replace function generate_playoffs(p_league_id uuid, p_seeds jsonb default null, p_auto boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if league_sport(p_league_id) <> 'nfl' then
    if p_auto then return jsonb_build_object('ok', true, 'generated', false, 'playoffs', 'sport'); end if;
    return jsonb_build_object('ok', false, 'error', 'playoffs for daily-sport leagues are not built yet — the regular-season table decides');
  end if;
  if league_playoff_teams(p_league_id) = 0 then
    if p_auto then return jsonb_build_object('ok', true, 'generated', false, 'playoffs', 'off'); end if;
    return jsonb_build_object('ok', false, 'error', 'this league plays no playoffs — turn them on in the commissioner tools first');
  end if;
  return generate_playoffs_bracket(p_league_id, p_seeds, p_auto);
end $$;
grant execute on function generate_playoffs(uuid, jsonb, boolean) to authenticated;
