-- ═══════════════════════════════════════════════════════════════════════════
-- 0366 · COLLEGE PLAYERS, PHASE 2a — DEVY SPOTS.
--
-- An NFL classic league may hold a fixed number of DEVY spots per team: only
-- college players (c-<espn_id>, 0365) sit there, they never start, and every
-- other spot is the NFL roster. The model follows taxi (0164) and OUT (0307):
--
--   · native_roster.spot gains 'devy'. Everything that reads a stash as "not
--     active" — the lineup guard, the lock-time fill, the classic resolve,
--     best ball — already covers it, because none of them name the shelf.
--   · roster_shape.devy is a count, and like bench and taxi it is DRAFTED:
--     draft.rounds (the ROSTER SIZE) counts it. It is set before the draft and
--     locks with bench and taxi. It needs COLLEGE on (0365).
--   · The split is enforced where every acquisition already asks:
--     pos_cap_error (draft picks, adds, waivers, auction) and trade_cap_error
--     (trades). A college player needs an open devy spot; an NFL player one of
--     the other (rounds − devy) spots. Devy spots carry no position caps.
--   · A college player LANDS in devy (a trigger on native_roster), so a draft
--     or a claim never leaves him active for a moment.
--   · set_roster_spot: only college players move into devy, and a college
--     player cannot move out of it. A GRADUATED player (phase 2b) may stay in
--     his devy spot until his manager moves him, so the rules key on the
--     player's level, and counts key on the spot.
--   · roster_illegal_reason learns the devy shelf, and that a college player
--     outside it is illegal.
--   · autopick fills NFL spots first and devy spots last.
--   · the pool filter takes a level ('college' seeds a devy draft's pool).
-- A league with no devy spots (every league today) behaves exactly as before:
-- each patch is gated on _devy_slots() > 0.
-- Function bodies are copied from their live migrations (0071, 0072, 0171,
-- 0195, 0307, 0360) with only the marked 0366 changes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the spot ─────────────────────────────────────────────────────────────────
alter table native_roster drop constraint if exists native_roster_spot_check;
alter table native_roster add constraint native_roster_spot_check
  check (spot in ('active', 'taxi', 'ir', 'out', 'devy'));

-- ── helpers ──────────────────────────────────────────────────────────────────
create or replace function _devy_slots(p_league_id uuid) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce((_roster_shape(p_league_id) ->> 'devy')::int, 0)
$$;

-- Open devy spots on one team.
create or replace function _devy_open(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select greatest(0, _devy_slots(p_league_id)
    - (select count(*)::int from native_roster
        where league_id = p_league_id and roster_id = p_roster_id and spot = 'devy'))
$$;

-- Would acquiring p_slug overfill the devy spots, or the NFL spots? Null when
-- legal or when the league has no devy spots. Same arguments as pos_cap_error.
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
      return 'devy spots are full — this league has ' || dv;
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

-- ── a college player lands in devy ───────────────────────────────────────────
create or replace function _devy_landing() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if new.slug ~ '^c-[0-9]+$' and _devy_slots(new.league_id) > 0 then
    new.spot := 'devy';
  end if;
  return new;
end $$;
drop trigger if exists native_roster_devy_landing on native_roster;
create trigger native_roster_devy_landing before insert on native_roster
  for each row execute function _devy_landing();

-- ── pos_cap_error — 0071's body, devy-aware ──
create or replace function pos_cap_error(
  p_league_id uuid, p_roster_id int, p_slug text,
  p_count_lots boolean default false, p_exclude_slug text default null
) returns text language plpgsql stable security definer set search_path = public as $$
declare ppos text; cap int; n int; dv int; e text;
begin
  -- 0366: in a devy league a college player needs a devy spot, an NFL player
  -- one of the others; devy spots carry no position caps.
  e := devy_room_error(p_league_id, p_roster_id, p_slug, p_count_lots, p_exclude_slug);
  if e is not null then return e; end if;
  dv := _devy_slots(p_league_id);
  if dv > 0 and p_slug ~ '^c-[0-9]+$' then return null; end if;
  select lp.pos into ppos from league_pool lp where lp.league_id = p_league_id and lp.slug = p_slug;
  if ppos is null then return null; end if;   -- "not in pool" is the caller's error
  cap := league_pos_cap(p_league_id, ppos);
  if cap is null then return null; end if;
  select count(*) into n
  from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
  where nr.league_id = p_league_id and nr.roster_id = p_roster_id and lp.pos = ppos
    and (p_exclude_slug is null or nr.slug <> p_exclude_slug)
    and (dv = 0 or nr.spot <> 'devy');
  if p_count_lots then
    n := n + (select count(*) from auction_lot al
              join league_pool lp on lp.league_id = al.league_id and lp.slug = al.slug
              where al.league_id = p_league_id and al.roster_id = p_roster_id
                and lp.pos = ppos and al.slug <> p_slug
                and (dv = 0 or al.slug !~ '^c-[0-9]+$'));
  end if;
  if n + 1 > cap then
    return case when cap = 0 then 'this league does not roster ' || pos_label(ppos)
                else 'position limit — this league rosters at most ' || cap || ' ' || pos_label(ppos) end;
  end if;
  return null;
end $$;

-- ── trade_cap_error — 0072's body, devy-aware ──
create or replace function trade_cap_error(p_league_id uuid, p_roster_id int, p_out jsonb, p_in jsonb)
  returns text language plpgsql stable security definer set search_path = public as $$
declare rec record; cap int; cur int; rounds int; new_n int; dv int;
begin
  dv := _devy_slots(p_league_id);
  select d.rounds into rounds from draft d where d.league_id = p_league_id;
  select count(*) into cur from native_roster where league_id = p_league_id and roster_id = p_roster_id;
  new_n := cur - jsonb_array_length(p_out) + jsonb_array_length(p_in);
  if new_n > rounds then
    return 'trade would overfill Team ' || p_roster_id || '''s roster (' || rounds || ' spots)';
  end if;
  -- 0366: devy spots and the rest fill separately. A traded row keeps its
  -- spot, so count by spot on both sides of the deal.
  if dv > 0 then
    select count(*) filter (where spot = 'devy'), count(*) filter (where spot <> 'devy') into cur, new_n
      from native_roster where league_id = p_league_id and roster_id = p_roster_id;
    cur := cur
      - (select count(*) from jsonb_array_elements_text(p_out) s(slug) join native_roster x
           on x.league_id = p_league_id and x.slug = s.slug and x.spot = 'devy')
      + (select count(*) from jsonb_array_elements_text(p_in) s(slug) join native_roster x
           on x.league_id = p_league_id and x.slug = s.slug and x.spot = 'devy');
    if cur > dv then
      return 'trade would overfill Team ' || p_roster_id || '''s devy spots (' || dv || ')';
    end if;
    new_n := new_n
      - (select count(*) from jsonb_array_elements_text(p_out) s(slug) join native_roster x
           on x.league_id = p_league_id and x.slug = s.slug and x.spot <> 'devy')
      + (select count(*) from jsonb_array_elements_text(p_in) s(slug) join native_roster x
           on x.league_id = p_league_id and x.slug = s.slug and x.spot <> 'devy');
    if new_n > rounds - dv then
      return 'trade would overfill Team ' || p_roster_id || '''s NFL roster (' || (rounds - dv) || ' spots)';
    end if;
  end if;
  for rec in
    select t.pos, sum(t.inc)::int as inc, sum(t.outc)::int as outc from (
      select lp.pos, 1 as inc, 0 as outc from jsonb_array_elements_text(p_in) s(slug)
        join league_pool lp on lp.league_id = p_league_id and lp.slug = s.slug
        join native_roster x on x.league_id = p_league_id and x.slug = s.slug and (dv = 0 or x.spot <> 'devy')
      union all
      select lp.pos, 0, 1 from jsonb_array_elements_text(p_out) s(slug)
        join league_pool lp on lp.league_id = p_league_id and lp.slug = s.slug
        join native_roster x on x.league_id = p_league_id and x.slug = s.slug and (dv = 0 or x.spot <> 'devy')
    ) t group by t.pos
  loop
    cap := league_pos_cap(p_league_id, rec.pos);
    if cap is not null then
      select count(*) into cur
      from native_roster nr join league_pool lp on lp.league_id = nr.league_id and lp.slug = nr.slug
      where nr.league_id = p_league_id and nr.roster_id = p_roster_id and lp.pos = rec.pos
        and (dv = 0 or nr.spot <> 'devy');
      new_n := cur - rec.outc + rec.inc;
      if new_n > cap then
        return 'position limit — Team ' || p_roster_id || ' would hold more than ' || cap || ' ' || pos_label(rec.pos);
      end if;
    end if;
  end loop;
  return null;
end $$;

-- ── roster_illegal_reason — 0360's body, plus the devy shelf ──
create or replace function roster_illegal_reason(p_league_id uuid, p_roster_id integer) returns text
  language plpgsql stable security definer set search_path = public as $$
declare d draft%rowtype; cnt int; rec record; cap int; sh jsonb; seats int; tags text[]; mx int; feed boolean; dv int;
begin
  select * into d from draft where league_id = p_league_id;
  if not found or d.status <> 'complete' then return null; end if;
  sh := _roster_shape(p_league_id);
  dv := coalesce((sh ->> 'devy')::int, 0);

  -- ── 0366: a college player outside the devy spots ──
  if dv > 0 then
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

-- ── set_roster_spot — 0307's body, plus devy ──
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
  elsif p_slug ~ '^c-[0-9]+$' and coalesce((sh ->> 'devy')::int, 0) > 0 then
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

-- ── native_autopick_slug — 0195's body, NFL spots first ──
create or replace function native_autopick_slug(p_league_id uuid, p_roster_id int, p_rounds int)
  returns text language plpgsql security definer set search_path = public as $$
declare
  qb_n int; rb_n int; wr_n int; te_n int; k_n int; def_n int; total int;
  cap_qb int := league_pos_cap(p_league_id, 'QB'); cap_rb int := league_pos_cap(p_league_id, 'RB');
  cap_wr int := league_pos_cap(p_league_id, 'WR'); cap_te int := league_pos_cap(p_league_id, 'TE');
  cap_k  int := league_pos_cap(p_league_id, 'K');  cap_def int := league_pos_cap(p_league_id, 'DEF');
  remaining int; need_k boolean; need_def boolean; forced int; pick text;
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

-- ── _sync_classic_rounds — 0307's body, plus devy ──
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
     + coalesce((sh ->> 'out')::int, 0)
     + coalesce((sh ->> 'devy')::int, 0);  -- 0366: devy spots are drafted
  -- `rounds` is the ROSTER SIZE and counts both injured shelves: spots a team
  -- may hold. `stash_slots` is how many of them the DRAFT does not fill.
  update draft set rounds = r, stash_slots = coalesce((sh ->> 'ir')::int, 0) + coalesce((sh ->> 'out')::int, 0)
    where league_id = p_league_id and status = 'pending';
end $$;

-- ── set_league_roster_shape — 0307's body, plus a sixth argument ──
create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int, p_out int, p_devy int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; drounds int; b int; tx int; ir int; o int; r int; sh jsonb; cur_ir int; cur_out int; held int; dv int;
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
  -- 0366: devy spots, drafted like bench and taxi, and only for a league
  -- with college players.
  dv := least(99, greatest(0, coalesce(p_devy, (sh ->> 'devy')::int, 0)));
  if dv > 0 and not _league_has_college((select settings_json from league where id = p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'devy spots need college players turned on for this league');
  end if;

  if dstat is not null and dstat <> 'pending' then
    if dv <> coalesce((sh ->> 'devy')::int, 0) then
      return jsonb_build_object('ok', false, 'error', 'devy spots lock once the draft starts');
    end if;
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
      return jsonb_build_object('ok', true, 'shape', jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end,
        'rounds', _classic_starters(p_league_id) + b + tx + ir + o + dv,
        'draft_rounds', _classic_starters(p_league_id) + b + tx + dv);
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
    r := _classic_starters(p_league_id) + b + tx + ir + o + dv;
    if r > 99 then
      return jsonb_build_object('ok', false, 'error', 'the roster tops out at 99 — starters + bench + taxi + IR + OUT came to ' || r);
    end if;
    sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end;
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
  r  := _classic_starters(p_league_id) + b + tx + ir + o + dv;
  if r - ir - o < 1 then
    return jsonb_build_object('ok', false, 'error', 'a draft needs at least one round that isn''t an IR spot');
  end if;
  if r < 5 or r > 99 then
    return jsonb_build_object('ok', false, 'error',
      'the draft needs 5–99 rounds — starters + bench + taxi + IR came to ' || r);
  end if;
  sh := jsonb_build_object('bench', b, 'taxi', tx, 'ir', ir, 'out', o)
        || case when dv > 0 then jsonb_build_object('devy', dv) else '{}'::jsonb end;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || jsonb_build_object('roster_shape', sh)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  perform _sync_classic_rounds(p_league_id);
  return jsonb_build_object('ok', true, 'shape', sh, 'rounds', r, 'draft_rounds', r - ir - o);
end $$;
grant execute on function set_league_roster_shape(uuid, int, int, int, int, int) to authenticated;

-- The five-argument form an older build still calls: devy stays where it is.
create or replace function set_league_roster_shape(p_league_id uuid, p_bench int, p_taxi int, p_ir int, p_out int)
  returns jsonb language sql security definer set search_path = public as $$
  select set_league_roster_shape(p_league_id, p_bench, p_taxi, p_ir, p_out, null);
$$;
grant execute on function set_league_roster_shape(uuid, int, int, int, int) to authenticated;

-- ── set_league_pool_filter — 0171's body, plus a level ──
create or replace function set_league_pool_filter(p_league_id uuid, p_filter jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare dstat text; cleaned jsonb := '{}'::jsonb; tarr jsonb := '[]'::jsonb; ps jsonb; v text; mn int; mx int;
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
  if cleaned = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'the filter needs teams, a tenure window or a level');
  end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('pool_filter', cleaned)
    where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  return jsonb_build_object('ok', true, 'filter', cleaned);
end $$;
grant execute on function set_league_pool_filter(uuid, jsonb) to authenticated;
