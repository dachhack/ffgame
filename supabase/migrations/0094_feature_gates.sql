-- 0094: ACCESS MODEL for standalone + DFS play.
--
-- Standalone (solo) pods/showdowns stop being public: they're a per-account
-- FEATURE the pilot owner turns on (app_user.features, admin_set_feature).
-- DFS leagues become COMMISSIONER-RUN: an owner-approved commissioner
-- (features 'dfs_commish') creates a private DFS league (kind='dfs' — same
-- salary-board/builder machinery as pods) and distributes its invite code;
-- joining by invite needs no feature flag — the invite IS the access.
-- Admins bypass every gate so the owner can always test.

alter table app_user add column if not exists features jsonb not null default '{}'::jsonb;

/** The caller's feature flags (presence of a key = on). */
create or replace function my_features() returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce((select features from app_user where id = auth.uid()), '{}'::jsonb);
$$;
grant execute on function my_features() to authenticated;

/** Owner-only: flip a feature for an account by email. Known flags:
 *  'solo' (standalone pods/showdowns) · 'dfs_commish' (may create DFS leagues). */
create or replace function admin_set_feature(p_email text, p_feature text, p_on boolean)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_feature not in ('solo', 'dfs_commish') then
    return jsonb_build_object('ok', false, 'error', 'unknown feature');
  end if;
  select id into uid from app_user where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'no account with that email (they must sign in once first)');
  end if;
  update app_user set features = case when p_on
      then features || jsonb_build_object(p_feature, true)
      else features - p_feature end
    where id = uid;
  return jsonb_build_object('ok', true, 'email', lower(trim(p_email)), 'feature', p_feature, 'on', p_on);
end $$;
grant execute on function admin_set_feature(text, text, boolean) to authenticated;

/** True when the caller may use standalone (solo) play. */
create or replace function has_solo() returns boolean
  language sql stable security definer set search_path = public as $$
  select is_admin() or coalesce((select features ? 'solo' from app_user where id = auth.uid()), false);
$$;

-- ── Gate the public solo joins ───────────────────────────────────────────────
create or replace function join_pod(p_team_name text default null, p_season text default '2026')
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  seat league_membership%rowtype;
  lg   league%rowtype;
  pod_id uuid;
  names text[] := array['Bench Warmers','Hail Mary Hopefuls','Red Zone Regulars','Two Minute Drill','Garbage Time Gang','Coin Flip Crew'];
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if not has_solo() then
    return jsonb_build_object('ok', false, 'error', 'Solo play is invite-only right now.');
  end if;

  select m.* into seat from league_membership m
    join league l on l.id = m.league_id
    where m.app_user_id = auth.uid() and m.enrolled and l.kind = 'pod' and l.season = p_season
    limit 1;
  if found then
    select * into lg from league where id = seat.league_id;
    return jsonb_build_object('ok', true, 'already', true,
      'league_id', seat.league_id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id, 'team', seat.team_name);
  end if;

  select m.* into seat from league_membership m
    join league l on l.id = m.league_id
    where l.kind = 'pod' and l.season = p_season and m.app_user_id is null
    order by l.created_at, m.sleeper_roster_id
    limit 1
    for update of m skip locked;

  if not found then
    insert into league (sleeper_league_id, season, name, kind, kdst_mode, provider, lineup_policy)
      values ('POD-' || upper(left(md5(gen_random_uuid()::text), 8)), p_season,
              'Public Pod ' || upper(left(md5(gen_random_uuid()::text), 4)), 'pod', 'off', 'pod', 'ai')
      returning id into pod_id;
    for i in 1..6 loop
      insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
        values (pod_id, i, 'POD-AI-' || i, null, false, names[i], 'ai');
    end loop;
    select m.* into seat from league_membership m
      where m.league_id = pod_id and m.sleeper_roster_id = 1 for update;
  end if;

  update league_membership
    set app_user_id = auth.uid(), enrolled = true, controller = 'human',
        team_name = coalesce(nullif(trim(p_team_name), ''), team_name)
    where id = seat.id;

  select * into lg from league where id = seat.league_id;
  return jsonb_build_object('ok', true,
    'league_id', seat.league_id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id,
    'team', coalesce(nullif(trim(p_team_name), ''), seat.team_name));
