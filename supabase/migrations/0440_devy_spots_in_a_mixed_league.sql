-- ═══════════════════════════════════════════════════════════════════════════
-- 0440 · DEVY SPOTS BESIDE COLLEGE STARTING SPOTS — THE SHELF IS A TAXI SQUAD.
--
-- Founder: "Devy spots would be like taxi spots where some players are in
-- your active roster, some are held for development."
--
-- 0366 made the devy shelf absolute: a college player LANDS in a devy spot,
-- cannot leave it, is illegal outside it, and the league stops being MIXED
-- (0372) the moment it has devy spots — so a league could start college
-- players or shelve them, never both. 0439's setup refused the pairing.
--
-- Now a MIXED league is one where college players SCORE: COLLEGE on, the NFL
-- calendar, not the devy market, and — when it has devy spots — at least one
-- starting spot that takes college players (a level, a conference or a
-- class rule). In such a league the shelf works like the taxi squad:
--   · a college player lands ACTIVE while the active roster has room, and
--     on the shelf once it is full (_devy_landing); a row inserted as 'devy'
--     (the rollover) stays there;
--   · he may be moved between devy and active (set_roster_spot), and is
--     legal in either (roster_illegal_reason);
--   · an acquisition with the shelf full may take an NFL spot
--     (devy_room_error);
--   · autopick fills an open college starting spot with a college player
--     (_autopick_slug_0387, under 0411's devy-round wrapper) — the bench and the rank picks stay NFL, and
--     the shelf fills last, as 0366 ordered it;
--   · the roster builder stores a level whenever COLLEGE is on and the
--     calendar is the NFL's (_league_may_level), so a devy league's
--     commissioner can add the first college spot; the backstop follows.
-- A devy league WITHOUT college starting spots is exactly what 0366 made:
-- every rule above keys on league_is_mixed, which is false for it.
-- The worker's readers (mixed_leagues_exist, college_calendar_in_use,
-- college_live_schools) follow league_is_mixed, so a mixed-and-devy
-- league's college starters are polled and scored into NFL weeks.
-- commish_setup_college (0439) takes the pairing. Bodies copied from 0366
-- (devy_room_error, set_roster_spot), 0389 (roster_illegal_reason), 0387 via 0411
-- (_autopick_slug_0387, the body under native_autopick_slug), 0433 (set_league_classic_slots), 0372 (the
-- backstop) and 0439 with only the marked 0440 changes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── what MIXED means now ───────────────────────────────────────────────────
create or replace function league_is_mixed(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select _league_has_college(settings_json)
       and coalesce(settings_json ->> 'calendar', 'nfl') = 'nfl'
       and coalesce(settings_json ->> 'devy_mode', 'spots') <> 'shares'   -- 0387
       -- 0440: devy spots no longer unmix a league; college starting spots
       -- are what mix it once the shelf exists.
       and (coalesce((settings_json -> 'roster_shape' ->> 'devy')::int, 0) = 0
            or jsonb_path_exists(coalesce(settings_json -> 'roster_slots', '[]'::jsonb),
                 '$[*] ? (@.level == "college" || exists(@.confs) || exists(@.classes))'))
      from league where id = p_league_id), false)
$$;
grant execute on function league_is_mixed(uuid) to authenticated;

-- May the roster builder store a spot level here? Looser than mixed on
-- purpose: the first college spot is what makes a devy league mixed.
create or replace function _league_may_level(p_league_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce((
    select _league_has_college(settings_json)
       and coalesce(settings_json ->> 'calendar', 'nfl') = 'nfl'
       and coalesce(settings_json ->> 'devy_mode', 'spots') <> 'shares'
      from league where id = p_league_id), false)
$$;
revoke all on function _league_may_level(uuid) from public, anon, authenticated;

-- ── the worker's readers, on the same definition ───────────────────────────
create or replace function mixed_leagues_exist() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league l where league_is_mixed(l.id))
$$;
revoke all on function mixed_leagues_exist() from public, anon, authenticated;
grant execute on function mixed_leagues_exist() to service_role;

create or replace function college_calendar_in_use() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league l
                  where coalesce(l.settings_json ->> 'calendar', 'nfl') = 'college'
                     or league_is_mixed(l.id))
$$;
revoke all on function college_calendar_in_use() from public, anon, authenticated;
grant execute on function college_calendar_in_use() to service_role;

