-- 0238: WHO OWNS THE TEAM — chat_members learns the seat map.
--
-- Founder: "teams and rosters should show the name of the league member who
-- owns each team and allow you to message that member or initiate a trade."
-- The member list (id + display name) already existed for the chat's DM
-- picker; what no member-facing read carried was the roster → owner join.
-- chat_members now also answers `seats`: [{roster, user}] for every claimed
-- seat, so 👥 Teams & rosters can print the owner under the team name and
-- hand the same ids to 💬 MESSAGE and ⇄ TRADE.
--
-- LINEAGE: chat_members respun from its 0147 body (its only prior).

create or replace function chat_members(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); out jsonb; seats jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', u_id, 'name', _chat_display_name(p_league_id, u_id), 'me', u_id = me)
           order by _chat_display_name(p_league_id, u_id)), '[]'::jsonb)
    into out from (
      select distinct u_id from (
        select lm.app_user_id as u_id from league_membership lm
          where lm.league_id = p_league_id and lm.app_user_id is not null
        union
        select tm.app_user_id from team_manager tm where tm.league_id = p_league_id
        union
        select l.commissioner_id from league l where l.id = p_league_id and l.commissioner_id is not null
      ) uu where u_id is not null
    ) s;
  -- 0238: the seat map — which member OWNS each roster (co-managers are in
  -- `members` for messaging, but the seat speaks with its owner's name).
  select coalesce(jsonb_agg(jsonb_build_object(
           'roster', lm.sleeper_roster_id, 'user', lm.app_user_id)
           order by lm.sleeper_roster_id), '[]'::jsonb)
    into seats from league_membership lm
    where lm.league_id = p_league_id and lm.app_user_id is not null;
  return jsonb_build_object('ok', true, 'members', out, 'seats', seats);
end $$;
