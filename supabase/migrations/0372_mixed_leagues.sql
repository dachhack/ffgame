-- ═══════════════════════════════════════════════════════════════════════════
-- 0372 · COLLEGE PLAYERS, PHASE 4 — NFL AND COLLEGE PLAYERS BOTH SCORING.
--
-- A MIXED league is an NFL-calendar classic league with COLLEGE on and no
-- devy spots: college players are ordinary active players, and they start.
--
--   · A lineup spot may carry a LEVEL: 'nfl' (NFL players only), 'college'
--     (college players only), or none (either). Only a mixed league stores one;
--     the shared engine (slotAllows) enforces it for pickers, fills and
--     the resolver.
--   · SCORING: the worker copies each college game's college-player play rows
--     into the NFL week whose window holds the kickoff, so a mixed league's
--     week N resolves exactly as it always has — by slug and week.
--   · LOCKING: classic_kickoff_for now answers for a college player too — his
--     school's game on the college slate (0371), inside the NFL week's window
--     for an NFL week, or that week's game on the college calendar (which
--     gives Phase 3 per-player locks as well). classic_pick_lock, the roster
--     lock and the new seal_due_college_picks all read it, so the lineup
--     guard, the add/drop guard and the worker's sealing agree.
--   · The college context and its polling now also serve mixed leagues.
-- Bodies copied from 0179 (classic_kickoff_for), 0304 (set_league_classic_
-- slots), 0371 (the backstop, college_live_schools, college_calendar_in_use)
-- with only the marked 0372 changes.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function league_is_mixed(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select _league_has_college(settings_json)
       and coalesce(settings_json ->> 'calendar', 'nfl') = 'nfl'
       and coalesce((settings_json -> 'roster_shape' ->> 'devy')::int, 0) = 0
      from league where id = p_league_id), false)
$$;
grant execute on function league_is_mixed(uuid) to authenticated;

-- The span of an NFL board week, generous at both ends: from 48 hours before
-- its first kickoff (a Tuesday) to 12 hours after its last. Every college
-- game of that Thursday–Saturday falls inside.
create or replace function nfl_week_window(p_week int, out lo timestamptz, out hi timestamptz)
  language sql stable security definer set search_path = public as $$
  select min(kickoff) - interval '48 hours', max(kickoff) + interval '12 hours'
    from nfl_slate
   where week = p_week and season = (select max(season) from nfl_slate where week = p_week)
$$;

-- 0179's function, plus a college player's own kickoff.
create or replace function classic_kickoff_for(p_league_id uuid, p_week int, p_slug text)
  returns timestamptz language sql stable security definer set search_path = public as $$
  select case
    when p_slug ~ '^c-[0-9]+$' then (
      select min(s.kickoff)
        from college_player cp
        join nfl_slate s
          on upper(s.home) = upper(cp.school_abbr) or upper(s.away) = upper(cp.school_abbr)
       where cp.espn_id = substr(p_slug, 3) and cp.school_abbr is not null
         and case when p_week > 200
                  -- the college calendar: that week's game
                  then s.week = p_week and s.season = (select max(season) from nfl_slate where week = p_week)
                  -- an NFL week: the college game inside its window
                  else s.week between 201 and 215
                   and s.kickoff between (select lo from nfl_week_window(p_week)) and (select hi from nfl_week_window(p_week))
             end)
    else (
      select min(s.kickoff)
        from league_pool p
        join nfl_slate s
          on s.week = p_week
         and s.season = (select max(season) from nfl_slate where week = p_week)
         and (upper(s.home) = upper(p.team) or upper(s.away) = upper(p.team))
       where p.league_id = p_league_id and p.slug = p_slug and p.team <> '')
  end;
$$;
grant execute on function classic_kickoff_for(uuid, int, text) to authenticated;

