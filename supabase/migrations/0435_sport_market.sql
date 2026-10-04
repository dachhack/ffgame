-- 0435 — THE SPORT MARKET (v0.627.0): pre-season ADP and the season's calendar.
--
-- Founder: "Let's make weekly and season long projections for new sports
-- from previous season actuals. Also pull in pre season ADP for these
-- sports for draft testing."
--
--   sport_player.adp        consensus average draft position (FantasyPros'
--                           AVG), written daily by the worker's market sweep
--                           with its source and stamp. Null = the page does
--                           not list him.
--   sport_calendar          every pro game of a season by date, from ESPN's
--                           season payload (one request per sport). The feeds
--                           serve a day at a time; a projection for the week
--                           needs the week.
--   seed_sport_pool         orders a new pool by ADP first (rank behind it),
--                           so a draft room sorted by RANK drafts like the
--                           market does. Re-issued from 0425's body.
--   sport_league_market     what a league's screens read: each pool player's
--                           ADP, games played and season line (the per-game
--                           rate is computed under the league's own table in
--                           the client), plus each team's game dates this
--                           period and games left this season — the two
--                           multipliers behind "this week" and "season".
--
-- Undo: alter table sport_player drop column adp, adp_src, adp_at;
--       drop table sport_calendar; drop function sport_adp_upsert,
--       sport_calendar_upsert, sport_league_market; restore 0425's seed_sport_pool.

alter table sport_player add column if not exists adp numeric;
alter table sport_player add column if not exists adp_src text;
alter table sport_player add column if not exists adp_at timestamptz;

create table if not exists sport_calendar (
  sport      text not null check (sport in ('nba', 'wnba', 'nhl', 'mlb')),
  season     text not null,
  src_id     text not null,                   -- the calendar source's game id
  game_date  date not null,                   -- US Eastern date
  start_utc  timestamptz,
  home       text not null,                   -- feed tricode
  away       text not null,
  updated_at timestamptz not null default now(),
  primary key (sport, season, src_id)
);
create index if not exists sport_calendar_date on sport_calendar(sport, season, game_date);
alter table sport_calendar enable row level security;
drop policy if exists sport_calendar_read on sport_calendar;
create policy sport_calendar_read on sport_calendar for select to authenticated using (true);

-- The worker only: ADP per player key. Rows: [{key, adp}].
create or replace function sport_adp_upsert(p_sport text, p_rows jsonb) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update sport_player p
     set adp = (r.value ->> 'adp')::numeric, adp_src = 'fantasypros', adp_at = now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where p.sport = p_sport and p.player_key = r.value ->> 'key'
     and (r.value ->> 'adp') is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function sport_adp_upsert(text, jsonb) from public, anon, authenticated;
grant execute on function sport_adp_upsert(text, jsonb) to service_role;

-- The worker only: a season's calendar. Rows: [{src_id, game_date, start_utc, home, away}].
create or replace function sport_calendar_upsert(p_sport text, p_season text, p_rows jsonb) returns int
  language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into sport_calendar (sport, season, src_id, game_date, start_utc, home, away, updated_at)
  select p_sport, p_season, r ->> 'src_id', (r ->> 'game_date')::date, (r ->> 'start_utc')::timestamptz,
         upper(r ->> 'home'), upper(r ->> 'away'), now()
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
   where (r ->> 'src_id') is not null and (r ->> 'game_date') is not null
  on conflict (sport, season, src_id) do update
    set game_date = excluded.game_date, start_utc = excluded.start_utc,
        home = excluded.home, away = excluded.away, updated_at = now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function sport_calendar_upsert(text, text, jsonb) from public, anon, authenticated;
grant execute on function sport_calendar_upsert(text, text, jsonb) to service_role;

