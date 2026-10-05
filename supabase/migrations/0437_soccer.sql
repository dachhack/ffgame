-- 0437 — SOCCER: THE PREMIER LEAGUE AND MLS JOIN THE SPINE (v0.630.0).
--
-- Founder: "They [Stathead] are adding MLS and Premier League as well …
-- build the spine." Two more sport ids, `epl` and `mls`, sharing one soccer
-- definition (packages/core/src/sports/soccer.ts). No adapter yet — the
-- data arrives with Stathead's delivery — so this is the database knowing
-- the sports: the check lists, the positions, the longer season (a Premier
-- League season is 38 matchweeks over ~40 weeks) and the week anchor.
--
-- THE WEEK. A Premier League matchweek runs Saturday to Monday night, so
-- soccer periods open on Tuesday, not Monday. `sport_week_start_dow` says
-- which ISO weekday a sport's periods open on; set_sport_settings normalises
-- period_start to it. The period arithmetic elsewhere (sport_period,
-- sport_league_market) steps 7 days from period_start and is anchor-agnostic.
--
-- Undo: restore the five check constraints to the four sports; restore
--       0431's sport_positions, 0432's create_native_league, 0426's
--       sport_generate_schedule, 0436's set_sport_settings; drop function
--       sport_week_start_dow.

-- ── the check lists ──────────────────────────────────────────────────────────
alter table league drop constraint if exists league_sport_check;
alter table league add constraint league_sport_check check (sport in ('nfl', 'nba', 'wnba', 'nhl', 'mlb', 'epl', 'mls'));
alter table sport_game drop constraint if exists sport_game_sport_check;
alter table sport_game add constraint sport_game_sport_check check (sport in ('nba', 'wnba', 'nhl', 'mlb', 'epl', 'mls'));
alter table sport_player drop constraint if exists sport_player_sport_check;
alter table sport_player add constraint sport_player_sport_check check (sport in ('nba', 'wnba', 'nhl', 'mlb', 'epl', 'mls'));
alter table sport_calendar drop constraint if exists sport_calendar_sport_check;
alter table sport_calendar add constraint sport_calendar_sport_check check (sport in ('nba', 'wnba', 'nhl', 'mlb', 'epl', 'mls'));
comment on column league.sport is 'nfl | nba | wnba | nhl | mlb | epl | mls — which SportDef shapes the league (0424, 0437). NFL leagues score through live_play; the others through game_stat_line.';

-- ── the week anchor ──────────────────────────────────────────────────────────
create or replace function sport_week_start_dow(p_sport text) returns int
  language sql immutable as $$
  select case p_sport when 'epl' then 2 when 'mls' then 2 else 1 end;
$$;

-- ── positions ────────────────────────────────────────────────────────────────
create or replace function sport_positions(p_sport text) returns text[]
  language sql immutable as $$
  select case p_sport
    when 'nba'  then array['PG','SG','SF','PF','C']
    when 'wnba' then array['G','F','C']
    when 'nhl'  then array['C','LW','RW','D','G']
    when 'mlb'  then array['C','1B','2B','3B','SS','OF','DH','SP','RP']
    when 'epl'  then array['GK','DEF','MID','FWD']
    when 'mls'  then array['GK','DEF','MID','FWD']
    else array[]::text[] end;
$$;

