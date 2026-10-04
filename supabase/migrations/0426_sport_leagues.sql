-- 0426 — SPORT LEAGUES (phase 3, v0.617.0): a native league in a daily sport.
--
-- What a daily sport changes about a native classic league, and nothing more:
--
--   • CREATION carries a sport. create_native_league gains p_sport and
--     p_sport_settings (the lineup and the sport block, built by core's
--     sportLeagueSettings so the SportDef stays the one source); a sport
--     league is classic by construction, and its pool is seeded here from
--     sport_player rather than posted by the client.
--   • THE CALENDAR is periods, not NFL weeks. Board weeks 301+ (core
--     SPORT_WEEK_BASE), each a Mon–Sun period from settings_json.sport.
--     period_start. Disjoint from 1–22 / 101+ / 201+ so the NFL worker's
--     week-keyed queries can never touch a sport league.
--   • THE LOCK is per game, not per week. `sport_slot_lock` is the snapshot
--     the worker takes of each seat's starting slots when a player's game
--     starts: what was in the slot at tip-off is what scores that day.
--     enforce_sport_pick_lock refuses to move a player whose game today has
--     started, in or out, so the snapshot is always what the manager set.
--   • THE RESULT is the sum of locked slot-days (points) or a category
--     verdict (cats), written by the worker into matchup_state / matchup as
--     every other league's is, so standings and playoffs read as before.
--
-- AMENDED ON THE BRANCH before any deploy (v0.622.0): create_native_league
-- also stores roster_shape for a sport league; 0431 backfills a database
-- that ran the earlier text.
--
-- Undo:
--   drop trigger if exists enforce_sport_pick_lock on sealed_pick;
--   drop trigger if exists enforce_sport_roster_lock on native_roster;
--   drop function if exists enforce_sport_pick_lock(), enforce_sport_roster_lock(),
--     sport_slug_started(uuid, text), sport_period(uuid, int), sport_generate_schedule(uuid, int),
--     league_sport(uuid);
--   drop table if exists sport_slot_lock;
--   then restore create_native_league from 0281 and native_generate_schedule from 0371.

-- ── helpers ──────────────────────────────────────────────────────────────────
create or replace function league_sport(p_league_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce((select sport from league where id = p_league_id), 'nfl');
$$;
grant execute on function league_sport(uuid) to authenticated;

-- The dates board week p_week covers in this league: period_start + 7·(N−1)
-- … +6, N = week − 300. Null for an NFL league or a week below the base.
create or replace function sport_period(p_league_id uuid, p_week int)
  returns table (period_from date, period_to date)
  language sql stable security definer set search_path = public as $$
  select (l.settings_json -> 'sport' ->> 'period_start')::date + 7 * (p_week - 301),
         (l.settings_json -> 'sport' ->> 'period_start')::date + 7 * (p_week - 301) + 6
    from league l
   where l.id = p_league_id and l.sport <> 'nfl' and p_week > 300
     and (l.settings_json -> 'sport' ->> 'period_start') is not null;
$$;
grant execute on function sport_period(uuid, int) to authenticated;

-- ── the per-game lock ────────────────────────────────────────────────────────
create table if not exists sport_slot_lock (
  matchup_id   uuid not null references matchup(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  game_date    date not null,
  roster_slot  text not null,
  player_slug  text not null,
  game_id      text not null,
  locked_at    timestamptz not null default now(),
  primary key (matchup_id, app_user_id, game_date, roster_slot)
);
create index if not exists sport_slot_lock_matchup on sport_slot_lock(matchup_id, game_date);
alter table sport_slot_lock enable row level security;
drop policy if exists sport_slot_lock_read on sport_slot_lock;
-- A locked slot is public to the matchup: the game has started, so there is
-- nothing sealed about it any more.
create policy sport_slot_lock_read on sport_slot_lock for select using (is_league_member_of_matchup(matchup_id));
grant select on sport_slot_lock to authenticated;

-- Has this player's game today (the league's calendar, US Eastern) started —
-- or is yesterday's still going after midnight? A player with no game
-- today is free to move; so is one whose game is hours away.
create or replace function sport_slug_started(p_league_id uuid, p_slug text) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from league l
      join league_pool lp on lp.league_id = l.id and lp.slug = p_slug and lp.team <> ''
      join sport_game g on g.sport = l.sport and g.season = l.season
                       and (g.home = lp.team or g.away = lp.team)
     where l.id = p_league_id and l.sport <> 'nfl'
       and (
         (g.game_date = (now() at time zone 'America/New_York')::date
          and (g.status in ('live', 'final') or (g.start_utc is not null and g.start_utc <= now())))
         or (g.game_date = (now() at time zone 'America/New_York')::date - 1 and g.status = 'live')
       )
  );
