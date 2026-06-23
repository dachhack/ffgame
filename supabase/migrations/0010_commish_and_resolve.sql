-- 0010: commissioner self-serve (scoped reuse of admin RPCs) + admin force-resolve.

-- Ownership helpers.
create or replace function is_league_commish(l uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league where id = l and commissioner_id = auth.uid());
$$;
create or replace function is_matchup_commish(m uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from matchup mt join league l on l.id = mt.league_id where mt.id = m and l.commissioner_id = auth.uid());
$$;

-- A commissioner's own leagues (same shape as admin_overview).
create or replace function commish_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled)
    ) as r from league l where l.commissioner_id = auth.uid() order by l.created_at desc
  ) t;
  return result;
end $$;

-- Extend these to also allow the league's / matchup's commissioner.
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'email', u.email, 'sleeper', u.sleeper_username
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m left join app_user u on u.id = m.app_user_id where m.league_id = p_league_id;
  return result;
end $$;

create or replace function admin_matchups(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r order by (r->>'week')::int), '[]'::jsonb) into result from (
    select jsonb_build_object('id', id, 'week', week, 'home_roster_id', home_roster_id, 'away_roster_id', away_roster_id,
      'status', status, 'lock_at', lock_at, 'home_final', home_final, 'away_final', away_final) as r
    from matchup where league_id = p_league_id
  ) t;
  return result;
end $$;

create or replace function admin_set_matchup(p_matchup_id uuid, p_status text, p_lock_now boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_matchup_commish(p_matchup_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_status is not null and p_status not in ('scheduled', 'locked', 'live', 'final') then return jsonb_build_object('ok', false, 'error', 'bad status'); end if;
  update matchup set status = coalesce(p_status::matchup_status, status), lock_at = case when p_lock_now then now() else lock_at end where id = p_matchup_id;
  if p_status in ('locked', 'live', 'final') then update sealed_pick set locked = true, revealed_at = now() where matchup_id = p_matchup_id and not locked; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_upsert_matchups(p_league_id uuid, p_week int, p_matchups jsonb, p_lock_at timestamptz default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into matchup (league_id, week, sleeper_matchup_id, home_roster_id, away_roster_id, status, lock_at)
  select p_league_id, p_week, (e->>'sleeper_matchup_id')::int, (e->>'home_roster_id')::int, (e->>'away_roster_id')::int, 'scheduled', p_lock_at
  from jsonb_array_elements(p_matchups) e
  on conflict (league_id, week, home_roster_id, away_roster_id) do update set sleeper_matchup_id = excluded.sleeper_matchup_id, lock_at = coalesce(excluded.lock_at, matchup.lock_at);
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_matchups));
end $$;

create or replace function admin_upsert_lineups(p_league_id uuid, p_week int, p_lineups jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
  select p_league_id, p_week, (e->>'roster_id')::int, e->'starters' from jsonb_array_elements(p_lineups) e
  on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_lineups));
end $$;

-- Regen: admin for either code; commissioner only for their invite code.
create or replace function admin_regen_code(p_league_id uuid, p_which text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare nc text;
begin
  if not (is_admin() or (is_league_commish(p_league_id) and p_which = 'invite')) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  nc := gen_invite_code();
  if p_which = 'invite' then update league set invite_code = nc where id = p_league_id;
  elsif p_which = 'commish' then update league set commish_code = nc where id = p_league_id;
  else return jsonb_build_object('ok', false, 'error', 'bad which'); end if;
  return jsonb_build_object('ok', true, 'code', nc);
end $$;

-- ── Admin force-resolve (preview real engine scoring from baked 2025 data) ──
-- The client runs the engine in-browser and writes the per-window scores here.
create or replace function admin_matchup_picks(p_matchup_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; hu uuid; au uuid;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('error', 'no matchup'); end if;
  select app_user_id into hu from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id;
  select app_user_id into au from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id;
  return jsonb_build_object(
    'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id, 'home_app_user', hu, 'away_app_user', au,
    'picks', (select coalesce(jsonb_agg(jsonb_build_object('app_user_id', app_user_id, 'game_window', game_window, 'roster_slot', roster_slot, 'player_slug', player_slug, 'metric_id', metric_id)), '[]'::jsonb) from sealed_pick where matchup_id = p_matchup_id),
    'home_lineup', (select coalesce(starters_json, '[]'::jsonb) from sleeper_lineup where league_id = m.league_id and week = m.week and roster_id = m.home_roster_id),
    'away_lineup', (select coalesce(starters_json, '[]'::jsonb) from sleeper_lineup where league_id = m.league_id and week = m.week and roster_id = m.away_roster_id)
  );
end $$;

create or replace function admin_set_state(p_matchup_id uuid, p_states jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into matchup_state (matchup_id, game_window, home_score, away_score, updated_at)
  select p_matchup_id, e->>'window', (e->>'home')::numeric, (e->>'away')::numeric, now()
  from jsonb_array_elements(p_states) e
  on conflict (matchup_id, game_window) do update set home_score = excluded.home_score, away_score = excluded.away_score, updated_at = now();
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_states));
end $$;

grant execute on function is_league_commish(uuid) to authenticated;
grant execute on function is_matchup_commish(uuid) to authenticated;
grant execute on function commish_overview() to authenticated;
grant execute on function admin_matchup_picks(uuid) to authenticated;
grant execute on function admin_set_state(uuid, jsonb) to authenticated;