-- ── create_native_league: 0432's body, the two soccer ids accepted ──────────
create or replace function create_native_league(
  p_name text, p_season text, p_teams int,
  p_rounds int default 12, p_pick_seconds int default 90,
  p_mode text default 'snake', p_budget int default 200,
  p_lot_seconds int default 15, p_max_lots int default 1,
  p_night_start_min int default null, p_night_end_min int default null,
  p_pos_caps jsonb default null,
  p_game_mode text default 'drip',
  p_continuity text default 'redraft',
  p_continuity_n int default null,
  p_sport text default 'nfl',
  p_sport_settings jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; lid uuid; sp text; seeded jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not has_native() then
    return jsonb_build_object('ok', false, 'error', 'native leagues are invite-only — ask the pilot owner for access');
  end if;
  sp := coalesce(nullif(lower(btrim(p_sport)), ''), 'nfl');
  if sp not in ('nfl', 'nba', 'wnba', 'nhl', 'mlb', 'epl', 'mls') then
    return jsonb_build_object('ok', false, 'error', 'unknown sport ' || sp);
  end if;
  -- THE SPORTS FLAG (0432): a daily sport is behind has_sports() until the
  -- founder opens it, the way 'native' gated in-app leagues.
  if sp <> 'nfl' and not has_sports() then
    return jsonb_build_object('ok', false, 'error', 'daily-sport leagues are in testing — ask the pilot owner for access');
  end if;
  if sp = 'nfl' then
    return _create_native_league_now(p_name, p_season, p_teams, p_rounds, p_pick_seconds,
      p_mode, p_budget, p_lot_seconds, p_max_lots, p_night_start_min, p_night_end_min,
      p_pos_caps, p_game_mode, p_continuity, p_continuity_n);
  end if;
  -- A sport league: classic by construction, its lineup and calendar from
  -- the settings core built (sportLeagueSettings), its pool from the directory.
  if p_sport_settings is null or jsonb_typeof(p_sport_settings -> 'roster_slots') <> 'array'
     or (p_sport_settings -> 'sport' ->> 'period_start') is null then
    return jsonb_build_object('ok', false, 'error', 'a sport league needs roster_slots and sport.period_start');
  end if;
  if not exists (select 1 from sport_player where sport = sp and active) then
    return jsonb_build_object('ok', false, 'error', 'no ' || upper(sp) || ' players in the directory yet — the worker has not swept it');
  end if;
  r := _create_native_league_now(p_name, p_season, p_teams, p_rounds, p_pick_seconds,
    p_mode, p_budget, p_lot_seconds, p_max_lots, p_night_start_min, p_night_end_min,
    p_pos_caps, 'classic', p_continuity, p_continuity_n);
  if coalesce((r ->> 'ok')::boolean, false) is not true then return r; end if;
  lid := (r ->> 'league_id')::uuid;
  -- roster_shape too, so _sync_classic_rounds (the lineup builder's rounds
  -- update) has a bench and an IR count to add to the starters.
  update league
     set sport = sp,
         settings_json = coalesce(settings_json, '{}'::jsonb)
           || jsonb_build_object('roster_slots', p_sport_settings -> 'roster_slots',
                                 'sport', p_sport_settings -> 'sport',
                                 'roster_shape', jsonb_build_object(
                                   'bench', coalesce((p_sport_settings -> 'sport' ->> 'bench')::int, 3),
                                   'taxi', 0,
                                   'ir', coalesce((p_sport_settings -> 'sport' ->> 'ir')::int, 0),
                                   'out', 0))
   where id = lid;
  seeded := seed_sport_pool(lid, coalesce((p_sport_settings ->> 'pool_limit')::int, 600));
  return r || jsonb_build_object('sport', sp, 'pool', seeded -> 'players');
end $$;
grant execute on function create_native_league(text, text, int, int, int, text, int, int, int, int, int, jsonb, text, text, int, text, jsonb) to authenticated;

-- ── sport_generate_schedule: 0426's body, up to 40 weeks ───────────────────
create or replace function sport_generate_schedule(p_league_id uuid, p_weeks int default 20)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare ids int[]; n int; ghost boolean := false; wk int; idx int; i int; a int; b int; hm int; aw int; made int := 0;
        weeks int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) or league_sport(p_league_id) = 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'not a sport league');
  end if;
  if (select settings_json -> 'sport' ->> 'period_start' from league where id = p_league_id) is null then
    return jsonb_build_object('ok', false, 'error', 'the league has no period_start');
  end if;
  weeks := coalesce(p_weeks, (select (settings_json -> 'sport' ->> 'weeks')::int from league where id = p_league_id), 20);
  if weeks < 1 or weeks > 40 then
    return jsonb_build_object('ok', false, 'error', 'weeks must be 1–40');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'season already underway — schedule is locked');
  end if;
  select array_agg(sleeper_roster_id order by sleeper_roster_id), count(*)::int
    into ids, n from league_membership where league_id = p_league_id;
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  if n % 2 = 1 then ids := ids || 0; n := n + 1; ghost := true; end if;

  delete from matchup where league_id = p_league_id;
  for idx in 1..weeks loop
    wk := 300 + idx;
    for i in 0..(n / 2 - 1) loop
      a := ids[((idx - 1 + i) % (n - 1)) + 1];
      b := case when i = 0 then ids[n] else ids[((idx - 1 + n - 1 - i) % (n - 1)) + 1] end;
      if ghost and (a = 0 or b = 0) then continue; end if;
      if idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
      insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
      values (p_league_id, wk, hm, aw, 'scheduled', null)
      on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
      made := made + 1;
    end loop;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'weeks', weeks, 'matchups', made, 'first_week', 301, 'last_week', 300 + weeks);
