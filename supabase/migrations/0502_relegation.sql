-- 0502: RELEGATION — tiers of linked leagues (founder: "a customizable
-- relegation system … usually used for large leagues").
--
-- A LADDER links native leagues as tiers, tier 1 on top. At the end of the
-- season the commissioner runs ONE rollover for the whole ladder: every tier
-- rolls into next season (rollover_league, unchanged), then the bottom
-- `movers` of each tier swap places with the top `movers` of the tier below.
--
-- The commissioner's settings (founder's picks):
--   method       'standings'          final W-L standings
--                'points'             total points scored
--                'playoffs'           playoff result (champion, runner-up, then
--                                     the consolation ladder's final order)
--                'promotion_playoff'  the top movers−1 by record go up; the last
--                                     spot goes to the best playoff finish of
--                                     the rest. Relegation is by record.
--                For 'points' and 'playoffs', relegation reads the same order
--                from the bottom; for the other two, the record.
--   roster_mode  'redraft'  managers move; a mover's new seat starts empty
--                           (its carried keepers go back to the pool)
--                'seat'     the mover takes the seat they move into — its
--                           roster, keepers and picks
--                'roster'   the mover takes their roster with them; a player
--                           the new league has no copy left of stays behind
--                           (named in the result)
--
-- Pairing: the tier's worst team takes the seat of the best team coming up,
-- and so on. Seats keep their division; picks stay with the seat. Every tier
-- must be the same season, NFL, and the caller must be commissioner of every
-- tier (or an admin). 'roster' mode refuses salary-cap leagues, whose
-- contracts are written to a seat.

create table if not exists league_ladder (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid references app_user(id) on delete set null,
  method      text not null default 'standings'
              check (method in ('standings', 'points', 'playoffs', 'promotion_playoff')),
  movers      int not null default 2 check (movers between 1 and 6),
  roster_mode text not null default 'seat' check (roster_mode in ('redraft', 'seat', 'roster')),
  created_at  timestamptz not null default now()
);

create table if not exists league_ladder_tier (
  ladder_id uuid not null references league_ladder(id) on delete cascade,
  tier      int  not null check (tier between 1 and 10),
  league_id uuid not null unique references league(id) on delete cascade,
  primary key (ladder_id, tier)
);

-- Every move ever made, for the history line and the league's own record.
create table if not exists league_ladder_move (
  id          bigserial primary key,
  ladder_id   uuid not null references league_ladder(id) on delete cascade,
  season      text not null,                -- the season that was just played
  direction   text not null check (direction in ('up', 'down')),
  from_tier   int not null,
  to_tier     int not null,
  from_league uuid,                          -- the season played
  to_league   uuid,                          -- next season's league
  from_roster int not null,
  to_roster   int not null,
  app_user_id uuid,
  team_name   text,
  left_behind jsonb not null default '[]'::jsonb,   -- 'roster' mode: players with no copy left there
  created_at  timestamptz not null default now()
);
create index if not exists league_ladder_move_ladder on league_ladder_move(ladder_id, season);

alter table league_ladder enable row level security;
alter table league_ladder_tier enable row level security;
alter table league_ladder_move enable row level security;
revoke all on league_ladder, league_ladder_tier, league_ladder_move from anon, authenticated;

-- ── standings without the member gate (0482's body) ────────────────────────
-- A ladder reads every tier's standings for a member of any tier, so the
-- body moves behind league_standings' gate into an internal function.
create or replace function _league_standings_raw(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'roster_id', z.rid, 'team', z.team_name, 'division', z.division,
        'wins', z.w, 'losses', z.l, 'ties', z.t, 'pf', z.pf, 'pa', z.pa,
        'median_w', z.mw, 'median_l', z.ml,
        'vampire', league_format(p_league_id) = 'vampire' and is_vampire_seat(p_league_id, z.rid),
        'eliminated', z.eliminated)
      order by z.w desc, case when league_lower_wins(p_league_id) then -z.pf else z.pf end desc, z.rid)
    from (
      select m.sleeper_roster_id as rid, m.team_name, m.division, m.eliminated_week as eliminated,
             coalesce(s.w, 0) as w, coalesce(s.l, 0) as l, coalesce(s.t, 0) as t,
             coalesce(s.pf, 0) as pf, coalesce(s.pa, 0) as pa,
             coalesce(s.mw, 0) as mw, coalesce(s.ml, 0) as ml
      from league_membership m
      left join (
        select x.rid, count(*) filter (where golf_beats(p_league_id, x.us, x.them)) as w,
               count(*) filter (where golf_beats(p_league_id, x.them, x.us)) as l,
               count(*) filter (where x.us = x.them) as t,
               count(*) filter (where not x.pts and golf_beats(p_league_id, x.us, x.them)) as mw,
               count(*) filter (where not x.pts and golf_beats(p_league_id, x.them, x.us)) as ml,
               sum(x.us) filter (where x.pts) as pf, sum(x.them) filter (where x.pts) as pa
        from (
          with fin as (
            select mu.week, mu.home_roster_id as rid, mu.home_final as us, mu.away_final as them
            from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
              and not is_practice_week(mu.week)
              and mu.home_final is not null and mu.away_final is not null
            union all
            select mu.week, mu.away_roster_id, mu.away_final, mu.home_final
            from matchup mu where mu.league_id = p_league_id and mu.status = 'final' and not mu.is_playoff
              and not is_practice_week(mu.week)
              and mu.home_final is not null and mu.away_final is not null
          ),
          med as (select week, (percentile_cont(0.5) within group (order by us))::numeric as med from fin group by week)
          select fin.rid, fin.us, fin.them, true as pts from fin
          union all
          select fin.rid, fin.us, med.med, false from fin join med on med.week = fin.week
          where league_median_game(p_league_id)
        ) x group by x.rid
      ) s on s.rid = m.sleeper_roster_id
      where m.league_id = p_league_id
    ) z), '[]'::jsonb);
