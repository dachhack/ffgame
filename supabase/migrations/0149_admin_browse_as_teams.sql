-- 0149: browse-as shows the ADMIN's teams — the 0125 regression.
--
-- The browse-as design (0108/0109) reads the VIEWED user's data through
-- admin-gated twins wherever a player-path RPC keys on auth.uid():
-- commish_overview → admin_user_commish_leagues, my_features →
-- admin_user_features. Enrollments needed no twin back then — the client read
-- league_membership directly with the viewed user's id, and 0108's widened
-- SELECT policies resolved it.
--
-- 0125 (team managers) moved the client onto my_teams(), which keys on
-- auth.uid() — and the viewed-user id the client still passed was silently
-- dropped. From that day, "BROWSING AS x" rendered the banner, x's feature
-- gates, x's commissioner cards… and the ADMIN's own league cards (the
-- founder's screenshot). The missing twin:

create or replace function admin_user_teams(p_app_user_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  -- my_teams()'s body with p_app_user_id where auth.uid() reads — including
  -- the team_manager arm, so a co-managed seat shows in their browse-as too.
  select coalesce(jsonb_agg(r order by r -> 'league' ->> 'name'), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', m.league_id, 'team_name', m.team_name, 'sleeper_roster_id', m.sleeper_roster_id,
      'avatar_url', m.avatar_url, 'pick_user_id', m.app_user_id, 'comanager', (m.app_user_id <> p_app_user_id),
      'league', jsonb_build_object(
        'name', l.name, 'season', l.season, 'preseason_at', l.preseason_at, 'provider', l.provider,
        'avatar_url', l.avatar_url, 'is_mock', l.is_mock, 'kind', l.kind, 'contest_week', l.contest_week)
    ) as r
    from league_membership m
    join league l on l.id = m.league_id
    where m.enrolled and (
      m.app_user_id = p_app_user_id
      or exists (select 1 from team_manager tm
                  where tm.league_id = m.league_id and tm.roster_id = m.sleeper_roster_id
                    and tm.app_user_id = p_app_user_id)
    )
  ) t;
  return result;
end $$;
grant execute on function admin_user_teams(uuid) to authenticated;

-- Same class of leak, smaller surface: my_waitlist() during browse-as shows
-- the ADMIN's waiting-room rows. The twin, for support cases like "it says
-- I'm waitlisted" seen through the user's own eyes.
create or replace function admin_user_waitlist(p_app_user_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'league_id', j.league_id, 'name', l.name, 'season', l.season,
      'avatar_url', l.avatar_url, 'joined_at', j.created_at)
    order by j.created_at desc), '[]'::jsonb) into result
  from league_join j join league l on l.id = j.league_id
  where j.app_user_id = p_app_user_id
    and not exists (select 1 from league_membership m
                     where m.league_id = j.league_id and m.app_user_id = p_app_user_id and m.enrolled);
  return result;
end $$;
grant execute on function admin_user_waitlist(uuid) to authenticated;