-- The worker's seal for college players (their pool team is blank, so its
-- team-kickoff map cannot place them): any unlocked weekly pick whose player
-- has kicked off by the database's own rule.
create or replace function seal_due_college_picks(p_week int) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update sealed_pick sp set locked = true, revealed_at = now()
    from matchup m
   where m.id = sp.matchup_id and m.week = p_week
     and sp.game_window = 'wk' and not sp.locked
     and sp.player_slug ~ '^c-[0-9]+$'
     and classic_pick_lock(sp.matchup_id, sp.player_slug, window_kickoff(p_week, 'wk')) <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function seal_due_college_picks(int) from public, anon, authenticated;
grant execute on function seal_due_college_picks(int) to service_role;

-- 0371's readers, now for mixed leagues too.
create or replace function college_live_schools() returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct cp.school_id), array[]::text[])
    from native_roster nr
    join league l on l.id = nr.league_id
    join college_player cp on cp.espn_id = substr(nr.slug, 3)
   where nr.slug ~ '^c-[0-9]+$' and nr.spot = 'active'
     and (coalesce(l.settings_json ->> 'calendar', 'nfl') = 'college' or league_is_mixed(l.id))
     and cp.school_id is not null
$$;
revoke all on function college_live_schools() from public, anon, authenticated;
grant execute on function college_live_schools() to service_role;

create or replace function college_calendar_in_use() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league
                  where coalesce(settings_json ->> 'calendar', 'nfl') = 'college'
                     or (_league_has_college(settings_json)
                         and coalesce(settings_json ->> 'calendar', 'nfl') = 'nfl'
                         and coalesce((settings_json -> 'roster_shape' ->> 'devy')::int, 0) = 0))
$$;
revoke all on function college_calendar_in_use() from public, anon, authenticated;
grant execute on function college_calendar_in_use() to service_role;

-- Are there mixed leagues at all? The worker copies college plays into NFL
-- weeks only when some league will read them.
create or replace function mixed_leagues_exist() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league
                  where _league_has_college(settings_json)
                    and coalesce(settings_json ->> 'calendar', 'nfl') = 'nfl'
                    and coalesce((settings_json -> 'roster_shape' ->> 'devy')::int, 0) = 0)
$$;
revoke all on function mixed_leagues_exist() from public, anon, authenticated;
grant execute on function mixed_leagues_exist() to service_role;

-- ── the backstop — 0371's trigger function, plus spot levels ──
create or replace function _league_college_is_classic() returns trigger
  language plpgsql as $$
begin
  if _league_has_college(new.settings_json)
     and coalesce(new.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    raise exception 'a league with college players must be classic (0365)';
  end if;
  -- 0371: the college calendar needs college players, and has no devy spots
  -- (devy is an NFL league's shelf).
  if coalesce(new.settings_json ->> 'calendar', 'nfl') = 'college' then
    if not _league_has_college(new.settings_json) then
      raise exception 'a college-calendar league needs college players turned on (0371)';
    end if;
    if coalesce((new.settings_json -> 'roster_shape' ->> 'devy')::int, 0) > 0 then
      raise exception 'a college-calendar league has no devy spots (0371)';
    end if;
  end if;
  -- 0372: a spot with a level belongs to a mixed league only. Devy spots, the
  -- college calendar or COLLEGE off would leave it meaningless.
  if jsonb_path_exists(coalesce(new.settings_json -> 'roster_slots', '[]'::jsonb), '$[*] ? (exists(@.level))')
     and not (_league_has_college(new.settings_json)
              and coalesce(new.settings_json ->> 'calendar', 'nfl') = 'nfl'
              and coalesce((new.settings_json -> 'roster_shape' ->> 'devy')::int, 0) = 0) then
    raise exception 'NFL/college spots need a mixed league — COLLEGE on, NFL calendar, no devy spots (0372)';
  end if;
  return new;
end $$;

-- ── set_league_classic_slots — 0304's body, plus a spot's level ──
create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  extras jsonb; cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  farr jsonb;
  n int; i int; seen text[]; dstat text;
  obj jsonb; tarr jsonb; v text; mn int; mx int; lbl text; zp int;
  post_draft boolean; stored jsonb; lvl text; mixed boolean;
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
  mixed := league_is_mixed(p_league_id);   -- 0372: only a mixed league's spots carry a level
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
