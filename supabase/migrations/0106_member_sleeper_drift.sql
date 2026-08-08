-- 0106: flag seats whose occupant no longer matches the Sleeper roster owner.
--
-- Claimed rosters in a Sleeper-based league should mirror Sleeper's assignments,
-- but "refresh members" deliberately never unseats anyone (admin_upsert_memberships
-- only moves `enrolled` false→true), so drift is invisible: a manager who claimed
-- a team and then left the Sleeper league keeps showing as JOINED forever.
--
-- Rather than let a refresh silently clear member data, surface the drift and let
-- the commissioner act on it with the Members tab's ✕ unassign. This adds a
-- computed `drifted` flag to admin_league_members; nothing here writes.
--
-- A seat is drifted when ALL of:
--   • the league is Sleeper-backed — other providers don't key seats on
--     sleeper_user_id, so the comparison would be meaningless (and always true);
--   • somebody actually holds the seat;
--   • they were NOT placed by hand — admin_assign_roster / commish_claim_roster
--     both stamp claim_email, and those seats are intentionally independent of
--     Sleeper (the join-pool flow for players not on Sleeper, a commissioner
--     holding a spare team). Only redeem_invite claims leave claim_email null,
--     and those ARE the Sleeper-derived ones;
--   • their linked Sleeper account isn't this roster's current owner. `is
--     distinct from` so a null on either side counts: owner left the league
--     (owner null), roster changed hands (owner differs), account unlinked.
--
-- Body is otherwise verbatim from 0042.
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'controller', m.controller, 'email', u.email, 'sleeper', u.sleeper_username,
    'avatar', m.avatar_url, 'claim_email', m.claim_email,
    'drifted', (
      coalesce(l.provider, 'sleeper') = 'sleeper'
      and m.enrolled
      and m.claim_email is null
      and u.sleeper_user_id is distinct from m.sleeper_owner_id
    )
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m
    join league l on l.id = m.league_id
    left join app_user u on u.id = m.app_user_id
  where m.league_id = p_league_id;
  return result;
end $$;
grant execute on function admin_league_members(uuid) to authenticated;
