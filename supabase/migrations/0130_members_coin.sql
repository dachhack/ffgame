-- 0130: admin_league_members carries each team's drip-coin balance.
--
-- The commissioner's teams screen (app ⚑ COMMISH tab, web console members) has
-- a grant/dock lever per seat but showed no balance — adjusting coin blind, or
-- cross-referencing the shop/board to learn what a team holds. The wallet is
-- team-keyed (team_wallet, 0025) and this RPC is already the commissioner's
-- per-seat read, so the balance belongs on the row.
--
-- 'coin' is coalesced to 0: a wallet row is only minted on first credit, and a
-- team that never earned is a zero balance, not an unknown one.
--
-- Body is otherwise verbatim from 0106 (claim_email + drifted intact).
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'controller', m.controller, 'email', u.email, 'sleeper', u.sleeper_username,
    'avatar', m.avatar_url, 'claim_email', m.claim_email,
    'coin', coalesce(w.coins, 0),
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
    left join team_wallet w on w.league_id = m.league_id and w.roster_id = m.sleeper_roster_id
  where m.league_id = p_league_id;
  return result;
end $$;
grant execute on function admin_league_members(uuid) to authenticated;
