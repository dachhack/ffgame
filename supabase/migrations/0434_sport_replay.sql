-- 0434 — A SPORT LEAGUE CAN REPLAY A PAST SEASON (v0.626.0).
--
-- Founder, in October with the MLB season over: "Went into MLB league but no
-- games scheduled. Maybe demo with MLB 2025 data for now." A replay league
-- has `settings_json.sport.replay = {season, offset_days}` and `league.season`
-- = that season: the worker fetches the past season's games for the league's
-- VIRTUAL today (now − offset_days) and reveals each as its start passes on
-- that clock, so locks, lines and finals happen day by day as they did live.
-- The one piece of SQL that reads the clock is the lineup gate's "has his
-- game started" — it shifts by the same offset. Everything else already joins
-- on league.season.
--
-- Undo: restore 0430's sport_slug_started.

create or replace function sport_slug_started(p_league_id uuid, p_slug text) returns boolean
  language sql stable security definer set search_path = public as $$
  with lg as (
    select l.id, l.sport, l.season,
           now() - make_interval(days => coalesce((l.settings_json -> 'sport' -> 'replay' ->> 'offset_days')::int, 0)) as vnow
      from league l where l.id = p_league_id and l.sport <> 'nfl'
  )
  select exists (
    select 1
      from lg
      join league_pool lp on lp.league_id = lg.id and lp.slug = p_slug and lp.team <> ''
      join sport_game g on g.sport = lg.sport and g.season = lg.season
                       and (g.home = lp.team or g.away = lp.team)
     where g.status not in ('postponed', 'cancelled')
       and (
         (g.game_date = (lg.vnow at time zone 'America/New_York')::date
          and (g.status in ('live', 'final') or (g.start_utc is not null and g.start_utc <= lg.vnow)))
         or (g.game_date = (lg.vnow at time zone 'America/New_York')::date - 1 and g.status = 'live')
       )
  );
$$;
grant execute on function sport_slug_started(uuid, text) to authenticated;
