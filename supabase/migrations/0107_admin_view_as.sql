-- 0107: read-only "view as" — everything a given user sees, for support + QA.
--
-- The player-facing surfaces read through RLS (membership_read and lineup_read
-- are is_league_member(); sealed_select hides a pick until the server locks it),
-- so an admin outside a league can't reach a user's enrollments or unlocked
-- picks through the tables. This gathers the same picture in one SECURITY
-- DEFINER read, gated on is_admin().
--
-- Deliberately READ-ONLY: nothing here writes, and there is no session minting.
-- An admin looking at this is still themselves at the database level — the point
-- is to see what a user sees without acquiring the ability to act as them.
-- Because it can expose an opponent's UNLOCKED sealed picks (sealed_select would
-- not), it is is_admin() only — a league commissioner must not have it, or a
-- commissioner who plays in their own league could read their opponent's lineup
-- before kickoff.
create or replace function admin_user_state(p_app_user_id uuid, p_week int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb; u app_user%rowtype;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select * into u from app_user where id = p_app_user_id;
  if not found then return jsonb_build_object('error', 'no such user'); end if;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id, 'email', u.email,
      'sleeper_username', u.sleeper_username, 'sleeper_user_id', u.sleeper_user_id,
      'created_at', u.created_at
    ),
    'week', p_week,
    'leagues', coalesce((
      select jsonb_agg(jsonb_build_object(
        'league_id', l.id, 'name', l.name, 'season', l.season,
        'provider', coalesce(l.provider, 'sleeper'), 'avatar_url', l.avatar_url,
        'roster_id', m.sleeper_roster_id, 'team_name', m.team_name,
        'team_avatar', m.avatar_url, 'controller', m.controller,
        'is_commish', (l.commissioner_id = p_app_user_id),
        -- How many players they can actually pick from this week. 0 or null is
        -- the usual "why can't I set a lineup" answer (pre-draft, or no sync).
        'pool_size', (
          select jsonb_array_length(sl.starters_json) from sleeper_lineup sl
          where sl.league_id = l.id and sl.week = p_week and sl.roster_id = m.sleeper_roster_id
        ),
        'matchup', (
          select jsonb_build_object(
            'id', mu.id, 'status', mu.status, 'lock_at', mu.lock_at,
            'opponent', (
              select om.team_name from league_membership om
              where om.league_id = l.id and om.sleeper_roster_id =
                case when mu.home_roster_id = m.sleeper_roster_id then mu.away_roster_id else mu.home_roster_id end
            ),
            'picks', coalesce((
              select jsonb_agg(jsonb_build_object(
                'game_window', sp.game_window, 'roster_slot', sp.roster_slot,
                'player_slug', sp.player_slug, 'metric_id', sp.metric_id, 'locked', sp.locked
              ) order by sp.game_window, sp.roster_slot)
              from sealed_pick sp where sp.matchup_id = mu.id and sp.app_user_id = p_app_user_id
            ), '[]'::jsonb)
          )
          from matchup mu
          where mu.league_id = l.id and mu.week = p_week
            and (mu.home_roster_id = m.sleeper_roster_id or mu.away_roster_id = m.sleeper_roster_id)
          limit 1
        )
      ) order by l.created_at desc)
      from league_membership m join league l on l.id = m.league_id
      where m.app_user_id = p_app_user_id and m.enrolled
    ), '[]'::jsonb)
  ) into result;
  return result;
end $$;
grant execute on function admin_user_state(uuid, int) to authenticated;
