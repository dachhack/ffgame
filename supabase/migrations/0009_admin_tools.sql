-- 0009: more admin tools — membership detail + code regeneration.

-- Who's in a league, per roster, with enrollment + linked-account detail.
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'email', u.email, 'sleeper', u.sleeper_username
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m left join app_user u on u.id = m.app_user_id
  where m.league_id = p_league_id;
  return result;
end $$;

-- Rotate a leaked code. p_which ∈ 'invite' | 'commish'. Returns the new code.
create or replace function admin_regen_code(p_league_id uuid, p_which text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare nc text;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  nc := gen_invite_code();
  if p_which = 'invite' then update league set invite_code = nc where id = p_league_id;
  elsif p_which = 'commish' then update league set commish_code = nc where id = p_league_id;
  else return jsonb_build_object('ok', false, 'error', 'bad which'); end if;
  return jsonb_build_object('ok', true, 'code', nc);
end $$;

grant execute on function admin_league_members(uuid) to authenticated;
grant execute on function admin_regen_code(uuid, text) to authenticated;
