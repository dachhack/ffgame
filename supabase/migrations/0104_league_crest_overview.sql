-- 0104: surface the league crest on the admin/commish overviews, so the admin
-- console can show it and offer a picker.
--
-- The writer already exists and is provider-agnostic: set_league_avatar (0066)
-- gates on `is_admin() or is_league_commish()` with no native-only check, so it
-- has always worked for imported Sleeper/ESPN leagues too. What was missing is
-- the READ — neither overview returned league.avatar_url, so the console had no
-- current value to render and no way to show what a change did. Only the native
-- league screen (which reads avatar_url via native_team_state) could pick one,
-- which left imported leagues stuck with whatever the import chose.
--
-- Bodies are otherwise verbatim from the previous definitions (admin_overview
-- from 0054, commish_overview from 0052) with 'avatar_url' added.

create or replace function admin_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider, 'avatar_url', l.avatar_url,
      'commish_code', l.commish_code, 'invite_code', l.invite_code,
      'commissioner', l.commissioner_id is not null, 'lineup_policy', l.lineup_policy,
      'weekly_budget', l.weekly_budget,
      'test_live_at', l.test_live_at,
      'preseason_at', l.preseason_at,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function admin_overview() to authenticated;

create or replace function commish_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider, 'avatar_url', l.avatar_url,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true, 'lineup_policy', l.lineup_policy,
      'weekly_budget', l.weekly_budget,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l where l.commissioner_id = auth.uid() order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function commish_overview() to authenticated;
