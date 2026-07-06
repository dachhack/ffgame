-- 0043: league join pool. A player opens the invite link and "joins" a league's
-- pool (any platform, no roster picked); the commissioner then assigns each joiner
-- to a roster from a list — instead of typing every email. Complements the direct
-- email-assign from 0042.

create table if not exists league_join (
  league_id   uuid not null references league(id) on delete cascade,
  app_user_id uuid not null references app_user(id) on delete cascade,
  email       text,
  created_at  timestamptz not null default now(),
  primary key (league_id, app_user_id)
);
alter table league_join enable row level security;
-- No policies: access only through the SECURITY DEFINER RPCs below.

-- Player joins a league's pool by its invite code (any platform). Idempotent.
create or replace function join_league(p_code text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; e text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);
  select * into lg from league where league.invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid invite code'); end if;
  -- Already rostered in this league? Nothing to do.
  if exists (select 1 from league_membership m where m.league_id = lg.id and m.app_user_id = auth.uid() and m.enrolled) then
    return jsonb_build_object('ok', true, 'league', lg.name, 'status', 'enrolled');
  end if;
  insert into league_join (league_id, app_user_id, email) values (lg.id, auth.uid(), e)
    on conflict (league_id, app_user_id) do update set email = excluded.email;
  return jsonb_build_object('ok', true, 'league', lg.name, 'status', 'joined');
end $$;
grant execute on function join_league(text) to authenticated;

-- Admin/commish: joiners not yet rostered (feeds the assign picker).
create or replace function admin_league_joiners(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object('app_user_id', j.app_user_id, 'email', coalesce(u.email, j.email)) order by j.created_at), '[]'::jsonb)
    into result
  from league_join j left join app_user u on u.id = j.app_user_id
  where j.league_id = p_league_id
    and not exists (select 1 from league_membership m where m.league_id = p_league_id and m.app_user_id = j.app_user_id and m.enrolled);
  return result;
end $$;
grant execute on function admin_league_joiners(uuid) to authenticated;

-- admin_assign_roster (0042) gains an optional app_user_id (picked from the joiners
-- list) and clears the join-pool row on assignment. Drop the 3-arg version first.
drop function if exists admin_assign_roster(uuid, int, text);
create or replace function admin_assign_roster(p_league_id uuid, p_roster_id int, p_email text, p_app_user_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid; e text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if not (is_admin() or is_league_commish(p_league_id)) then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if p_app_user_id is null and e is null then
    update league_membership set app_user_id = null, enrolled = false, claim_email = null
      where league_id = p_league_id and sleeper_roster_id = p_roster_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
    return jsonb_build_object('ok', true, 'status', 'cleared');
  end if;
  uid := p_app_user_id;
  if uid is null then select id into uid from app_user where lower(email) = e; end if;
  if e is null and uid is not null then select lower(email) into e from app_user where id = uid; end if;
  if uid is not null then
    update league_membership set app_user_id = uid, enrolled = true, claim_email = e
      where league_id = p_league_id and sleeper_roster_id = p_roster_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
    delete from league_join where league_id = p_league_id and app_user_id = uid;
    return jsonb_build_object('ok', true, 'status', 'enrolled');
  else
    update league_membership set app_user_id = null, enrolled = false, claim_email = e
      where league_id = p_league_id and sleeper_roster_id = p_roster_id;
    if not found then return jsonb_build_object('ok', false, 'error', 'roster not found'); end if;
    return jsonb_build_object('ok', true, 'status', 'pending');
  end if;
end $$;
grant execute on function admin_assign_roster(uuid, int, text, uuid) to authenticated;
