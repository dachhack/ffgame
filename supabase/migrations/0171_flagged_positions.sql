-- 0171 · FLAGGED POSITIONS + POOL FILTERS — "build coaches, punters, IDP,
-- fullbacks, returners… feature flagged by league on admin decision", plus
-- the commissioner's allowable-player filters for the roster builder.
--
-- Enforcement model: league_pool IS the gate — drafts, waivers, adds and
-- lineups all key off it (native_roster carries a hard FK), so both features
-- decide membership at SEED time and every downstream surface follows.
--   • settings_json.positions_extra — ADMIN-set subset of HC/P/IDP/FB/RET
--     (mirrors the classic_ok unlock pattern). Builder chips + pool seeding
--     read it; set_league_classic_slots admits the extra tokens only when
--     enabled. RET is a lineup-slot identity (return-only scoring) and must
--     stand alone in its spot.
--   • settings_json.pool_filter — COMMISSIONER-set, pre-draft: a team
--     whitelist and/or tenure window (Sleeper years_exp; 0 = rookie).
--     Applied when the pool is (re)seeded.

-- ── Admin: which extra position groups a league may use ─────────────────────
create or replace function set_league_position_access(p_league_id uuid, p_positions jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare allowed text[] := array['HC','P','IDP','FB','RET']; cleaned jsonb := '[]'::jsonb; ps jsonb; v text;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'admin only'); end if;
  if p_positions is not null and jsonb_typeof(p_positions) = 'array' then
    for ps in select * from jsonb_array_elements(p_positions) loop
      v := upper(trim(both '"' from ps::text));
      if not (v = any (allowed)) then
        return jsonb_build_object('ok', false, 'error', 'unknown position group: ' || v);
      end if;
      if not cleaned @> to_jsonb(array[v]) then cleaned := cleaned || to_jsonb(array[v]); end if;
    end loop;
  end if;
  update league set settings_json =
      case when cleaned = '[]'::jsonb
           then (coalesce(settings_json, '{}'::jsonb) - 'positions_extra')
           else coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('positions_extra', cleaned) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'positions', cleaned);
end $$;
grant execute on function set_league_position_access(uuid, jsonb) to authenticated;

-- ── Commissioner: allowable-player filter (pre-draft) ───────────────────────
create or replace function set_league_pool_filter(p_league_id uuid, p_filter jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; cleaned jsonb := '{}'::jsonb; tarr jsonb := '[]'::jsonb; ps jsonb; v text; mn int; mx int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'player filters lock once the draft starts');
  end if;
  if p_filter is null or jsonb_typeof(p_filter) <> 'object' or p_filter = '{}'::jsonb then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) - 'pool_filter'
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
    return jsonb_build_object('ok', true, 'filter', null);
  end if;
  if jsonb_typeof(p_filter -> 'teams') = 'array' and jsonb_array_length(p_filter -> 'teams') > 0 then
    if jsonb_array_length(p_filter -> 'teams') > 32 then
      return jsonb_build_object('ok', false, 'error', 'at most 32 teams');
    end if;
    for ps in select * from jsonb_array_elements(p_filter -> 'teams') loop
      v := upper(trim(both '"' from ps::text));
      if length(v) < 2 or length(v) > 4 or v !~ '^[A-Z]+$' then
        return jsonb_build_object('ok', false, 'error', 'bad team code: ' || v);
      end if;
      if not tarr @> to_jsonb(array[v]) then tarr := tarr || to_jsonb(array[v]); end if;
    end loop;
    cleaned := cleaned || jsonb_build_object('teams', tarr);
  end if;
  begin mn := (p_filter ->> 'min_exp')::int; exception when others then mn := null; end;
  begin mx := (p_filter ->> 'max_exp')::int; exception when others then mx := null; end;
  if mn is not null then cleaned := cleaned || jsonb_build_object('min_exp', least(30, greatest(0, mn))); end if;
  if mx is not null then cleaned := cleaned || jsonb_build_object('max_exp', least(30, greatest(0, mx))); end if;
  if mn is not null and mx is not null and mn > mx then
    return jsonb_build_object('ok', false, 'error', 'min tenure exceeds max');
  end if;
  if cleaned = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'the filter needs teams or a tenure window');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('pool_filter', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'filter', cleaned);
end $$;
grant execute on function set_league_pool_filter(uuid, jsonb) to authenticated;

-- ── Builder v3: base positions + this league's enabled extras; RET stands alone ──
create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  extras jsonb; cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  n int; i int; seen text[]; dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster builder is a classic-league setting');
  end if;
  -- The admin's flags widen the token set for THIS league (0171). IDP is the
  -- gate for the three defender groups; FB/HC/P/RET admit themselves.
  extras := coalesce((select settings_json -> 'positions_extra' from league where id = p_league_id), '[]'::jsonb);
  if extras @> '["FB"]'::jsonb then positions := array_append(positions, 'FB'); end if;
  if extras @> '["HC"]'::jsonb then positions := array_append(positions, 'HC'); end if;
  if extras @> '["P"]'::jsonb  then positions := array_append(positions, 'P');  end if;
  if extras @> '["RET"]'::jsonb then positions := array_append(positions, 'RET'); end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'the starting lineup locks once the draft starts');
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) - 'roster_slots'
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
    perform _sync_classic_rounds(p_league_id);
    return jsonb_build_object('ok', true, 'slots', null);
  end if;
  n := jsonb_array_length(p_slots);
  if n > 20 then return jsonb_build_object('ok', false, 'error', 'lineups cap at 20 starters'); end if;
  for i in 0 .. n - 1 loop
    spot := p_slots -> i;
    if jsonb_typeof(spot) <> 'object' or jsonb_typeof(spot -> 'pos') <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'each spot needs an eligible-position list');
    end if;
    seen := array[]::text[];
    for ps in select * from jsonb_array_elements(spot -> 'pos') loop
      p := upper(trim(both '"' from ps::text));
      if not (p = any (positions)) then
        return jsonb_build_object('ok', false, 'error', 'unknown position: ' || p);
      end if;
      if p = any (array['DL','LB','DB']) and not extras @> '["IDP"]'::jsonb then
        -- pre-0171 leagues that already used IDP spots keep them via the
        -- stored spec; NEW saves need the admin flag.
        return jsonb_build_object('ok', false, 'error', 'IDP positions need the admin flag');
      end if;
      if not (p = any (seen)) then seen := seen || p; end if;
    end loop;
    if coalesce(array_length(seen, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'error', 'each spot needs at least one eligible position');
    end if;
    if 'RET' = any (seen) and array_length(seen, 1) > 1 then
      return jsonb_build_object('ok', false, 'error', 'a RETURNER spot stands alone — it scores return production only');
    end if;
    begin bb := coalesce((spot ->> 'bb')::boolean, false); exception when others then bb := false; end;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object('pos', to_jsonb(seen), 'bb', bb));
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_slots', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n,
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;

-- ── league_game_mode v8: + positions + pool_filter ──────────────────────────
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
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league l where l.id = p_league_id);
end $$;

-- ── Scoring whitelist: + head coach (19) + punting (9) ──────────────────────
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
                             'stTackle', 'stFf', 'stFr',
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
