-- 0006: super-admin support. An allowlisted admin (by email) gets read/manage
-- access through SECURITY DEFINER RPCs (tables stay RLS-locked). Powers the
-- in-app Admin page: see every league + its codes, manage commissioner overrides,
-- drive the matchup lifecycle (lock/live/final), and read the audit log.

create table if not exists app_admin (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);
insert into app_admin (email, note) values ('mlporritt@gmail.com', 'pilot owner')
  on conflict (email) do nothing;

create or replace function is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_admin a where a.email = (auth.jwt() ->> 'email'));
$$;

-- Every league with codes + enrollment counts.
create or replace function admin_overview() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'name', l.name, 'season', l.season,
      'commish_code', l.commish_code, 'invite_code', l.invite_code,
      'commissioner', l.commissioner_id is not null,
      'rosters', (select count(*) from league_membership m where m.league_id = l.id),
      'enrolled', (select count(*) from league_membership m where m.league_id = l.id and m.enrolled)
    ) as r from league l order by l.created_at desc
  ) t;
  return result;
end $$;

-- Matchups for a league (newest weeks first).
create or replace function admin_matchups(p_league_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(r order by (r->>'week')::int), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'id', id, 'week', week, 'home_roster_id', home_roster_id, 'away_roster_id', away_roster_id,
      'status', status, 'lock_at', lock_at, 'home_final', home_final, 'away_final', away_final
    ) as r from matchup where league_id = p_league_id
  ) t;
  return result;
end $$;

-- Drive a matchup's lifecycle. status ∈ scheduled|locked|live|final. When moving
-- past 'scheduled', also seal both sides' picks (mirrors the worker's lock.js).
create or replace function admin_set_matchup(p_matchup_id uuid, p_status text, p_lock_now boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_status is not null and p_status not in ('scheduled', 'locked', 'live', 'final') then
    return jsonb_build_object('ok', false, 'error', 'bad status');
  end if;
  update matchup set
    status = coalesce(p_status::matchup_status, status),
    lock_at = case when p_lock_now then now() else lock_at end
  where id = p_matchup_id;
  if p_status in ('locked', 'live', 'final') then
    update sealed_pick set locked = true, revealed_at = now()
      where matchup_id = p_matchup_id and not locked;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Commissioner override list / add / remove.
create or replace function admin_overrides() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('sleeper_user_id', sleeper_user_id, 'note', note) order by created_at), '[]'::jsonb)
    into result from commish_override;
  return result;
end $$;

create or replace function admin_set_override(p_sleeper_user_id text, p_note text, p_remove boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_remove then
    delete from commish_override where sleeper_user_id = p_sleeper_user_id;
  else
    insert into commish_override (sleeper_user_id, note) values (p_sleeper_user_id, p_note)
      on conflict (sleeper_user_id) do update set note = excluded.note;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Recent audit-log entries.
create or replace function admin_audit(p_limit int default 50) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not is_admin() then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('table', table_name, 'op', op, 'row_id', row_id, 'at', at) order by at desc), '[]'::jsonb)
    into result from (select * from audit_log order by at desc limit least(p_limit, 200)) a;
  return result;
end $$;

grant execute on function is_admin() to authenticated;
grant execute on function admin_overview() to authenticated;
grant execute on function admin_matchups(uuid) to authenticated;
grant execute on function admin_set_matchup(uuid, text, boolean) to authenticated;
grant execute on function admin_overrides() to authenticated;
grant execute on function admin_set_override(text, text, boolean) to authenticated;
grant execute on function admin_audit(int) to authenticated;