end $$;

create or replace function join_weekly(p_team_name text default null, p_season text default '2026')
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  seat league_membership%rowtype;
  lg   league%rowtype;
  pod_id uuid;
  wk   int;
  names text[] := array['Bench Warmers','Hail Mary Hopefuls','Red Zone Regulars','Two Minute Drill','Garbage Time Gang','Coin Flip Crew'];
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if not has_solo() then
    return jsonb_build_object('ok', false, 'error', 'Solo play is invite-only right now.');
  end if;

  select week into wk from nfl_slate
    where season = p_season and kickoff is not null
    group by week
    having max(kickoff) + interval '4 hours' > now()
    order by min(kickoff)
    limit 1;
  if wk is null then
    return jsonb_build_object('ok', false, 'error', 'no upcoming NFL week on the slate');
  end if;

  select m.* into seat from league_membership m
    join league l on l.id = m.league_id
    where m.app_user_id = auth.uid() and m.enrolled
      and l.kind = 'weekly' and l.season = p_season and l.contest_week = wk
    limit 1;
  if found then
    select * into lg from league where id = seat.league_id;
    return jsonb_build_object('ok', true, 'already', true, 'week', wk,
      'league_id', seat.league_id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id, 'team', seat.team_name);
  end if;

  select m.* into seat from league_membership m
    join league l on l.id = m.league_id
    where l.kind = 'weekly' and l.season = p_season and l.contest_week = wk and m.app_user_id is null
    order by l.created_at, m.sleeper_roster_id
    limit 1
    for update of m skip locked;

  if not found then
    insert into league (sleeper_league_id, season, name, kind, contest_week, kdst_mode, provider, lineup_policy)
      values ('WKLY-' || upper(left(md5(gen_random_uuid()::text), 8)), p_season,
              'Week ' || wk || ' Showdown ' || upper(left(md5(gen_random_uuid()::text), 4)),
              'weekly', wk, 'off', 'pod', 'ai')
      returning id into pod_id;
    for i in 1..6 loop
      insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
        values (pod_id, i, 'WKLY-AI-' || i, null, false, names[i], 'ai');
    end loop;
    select m.* into seat from league_membership m
      where m.league_id = pod_id and m.sleeper_roster_id = 1 for update;
  end if;

  update league_membership
    set app_user_id = auth.uid(), enrolled = true, controller = 'human',
        team_name = coalesce(nullif(trim(p_team_name), ''), team_name)
    where id = seat.id;

  select * into lg from league where id = seat.league_id;
  return jsonb_build_object('ok', true, 'week', wk,
    'league_id', seat.league_id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id,
    'team', coalesce(nullif(trim(p_team_name), ''), seat.team_name));
end $$;

-- ── Commissioner-run DFS leagues (kind='dfs') ────────────────────────────────
alter table league drop constraint if exists league_kind_check;
alter table league add constraint league_kind_check check (kind in ('league', 'pod', 'weekly', 'dfs'));

/** Approved commissioners only: found a private DFS league. Seats fill from
 *  the returned invite code (join_dfs); unclaimed seats stay AI. */
