-- 0033: include the team's avatar in the redeem preview so the onboarding
-- "confirm your team" step can show the team badge (e.g. the test league's logo).
create or replace function redeem_preview(p_code text, p_sleeper_user_id text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; mem league_membership%rowtype;
begin
  select * into lg from league where invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid code'); end if;
  select * into mem from league_membership where league_id = lg.id and sleeper_owner_id = p_sleeper_user_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'your Sleeper account is not a manager in this league'); end if;
  return jsonb_build_object('ok', true, 'league', lg.name, 'team', mem.team_name, 'avatar', mem.avatar_url);
end $$;
grant execute on function redeem_preview(text, text) to authenticated;
