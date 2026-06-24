-- 0022: AI-controlled teams + auto-lineup policy.
--   • league_membership.controller: 'human' (default) | 'ai' — season-long. Set by
--     the team's own manager (self), the league commissioner, or an admin.
--   • league.lineup_policy: what to do when an enrolled human submits no picks by
--     lock — 'best_lineup' (auto-fill, stay human, default) | 'ai' (flip to AI for
--     the week) | 'empty' (leave them).
-- Surfaces both in the admin/commish views so the UI can show 🤖 chips + toggles.

alter table league_membership add column if not exists controller text not null default 'human'
  check (controller in ('human', 'ai'));
alter table league_membership add column if not exists controller_set_by uuid;
alter table league_membership add column if not exists controller_set_at timestamptz;

alter table league add column if not exists lineup_policy text not null default 'best_lineup'
  check (lineup_policy in ('best_lineup', 'ai', 'empty'));

-- Set a team's controller. Allowed: admin, the league commissioner, or the
-- manager of that very team (self-serve season-long auto-pilot).
create or replace function set_team_controller(p_league_id uuid, p_roster_id int, p_controller text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare is_self boolean;
begin
  if p_controller not in ('human', 'ai') then return jsonb_build_object('ok', false, 'error', 'bad controller'); end if;
  select exists (select 1 from league_membership where league_id = p_league_id and sleeper_roster_id = p_roster_id and app_user_id = auth.uid())
    into is_self;
  if not (is_admin() or is_league_commish(p_league_id) or is_self) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update league_membership set controller = p_controller, controller_set_by = auth.uid(), controller_set_at = now()
    where league_id = p_league_id and sleeper_roster_id = p_roster_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no team'); end if;
  return jsonb_build_object('ok', true, 'controller', p_controller);
end $$;

create or replace function set_lineup_policy(p_league_id uuid, p_policy text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_policy not in ('best_lineup', 'ai', 'empty') then return jsonb_build_object('ok', false, 'error', 'bad policy'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update league set lineup_policy = p_policy where id = p_league_id;
  return jsonb_build_object('ok', true, 'lineup_policy', p_policy);
end $$;

-- The caller's own membership row (for the self toggle in LivePicks).
create or replace function my_membership(p_league_id uuid, p_roster_id int)
  returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('controller', controller)
  from league_membership where league_id = p_league_id and sleeper_roster_id = p_roster_id and app_user_id = auth.uid() limit 1;
$$;

-- ── Re-surface controller / lineup_policy in existing views ──────────────────────

-- admin_pick_side (0021) + controller.
create or replace function admin_pick_side(p_matchup uuid, p_league uuid, p_roster int, p_week int)
  returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'roster_id', p_roster,
    'team', (select team_name from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1),
    'app_user_id', (select app_user_id from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1),
    'enrolled', coalesce((select enrolled from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1), false),
    'controller', coalesce((select controller from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1), 'human'),
    'email', (select u.email from league_membership mm join app_user u on u.id = mm.app_user_id where mm.league_id = p_league and mm.sleeper_roster_id = p_roster limit 1),
    'sleeper', (select u.sleeper_username from league_membership mm join app_user u on u.id = mm.app_user_id where mm.league_id = p_league and mm.sleeper_roster_id = p_roster limit 1),
    'lineup_size', coalesce((select jsonb_array_length(starters_json) from sleeper_lineup where league_id = p_league and week = p_week and roster_id = p_roster), 0),
    'picks_set', coalesce((select count(*) from sealed_pick sp where sp.matchup_id = p_matchup and sp.player_slug is not null
        and sp.app_user_id = (select app_user_id from league_membership where league_id = p_league and sleeper_roster_id = p_roster limit 1)), 0)
  );
$$;

-- admin_league_members (0010) + controller.
create or replace function admin_league_members(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'roster_id', m.sleeper_roster_id, 'team', m.team_name, 'owner', m.sleeper_owner_id,
    'enrolled', m.enrolled, 'controller', m.controller, 'email', u.email, 'sleeper', u.sleeper_username
  ) order by m.sleeper_roster_id), '[]'::jsonb) into result
  from league_membership m left join app_user u on u.id = m.app_user_id where m.league_id = p_league_id;
  return result;
end $$;

-- admin_overview (0007) + lineup_policy + ai team count.
create or replace function admin_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'commish_code', l.commish_code, 'invite_code', l.invite_code,
      'commissioner', l.commissioner_id is not null, 'lineup_policy', l.lineup_policy,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l order by l.created_at desc
  ) t;
  return result;
end $$;

-- commish_overview (0010) + lineup_policy.
create or replace function commish_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'sleeper_league_id', l.sleeper_league_id, 'name', l.name, 'season', l.season,
      'commish_code', l.commish_code, 'invite_code', l.invite_code, 'commissioner', true, 'lineup_policy', l.lineup_policy,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled),
      'ai_teams', (select count(*) from league_membership m where m.league_id = l.id and m.controller = 'ai')
    ) as r from league l where l.commissioner_id = auth.uid() order by l.created_at desc
  ) t;
  return result;
end $$;

grant execute on function set_team_controller(uuid, int, text) to authenticated;
grant execute on function set_lineup_policy(uuid, text) to authenticated;
grant execute on function my_membership(uuid, int) to authenticated;