create or replace function create_dfs_league(p_name text, p_teams int default 6, p_team_name text default null, p_season text default '2026')
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  lg    league%rowtype;
  dfs_id uuid;
  names text[] := array['Bench Warmers','Hail Mary Hopefuls','Red Zone Regulars','Two Minute Drill','Garbage Time Gang','Coin Flip Crew',
                        'Punt Return Party','Blitz Brigade','Fourth And Long','Snap Count Crew','End Around Gang','Mud Dogs'];
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;
  if not (is_admin() or coalesce((select features ? 'dfs_commish' from app_user where id = auth.uid()), false)) then
    return jsonb_build_object('ok', false, 'error', 'DFS leagues are run by approved commissioners — ask the pilot owner for access.');
  end if;
  if p_teams is null or p_teams < 2 or p_teams > 12 or p_teams % 2 <> 0 then
    return jsonb_build_object('ok', false, 'error', 'team count must be even, 2–12');
  end if;

  insert into league (sleeper_league_id, season, name, kind, kdst_mode, provider, lineup_policy, commissioner_id)
    values ('DFS-' || upper(left(md5(gen_random_uuid()::text), 8)), p_season,
            coalesce(nullif(trim(p_name), ''), 'DFS League ' || upper(left(md5(gen_random_uuid()::text), 4))),
            'dfs', 'off', 'pod', 'ai', auth.uid())
    returning id into dfs_id;
  for i in 1..p_teams loop
    insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, app_user_id, enrolled, team_name, controller)
      values (dfs_id, i, 'DFS-AI-' || i, null, false, names[1 + ((i - 1) % 12)], 'ai');
  end loop;
  -- The commissioner takes seat 1.
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, controller = 'human',
        team_name = coalesce(nullif(trim(p_team_name), ''), team_name)
    where league_id = dfs_id and sleeper_roster_id = 1;

  select * into lg from league where id = dfs_id;
  return jsonb_build_object('ok', true, 'league_id', dfs_id, 'league', lg.name,
    'invite_code', lg.invite_code, 'roster_id', 1,
    'team', coalesce(nullif(trim(p_team_name), ''), names[1]));
end $$;
grant execute on function create_dfs_league(text, int, text, text) to authenticated;

/** Join a commissioner's DFS league by invite code. The invite IS the access —
 *  no feature flag needed. Idempotent per league. */
create or replace function join_dfs(p_code text, p_team_name text default null)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  seat league_membership%rowtype;
  lg   league%rowtype;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into lg from league where invite_code = upper(trim(p_code)) and kind = 'dfs';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid DFS invite code');
  end if;

  select m.* into seat from league_membership m
    where m.league_id = lg.id and m.app_user_id = auth.uid() and m.enrolled
    limit 1;
  if found then
    return jsonb_build_object('ok', true, 'already', true,
      'league_id', lg.id, 'league', lg.name, 'roster_id', seat.sleeper_roster_id, 'team', seat.team_name);
  end if;

  select m.* into seat from league_membership m
    where m.league_id = lg.id and m.app_user_id is null
    order by m.sleeper_roster_id
    limit 1
    for update of m skip locked;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'this league is full');
  end if;

  update league_membership
    set app_user_id = auth.uid(), enrolled = true, controller = 'human',
        team_name = coalesce(nullif(trim(p_team_name), ''), team_name)
    where id = seat.id;

  return jsonb_build_object('ok', true, 'league_id', lg.id, 'league', lg.name,
    'roster_id', seat.sleeper_roster_id,
    'team', coalesce(nullif(trim(p_team_name), ''), seat.team_name));
end $$;
grant execute on function join_dfs(text, text) to authenticated;

