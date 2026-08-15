-- 0160: FULL COMMISSIONER SCORING for classic (normie) leagues — the founder's
-- "full commish-editable scoring settings for normie leagues". Every number
-- the classic scorer uses becomes a league knob: per-yard rates, TD values,
-- turnovers, the kicker's distance ladder, the DST line.
--
-- Storage: settings_json.scoring_classic, camelCase keys MATCHING the engine's
-- ClassicScoring interface (packages/core/src/engine/classic.ts) so there is
-- no mapping layer to drift. SQL knows the KEY LIST and the CLAMPS, never the
-- defaults — those live in the engine alone (DEFAULT_CLASSIC_SCORING), and
-- both resolvers + both boards normalize through it. An empty override object
-- clears the key entirely.
--
-- PPR is deliberately NOT here: it stays settings_json.ppr with its dedicated
-- RECEPTIONS control (0157), one source of truth per knob.
--
-- Editable ANY TIME, like the drip scoring adjustments (0143) — scoring is a
-- commissioner power, not a draft-frozen structural fact.
--
-- The player flags (0144) need no SQL for classic: the roster/start triggers
-- were always mode-agnostic, and the scoring rules (bonus_mult / bonus_pts /
-- no_start-in-best-ball) are engine-enforced in classic.ts exactly as the
-- drip resolvers enforce them.

create or replace function set_league_classic_scoring(p_league_id uuid, p_scoring jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  -- Per-yard rates clamp to [0, 1]; every event value clamps to [-10, 20].
  yard_keys  text[] := array['passYd', 'rushYd', 'recYd'];
  event_keys text[] := array['passTd', 'int', 'rushTd', 'recTd', 'fumble', 'retTd',
                             'fg0', 'fg40', 'fg50', 'fgMiss', 'xp', 'xpMiss',
                             'sack', 'dstInt', 'fumRec', 'dstTd', 'safety'];
  cleaned jsonb := '{}'::jsonb; k text; v numeric;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'classic scoring is a classic-league setting');
  end if;
  foreach k in array yard_keys loop
    begin v := (p_scoring ->> k)::numeric; exception when others then v := null; end;
    if v is not null then
      cleaned := cleaned || jsonb_build_object(k, round(least(1, greatest(0, v)) * 1000) / 1000);
    end if;
  end loop;
  foreach k in array event_keys loop
    begin v := (p_scoring ->> k)::numeric; exception when others then v := null; end;
    if v is not null then
      cleaned := cleaned || jsonb_build_object(k, round(least(20, greatest(-10, v)) * 10) / 10);
    end if;
  end loop;
  update league set settings_json =
      case when cleaned = '{}'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'scoring_classic')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('scoring_classic', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'scoring', cleaned);
end $$;

-- ── league_game_mode v4: hand the boards the override object ────────────────
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
      'scoring', coalesce(settings_json -> 'scoring_classic', '{}'::jsonb),
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league where id = p_league_id);
end $$;

grant execute on function set_league_classic_scoring(uuid, jsonb) to authenticated;
