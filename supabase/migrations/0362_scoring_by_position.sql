-- ═══════════════════════════════════════════════════════════════════════════
-- 0362 · SCORING BY POSITION
--
-- Founder: "very fine grained scoring options. Like a tackle for QB at 50
-- points and a tackle for a WR at 20 points … scope it as per position
-- specific metric bonuses" (classic leagues only).
--
--   • offTackle — a new catalog knob: a tackle made by an OFFENSIVE player
--     (the live feed now credits the passing side's tacklers on an
--     interception return). Default 0, so no league's score moves.
--   • byPos — per-position overrides of any catalog value, stored inside
--     scoring_classic next to the table they override.
--
-- set_league_classic_scoring is 0209's body verbatim plus those two.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function set_league_classic_scoring(p_league_id uuid, p_scoring jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  yard_keys  text[] := array['passYd', 'rushYd', 'recYd', 'retYd', 'krYd', 'prYd', 'fgYd', 'fgYd30',
                             'idpSackYd', 'idpIntRetYd', 'idpFumRetYd', 'dstIntRetYd', 'dstFumRetYd', 'puntYd'];
  rate_keys  text[] := array['paPt', 'yaPt', 'hcPts'];
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
                             'stTackle', 'stFf', 'stFr', 'offTackle',
                             'fg0', 'fg20', 'fg30', 'fg40', 'fg50', 'fg60', 'fgMiss', 'xp', 'xpMiss',
                             'fgM0', 'fgM20', 'fgM30', 'fgM40', 'fgM50', 'fgM60',
                             'sack', 'dstInt', 'fumRec', 'dstTd', 'safety', 'dstBlk', 'dstFf', 'dstQbHit', 'dstPd',
                             'pa0', 'pa1', 'pa7', 'pa14', 'pa21', 'pa28', 'pa35',
                             'ya100', 'ya199', 'ya299', 'ya349', 'ya399', 'ya449', 'ya499', 'ya549', 'ya550',
                             'idpTackle', 'idpSack', 'idpInt', 'idpFr', 'idpTd', 'idpSafety',
                             'idpTackle10', 'idpSolo', 'idpAst', 'idpTfl', 'idpFf', 'idpQbHit', 'idpPd',
                             'idpIntRetTd50', 'idpFumRetTd50', 'idpSack2', 'idpPd3',
                             'hcWin', 'hcLoss', 'hcTie', 'hc3dc', 'hc4dc', 'hc2pt',
                             'hcWm1', 'hcWm5', 'hcWm10', 'hcWm15', 'hcWm20', 'hcWm25',
                             'hcLm1', 'hcLm5', 'hcLm10', 'hcLm15', 'hcLm20', 'hcLm25',
                             'puntPt', 'pta44', 'pta42', 'pta40', 'pta38', 'pta36', 'pta34', 'pta33'];
  cleaned jsonb := '{}'::jsonb; k text; v numeric;
  new_ppr numeric;                                             -- 0209
  bp jsonb := '{}'::jsonb; bpos text; brow jsonb; bclean jsonb;  -- 0362
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
  -- 0209: PER-RECEPTION POINTS, on its own clamp. [0, 5] at two decimals — see
  -- the header: one decimal would round a 0.25-PPR league to 0.3, and the
  -- per-yard cap of 1 would forbid 1.5.
  begin new_ppr := (p_scoring ->> 'ppr')::numeric; exception when others then new_ppr := null; end;
  if new_ppr is not null then
    new_ppr := round(least(5, greatest(0, new_ppr)) * 100) / 100;
    cleaned := cleaned || jsonb_build_object('ppr', new_ppr);
  end if;
  -- 0362: PER-POSITION OVERRIDES. A sparse { POS: { key: value } } layer the
  -- engine lays over the table for players scored at that position (core's
  -- scoringFor). Positions from a fixed list; keys from the same catalog as
  -- above; wider bounds than the table's (an override exists to hold a number
  -- the table would not): per-yard [-1, 2], everything else [-50, 100]. Which
  -- keys MEAN something for a position is the client's parseByPos — a stray
  -- one is stored harmlessly and ignored at scoring time.
  if jsonb_typeof(p_scoring -> 'byPos') = 'object' then
    for bpos, brow in select key, value from jsonb_each(p_scoring -> 'byPos') loop
      if upper(bpos) not in ('QB','RB','WR','TE','FB','K','DEF','DL','LB','DB','HC','P','RET')
         or jsonb_typeof(brow) <> 'object' then continue; end if;
      bclean := '{}'::jsonb;
      for k in select key from jsonb_each(brow) loop
        begin v := (brow ->> k)::numeric; exception when others then v := null; end;
        if v is null then continue; end if;
        if k = any (yard_keys) or k = any (rate_keys) then
          bclean := bclean || jsonb_build_object(k, round(least(2, greatest(-1, v)) * 1000) / 1000);
        elsif k = any (event_keys) or k = 'ppr' then
          bclean := bclean || jsonb_build_object(k, round(least(100, greatest(-50, v)) * 100) / 100);
        end if;
      end loop;
      if bclean <> '{}'::jsonb then bp := bp || jsonb_build_object(upper(bpos), bclean); end if;
    end loop;
    if bp <> '{}'::jsonb then cleaned := cleaned || jsonb_build_object('byPos', bp); end if;
  end if;
  update league set settings_json =
      case when cleaned = '{}'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'scoring_classic')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('scoring_classic', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  -- 0209: MIRROR OUT. Plenty of surfaces read settings_json.ppr directly and
  -- render sentences from it ("full PPR" on the invite preview, "1 pt per
  -- catch" on the board). Leaving it stale would make those sentences lie about
  -- a number the commissioner had just changed in front of them.
  if new_ppr is not null then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('ppr', new_ppr)
      where id = p_league_id;
  end if;
  return jsonb_build_object('ok', true, 'scoring', cleaned, 'ppr', new_ppr);
end $$;

grant execute on function set_league_classic_scoring(uuid, jsonb) to authenticated;
