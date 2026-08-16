-- 0170 · GAP CLOSE for every rosterable normie position — "let's do them all."
--
-- Missed-FG distance bands; IDP sack yards + 2+ sack / 3+ PD game bonuses;
-- INT/fumble RETURN YARDS (team + IDP) with the 50+ return-TD bonuses;
-- pick-6 thrown (a `p6` flag on the QB's INT row — never `td`, so TD points
-- can't fire on a pick); FUMBLE (ANY) + own-team fumble-recovery TD as new
-- kinds; SPECIAL TEAMS PLAYER solo tackle / forced fumble / recovery (new
-- `st_tkl` kind — coverage tackles never inflate scrimmage tackle counts);
-- and the two formerly-INERT knobs come alive: individual defensive TD and
-- safety rows, from live text (interceptor/recoverer on return TDs) plus the
-- nflverse true-up's exact td_player_id / safety_player_id.
--
-- live_play grows the one flag column; the scoring whitelist widens by 21.

alter table live_play add column if not exists p6 int;

create or replace function set_league_classic_scoring(p_league_id uuid, p_scoring jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yard_keys  text[] := array['passYd', 'rushYd', 'recYd', 'retYd', 'krYd', 'prYd', 'fgYd', 'fgYd30',
                             'idpSackYd', 'idpIntRetYd', 'idpFumRetYd', 'dstIntRetYd', 'dstFumRetYd'];
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
                             'fumble', 'retTd', 'fumbleAny', 'fumRecTd', 'qbPick6',
                             'stTackle', 'stFf', 'stFr',
                             'fg0', 'fg20', 'fg30', 'fg40', 'fg50', 'fg60', 'fgMiss', 'xp', 'xpMiss',
                             'fgM0', 'fgM20', 'fgM30', 'fgM40', 'fgM50', 'fgM60',
                             'sack', 'dstInt', 'fumRec', 'dstTd', 'safety', 'dstBlk', 'dstFf', 'dstQbHit', 'dstPd',
                             'pa0', 'pa1', 'pa7', 'pa14', 'pa21', 'pa28', 'pa35',
                             'ya100', 'ya199', 'ya299', 'ya349', 'ya399', 'ya449', 'ya499', 'ya549', 'ya550',
                             'idpTackle', 'idpSack', 'idpInt', 'idpFr', 'idpTd', 'idpSafety',
                             'idpTackle10', 'idpSolo', 'idpAst', 'idpTfl', 'idpFf', 'idpQbHit', 'idpPd',
                             'idpIntRetTd50', 'idpFumRetTd50', 'idpSack2', 'idpPd3'];
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
