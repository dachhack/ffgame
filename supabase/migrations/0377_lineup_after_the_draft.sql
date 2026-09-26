-- ═══════════════════════════════════════════════════════════════════════════
-- 0377 · THE STARTING LINEUP CAN CHANGE AFTER THE DRAFT; AUTOPICK FILLS IT FIRST.
--
-- Founder: "open up the starting lineup too. Our autodraft logic doesn't seem
-- to take into account filling all starting positions before grabbing backups
-- for the bench."
--
-- ── 1. THE LINEUP AFTER THE DRAFT ──────────────────────────────────────────
-- Until now a drafted league could only rename its spots (0201) or remove them
-- from the end (0181). Now, once the draft is complete and between weeks (no
-- week kicked off and not yet final), a commissioner can add, remove or
-- change spots. Three things keep it honest:
--   • slot names are positional (S1…Sn), so saved, unlocked lineups for weeks
--     not yet played are cleared in every spot whose definition changed —
--     nobody starts a player the new spot would never have accepted;
--   • fewer starting spots can leave a team with more active players than
--     starters + bench; the bench grows to fit rather than making anyone
--     illegal (and the roster's size, draft.rounds, follows);
--   • a lineup with no spot for a position teams hold is refused: a position
--     no spot starts can't be rostered (0361), so it would make them illegal;
--   • the league hears about it, old lineup → new, in the house voice (0290),
--     like 0376's roster spots. A pure rename posts nothing.
-- During a live draft the lineup stays locked, except 0201's rename and 0181's
-- hatch (remove spots from the end).
--
-- ── 2. AUTOPICK FILLS THE LINEUP BEFORE THE BENCH ──────────────────────────
-- native_autopick_slug (0366) took the best-ranked player its position caps
-- allowed. Nothing asked whether the team could START him, so a team on
-- autodraft could take a fifth running back before its quarterback or tight
-- end. Now, while a team has an open starting spot, autopick takes the
-- best-ranked player who fits one: its positions, its NFL/college level
-- (0372), its team and tenure filters (0172). Spots that take only a kicker or
-- a defense keep 0195's rule — filled in the last rounds — and a spot limited
-- by a commissioner's flags (0197) is left to the manager, since the draft
-- can't know who will wear the flag. With every starter in place, the bench
-- fills by rank as before. Leagues without a lineup spec (drip, and classic
-- leagues from before 0161's spec) are unchanged.
-- ═══════════════════════════════════════════════════════════════════════════

-- A lineup in words, for the chat line: "QB · RB · RB · WR · FLEX · CFB FLEX".
create or replace function _spot_word(p_spot jsonb) returns text
  language sql immutable as $$
  select coalesce(nullif(p_spot ->> 'label', ''),
    case when p_spot ->> 'level' = 'college' then 'CFB ' when p_spot ->> 'level' = 'nfl' then 'NFL ' else '' end
    || case (select string_agg(x, '/' order by x) from jsonb_array_elements_text(p_spot -> 'pos') x)
         when 'RB/TE/WR' then 'FLEX'
         when 'QB/RB/TE/WR' then 'SUPERFLEX'
         else (select string_agg(x, '/') from jsonb_array_elements_text(p_spot -> 'pos') x) end)
$$;
create or replace function _lineup_words(p_slots jsonb, p_n int) returns text
  language sql immutable as $$
  select case when jsonb_typeof(p_slots) = 'array' and jsonb_array_length(p_slots) > 0
    then (select string_agg(_spot_word(s.value), ' · ' order by s.ord) from jsonb_array_elements(p_slots) with ordinality s(value, ord))
    else p_n || ' starters' end
$$;
revoke all on function _spot_word(jsonb) from public, anon, authenticated;
revoke all on function _lineup_words(jsonb, int) from public, anon, authenticated;

-- ── set_league_classic_slots — 0372's body, with the post-draft branch rewritten ──
create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  extras jsonb; cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  farr jsonb;
  n int; i int; seen text[]; dstat text;
  obj jsonb; tarr jsonb; v text; mn int; mx int; lbl text; zp int;
  post_draft boolean; stored jsonb; lvl text; mixed boolean;
  old_n int; sh jsonb; bench int; held int; grew int := 0; wk int; changed text[] := '{}'; cleared int := 0; r int; line text;
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

-- ── 2. AUTOPICK: WHO COULD START ──────────────────────────────────────────
-- Does a pool player fit a lineup spot? Positions, level, team and tenure — the
-- filters a draft can check. A flagged spot never matches (see header).
create or replace function _autopick_spot_fits(p_spot jsonb, p_pos text, p_level text, p_team text, p_exp int)
  returns boolean language sql immutable as $$
  select (p_spot -> 'pos') ? p_pos
     and (p_spot ->> 'level' is null or p_spot ->> 'level' = coalesce(p_level, 'nfl'))
     and (jsonb_typeof(p_spot -> 'teams') is distinct from 'array' or jsonb_array_length(p_spot -> 'teams') = 0
          or (p_spot -> 'teams') ? upper(coalesce(p_team, '')))
     and (p_spot ->> 'min_exp' is null or (p_exp is not null and p_exp >= (p_spot ->> 'min_exp')::int))
     and (p_spot ->> 'max_exp' is null or (p_exp is not null and p_exp <= (p_spot ->> 'max_exp')::int))
     and (jsonb_typeof(p_spot -> 'flags') is distinct from 'array' or jsonb_array_length(p_spot -> 'flags') = 0)
$$;

-- The starting spots a team still has to fill, best-effort: spots are taken
-- most-restrictive first (fewest positions), each by the best-ranked player
-- on the roster who fits and isn't placed yet. What's left is open. Kicker-
-- and defense-only spots are left out: 0195 fills those in the last rounds.
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
       and _autopick_spot_fits(sp.spot, lp.pos, lp.level, lp.team, lp.exp)
     order by lp.rank limit 1;
    if who is not null then placed := placed || who; else open := open || jsonb_build_array(sp.spot); end if;
  end loop;
  return open;
end $$;
revoke all on function _autopick_spot_fits(jsonb, text, text, text, int) from public, anon, authenticated;
revoke all on function _autopick_open_spots(uuid, int) from public, anon, authenticated;

-- ── native_autopick_slug — 0366's body, the lineup first ──
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int := league_pos_cap(p_league_id, 'QB'); cap_rb int := league_pos_cap(p_league_id, 'RB');
  cap_wr int := league_pos_cap(p_league_id, 'WR'); cap_te int := league_pos_cap(p_league_id, 'TE');
  cap_k  int := league_pos_cap(p_league_id, 'K');  cap_def int := league_pos_cap(p_league_id, 'DEF');
  remaining int; need_k boolean; need_def boolean; forced int; pick text; open jsonb;
begin
  select count(*) filter (where lp.pos = 'QB'), count(*) filter (where lp.pos = 'RB'),
         count(*) filter (where lp.pos = 'WR'), count(*) filter (where lp.pos = 'TE'),
         count(*) filter (where lp.pos = 'K'),  count(*) filter (where lp.pos = 'DEF'),
         count(*)
    into qb_n, rb_n, wr_n, te_n, k_n, def_n, total
  from native_roster nr join league_pool lp
    on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id
    and (_devy_slots(p_league_id) = 0 or nr.spot <> 'devy');

  remaining := p_rounds - total - _devy_slots(p_league_id);
  -- 0366: the devy spots are their own shelf, filled once the NFL spots are:
  -- an autopick spends its early rounds on players who score.
  if remaining <= 0 and _devy_open(p_league_id, p_roster_id) > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id and lp.level = 'college'
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
      and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
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
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
      and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    and (_devy_slots(p_league_id) = 0 or lp.level = 'nfl')
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  -- 0377: THE LINEUP BEFORE THE BENCH. While a starting spot is open, the
  -- best-ranked player who could fill one — within the same caps.
  open := _autopick_open_spots(p_league_id, p_roster_id);
  if open is not null and jsonb_array_length(open) > 0 then
    select lp.slug into pick from league_pool lp
    where lp.league_id = p_league_id
      and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
      and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
      and (_devy_slots(p_league_id) = 0 or lp.level = 'nfl')
      and coalesce(league_pos_cap(p_league_id, lp.pos), 1000) > (case lp.pos
            when 'QB' then qb_n when 'RB' then rb_n when 'WR' then wr_n when 'TE' then te_n
            when 'K' then k_n when 'DEF' then def_n else 0 end)
      and exists (select 1 from jsonb_array_elements(open) o where _autopick_spot_fits(o.value, lp.pos, lp.level, lp.team, lp.exp))
    order by lp.rank limit 1;
    if pick is not null then return pick; end if;
  end if;

  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    and (_devy_slots(p_league_id) = 0 or lp.level = 'nfl')
    and (   (lp.pos = 'QB'  and (cap_qb  is null or qb_n  < cap_qb))
         or (lp.pos = 'RB'  and (cap_rb  is null or rb_n  < cap_rb))
         or (lp.pos = 'WR'  and (cap_wr  is null or wr_n  < cap_wr))
         or (lp.pos = 'TE'  and (cap_te  is null or te_n  < cap_te))
         or (lp.pos = 'K'   and (cap_k   is null or k_n   < cap_k))
         or (lp.pos = 'DEF' and (cap_def is null or def_n < cap_def))
         -- The enabled extras (IDP / FB / HC / P, 0171) had no branch here at
         -- all, so an IDP league's autopick could only reach them by falling
         -- through to the last resort. Caps only ever name the six above, so
         -- an extra is uncapped by construction.
         or lp.pos not in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF'))
  order by lp.rank limit 1;
  if pick is not null then return pick; end if;

  -- Caps exhausted the board (tiny pools) — take the best free player outright,
  -- EXCEPT where a cap is ZERO. 0195: zero is not a small limit, it is a ban —
  -- "this league does not roster kickers" — and a fallback that ignores it is
  -- how a league with no K spot ended up with a drafted kicker.
  select lp.slug into pick from league_pool lp
  where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug)
    and not exists (select 1 from auction_lot al where al.league_id = lp.league_id and al.slug = lp.slug)
    and (_devy_slots(p_league_id) = 0 or lp.level = 'nfl')
    and coalesce(league_pos_cap(p_league_id, lp.pos), 1) > 0
  order by lp.rank limit 1;
  return pick;
end $$;

