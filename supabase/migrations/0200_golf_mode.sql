-- 0200: GOLF MODE, AND THE ZERO-FILL RULE.
--
-- Founder: "For classic, we need an option for golf mode. It's a couple simple
-- changes. Add a rule that any unfilled starting roster spot or any starting
-- roster spot that gets 0 points in a week gets assigned a designated point
-- total (usually 10). These spots can't also be best ball. The second change is
-- that lowest point total wins rather than highest."
--
-- TWO SETTINGS, AND THEY ARE INDEPENDENT. The zero-fill rule is per SPOT and
-- works in any classic league — a normal league can use it to stop a forgotten
-- lineup from scoring nothing. Golf is per LEAGUE and inverts who wins. They
-- are obviously meant for each other (a zero that pays 10 is a penalty only if
-- low is good) but neither needs the other to be coherent, so neither is
-- wired to the other.
--
-- WHAT GOLF ACTUALLY CHANGES, server-side: `league_standings` (which result is
-- a win, and the points tiebreak, which now runs the other way), and the two
-- playoff comparisons — `playoff_winner` and the consolation `reorder_ladder`.
-- That is the whole list. Nothing about how a score is MADE changes: a
-- touchdown is worth what the catalog says, and no metric flips sign.
--
-- Golf FREEZES AT THE DRAFT, like the game mode itself (0157) and unlike the
-- taxi rules. You draft a golf league inside out — the whole board is valued
-- differently — so flipping it in week 6 would not be a rule change, it would
-- be a different league played with the wrong rosters.

-- ─────────────────────────────────────────────────────────────────────────────
-- The reader + the setter
-- ─────────────────────────────────────────────────────────────────────────────
/** Does this league play GOLF — lowest weekly total wins? Default false, so
 *  every league that never opens the setting is untouched. */
create or replace function league_golf(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((select (settings_json ->> 'golf')::boolean from league where id = p_league_id), false);
$$;
grant execute on function league_golf(uuid) to authenticated;

/** Which of two finals is the better one in this league. Null-safe: an
 *  unresolved matchup is nobody's win. */
create or replace function golf_beats(p_league_id uuid, a numeric, b numeric) returns boolean
  language sql stable security definer set search_path = public as $$
  select case when a is null or b is null then false
              when league_golf(p_league_id) then a < b else a > b end;
$$;
grant execute on function golf_beats(uuid, numeric, numeric) to authenticated;

create or replace function set_league_golf(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'golf mode is a classic-league setting');
  end if;
  select status into dstat from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'golf mode locks once the draft starts — the whole board is valued differently');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('golf', coalesce(p_on, false))
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'golf', coalesce(p_on, false));
end $$;
grant execute on function set_league_golf(uuid, boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_league_classic_slots — 0197's body, plus the per-spot zero-fill rule
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

-- ─────────────────────────────────────────────────────────────────────────────
-- league_standings — 0110's body, with WIN and the points tiebreak golf-aware
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'roster_id', z.rid, 'team', z.team_name,
        'wins', z.w, 'losses', z.l, 'ties', z.t, 'pf', z.pf, 'pa', z.pa)
      -- …and so does the points tiebreak: in golf the team that scored FEWER
      -- points on equal wins is the one that played the season better.
      order by z.w desc, case when league_golf(p_league_id) then -z.pf else z.pf end desc, z.rid)
    from (
      select m.sleeper_roster_id as rid, m.team_name,
             coalesce(s.w, 0) as w, coalesce(s.l, 0) as l, coalesce(s.t, 0) as t,
             coalesce(s.pf, 0) as pf, coalesce(s.pa, 0) as pa
      from league_membership m
      left join (
        -- GOLF (0200): which result is a WIN inverts. Nothing else about the
        -- table does — points for and against are still the points scored.
        select x.rid, count(*) filter (where golf_beats(p_league_id, x.us, x.them)) as w,
               count(*) filter (where golf_beats(p_league_id, x.them, x.us)) as l,
               count(*) filter (where x.us = x.them) as t,
               sum(x.us) as pf, sum(x.them) as pa
        from (
          select mu.home_roster_id as rid, mu.home_final as us, mu.away_final as them
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and not is_practice_week(mu.week)
            and mu.home_final is not null and mu.away_final is not null
          union all
          select mu.away_roster_id, mu.away_final, mu.home_final
          from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
            and not is_practice_week(mu.week)
            and mu.home_final is not null and mu.away_final is not null
        ) x group by x.rid
      ) s on s.rid = m.sleeper_roster_id
      where m.league_id = p_league_id
    ) z), '[]'::jsonb);
end $$;
grant execute on function league_standings(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The two playoff comparisons — 0073's bodies, same substitution
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function playoff_winner(m matchup, p_seeds jsonb) returns int
  language sql stable as $$
  select case
    when golf_beats(m.league_id, m.home_final, m.away_final) then m.home_roster_id
    when golf_beats(m.league_id, m.away_final, m.home_final) then m.away_roster_id
    else better_seed(p_seeds, m.home_roster_id, m.away_roster_id) end;
$$;
create or replace function reorder_ladder(p_league_id uuid, p_round int, p_ladder int[]) returns int[]
  language plpgsql stable security definer set search_path = public as $$
declare l int[] := p_ladder; g record; i int; j int; win int; tmp int;
begin
  for g in select * from matchup where league_id = p_league_id and is_playoff and is_consolation
             and playoff_round = p_round and status = 'final'
             and home_final is not null and away_final is not null
  loop
    win := case when golf_beats(p_league_id, g.home_final, g.away_final) then g.home_roster_id
                when golf_beats(p_league_id, g.away_final, g.home_final) then g.away_roster_id end;
    if win is null then continue; end if;   -- tie: rungs hold
    i := array_position(l, g.home_roster_id); j := array_position(l, g.away_roster_id);
    if i is null or j is null then continue; end if;
    if j < i then tmp := i; i := j; j := tmp; end if;
    if l[j] = win then tmp := l[i]; l[i] := l[j]; l[j] := tmp; end if;
  end loop;
  return l;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- league_game_mode — carry the golf flag to the screens
-- ─────────────────────────────────────────────────────────────────────────────
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
      -- GOLF (0200): lowest weekly total wins. Read here rather than from its
      -- own call because every screen that needs it already loads the mode.
      'golf', league_golf(p_league_id),
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league l where l.id = p_league_id);
end $$;
grant execute on function league_game_mode(uuid) to authenticated;
