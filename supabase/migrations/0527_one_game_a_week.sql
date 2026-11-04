-- ═══════════════════════════════════════════════════════════════════════════
-- 0527 · ONE GAME A WEEK (v0.737.0)
--
-- Founder: "For NBA fantasy, players need to pick the game each week that
-- will count for their player in each roster spot for the weekly matchup."
-- A new sport format, `onegame`: a points week in which each starting spot
-- counts ONE game of the period — the one its manager picked, or the auto
-- pick (the game against the opponent allowing the most fantasy points so
-- far this season; with no record, the first game). The pick commits when
-- its game starts: before that it can change freely; after, that game is
-- the spot's game, good or bad. The worker (sportLeague.js) locks a spot
-- only for its effective game, once a period, and the week scores as every
-- points week does — the sum of locked slot-days.
--
--   • set_sport_settings admits the format.
--   • sport_team_allowed: fantasy points a team allows per game, by sport and
--     season, under the sport's default table — written hourly by the worker
--     from the season's finals; the auto pick's ranking.
--   • sport_game_pick: a manager's pick for one spot, keyed to the player it
--     was made for (a new player in the spot starts over on auto).
--   • sport_spot_games(matchup): the caller's spots with every game of the
--     period each player has, its opponent's allowed points, the pick and
--     the lock — the board decides the effective game with core's
--     effectiveSpotGame, the worker's own rule.
--   • set_sport_game_pick(matchup, slot, game|null): record or clear a pick,
--     refused once the spot has counted a game or for a game under way.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the format ───────────────────────────────────────────────────────────────
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
      if f not in ('points', 'onegame', 'cats', 'roto', 'season') then return jsonb_build_object('ok', false, 'error', 'format must be points, onegame, cats, roto or season'); end if;
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

-- ── what a team allows ───────────────────────────────────────────────────────
create table if not exists sport_team_allowed (
  sport      text not null,
  season     text not null,
  team       text not null,
  games      int not null default 0,
  pts_pg     numeric not null default 0,    -- fantasy points allowed per game, the sport's default table
  updated_at timestamptz not null default now(),
  primary key (sport, season, team)
);
alter table sport_team_allowed enable row level security;
drop policy if exists sport_team_allowed_read on sport_team_allowed;
create policy sport_team_allowed_read on sport_team_allowed for select using (auth.uid() is not null);
grant select on sport_team_allowed to authenticated;

create or replace function sport_team_allowed_upsert(p_sport text, p_season text, p_rows jsonb) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into sport_team_allowed (sport, season, team, games, pts_pg, updated_at)
  select p_sport, p_season, r ->> 'team', (r ->> 'games')::int, (r ->> 'pts_pg')::numeric, now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where (r ->> 'team') is not null
  on conflict (sport, season, team) do update
    set games = excluded.games, pts_pg = excluded.pts_pg, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function sport_team_allowed_upsert(text, text, jsonb) from public, anon, authenticated;
grant execute on function sport_team_allowed_upsert(text, text, jsonb) to service_role;