-- ── the backstop — 0372's trigger function, devy spots no longer a bar ──
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
  -- 0372/0440: a spot with a level belongs to a league where college players
  -- score on the NFL calendar. The college calendar or COLLEGE off would
  -- leave it meaningless; devy spots no longer would.
  if jsonb_path_exists(coalesce(new.settings_json -> 'roster_slots', '[]'::jsonb), '$[*] ? (exists(@.level))')
     and not (_league_has_college(new.settings_json)
              and coalesce(new.settings_json ->> 'calendar', 'nfl') = 'nfl') then
    raise exception 'NFL/college spots need college players on and the NFL calendar (0372)';
  end if;
  return new;
end $$;

-- ── a college player lands active in a mixed league, on the shelf elsewhere ──
create or replace function _devy_landing() returns trigger
  language plpgsql security definer set search_path = public as $$
declare room int;
begin
  if new.slug ~ '^c-[0-9]+$' and _devy_slots(new.league_id) > 0 then
    -- 0440: in a mixed league he is an active player first — the taxi
    -- squad's rule: active while there is room, shelved once there isn't.
    -- A row that arrives AS 'devy' (the rollover, 0368) stays there.
    if league_is_mixed(new.league_id) then
      if new.spot = 'devy' then return new; end if;
      room := _classic_starters(new.league_id) + coalesce((_roster_shape(new.league_id) ->> 'bench')::int, 0)
            - (select count(*)::int from native_roster
                where league_id = new.league_id and roster_id = new.roster_id and spot = 'active');
      if room > 0 or _devy_open(new.league_id, new.roster_id) = 0 then
        new.spot := 'active';
        return new;
      end if;
    end if;
    new.spot := 'devy';
  end if;
  return new;
end $$;

-- ── devy_room_error — 0366's body, plus the NFL spot a mixed league allows ──
create or replace function devy_room_error(
  p_league_id uuid, p_roster_id int, p_slug text,
  p_count_lots boolean default false, p_exclude_slug text default null
) returns text language plpgsql stable security definer set search_path = public as $$
declare dv int; n int; rounds int;
begin
  dv := _devy_slots(p_league_id);
  if dv = 0 then return null; end if;
  if p_slug ~ '^c-[0-9]+$' then
    select count(*) into n from native_roster
     where league_id = p_league_id and roster_id = p_roster_id and spot = 'devy'
       and (p_exclude_slug is null or slug <> p_exclude_slug);
    if p_count_lots then
      n := n + (select count(*) from auction_lot al where al.league_id = p_league_id
                  and al.roster_id = p_roster_id and al.slug <> p_slug and al.slug ~ '^c-[0-9]+$');
    end if;
    if n + 1 > dv then
      -- 0440: in a mixed league he may take an NFL spot instead, as a taxi
      -- player would; elsewhere the shelf is the only place he can go.
      if not league_is_mixed(p_league_id) then
        return 'devy spots are full — this league has ' || dv;
      end if;
      select d.rounds into rounds from draft d where d.league_id = p_league_id;
      select count(*) into n from native_roster
       where league_id = p_league_id and roster_id = p_roster_id and spot <> 'devy'
         and (p_exclude_slug is null or slug <> p_exclude_slug);
      if p_count_lots then
        n := n + (select count(*) from auction_lot al where al.league_id = p_league_id
                    and al.roster_id = p_roster_id and al.slug <> p_slug and al.slug !~ '^c-[0-9]+$');
      end if;
      if rounds is not null and n + 1 > rounds - dv then
        return 'devy spots are full (' || dv || ') and so is the NFL roster (' || (rounds - dv) || ' spots)';
      end if;
    end if;
  else
    select d.rounds into rounds from draft d where d.league_id = p_league_id;
    select count(*) into n from native_roster
     where league_id = p_league_id and roster_id = p_roster_id and spot <> 'devy'
       and (p_exclude_slug is null or slug <> p_exclude_slug);
    if p_count_lots then
      n := n + (select count(*) from auction_lot al where al.league_id = p_league_id
                  and al.roster_id = p_roster_id and al.slug <> p_slug and al.slug !~ '^c-[0-9]+$');
    end if;
    if rounds is not null and n + 1 > rounds - dv then
      return 'NFL roster is full — ' || (rounds - dv) || ' spots (the other ' || dv || ' are devy)';
    end if;
  end if;
  return null;
end $$;
grant execute on function devy_room_error(uuid, int, text, boolean, text) to authenticated;

