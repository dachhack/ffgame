-- 0181 — A FROZEN LINEUP MAY SHRINK FROM THE END, AND NOTHING ELSE.
--
-- HANDOFF NEXT #6. The starting-lineup spec freezes the moment the draft
-- leaves pending (0174), and that freeze is RIGHT in general: slot names are
-- positional (S1..Sn), so any edit that shifts a position would silently
-- reassign every saved lineup beneath it. But the freeze has one stuck state
-- with no exit: a league whose spec has MORE STARTING SPOTS THAN DRAFT ROUNDS
-- can never field a full lineup, and once the draft starts, nothing can fix
-- it. v0.233.0 warns before the draft; this is the escape hatch for the
-- league that drafted anyway.
--
-- THE HATCH IS EXACTLY AS NARROW AS THE HAZARD ALLOWS. Post-draft, the ONLY
-- accepted edit is a spec that is a STRICT PREFIX of the stored one — the
-- same spots, byte for byte in their cleaned form, with one or more removed
-- from the END. A tail spot's name (S16) is the only one whose removal shifts
-- nothing: every surviving slot keeps its name and its meaning, and any
-- stored rows for the dropped tail simply stop being fielded (the resolver
-- and the boards iterate the spec, so a non-spec row is inert, not an error).
-- Everything else — grow, reorder, edit a surviving spot, clear the spec —
-- stays refused with the same message as before.
--
-- The comparison runs on the CLEANED form of the submission against the
-- stored spec (which this same function cleaned when it was first saved), so
-- cosmetic differences — key order, lowercase position tokens, an explicit
-- bb:false — cannot fail a legitimate shrink.
--
-- Body copied from 0174 (the live definition — checked, not remembered: the
-- 0178 trigger bug came from editing a stale copy); the changes are the
-- post_draft flag, the null-path refusal, and the prefix gate after cleaning.

create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  extras jsonb; cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  n int; i int; seen text[]; dstat text;
  obj jsonb; tarr jsonb; v text; mn int; mx int; lbl text;
  post_draft boolean; stored jsonb;
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
  post_draft := dstat is not null and dstat <> 'pending';
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    -- Clearing the spec post-draft is not a shrink — it is a different lineup
    -- model (the 0161 counts), and switching models under saved rows is
    -- exactly what the freeze exists to prevent.
    if post_draft then
      return jsonb_build_object('ok', false, 'error', 'the starting lineup locks once the draft starts');
    end if;
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
    obj := jsonb_build_object('pos', to_jsonb(seen), 'bb', bb);
    -- Per-spot filter (0172): same validation the 0171 pool filter uses —
    -- team codes 2–4 uppercase letters (deduped, ≤32), tenure clamped 0..30.
    tarr := '[]'::jsonb;
    if jsonb_typeof(spot -> 'teams') = 'array' and jsonb_array_length(spot -> 'teams') > 0 then
      if jsonb_array_length(spot -> 'teams') > 32 then
        return jsonb_build_object('ok', false, 'error', 'at most 32 teams per spot');
      end if;
      for ps in select * from jsonb_array_elements(spot -> 'teams') loop
        v := upper(trim(both '"' from ps::text));
        if length(v) < 2 or length(v) > 4 or v !~ '^[A-Z]+$' then
          return jsonb_build_object('ok', false, 'error', 'bad team code: ' || v);
        end if;
        if not tarr @> to_jsonb(array[v]) then tarr := tarr || to_jsonb(array[v]); end if;
      end loop;
      obj := obj || jsonb_build_object('teams', tarr);
    end if;
    begin mn := (spot ->> 'min_exp')::int; exception when others then mn := null; end;
    begin mx := (spot ->> 'max_exp')::int; exception when others then mx := null; end;
    if mn is not null then mn := least(30, greatest(0, mn)); end if;
    if mx is not null then mx := least(30, greatest(0, mx)); end if;
    if mn is not null and mx is not null and mn > mx then
      return jsonb_build_object('ok', false, 'error', 'min tenure exceeds max');
    end if;
    if mn is not null then obj := obj || jsonb_build_object('min_exp', mn); end if;
    if mx is not null then obj := obj || jsonb_build_object('max_exp', mx); end if;
    -- Custom spot LABEL (0174): the commissioner's own name for the spot
    -- ("Only NFC Players"), shown in the builder and on the lineup boards in
    -- place of the derived FLEX/QB tag. Trimmed, control characters stripped,
    -- capped at 24 so it can't blow out a row; empty stores nothing.
    lbl := btrim(regexp_replace(coalesce(spot ->> 'label', ''), '[[:cntrl:]]', '', 'g'));
    if length(lbl) > 24 then lbl := left(lbl, 24); end if;
    if lbl <> '' then obj := obj || jsonb_build_object('label', lbl); end if;
    cleaned := cleaned || jsonb_build_array(obj);
  end loop;
  -- ── THE SHRINK HATCH (0181) — the only post-draft edit that exists ────────
  if post_draft then
    stored := (select settings_json -> 'roster_slots' from league where id = p_league_id);
    if jsonb_typeof(stored) <> 'array' or n >= jsonb_array_length(stored) then
      return jsonb_build_object('ok', false, 'error',
        'the starting lineup locks once the draft starts — post-draft it can only shrink, by removing spots from the end');
    end if;
    for i in 0 .. n - 1 loop
      if (cleaned -> i) is distinct from (stored -> i) then
        return jsonb_build_object('ok', false, 'error',
          'post-draft the lineup can only shrink from the end — the surviving spots must stay exactly as drafted (slot names are positional; editing one would reassign every saved lineup beneath it)');
      end if;
    end loop;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_slots', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);  -- pending drafts only, by its own guard
  return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n,
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;
