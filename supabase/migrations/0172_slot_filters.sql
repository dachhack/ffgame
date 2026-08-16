-- 0172 · PER-SLOT PLAYER FILTERS — "Player filters need to be applied per
-- starting roster spot. so you can have an RB slot only for rookies."
--
-- A builder spot (settings_json.roster_slots) may now carry its OWN
-- allowable-player filter alongside pos/bb: a team whitelist and/or a tenure
-- window (years_exp; 0 = rookie). Filters gate who may FILL the spot — the
-- lineup pickers and the best-ball fill enforce them (the same client+engine
-- enforcement seam position eligibility already uses) — they never shrink the
-- draft pool: a vet RB is still draftable, he just can't man the rookie spot.
--
-- Tenure has to be visible at lineup time, so league_pool grows an exp column
-- seeded from the Sleeper directory (buildDraftPool). Pools seeded before this
-- migration carry null exp everywhere; slot specs freeze at the draft and
-- pools re-seed pre-draft only, so any league adding a tenure filter can (and
-- must) re-seed first — the builder UI says so.
--
-- Also in seed_league_pool v3: the position whitelist finally admits the 0171
-- extras (DL/LB/DB/FB/HC/P). v2's list predated them, so extra-position
-- entries were silently dropped at seed time — the 0171 feature's pool half
-- never landed. Fixed here.

alter table league_pool add column if not exists exp int;

-- ── seed_league_pool v3: + exp, + 0171 extra positions ──────────────────────
create or replace function seed_league_pool(p_league_id uuid, p_players jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
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

  delete from league_pool where league_id = p_league_id;
  insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp)
  select p_league_id, p ->> 'slug', p ->> 'full', p ->> 'pos', coalesce(p ->> 'team', ''), ord,
         nullif(btrim(coalesce(p ->> 'espn_id', '')), ''),
         case when coalesce(p ->> 'exp', '') ~ '^\d{1,2}$'
              then least(30, greatest(0, (p ->> 'exp')::int)) end
  from jsonb_array_elements(p_players) with ordinality as t(p, ord)
  where coalesce(p ->> 'slug', '') <> '' and coalesce(p ->> 'full', '') <> ''
    and coalesce(p ->> 'pos', '') in ('QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P')
  on conflict (league_id, slug) do nothing;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'players', n);
end $$;

-- ── Builder v4: each spot may carry teams / min_exp / max_exp ───────────────
create or replace function set_league_classic_slots(p_league_id uuid, p_slots jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  positions text[] := array['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
  extras jsonb; cleaned jsonb := '[]'::jsonb; spot jsonb; ps jsonb; p text; bb boolean;
  n int; i int; seen text[]; dstat text;
  obj jsonb; tarr jsonb; v text; mn int; mx int;
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
    cleaned := cleaned || jsonb_build_array(obj);
  end loop;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_slots', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'slots', cleaned, 'starters', n,
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;
