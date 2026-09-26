-- ═══════════════════════════════════════════════════════════════════════════
-- 0383 · CONFERENCE, TIER AND CLASS RULES — FOR A SPOT, AND FOR THE LEAGUE.
--
-- Founder: "put those filters on eligible players by position and overall —
-- so your devy league can only use division 1 players, or MAC conference and
-- SEC. Or you can have one SEC flex spot and a MAC flex spot. Also by class,
-- so you can have a SR+ spot."
--
-- Values: a conference ('SEC', 'MAC', …, 'Independent'), a tier ('P4', 'G5',
-- 'IND'), or 'FBS' — every FBS school (Division I's top level; the only
-- college players the directory holds). Classes: 1 FR, 2 SO, 3 JR, 4 SR+.
--
-- ── A SPOT (set_league_classic_slots, 0377's body) ─────────────────────────
-- `confs` / `classes` on a spot make it a college spot from those schools /
-- classes: "SEC flex" = RB/WR/TE + confs [SEC]. Needs COLLEGE on, and can't be
-- combined with an NFL-only level. Checked wherever a lineup is built
-- (core slotAllows: the boards, auto-slot, the resolver's optimal fill) and by
-- autodraft (_autopick_spot_fits, now given the slug).
--
-- ── THE LEAGUE (set_league_pool_filter, 0366's body) ───────────────────────
-- `confs` / `classes` on the pool filter limit which COLLEGE players are
-- seeded into the pool (buildDraftPool reads college_directory, which now
-- carries each player's conference and tier). NFL players are unaffected. Like
-- every pool filter it bites at the next (re)seed and locks at the draft.
--
-- college_meta_for(slugs) hands the worker the same facts the clients get
-- from league_pool_college, so its auto-slot applies spot rules too.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function _college_rule_values() returns text[]
  language sql immutable as $$
  select array['FBS', 'P4', 'G5', 'IND', 'ACC', 'Big 12', 'Big Ten', 'SEC', 'American', 'C-USA', 'MAC',
               'Mountain West', 'Pac-12', 'Sun Belt', 'Independent']
$$;

-- A college player's conference, tier and class, by slug.
create or replace function college_meta_for(p_slugs text[]) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg('c-' || cp.espn_id, jsonb_build_object(
           'conf', cs.conference, 'tier', cs.tier, 'cls', cp.class_year)), '{}'::jsonb)
    from college_player cp
    left join college_school cs on cs.school_id = cp.school_id
   where 'c-' || cp.espn_id = any(p_slugs)
$$;
grant execute on function college_meta_for(text[]) to authenticated, service_role;

-- Does a player pass a spot's college rule? (autodraft's twin of collegeRuleAllows)
create or replace function _college_rule_ok(p_spot jsonb, p_slug text) returns boolean
  language sql stable security definer set search_path = public as $$
  select case
    when coalesce(jsonb_array_length(case when jsonb_typeof(p_spot -> 'confs') = 'array' then p_spot -> 'confs' end), 0) = 0
     and coalesce(jsonb_array_length(case when jsonb_typeof(p_spot -> 'classes') = 'array' then p_spot -> 'classes' end), 0) = 0
      then true
    when p_slug is null or p_slug !~ '^c-[0-9]+$' then false
    else coalesce((
      select (coalesce(jsonb_array_length(case when jsonb_typeof(p_spot -> 'confs') = 'array' then p_spot -> 'confs' end), 0) = 0
              or (cs.tier is not null and ((p_spot -> 'confs') ? 'FBS' or (p_spot -> 'confs') ? cs.tier or (p_spot -> 'confs') ? cs.conference)))
         and (coalesce(jsonb_array_length(case when jsonb_typeof(p_spot -> 'classes') = 'array' then p_spot -> 'classes' end), 0) = 0
              or (cp.class_year is not null and (p_spot -> 'classes') @> to_jsonb(least(4, greatest(1, cp.class_year)))))
        from college_player cp left join college_school cs on cs.school_id = cp.school_id
       where cp.espn_id = substr(p_slug, 3)), false)
  end
$$;

create or replace function _autopick_spot_fits(p_spot jsonb, p_pos text, p_level text, p_team text, p_exp int, p_slug text)
  returns boolean language sql stable security definer set search_path = public as $$
  select _autopick_spot_fits(p_spot, p_pos, p_level, p_team, p_exp) and _college_rule_ok(p_spot, p_slug)
$$;
revoke all on function _college_rule_ok(jsonb, text) from public, anon, authenticated;
revoke all on function _autopick_spot_fits(jsonb, text, text, text, int, text) from public, anon, authenticated;

-- ── college_directory — 0381's, plus conference and tier ──
create or replace function college_directory(p_positions text[] default array['QB','RB','WR','TE'], p_limit int default 600)
  returns jsonb language sql stable security definer set search_path = public as $$
  with base as (
    select cp.espn_id, cp.full_name as full, cp.pos, cp.school_abbr, cp.class_label, cp.class_year,
           best.season, round(best.eff, 1) as gp, best.ppg, cs.conference, cs.tier
      from college_player cp
      left join lateral (select * from _college_proj(cp.espn_id)) best on true
      left join college_school cs on cs.school_id = cp.school_id
     where cp.active and cp.pos = any(p_positions)
  ), ranked as (
    select b.*, row_number() over (partition by b.pos order by b.ppg desc nulls last) as prank from base b
  ), repl as (
    select r.pos,
           coalesce(max(r.ppg) filter (where r.prank = case r.pos when 'QB' then 24 when 'RB' then 36 when 'WR' then 48 when 'TE' then 16 else 24 end),
                    min(r.ppg)) as line
      from ranked r where r.ppg is not null group by r.pos
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.ord), '[]'::jsonb) from (
    select r.espn_id, r.full, r.pos, r.school_abbr, r.class_label, r.class_year, r.season, r.gp, r.conference, r.tier,
           round(r.ppg, 1) as ppg, round(r.ppg - p.line, 1) as vor,
           row_number() over (order by (r.ppg - p.line) desc nulls last, r.class_year desc nulls last, r.full) as ord
      from ranked r left join repl p on p.pos = r.pos
     order by ord
     limit least(greatest(coalesce(p_limit, 600), 1), 2000)
  ) t
$$;
grant execute on function college_directory(text[], int) to authenticated;

-- ── set_league_classic_slots — 0377's body, plus the college rules ──
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
grant execute on function set_league_classic_slots(uuid, jsonb) to authenticated;

-- ── set_league_pool_filter — 0366's body, plus the college rules ──
create or replace function set_league_pool_filter(p_league_id uuid, p_filter jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; cleaned jsonb := '{}'::jsonb; tarr jsonb := '[]'::jsonb; ps jsonb; v text; mn int; mx int; carr jsonb := '[]'::jsonb; clarr jsonb := '[]'::jsonb;
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
  -- 0366: a level — 'college' seeds a devy draft's pool, 'nfl' a rookie one.
  if p_filter ? 'level' then
    if coalesce(p_filter ->> 'level', '') not in ('nfl', 'college') then
      return jsonb_build_object('ok', false, 'error', 'level must be nfl or college');
    end if;
    cleaned := cleaned || jsonb_build_object('level', p_filter ->> 'level');
  end if;
  -- 0383: college players from these conferences / tiers and classes only.
  if jsonb_typeof(p_filter -> 'confs') = 'array' and jsonb_array_length(p_filter -> 'confs') > 0 then
    for ps in select * from jsonb_array_elements(p_filter -> 'confs') loop
      v := trim(both '"' from ps::text);
      if not (v = any (_college_rule_values())) then
        return jsonb_build_object('ok', false, 'error', 'unknown conference: ' || v);
      end if;
      if not carr @> to_jsonb(array[v]) then carr := carr || to_jsonb(array[v]); end if;
    end loop;
    cleaned := cleaned || jsonb_build_object('confs', carr);
  end if;
  if jsonb_typeof(p_filter -> 'classes') = 'array' and jsonb_array_length(p_filter -> 'classes') > 0 then
    for ps in select * from jsonb_array_elements(p_filter -> 'classes') loop
      begin mn := (ps #>> '{}')::int; exception when others then mn := null; end;
      if mn is null or mn < 1 or mn > 4 then
        return jsonb_build_object('ok', false, 'error', 'a class is 1 (FR) to 4 (SR+)');
      end if;
      if not clarr @> to_jsonb(array[mn]) then clarr := clarr || to_jsonb(array[mn]); end if;
    end loop;
    cleaned := cleaned || jsonb_build_object('classes', clarr);
  end if;
  if cleaned = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'the filter needs teams, a tenure window, a level, conferences or classes');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('pool_filter', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'filter', cleaned);
end $$;
grant execute on function set_league_pool_filter(uuid, jsonb) to authenticated;

-- ── _autopick_open_spots — 0377's body, the slug passed to the fit ──
create or replace function _autopick_open_spots(p_league_id uuid, p_roster_id int)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare slots jsonb; sp record; placed text[] := '{}'; who text; open jsonb := '[]'::jsonb;
begin
  slots := (select settings_json -> 'roster_slots' from league where id = p_league_id);
  if jsonb_typeof(slots) <> 'array' then return null; end if;
  for sp in
    select s.value as spot from jsonb_array_elements(slots) with ordinality s(value, ord)
     where exists (select 1 from jsonb_array_elements_text(s.value -> 'pos') x where x not in ('K', 'DEF'))
     order by jsonb_array_length(s.value -> 'pos'), s.ord
  loop
    select nr.slug into who from native_roster nr
      join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'active'
       and not (nr.slug = any(placed))
       and _autopick_spot_fits(sp.spot, lp.pos, lp.level, lp.team, lp.exp, lp.slug)
     order by lp.rank limit 1;
    if who is not null then placed := placed || who; else open := open || jsonb_build_array(sp.spot); end if;
  end loop;
  return open;
end $$;

-- ── native_autopick_slug — 0381's body, the slug passed to the fit ──
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  dv int := _devy_slots(p_league_id);
  taken text[];
  held jsonb; caps jsonb; spotn jsonb;
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int; cap_rb int; cap_wr int; cap_te int; cap_k int; cap_def int;
  remaining int; need_k boolean; need_def boolean; forced int; pick text; open jsonb;
begin
  -- Asked once per pick, not once per pool row (0380).
  taken := array(select nr.slug from native_roster nr where nr.league_id = p_league_id
                 union all select al.slug from auction_lot al where al.league_id = p_league_id);
  select coalesce(jsonb_object_agg(p.pos, league_pos_cap(p_league_id, p.pos)), '{}'::jsonb) into caps
    from (select distinct lp.pos from league_pool lp where lp.league_id = p_league_id) p;
  select coalesce(jsonb_object_agg(h.pos, h.n), '{}'::jsonb), coalesce(sum(h.n), 0)::int into held, total from (
    select lp.pos, count(*)::int as n from native_roster nr
      join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id
       and (dv = 0 or nr.spot <> 'devy')
     group by lp.pos) h;
  qb_n := coalesce((held ->> 'QB')::int, 0); rb_n := coalesce((held ->> 'RB')::int, 0);
  wr_n := coalesce((held ->> 'WR')::int, 0); te_n := coalesce((held ->> 'TE')::int, 0);
  k_n := coalesce((held ->> 'K')::int, 0);   def_n := coalesce((held ->> 'DEF')::int, 0);
  cap_qb := league_pos_cap(p_league_id, 'QB'); cap_rb := league_pos_cap(p_league_id, 'RB');
  cap_wr := league_pos_cap(p_league_id, 'WR'); cap_te := league_pos_cap(p_league_id, 'TE');
  cap_k  := league_pos_cap(p_league_id, 'K');  cap_def := league_pos_cap(p_league_id, 'DEF');

  -- 0381: how many starting spots take each position (a builder league).
  select jsonb_object_agg(x.pos, x.n) into spotn from (
    select p.pos, count(*)::int as n
      from jsonb_array_elements(coalesce((select settings_json -> 'roster_slots' from league where id = p_league_id), '[]'::jsonb)) s(spot)
      cross join lateral jsonb_array_elements_text(s.spot -> 'pos') p(pos)
     group by p.pos) x;

  remaining := p_rounds - total - dv;
  -- 0366: the devy spots are their own shelf, filled once the NFL spots are.
  if remaining <= 0 and _devy_open(p_league_id, p_roster_id) > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id and lp.level = 'college' and not (lp.slug = any(taken))
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;
  need_k   := k_n = 0 and coalesce(cap_k, 1) >= 1;
  need_def := def_n = 0 and coalesce(cap_def, 1) >= 1;
  forced := (case when need_k then 1 else 0 end) + (case when need_def then 1 else 0 end);

  if remaining <= forced and forced > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and lp.pos = (case when need_k then 'K' else 'DEF' end)
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  -- 0377: THE LINEUP BEFORE THE BENCH, within the caps.
  open := _autopick_open_spots(p_league_id, p_roster_id);
  if open is not null and jsonb_array_length(open) > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
      and coalesce((caps ->> lp.pos)::int, 1000) > coalesce((held ->> lp.pos)::int, 0)
      and exists (select 1 from jsonb_array_elements(open) o where _autopick_spot_fits(o.value, lp.pos, lp.level, lp.team, lp.exp, lp.slug))
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  -- 0381: THE BENCH IS A DEPTH CHART, NOT A QUEUE. A position stops at twice
  -- the starting spots that take it (one QB spot → two QBs) while anything
  -- else is on the board — then the rank pick below is free again.
  if spotn is not null then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and not (lp.slug = any(taken))
      and (dv = 0 or lp.level = 'nfl')
      and coalesce((caps ->> lp.pos)::int, 1000) > coalesce((held ->> lp.pos)::int, 0)
      and (spotn ->> lp.pos) is not null
      and coalesce((held ->> lp.pos)::int, 0) < 2 * (spotn ->> lp.pos)::int
      and lp.pos not in ('K', 'DEF')
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not (lp.slug = any(taken))
    and (dv = 0 or lp.level = 'nfl')
    and (   (lp.pos = 'QB'  and (cap_qb  is null or qb_n  < cap_qb))
         or (lp.pos = 'RB'  and (cap_rb  is null or rb_n  < cap_rb))
         or (lp.pos = 'WR'  and (cap_wr  is null or wr_n  < cap_wr))
         or (lp.pos = 'TE'  and (cap_te  is null or te_n  < cap_te))
         or (lp.pos = 'K'   and (cap_k   is null or k_n   < cap_k))
         or (lp.pos = 'DEF' and (cap_def is null or def_n < cap_def))
         -- extras (IDP / FB / HC / P) are uncapped here, as before
         or lp.pos not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF'))
  order by lp.rank limit 1;
  if pick is not null then return pick; end if;

  -- Caps exhausted the board — the best free player, never a banned (cap 0) position (0195).
  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not (lp.slug = any(taken))
    and (dv = 0 or lp.level = 'nfl')
    and coalesce((caps ->> lp.pos)::int, 1) > 0
  order by lp.rank limit 1;
  return pick;
end $$;
