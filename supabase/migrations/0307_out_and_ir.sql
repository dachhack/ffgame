-- 0307: TWO KINDS OF INJURED SPOT — OUT and IR (v0.432.0).
--
-- Founder: "You know what would be cool? If we could have two types of IR
-- spots just like the league: Out and IR. Commish can pick the type of injury
-- type qualifies for each."
--
-- The NFL keeps two shelves: injured reserve for the long stay and the weekly
-- OUT for a man who misses a Sunday. The game had one (0164 'ir', with the
-- commissioner's list of qualifying designations since 0198). This adds the
-- second as a full sibling rather than a flag on the first:
--
--   · native_roster.spot gains 'out' — a stashed player, never a starter,
--     exactly as 'ir' and 'taxi' read everywhere (`spot <> 'active'`);
--   · roster_shape gains `out` (a count, default 0) beside bench/taxi/ir.
--     Like IR since 0193/0296 it is NOT a draft round — extra room, added or
--     removed after the draft, counted in draft.stash_slots with IR;
--   · settings_json.out.tags is the OUT list, league_out_tags() reads it
--     (default O and D — the week-to-week designations); set_out_rules sets
--     it with the injury report's vocabulary and nothing else, as set_ir_rules
--     does for IR. The IR default (IR/O) is untouched, so no existing league
--     moves; a commissioner who opens OUT spots will usually narrow IR to IR;
--   · set_roster_spot takes 'out' with OUT's cap and OUT's list; roster_rules
--     carries out_tags so a screen can grey the row and say why;
--   · set_league_roster_shape grows a fifth argument. The four-argument form
--     stays for older builds and leaves OUT where it is.
-- Everything that treats a stash as "not active" — the lock-time fill, the
-- classic resolve, the auto-slot, the register — needs nothing.

-- ── the spot ─────────────────────────────────────────────────────────────────
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'native_roster'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%spot%'
  loop
    execute format('alter table native_roster drop constraint %I', c.conname);
  end loop;
end $$;
alter table native_roster add constraint native_roster_spot_check
  check (spot in ('active', 'taxi', 'ir', 'out'));

-- ── the OUT list ─────────────────────────────────────────────────────────────
create or replace function league_out_tags(p_league_id uuid) returns text[]
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select array(select jsonb_array_elements_text(settings_json -> 'out' -> 'tags'))
       from league where id = p_league_id
        and jsonb_typeof(settings_json -> 'out' -> 'tags') = 'array'
        and jsonb_array_length(settings_json -> 'out' -> 'tags') > 0),
    array['O', 'D']);
$$;
grant execute on function league_out_tags(uuid) to authenticated;

create or replace function set_out_rules(p_league_id uuid, p_tags text[] default null)
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
      if t not in ('O', 'D', 'Q', 'IR') then
        return jsonb_build_object('ok', false, 'error', 'OUT tags are O, D, Q and IR');
      end if;
      if not (t = any(clean)) then clean := clean || t; end if;
    end loop;
    if array_length(clean, 1) is null then
      return jsonb_build_object('ok', false, 'error',
        'pick at least one designation — an OUT spot nobody can qualify for is a spot to remove, not a rule');
    end if;
    update league set settings_json =
      coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('out', jsonb_build_object('tags', to_jsonb(clean)))
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  end if;
  return jsonb_build_object('ok', true, 'tags', to_jsonb(league_out_tags(p_league_id)));
end $$;
grant execute on function set_out_rules(uuid, text[]) to authenticated;