end $$;
grant execute on function sport_generate_schedule(uuid, int) to authenticated;

-- ── set_sport_settings v3: 0436's body, the sport's week anchor and 40 weeks ─
create or replace function set_sport_settings(p_league_id uuid, p_patch jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb; nxt jsonb; live boolean; k text; v text; sc jsonb := '{}'::jsonb; f text; cats jsonb; ps date; wk int; sp text;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  sp := league_sport(p_league_id);
  if sp = 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'not a sport league');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'patch must be an object');
  end if;
  select coalesce(settings_json -> 'sport', '{}'::jsonb) into cur from league where id = p_league_id;
  nxt := cur;
  live := exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled');

  if p_patch ? 'scoring' then
    if jsonb_typeof(p_patch -> 'scoring') <> 'object' then
      return jsonb_build_object('ok', false, 'error', 'scoring must be an object');
    end if;
    for k, v in select * from jsonb_each_text(p_patch -> 'scoring') loop
      if v ~ '^-?\d+(\.\d+)?$' and abs(v::numeric) <= 1000 then sc := sc || jsonb_build_object(k, v::numeric); end if;
    end loop;
    nxt := nxt || jsonb_build_object('scoring', sc);
  end if;

  if p_patch ? 'format' or p_patch ? 'categories' then
    if live then return jsonb_build_object('ok', false, 'error', 'the season is under way — the format and categories are locked'); end if;
    if p_patch ? 'format' then
      f := p_patch ->> 'format';
      if f not in ('points', 'cats', 'roto', 'season') then return jsonb_build_object('ok', false, 'error', 'format must be points, cats, roto or season'); end if;
      nxt := nxt || jsonb_build_object('format', f);
    end if;
    if p_patch ? 'categories' then
      if jsonb_typeof(p_patch -> 'categories') <> 'array' then return jsonb_build_object('ok', false, 'error', 'categories must be an array'); end if;
      select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into cats
        from jsonb_array_elements_text(p_patch -> 'categories') x where x ~ '^[a-z0-9_]{1,24}$';
      if jsonb_array_length(cats) > 20 then return jsonb_build_object('ok', false, 'error', 'at most 20 categories'); end if;
      nxt := nxt || jsonb_build_object('categories', cats);
    end if;
  end if;

  if p_patch ? 'period_start' or p_patch ? 'weeks' then
    if live then return jsonb_build_object('ok', false, 'error', 'the season is under way — the calendar is locked'); end if;
    if p_patch ? 'period_start' then
      begin ps := (p_patch ->> 'period_start')::date; exception when others then
        return jsonb_build_object('ok', false, 'error', 'period_start must be a date'); end;
      -- always the sport's own period day on or before (Monday; Tuesday for soccer)
      ps := ps - ((extract(isodow from ps)::int - sport_week_start_dow(sp) + 7) % 7);
      nxt := nxt || jsonb_build_object('period_start', to_char(ps, 'YYYY-MM-DD'));
    end if;
    if p_patch ? 'weeks' then
      wk := (p_patch ->> 'weeks')::int;
      if wk is null or wk < 1 or wk > 40 then return jsonb_build_object('ok', false, 'error', 'weeks must be 1–40'); end if;
      nxt := nxt || jsonb_build_object('weeks', wk);
    end if;
  end if;

  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('sport', nxt) where id = p_league_id;
  return jsonb_build_object('ok', true, 'sport', nxt);
end $$;
grant execute on function set_sport_settings(uuid, jsonb) to authenticated;
