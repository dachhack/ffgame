-- 0028: K/DST fill for leagues that don't roster kickers and/or team defenses.
-- Without a K or DST in the pool the Banker (K) and Suppress/Earn (DEF) metrics
-- are unplayable. A league's commissioner picks a fill mode; the worker injects a
-- team-keyed K/DST slug ('<team>-k' / '<team>-dst') into each roster's synced
-- lineup at sync time (see server/src/sync.js + src/data/kdst.ts). Sleeper
-- standings/scores are untouched — this only enriches the drip lineup pool.
--   off    — do nothing (default)
--   random — a deterministic not-on-bye pick, re-rolled each week
--   manual — a season-long per-team assignment (team_kdst), auto-substituted on
--            the assigned team's bye week

alter table league add column if not exists kdst_mode text not null default 'off'
  check (kdst_mode in ('off', 'random', 'manual'));

-- Season-long manual assignment per team (mode='manual'). Slugs are '<team>-k' /
-- '<team>-dst'; either may be null (fall back to a random not-on-bye pick).
create table if not exists team_kdst (
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  k_slug     text,
  dst_slug   text,
  updated_at timestamptz not null default now(),
  primary key (league_id, roster_id)
);

-- Reads: any enrolled member of the league (drives the commissioner UI). No write
-- policy — only the service-role worker and the SECURITY DEFINER RPCs below mutate.
alter table team_kdst enable row level security;
create policy team_kdst_read on team_kdst for select using (
  exists (select 1 from league_membership lm where lm.league_id = team_kdst.league_id and lm.app_user_id = auth.uid())
);

-- Set a league's K/DST fill mode. Admin or the league commissioner.
create or replace function set_kdst_mode(p_league_id uuid, p_mode text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if p_mode not in ('off', 'random', 'manual') then return jsonb_build_object('ok', false, 'error', 'bad mode'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update league set kdst_mode = p_mode where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no league'); end if;
  return jsonb_build_object('ok', true, 'mode', p_mode);
end $$;

-- Set (or clear, with nulls) one team's manual K/DST. Admin or commissioner.
create or replace function set_team_kdst(p_league_id uuid, p_roster_id int, p_k_slug text, p_dst_slug text)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  insert into team_kdst (league_id, roster_id, k_slug, dst_slug)
    values (p_league_id, p_roster_id, nullif(p_k_slug, ''), nullif(p_dst_slug, ''))
  on conflict (league_id, roster_id) do update
    set k_slug = nullif(p_k_slug, ''), dst_slug = nullif(p_dst_slug, ''), updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- The league's fill mode + which positions it's missing (from Sleeper
-- roster_positions) + each team's manual assignment — drives the commissioner UI.
create or replace function league_kdst(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rp jsonb; result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(settings_json->'roster_positions', '[]'::jsonb) into rp from league where id = p_league_id;
  select jsonb_build_object(
    'mode', (select kdst_mode from league where id = p_league_id),
    'needs_k', not (rp ? 'K'),
    'needs_def', not (rp ? 'DEF'),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object(
        'roster_id', m.sleeper_roster_id, 'team', m.team_name,
        'k_slug', tk.k_slug, 'dst_slug', tk.dst_slug
      ) order by m.sleeper_roster_id), '[]'::jsonb)
      from league_membership m
      left join team_kdst tk on tk.league_id = m.league_id and tk.roster_id = m.sleeper_roster_id
      where m.league_id = p_league_id)
  ) into result;
  return result;
end $$;

grant execute on function set_kdst_mode(uuid, text) to authenticated;
grant execute on function set_team_kdst(uuid, int, text, text) to authenticated;
grant execute on function league_kdst(uuid) to authenticated;
