-- 0198: WHO MAY GO ON IR — THE COMMISSIONER SAYS.
--
-- Founder: "we need to make sure only injured guys can be put on IR (commish
-- chooses eligible tags) and that the commish selected eligibility applies to
-- putting guys in taxi slots."
--
-- 0164 already refused a healthy player: IR wanted `injury_status.status` in
-- ('IR','O'). That pair was a GUESS about how leagues play it, hardcoded into
-- the function — and leagues genuinely differ. Some run a strict season-ending
-- IR (the 'IR' tag alone). Some let Out ride. A few let Doubtful ride, which is
-- the same call a commissioner makes about a short-handed roster in November.
-- None of them should have to ask for a migration.
--
--   settings_json.ir = { "tags": ["IR", "O"] }
--
-- The vocabulary is the injury report's own, and nothing else: O (Out),
-- D (Doubtful), Q (Questionable), IR. The default is the pair 0164 hardcoded,
-- so a league that never opens the setting keeps exactly today's behaviour.
-- An EMPTY list is refused rather than stored: a league with IR spots and no
-- eligible tag has a place nobody can ever be put, which reads as broken
-- rather than as strict. A commissioner who wants that removes the IR spots.
--
-- AND THE TAXI RULE HAS TO BITE AT THE SAME PLACE. 0196 gave the taxi squad a
-- tenure ceiling and enforced it here, in `set_roster_spot` — but no screen had
-- ever read `roster_rules`, so both hosts offered "→ TAXI" on every player and
-- the rule only appeared as a red error AFTER the tap. The server side stands;
-- what this migration adds is the ONE READER the screens needed: roster_rules
-- now carries `ir_tags` beside `taxi_max_exp`, so a host can gate the button
-- and say why in the same breath.

-- ─────────────────────────────────────────────────────────────────────────────
-- The reader + the setter
-- ─────────────────────────────────────────────────────────────────────────────
/** Which injury designations qualify a player for an IR spot. Default is
 *  0164's hardcoded pair, so nothing changes for a league that never asks. */
create or replace function league_ir_tags(p_league_id uuid) returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(settings_json -> 'ir' -> 'tags'))
       from league where id = p_league_id
        and jsonb_typeof(settings_json -> 'ir' -> 'tags') = 'array'
        and jsonb_array_length(settings_json -> 'ir' -> 'tags') > 0),
    array['IR', 'O']);
$$;
grant execute on function league_ir_tags(uuid) to authenticated;

/** Commissioner: which designations may be stashed on IR. Editable AT ANY TIME
 *  — same reasoning as the taxi rules (0196): a commissioner loosening IR in
 *  week 9 is answering a week-9 question. Null leaves it alone. */
