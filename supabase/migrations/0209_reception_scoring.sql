-- 0209: PER-RECEPTION POINTS BECOME AN EDITABLE FIELD.
--
-- Founder, looking at the SCORING panel's RECEIVING section: "Do we have just
-- points for a reception?"
--
-- We did, and we didn't. `ClassicScoring.ppr` is a real scoring value — every
-- catch pays it (classic.ts: `pts += sc.ppr + (pos === 'TE' ? sc.teRec : …)`)
-- and it defaults to 1. But it was the ONE value in the catalog with no input
-- anywhere: 0157 gave it a dedicated `settings_json.ppr` home, v0.213.1 pulled
-- the RECEPTIONS pills off the game-mode tab, and it ended up reachable only
-- through the SCORING page's four PRESETS (0 / ½ / 1 / TE-premium). A preset
-- RESETS every other value, so you could not change PPR without losing your
-- tuning — and no value between the three steps was reachable at all.
--
-- So `ppr` joins the whitelist and gets a box like every other field.
--
-- ── THE TRAP THIS MIGRATION EXISTS TO AVOID ────────────────────────────────
-- `ppr` now has TWO homes: `settings_json.ppr` (0157's, which many surfaces
-- read directly as `gm.ppr` — the invite preview's "full PPR", the board's
-- "1 pt per catch" line) and `settings_json.scoring_classic.ppr` (the new
-- field). Two homes for one number is how a setting starts lying: save 0.5 in
-- one and every sentence rendered from the other still says "full PPR".
--
-- So BOTH WRITERS WRITE BOTH. `set_league_classic_scoring` mirrors ppr out to
-- `settings_json.ppr`, and `set_league_game_mode` (the presets) mirrors its ppr
-- INTO `scoring_classic`. They cannot diverge going forward, and for rows
-- written before today the client prefers `scoring_classic.ppr` when it is
-- there (see leagueCatalogOf).
--
-- ── THE CLAMP IS ITS OWN ────────────────────────────────────────────────────
-- Not `event_keys`: those round to ONE decimal, which would silently turn a
-- quarter-point-per-catch league into 0.3. Not `yard_keys` either: those cap at
-- 1, and 1.5 PPR is a real (if rare) setting. `ppr` gets [0, 5] at two
-- decimals — every PPR anyone actually plays, at the precision they write it.

-- ── set_league_classic_scoring v10 ─────────────────────────────────────────
-- Body copied VERBATIM from 0171's live definition; the changes are the new
-- `ppr` clamp block and the settings_json.ppr mirror, both marked 0209.
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
  new_ppr numeric;                                             -- 0209
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

-- ── set_league_game_mode v3 (0157 → 0158 → here) ───────────────────────────
-- Body copied VERBATIM from 0158's live definition; the change is the 0209
-- mirror INTO scoring_classic, so the presets and the new field cannot drift
-- apart in the other direction.
create or replace function set_league_game_mode(p_league_id uuid, p_mode text, p_ppr numeric default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode not in ('drip', 'classic') then
    return jsonb_build_object('ok', false, 'error', 'mode must be drip or classic');
  end if;
  -- The three preset steps stay the only values THIS entry point accepts: it is
  -- the preset path, and a preset is a named starting point. Any other number
  -- goes through the scoring field, which is what 0209 added.
  if p_ppr is not null and p_ppr not in (0, 0.5, 1) then
    return jsonb_build_object('ok', false, 'error', 'ppr must be 0, 0.5 or 1');
  end if;
  if p_mode = 'classic' and coalesce((select (settings_json ->> 'classic_ok')::boolean
      from league where id = p_league_id), false) is not true then
    return jsonb_build_object('ok', false, 'error', 'classic mode is not enabled for this league');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'game mode locks once the draft starts');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('game_mode', p_mode)
      || case when p_ppr is null then '{}'::jsonb else jsonb_build_object('ppr', p_ppr) end
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  -- 0209: keep the scoring catalog's copy in step. Without this, applying a
  -- preset would leave a stale `scoring_classic.ppr` behind it, and the field
  -- the commissioner reads next would show the value the preset just replaced.
  if p_ppr is not null and (select settings_json -> 'scoring_classic' from league where id = p_league_id) is not null then
    update league set settings_json = jsonb_set(settings_json, '{scoring_classic,ppr}', to_jsonb(p_ppr))
      where id = p_league_id;
  end if;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;
