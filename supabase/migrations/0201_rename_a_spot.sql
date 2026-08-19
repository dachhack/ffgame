-- 0201: A SPOT CAN BE RENAMED AFTER THE DRAFT.
--
-- Founder: "I changed a starting roster spot label but it didn't take."
--
-- It didn't take because 0181 froze the whole lineup spec at the draft and
-- required every surviving spot to be byte-identical to what was drafted. That
-- freeze is right for everything that DECIDES something — slot names are
-- positional (S1…Sn), so editing a spot's eligibility would silently reassign
-- every saved lineup beneath it — and wrong for the one field that decides
-- nothing.
--
-- 0174 introduced the label and said so in its own docblock: "PRESENTATION
-- ONLY… a label can never make a spot behave differently than it reads." Then
-- it rode the same setter as everything else, and inherited a freeze that had
-- no reason to apply to it. Renaming reassigns nothing: S3 is S3 whether it
-- reads FLEX or "Nate's Revenge".
--
-- Two changes, both narrow: post-draft the spot comparison ignores `label`, and
-- a SAME-LENGTH save is allowed (a rename removes no spots, so the old
-- `n >= length` guard refused every one of them before the loop even ran).
-- Positions, best ball, the per-spot filters and the zero-fill are all still
-- frozen exactly as they were.

-- ─────────────────────────────────────────────────────────────────────────────
-- set_league_classic_slots — 0200's body, with the rename hatch
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  extras jsonb; cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  farr jsonb;
  n int; i int; seen text[]; dstat text;
  obj jsonb; tarr jsonb; v text; mn int; mx int; lbl text; zp int;
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
    -- ── FLAGS AS A CONDITION (0197) ────────────────────────────────────────
    -- The commissioner's own labels (0141), so they are free text rather than
    -- codes: trimmed, deduped case-insensitively, ≤8 per spot and ≤24 chars
    -- each — the same bound the flag label itself carries. Only a player
    -- wearing one of them may fill the spot.
    farr := '[]'::jsonb;
    if jsonb_typeof(spot -> 'flags') = 'array' and jsonb_array_length(spot -> 'flags') > 0 then
      if jsonb_array_length(spot -> 'flags') > 8 then
        return jsonb_build_object('ok', false, 'error', 'at most 8 flags per spot');
      end if;
      for ps in select * from jsonb_array_elements(spot -> 'flags') loop
        v := btrim(trim(both '"' from ps::text));
        if v = '' then continue; end if;
        if length(v) > 24 then
          return jsonb_build_object('ok', false, 'error', 'flag name too long: ' || v);
        end if;
        if not exists (select 1 from jsonb_array_elements_text(farr) x where lower(x) = lower(v)) then
          farr := farr || to_jsonb(array[v]);
        end if;
      end loop;
      if jsonb_array_length(farr) > 0 then obj := obj || jsonb_build_object('flags', farr); end if;
    end if;
    -- ── THE ZERO-FILL RULE (0200) ─────────────────────────────────────────
    -- Founder: "any unfilled starting roster spot or any starting roster spot
    -- that gets 0 points in a week gets assigned a designated point total
    -- (usually 10)". Per SPOT, because that is how it was described — a rule
    -- you add to each roster spot — and because a league may well want it on
    -- the flex and not on the quarterback.
    --
    -- "These spots can't also be best ball", and it could hardly be otherwise:
    -- a best-ball spot fills itself from whoever is left, so UNFILLED is not a
    -- state it has, and a spot that always has a body in it can only ever
    -- collect the fill by accident. Refused rather than silently dropped —
    -- storing half of what the commissioner asked for is the worse answer.
    zp := null;
    if spot ? 'zero_pts' and jsonb_typeof(spot -> 'zero_pts') <> 'null' then
      begin zp := (spot ->> 'zero_pts')::int; exception when others then
        return jsonb_build_object('ok', false, 'error', 'the zero-points rule needs a number');
      end;
    end if;
    if zp is not null then
      if zp < 0 or zp > 200 then
        return jsonb_build_object('ok', false, 'error', 'the zero-points rule must be 0-200 points');
      end if;
      if bb then
        return jsonb_build_object('ok', false, 'error',
          'a best-ball spot can''t also carry a zero-points rule — it fills itself, so it is never unfilled');
      end if;
      obj := obj || jsonb_build_object('zero_pts', zp);
    end if;
    -- Custom spot LABEL (0174): the commissioner's own name for the spot
    -- ("Only NFC Players"), shown in the builder and on the lineup boards in
    -- place of the derived FLEX/QB tag. Trimmed, control characters stripped,
    -- capped at 24 so it can't blow out a row; empty stores nothing.
    lbl := btrim(regexp_replace(coalesce(spot ->> 'label', ''), '[[:cntrl:]]', '', 'g'));
    if length(lbl) > 24 then lbl := left(lbl, 24); end if;
    if lbl <> '' then obj := obj || jsonb_build_object('label', lbl); end if;
    cleaned := cleaned || jsonb_build_array(obj);
  end loop;
  -- ── THE POST-DRAFT HATCHES: SHRINK (0181), AND RENAME (0201) ─────────────
  -- 0181 allowed exactly one post-draft edit — removing spots from the end —
  -- and required every surviving spot to be byte-identical to what was drafted.
  -- The reason is real and unchanged: slot names are POSITIONAL (S1…Sn), so
  -- editing a spot's eligibility would silently reassign every saved lineup
  -- beneath it.
  --
  -- But a LABEL is presentation only. 0174 said so in its own docblock — "a
  -- label can never make a spot behave differently than it reads" — and then
  -- rode the same setter, so the freeze caught it too. A commissioner who
  -- renamed a spot in week 2 got "the starting lineup locks once the draft
  -- starts", which is true of the lineup and not true of its name. Renaming
  -- reassigns nothing: S3 is S3 whether it reads FLEX or "Nate's Revenge".
  --
  -- So post-draft the comparison ignores `label`, and a same-length save is
  -- allowed (a rename doesn't shrink anything). Everything that DECIDES
  -- something — positions, best ball, the filters, the zero-fill — still has to
  -- match what was drafted, exactly as before.
  if post_draft then
    stored := (select settings_json -> 'roster_slots' from league where id = p_league_id);
    if jsonb_typeof(stored) <> 'array' or n > jsonb_array_length(stored) then
      return jsonb_build_object('ok', false, 'error',
        'the starting lineup locks once the draft starts — post-draft you can rename spots, or shrink by removing them from the end');
    end if;
    for i in 0 .. n - 1 loop
      if ((cleaned -> i) - 'label') is distinct from ((stored -> i) - 'label') then
        return jsonb_build_object('ok', false, 'error',
          'post-draft a spot can only be RENAMED — what it accepts must stay exactly as drafted (slot names are positional; changing one would reassign every saved lineup beneath it)');
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
grant execute on function set_league_classic_slots(uuid, jsonb) to authenticated;