-- ── save_pod_entry covers kind='dfs' (0093 body, one gate wider) ─────────────
create or replace function save_pod_entry(p_league uuid, p_week int, p_picks jsonb, p_season text default '2026')
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  seat  league_membership%rowtype;
  lg    league%rowtype;
  cap   int := 50000;
  spent int;
  n_qb int; n_rb int; n_wr int; n_te int; n_k int; n_def int; n_all int;
  lineup jsonb;
  old_picks jsonb;
  frozen text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'not signed in');
  end if;

  select * into lg from league where id = p_league;
  if not found or lg.kind not in ('pod', 'weekly', 'dfs') then
    return jsonb_build_object('ok', false, 'error', 'not a pod league');
  end if;
  if lg.kind = 'weekly' and lg.contest_week is distinct from p_week then
    return jsonb_build_object('ok', false, 'error', 'wrong week for this showdown');
  end if;

  select m.* into seat from league_membership m
    where m.league_id = p_league and m.app_user_id = auth.uid() and m.enrolled
    limit 1;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not in this pod');
  end if;

  if exists (
    select 1 from matchup m
      where m.league_id = p_league and m.week = p_week
        and (m.home_roster_id = seat.sleeper_roster_id or m.away_roster_id = seat.sleeper_roster_id)
        and m.status = 'final'
  ) then
    return jsonb_build_object('ok', false, 'error', 'this week is over');
  end if;

  if jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) <> 9 then
    return jsonb_build_object('ok', false, 'error', 'an entry is exactly 9 players');
  end if;
  if (select count(distinct value) from jsonb_array_elements_text(p_picks)) <> 9 then
    return jsonb_build_object('ok', false, 'error', 'duplicate player in entry');
  end if;

  select starters_json into old_picks from sleeper_lineup
    where league_id = p_league and week = p_week and roster_id = seat.sleeper_roster_id;

  select string_agg(s.name, ', ') into frozen
    from jsonb_array_elements(coalesce(old_picks, '[]'::jsonb)) e
    join pod_salary s on s.season = p_season and s.week = p_week and s.slug = e->>'player_slug'
    where exists (
      select 1 from nfl_slate g
        where g.season = p_season and g.week = p_week
          and (g.home = s.team or g.away = s.team)
          and g.kickoff is not null and g.kickoff - interval '1 hour' <= now())
      and not (p_picks ? (e->>'player_slug'));
  if frozen is not null then
    return jsonb_build_object('ok', false, 'error', 'locked in — can''t drop ' || frozen);
  end if;

  select string_agg(s.name, ', ') into frozen
    from jsonb_array_elements_text(p_picks) p(slug)
    join pod_salary s on s.season = p_season and s.week = p_week and s.slug = p.slug
    where not exists (
        select 1 from jsonb_array_elements(coalesce(old_picks, '[]'::jsonb)) e
          where e->>'player_slug' = p.slug)
      and exists (
        select 1 from nfl_slate g
          where g.season = p_season and g.week = p_week
            and (g.home = s.team or g.away = s.team)
            and g.kickoff is not null and g.kickoff - interval '1 hour' <= now());
  if frozen is not null then
    return jsonb_build_object('ok', false, 'error', 'game locked — can''t add ' || frozen);
  end if;

  select count(*), coalesce(sum(s.salary), 0),
         count(*) filter (where s.pos = 'QB'), count(*) filter (where s.pos = 'RB'),
         count(*) filter (where s.pos = 'WR'), count(*) filter (where s.pos = 'TE'),
         count(*) filter (where s.pos = 'K'),  count(*) filter (where s.pos = 'DEF')
    into n_all, spent, n_qb, n_rb, n_wr, n_te, n_k, n_def
    from jsonb_array_elements_text(p_picks) p(slug)
    join pod_salary s on s.season = p_season and s.week = p_week and s.slug = p.slug;

  if n_all <> 9 then
    return jsonb_build_object('ok', false, 'error', 'a pick is not on this week''s board');
  end if;
  if n_qb <> 1 or n_rb <> 2 or n_wr <> 3 or n_te <> 1 or n_k <> 1 or n_def <> 1 then
    return jsonb_build_object('ok', false, 'error', 'lineup shape is QB·RB·RB·WR·WR·WR·TE·K·DST');
  end if;
  if spent > cap then
    return jsonb_build_object('ok', false, 'error', 'over the salary cap');
  end if;

  select jsonb_agg(jsonb_build_object('slot', rn - 1, 'sleeper_id', null, 'player_slug', s.slug, 'pos', s.pos))
    into lineup
    from (
      select s.*, row_number() over (
        order by array_position(array['QB','RB','WR','TE','K','DEF'], s.pos), s.salary desc, s.slug) rn
      from jsonb_array_elements_text(p_picks) p(slug)
      join pod_salary s on s.season = p_season and s.week = p_week and s.slug = p.slug
    ) s;

  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
    values (p_league, p_week, seat.sleeper_roster_id, lineup)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;

  return jsonb_build_object('ok', true, 'spent', spent, 'cap', cap, 'roster_id', seat.sleeper_roster_id);
end $$;
