-- 0105: let a commissioner refresh their own league's member list.
--
-- 0010 relaxed admin_upsert_matchups and admin_upsert_lineups from is_admin()
-- to `is_admin() or is_league_commish()` — which is why the Setup tab's "sync
-- season" works on the commissioner dash. admin_upsert_memberships was left
-- behind at admin-only (0007), so a commissioner could re-pull the schedule but
-- not the roster/owner list: a manager who joined the Sleeper league after the
-- import stayed invisible until a super-admin re-imported.
--
-- Body is otherwise verbatim from 0007. The enrollment guards matter and are
-- unchanged: app_user_id keeps any existing link, and `enrolled` only ever goes
-- false→true, so re-running this never unseats somebody who already joined.
create or replace function admin_upsert_memberships(p_league_id uuid, p_members jsonb)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, team_name, app_user_id, enrolled)
  select p_league_id, (e->>'roster_id')::int, e->>'owner_id', e->>'team_name', au.id, au.id is not null
  from jsonb_array_elements(p_members) e
  left join app_user au on au.sleeper_user_id = e->>'owner_id'
  on conflict (league_id, sleeper_roster_id) do update set
    sleeper_owner_id = excluded.sleeper_owner_id,
    team_name = excluded.team_name,
    app_user_id = coalesce(league_membership.app_user_id, excluded.app_user_id),
    enrolled = (league_membership.enrolled or excluded.enrolled);
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_members));
end $$;
grant execute on function admin_upsert_memberships(uuid, jsonb) to authenticated;
