-- 0239: THE SHELF — archive a league without leaving it.
--
-- Founder: "We also need the ability to archive leagues." Leaving a league
-- opens your seat to someone else; what a finished season needs is a shelf:
-- the league keeps you, your history and your seat, it just stops taking up
-- the top of your leagues list. Per-USER, deliberately — my dead league is
-- your live one.
--
--   • user_league_archive — one row per (user, league) on the shelf. RLS on,
--     no policies: set_league_archived is the only door, my_teams the only
--     read.
--   • set_league_archived(league, on) — any member (or the commissioner, who
--     may be seatless) shelves or unshelves for themselves.
--   • my_teams (respun from its 0185 body) carries `archived` per row, so
--     the leagues list can fold shelved leagues into a collapsed section.

create table if not exists user_league_archive (
  app_user_id uuid not null,
  league_id   uuid not null references league(id) on delete cascade,
  archived_at timestamptz not null default now(),
  primary key (app_user_id, league_id)
);
alter table user_league_archive enable row level security;

create or replace function set_league_archived(p_league_id uuid, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'not your league');
  end if;
  if coalesce(p_on, true) then
    insert into user_league_archive (app_user_id, league_id) values (auth.uid(), p_league_id)
    on conflict do nothing;
  else
    delete from user_league_archive where app_user_id = auth.uid() and league_id = p_league_id;
  end if;
  return jsonb_build_object('ok', true, 'archived', coalesce(p_on, true));
end $$;
grant execute on function set_league_archived(uuid, boolean) to authenticated;

create or replace function my_teams()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(r order by r -> 'league' ->> 'name'), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', m.league_id, 'team_name', m.team_name, 'sleeper_roster_id', m.sleeper_roster_id,
      'avatar_url', m.avatar_url, 'pick_user_id', m.app_user_id, 'comanager', (m.app_user_id <> auth.uid()),
      -- 0239: on the caller's shelf → the list folds it away
      'archived', exists (select 1 from user_league_archive a
                          where a.app_user_id = auth.uid() and a.league_id = m.league_id),
      'league', jsonb_build_object(
        'name', l.name, 'season', l.season, 'preseason_at', l.preseason_at, 'provider', l.provider,
        'avatar_url', l.avatar_url, 'is_mock', l.is_mock, 'kind', l.kind, 'contest_week', l.contest_week,
        'dynasty', league_is_dynasty(l.id),
        'continuity', league_continuity(l.id))
    ) as r
    from league_membership m
    join league l on l.id = m.league_id
    where m.enrolled and (
      m.app_user_id = auth.uid()
      or exists (select 1 from team_manager tm
                  where tm.league_id = m.league_id and tm.roster_id = m.sleeper_roster_id
                    and tm.app_user_id = auth.uid())
    )
  ) t;
  return result;
end $$;
