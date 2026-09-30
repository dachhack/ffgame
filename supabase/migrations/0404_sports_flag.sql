-- 0404 — THE SPORTS FLAG (v0.571.0): daily-sport leagues are the founder's
-- to test before anyone else sees them.
--
-- Founder: "Can we feature flag all of this to me so I can test?"
--
-- Same mechanism as 'native' (0095/0096): a key on app_user.features, granted
-- by admin_set_feature(email, 'sports', true), admins passing always.
-- create_native_league is the ONE door into a sport league, and every
-- downstream surface (draft chips, the week panel, the commissioner's sport
-- tabs, the player card) keys off league.sport — so gating creation gates
-- all of it. The clients hide the WHICH SPORT chips for anyone without the
-- flag; this is the server's word.
--
-- Grant:  select admin_set_feature('you@example.com', 'sports', true);
-- Revoke: select admin_set_feature('you@example.com', 'sports', false);
--
-- Undo: restore 0398's create_native_league; drop function if exists has_sports();

create or replace function has_sports() returns boolean
  language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce((select features ? 'sports' from app_user where id = auth.uid()), false);
$$;
grant execute on function has_sports() to authenticated;

-- 0398's door, with the gate. Re-issued whole rather than patched: a wrapper
-- cannot sit in front of the function the clients name.
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
  -- THE SPORTS FLAG (0404): a daily sport is behind has_sports() until the
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
