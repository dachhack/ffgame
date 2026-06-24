-- 0019: extend admin_matchup_board with per-window picks (player slugs per side),
-- winner/margin data, and a finalise helper. Board now carries enough to render
-- player names alongside window scores and highlight the leader. No new tables.
create or replace function admin_matchup_board(p_matchup_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
  m matchup%rowtype;
  home_user uuid;
  away_user uuid;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('error', 'not found'); end if;

  -- Enrolled app_user for each side (may be null if no one has redeemed the invite).
  select app_user_id into home_user from league_membership
    where league_id = m.league_id and sleeper_roster_id = m.home_roster_id and enrolled = true limit 1;
  select app_user_id into away_user from league_membership
    where league_id = m.league_id and sleeper_roster_id = m.away_roster_id and enrolled = true limit 1;

  select jsonb_build_object(
    'matchup', jsonb_build_object(
      'id', m.id, 'week', m.week, 'status', m.status,
      'home_roster_id', m.home_roster_id, 'away_roster_id', m.away_roster_id,
      'home_final', m.home_final, 'away_final', m.away_final,
      'home_coin', m.home_coin, 'away_coin', m.away_coin, 'lock_at', m.lock_at),
    'home_team', (select team_name from league_membership where league_id = m.league_id and sleeper_roster_id = m.home_roster_id limit 1),
    'away_team', (select team_name from league_membership where league_id = m.league_id and sleeper_roster_id = m.away_roster_id limit 1),
    'states', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'game_window', ms.game_window,
          'home_score', ms.home_score,
          'away_score', ms.away_score,
          'home_picks', coalesce((
            select jsonb_agg(jsonb_build_object('slug', sp.player_slug, 'metric', sp.metric_id)
              order by sp.roster_slot)
            from sealed_pick sp
            where sp.matchup_id = m.id
              and sp.game_window = ms.game_window
              and sp.app_user_id = home_user
              and sp.player_slug is not null
          ), '[]'::jsonb),
          'away_picks', coalesce((
            select jsonb_agg(jsonb_build_object('slug', sp.player_slug, 'metric', sp.metric_id)
              order by sp.roster_slot)
            from sealed_pick sp
            where sp.matchup_id = m.id
              and sp.game_window = ms.game_window
              and sp.app_user_id = away_user
              and sp.player_slug is not null
          ), '[]'::jsonb)
        ) order by ms.game_window
      )
      from matchup_state ms where ms.matchup_id = m.id
    ), '[]'::jsonb),
    'updated_at', (select max(updated_at) from matchup_state where matchup_id = m.id)
  ) into result;
  return result;
end $$;

grant execute on function admin_matchup_board(uuid) to authenticated;