-- ── the pick ─────────────────────────────────────────────────────────────────
create table if not exists sport_game_pick (
  matchup_id   uuid not null references matchup(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  roster_slot  text not null,
  player_slug  text not null,               -- the player the pick was made for
  game_id      text not null,
  updated_at   timestamptz not null default now(),
  primary key (matchup_id, app_user_id, roster_slot)
);
alter table sport_game_pick enable row level security;
drop policy if exists sport_game_pick_own on sport_game_pick;
-- A pick is the manager's until the game starts and the lock shows it.
create policy sport_game_pick_own on sport_game_pick for select using (app_user_id = auth.uid());
grant select on sport_game_pick to authenticated;

-- The league's clock (replay-aware, as sport_slug_started reads it).
create or replace function _sport_league_now(p_league_id uuid) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select now() - make_interval(days => coalesce((l.settings_json -> 'sport' -> 'replay' ->> 'offset_days')::int, 0))
    from league l where l.id = p_league_id;
$$;
revoke execute on function _sport_league_now(uuid) from public, anon, authenticated;

-- The caller's spots in a matchup, each with every game of the period its
-- player's team has. One row per (spot, game); a spot whose player has no
-- game in the period yields one row with a null game.
create or replace function sport_spot_games(p_matchup uuid)
  returns table (roster_slot text, player_slug text, full_name text, team text,
                 game_id text, game_date date, start_utc timestamptz, status text, home text, away text, opp text,
                 allowed numeric, picked boolean, locked_game_id text)
  language sql stable security definer set search_path = public as $$
  with m as (
    select mt.id, mt.league_id, mt.week, l.sport, l.season, p.period_from, p.period_to
      from matchup mt join league l on l.id = mt.league_id
      cross join lateral sport_period(mt.league_id, mt.week) p
     where mt.id = p_matchup and (is_league_member_of_matchup(p_matchup) or is_admin())
  ), spots as (
    select sp.roster_slot, sp.player_slug, lp.full_name, lp.team
      from m join sealed_pick sp on sp.matchup_id = m.id and sp.app_user_id = auth.uid() and sp.game_window = 'wk' and sp.player_slug is not null
      left join league_pool lp on lp.league_id = m.league_id and lp.slug = sp.player_slug
  )
  select s.roster_slot, s.player_slug, s.full_name, s.team,
         g.game_id, g.game_date, g.start_utc, g.status, g.home, g.away,
         case when g.home = s.team then g.away else g.home end as opp,
         ta.pts_pg as allowed,
         (pk.game_id is not null and pk.game_id = g.game_id and pk.player_slug = s.player_slug) as picked,
         lk.game_id as locked_game_id
    from spots s cross join m
    left join sport_game g on g.sport = m.sport and g.season = m.season
                          and g.game_date between m.period_from and m.period_to
                          and s.team <> '' and (g.home = s.team or g.away = s.team)
    left join sport_team_allowed ta on ta.sport = m.sport and ta.season = m.season
                                   and ta.team = case when g.home = s.team then g.away else g.home end
    left join sport_game_pick pk on pk.matchup_id = m.id and pk.app_user_id = auth.uid() and pk.roster_slot = s.roster_slot
    left join lateral (select k.game_id from sport_slot_lock k
                        where k.matchup_id = m.id and k.app_user_id = auth.uid() and k.roster_slot = s.roster_slot
                        order by k.locked_at limit 1) lk on true
   order by s.roster_slot, g.start_utc nulls last
$$;
grant execute on function sport_spot_games(uuid) to authenticated;

create or replace function set_sport_game_pick(p_matchup uuid, p_slot text, p_game_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; lg league%rowtype; v_slug text; tm text; vnow timestamptz; pf date; pt date; g sport_game%rowtype;
begin
  select * into m from matchup where id = p_matchup;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not is_league_member_of_matchup(p_matchup) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into lg from league where id = m.league_id;
  if lg.sport = 'nfl' or coalesce(lg.settings_json -> 'sport' ->> 'format', '') <> 'onegame' then
    return jsonb_build_object('ok', false, 'error', 'this league does not pick a game per spot');
  end if;
  if m.status = 'final' then return jsonb_build_object('ok', false, 'error', 'the week is final'); end if;
  select sp.player_slug into v_slug from sealed_pick sp
   where sp.matchup_id = p_matchup and sp.app_user_id = auth.uid() and sp.game_window = 'wk' and sp.roster_slot = p_slot;
  if v_slug is null then return jsonb_build_object('ok', false, 'error', 'no player in that spot'); end if;
  if exists (select 1 from sport_slot_lock k where k.matchup_id = p_matchup and k.app_user_id = auth.uid() and k.roster_slot = p_slot) then
    return jsonb_build_object('ok', false, 'error', 'that spot''s game has already counted this week');
  end if;
  if p_game_id is null then
    delete from sport_game_pick where matchup_id = p_matchup and app_user_id = auth.uid() and roster_slot = p_slot;
    return jsonb_build_object('ok', true, 'game_id', null);
  end if;
  vnow := _sport_league_now(m.league_id);
  select period_from, period_to into pf, pt from sport_period(m.league_id, m.week);
  select lp.team into tm from league_pool lp where lp.league_id = m.league_id and lp.slug = v_slug;
  select * into g from sport_game where sport = lg.sport and season = lg.season and game_id = p_game_id;
  if not found or g.game_date < pf or g.game_date > pt then return jsonb_build_object('ok', false, 'error', 'that game is not in this week'); end if;
  if tm is null or tm = '' or (g.home <> tm and g.away <> tm) then return jsonb_build_object('ok', false, 'error', 'that player is not in that game'); end if;
  if g.status in ('postponed', 'cancelled') then return jsonb_build_object('ok', false, 'error', 'that game is off'); end if;
  if g.status in ('live', 'final') or (g.start_utc is not null and g.start_utc <= vnow) then
    return jsonb_build_object('ok', false, 'error', 'that game has already started — a pick commits at tip-off');
  end if;
  insert into sport_game_pick (matchup_id, app_user_id, roster_slot, player_slug, game_id, updated_at)
  values (p_matchup, auth.uid(), p_slot, v_slug, p_game_id, now())
  on conflict (matchup_id, app_user_id, roster_slot) do update
    set player_slug = excluded.player_slug, game_id = excluded.game_id, updated_at = now();
  return jsonb_build_object('ok', true, 'game_id', p_game_id);
end $$;
grant execute on function set_sport_game_pick(uuid, text, text) to authenticated;
