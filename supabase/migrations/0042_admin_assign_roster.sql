-- 0042: admin-mapped enrollment. Non-Sleeper leagues (ESPN/…) have no public user
-- id, so players can't self-claim a roster by username. Instead an admin or the
-- league commissioner assigns each roster to a person by email. If that email has
-- already signed in, we link + enroll immediately; otherwise we stash the email as
-- a pending claim that auto-links the next time they sign in (draft-night friendly).

alter table league_membership add column if not exists claim_email text;

-- Assign (or clear) a roster's owner by email. Admin or the league's commissioner.
create or replace function admin_assign_roster(p_league_id uuid, p_roster_id int, p_email text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid; e text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if e is null then
    update league_membership set app_user_id = null, enrolled = false, claim_email = null
      where league_id = p_league_id and sleeper_roster_id = p_roster_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
    return jsonb_build_object('ok', true, 'status', 'cleared');
  end if;
  select id into uid from app_user where lower(email) = e;
  update league_membership
    set claim_email = e,
        app_user_id = uid,                 -- null until they sign in (pending)
        enrolled = (uid is not null)
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
  return jsonb_build_object('ok', true, 'status', case when uid is not null then 'enrolled' else 'pending' end);
end $$;
grant execute on function admin_assign_roster(uuid, int, text) to authenticated;

-- Called after sign-in: claim any rosters pre-assigned to my email.
create or replace function claim_my_rosters()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare e text; n int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select lower(email) into e from app_user where id = auth.uid();
  if e is null then return jsonb_build_object('ok', true, 'claimed', 0); end if;
  update league_membership set app_user_id = auth.uid(), enrolled = true
    where lower(claim_email) = e and (app_user_id is null or app_user_id = auth.uid());
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'claimed', n);
end $$;
grant execute on function claim_my_rosters() to authenticated;

-- admin_league_members (0031) + claim_email, so the admin UI can show pending assigns.
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'controller', m.controller, 'email', u.email, 'sleeper', u.sleeper_username,
    'avatar', m.avatar_url, 'claim_email', m.claim_email
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m left join app_user u on u.id = m.app_user_id where m.league_id = p_league_id;
  return result;
end $$;
grant execute on function admin_league_members(uuid) to authenticated;
