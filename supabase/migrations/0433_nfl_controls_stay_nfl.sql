-- 0433 — THE NFL'S CONTROLS DO NOT REACH A SPORT LEAGUE (v0.625.0).
--
-- Playtest, the founder: "Drip should only be available for NFL." "Roster
-- settings … still NFL." "Waivers are still NFL." A sport league (0426) is
-- classic by construction, but every commissioner door built before it still
-- opened: DRIP, guillotine, contracts, the NFL lineup builder, the NFL pool
-- reseed, the week-1-to-18 trade deadline, the after-games waiver hold that
-- reads nfl_slate, the schedule shift onto the next open NFL week, and the
-- bracket. Each is re-issued from its latest body with one guard; the bodies
-- are otherwise byte for byte what they were. Dynasty and keeper continuity
-- stay open to a sport league — the founder wants MLB dynasty.
--
-- Undo: re-run the previous definition of each function (named in the
-- comment above it).

-- ── set_league_game_mode: 0365_college_players.sql's body, plus the sport guard ──
create or replace function set_league_game_mode(p_league_id uuid, p_mode text, p_ppr numeric default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if p_mode = 'drip' and league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'Drip is the NFL game — a daily-sport league plays classic');
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
  -- 0365: Drip mode is NFL-only.
  if p_mode = 'drip' and _league_has_college((select settings_json from league where id = p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'a league with college players stays classic');
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

-- ── set_league_format: 0246_playoffs_off.sql's body, plus the sport guard ──
create or replace function set_league_format(p_league_id uuid, p_format text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare d draft%rowtype; f text; wks int; want int; sched jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if league_sport(p_league_id) <> 'nfl' and lower(btrim(coalesce(p_format, 'standard'))) <> 'standard' then
    return jsonb_build_object('ok', false, 'error', 'a daily-sport league plays head-to-head (points, categories or roto under SCORING)');
  end if;
  f := lower(btrim(coalesce(p_format, 'standard')));
  if f not in ('standard', 'guillotine', 'vampire') then
    return jsonb_build_object('ok', false, 'error', 'format must be standard, guillotine or vampire');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if f = 'guillotine' and d.status <> 'pending'
     and league_format(p_league_id) <> 'guillotine' then
    return jsonb_build_object('ok', false, 'error', 'guillotine must be chosen before the draft — it changes how the season scores');
  end if;
  if exists (select 1 from league_membership where league_id = p_league_id and eliminated_week is not null) then
    return jsonb_build_object('ok', false, 'error', 'the blade has already fallen — the format is locked for the season');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('format', f)
      || case when f = 'guillotine'
           then jsonb_build_object('waiver_mode', 'faab',
                  'faab_budget', coalesce(nullif(settings_json ->> 'faab_budget', '')::int, 1000),
                  -- 0246: the survivor IS the result, and the season runs
                  -- through week 17 — there is no room for a bracket and
                  -- nothing for it to decide.
                  'playoff_teams', 0)
           else '{}'::jsonb end
    where id = p_league_id;
  if f = 'guillotine' then
    delete from matchup where league_id = p_league_id and is_playoff and status = 'scheduled';
  end if;

  -- 0245: the season's length follows the format. Only re-cuts a schedule that
  -- already exists; at creation the client makes it at the right length.
  if exists (select 1 from matchup where league_id = p_league_id) then
    wks := (select count(distinct week) from matchup where league_id = p_league_id and not is_playoff);
    want := case when f = 'guillotine' then 17 else 14 end;
    if wks <> want then
      sched := native_generate_schedule(p_league_id, want);
      if not coalesce((sched ->> 'ok')::boolean, false) then
        return jsonb_build_object('ok', true, 'format', f,
          'schedule_error', sched ->> 'error', 'weeks', wks);
      end if;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'format', f,
    'weeks', (select count(distinct week) from matchup where league_id = p_league_id and not is_playoff));
end $$;

-- ── set_league_continuity: 0185_continuity.sql's body, plus the sport guard ──
create or replace function set_league_continuity(p_league_id uuid, p_mode text, p_n int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if league_sport(p_league_id) <> 'nfl' and lower(btrim(coalesce(p_mode, ''))) in ('contract', 'contract_dynasty') then
    return jsonb_build_object('ok', false, 'error', 'contracts are not built for a daily sport yet — redraft, keeper or dynasty');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if lg.is_mock or lg.kind <> 'league' then
    return jsonb_build_object('ok', false, 'error', 'continuity belongs to full leagues');
  end if;
  if _rollover_target(p_league_id) is not null then
    return jsonb_build_object('ok', false, 'error', 'this season already rolled over');
  end if;
  perform pg_advisory_xact_lock(hashtext(p_league_id::text));
  return _apply_continuity(p_league_id, lower(btrim(coalesce(p_mode, ''))), p_n);
end $$;

-- ── seed_league_pool: 0410_custom_college.sql's body, plus the sport guard ──
create or replace function seed_league_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; college boolean;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'a sport league''s pool comes from its directory (seed_sport_pool), not the NFL player list');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'draft already started');
  end if;
  if p_players is null or jsonb_typeof(p_players) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'players must be an array');
  end if;
  if jsonb_array_length(p_players) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'pool too large (max 2000)');
  end if;
  college := _league_has_college((select settings_json from league where id = p_league_id));

  delete from league_pool lp where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr
                    where nr.league_id = lp.league_id and nr.slug = lp.slug)
    -- 0410: a commissioner's custom college player is no directory's to drop
    and not exists (select 1 from college_custom cc where 'c-' || cc.espn_id = lp.slug);
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp, sleeper_id)
  select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
         -- 0365: a college row's ESPN id IS its slug's number; take it from
         -- there so the two can never disagree.
         case when (p ->> 'slug') ~ '^c-[0-9]+$' then substr(p ->> 'slug', 3)
              else nullif(btrim(coalesce(p ->> 'espn_id', '')), '') end,
         case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
              then least(30, greatest(0, (p ->> 'exp')::int)) end,
         -- Blank becomes NULL rather than '': the unique index is partial, and
         -- a pool full of empty strings would collide with itself on the first
         -- two team units.
         nullif(btrim(coalesce(p ->> 'sleeper_id', '')), '')
  from jsonb_array_elements(p_players) with ordinality as t(p, ord)
  where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
    and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
    -- 0365: college rows only where the admin turned COLLEGE on.
    and (college or (p ->> 'slug') !~ '^c-[0-9]+$')
  on conflict (league_id, slug) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n);
