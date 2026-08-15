-- 0151: LEAGUE PRESENCE — when did each member last open the league.
--
-- The commissioner's "is anyone actually here?" question, one week before
-- lineups start mattering. The client touches this table when a member OPENS
-- a league (the hub landing / the board — not the league list, whose badge
-- polls run without anyone looking), and the commissioner reads a per-member
-- last-seen list from their dashboard.
--
-- One row per (league, member), RPC-only (deny-all RLS):
--   • league_touch — the member's own upsert, fired on open. Not a member →
--     a silent no-op that still answers ok: the client fires this blind on
--     every league open and an admin browsing a league they're not in must
--     neither error nor fake presence.
--   • league_last_seen — commissioner/admin only. Every member (the chat
--     union: membership + team managers + the commissioner), display name,
--     and last_at (null = never opened).

create table league_seen (
  league_id    uuid not null references league(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  last_at      timestamptz not null default now(),
  primary key (league_id, app_user_id)
);
alter table league_seen enable row level security;   -- no policies: RPC-only

create or replace function league_touch(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', true, 'seen', false);
  end if;
  insert into league_seen (league_id, app_user_id) values (p_league_id, auth.uid())
    on conflict (league_id, app_user_id) do update set last_at = now();
  return jsonb_build_object('ok', true, 'seen', true);
end $$;

create or replace function league_last_seen(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'commissioner only');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.u_id,
           'name', _chat_display_name(p_league_id, s.u_id),
           'last_at', ls.last_at)
           order by ls.last_at desc nulls last, _chat_display_name(p_league_id, s.u_id)), '[]'::jsonb)
    into out
    from (
      select distinct u_id from (
        select lm.app_user_id as u_id from league_membership lm
          where lm.league_id = p_league_id and lm.app_user_id is not null
        union
        select tm.app_user_id from team_manager tm where tm.league_id = p_league_id
        union
        select l.commissioner_id from league l where l.id = p_league_id and l.commissioner_id is not null
      ) uu where u_id is not null
    ) s
    left join league_seen ls on ls.league_id = p_league_id and ls.app_user_id = s.u_id;
  return jsonb_build_object('ok', true, 'members', out);
end $$;

grant execute on function league_touch(uuid) to authenticated;
grant execute on function league_last_seen(uuid) to authenticated;