-- ── seed_sport_pool v2: 0425's body, ordered by ADP first ───────────────────
create or replace function seed_sport_pool(p_league_id uuid, p_limit int default 600)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare sp text; n int;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  select sport into sp from league where id = p_league_id;
  if sp is null or sp = 'nfl' then
    return jsonb_build_object('ok', false, 'error', 'not a sport league');
  end if;
  if exists (select 1 from draft d where d.league_id = p_league_id and d.status <> 'pending') then
    return jsonb_build_object('ok', false, 'error', 'draft already started');
  end if;
  p_limit := least(greatest(coalesce(p_limit, 600), 50), 2000);

  delete from league_pool lp where lp.league_id = p_league_id
    and not exists (select 1 from native_roster nr where nr.league_id = lp.league_id and nr.slug = lp.slug);
  -- ADP first (the market's order, for the draft), the production rank behind
  -- it for everyone the page does not list, names last.
  insert into league_pool (league_id, slug, full_name, pos, team, rank, eligible)
  select p_league_id, p.player_key, p.full_name, p.pos, p.team,
         row_number() over (order by p.adp nulls last, p.rank nulls last, p.full_name), p.eligible
    from sport_player p
   where p.sport = sp and p.active
   order by p.adp nulls last, p.rank nulls last, p.full_name
   limit p_limit
  on conflict (league_id, slug) do update
    set full_name = excluded.full_name, pos = excluded.pos, team = excluded.team, eligible = excluded.eligible;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'pool', n, 'sport', sp);
end $$;
grant execute on function seed_sport_pool(uuid, int) to authenticated;

-- ── the market a league's screens read ──────────────────────────────────────
create or replace function sport_league_market(p_league_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare sp text; seas text; start_d date; today_d date; from_d date; to_d date; wk int; out jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not in this league');
  end if;
  select l.sport, l.season, (l.settings_json -> 'sport' ->> 'period_start')::date,
         ((now() - make_interval(days => coalesce((l.settings_json -> 'sport' -> 'replay' ->> 'offset_days')::int, 0))) at time zone 'America/New_York')::date
    into sp, seas, start_d, today_d
    from league l where l.id = p_league_id;
  if sp is null or sp = 'nfl' or start_d is null then
    return jsonb_build_object('ok', false, 'error', 'not a sport league');
  end if;
  from_d := case when today_d < start_d then start_d else start_d + 7 * ((today_d - start_d) / 7) end;
  to_d := from_d + 6;
  wk := 301 + (from_d - start_d) / 7;
  -- Games per team: the calendar where it exists, the polled games where it
  -- does not (a replay season has no calendar); a game counts once.
  with g as (
    select c.game_date, c.home, c.away from sport_calendar c where c.sport = sp and c.season = seas
    union
    select sg.game_date, sg.home, sg.away from sport_game sg
     where sg.sport = sp and sg.season = seas and sg.status not in ('postponed', 'cancelled')
       and not exists (select 1 from sport_calendar c where c.sport = sp and c.season = seas and c.game_date = sg.game_date and c.home = sg.home and c.away = sg.away)
  ), tg as (
    select home as team, game_date from g union all select away, game_date from g
  ), wk_games as (
    select team, jsonb_agg(to_char(game_date, 'YYYY-MM-DD') order by game_date) as dates
      from tg where game_date between from_d and to_d group by team
  ), left_games as (
    select team, count(*) as n from tg where game_date >= today_d group by team
  ), rows as (
    select lp.slug, p.adp, p.gp, p.season_line, p.team
      from league_pool lp join sport_player p on p.player_key = lp.slug and p.sport = sp
     where lp.league_id = p_league_id
  )
  select jsonb_build_object(
    'ok', true, 'sport', sp, 'season', seas, 'week', wk, 'from', to_char(from_d, 'YYYY-MM-DD'), 'to', to_char(to_d, 'YYYY-MM-DD'), 'today', to_char(today_d, 'YYYY-MM-DD'),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'adp', r.adp, 'gp', r.gp, 'season_line', r.season_line, 'team', r.team)) from rows r), '[]'::jsonb),
    'week_games', coalesce((select jsonb_object_agg(w.team, w.dates) from wk_games w), '{}'::jsonb),
    'season_left', coalesce((select jsonb_object_agg(l.team, l.n) from left_games l), '{}'::jsonb),
    'calendar', exists (select 1 from sport_calendar c where c.sport = sp and c.season = seas),
    'adp_at', (select max(p.adp_at) from sport_player p where p.sport = sp)
  ) into out;
  return out;
end $$;
grant execute on function sport_league_market(uuid) to authenticated;
