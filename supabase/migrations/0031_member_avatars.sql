-- 0031: surface league_membership.avatar_url (added in 0030) through the admin
-- views so a team's badge — e.g. the sanitized test league's 2025 league logos —
-- renders on the matchup board and in the members list.

-- admin_league_members (0022) + avatar.
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'controller', m.controller, 'email', u.email, 'sleeper', u.sleeper_username,
    'avatar', m.avatar_url
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m left join app_user u on u.id = m.app_user_id where m.league_id = p_league_id;
  return result;
end $$;

-- admin_matchup_board (0020) + home_avatar / away_avatar.
create or replace function admin_matchup_board(p_matchup_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb; m matchup%rowtype; home_user uuid; away_user uuid;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('error', 'not found'); end if;
  select app_user_id into home_user from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id and enrolled = true limit 1;
  select app_user_id into away_user from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id and enrolled = true limit 1;

  select jsonb_build_object(
    'matchup', jsonb_build_object(
      'id', m.id, 'week', m.week, 'status', m.status,
      'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id,
      'home_final', m.home_final, 'away_final', m.away_final,
      'home_coin', m.home_coin, 'away_coin', m.away_coin, 'lock_at', m.lock_at),
    'home_team', (select team_name from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id limit 1),
    'away_team', (select team_name from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id limit 1),
    'home_avatar', (select avatar_url from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id limit 1),
    'away_avatar', (select avatar_url from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id limit 1),
    'states', coalesce((
      select jsonb_agg(jsonb_build_object(
          'game_window', ms.game_window, 'home_score', ms.home_score, 'away_score', ms.away_score,
          'slot_scores', coalesce(ms.slot_scores, '[]'::jsonb),
          'home_picks', coalesce((select jsonb_agg(jsonb_build_object('slug', sp.player_slug, 'metric', sp.metric_id) order by sp.roster_slot)
            from sealed_pick sp where sp.matchup_id = m.id and sp.game_window = ms.game_window and sp.app_user_id = home_user and sp.player_slug is not null), '[]'::jsonb),
          'away_picks', coalesce((select jsonb_agg(jsonb_build_object('slug', sp.player_slug, 'metric', sp.metric_id) order by sp.roster_slot)
            from sealed_pick sp where sp.matchup_id = m.id and sp.game_window = ms.game_window and sp.app_user_id = away_user and sp.player_slug is not null), '[]'::jsonb)
        ) order by ms.game_window)
      from matchup_state ms where ms.matchup_id = m.id), '[]'::jsonb),
    'updated_at', (select max(updated_at) from matchup_state where matchup_id = m.id)
  ) into result;
  return result;
end $$;

grant execute on function admin_league_members(uuid) to authenticated;
grant execute on function admin_matchup_board(uuid) to authenticated;