$$;
grant execute on function sport_slug_started(uuid, text) to authenticated;

-- The lineup gate. Same shape as 0178's classic branch: the incoming AND
-- the outgoing player are checked, no lead time. Applies only to sport
-- leagues; the NFL trigger runs beside it untouched.
create or replace function enforce_sport_pick_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
declare lg uuid; rec sealed_pick;
begin
  if auth.uid() is null or is_admin() then return coalesce(new, old); end if;
  rec := coalesce(new, old);
  if rec.game_window <> 'wk' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and new.player_slug is not distinct from old.player_slug
     and new.roster_slot is not distinct from old.roster_slot then
    return new;
  end if;
  select league_id into lg from matchup where id = rec.matchup_id;
  if lg is null or league_sport(lg) = 'nfl' then return coalesce(new, old); end if;
  if tg_op in ('INSERT', 'UPDATE') and new.player_slug is not null and sport_slug_started(lg, new.player_slug) then
    raise exception 'that player''s game has already started — lineups lock player by player at tip-off'
      using errcode = 'check_violation';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.player_slug is not null and sport_slug_started(lg, old.player_slug) then
    raise exception 'that player''s game has already started — he stays in your lineup today'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists enforce_sport_pick_lock on sealed_pick;
create trigger enforce_sport_pick_lock before insert or update or delete on sealed_pick
  for each row execute function enforce_sport_pick_lock();

-- The roster gate: no adding or dropping a player mid-game (0179's rule for
-- classic, restated for the sport calendar — its classic_slug_started reads
-- nfl_slate and finds nothing for a sport league).
create or replace function enforce_sport_roster_lock() returns trigger
  language plpgsql security definer set search_path = public as $$
declare rec native_roster;
begin
  if auth.uid() is null or is_admin() then return coalesce(new, old); end if;
  rec := coalesce(new, old);
  if league_sport(rec.league_id) = 'nfl' then return coalesce(new, old); end if;
  if sport_slug_started(rec.league_id, rec.slug)
     or (tg_op = 'UPDATE' and new.slug is distinct from old.slug and sport_slug_started(old.league_id, old.slug)) then
    raise exception 'that player''s game has already started — he cannot be added, dropped or moved today'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists enforce_sport_roster_lock on native_roster;
create trigger enforce_sport_roster_lock before insert or update or delete on native_roster
  for each row execute function enforce_sport_roster_lock();

-- ── the schedule: periods from 301 ───────────────────────────────────────────
-- The circle method as native_generate_schedule plays it, without divisions
-- (a sport league has none yet) and without nfl_slate: lock_at is null until
-- the worker sets it to the period's first game. Up to 30 periods.
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
  if weeks < 1 or weeks > 30 then
    return jsonb_build_object('ok', false, 'error', 'weeks must be 1–30');
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

-- native_generate_schedule delegates for a sport league, so the client's one
-- call keeps working. 0371's body follows verbatim after the branch.
create or replace function native_generate_schedule(p_league_id uuid, p_weeks int default 14)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ids int[]; n int; ghost boolean := false; wk int; idx int; i int;
  a int; b int; hm int; aw int; la timestamptz; seas text; made int := 0;
  use_div boolean; rot int; pool int[]; pairs int[]; div_a text; j int; pick int;
  start_wk int; cap int; last_wk int := 0;