end $$;
create or replace function league_standings(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is not null and not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  return _league_standings_raw(p_league_id);
end $$;
revoke all on function _league_standings_raw(uuid) from public, anon, authenticated;

-- ── who may run it ─────────────────────────────────────────────────────────
create or replace function _ladder_can_edit(p_ladder uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select is_admin() or (
    exists (select 1 from league_ladder_tier t where t.ladder_id = p_ladder)
    and not exists (select 1 from league_ladder_tier t
                     where t.ladder_id = p_ladder and not is_league_commish(t.league_id)));
$$;

-- ── the leagues a ladder may hold ──────────────────────────────────────────
create or replace function _ladder_check(p_leagues uuid[], p_movers int, p_mode text, p_ladder uuid)
  returns text language plpgsql stable security definer set search_path = public as $$
declare lid uuid; lg league%rowtype; seas text; n int; i int := 0;
begin
  if p_leagues is null or cardinality(p_leagues) < 2 then return 'a ladder needs at least two leagues'; end if;
  if cardinality(p_leagues) > 10 then return 'a ladder holds up to 10 tiers'; end if;
  if (select count(distinct x) from unnest(p_leagues) x) <> cardinality(p_leagues) then
    return 'a league can only be one tier';
  end if;
  foreach lid in array p_leagues loop
    i := i + 1;
    select * into lg from league where id = lid;
    if not found then return 'no such league'; end if;
    if not (is_admin() or is_league_commish(lid)) then
      return 'you need to be commissioner of every tier — not of ' || lg.name;
    end if;
    if lg.provider <> 'native' or lg.kind <> 'league' or lg.is_mock then
      return lg.name || ' can''t be a tier — only full Drip leagues';
    end if;
    if coalesce(lg.sport, 'nfl') <> 'nfl' then return lg.name || ' isn''t an NFL league'; end if;
    if seas is null then seas := lg.season;
    elsif seas is distinct from lg.season then return 'every tier must be the same season'; end if;
    if exists (select 1 from league_ladder_tier t where t.league_id = lid and t.ladder_id is distinct from p_ladder) then
      return lg.name || ' is already in another ladder';
    end if;
    select count(*) into n from league_membership m where m.league_id = lid;
    -- the top tier only sends teams down and the bottom only up, but a middle
    -- tier does both, and the two groups can't overlap
    if n < p_movers * (case when i = 1 or i = cardinality(p_leagues) then 1 else 2 end) + 1 then
      return lg.name || ' has ' || n || ' teams — too few to move ' || p_movers || ' each way';
    end if;
    if p_mode = 'roster' and contracts_on(lid) then
      return lg.name || ' is a salary-cap league — contracts stay with the seat, so it can''t move rosters';
    end if;
  end loop;
  return null;
end $$;

-- ── the season's order, best first ─────────────────────────────────────────
-- 'standings' — the league's own standings; 'points' — points scored (fewest
-- first in a lower-wins league); 'playoffs' — champion, runner-up, then the
-- consolation ladder, then anyone left in standings order. A league that
-- played no playoffs reads its standings.
create or replace function _ladder_rank(p_league_id uuid, p_method text) returns int[]
  language plpgsql stable security definer set search_path = public as $$
declare st jsonb; out int[] := '{}'; champ int; runner int; br jsonb; rid int;
begin
  st := _league_standings_raw(p_league_id);
  if jsonb_typeof(st) <> 'array' then return out; end if;
  if p_method = 'points' then
    select array_agg((e ->> 'roster_id')::int order by
             case when league_lower_wins(p_league_id) then (e ->> 'pf')::numeric else -(e ->> 'pf')::numeric end, o)
      into out from jsonb_array_elements(st) with ordinality x(e, o);
    return coalesce(out, '{}');
  end if;
  if p_method = 'playoffs' then
    select nullif(settings_json ->> 'playoff_champion', '')::int, settings_json -> 'playoff_bracket'
      into champ, br from league where id = p_league_id;
    if champ is not null then
      out := array[champ];
      select case when mu.home_roster_id = champ then mu.away_roster_id else mu.home_roster_id end into runner
        from matchup mu
       where mu.league_id = p_league_id and mu.is_playoff and not mu.is_consolation
         and champ in (mu.home_roster_id, mu.away_roster_id)
       order by mu.week desc limit 1;
      if runner is not null and runner <> champ then out := out || runner; end if;
      for rid in select (c #>> '{}')::int from jsonb_array_elements(coalesce(br -> 'consolation', '[]'::jsonb)) c loop
        if not rid = any(out) then out := out || rid; end if;
      end loop;
    end if;
  end if;
  for rid in select (e ->> 'roster_id')::int from jsonb_array_elements(st) with ordinality x(e, o) order by o loop
    if not rid = any(out) then out := out || rid; end if;
  end loop;
  return out;
end $$;

-- ── who goes up and who goes down, tier by tier ────────────────────────────
-- [{tier, league_id, up: [rid…] best first, down: [rid…] worst first}]
create or replace function _ladder_movers(p_ladder uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare lad league_ladder%rowtype; t record; ntiers int; out jsonb := '[]'::jsonb;
        promo int[]; rel int[]; rk int[]; pl int[]; i int; rid int;
begin
  select * into lad from league_ladder where id = p_ladder;
  select max(tier) into ntiers from league_ladder_tier where ladder_id = p_ladder;
  for t in select * from league_ladder_tier where ladder_id = p_ladder order by tier loop
    promo := '{}'; rel := '{}';
    rk := _ladder_rank(t.league_id, case when lad.method in ('points', 'playoffs') then lad.method else 'standings' end);
    if t.tier > 1 then
      if lad.method = 'promotion_playoff' then
        promo := rk[1:lad.movers - 1];
        pl := _ladder_rank(t.league_id, 'playoffs');
        foreach rid in array pl loop
          exit when cardinality(promo) >= lad.movers;
          if not rid = any(promo) then promo := promo || rid; end if;
        end loop;
      else
        promo := rk[1:lad.movers];
      end if;
    end if;
    if t.tier < ntiers then
      for i in reverse cardinality(rk)..1 loop
        exit when cardinality(rel) >= lad.movers;
        if not rk[i] = any(promo) then rel := rel || rk[i]; end if;
      end loop;
    end if;
    out := out || jsonb_build_object('tier', t.tier, 'league_id', t.league_id,
      'up', to_jsonb(promo), 'down', to_jsonb(rel));
  end loop;
  return out;
end $$;

-- ── the commissioner's controls ────────────────────────────────────────────
create or replace function create_league_ladder(p_name text, p_leagues uuid[],
    p_method text default 'standings', p_movers int default 2, p_roster_mode text default 'seat')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare err text; lid uuid; tl uuid; i int := 0;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if nullif(btrim(coalesce(p_name, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'name the ladder'); end if;
  if p_method not in ('standings', 'points', 'playoffs', 'promotion_playoff') then
    return jsonb_build_object('ok', false, 'error', 'unknown method');
  end if;
  if p_roster_mode not in ('redraft', 'seat', 'roster') then
    return jsonb_build_object('ok', false, 'error', 'unknown roster mode');
  end if;
  if p_movers is null or p_movers not between 1 and 6 then
    return jsonb_build_object('ok', false, 'error', 'move 1 to 6 teams each way');
  end if;
  err := _ladder_check(p_leagues, p_movers, p_roster_mode, null);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  insert into league_ladder (name, owner_id, method, movers, roster_mode)
    values (left(btrim(p_name), 60), auth.uid(), p_method, p_movers, p_roster_mode) returning id into lid;
  foreach tl in array p_leagues loop
    i := i + 1;
    insert into league_ladder_tier (ladder_id, tier, league_id) values (lid, i, tl);
  end loop;
  return jsonb_build_object('ok', true, 'ladder_id', lid);
end $$;

create or replace function set_ladder_rules(p_ladder uuid, p_method text default null,
    p_movers int default null, p_roster_mode text default null, p_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lad league_ladder%rowtype; err text; ids uuid[];
begin
  select * into lad from league_ladder where id = p_ladder;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such ladder'); end if;
  if not _ladder_can_edit(p_ladder) then return jsonb_build_object('ok', false, 'error', 'commissioner of every tier only'); end if;
  lad.method := coalesce(p_method, lad.method);
  lad.movers := coalesce(p_movers, lad.movers);
  lad.roster_mode := coalesce(p_roster_mode, lad.roster_mode);
  lad.name := coalesce(nullif(left(btrim(coalesce(p_name, '')), 60), ''), lad.name);
  if lad.method not in ('standings', 'points', 'playoffs', 'promotion_playoff') then
    return jsonb_build_object('ok', false, 'error', 'unknown method');
  end if;
  if lad.roster_mode not in ('redraft', 'seat', 'roster') then
    return jsonb_build_object('ok', false, 'error', 'unknown roster mode');
  end if;
  if lad.movers not between 1 and 6 then return jsonb_build_object('ok', false, 'error', 'move 1 to 6 teams each way'); end if;
  select array_agg(league_id order by tier) into ids from league_ladder_tier where ladder_id = p_ladder;
  err := _ladder_check(ids, lad.movers, lad.roster_mode, p_ladder);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  update league_ladder set method = lad.method, movers = lad.movers, roster_mode = lad.roster_mode, name = lad.name
   where id = p_ladder;
  return jsonb_build_object('ok', true);
end $$;

-- Replace the tiers, top first.
create or replace function set_ladder_tiers(p_ladder uuid, p_leagues uuid[])
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lad league_ladder%rowtype; err text; i int := 0; lid uuid;
begin
  select * into lad from league_ladder where id = p_ladder;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such ladder'); end if;
  if not _ladder_can_edit(p_ladder) then return jsonb_build_object('ok', false, 'error', 'commissioner of every tier only'); end if;
  err := _ladder_check(p_leagues, lad.movers, lad.roster_mode, p_ladder);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  delete from league_ladder_tier where ladder_id = p_ladder;
  foreach lid in array p_leagues loop
    i := i + 1;
    insert into league_ladder_tier (ladder_id, tier, league_id) values (p_ladder, i, lid);
  end loop;
  return jsonb_build_object('ok', true);
end $$;

create or replace function delete_league_ladder(p_ladder uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from league_ladder where id = p_ladder) then
    return jsonb_build_object('ok', false, 'error', 'no such ladder');
  end if;
  if not _ladder_can_edit(p_ladder) then return jsonb_build_object('ok', false, 'error', 'commissioner of every tier only'); end if;
  delete from league_ladder where id = p_ladder;
  return jsonb_build_object('ok', true);
end $$;

-- ── what a member sees: the ladder this league is in, every tier, and who
-- would move if the season ended now ──────────────────────────────────────
create or replace function league_ladder_state(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lad league_ladder%rowtype; mv jsonb; tiers jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select l.* into lad from league_ladder l join league_ladder_tier t on t.ladder_id = l.id
   where t.league_id = p_league_id;
  if not found then return jsonb_build_object('ok', true, 'ladder', null); end if;
  mv := _ladder_movers(lad.id);
  select jsonb_agg(jsonb_build_object(
      'tier', t.tier, 'league_id', t.league_id, 'name', l.name, 'season', l.season,
      'teams', (select count(*) from league_membership m where m.league_id = t.league_id),
      'mine', t.league_id = p_league_id,
      'up', coalesce((select x -> 'up' from jsonb_array_elements(mv) x where (x ->> 'tier')::int = t.tier), '[]'::jsonb),
      'down', coalesce((select x -> 'down' from jsonb_array_elements(mv) x where (x ->> 'tier')::int = t.tier), '[]'::jsonb),
      'names', (select jsonb_object_agg(m.sleeper_roster_id::text, coalesce(m.team_name, 'Team ' || m.sleeper_roster_id))
                  from league_membership m where m.league_id = t.league_id))
    order by t.tier) into tiers
    from league_ladder_tier t join league l on l.id = t.league_id where t.ladder_id = lad.id;
  return jsonb_build_object('ok', true, 'ladder', jsonb_build_object(
      'id', lad.id, 'name', lad.name, 'method', lad.method, 'movers', lad.movers,
      'roster_mode', lad.roster_mode, 'can_edit', _ladder_can_edit(lad.id)),
    'tier', (select tier from league_ladder_tier where league_id = p_league_id),
    'tiers', tiers,
    'history', coalesce((select jsonb_agg(jsonb_build_object('season', mo.season, 'direction', mo.direction,
        'from_tier', mo.from_tier, 'to_tier', mo.to_tier, 'team', mo.team_name,
        'left_behind', mo.left_behind) order by mo.id)
      from league_ladder_move mo where mo.ladder_id = lad.id
       and mo.season = (select max(season) from league_ladder_move where ladder_id = lad.id)), '[]'::jsonb));
end $$;

-- The leagues a commissioner could build a ladder from.
create or replace function my_ladder_candidates()
  returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('league_id', l.id, 'name', l.name, 'season', l.season,
      'teams', (select count(*) from league_membership m where m.league_id = l.id),
      'ladder_id', (select t.ladder_id from league_ladder_tier t where t.league_id = l.id))
    order by l.season desc, l.name), '[]'::jsonb)
  from league l
  where l.provider = 'native' and l.kind = 'league' and not l.is_mock and coalesce(l.sport, 'nfl') = 'nfl'
    and is_league_commish(l.id) and auth.uid() is not null
    and _rollover_target(l.id) is null;
$$;

-- ── the end of the season ──────────────────────────────────────────────────
-- Identity is what moves with a manager; the seat (its number, division,
-- picks — and in 'seat' mode its roster) stays.
create or replace function _ladder_swap_seats(p_a uuid, p_ra int, p_b uuid, p_rb int)
  returns void language plpgsql security definer set search_path = public as $$
declare a league_membership%rowtype; b league_membership%rowtype;
begin
  select * into a from league_membership where league_id = p_a and sleeper_roster_id = p_ra;
  select * into b from league_membership where league_id = p_b and sleeper_roster_id = p_rb;
  update league_membership set sleeper_owner_id = b.sleeper_owner_id, app_user_id = b.app_user_id,
      enrolled = b.enrolled, team_name = b.team_name, claim_email = b.claim_email, avatar_url = b.avatar_url,
      controller = b.controller, controller_set_by = b.controller_set_by, controller_set_at = b.controller_set_at,
      enrolled_at = b.enrolled_at, autodraft = b.autodraft
   where id = a.id;
  update league_membership set sleeper_owner_id = a.sleeper_owner_id, app_user_id = a.app_user_id,
      enrolled = a.enrolled, team_name = a.team_name, claim_email = a.claim_email, avatar_url = a.avatar_url,
      controller = a.controller, controller_set_by = a.controller_set_by, controller_set_at = a.controller_set_at,
      enrolled_at = a.enrolled_at, autodraft = a.autodraft
   where id = b.id;
end $$;

-- 'roster' mode: seat A's players to seat B's league and back. A player the
-- other league has no copy left of (held there by a team that isn't moving)
-- stays behind; returns them by direction.
create or replace function _ladder_swap_rosters(p_a uuid, p_ra int, p_b uuid, p_rb int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ra jsonb; rb jsonb; left_a jsonb := '[]'::jsonb; left_b jsonb := '[]'::jsonb; x jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'spot', spot)), '[]'::jsonb) into ra
    from native_roster where league_id = p_a and roster_id = p_ra;
  select coalesce(jsonb_agg(jsonb_build_object('slug', slug, 'spot', spot)), '[]'::jsonb) into rb
    from native_roster where league_id = p_b and roster_id = p_rb;
  delete from native_roster where league_id = p_a and roster_id = p_ra;
  delete from native_roster where league_id = p_b and roster_id = p_rb;
  for x in select * from jsonb_array_elements(ra) loop
    if _copy_open(p_b, x ->> 'slug') then
      insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp)
        select p_b, lp.slug, lp.full_name, lp.pos, lp.team, lp.rank, lp.espn_id, lp.exp
          from league_pool lp where lp.league_id = p_a and lp.slug = x ->> 'slug'
        on conflict do nothing;
      insert into native_roster (league_id, roster_id, slug, acquired) values (p_b, p_rb, x ->> 'slug', 'keeper');
    else left_a := left_a || to_jsonb(x ->> 'slug'); end if;
  end loop;
  for x in select * from jsonb_array_elements(rb) loop
    if _copy_open(p_a, x ->> 'slug') then
      insert into league_pool (league_id, slug, full_name, pos, team, rank, espn_id, exp)
        select p_a, lp.slug, lp.full_name, lp.pos, lp.team, lp.rank, lp.espn_id, lp.exp
          from league_pool lp where lp.league_id = p_b and lp.slug = x ->> 'slug'
        on conflict do nothing;
      insert into native_roster (league_id, roster_id, slug, acquired) values (p_a, p_ra, x ->> 'slug', 'keeper');
    else left_b := left_b || to_jsonb(x ->> 'slug'); end if;
  end loop;
  return jsonb_build_object('a', left_a, 'b', left_b);
end $$;

create or replace function ladder_rollover(p_ladder uuid, p_weeks int default 14)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lad league_ladder%rowtype; t record; r jsonb; newof jsonb := '{}'::jsonb; mv jsonb;
        upper jsonb; lower jsonb; nu uuid; nl uuid; i int; rd int; ru int; seas text;
        moves jsonb := '[]'::jsonb; lb jsonb; ids uuid[]; err text; who_d record; who_u record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lad from league_ladder where id = p_ladder;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such ladder'); end if;
  if not _ladder_can_edit(p_ladder) then return jsonb_build_object('ok', false, 'error', 'commissioner of every tier only'); end if;
  perform pg_advisory_xact_lock(hashtext('ladder:' || p_ladder::text));
  select array_agg(league_id order by tier) into ids from league_ladder_tier where ladder_id = p_ladder;
  err := _ladder_check(ids, lad.movers, lad.roster_mode, p_ladder);
  if err is not null then return jsonb_build_object('ok', false, 'error', err); end if;
  select l.season into seas from league l where l.id = ids[1];

  -- who moves: read from the season just played, before anything changes
  mv := _ladder_movers(p_ladder);

  -- every tier rolls over, or none does
  for t in select * from league_ladder_tier where ladder_id = p_ladder order by tier loop
    r := rollover_league(t.league_id, p_weeks);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'tier % (%): %', t.tier, (select name from league where id = t.league_id), r ->> 'error'
        using errcode = 'P0001';
    end if;
    newof := newof || jsonb_build_object(t.tier::text, r ->> 'league_id');
  end loop;

  -- the swaps, tier by tier: the worst team going down takes … and gives
  -- its seat to the best team coming up
  for t in select * from league_ladder_tier where ladder_id = p_ladder and tier < (select max(tier) from league_ladder_tier where ladder_id = p_ladder) order by tier loop
    upper := (select x from jsonb_array_elements(mv) x where (x ->> 'tier')::int = t.tier);
    lower := (select x from jsonb_array_elements(mv) x where (x ->> 'tier')::int = t.tier + 1);
    nu := (newof ->> t.tier::text)::uuid; nl := (newof ->> (t.tier + 1)::text)::uuid;
    for i in 0 .. least(jsonb_array_length(upper -> 'down'), jsonb_array_length(lower -> 'up')) - 1 loop
      rd := (upper -> 'down' ->> i)::int;     -- going down (worst first)
      ru := (lower -> 'up' ->> i)::int;       -- coming up (best first)
      select app_user_id, team_name into who_d from league_membership where league_id = nu and sleeper_roster_id = rd;
      select app_user_id, team_name into who_u from league_membership where league_id = nl and sleeper_roster_id = ru;
      lb := jsonb_build_object('a', '[]'::jsonb, 'b', '[]'::jsonb);
      if lad.roster_mode = 'roster' then
        lb := _ladder_swap_rosters(nu, rd, nl, ru);
      elsif lad.roster_mode = 'redraft' then
        delete from native_roster where (league_id = nu and roster_id = rd) or (league_id = nl and roster_id = ru);
      end if;
      perform _ladder_swap_seats(nu, rd, nl, ru);
      insert into league_ladder_move (ladder_id, season, direction, from_tier, to_tier, from_league, to_league,
                                      from_roster, to_roster, app_user_id, team_name, left_behind)
      values (p_ladder, seas, 'down', t.tier, t.tier + 1, t.league_id, nl, rd, ru, who_d.app_user_id, who_d.team_name, lb -> 'a'),
             (p_ladder, seas, 'up', t.tier + 1, t.tier, (select league_id from league_ladder_tier where ladder_id = p_ladder and tier = t.tier + 1),
              nu, ru, rd, who_u.app_user_id, who_u.team_name, lb -> 'b');
      moves := moves || jsonb_build_array(
        jsonb_build_object('team', who_d.team_name, 'direction', 'down', 'from_tier', t.tier, 'to_tier', t.tier + 1, 'left_behind', lb -> 'a'),
        jsonb_build_object('team', who_u.team_name, 'direction', 'up', 'from_tier', t.tier + 1, 'to_tier', t.tier, 'left_behind', lb -> 'b'));
    end loop;
  end loop;

  -- the ladder now points at next season's leagues
  update league_ladder_tier lt set league_id = (newof ->> lt.tier::text)::uuid where lt.ladder_id = p_ladder;
  return jsonb_build_object('ok', true, 'season', seas, 'moves', moves,
    'leagues', (select jsonb_agg(jsonb_build_object('tier', tier, 'league_id', league_id) order by tier)
                  from league_ladder_tier where ladder_id = p_ladder));
end $$;

revoke all on function _ladder_can_edit(uuid), _ladder_check(uuid[], int, text, uuid), _ladder_rank(uuid, text),
  _ladder_movers(uuid), _ladder_swap_seats(uuid, int, uuid, int), _ladder_swap_rosters(uuid, int, uuid, int)
  from public, anon, authenticated;
grant execute on function create_league_ladder(text, uuid[], text, int, text), set_ladder_rules(uuid, text, int, text, text),
  set_ladder_tiers(uuid, uuid[]), delete_league_ladder(uuid), league_ladder_state(uuid), my_ladder_candidates(),
  ladder_rollover(uuid, int) to authenticated;
