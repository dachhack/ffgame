-- 0166 · Phase-1 TRUTH FLAGS: the play feed learns first downs, completions,
-- sacks-against and 2-pt conversions — and the scoring knobs they unlock.
--
-- The founder's "let's build 1" (docs/play-feed-enrichment-scope.md). Additive
-- end to end: legacy rows simply lack the flags, every new knob defaults to 0
-- (2-pt defaults to Sleeper's 2 but only flag-aware rows can carry it), so no
-- league's score moves until the feed + a commissioner's knob agree.
--
-- live_play grows four nullable flag columns (2-pt rows are their OWN kinds —
-- tp_pass/tp_rush/tp_rec — so they never collide with the same play's TD row
-- on the (week,game_id,pid,player_slug,k) conflict key).

alter table live_play add column if not exists fd int;
alter table live_play add column if not exists cp int;
alter table live_play add column if not exists ic int;
alter table live_play add column if not exists sk int;

-- ── Scoring whitelist widens with the Phase-1 knobs ─────────────────────────
create or replace function set_league_classic_scoring(p_league_id uuid, p_scoring jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yard_keys  text[] := array['passYd', 'rushYd', 'recYd', 'retYd', 'fgYd', 'fgYd30'];
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