begin
  -- 0426: a sport league plays periods from 301.
  if league_sport(p_league_id) <> 'nfl' then
    return sport_generate_schedule(p_league_id, p_weeks);
  end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not is_native_league(p_league_id) then
    return jsonb_build_object('ok', false, 'error', 'not a native league');
  end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 18 then
    return jsonb_build_object('ok', false, 'error', 'weeks must be 1–18');
  end if;
  if exists (select 1 from matchup m where m.league_id = p_league_id and m.status <> 'scheduled') then
    return jsonb_build_object('ok', false, 'error', 'season already underway — schedule is locked');
  end if;

  select array_agg(sleeper_roster_id order by sleeper_roster_id), count(*)::int
    into ids, n from league_membership where league_id = p_league_id;
  if n < 2 then return jsonb_build_object('ok', false, 'error', 'need at least 2 teams'); end if;
  use_div := league_divisions_active(p_league_id);
  if n % 2 = 1 then ids := ids || 0; n := n + 1; ghost := true; end if;  -- 0 = bye

  select l.season into seas from league l where l.id = p_league_id;
  start_wk := coalesce(league_first_open_week(p_league_id, seas), league_week_base(p_league_id) + 1);
  cap := league_last_regular_week(p_league_id);
  if start_wk > cap then
    return jsonb_build_object('ok', false, 'error',
      format('no weeks left to play — the next open week is %s and the regular season ends at %s',
             start_wk, cap));
  end if;
  delete from matchup where league_id = p_league_id;

  for idx in 1..p_weeks loop
    wk := start_wk + idx - 1;
    exit when wk > cap;
    last_wk := wk;
    select min(kickoff) into la from nfl_slate s where s.season = seas and s.week = wk;

    if use_div and idx > n - 1 then
      rot := idx - (n - 1);
      select array_agg(m.sleeper_roster_id order by m.division, m.sleeper_roster_id)
        into pool from league_membership m where m.league_id = p_league_id;
      pairs := '{}';
      while coalesce(array_length(pool, 1), 0) >= 2 loop
        a := pool[1]; pool := pool[2:];
        select m.division into div_a from league_membership m
          where m.league_id = p_league_id and m.sleeper_roster_id = a;
        select count(*) into j from unnest(pool) u
          join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = u
          where m.division = div_a;
        if j > 0 then
          pick := ((rot - 1) % j) + 1;
          select u into b from (
            select u, row_number() over (order by u) as rn from unnest(pool) u
            join league_membership m on m.league_id = p_league_id and m.sleeper_roster_id = u
            where m.division = div_a) t where t.rn = pick;
        else
          b := pool[1];
        end if;
        pool := array_remove(pool, b);
        pairs := pairs || a || b;
      end loop;
      i := 1;
      while i < coalesce(array_length(pairs, 1), 0) loop
        a := pairs[i]; b := pairs[i + 1]; i := i + 2;
        if idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
        insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
        values (p_league_id, wk, hm, aw, 'scheduled', la)
        on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
        made := made + 1;
      end loop;
      continue;
    end if;

    for i in 0..(n / 2 - 1) loop
      a := ids[((idx - 1 + i) % (n - 1)) + 1];
      b := case when i = 0 then ids[n]
                else ids[((idx - 1 + n - 1 - i) % (n - 1)) + 1] end;
      if ghost and (a = 0 or b = 0) then continue; end if;
      if idx % 2 = 0 then hm := b; aw := a; else hm := a; aw := b; end if;
      insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
      values (p_league_id, wk, hm, aw, 'scheduled', la)
      on conflict (league_id, week, home_roster_id, away_roster_id) do nothing;
      made := made + 1;
    end loop;
  end loop;
  perform native_materialize(p_league_id);
  return jsonb_build_object('ok', true, 'weeks', greatest(last_wk - start_wk + 1, 0),
    'matchups', made, 'first_week', start_wk, 'last_week', last_wk);
end $$;
grant execute on function native_generate_schedule(uuid, int) to authenticated;

-- ── creation, with a sport ───────────────────────────────────────────────────
-- The 15-argument door of 0281, plus p_sport and p_sport_settings. The old
-- signature is dropped rather than overloaded: PostgREST resolves a named
-- call against every candidate, and two doors with defaults are ambiguous.
drop function if exists create_native_league(text, text, int, int, int, text, int, int, int, int, int, jsonb, text, text, int);
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
  if sp not in ('nfl', 'nba', 'wnba', 'nhl', 'mlb') then
    return jsonb_build_object('ok', false, 'error', 'unknown sport ' || sp);
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