-- ── the draft's round count knows both shelves ──────────────────────────────
create or replace function _sync_classic_rounds(p_league_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare sh jsonb; r int;
begin
  sh := _roster_shape(p_league_id);
  if sh = '{}'::jsonb then return; end if; -- shape never set: creation-time rounds stand
  r := _classic_starters(p_league_id)
     + coalesce((sh ->> 'bench')::int, 0)
     + coalesce((sh ->> 'taxi')::int, 0)
     + coalesce((sh ->> 'ir')::int, 0)
     + coalesce((sh ->> 'out')::int, 0);
  -- `rounds` is the ROSTER SIZE and counts both injured shelves: spots a team
  -- may hold. `stash_slots` is how many of them the DRAFT does not fill.
  update draft set rounds = r, stash_slots = coalesce((sh ->> 'ir')::int, 0) + coalesce((sh ->> 'out')::int, 0)
    where league_id = p_league_id and status = 'pending';
end $$;

-- ── the shape: bench / taxi / IR / OUT ──────────────────────────────────────
-- 0296's body with OUT beside IR throughout. A null IR or OUT leaves that
-- count where it is (the four-argument form below passes null for OUT).
create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int, p_out int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; drounds int; b int; tx int; ir int; o int; r int; sh jsonb; cur_ir int; cur_out int; held int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if coalesce((select settings_json ->> 'game_mode' from league where id = p_league_id), 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'the roster shape is a classic-league setting');
  end if;
  select status, rounds into dstat, drounds from draft where league_id = p_league_id;
  sh := _roster_shape(p_league_id);
  ir := least(99, greatest(0, coalesce(p_ir, (sh ->> 'ir')::int, 0)));
  o  := least(99, greatest(0, coalesce(p_out, (sh ->> 'out')::int, 0)));

  if dstat is not null and dstat <> 'pending' then
    -- ── AFTER THE DRAFT: THE INJURED SHELVES ONLY ────────────────────────
    if sh = '{}'::jsonb then
      b := greatest(0, coalesce(drounds, 0) - _classic_starters(p_league_id)); tx := 0; cur_ir := 0; cur_out := 0;
    else
      b := coalesce((sh ->> 'bench')::int, 0); tx := coalesce((sh ->> 'taxi')::int, 0);
      cur_ir := coalesce((sh ->> 'ir')::int, 0); cur_out := coalesce((sh ->> 'out')::int, 0);
    end if;
    if ir = cur_ir and o = cur_out then
      if coalesce(p_bench, b) <> b or coalesce(p_taxi, tx) <> tx then
        return jsonb_build_object('ok', false, 'error',
          'the bench and taxi squad lock once the draft starts — IR spots can still be added or removed, and OUT spots with them');
      end if;
      return jsonb_build_object('ok', true, 'shape', jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o),
        'rounds', _classic_starters(p_league_id) + b + tx + ir + o,
        'draft_rounds', _classic_starters(p_league_id) + b + tx);
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster
       where league_id = p_league_id and spot = 'ir' group by roster_id) c;
    if ir < held then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players on IR — they come off before the spot goes');
    end if;
    select coalesce(max(n), 0) into held from (
      select count(*) as n from native_roster
       where league_id = p_league_id and spot = 'out' group by roster_id) c;
    if o < held then
      return jsonb_build_object('ok', false, 'error',
        'a team has ' || held || ' players on OUT — they come off before the spot goes');
    end if;
    r := _classic_starters(p_league_id) + b + tx + ir + o;
    if r > 99 then
      return jsonb_build_object('ok', false, 'error', 'the roster tops out at 99 — starters + bench + taxi + IR + OUT came to ' || r);
    end if;
    sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o);
    update league set settings_json = coalesce(settings_json, '{}'::jsonb)
        || jsonb_build_object('roster_shape', sh)
      where id = p_league_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
    update draft set rounds = r where league_id = p_league_id;
    return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir - o);
  end if;

  -- ── BEFORE THE DRAFT ─────────────────────────────────────────────────────
  b  := least(99, greatest(0, coalesce(p_bench, 0)));
  tx := least(99, greatest(0, coalesce(p_taxi, 0)));
  r  := _classic_starters(p_league_id) + b + tx + ir + o;
  if r - ir - o < 1 then
    return jsonb_build_object('ok', false, 'error', 'a draft needs at least one round that isn''t an IR spot');
  end if;
  if r < 5 or r > 99 then
    return jsonb_build_object('ok', false, 'error',
      'the draft needs 5–99 rounds — starters + bench + taxi + IR came to ' || r);
  end if;
  sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o);
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_shape', sh)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir - o);
end $$;
grant execute on function set_league_roster_shape(uuid, int, int, int, int) to authenticated;

-- The four-argument form an older build still calls: OUT stays where it is.
create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int)
  returns jsonb language sql security definer set search_path = public as $$
  select set_league_roster_shape(p_league_id, p_bench, p_taxi, p_ir, null);
$$;
grant execute on function set_league_roster_shape(uuid, int, int, int) to authenticated;

-- ── set_roster_spot — 0299's body, with the OUT branch ──────────────────────
create or replace function set_roster_spot(p_league_id uuid, p_slug text, p_spot text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; sh jsonb; cnt int; cap int; ist text; mx int; pexp int; tags text[];
begin
  if p_spot not in ('active', 'taxi', 'ir', 'out') then
    return jsonb_build_object('ok', false, 'error', 'spot must be active, taxi, ir, or out');
  end if;
  select roster_id into rid from native_roster where league_id = p_league_id and slug = p_slug;
  if rid is null then return jsonb_build_object('ok', false, 'error', 'player not rostered'); end if;
  -- 0299: the WORKER may also act, for a seat nobody holds (0213's terms).
  if not (owns_roster(p_league_id, rid) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, rid))) then
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
  elsif p_spot = 'out' then
    -- ── THE SECOND INJURED PLACE (0307) ──────────────────────────────────
    -- OUT is IR's week-to-week sibling: its own count in the shape, its own
    -- list of designations (league_out_tags — O and D by default), the same
    -- rules otherwise. No exemption for the commissioner, for 0198's reason.
    cap := coalesce((sh ->> 'out')::int, 0);
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'out' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'OUT is full — ' || cap || ' spots'); end if;
    tags := league_out_tags(p_league_id);
    select status into ist from injury_status where player_slug = p_slug;
    if ist is null or not (upper(ist) = any(tags)) then
      return jsonb_build_object('ok', false, 'error',
        'OUT is for players designated ' || array_to_string(tags, '/') ||
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

-- ── roster_rules — 0287's body, plus out_tags ───────────────────────────────
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
    'fa_mode', league_fa_mode(p_league_id),   -- 0287
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
    'ir_tags', to_jsonb(league_ir_tags(p_league_id)),
    -- …and for an OUT spot (0307), the week-to-week sibling.
    'out_tags', to_jsonb(league_out_tags(p_league_id)),
    -- 0213: may unclaimed seats work the wire? The screen needs the CURRENT
    -- value to render the switch, and absent means on, so it cannot be read
    -- off settings_json directly without duplicating that default.
    'agent_waivers', league_agent_waivers(p_league_id));
end $$;
grant execute on function roster_rules(uuid) to authenticated;
