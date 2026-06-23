-- 0007: admin setup + audit RPCs. Writers are SECURITY DEFINER + is_admin-gated;
-- the client fetches/parses Sleeper (reusing the app's directory loader) and calls
-- these to WRITE, so no heavy HTTP/JSON parsing happens inside Postgres.

-- Add sleeper_league_id to the overview so the admin client can sync from Sleeper.
create or replace function admin_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'commish_code', l.commish_code, 'invite_code', l.invite_code,
      'commissioner', l.commissioner_id is not null,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled)
    ) as r from league l order by l.created_at desc
  ) t;
  return result;
end $$;

-- Import / refresh a league row. Returns its id.
create or replace function admin_upsert_league(p_sleeper_id text, p_season text, p_name text, p_settings jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lid uuid;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into league (sleeper_league_id, season, name, settings_json, synced_at)
  values (p_sleeper_id, p_season, coalesce(p_name, 'League'), p_settings, now())
  on conflict (sleeper_league_id, season) do update
    set name = excluded.name, settings_json = excluded.settings_json, synced_at = now()
  returning id into lid;
  return jsonb_build_object('ok', true, 'league_id', lid);
end $$;

-- Upsert memberships. p_members = [{roster_id, owner_id, team_name}]. Enrollment is
-- (re)matched to an app_user by sleeper id; an existing enrolled link is preserved
-- (never clobbered to NULL by a re-import).
create or replace function admin_upsert_memberships(p_league_id uuid, p_members jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, team_name, app_user_id, enrolled)
  select p_league_id, (e->>'roster_id')::int, e->>'owner_id', e->>'team_name', au.id, au.id is not null
  from jsonb_array_elements(p_members) e
  left join app_user au on au.sleeper_user_id = e->>'owner_id'
  on conflict (league_id, sleeper_roster_id) do update set
    sleeper_owner_id = excluded.sleeper_owner_id,
    team_name = excluded.team_name,
    app_user_id = coalesce(league_membership.app_user_id, excluded.app_user_id),
    enrolled = (league_membership.enrolled or excluded.enrolled);
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_members));
end $$;

-- Upsert a week's matchups. p_matchups = [{home_roster_id, away_roster_id, sleeper_matchup_id}].
create or replace function admin_upsert_matchups(p_league_id uuid, p_week int, p_matchups jsonb, p_lock_at timestamptz default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
  select p_league_id, p_week, (e->>'sleeper_matchup_id')::int, (e->>'home_roster_id')::int, (e->>'away_roster_id')::int, 'scheduled', p_lock_at
  from jsonb_array_elements(p_matchups) e
  on conflict (league_id, week, home_roster_id, away_roster_id) do update set
    sleeper_matchup_id = excluded.sleeper_matchup_id,
    lock_at = coalesce(excluded.lock_at, matchup.lock_at);
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_matchups));
end $$;

-- Upsert a week's lineups (pick pool). p_lineups = [{roster_id, starters:[{slug,full,pos}]}].
create or replace function admin_upsert_lineups(p_league_id uuid, p_week int, p_lineups jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
  select p_league_id, p_week, (e->>'roster_id')::int, e->'starters'
  from jsonb_array_elements(p_lineups) e
  on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_lineups));
end $$;

-- Manage admins.
create or replace function admin_admins() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('email', email, 'note', note) order by created_at), '[]'::jsonb) into result from app_admin;
  return result;
end $$;

create or replace function admin_set_admin(p_email text, p_note text, p_remove boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_remove then
    if lower(p_email) = lower(auth.jwt() ->> 'email') then return jsonb_build_object('ok', false, 'error', 'cannot remove yourself'); end if;
    delete from app_admin where lower(email) = lower(p_email);
  else
    insert into app_admin (email, note) values (lower(p_email), p_note) on conflict (email) do update set note = excluded.note;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Audit: users + their enrolled-league count.
create or replace function admin_users() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'email', u.email, 'sleeper_username', u.sleeper_username, 'sleeper_user_id', u.sleeper_user_id,
    'enrolled', (select count(*) from league_membership m where m.app_user_id = u.id and m.enrolled),
    'created_at', u.created_at) order by u.created_at desc), '[]'::jsonb) into result from app_user u;
  return result;
end $$;

-- Audit: per-window scoring for a matchup.
create or replace function admin_states(p_matchup_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('window', game_window, 'home', home_score, 'away', away_score, 'updated_at', updated_at) order by game_window), '[]'::jsonb)
    into result from matchup_state where matchup_id = p_matchup_id;
  return result;
end $$;

grant execute on function admin_upsert_league(text, text, text, jsonb) to authenticated;
grant execute on function admin_upsert_memberships(uuid, jsonb) to authenticated;
grant execute on function admin_upsert_matchups(uuid, int, jsonb, timestamptz) to authenticated;
grant execute on function admin_upsert_lineups(uuid, int, jsonb) to authenticated;
grant execute on function admin_admins() to authenticated;
grant execute on function admin_set_admin(text, text, boolean) to authenticated;
grant execute on function admin_users() to authenticated;
grant execute on function admin_states(uuid) to authenticated;