-- ── what a board needs to draw a sport league's week ─────────────────────────
-- The matchup's locked slot-days with each player's line for that day, both
-- seats, once the period has started. Derivation and scoring happen in core.
create or replace function _sport_matchup_lines(p_matchup uuid)
  returns table (app_user_id uuid, roster_id int, game_date date, roster_slot text, player_slug text,
                 game_id text, status text, line jsonb, full_name text, team text, pos text)
  language sql stable security definer set search_path = public as $$
  select k.app_user_id,
         (select lm.sleeper_roster_id from league_membership lm
           where lm.league_id = m.league_id and lm.app_user_id = k.app_user_id
           order by lm.sleeper_roster_id limit 1),
         k.game_date, k.roster_slot, k.player_slug, k.game_id, g.status, s.line,
         coalesce(s.full_name, lp.full_name), coalesce(s.team, lp.team), coalesce(s.pos, lp.pos)
    from sport_slot_lock k
    join matchup m on m.id = k.matchup_id
    join league l on l.id = m.league_id
    left join sport_game g on g.sport = l.sport and g.season = l.season and g.game_id = k.game_id
    left join game_stat_line s on s.sport = l.sport and s.season = l.season and s.game_id = k.game_id and s.player_key = k.player_slug
    left join league_pool lp on lp.league_id = m.league_id and lp.slug = k.player_slug
   where k.matchup_id = p_matchup
   order by k.game_date, k.app_user_id, k.roster_slot
$$;
revoke execute on function _sport_matchup_lines(uuid) from public, anon, authenticated;

create or replace function sport_matchup_lines(p_matchup uuid)
  returns table (app_user_id uuid, roster_id int, game_date date, roster_slot text, player_slug text,
                 game_id text, status text, line jsonb, full_name text, team text, pos text)
  language sql stable security definer set search_path = public as $$
  select * from _sport_matchup_lines(p_matchup) where is_league_member_of_matchup(p_matchup) or is_admin();
$$;
grant execute on function sport_matchup_lines(uuid) to authenticated;

-- The worker's copy: no membership (the service role has no uid).
create or replace function sport_matchup_lines_svc(p_matchup uuid)
  returns table (app_user_id uuid, roster_id int, game_date date, roster_slot text, player_slug text,
                 game_id text, status text, line jsonb, full_name text, team text, pos text)
  language sql stable security definer set search_path = public as $$
  select * from _sport_matchup_lines(p_matchup);
$$;
revoke execute on function sport_matchup_lines_svc(uuid) from public, anon, authenticated;
grant execute on function sport_matchup_lines_svc(uuid) to service_role;

-- Today's and this period's games for a league's sport — the slate a board
-- shows beside each player ("@BOS 7:30", "FINAL 112-104").
create or replace function sport_league_games(p_league_id uuid, p_from date, p_to date)
  returns table (game_id text, game_date date, start_utc timestamptz, status text, away text, home text,
                 away_score int, home_score int, clock text)
  language sql stable security definer set search_path = public as $$
  select g.game_id, g.game_date, g.start_utc, g.status, g.away, g.home, g.away_score, g.home_score, g.clock
    from sport_game g join league l on l.id = p_league_id
   where g.sport = l.sport and g.season = l.season and g.game_date between p_from and p_to
     and (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin())
   order by g.game_date, g.start_utc
$$;
grant execute on function sport_league_games(uuid, date, date) to authenticated;

-- ── league_game_mode carries the sport ───────────────────────────────────────
-- 0200's body plus `sport` and the sport block, so every screen that already
-- loads the mode learns which sport it is drawing without a second call.
create or replace function league_game_mode(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  return (select jsonb_build_object('ok', true,
      'mode', coalesce(l.settings_json ->> 'game_mode', 'drip'),
      'ppr',  coalesce((l.settings_json ->> 'ppr')::numeric, 1),
      'classic_ok', coalesce((l.settings_json ->> 'classic_ok')::boolean, false),
      'bestball', coalesce(l.settings_json -> 'bestball', '[]'::jsonb),
      'scoring', coalesce(l.settings_json -> 'scoring_classic', '{}'::jsonb),
      'roster', coalesce(l.settings_json -> 'roster_classic', '{}'::jsonb),
      'slots', l.settings_json -> 'roster_slots',
      'shape', l.settings_json -> 'roster_shape',
      'rounds', (select rounds from draft d where d.league_id = l.id),
      'positions', l.settings_json -> 'positions_extra',
      'pool_filter', l.settings_json -> 'pool_filter',
      'golf', league_golf(p_league_id),
      'sport', coalesce(l.sport, 'nfl'),
      'sport_settings', l.settings_json -> 'sport',
      'can_edit', is_admin() or is_league_commish(p_league_id))
    from league l where l.id = p_league_id);
end $$;
grant execute on function league_game_mode(uuid) to authenticated;