end $$;

-- ── set_league_classic_slots: 0383_college_eligibility_rules.sql's body, plus the sport guard ──
create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  extras jsonb; cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  farr jsonb;
  n int; i int; seen text[]; dstat text;
  obj jsonb; tarr jsonb; v text; mn int; mx int; lbl text; zp int;
  post_draft boolean; stored jsonb; lvl text; mixed boolean;
  old_n int; sh jsonb; carr jsonb; clarr jsonb; has_college boolean; bench int; held int; grew int := 0; wk int; changed text[] := '{}'; cleared int := 0; r int; line text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'a sport league''s lineup is set with set_sport_lineup');
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
  mixed := league_is_mixed(p_league_id);   -- 0372: only a mixed league's spots carry a level
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) = 0 then
    -- Clearing the spec post-draft is not a shrink — it is a different lineup
    -- model (the 0161 counts), and switching models under saved rows is
    -- exactly what the freeze exists to prevent.
    if post_draft then
      return jsonb_build_object('ok', false, 'error', 'a drafted league keeps a lineup — edit its spots instead of clearing them');
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
      -- A BEST-BALL SPOT MAY CARRY IT TOO (0304): see the header. The fill
      -- seats a body, but a body can still score nothing.
      obj := obj || jsonb_build_object('zero_pts', zp);
    end if;
    -- Custom spot LABEL (0174): the commissioner's own name for the spot
    -- ("Only NFC Players"), shown in the builder and on the lineup boards in
    -- place of the derived FLEX/QB tag. Trimmed, control characters stripped,
    -- capped at 24 so it can't blow out a row; empty stores nothing.
    -- LEVEL (0372): in a mixed league a spot may take NFL players only
    -- ('nfl'), college players only ('college'), or either (no key). Refused
    -- anywhere else rather than stored and ignored.
    -- COLLEGE RULES (0383): conferences / tiers and classes. Either makes the
    -- spot college-only, so it needs college players in the league and can't
    -- also be an NFL-only spot.
    carr := '[]'::jsonb; clarr := '[]'::jsonb;
    if jsonb_typeof(spot -> 'confs') = 'array' and jsonb_array_length(spot -> 'confs') > 0 then
      for ps in select * from jsonb_array_elements(spot -> 'confs') loop
        v := trim(both '"' from ps::text);
        if not (v = any (_college_rule_values())) then
          return jsonb_build_object('ok', false, 'error', 'unknown conference: ' || v);
        end if;
        if not carr @> to_jsonb(array[v]) then carr := carr || to_jsonb(array[v]); end if;
      end loop;
    end if;
    if jsonb_typeof(spot -> 'classes') = 'array' and jsonb_array_length(spot -> 'classes') > 0 then
      for ps in select * from jsonb_array_elements(spot -> 'classes') loop
        begin mn := (ps #>> '{}')::int; exception when others then mn := null; end;
        if mn is null or mn < 1 or mn > 4 then
          return jsonb_build_object('ok', false, 'error', 'a class is 1 (FR) to 4 (SR+)');
        end if;
        if not clarr @> to_jsonb(array[mn]) then clarr := clarr || to_jsonb(array[mn]); end if;
      end loop;
    end if;
    if jsonb_array_length(carr) > 0 or jsonb_array_length(clarr) > 0 then
      has_college := _league_has_college((select settings_json from league where id = p_league_id));
      if not has_college then
        return jsonb_build_object('ok', false, 'error', 'conference and class spots need college players turned on for this league');
      end if;
      if lower(coalesce(spot ->> 'level', '')) = 'nfl' then
        return jsonb_build_object('ok', false, 'error', 'a conference or class spot takes college players — it can''t also be NFL-only');
      end if;
      if jsonb_array_length(carr) > 0 then obj := obj || jsonb_build_object('confs', carr); end if;
      if jsonb_array_length(clarr) > 0 then obj := obj || jsonb_build_object('classes', clarr); end if;
    end if;
    lvl := nullif(lower(btrim(coalesce(spot ->> 'level', ''))), '');
    if lvl is not null then
      if lvl not in ('nfl', 'college') then
        return jsonb_build_object('ok', false, 'error', 'a spot''s level is nfl or college');
      end if;
      if not mixed then
        return jsonb_build_object('ok', false, 'error', 'NFL/college spots are for leagues where both score (COLLEGE on, NFL calendar, no devy spots)');
      end if;
      obj := obj || jsonb_build_object('level', lvl);
    end if;
    lbl := btrim(regexp_replace(coalesce(spot ->> 'label', ''), '[[:cntrl:]]', '', 'g'));
    if length(lbl) > 24 then lbl := left(lbl, 24); end if;
    if lbl <> '' then obj := obj || jsonb_build_object('label', lbl); end if;
    cleaned := cleaned || jsonb_build_array(obj);
  end loop;
  -- ── AFTER THE DRAFT (0376 → 0377) ─────────────────────────────────────────
  -- A rename is still free at any time (0201): labels are presentation only.
  -- Anything else — adding, removing or changing what a spot accepts — is
  -- allowed once the draft is COMPLETE and between weeks, and:
  --   • saved, unlocked lineups for weeks not yet played are cleared in every
  --     spot that changed (slot names are positional: S3 must not quietly
  --     start whoever was saved into the old S3);
  --   • teams stay legal: if fewer starting spots would leave a team holding
  --     more active players than starters + bench, the bench grows to fit;
  --   • the league hears about it in chat, old lineup → new.
  if post_draft then
    stored := (select settings_json -> 'roster_slots' from league where id = p_league_id);
    if not (jsonb_typeof(stored) = 'array' and n = jsonb_array_length(stored)
            and not exists (select 1 from generate_series(0, n - 1) g
                             where ((cleaned -> g) - 'label') is distinct from ((stored -> g) - 'label'))) then
      if dstat <> 'complete' then
        -- 0181's hatch survives the live draft: removing spots from the END,
        -- everything that stays exactly as drafted (labels aside).
        if not (jsonb_typeof(stored) = 'array' and n < jsonb_array_length(stored)
                and not exists (select 1 from generate_series(0, n - 1) g
                                 where ((cleaned -> g) - 'label') is distinct from ((stored -> g) - 'label'))) then
          return jsonb_build_object('ok', false, 'error',
            'the starting lineup can change once the draft is over — during the draft you can rename spots, or remove them from the end');
        end if;
      else
      select min(m.week) into wk from matchup m
       where m.league_id = p_league_id and m.status <> 'final'
         and (m.status = 'live' or m.lock_at <= now());
      if wk is not null then
        return jsonb_build_object('ok', false, 'error',
          'the starting lineup can change between weeks — '
          || case when wk > 200 then college_week_label(wk) else 'Week ' || wk end
          || ' is under way; try again once it''s final');
      end if;
      -- A position no spot would start can't be rostered (league_pos_cap, 0361),
      -- so a lineup that drops every spot for a position teams hold would make
      -- them illegal. Refused; an explicit cap blob is the commissioner's own
      -- word and is left to decide.
      if (select settings_json -> 'pos_caps' from league where id = p_league_id) is null then
        select lp.pos into lbl from native_roster nr
          join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
         where nr.league_id = p_league_id and nr.spot <> 'devy'
           and not exists (select 1 from jsonb_array_elements(cleaned) sp
                            where sp -> 'pos' @> to_jsonb(lp.pos)
                               or (lp.pos in ('RB', 'WR', 'TE', 'FB') and sp -> 'pos' @> '["RET"]'::jsonb))
         limit 1;
        if lbl is not null then
          return jsonb_build_object('ok', false, 'error',
            'teams hold ' || lbl || 's, and no spot in that lineup would start one — keep a spot that takes ' || lbl
            || ', or they have to be dropped first');
        end if;
      end if;
      old_n := _classic_starters(p_league_id);
      -- Which positional slots changed (S1…): any whose spec differs, and any
      -- that no longer exists.
      for i in 0 .. greatest(n, coalesce(jsonb_array_length(case when jsonb_typeof(stored) = 'array' then stored end), old_n)) - 1 loop
        if i >= n or jsonb_typeof(stored) <> 'array' or ((cleaned -> i) - 'label') is distinct from ((stored -> i) - 'label') then
          changed := changed || ('S' || (i + 1));
        end if;
      end loop;
      -- The bench: materialise a never-saved shape first (its bench is what
      -- the rounds held beyond the old starters), then grow it if needed.
      sh := _roster_shape(p_league_id);
      if sh = '{}'::jsonb then
        sh := jsonb_build_object('bench', greatest(0, coalesce((select rounds from draft where league_id = p_league_id), old_n) - old_n),
                                 'taxi', 0, 'ir', 0, 'out', 0);
      end if;
      bench := coalesce((sh ->> 'bench')::int, 0);
      select coalesce(max(c), 0) into held from (
        select count(*) as c from native_roster nr where nr.league_id = p_league_id and nr.spot = 'active' group by nr.roster_id) t;
      if held > n + bench then grew := held - n - bench; bench := bench + grew; end if;
      sh := sh || jsonb_build_object('bench', bench);
      r := n + bench + coalesce((sh ->> 'taxi')::int, 0) + coalesce((sh ->> 'ir')::int, 0)
             + coalesce((sh ->> 'out')::int, 0) + coalesce((sh ->> 'devy')::int, 0);
      if r > 99 then
        return jsonb_build_object('ok', false, 'error', 'the roster tops out at 99 — that lineup would make it ' || r);
      end if;
      update league set settings_json = coalesce(settings_json, '{}'::jsonb)
          || jsonb_build_object('roster_slots', cleaned, 'roster_shape', sh)
        where id = p_league_id;
      if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
      update draft set rounds = r where league_id = p_league_id;
      with gone as (
        delete from sealed_pick sp using matchup m
         where m.id = sp.matchup_id and m.league_id = p_league_id and m.status <> 'final'
           and not sp.locked and sp.game_window = 'wk' and sp.roster_slot = any(changed)
        returning 1)
      select count(*) into cleared from gone;
      line := 'Starting lineup changed by the commissioner: '
        || _lineup_words(case when jsonb_typeof(stored) = 'array' then stored end, old_n) || ' → ' || _lineup_words(cleaned, n) || '.'
        || case when grew > 0 then ' The bench grew by ' || grew || ' so every team stays legal.' else '' end
        || case when cleared > 0 then ' Saved lineups in the changed spots were cleared — check your lineup.' else '' end;
      perform _chat_house(p_league_id, line, jsonb_build_object('kind', 'lineup', 'from', stored, 'to', cleaned,
        'bench_grew', grew, 'picks_cleared', cleared));
      return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n, 'rounds', r,
        'bench_grew', grew, 'picks_cleared', cleared);
      end if;
    end if;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_slots', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);  -- pending drafts only, by its own guard
  return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n,
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;

