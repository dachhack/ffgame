-- 0197: SCOPED BONUSES LEARN TWO NEW SCOPES, AND A SPOT LEARNS A FLAG.
--
-- Founder, twice: "let's also allow scoped bonuses to apply to each/any of the
-- starting roster positions as a rule", and "we also want scoped bonuses for
-- flags and allow flags as a condition for position filters".
--
-- Three settings, one idea: the things a league already names — its STARTING
-- SPOTS (0163's builder) and its PLAYER FLAGS (0141) — become things a rule can
-- point at.
--
--   • A scoped bonus may name SLOTS. "S3 pays ×1.5" is a rule about the spot,
--     not about the player standing in it — which is what makes a superflex
--     premium, or a bonus for the returner spot, expressible at all. The engine
--     only pays a slot rule when it is scoring a player IN a slot; a card or a
--     projection, which scores nobody in particular, leaves it alone rather
--     than paying it everywhere.
--
--   • A scoped bonus may name FLAGS. Flags have carried their own ×/+ since
--     0144, one flag at a time; this is the other direction — one rule that
--     pays everyone wearing a label, written once instead of edited into each
--     flag. Matched on the label, case-insensitively, because the label is what
--     the commissioner typed and what the league reads.
--
--   • A SPOT may require a flag. The spot-level twin: "only a player wearing
--     FRANCHISE TAG may stand here". Same no-guess rule the tenure filter
--     follows — an unflagged player cannot prove he qualifies, so he can't fill
--     it.
--
-- Both sanitizers are re-issued with the new fields threaded through; anything
-- they do not recognise is still dropped, which is what keeps a settings blob
-- from becoming a place to store arbitrary JSON.

-- ─────────────────────────────────────────────────────────────────────────────
-- sanitize_scoped_rules — 0146's body (the LIVE one: bonus_pts at scale 1,
-- which 0145's predates), plus slot + flag scopes
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function sanitize_scoped_rules(p jsonb) returns jsonb
  language plpgsql immutable as $$
declare out jsonb := '[]'::jsonb; e jsonb; r jsonb; m numeric; b numeric; td int; arr jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' then return '[]'::jsonb; end if;
  for e in select * from jsonb_array_elements(p) loop
    exit when jsonb_array_length(out) >= 12;
    if jsonb_typeof(e) <> 'object' then continue; end if;
    r := '{}'::jsonb;
    -- filters: short uppercase code lists, bounded
    if jsonb_typeof(e -> 'pos') = 'array' then
      select coalesce(jsonb_agg(upper(left(v, 3))), '[]'::jsonb) into arr
        from (select distinct jsonb_array_elements_text(e -> 'pos') v limit 8) s where v ~ '^[A-Za-z]{1,3}$';
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('pos', arr); end if;
    end if;
    if jsonb_typeof(e -> 'team') = 'array' then
      select coalesce(jsonb_agg(upper(left(v, 3))), '[]'::jsonb) into arr
        from (select distinct jsonb_array_elements_text(e -> 'team') v limit 32) s where v ~ '^[A-Za-z]{2,3}$';
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('team', arr); end if;
    end if;
    if e ->> 'tenure' in ('rookie', 'y2_3', 'vet4') then r := r || jsonb_build_object('tenure', e ->> 'tenure'); end if;
    -- ── THE SPOT HE IS STANDING IN (0197) ──────────────────────────────────
    -- Slot ids from the league's own lineup ("S1".."S20"), so "the FLEX scores
    -- ×1.5" is a rule about the SPOT rather than about whoever fills it.
    if jsonb_typeof(e -> 'slot') = 'array' then
      select coalesce(jsonb_agg(upper(v)), '[]'::jsonb) into arr
        from (select distinct jsonb_array_elements_text(e -> 'slot') v limit 20) s
        where v ~ '^[A-Za-z][A-Za-z0-9]{0,7}$';
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('slot', arr); end if;
    end if;
    -- ── THE FLAG HE WEARS (0197) ───────────────────────────────────────────
    -- The commissioner's labels, free text, matched case-insensitively by the
    -- engine. Trimmed and length-bounded here; NOT uppercased, because the
    -- label is displayed as typed.
    if jsonb_typeof(e -> 'flag') = 'array' then
      select coalesce(jsonb_agg(btrim(v)), '[]'::jsonb) into arr
        from (select distinct jsonb_array_elements_text(e -> 'flag') v limit 12) s
        where btrim(v) <> '' and length(btrim(v)) <= 24;
      if jsonb_array_length(arr) > 0 then r := r || jsonb_build_object('flag', arr); end if;
    end if;
    -- values
    m := trim_scale(round(least(3, greatest(0.5, coalesce((e ->> 'bonus_mult')::numeric, 1))), 1));
    if m <> 1 then r := r || jsonb_build_object('bonus_mult', m); end if;
    b := trim_scale(round(least(10, greatest(-10, coalesce((e ->> 'bonus_pts')::numeric, 0))), 1));
    if b <> 0 then r := r || jsonb_build_object('bonus_pts', b); end if;
    td := least(6, greatest(-3, coalesce((e ->> 'td_bonus')::numeric, 0)::int));
    if td <> 0 then r := r || jsonb_build_object('td_bonus', td); end if;
    -- a rule with no VALUE does nothing — drop it
    if (r ? 'bonus_mult') or (r ? 'bonus_pts') or (r ? 'td_bonus') then out := out || jsonb_build_array(r); end if;
  end loop;
  return out;
exception when others then return '[]'::jsonb;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_league_classic_slots — 0181's body, plus the per-spot flag condition
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  extras jsonb; cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  farr jsonb;
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
grant execute on function set_league_classic_slots(uuid, jsonb) to authenticated;
