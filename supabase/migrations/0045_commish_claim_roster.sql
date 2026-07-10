-- 0045: a commissioner (or admin) enrolls THEMSELVES onto a roster in their own
-- league — so they can play one (or more) teams, not just manage. Uses auth.uid()
-- server-side (no client-supplied id), mirroring admin_assign_roster's enroll
-- path. The (league_id, sleeper_roster_id) uniqueness allows the same person to
-- hold several rosters, so calling this per roster claims multiple teams.
create or replace function commish_claim_roster(p_league_id uuid, p_roster_id int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare e text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);
  update league_membership set app_user_id = auth.uid(), enrolled = true, claim_email = e
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
  delete from league_join where league_id = p_league_id and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'status', 'enrolled');
end $$;
grant execute on function commish_claim_roster(uuid, int) to authenticated;
