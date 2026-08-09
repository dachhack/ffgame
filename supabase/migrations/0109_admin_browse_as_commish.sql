-- 0109: fix "browse as" showing the ADMIN's leagues instead of the user's.
--
-- The leagues page renders from two sources: myEnrollments(userId), which 0108
-- already routes to the viewed user, and commish_overview(), which is
-- `where l.commissioner_id = auth.uid()` and therefore always the admin's own
-- leagues. An admin who commissions leagues saw their own commissioner cards
-- while browsing as somebody else — the reported symptom.
--
-- Same for my_features(): it reads the caller's row, so a browse-as session was
-- gated by the ADMIN's feature flags rather than the user's.
--
-- Both are per-caller by design and shouldn't change. These are admin-gated
-- twins that take the user explicitly. Read-only, like everything in the
-- browse-as path.

-- commish_overview() for an arbitrary user. Body mirrors the 0052 definition;
-- only the identity source differs (parameter instead of auth.uid()).
create or replace function admin_user_commish_leagues(p_app_user_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'provider', l.provider, 'avatar_url', l.avatar_url,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true,
      'lineup_policy', l.lineup_policy, 'weekly_budget', l.weekly_budget,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l where l.commissioner_id = p_app_user_id order by l.created_at desc
  ) t;
  return result;
end $$;
grant execute on function admin_user_commish_leagues(uuid) to authenticated;

-- my_features() for an arbitrary user, so the browse-as UI gates on THEIR flags.
create or replace function admin_user_features(p_app_user_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  return coalesce((select features from app_user where id = p_app_user_id), '{}'::jsonb);
end $$;
grant execute on function admin_user_features(uuid) to authenticated;