-- ── native_reschedule: 0280_schedule_starts_when_you_do.sql's body, plus the sport guard ──
create or replace function native_reschedule(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'a sport league''s calendar is its first-week date under SCORING');
  end if;
  return _shift_schedule_to_open_week(p_league_id);
end $$;

-- ── set_playoff_rules: 0375_bowl_games.sql's body, plus the sport guard ──
create or replace function set_playoff_rules(p_league_id uuid, p_teams int default null, p_start_week int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int; college boolean; sw int; tm int; rounds int; last_wk int; seas text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'playoffs are not built for a daily sport yet');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.is_playoff and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'playoffs are underway — settings are locked');
  end if;
  select count(*)::int into n from league_membership where league_id = p_league_id;
  -- 0 = OFF. Anything else is still a real bracket, and the shapes the builder
  -- knows how to seed and advance are still 2, 4, 6 and 8 (0073/0215) — a
  -- larger field needs the bracket engine generalised, not just this bound.
  if p_teams is not null and p_teams <> 0 and (p_teams not in (2, 4, 6, 8) or p_teams > n) then
    return jsonb_build_object('ok', false, 'error', 'playoff teams must be 0 (no playoffs), 2, 4, 6, or 8 (and fit the league)');
  end if;
  -- 0374: a college-calendar league's weeks are board weeks 201..215; a plain
  -- college week number (2..15) is read as one. Its bracket must also END by
  -- Week 15, since the college regular season does.
  college := league_is_college_calendar(p_league_id);
  if college then
    if p_start_week is not null and p_start_week between 2 and 15 then p_start_week := 200 + p_start_week; end if;
    -- 0375: bowl weeks (216+) are playable too; the last playable week is the
    -- last one the college slate holds for this season (Week 15 without bowls).
    select season into seas from league where id = p_league_id;
    last_wk := greatest(215, coalesce((select max(week) from nfl_slate where season = seas and week between 216 and 223), 215));
    if p_start_week is not null and (p_start_week < 202 or p_start_week > last_wk) then
      return jsonb_build_object('ok', false, 'error',
        'college playoffs must start between college Week 2 and ' || college_week_label(last_wk));
    end if;
    sw := coalesce(p_start_week, league_playoff_start(p_league_id));
    tm := coalesce(p_teams, league_playoff_teams(p_league_id));
    rounds := case tm when 0 then 0 when 2 then 1 when 4 then 2 else 3 end;
    if rounds > 0 and sw + rounds - 1 > last_wk then
      return jsonb_build_object('ok', false, 'error',
        'a bracket of ' || tm || ' needs ' || rounds || ' weeks — start by ' || college_week_label(last_wk - rounds + 1)
        || ' so it ends by ' || college_week_label(last_wk));
    end if;
  elsif p_start_week is not null and (p_start_week < 2 or p_start_week > 18) then
    return jsonb_build_object('ok', false, 'error', 'playoffs must start between week 2 and 18');
  end if;
  -- Turning them OFF clears a bracket that was only ever SCHEDULED. The guard
  -- above already refused if any playoff game has been played, so this can
  -- never erase a result.
  if p_teams = 0 then
    delete from matchup where league_id = p_league_id and is_playoff;
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_teams is not null then jsonb_build_object('playoff_teams', p_teams) else '{}'::jsonb end
      || case when p_start_week is not null then jsonb_build_object('playoff_start_week', p_start_week) else '{}'::jsonb end
    where id = p_league_id;
  return jsonb_build_object('ok', true,
    'playoff_teams', league_playoff_teams(p_league_id),
    'playoff_start_week', league_playoff_start(p_league_id));