-- ── set_roster_spot — 0366's body, plus the way off the shelf in a mixed league ──
create or replace function set_roster_spot(p_league_id uuid, p_slug text, p_spot text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; sh jsonb; cnt int; cap int; ist text; mx int; pexp int; tags text[];
begin
  if p_spot not in ('active', 'taxi', 'ir', 'out', 'devy') then
    return jsonb_build_object('ok', false, 'error', 'spot must be active, taxi, ir, out, or devy');
  end if;
  select roster_id into rid from native_roster where league_id = p_league_id and slug = p_slug;
  if rid is null then return jsonb_build_object('ok', false, 'error', 'player not rostered'); end if;
  -- 0299: the WORKER may also act, for a seat nobody holds (0213's terms).
  if not (owns_roster(p_league_id, rid) or is_league_commish(p_league_id) or is_admin()
          or (auth.uid() is null and agent_wire_seat(p_league_id, rid))) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  sh := _roster_shape(p_league_id);
  -- ── DEVY (0366) ────────────────────────────────────────────────────────
  -- Devy spots hold college players, and a college player holds nothing
  -- else. A graduated player may stay in his devy spot until moved OUT of
  -- it, but nobody moves an NFL player IN.
  if p_spot = 'devy' then
    cap := coalesce((sh ->> 'devy')::int, 0);
    if cap = 0 then return jsonb_build_object('ok', false, 'error', 'this league has no devy spots'); end if;
    if p_slug !~ '^c-[0-9]+$' then
      return jsonb_build_object('ok', false, 'error', 'devy spots hold college players');
    end if;
    select count(*) into cnt from native_roster
      where league_id = p_league_id and roster_id = rid and spot = 'devy' and slug <> p_slug;
    if cnt >= cap then return jsonb_build_object('ok', false, 'error', 'devy is full — ' || cap || ' spots'); end if;
  elsif p_slug ~ '^c-[0-9]+$' and coalesce((sh ->> 'devy')::int, 0) > 0 and not league_is_mixed(p_league_id) then
    -- 0440: in a mixed league (college starting spots) he comes off the
    -- shelf like a taxi player; elsewhere a college player is held.
    return jsonb_build_object('ok', false, 'error', 'a college player stays in a devy spot until he reaches the NFL');
  elsif p_spot = 'taxi' then
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

-- ── roster_illegal_reason — 0389's body, the devy rule keyed on mixed ──
create or replace function roster_illegal_reason(p_league_id uuid, p_roster_id integer) returns text
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; cnt int; rec record; cap int; sh jsonb; seats int; tags text[]; mx int; feed boolean; dv int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return null; end if;
  sh := _roster_shape(p_league_id);
  dv := coalesce((sh ->> 'devy')::int, 0);

  -- ── 0366: a college player outside the devy spots ──
  -- 0440: not in a mixed league, where he may be active and start.
  if dv > 0 and not league_is_mixed(p_league_id) then
    select lp.full_name into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id
       and nr.slug ~ '^c-[0-9]+$' and nr.spot <> 'devy'
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is a college player outside the devy spots — move him to devy or drop him';
    end if;
  end if;

  -- ── a stashed player who no longer belongs there ──
  feed := exists (select 1 from injury_status limit 1);
  if feed then
    tags := league_ir_tags(p_league_id);
    select lp.full_name, coalesce(upper(i.status), '') as st into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      left join injury_status i on i.player_slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'ir'
       and not classic_slug_started(p_league_id, nr.slug)   -- 0389: can't be moved this week
       and not (coalesce(upper(i.status), '') = any(tags))
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is on IR but isn''t designated ' || array_to_string(tags, '/')
        || coalesce(' (he''s ' || nullif(rec.st, '') || ')', ' any more') || ' — move him off IR or drop him';
    end if;
    tags := league_out_tags(p_league_id);
    select lp.full_name, coalesce(upper(i.status), '') as st into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      left join injury_status i on i.player_slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'out'
       and not classic_slug_started(p_league_id, nr.slug)   -- 0389
       and not (coalesce(upper(i.status), '') = any(tags))
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is in an OUT spot but isn''t designated ' || array_to_string(tags, '/')
        || coalesce(' (he''s ' || nullif(rec.st, '') || ')', ' any more') || ' — move him out of it or drop him';
    end if;
  end if;
  mx := (select nullif(settings_json -> 'taxi' ->> 'max_exp', '')::int from league where id = p_league_id);
  if mx is not null then
    select lp.full_name, lp.exp into rec
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
     where nr.league_id = p_league_id and nr.roster_id = p_roster_id and nr.spot = 'taxi' and lp.exp > mx
     order by lp.full_name limit 1;
    if found then
      return rec.full_name || ' is on the taxi squad with ' || rec.exp || case when rec.exp = 1 then ' year' else ' years' end || ' (the limit is ' || mx
        || ') — move him to your active roster or drop him';
    end if;
  end if;

  -- ── a shelf, or the active roster, over its size ──
  if sh <> '{}'::jsonb then
    for rec in select s.spot, s.label from (values ('taxi', 'taxi squad'), ('ir', 'IR'), ('out', 'OUT'), ('devy', 'devy squad')) s(spot, label) loop
      cap := coalesce((sh ->> rec.spot)::int, 0);
      select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = rec.spot;
      if cnt > cap then
        return 'the ' || rec.label || ' holds ' || cnt || ' (limit ' || cap || ') — move or drop ' || (cnt - cap);
      end if;
    end loop;
  end if;
  -- The active roster may run over its seats by the taxi spots still open: a
  -- draft fills the taxi's share of the roster as ACTIVE players (seat-cap
  -- probes, sc2), and they stay legal until the taxi has room they won't use.
  -- Beyond that, there's nowhere for them to be.
  seats := league_active_seats(p_league_id);
  if seats is not null and sh <> '{}'::jsonb then
    select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = 'active';
    cap := seats + greatest(coalesce((sh ->> 'taxi')::int, 0)
             - (select count(*)::int from native_roster where league_id = p_league_id and roster_id = p_roster_id and spot = 'taxi'), 0);
    if cnt > cap then
      return 'the active roster holds ' || cnt || ' (room for ' || cap || ') — drop or stash ' || (cnt - cap);
    end if;
  end if;

  -- ── the two it always knew ──
  select count(*) into cnt from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  if cnt > d.rounds then
    return 'roster holds ' || cnt || ' players (limit ' || d.rounds || ') — drop ' || (cnt - d.rounds);
  end if;
  for rec in
    select lp.pos, count(*)::int as n
    from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = p_league_id and nr.roster_id = p_roster_id
      and (dv = 0 or nr.spot <> 'devy') group by lp.pos
  loop
    cap := league_pos_cap(p_league_id, rec.pos);
    if cap is not null and rec.n > cap then
      return 'over the ' || pos_label(rec.pos) || ' limit (' || rec.n || '/' || cap || ') — drop ' || (rec.n - cap);
    end if;
  end loop;
  return null;
end $$;

-- ── _autopick_slug_0387 — 0387's autopick body under the name 0411 gave it
--    (native_autopick_slug is 0411's devy-round wrapper around it, untouched),
--    college starting spots fill ──
create or replace function _autopick_slug_0387(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  dv int := _devy_slots(p_league_id);
  mixed boolean := league_is_mixed(p_league_id);   -- 0440
  taken text[];
  held jsonb; caps jsonb; spotn jsonb;
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int; cap_rb int; cap_wr int; cap_te int; cap_k int; cap_def int;
  remaining int; need_k boolean; need_def boolean; forced int; pick text; open jsonb;
begin
  -- Asked once per pick, not once per pool row (0380).
  taken := array(select nr.slug from native_roster nr where nr.league_id = p_league_id
                 union all select al.slug from auction_lot al where al.league_id = p_league_id);
  -- 0387: DEVY SHARES. A seat whose picks left equal its untaken
  -- reservations takes the best of them; nobody takes another's.
  if _devy_shares_on(p_league_id) then
    if _devy_pick_forced(p_league_id, p_roster_id) then
      select r.slug into pick from devy_reserved(p_league_id) r
        join league_pool lp on lp.league_id = p_league_id and lp.slug = r.slug
       where r.roster_id = p_roster_id order by lp.rank limit 1;
      if pick is not null then return pick; end if;
    end if;
    taken := taken || array(select r.slug from devy_reserved(p_league_id) r where r.roster_id <> p_roster_id);
  end if;
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
      -- 0440: in a mixed league a college player may fill an open COLLEGE
      -- starting spot now (college rows rank after every NFL row, so he is
      -- taken only when no NFL player fits what is open); the bench and the
      -- rank picks below stay NFL, and the devy shelf fills last as before.
      and (dv = 0 or lp.level = 'nfl' or mixed)
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

-- ── set_league_classic_slots — 0433's body, levels on _league_may_level ──
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
  mixed := _league_may_level(p_league_id);   -- 0372/0440: COLLEGE on and the NFL calendar — devy spots no longer bar a level
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
        return jsonb_build_object('ok', false, 'error', 'NFL/college spots are for leagues where both score (COLLEGE on, NFL calendar, not the devy market)');
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

-- ── commish_setup_college — 0439's body, the pairing allowed ──
create or replace function commish_setup_college(p_league_id uuid, p_lineup text default 'none',
    p_college_spots int default 1, p_devy_spots int default 0, p_market boolean default false)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; r jsonb; sh jsonb; st int; drounds int; dstat text; dmode text; spec jsonb; i int;
        lineup text := coalesce(nullif(lower(btrim(p_lineup)), ''), 'none');
        cspots int := least(6, greatest(1, coalesce(p_college_spots, 1)));
        dspots int := least(10, greatest(0, coalesce(p_devy_spots, 0)));
        market boolean := coalesce(p_market, false);
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  if lineup not in ('none', 'mixed', 'college') then
    return jsonb_build_object('ok', false, 'error', 'the lineup is none, mixed or college');
  end if;
  select * into lg from league where id = p_league_id;
  if not found or lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league'); end if;
  if league_sport(p_league_id) <> 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'college players have no place in a daily sport''s pool');
  end if;
  if coalesce(lg.settings_json ->> 'game_mode', 'drip') <> 'classic' then
    return jsonb_build_object('ok', false, 'error', 'college players need a classic league');
  end if;
  select status, mode, rounds into dstat, dmode, drounds from draft where league_id = p_league_id;
  if dstat is not null and dstat <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'college players are set up before the draft — after it, ask an admin');
  end if;
  -- Nothing chosen: an NFL-only league, untouched.
  if lineup = 'none' and dspots = 0 and not market then
    return jsonb_build_object('ok', true, 'lineup', 'none', 'college_spots', 0, 'devy_spots', 0, 'market', false);
  end if;
  -- THE COMBINATIONS THE ENGINE CAN'T HONOUR YET — refused before any write.
  -- (0440: college lineup spots + devy spots now combine.)
  if lineup = 'college' and dspots > 0 then
    return jsonb_build_object('ok', false, 'error', 'a college-only league has no devy spots — every spot already takes college players; hold prospects on the taxi squad');
  end if;
  if market and dspots > 0 then
    return jsonb_build_object('ok', false, 'error', 'the devy market and devy spots can''t combine — shares reserve a player''s rookie-draft rights, and a league that also drafts him into a devy spot makes the shares worthless');
  end if;
  if market and lineup = 'mixed' then
    return jsonb_build_object('ok', false, 'error', 'the devy market keeps college players out of the draft pool, and college lineup spots need them in it — they can''t combine yet');
  end if;
  if market and lineup = 'college' then
    return jsonb_build_object('ok', false, 'error', 'the devy market is for leagues on the NFL schedule');
  end if;
  if market and dmode = 'auction' then
    return jsonb_build_object('ok', false, 'error', 'the devy market needs a snake or linear draft — an auction can''t honour a reserved player');
  end if;

  -- COLLEGE on (0365), as 0398 did.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('positions_extra',
           (select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
              from jsonb_array_elements_text(coalesce(settings_json -> 'positions_extra', '[]'::jsonb) || '["COLLEGE"]'::jsonb) v))
   where id = p_league_id;

  -- The shape a league that never saved one implies — its draft rounds less
  -- the starters — materialised first, so added spots grow the rounds
  -- (0398's rule for devy spots, the same for college starting spots).
  sh := _roster_shape(p_league_id); st := _classic_starters(p_league_id);
  if sh = '{}'::jsonb then
    r := set_league_roster_shape(p_league_id, greatest(0, coalesce(drounds, 0) - st), 0, 0, 0, 0);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;

  if lineup = 'mixed' then
    -- College-only starting spots (0372 levels), a flex each, after the
    -- lineup the league already has. The commissioner can reshape them in
    -- the roster builder like any other spot.
    spec := _classic_slot_spec(p_league_id);
    for i in 1 .. cspots loop
      spec := spec || jsonb_build_array(jsonb_build_object('pos', '["RB","WR","TE"]'::jsonb, 'level', 'college', 'label', 'COLLEGE'));
    end loop;
    r := set_league_classic_slots(p_league_id, spec);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  elsif lineup = 'college' then
    r := _league_calendar_apply(p_league_id, 'college');
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;

  if dspots > 0 then
    sh := _roster_shape(p_league_id);
    r := set_league_roster_shape(p_league_id, coalesce((sh ->> 'bench')::int, 0),
      coalesce((sh ->> 'taxi')::int, 0), coalesce((sh ->> 'ir')::int, 0), coalesce((sh ->> 'out')::int, 0), dspots);
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;

  if market then
    r := set_league_devy_mode(p_league_id, 'shares');
    if not coalesce((r ->> 'ok')::boolean, false) then return r; end if;
  end if;

  return jsonb_build_object('ok', true, 'lineup', lineup,
    'college_spots', case when lineup = 'mixed' then cspots else 0 end,
    'devy_spots', dspots, 'market', market,
    'rounds', (select rounds from draft where league_id = p_league_id));
end $$;
grant execute on function commish_setup_college(uuid, text, int, int, boolean) to authenticated;