create or replace function set_ir_rules(p_league_id uuid, p_tags text[] default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare clean text[]; t text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_tags is not null then
    clean := array[]::text[];
    foreach t in array p_tags loop
      t := upper(btrim(coalesce(t, '')));
      -- The injury report's own vocabulary and nothing else. A tag the report
      -- never emits would be a spot nobody could ever qualify for.
      if t not in ('O', 'D', 'Q', 'IR') then
        return jsonb_build_object('ok', false, 'error', 'IR tags are O, D, Q and IR');
      end if;
      if not (t = any(clean)) then clean := clean || t; end if;
    end loop;
    if array_length(clean, 1) is null then
      return jsonb_build_object('ok', false, 'error',
        'pick at least one designation — an IR spot nobody can qualify for is a spot to remove, not a rule');
    end if;
    update league set settings_json =
      coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('ir', jsonb_build_object('tags', to_jsonb(clean)))
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  end if;
  return jsonb_build_object('ok', true, 'tags', to_jsonb(league_ir_tags(p_league_id)));
end $$;
grant execute on function set_ir_rules(uuid, text[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- set_roster_spot — 0196's body, with the IR gate reading the league's tags
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function set_roster_spot(p_league_id uuid, p_slug text, p_spot text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; sh jsonb; cnt int; cap int; ist text; mx int; pexp int; tags text[];
begin
  if p_spot not in ('active', 'taxi', 'ir') then
    return jsonb_build_object('ok', false, 'error', 'spot must be active, taxi, or ir');
  end if;
  select roster_id into rid from native_roster where league_id = p_league_id and slug = p_slug;
  if rid is null then return jsonb_build_object('ok', false, 'error', 'player not rostered'); end if;
  if not (owns_roster(p_league_id, rid) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  sh := _roster_shape(p_league_id);
  if p_spot = 'taxi' then
    cap := coalesce((sh ->> 'taxi')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'taxi' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'taxi is full — ' || cap || ' spots'); end if;
    -- ── WHO MAY RIDE IT (0196) ───────────────────────────────────────────
    -- The commissioner names a tenure ceiling — "rookies only" is max_exp 0,
    -- "first and second year" is 1. A player whose experience Sleeper doesn't
    -- know cannot prove he qualifies, which is the same answer the pool's
    -- tenure filter gives (0171/0172): unknown is not eligible.
    mx := (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id);
    if mx is not null then
      select lp.exp into pexp from league_pool lp
        where lp.league_id = p_league_id and lp.slug = p_slug;
      if pexp is null then
        return jsonb_build_object('ok', false, 'error',
          'the taxi squad is for players with ' || mx || ' or fewer years — this one''s experience isn''t known');
      end if;
      if pexp > mx then
        return jsonb_build_object('ok', false, 'error',
          'the taxi squad is for players with ' || mx || ' or fewer years — he has ' || pexp);
      end if;
    end if;
    -- ── AND WHEN (0196) ──────────────────────────────────────────────────
    -- Taxi squads shut at the season's first kickoff so nobody stashes a
    -- starter once games are being played. It bites on ADDING only: taking a
    -- player OFF the taxi is always allowed, which is the whole point of
    -- having him there. The COMMISSIONER moves players either way at any time.
    if taxi_is_locked(p_league_id) and not (is_league_commish(p_league_id) or is_admin()) then
      return jsonb_build_object('ok', false, 'error',
        'the taxi squad locked at the season''s first kickoff — you can still take players OFF it');
    end if;
  elsif p_spot = 'ir' then
    cap := coalesce((sh ->> 'ir')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'ir' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'IR is full — ' || cap || ' spots'); end if;
    -- ── ONLY INJURED GUYS (0164, and now the LEAGUE'S OWN LIST — 0198) ────
    -- The commissioner picks which designations qualify; the default is the
    -- pair 0164 hardcoded. The refusal NAMES the list, because "not eligible"
    -- without it sends a manager to the settings page to find out what is.
    -- No exemption for the commissioner here, unlike the taxi lock: the taxi
    -- lock is a DEADLINE (someone has to be able to fix a mistake after it),
    -- while this is a statement about the player, and it is just as true for
    -- the commissioner's own roster as for anyone else's.
    tags := league_ir_tags(p_league_id);
    select status into ist from injury_status where player_slug = p_slug;
    if ist is null or not (upper(ist) = any(tags)) then
      return jsonb_build_object('ok', false, 'error',
        'IR is for players designated ' || array_to_string(tags, '/') ||
        coalesce(' — this one is ' || nullif(upper(ist), ''), ' — this one has no designation'));
    end if;
  else
    -- Back to active: there must be an active seat open (starters + bench).
    cap := _classic_starters(p_league_id) + coalesce((sh ->> 'bench')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'active' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'active roster is full — stash or drop someone first'); end if;
  end if;
  update native_roster set spot = p_spot where league_id = p_league_id and slug = p_slug;
  return jsonb_build_object('ok', true, 'slug', p_slug, 'spot', p_spot);
end $$;
grant execute on function set_roster_spot(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- roster_rules — 0196's body, now also carrying the IR list
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function roster_rules(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select * into d from draft where league_id = p_league_id;
  if not found then return jsonb_build_object('error', 'not a native league'); end if;
  return jsonb_build_object('ok', true, 'rounds', d.rounds, 'draft_status', d.status,
    'pos_caps', league_pos_caps(p_league_id),
    'waiver_mode', league_waiver_mode(p_league_id),
    'faab_budget', league_faab_budget(p_league_id),
    'trade_review', league_trade_review(p_league_id),
    'waiver_clear_min', (select nullif(settings_json ->> 'waiver_clear_min', '')::int from league where id = p_league_id),
    'waiver_clear_dow', (select settings_json -> 'waiver_clear_dow' from league where id = p_league_id),
    'fa_after_waivers_dow', (select settings_json -> 'fa_after_waivers_dow' from league where id = p_league_id),
    'waiver_hold_days', (select coalesce(nullif(settings_json ->> 'waiver_hold_days', '')::int, 1) from league where id = p_league_id),
    'fa_start_min', (select nullif(settings_json ->> 'fa_start_min', '')::int from league where id = p_league_id),
    'fa_end_min', (select nullif(settings_json ->> 'fa_end_min', '')::int from league where id = p_league_id),
    -- The taxi squad's own rules (0196), and whether it is shut right now.
    'taxi_max_exp', (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id),
    'taxi_lock', league_taxi_lock(p_league_id),
    'taxi_locked_now', taxi_is_locked(p_league_id),
    'taxi_lock_at', league_week1_kickoff(p_league_id),
    -- Which designations qualify for an IR spot (0198), so a screen can gate
    -- the button instead of discovering the rule from a red error.
    'ir_tags', to_jsonb(league_ir_tags(p_league_id)));
end $$;
grant execute on function roster_rules(uuid) to authenticated;
