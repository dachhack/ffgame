-- 0168 · Phase-3 IDP FIDELITY: solo/assist splits, tackles for loss, forced
-- fumbles, and individual defender credit for sacks / INTs / recoveries.
--
-- The founder's "let's build 3" (docs/play-feed-enrichment-scope.md). Live
-- sourcing only, per the recorded Phase-3 decision: ESPN's play text carries
-- the tacklers ("(M.Parsons)" solo, "(K.Elam; T.Bernard)" split), the forcer
-- ("FUMBLES (…)"), the interceptor and the recoverer — QB hits and passes
-- defended do NOT ride the live text reliably, so those knobs wait for the
-- nflverse true-up loop, and the 2025 bake waits on an IDP crosswalk
-- (defender gsis ids) — both offseason work. Additive like 0166/0167: new
-- kinds (tfl / ff) are invisible to legacy scorers, `tt`/`hf` are absent on
-- legacy rows, IDP split knobs default 0 (team forced fumble defaults to
-- Sleeper's 1 — only newly-emitted rows carry the kind).

alter table live_play add column if not exists tt text;
alter table live_play add column if not exists hf int;

-- ── Scoring whitelist widens with the Phase-3 knobs ─────────────────────────
create or replace function set_league_classic_scoring(p_league_id uuid, p_scoring jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yard_keys  text[] := array['passYd', 'rushYd', 'recYd', 'retYd', 'krYd', 'prYd', 'fgYd', 'fgYd30'];
  rate_keys  text[] := array['paPt', 'yaPt'];
  event_keys text[] := array['passTd', 'int', 'pass300', 'pass400',
                             'pass40', 'passTd40', 'passTd50',
                             'passCmp', 'passInc', 'passAtt', 'cmp25', 'qbSacked',
                             'passFd', 'rushFd', 'recFd',
                             'fdQb', 'fdRb', 'fdWr', 'fdTe',
                             'pass2pt', 'rush2pt', 'rec2pt',
                             'rushTd', 'rush100', 'rush200',
                             'rush40', 'rushTd40', 'rushTd50', 'carries20',
                             'recTd', 'teRec', 'rec100', 'rec200',
                             'rbRec', 'wrRec', 'targetPt',
                             'recB0', 'recB5', 'recB10', 'recB20', 'recB30', 'recB40',
                             'recTd40', 'recTd50',
                             'rr100', 'rr200',
                             'fumble', 'retTd',
                             'fg0', 'fg20', 'fg30', 'fg40', 'fg50', 'fg60', 'fgMiss', 'xp', 'xpMiss',
                             'sack', 'dstInt', 'fumRec', 'dstTd', 'safety', 'dstBlk', 'dstFf',
                             'pa0', 'pa1', 'pa7', 'pa14', 'pa21', 'pa28', 'pa35',
                             'ya100', 'ya199', 'ya299', 'ya349', 'ya399', 'ya449', 'ya499', 'ya549', 'ya550',
                             'idpTackle', 'idpSack', 'idpInt', 'idpFr', 'idpTd', 'idpSafety',
                             'idpTackle10', 'idpSolo', 'idpAst', 'idpTfl', 'idpFf'];
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
  foreach k in array rate_keys loop
    begin v := (p_scoring ->> k)::numeric; exception when others then v := null; end;
    if v is not null then
      cleaned := cleaned || jsonb_build_object(k, round(least(1, greatest(-1, v)) * 1000) / 1000);
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
