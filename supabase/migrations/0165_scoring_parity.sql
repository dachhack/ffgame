-- 0165 · Sleeper scoring parity — the whitelist widens to every knob the
-- play feed can honestly score, plus ESPN-style per-target points.
--
-- The founder's ask (8/16, with all fifteen Sleeper screenshots): "make sure
-- we have these in our normie leagues" — and, mid-pass: "ESPN also has
-- targets which sleeper doesn't have. Let's get targets in."
--
-- New keys (engine 'classic.ts' owns defaults; same 0160 contract):
--   passing    pass40 passTd40 passTd50
--   rushing    rush40 rushTd40 rushTd50 carries20
--   receiving  rbRec wrRec targetPt recB0 recB5 recB10 recB20 recB30 recB40
--              recTd40 recTd50
--   combined   rr100 rr200
--   kicking    fg60 (band; fg50 narrows to 50-59) + per-yard fgYd fgYd30
--   idp        idpTackle10
--
-- NOT added, deliberately: Sleeper/ESPN categories the play feed can't score
-- (first downs, 2-pt, completions/attempts, points-allowed brackets, blocked
-- kicks, solo/assist splits, punting, coach scoring…) — a knob that does
-- nothing is a trap. Catalog + data gaps recorded in docs/espn-scoring-notes.md.

create or replace function set_league_classic_scoring(p_league_id uuid, p_scoring jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yard_keys  text[] := array['passYd', 'rushYd', 'recYd', 'retYd', 'fgYd', 'fgYd30'];
  event_keys text[] := array['passTd', 'int', 'pass300', 'pass400',
                             'pass40', 'passTd40', 'passTd50',
                             'rushTd', 'rush100', 'rush200',
                             'rush40', 'rushTd40', 'rushTd50', 'carries20',
                             'recTd', 'teRec', 'rec100', 'rec200',
                             'rbRec', 'wrRec', 'targetPt',
                             'recB0', 'recB5', 'recB10', 'recB20', 'recB30', 'recB40',
                             'recTd40', 'recTd50',
                             'rr100', 'rr200',
                             'fumble', 'retTd',
                             'fg0', 'fg20', 'fg30', 'fg40', 'fg50', 'fg60', 'fgMiss', 'xp', 'xpMiss',
                             'sack', 'dstInt', 'fumRec', 'dstTd', 'safety',
                             'idpTackle', 'idpSack', 'idpInt', 'idpFr', 'idpTd', 'idpSafety',
                             'idpTackle10'];
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
