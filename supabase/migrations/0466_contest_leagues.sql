-- 0466: CONTEST LEAGUES (v0.664.0). Spec: docs/dfs-bullseye.md §13.
--
-- Founder: "Let's get more commish options in for bullseye leagues — Rosters,
-- budget, full scoped bonuses, lists, and eligible players, scoped positions,
-- HC, FB, etc. all the classic league options. I guess you could start from
-- the classic league and then strip down … In fact this is just a version of
-- dfs, but with a target. Let's build regular highest score dfs and golf dfs
-- while we are at it."
--
-- ONE LEAGUE TYPE, THREE CONTESTS. A salary-cap league (kind 'dfs' or
-- 'bullseye') is a CLASSIC league whose teams are rebuilt every week from the
-- salary board instead of drafted, so every classic commissioner option is its
-- option too: the roster builder's spots with their own eligibility (position,
-- team, tenure, flags), the scoring catalog and its per-position overrides,
-- the scoped bonuses, the pool filter, the seat rules, HC/FB/P/RET where the
-- admin unlocked them. On top, three settings of its own:
--
--   contest         'high'     highest total wins
--                   'golf'     lowest total wins (the classic golf rule; a
--                              spot's zero_pts prices a scoreless spot)
--                   'bullseye' closest to the week's card (0462)
--   contest_format  'h2h'      weekly pairings, W-L standings (seats are made
--                              up front, AI until claimed — 0094's DFS league)
--                   'board'    everyone ranked each week, season totals
--                              (seats are made on join — 0463's Bullseye)
--   budget          the salary cap, $10,000–$500,000 (was a hard-coded $50k)
--
-- Existing 'dfs' and 'bullseye' leagues are brought under this: game_mode
-- classic, the default nine-spot lineup, a $50k budget, and the contest they
-- were already playing. A plain DFS league, which the drip engine was scoring,
-- is scored as highest-score PPR from here on.
--
-- Entries are stored on the league's own spots (S1…Sn, the classic names), so
-- a Bullseye card is dealt over the league's lineup and a FLEX or an HC spot
-- is just another spot.

-- ── the board carries every position, and tenure ───────────────────────────
alter table pod_salary drop constraint if exists pod_salary_pos_check;
alter table pod_salary add constraint pod_salary_pos_check
  check (pos in ('QB','RB','WR','TE','FB','K','DEF','DL','LB','DB','HC','P','RET'));
alter table pod_salary add column if not exists exp int;

-- ── what a league is ───────────────────────────────────────────────────────
create or replace function _is_contest(lg league) returns boolean
  language sql immutable as $$ select lg.kind in ('dfs', 'bullseye'); $$;

create or replace function _contest_of(lg league) returns text
  language sql immutable as $$
  select case when lg.settings_json ->> 'contest' in ('high', 'golf', 'bullseye') then lg.settings_json ->> 'contest'
              when (lg.settings_json ->> 'dfs_bullseye')::boolean then 'bullseye'
              when lg.kind = 'bullseye' then 'bullseye'
              else 'high' end;
$$;

create or replace function _contest_format_of(lg league) returns text
  language sql immutable as $$
  select case when lg.settings_json ->> 'contest_format' in ('h2h', 'board') then lg.settings_json ->> 'contest_format'
              when lg.kind = 'bullseye' then 'board' else 'h2h' end;
$$;

create or replace function _contest_budget(lg league) returns int
  language sql immutable as $$
  select coalesce(nullif(lg.settings_json ->> 'budget', '')::int, 50000);
$$;

-- The default lineup: 0092's nine, as roster-builder spots.
create or replace function _contest_default_slots() returns jsonb
  language sql immutable as $$
  select '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["RB"]},{"pos":["WR"]},{"pos":["WR"]},{"pos":["WR"]},{"pos":["TE"]},{"pos":["K"]},{"pos":["DEF"]}]'::jsonb;
$$;

-- The league's spots (roster_slots, else the default), as the builder stores
-- them. Spot i is 'S' || i.
create or replace function _contest_slots(lg league) returns jsonb
  language sql immutable as $$
  select case when jsonb_typeof(lg.settings_json -> 'roster_slots') = 'array' and jsonb_array_length(lg.settings_json -> 'roster_slots') > 0
              then lg.settings_json -> 'roster_slots' else _contest_default_slots() end;
$$;

-- ── bring the existing leagues under it ────────────────────────────────────
update league set settings_json = coalesce(settings_json, '{}'::jsonb)
  || jsonb_build_object('game_mode', 'classic')
  || jsonb_build_object('contest', _contest_of(league.*))
  || jsonb_build_object('contest_format', _contest_format_of(league.*))
  || jsonb_build_object('budget', _contest_budget(league.*))
  || case when jsonb_typeof(settings_json -> 'roster_slots') = 'array' then '{}'::jsonb
          else jsonb_build_object('roster_slots', _contest_default_slots()) end
  || case when _contest_of(league.*) = 'golf' then '{"golf": true}'::jsonb else '{}'::jsonb end
 where kind in ('dfs', 'bullseye');

-- The retired open contest keeps its uncapped size.
create or replace function _bullseye_max_seats(lg league) returns int
  language sql immutable as $$
  select coalesce((lg.settings_json ->> 'max_seats')::int,
    case when _is_open_contest(lg) then 1000000
         when _contest_format_of(lg) = 'h2h' then null   -- its seats are rows
         else 32 end);
$$;

-- ── how many may get in ────────────────────────────────────────────────────
create or replace function _league_seats_open(p_league uuid) returns int
  language sql stable security definer set search_path = public as $$
  select case when _is_contest(l) and _contest_format_of(l) = 'board'
              then greatest(0, _bullseye_max_seats(l) - _league_seats_taken(l.id))
              else (select count(*)::int from league_membership m
                     where m.league_id = l.id and m.app_user_id is null and not m.enrolled) end
    from league l where l.id = p_league;
$$;

-- What a contest league is, for its header, the board and the preview. The
-- key stays `bullseye` on the wire (0463's readers); the shape grew.
create or replace function _bullseye_info(lg league) returns jsonb
  language sql stable security definer set search_path = public as $$
  select case when _is_contest(lg) then jsonb_build_object(
    'contest', _contest_of(lg),
    'format', _contest_format_of(lg),
    'budget', _contest_budget(lg),
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'span', case when lg.contest_week is null then 'season' else 'week' end,
    'week', lg.contest_week,
    'max_seats', coalesce(_bullseye_max_seats(lg), (select count(*)::int from league_membership m where m.league_id = lg.id)),
    'seats_taken', _league_seats_taken(lg.id),
    'spots', jsonb_array_length(_contest_slots(lg))) end;
$$;

-- ── commish_overview carries the kind (0320's body) ─────────────────────
-- The commissioner's console trims its map for a contest league — no draft,
-- waivers, playoffs or contracts to run — so each row says what it is.
create or replace function commish_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider, 'avatar_url', l.avatar_url, 'kind', l.kind,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true, 'lineup_policy', l.lineup_policy,
      'primary', l.commissioner_id = auth.uid(),
      'weekly_budget', l.weekly_budget,
      'test_live_at', l.test_live_at,
      'preseason_at', l.preseason_at,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l
    where l.commissioner_id = auth.uid()
       or exists (select 1 from league_commish c where c.league_id = l.id and c.app_user_id = auth.uid())
    order by l.created_at desc
  ) t;
  return result;
end $$;

-- ── create ─────────────────────────────────────────────────────────────────
-- Anyone signed in. HEAD-TO-HEAD makes every seat now (AI until claimed), so
-- the count is even and at most 32 — a league that pairs its seats needs
-- all of them to play. A LEADERBOARD league seats people as they join, up to
-- 32, or 50,000 for an admin or a 'bullseye_host' delegate (0463).
create or replace function create_contest_league(p_name text, p_contest text default 'high', p_format text default 'board',
    p_span text default 'season', p_max int default 12, p_budget int default 50000,
    p_variant text default 'slots', p_radius int default 10, p_team_name text default null, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wk int; cap int; lid uuid; nm text; tm text; lg league; s jsonb; i int;
        names text[] := array['Bench Warmers','Hail Mary Hopefuls','Red Zone Regulars','Two Minute Drill','Garbage Time Gang','Coin Flip Crew',
                              'Punt Return Party','Blitz Brigade','Fourth And Long','Snap Count Crew','End Around Gang','Mud Dogs'];
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  if p_contest not in ('high', 'golf', 'bullseye') then return jsonb_build_object('ok', false, 'error', 'a contest is high, golf or bullseye'); end if;
  if p_format not in ('h2h', 'board') then return jsonb_build_object('ok', false, 'error', 'a format is h2h or board'); end if;
  if p_span not in ('week', 'season') then return jsonb_build_object('ok', false, 'error', 'a league runs one week or the season'); end if;
  if p_variant not in ('slots', 'total') then return jsonb_build_object('ok', false, 'error', 'variant is slots or total'); end if;
  if p_radius is null or p_radius < 2 or p_radius > 50 then return jsonb_build_object('ok', false, 'error', 'radius is 2–50'); end if;
  if p_budget is null or p_budget < 10000 or p_budget > 500000 then return jsonb_build_object('ok', false, 'error', 'the budget is $10,000–$500,000'); end if;
  cap := case when p_format = 'h2h' then 32 else _bullseye_max_cap() end;
  if p_max is null or p_max < 2 or p_max > cap then
    return jsonb_build_object('ok', false, 'error', 'a ' || case when p_format = 'h2h' then 'head-to-head' else 'leaderboard' end || ' league holds 2–' || cap || ' people');
  end if;
  if p_format = 'h2h' and p_max % 2 <> 0 then return jsonb_build_object('ok', false, 'error', 'a head-to-head league needs an even number of teams'); end if;
  wk := _contest_week(p_season);
  if p_span = 'week' and wk is null then return jsonb_build_object('ok', false, 'error', 'no NFL week on the slate right now'); end if;
  nm := coalesce(nullif(left(btrim(coalesce(p_name, '')), 60), ''),
                 case p_contest when 'golf' then 'Golf DFS' when 'bullseye' then 'Bullseye' else 'DFS' end
                 || case when p_span = 'week' then ' · Week ' || wk else ' League' end);
  s := jsonb_build_object('game_mode', 'classic', 'contest', p_contest, 'contest_format', p_format, 'budget', (p_budget / 100) * 100,
                          'span', p_span, 'max_seats', p_max, 'roster_slots', _contest_default_slots(), 'ppr', 1);
  if p_contest = 'bullseye' then s := s || jsonb_build_object('dfs_bullseye', true, 'bullseye', p_variant, 'bullseye_radius', p_radius); end if;
  if p_contest = 'golf' then s := s || '{"golf": true}'::jsonb; end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league (sleeper_league_id, season, name, kind, contest_week, kdst_mode, provider, lineup_policy, commissioner_id, settings_json)
  values ('CON-' || upper(left(md5(gen_random_uuid()::text), 10)), p_season, nm, 'dfs',
          case when p_span = 'week' then wk end, 'off', 'pod', 'empty', auth.uid(), s)
  returning id into lid;
  tm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), _bullseye_default_team(1));
  if p_format = 'h2h' then
    for i in 1..p_max loop
      insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
      values (lid, i, 'CON-AI-' || i, null, false,
              names[1 + ((i - 1) % 12)] || case when i > 12 then ' ' || (1 + (i - 1) / 12) else '' end, 'ai');
    end loop;
    update league_membership set app_user_id = auth.uid(), enrolled = true, controller = 'human', team_name = tm
     where league_id = lid and sleeper_roster_id = 1;
  else
    insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
    values (lid, 1, 'CON-1', auth.uid(), true, tm, 'human');
  end if;
  select * into lg from league where id = lid;
  return jsonb_build_object('ok', true, 'league_id', lid, 'name', lg.name, 'invite_code', lg.invite_code,
    'roster_id', 1, 'team', tm, 'bullseye', _bullseye_info(lg));
end $$;

-- 0463's maker, now a contest league on the leaderboard.
create or replace function create_bullseye_league(p_name text, p_span text default 'season', p_max int default 12,
    p_variant text default 'slots', p_radius int default 10, p_team_name text default null, p_season text default '2026')
  returns jsonb language sql security definer set search_path = public as $$
  select create_contest_league(p_name, 'bullseye', 'board', p_span, p_max, 50000, p_variant, p_radius, p_team_name, p_season);
$$;

-- ── a seat ─────────────────────────────────────────────────────────────────
-- HEAD-TO-HEAD: the first empty seat (0094's join_dfs). LEADERBOARD: the next
-- number, under the max (0463). Idempotent; the caller has authorised the join.
create or replace function _contest_take_seat(p_league uuid, p_team_name text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; seat league_membership; rid int; nm text;
begin
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() limit 1;
  if me.id is not null then
    if not me.enrolled then update league_membership set enrolled = true where id = me.id; end if;
    return jsonb_build_object('ok', true, 'already', me.enrolled, 'league_id', p_league, 'league', lg.name,
      'roster_id', me.sleeper_roster_id, 'team', me.team_name);
  end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  perform pg_advisory_xact_lock(hashtext('contest-seat|' || p_league::text));
  if _contest_format_of(lg) = 'h2h' then
    select m.* into seat from league_membership m
     where m.league_id = p_league and m.app_user_id is null
     order by m.sleeper_roster_id limit 1;
    if seat.id is null then return jsonb_build_object('ok', false, 'error', 'this league is full'); end if;
    nm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), seat.team_name);
    update league_membership set app_user_id = auth.uid(), enrolled = true, controller = 'human', team_name = nm where id = seat.id;
    return jsonb_build_object('ok', true, 'league_id', p_league, 'league', lg.name, 'roster_id', seat.sleeper_roster_id, 'team', nm);
  end if;
  if _league_seats_taken(p_league) >= _bullseye_max_seats(lg) then
    return jsonb_build_object('ok', false, 'error', 'this league is full');
  end if;
  select coalesce(max(sleeper_roster_id), 0) + 1 into rid from league_membership where league_id = p_league;
  nm := coalesce(nullif(left(btrim(coalesce(p_team_name, '')), 30), ''), _bullseye_default_team(rid));
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
  values (p_league, rid, 'CON-' || rid, auth.uid(), true, nm, 'human');
  return jsonb_build_object('ok', true, 'league_id', p_league, 'league', lg.name, 'roster_id', rid, 'team', nm);
end $$;

create or replace function join_contest(p_code text, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select id into lid from league where invite_code = upper(btrim(coalesce(p_code, ''))) and kind in ('dfs', 'bullseye');
  if lid is null then return jsonb_build_object('ok', false, 'error', 'that isn''t a contest league code'); end if;
  return _contest_take_seat(lid, p_team_name);
end $$;
create or replace function join_bullseye(p_code text, p_team_name text default null)
  returns jsonb language sql security definer set search_path = public as $$ select join_contest(p_code, p_team_name); $$;
create or replace function join_dfs(p_code text, p_team_name text default null)
  returns jsonb language sql security definer set search_path = public as $$ select join_contest(p_code, p_team_name); $$;
create or replace function _bullseye_take_seat(p_league uuid, p_team_name text)
  returns jsonb language sql security definer set search_path = public as $$ select _contest_take_seat(p_league, p_team_name); $$;

-- 0463's body; any contest league takes a seat.
create or replace function join_from_board(p_league_id uuid, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare code text; k text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select l.invite_code, l.kind into code, k
    from league_listing li join league l on l.id = li.league_id
    where li.league_id = p_league_id and li.open;
  if code is null then
    return jsonb_build_object('ok', false, 'error', 'that league is no longer taking joiners');
  end if;
  if k in ('dfs', 'bullseye') then return _contest_take_seat(p_league_id, p_team_name); end if;
  return native_join(code, p_team_name);
end $$;

-- 0463's body; any contest league (but the retired open contest) may be posted.
create or replace function post_league_listing(p_league_id uuid, p_blurb text default null, p_dues text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  if lg.provider <> 'native' and not (_is_contest(lg) and not _is_open_contest(lg)) then
    return jsonb_build_object('ok', false, 'error', 'only native leagues can be posted — others recruit with their invite links');
  end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league_listing (league_id, created_by, blurb, dues)
    values (p_league_id, auth.uid(), left(coalesce(p_blurb, ''), 280), nullif(left(coalesce(p_dues, ''), 120), ''))
  on conflict (league_id) do update
    set open = true, updated_at = now(),
        blurb = case when p_blurb is null then league_listing.blurb else left(p_blurb, 280) end,
        dues  = case when p_dues  is null then league_listing.dues  else nullif(left(p_dues, 120), '') end;
  return jsonb_build_object('ok', true);
end $$;

-- ── eligibility on the salary board ────────────────────────────────────────
-- Why this player may not stand in this spot for this seat, or null. The
-- spot's own filter (0172: teams, tenure, flags), the league's pool filter
-- (0383), and the seat's rule (0460) — the classic rules, read off the
-- board instead of the pool. Team units (K/DEF/HC/P) have no tenure.
create or replace function _contest_spot_error(lg league, p_roster int, p_spot jsonb, p_slot text, ps pod_salary)
  returns text language plpgsql stable security definer set search_path = public as $$
declare pos text := upper(ps.pos); unit boolean := upper(ps.pos) in ('K', 'DEF', 'HC', 'P'); who text; mn int; mx int; pf jsonb; r seat_player_rule;
        lbl text := coalesce(nullif(p_spot ->> 'label', ''), array_to_string(array(select upper(x) from jsonb_array_elements_text(p_spot -> 'pos') x), '/'));
begin
  who := ps.name || ' (' || pos || ')';
  if not exists (select 1 from jsonb_array_elements_text(p_spot -> 'pos') x where upper(x) = pos) then
    return who || ' can''t play ' || lbl;
  end if;
  if p_spot ->> 'level' = 'college' or jsonb_array_length(coalesce(p_spot -> 'confs', '[]'::jsonb)) > 0 or jsonb_array_length(coalesce(p_spot -> 'classes', '[]'::jsonb)) > 0 then
    return lbl || ' is a college spot — college players aren''t on the salary board';
  end if;
  if jsonb_array_length(coalesce(p_spot -> 'teams', '[]'::jsonb)) > 0
     and not (_nfl_team_norm(ps.team) <> '' and _nfl_team_norm(ps.team) in (select _nfl_team_norm(x) from jsonb_array_elements_text(p_spot -> 'teams') x)) then
    return who || ' isn''t on a team ' || lbl || ' allows';
  end if;
  if not unit then
    begin mn := (p_spot ->> 'min_exp')::int; mx := (p_spot ->> 'max_exp')::int; exception when others then mn := null; mx := null; end;
    if (mn is not null or mx is not null) and ps.exp is null then return who || ': tenure unknown, and ' || lbl || ' has a tenure rule'; end if;
    if mn is not null and ps.exp < mn then return who || ' is too new for ' || lbl; end if;
    if mx is not null and ps.exp > mx then return who || ' has too many years for ' || lbl; end if;
  end if;
  if jsonb_array_length(coalesce(p_spot -> 'flags', '[]'::jsonb)) > 0
     and not exists (select 1 from player_flag f where f.league_id = lg.id and f.slug = ps.slug
                       and lower(f.label) in (select lower(x) from jsonb_array_elements_text(p_spot -> 'flags') x)) then
    return who || ' doesn''t wear a flag ' || lbl || ' asks for';
  end if;
  -- the league's pool filter
  pf := lg.settings_json -> 'pool_filter';
  if jsonb_typeof(pf) = 'object' then
    if jsonb_array_length(coalesce(pf -> 'teams', '[]'::jsonb)) > 0
       and not (_nfl_team_norm(ps.team) <> '' and _nfl_team_norm(ps.team) in (select _nfl_team_norm(x) from jsonb_array_elements_text(pf -> 'teams') x)) then
      return who || ' isn''t on a team this league allows';
    end if;
    if not unit then
      begin mn := (pf ->> 'min_exp')::int; mx := (pf ->> 'max_exp')::int; exception when others then mn := null; mx := null; end;
      if (mn is not null or mx is not null) and ps.exp is null then return who || ': tenure unknown, and this league has a tenure rule'; end if;
      if mn is not null and ps.exp < mn then return who || ' is too new for this league'; end if;
      if mx is not null and ps.exp > mx then return who || ' has too many years for this league'; end if;
    end if;
  end if;
  -- the seat's rule
  select * into r from seat_player_rule where league_id = lg.id and roster_id = p_roster;
  if found then
    if coalesce(cardinality(r.positions), 0) > 0 and not (pos = any (r.positions)) then
      return 'your seat can only take ' || coalesce(_seat_rule_text(r), 'some players') || ' (commissioner''s rule)';
    end if;
    if coalesce(cardinality(r.teams), 0) > 0
       and not (_nfl_team_norm(ps.team) <> '' and _nfl_team_norm(ps.team) = any (select _nfl_team_norm(t) from unnest(r.teams) t)) then
      return 'your seat can only take ' || coalesce(_seat_rule_text(r), 'some players') || ' (commissioner''s rule)';
    end if;
    if not unit and (r.min_exp is not null or r.max_exp is not null) then
      if ps.exp is null or (r.min_exp is not null and ps.exp < r.min_exp) or (r.max_exp is not null and ps.exp > r.max_exp) then
        return 'your seat can only take ' || coalesce(_seat_rule_text(r), 'some players') || ' (commissioner''s rule)';
      end if;
    end if;
  end if;
  return null;
end $$;

-- ── the entry ──────────────────────────────────────────────────────────────
-- p_slots: {"S1": slug, "S2": slug, …} — every spot of the league's lineup.
-- The board, each spot's eligibility, the budget, the per-player lock (a
-- player whose game has locked keeps his spot; a locked player can't be
-- added — 0093), and a leaderboard league's own scoring row.
create or replace function save_contest_entry(p_league uuid, p_week int, p_slots jsonb, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; seat league_membership; spots jsonb; n int; i int; slot text; pslug text; ps pod_salary; bad text;
        spent int := 0; seen text[] := '{}'; old jsonb; lineup jsonb := '[]'::jsonb; lk timestamptz; budget int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if lg.contest_week is not null and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this contest');
  end if;
  if lg.contest_week is null and p_week < coalesce(_contest_week(lg.season), 1) then
    return jsonb_build_object('ok', false, 'error', 'that week has been played');
  end if;
  select * into seat from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if seat.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  if exists (select 1 from matchup m where m.league_id = p_league and m.week = p_week and m.status = 'final'
               and seat.sleeper_roster_id in (m.home_roster_id, m.away_roster_id)) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;
  if jsonb_typeof(p_slots) <> 'object' then return jsonb_build_object('ok', false, 'error', 'a squad is one player per spot'); end if;
  spots := _contest_slots(lg);
  n := jsonb_array_length(spots);
  budget := _contest_budget(lg);
  select string_agg(k, ', ') into bad from jsonb_object_keys(p_slots) k where k !~ '^S[0-9]+$' or substr(k, 2)::int < 1 or substr(k, 2)::int > n;
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'unknown spot: ' || bad); end if;
  select starters_json into old from sleeper_lineup where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;

  for i in 1..n loop
    slot := 'S' || i;
    pslug := nullif(btrim(coalesce(p_slots ->> slot, '')), '');
    if pslug is null then
      return jsonb_build_object('ok', false, 'error', 'fill every spot — ' || coalesce(nullif(spots -> (i - 1) ->> 'label', ''), array_to_string(array(select upper(x) from jsonb_array_elements_text(spots -> (i - 1) -> 'pos') x), '/')) || ' is empty');
    end if;
    if pslug = any (seen) then return jsonb_build_object('ok', false, 'error', 'a player can only fill one spot'); end if;
    seen := array_append(seen, pslug);
    select * into ps from pod_salary where season = p_season and week = p_week and pod_salary.slug = pslug;
    if ps.slug is null then return jsonb_build_object('ok', false, 'error', 'a pick is not on this week''s board'); end if;
    bad := _contest_spot_error(lg, seat.sleeper_roster_id, spots -> (i - 1), slot, ps);
    if bad is not null then return jsonb_build_object('ok', false, 'error', bad); end if;
    spent := spent + ps.salary;
    lineup := lineup || jsonb_build_object('slot', slot, 'sleeper_id', null, 'player_slug', pslug, 'pos', upper(ps.pos));
  end loop;
  if spent > budget then return jsonb_build_object('ok', false, 'error', 'over the $' || to_char(budget, 'FM999,999,999') || ' budget by $' || to_char(spent - budget, 'FM999,999,999')); end if;

  -- the per-player lock (0093)
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = o ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff - interval '1 hour' <= now())
     and (p_slots ->> (o ->> 'slot')) is distinct from (o ->> 'player_slug');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'locked in — ' || bad || ' can''t be moved or dropped'); end if;
  select string_agg(ps2.name, ', ') into bad
    from jsonb_array_elements(lineup) e
    join pod_salary ps2 on ps2.season = p_season and ps2.week = p_week and ps2.slug = e ->> 'player_slug'
   where exists (select 1 from nfl_slate g where g.season = p_season and g.week = p_week and ps2.team in (g.home, g.away)
                   and g.kickoff is not null and g.kickoff - interval '1 hour' <= now())
     and not exists (select 1 from jsonb_array_elements(coalesce(old, '[]'::jsonb)) o
                      where o ->> 'player_slug' = e ->> 'player_slug' and o ->> 'slot' = e ->> 'slot');
  if bad is not null then return jsonb_build_object('ok', false, 'error', 'game locked — can''t add ' || bad); end if;

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, seat.sleeper_roster_id, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  if _contest_format_of(lg) = 'board' then
    lk := _week_first_lock(p_season, p_week);
    insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
    values (p_league, p_week, null, seat.sleeper_roster_id, seat.sleeper_roster_id, 'scheduled', lk)
    on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'spent', spent, 'budget', budget, 'roster_id', seat.sleeper_roster_id);
end $$;

-- ── the week, as the builder needs it ──────────────────────────────────────
-- The lineup's spots, my squad, my matchup, my opponent's squad (sealed, one
-- player at a time as each game locks — v0.660.1), the live state, and the
-- contest's own settings. Any member, the commissioner, or an admin.
create or replace function contest_state(p_league uuid, p_week int default null, p_season text default '2026')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; wk int; m matchup; opp int; st matchup_state; started boolean; mine jsonb; theirs jsonb; spots jsonb;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  wk := coalesce(p_week, lg.contest_week,
    (select min(week) from matchup where league_id = p_league and status <> 'final'),
    (select max(week) from matchup where league_id = p_league), _contest_week(p_season));
  if me.id is not null then
    select * into m from matchup where league_id = p_league and week = wk
       and me.sleeper_roster_id in (home_roster_id, away_roster_id) limit 1;
  end if;
  opp := case when m.id is null then null when m.home_roster_id = me.sleeper_roster_id then m.away_roster_id else m.home_roster_id end;
  if opp = me.sleeper_roster_id then opp := null; end if;
  started := coalesce(_week_first_lock(p_season, wk) <= now(), false);
  select starters_json into mine from sleeper_lineup where league_id = p_league and week = wk and roster_id = me.sleeper_roster_id;
  if opp is not null then
    select jsonb_agg(case when _dfs_player_locked(p_season, wk, e ->> 'player_slug') then e
                          else jsonb_build_object('slot', e -> 'slot', 'sealed', true) end order by ord)
      into theirs
      from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) with ordinality x(e, ord)
     where sl.league_id = p_league and sl.week = wk and sl.roster_id = opp;
  end if;
  select * into st from matchup_state where matchup_id = m.id and game_window = 'wk';
  select jsonb_agg((s.spot || jsonb_build_object('slot', 'S' || s.i)) order by s.i)
    into spots from (select spot, row_number() over () as i from jsonb_array_elements(_contest_slots(lg)) spot) s;
  return jsonb_build_object('ok', true, 'on', true, 'kind', lg.kind, 'name', lg.name, 'week', wk, 'season', p_season,
    'contest', _contest_of(lg), 'format', _contest_format_of(lg), 'budget', _contest_budget(lg), 'slots', spots,
    'variant', coalesce(lg.settings_json ->> 'bullseye', 'slots'),
    'radius', coalesce((lg.settings_json ->> 'bullseye_radius')::int, 10),
    'positions_extra', coalesce(lg.settings_json -> 'positions_extra', '[]'::jsonb),
    'scoring_classic', lg.settings_json -> 'scoring_classic', 'ppr', coalesce((lg.settings_json ->> 'ppr')::numeric, 1),
    'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'started', started,
    'entry', mine,
    'matchup', case when m.id is null then null else jsonb_build_object('id', m.id, 'status', m.status,
      'home', m.home_roster_id, 'away', m.away_roster_id, 'home_final', m.home_final, 'away_final', m.away_final,
      'home_tb', m.home_tb, 'away_tb', m.away_tb) end,
    'opponent', case when opp is null then null else jsonb_build_object('roster_id', opp,
      'team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = opp limit 1),
      'entry', theirs) end,
    'state', case when st.matchup_id is null or not started then null else jsonb_build_object(
      'home', st.home_score, 'away', st.away_score, 'slots', st.slot_scores) end);
end $$;

-- ── the league, as its screen needs it (0463's bullseye_league, any contest) ─
create or replace function contest_league(p_league uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; me league_membership; wk int; cur int; lock_at timestamptz; entered boolean := false; weeks jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if me.id is null and not (is_league_commish(p_league) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'you''re not in this league');
  end if;
  cur := _contest_week(lg.season);
  wk := coalesce(lg.contest_week, cur, (select max(week) from matchup where league_id = p_league));
  if me.id is not null and wk is not null then
    entered := exists (select 1 from sleeper_lineup where league_id = p_league and week = wk and roster_id = me.sleeper_roster_id);
  end if;
  lock_at := case when wk is null then null else _week_first_lock(lg.season, wk) end;
  select coalesce(jsonb_agg(w order by w), '[]'::jsonb) into weeks
    from (select distinct week as w from matchup where league_id = p_league) x;
  return jsonb_build_object('ok', true, 'league_id', lg.id, 'name', lg.name, 'season', lg.season, 'week', wk, 'kind', lg.kind,
    'invite_code', case when me.id is not null or is_league_commish(p_league) or is_admin() then lg.invite_code end,
    'commish', is_league_commish(p_league) or is_admin(),
    'open_contest', _is_open_contest(lg),
    'listed', exists (select 1 from league_listing li where li.league_id = p_league and li.open),
    'bullseye', _bullseye_info(lg),
    'weeks', weeks,
    'entries', (select count(*) from sleeper_lineup where league_id = p_league and week = wk),
    'first_lock', lock_at, 'started', lock_at is not null and lock_at <= now(),
    'me', case when me.id is null then null else jsonb_build_object('roster_id', me.sleeper_roster_id, 'team', me.team_name, 'entered', entered) end);
end $$;
create or replace function bullseye_league(p_league uuid)
  returns jsonb language sql security definer set search_path = public as $$ select contest_league(p_league); $$;

-- ── standings: a week, and a season ────────────────────────────────────────
-- 0463's board, for any contest league: both sides of every matchup (a
-- leaderboard row is its own opponent), ranked the way the contest ranks —
-- highest first, lowest first for golf, closest first with the tie-break
-- for Bullseye. The season table sums the stamped finals.
create or replace function contest_board(p_league uuid, p_week int default null, p_limit int default 100)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; wk int; started boolean; rows jsonb; mine jsonb; srows jsonb; smine jsonb; n int; lim int; golf boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null then return jsonb_build_object('ok', false, 'error', 'no such contest'); end if;
  if not (_is_open_contest(lg) or is_league_member(p_league) or is_league_commish(p_league) or is_admin()
          or exists (select 1 from league_listing li where li.league_id = p_league and li.open)) then
    return jsonb_build_object('ok', false, 'error', 'you''re not in this league');
  end if;
  golf := _contest_of(lg) = 'golf';
  lim := greatest(1, least(coalesce(p_limit, 100), 500));
  wk := coalesce(p_week, lg.contest_week, _contest_week(lg.season), (select max(week) from matchup where league_id = p_league));
  started := wk is not null and coalesce(_week_first_lock(lg.season, wk) <= now(), false);
  select count(*) into n from sleeper_lineup where league_id = p_league and week = wk;

  if started then
    with sides as (
      select m.home_roster_id as roster_id, coalesce(m.home_final, st.home_score, 0) as ring, m.home_tb as tb, 'home' as side, st.slot_scores, m.status
        from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
       where m.league_id = p_league and m.week = wk
      union all
      select m.away_roster_id, coalesce(m.away_final, st.away_score, 0), m.away_tb, 'away', st.slot_scores, m.status
        from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
       where m.league_id = p_league and m.week = wk and m.away_roster_id <> m.home_roster_id
    ), sc as (
      select s.roster_id, lm.team_name, lm.app_user_id = auth.uid() as me, s.ring, s.tb, s.status,
             (select coalesce(sum((x ->> 'score')::numeric), 0) from jsonb_array_elements(coalesce(s.slot_scores, '[]'::jsonb)) x
               where x ->> 'side' = s.side) as points
        from sides s join league_membership lm on lm.league_id = p_league and lm.sleeper_roster_id = s.roster_id
    ), ranked as (
      select sc.*, rank() over (order by case when golf then sc.ring else -sc.ring end asc, sc.tb asc nulls last) as rank from sc
    )
    select coalesce(jsonb_agg(to_jsonb(r) order by r.rank, r.tb nulls last, r.team_name) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me limit 1)
      into rows, mine from ranked r;
  end if;

  if lg.contest_week is null then
    with fin as (
      select m.home_roster_id as roster_id, m.home_final as f from matchup m where m.league_id = p_league and m.status = 'final'
      union all
      select m.away_roster_id, m.away_final from matchup m where m.league_id = p_league and m.status = 'final' and m.away_roster_id <> m.home_roster_id
    ), s as (
      select lm.sleeper_roster_id as roster_id, lm.team_name, lm.app_user_id = auth.uid() as me,
             coalesce(sum(fin.f), 0) as total, count(fin.f) as weeks,
             case when golf then min(fin.f) else max(fin.f) end as best
        from league_membership lm
        left join fin on fin.roster_id = lm.sleeper_roster_id
       where lm.league_id = p_league and lm.enrolled
       group by lm.sleeper_roster_id, lm.team_name, lm.app_user_id
    ), ranked as (
      select s.*, rank() over (order by case when golf then s.total else -s.total end asc, s.weeks desc, s.best desc nulls last) as rank from s
    )
    select coalesce(jsonb_agg(to_jsonb(r) order by r.rank, r.team_name) filter (where r.rank <= lim), '[]'::jsonb),
           (select to_jsonb(x) from ranked x where x.me limit 1)
      into srows, smine from ranked r;
  end if;

  return jsonb_build_object('ok', true, 'week', wk, 'started', started, 'entries', n, 'contest', _contest_of(lg),
    'rows', coalesce(rows, '[]'::jsonb), 'me', mine,
    'season', case when lg.contest_week is null then jsonb_build_object('rows', srows, 'me', smine) end);
end $$;
create or replace function bullseye_league_board(p_league uuid, p_week int default null, p_limit int default 100)
  returns jsonb language sql security definer set search_path = public as $$ select contest_board(p_league, p_week, p_limit); $$;

-- ── MY TEAM: my weeks (0463's, any contest, both sides) ────────────────────
create or replace function bullseye_my_weeks(p_league uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me league_membership; out jsonb; lg league; golf boolean;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into lg from league where id = p_league;
  select * into me from league_membership where league_id = p_league and app_user_id = auth.uid() and enrolled limit 1;
  if me.id is null then return jsonb_build_object('ok', false, 'error', 'you''re not in this league'); end if;
  golf := _contest_of(lg) = 'golf';
  with sides as (
    select m.week, m.status, m.home_roster_id as roster_id, m.home_tb as tb, coalesce(m.home_final, st.home_score) as ring,
           case when m.away_roster_id <> m.home_roster_id then m.away_roster_id end as opp, coalesce(m.away_final, st.away_score) as opp_ring
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk' where m.league_id = p_league
    union all
    select m.week, m.status, m.away_roster_id, m.away_tb, coalesce(m.away_final, st.away_score), m.home_roster_id, coalesce(m.home_final, st.home_score)
      from matchup m left join matchup_state st on st.matchup_id = m.id and st.game_window = 'wk'
     where m.league_id = p_league and m.away_roster_id <> m.home_roster_id
  ), ranked as (
    select sides.*, rank() over (partition by week order by case when golf then coalesce(ring, 0) else -coalesce(ring, 0) end asc, tb asc nulls last) as rank,
           count(*) over (partition by week) as entries
      from sides
  )
  select coalesce(jsonb_agg(jsonb_build_object('week', r.week, 'status', r.status, 'ring', r.ring, 'tb', r.tb,
           'rank', case when r.status in ('live', 'final') then r.rank end, 'entries', r.entries,
           'opp', r.opp, 'opp_team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = r.opp limit 1),
           'opp_ring', r.opp_ring) order by r.week desc), '[]'::jsonb)
    into out from ranked r where r.roster_id = me.sleeper_roster_id;
  return jsonb_build_object('ok', true, 'roster_id', me.sleeper_roster_id, 'team', me.team_name, 'weeks', out);
end $$;

-- ── the commissioner's contest rules ───────────────────────────────────────
-- The contest and the budget: not while a week is being played. The format:
-- only before any week has a matchup — seats are shaped by it.
create or replace function set_contest_rules(p_league uuid, p_contest text default null, p_format text default null, p_budget int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; s jsonb;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'not a contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can change this'); end if;
  if exists (select 1 from matchup where league_id = p_league and status = 'live') then
    return jsonb_build_object('ok', false, 'error', 'a week is being played — change it once it''s final');
  end if;
  s := coalesce(lg.settings_json, '{}'::jsonb);
  if p_contest is not null then
    if p_contest not in ('high', 'golf', 'bullseye') then return jsonb_build_object('ok', false, 'error', 'a contest is high, golf or bullseye'); end if;
    s := (s - 'dfs_bullseye' - 'golf') || jsonb_build_object('contest', p_contest);
    if p_contest = 'bullseye' then
      s := s || jsonb_build_object('dfs_bullseye', true, 'bullseye', coalesce(s ->> 'bullseye', 'slots'), 'bullseye_radius', coalesce((s ->> 'bullseye_radius')::int, 10));
    else
      s := s - 'bullseye' - 'bullseye_radius';
    end if;
    if p_contest = 'golf' then s := s || '{"golf": true}'::jsonb; end if;
  end if;
  if p_format is not null then
    if p_format not in ('h2h', 'board') then return jsonb_build_object('ok', false, 'error', 'a format is h2h or board'); end if;
    if p_format <> _contest_format_of(lg) and exists (select 1 from matchup where league_id = p_league) then
      return jsonb_build_object('ok', false, 'error', 'the format is set before the first week is played');
    end if;
    if p_format = 'h2h' and (select count(*) from league_membership where league_id = p_league) % 2 <> 0 then
      return jsonb_build_object('ok', false, 'error', 'head-to-head needs an even number of seats');
    end if;
    s := s || jsonb_build_object('contest_format', p_format);
  end if;
  if p_budget is not null then
    if p_budget < 10000 or p_budget > 500000 then return jsonb_build_object('ok', false, 'error', 'the budget is $10,000–$500,000'); end if;
    s := s || jsonb_build_object('budget', (p_budget / 100) * 100);
  end if;
  update league set settings_json = s where id = p_league;
  select * into lg from league where id = p_league;
  return jsonb_build_object('ok', true, 'bullseye', _bullseye_info(lg));
end $$;

-- 0463's variant switch, for any contest league playing Bullseye.
create or replace function set_dfs_bullseye(p_league uuid, p_variant text, p_radius int default 10)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league;
begin
  select * into lg from league where id = p_league;
  if lg.id is null or not _is_contest(lg) then return jsonb_build_object('ok', false, 'error', 'Bullseye is a contest-league setting'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can change this'); end if;
  if p_variant is null then return jsonb_build_object('ok', false, 'error', 'pick the contest under CONTEST RULES instead'); end if;
  if p_variant not in ('slots', 'total') then return jsonb_build_object('ok', false, 'error', 'variant is slots or total'); end if;
  if p_radius is null or p_radius < 2 or p_radius > 50 then return jsonb_build_object('ok', false, 'error', 'radius is 2–50'); end if;
  if exists (select 1 from matchup where league_id = p_league and status = 'live') then
    return jsonb_build_object('ok', false, 'error', 'a week is being played — change it once it''s final');
  end if;
  update league set settings_json = (coalesce(settings_json, '{}'::jsonb) - 'golf')
      || jsonb_build_object('contest', 'bullseye', 'dfs_bullseye', true, 'bullseye', p_variant, 'bullseye_radius', p_radius)
   where id = p_league;
  return jsonb_build_object('ok', true, 'variant', p_variant, 'radius', p_radius);
end $$;

-- A contest league's size, head-to-head too: more seats are made (AI until
-- claimed); fewer only while the extra seats are empty.
create or replace function set_bullseye_size(p_league uuid, p_max int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league; cap int; have int; i int;
begin
  select * into lg from league where id = p_league and kind in ('dfs', 'bullseye');
  if lg.id is null or _is_open_contest(lg) then return jsonb_build_object('ok', false, 'error', 'no such contest league'); end if;
  if not (is_league_commish(p_league) or is_admin()) then return jsonb_build_object('ok', false, 'error', 'only the commissioner can change this'); end if;
  if _contest_format_of(lg) = 'h2h' then
    if p_max is null or p_max < 2 or p_max > 32 or p_max % 2 <> 0 then return jsonb_build_object('ok', false, 'error', 'a head-to-head league holds 2–32 teams, an even number'); end if;
    select count(*) into have from league_membership where league_id = p_league;
    if p_max > have then
      for i in have + 1 .. p_max loop
        insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
        values (p_league, i, 'CON-AI-' || i, null, false, 'Team ' || i, 'ai');
      end loop;
    elsif p_max < have then
      if exists (select 1 from league_membership where league_id = p_league and sleeper_roster_id > p_max and app_user_id is not null) then
        return jsonb_build_object('ok', false, 'error', 'someone holds one of the seats you''d remove');
      end if;
      if exists (select 1 from matchup where league_id = p_league and (home_roster_id > p_max or away_roster_id > p_max)) then
        return jsonb_build_object('ok', false, 'error', 'those seats have played — the league can''t shrink past them');
      end if;
      delete from league_membership where league_id = p_league and sleeper_roster_id > p_max;
    end if;
    update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('max_seats', p_max) where id = p_league;
    return jsonb_build_object('ok', true, 'max_seats', p_max);
  end if;
  cap := _bullseye_max_cap();
  if p_max is null or p_max < 2 or p_max > cap then return jsonb_build_object('ok', false, 'error', 'a leaderboard league holds 2–' || cap || ' people'); end if;
  if p_max < _league_seats_taken(p_league) then return jsonb_build_object('ok', false, 'error', 'more people than that are already in'); end if;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('max_seats', p_max) where id = p_league;
  return jsonb_build_object('ok', true, 'max_seats', p_max);
end $$;

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function _is_contest(league), _contest_of(league), _contest_format_of(league), _contest_budget(league),
  _contest_default_slots(), _contest_slots(league), _contest_take_seat(uuid, text), _contest_spot_error(league, int, jsonb, text, pod_salary)
  from public, anon, authenticated;
revoke all on function create_contest_league(text, text, text, text, int, int, text, int, text, text), join_contest(text, text),
  save_contest_entry(uuid, int, jsonb, text), contest_state(uuid, int, text), contest_league(uuid), contest_board(uuid, int, int),
  set_contest_rules(uuid, text, text, int) from public, anon;
grant execute on function create_contest_league(text, text, text, text, int, int, text, int, text, text), join_contest(text, text),
  save_contest_entry(uuid, int, jsonb, text), contest_state(uuid, int, text), contest_league(uuid), contest_board(uuid, int, int),
  set_contest_rules(uuid, text, text, int) to authenticated;