end $$;

-- ── set_transaction_rules: 0337_one_waiver_schedule.sql's body; a sport league's deadline is one of ITS weeks (1–40) ──
create or replace function set_transaction_rules(
  p_league_id uuid, p_waiver_mode text default null,
  p_faab_budget int default null, p_trade_review text default null,
  p_waiver_clear_min int default null, p_waiver_hold_days int default null,
  p_fa_start_min int default null, p_fa_end_min int default null,
  p_waiver_clear_dow jsonb default null,      -- [] clears (= every day); [0..6] sets
  p_fa_after_waivers_dow jsonb default null,  -- [] clears (= never wait); [0..6] sets
  p_agent_waivers boolean default null,       -- 0213: agent seats may transact
  p_fa_mode text default null,                -- 0287: open | window | off
  p_faab_min_bid int default null,            -- 0319: -1 clears (= $0)
  p_fa_dow jsonb default null,                -- 0319: days free agency may open; [] clears (= every day)
  p_trade_deadline_week int default null,     -- 0319: -1 clears (= no deadline)
  p_waiver_days jsonb default null,           -- 0337: the seven days, Sun→Sat; [] clears (= the default schedule)
  p_waiver_game_hold_dow int default null     -- 0337: -1 clears (= no after-games hold)
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'native leagues only');
  end if;
  if p_waiver_mode is not null and p_waiver_mode not in ('rolling', 'standings', 'faab') then
    return jsonb_build_object('ok', false, 'error', 'waiver mode must be rolling, standings, or faab');
  end if;
  if p_faab_budget is not null and (p_faab_budget < 1 or p_faab_budget > 100000) then
    return jsonb_build_object('ok', false, 'error', 'FAAB budget must be $1–$100000');
  end if;
  if p_fa_mode is not null and p_fa_mode not in ('open', 'window', 'off') then
    return jsonb_build_object('ok', false, 'error', 'free agency must be open, window or off');
  end if;
  if p_trade_review is not null and p_trade_review not in ('none', 'commish') then
    return jsonb_build_object('ok', false, 'error', 'trade review must be none or commish');
  end if;
  if p_waiver_clear_min is not null and (p_waiver_clear_min < -1 or p_waiver_clear_min > 1439) then
    return jsonb_build_object('ok', false, 'error', 'waiver clear time must be a time of day');
  end if;
  if p_waiver_hold_days is not null and (p_waiver_hold_days < 0 or p_waiver_hold_days > 7) then
    return jsonb_build_object('ok', false, 'error', 'waiver hold must be 0–7 days');
  end if;
  if p_faab_min_bid is not null and (p_faab_min_bid < -1 or p_faab_min_bid > 100000) then
    return jsonb_build_object('ok', false, 'error', 'the minimum bid must be $0–$100000');
  end if;
  if p_trade_deadline_week is not null and (p_trade_deadline_week < -1 or p_trade_deadline_week = 0 or p_trade_deadline_week > case when league_sport(p_league_id) = 'nfl' then 18 else 40 end) then
    return jsonb_build_object('ok', false, 'error', case when league_sport(p_league_id) = 'nfl' then 'the trade deadline is a week, 1–18' else 'the trade deadline is a week of the season, 1–40' end);
  end if;
  if p_fa_dow is not null then
    if jsonb_typeof(p_fa_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'free-agency days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_fa_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'free-agency days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;
  -- 0337: THE SCHEDULE. Seven entries, Sunday first, each one of the four
  -- modes — the shape Sleeper's own day list has, and the shape every gate
  -- below now reads. An empty list clears back to the default schedule.
  if p_waiver_days is not null and jsonb_array_length(p_waiver_days) > 0 then
    if jsonb_typeof(p_waiver_days) <> 'array' or jsonb_array_length(p_waiver_days) <> 7 then
      return jsonb_build_object('ok', false, 'error', 'the waiver schedule is seven days, Sunday first');
    end if;
    for v in select * from jsonb_array_elements(p_waiver_days) loop
      if jsonb_typeof(v) <> 'string' or (v #>> '{}') not in ('fa', 'waivers', 'waivers_to_fa', 'locked') then
        return jsonb_build_object('ok', false, 'error',
          'each day is fa, waivers, waivers_to_fa or locked');
      end if;
    end loop;
  end if;
  if p_waiver_game_hold_dow is not null
     and (p_waiver_game_hold_dow < -1 or p_waiver_game_hold_dow > 6) then
    return jsonb_build_object('ok', false, 'error', 'the after-games hold is a day, 0 (Sunday) through 6 (Saturday)');
  end if;
  if (p_fa_start_min is null) <> (p_fa_end_min is null) then
    return jsonb_build_object('ok', false, 'error', 'the free-agency window needs both a start and an end');
  end if;
  if p_fa_start_min is not null and p_fa_start_min <> -1 and (
       p_fa_start_min < 0 or p_fa_start_min > 1439
    or p_fa_end_min < 0 or p_fa_end_min > 1439
    or p_fa_start_min = p_fa_end_min) then
    return jsonb_build_object('ok', false, 'error', 'free-agency hours must be two different times of day');
  end if;
  if p_waiver_clear_dow is not null then
    if jsonb_typeof(p_waiver_clear_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'clear days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_waiver_clear_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'clear days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;
  if p_fa_after_waivers_dow is not null then
    if jsonb_typeof(p_fa_after_waivers_dow) <> 'array' then
      return jsonb_build_object('ok', false, 'error', 'FA-after-waivers days must be a list');
    end if;
    for v in select * from jsonb_array_elements(p_fa_after_waivers_dow) loop
      if jsonb_typeof(v) <> 'number' or (v::text)::numeric not between 0 and 6
         or (v::text)::numeric <> floor((v::text)::numeric) then
        return jsonb_build_object('ok', false, 'error', 'FA-after-waivers days are 0 (Sunday) through 6 (Saturday)');
      end if;
    end loop;
  end if;

  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || case when p_waiver_mode is not null then jsonb_build_object('waiver_mode', p_waiver_mode) else '{}'::jsonb end
      || case when p_faab_budget is not null then jsonb_build_object('faab_budget', p_faab_budget) else '{}'::jsonb end
      || case when p_trade_review is not null then jsonb_build_object('trade_review', p_trade_review) else '{}'::jsonb end
      || case when p_waiver_clear_min is null then '{}'::jsonb
              when p_waiver_clear_min = -1 then jsonb_build_object('waiver_clear_min', null)
              else jsonb_build_object('waiver_clear_min', p_waiver_clear_min) end
      || case when p_waiver_hold_days is not null then jsonb_build_object('waiver_hold_days', p_waiver_hold_days) else '{}'::jsonb end
      || case when p_fa_mode is not null then jsonb_build_object('fa_mode', p_fa_mode) else '{}'::jsonb end
      || case when p_fa_start_min is null then '{}'::jsonb
              when p_fa_start_min = -1 then jsonb_build_object('fa_start_min', null, 'fa_end_min', null)
              else jsonb_build_object('fa_start_min', p_fa_start_min, 'fa_end_min', p_fa_end_min) end
      || case when p_waiver_clear_dow is null then '{}'::jsonb
              when jsonb_array_length(p_waiver_clear_dow) = 0 then jsonb_build_object('waiver_clear_dow', null)
              else jsonb_build_object('waiver_clear_dow', p_waiver_clear_dow) end
      || case when p_fa_after_waivers_dow is null then '{}'::jsonb
              when jsonb_array_length(p_fa_after_waivers_dow) = 0 then jsonb_build_object('fa_after_waivers_dow', null)
              else jsonb_build_object('fa_after_waivers_dow', p_fa_after_waivers_dow) end
      || case when p_agent_waivers is not null then jsonb_build_object('agent_waivers', p_agent_waivers) else '{}'::jsonb end
      || case when p_faab_min_bid is null then '{}'::jsonb
              when p_faab_min_bid = -1 then jsonb_build_object('faab_min_bid', null)
              else jsonb_build_object('faab_min_bid', p_faab_min_bid) end
      || case when p_fa_dow is null then '{}'::jsonb
              when jsonb_array_length(p_fa_dow) = 0 then jsonb_build_object('fa_dow', null)
              else jsonb_build_object('fa_dow', p_fa_dow) end
      || case when p_trade_deadline_week is null then '{}'::jsonb
              when p_trade_deadline_week = -1 then jsonb_build_object('trade_deadline_week', null)
              else jsonb_build_object('trade_deadline_week', p_trade_deadline_week) end
      || case when p_waiver_days is null then '{}'::jsonb
              when jsonb_array_length(p_waiver_days) = 0 then jsonb_build_object('waiver_days', null)
              else jsonb_build_object('waiver_days', p_waiver_days) end
      || case when p_waiver_game_hold_dow is null then '{}'::jsonb
              when p_waiver_game_hold_dow = -1 then jsonb_build_object('waiver_game_hold_dow', null)
              else jsonb_build_object('waiver_game_hold_dow', p_waiver_game_hold_dow) end
    where id = p_league_id;
  if p_waiver_mode is not null or p_faab_budget is not null then
    update league_membership set faab_budget = null where league_id = p_league_id;
  end if;
  -- 0291/0292: A DEADLINE THE COMMISSIONER MOVED HAS TO MOVE — BOTH OF THEM.
  -- There are two stamps: a claim's own clears_at, and the waived_until a DROP
  -- puts on the pool row. 0291 moved the first and left the second, so the
  -- founder's league switched to 2pm Thursday while a queue of dropped players
  -- went on clearing at 4am, taking the claims behind them along. One call
  -- now, so the two can never again disagree about what day it is.
  perform _restamp_waiver_clocks(p_league_id);
  -- 0318: THE BOTS STAND DOWN WHEN TOLD TO. Turning agent waivers off stops
  -- the worker filing, but the claims it had already filed would still win
  -- at the run — the opposite of what the switch says. Cancel them; a human
  -- seat's claims are its own.
  if p_agent_waivers is false then
    update waiver_claim c set status = 'cancelled', note = 'agent waivers turned off', processed_at = now()
     where c.league_id = p_league_id and c.status = 'pending' and agent_wire_seat(p_league_id, c.roster_id);
  end if;
  -- 0318: AND WHAT THE CHANGE MADE DUE SETTLES NOW, in the same transaction
  -- as the change — opening free agency makes every claim on an unheld
  -- player due (process_waivers, this migration), and the run is the only
  -- thing that should hand him out. Idempotent; a save that made nothing
  -- due settles nothing and says nothing.
  perform process_waivers(p_league_id);
  return jsonb_build_object('ok', true,
    'fa_mode', league_fa_mode(p_league_id),
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;

-- ── waiver_hold_until: 0338_the_controls_around_the_schedule.sql's body; no after-games hold for a sport league ──
create or replace function waiver_hold_until(p_league_id uuid) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare cm int; hd int; day_local timestamp; t timestamptz; base timestamptz; i int;
        gh int; seas text; kicked timestamptz; last_clear timestamptz; gt timestamptz;
begin
  cm := league_waiver_clear_min(p_league_id);
  select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1), season
    into hd, seas from league where id = p_league_id;

  -- 0319: A HOLD OF NONE — a dropped player is a free agent the moment he is
  -- dropped. Zero is stored as zero; only an unset hold reads as one day.
  -- The after-games rule below can still hold him: that is its whole job.
  -- Rolling: a flat 24 hours from the drop, whatever the hold days say —
  -- 0126's rule, unchanged. (The hold days are how many RUNS a claim waits
  -- for; with no run there is nothing for them to count, which is why the
  -- consoles stopped offering 2 and 3 in this mode — 0338.)
  if cm is null then
    t := case when hd = 0 then now() else now() + interval '24 hours' end;
  else
    -- THE NEXT DAY THE RUN VISITS, at the run's time, once the hold has run.
    base := case when hd = 0 then now() else now() + make_interval(days => greatest(1, hd) - 1) end;
    day_local := date_trunc('day', base at time zone 'America/New_York');
    t := null;
    for i in 0..8 loop
      gt := (day_local + make_interval(days => i, mins => cm)) at time zone 'America/New_York';
      if gt > base and league_waiver_day_clears(p_league_id, gt) then t := gt; exit; end if;
    end loop;
    -- A schedule with no clearing day at all (every day fa or locked) has no
    -- run to wait for; the hold is then plain days, the same expression the
    -- no-daily-run branch above uses — including a hold of NONE meaning NOW,
    -- which a `base + 1 day` fallback would have quietly overruled.
    if t is null then
      t := case when hd = 0 then now() else base + interval '24 hours' end;
    end if;
  end if;

  -- AFTER GAMES WAIVERS CLEAR (0337). From the week's first kickoff until the
  -- chosen morning's run, a dropped player is not a free agent whatever his
  -- own hold says — the rule that stops the fastest phone winning every
  -- injury. Null = NONE.
  --
  -- 0338: the EFFECTIVE morning. A hold that ends at a run the schedule never
  -- makes is a hold that ends on nothing, so the chosen day rolls forward to
  -- the next one the run visits; a week with no run at all leaves the rule
  -- inapplicable and each player keeps his own hold.
  -- 0433: the after-games hold reads the NFL slate; a daily sport has games
  -- every night and clears every morning, so the rule does not apply to it.
  gh := case when league_sport(p_league_id) = 'nfl' then waiver_game_hold_dow_effective(p_league_id) end;
  if gh is not null then
    cm := coalesce(cm, 180);
    -- the most recent run on the hold day, at or before now
    day_local := date_trunc('day', now() at time zone 'America/New_York');
    last_clear := null;
    for i in 0..7 loop
      gt := (day_local - make_interval(days => i) + make_interval(mins => cm)) at time zone 'America/New_York';
      if gt <= now() and extract(dow from gt at time zone 'America/New_York')::int = gh then
        last_clear := gt; exit;
      end if;
    end loop;
    -- has a game kicked off since then?
    select max(s.kickoff) into kicked from nfl_slate s
     where s.season = coalesce(seas, s.season) and s.kickoff <= now()
       and (last_clear is null or s.kickoff > last_clear);
    if kicked is not null then
      for i in 0..7 loop
        gt := (day_local + make_interval(days => i, mins => cm)) at time zone 'America/New_York';
        if gt > now() and extract(dow from gt at time zone 'America/New_York')::int = gh then
          t := greatest(t, gt); exit;
        end if;
      end loop;
    end if;
  end if;
  return t;
end $$;

-- ── trade_deadline_error: a sport league's live week is 301+, its deadline 1–40 ──
create or replace function trade_deadline_error(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select case when league_trade_deadline_week(p_league_id) is not null
               and (case when league_sport(p_league_id) = 'nfl' then league_live_week(p_league_id)
                         else league_live_week(p_league_id) - 300 end) > league_trade_deadline_week(p_league_id)
              then 'the trade deadline has passed (trades closed after week ' || league_trade_deadline_week(p_league_id) || ')'
         end;
$$;

-- ── drop_lock_reason: a sport player whose game started today stays put ──
create or replace function drop_lock_reason(p_league_id uuid, p_slug text) returns text
  language sql stable security definer set search_path = public as $$
  select case
    when league_sport(p_league_id) <> 'nfl' then
      case when sport_slug_started(p_league_id, p_slug)
           then _txn_player(p_league_id, p_slug) || '''s game has started — he can''t be dropped until tomorrow' end
    when coalesce(classic_kickoff_for(p_league_id, league_live_week(p_league_id), p_slug) <= now(), false)
      then _txn_player(p_league_id, p_slug) || '''s game has started — he can''t be dropped until the week ends'
  end;
$$;
