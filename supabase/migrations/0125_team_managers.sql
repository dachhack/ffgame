-- 0125: TEAMS WITH MORE THAN ONE HUMAN — co-managers, and a real waiting room.
--
-- Two membership shapes the seat model couldn't express:
--
--   · CO-MANAGERS. league_membership binds one app_user to a seat, and the
--     whole pick pipeline hangs off that identity: sealed_pick rows are keyed
--     (matchup_id, app_user_id, …), RLS accepts only auth.uid()'s own rows, and
--     the board/resolver read the seat's picks as the OWNER's rows. So a second
--     manager can't just "also have" the team — their picks would land under
--     their own id and be invisible. The fix keeps one pick identity per seat:
--     a co-manager WRITES THE OWNER'S ROWS. team_manager grants that, the
--     sealed_pick policies below permit it, and my_teams() tells clients which
--     app_user_id to write as (pick_user_id). One team, one lineup, N thumbs.
--
--   · THE WAITING ROOM. league_join (0043) has been the joiner pool all along,
--     but native_join answered a full league with an error, and nothing let a
--     waiting user SEE that they're waiting. Now a full league's join lands on
--     the waitlist (status 'waitlisted'), my_waitlist() shows it to the joiner,
--     and the commissioner assigns from the pool (admin_assign_roster, 0043) or
--     attaches them to a seat as a co-manager.
--
-- Deliberately NOT shared: power-up inventories and identified analytics stay
-- per-account. A co-manager spends the TEAM's coin (wallets are roster-keyed)
-- but plays from their own inventory. Good enough until someone actually asks.

create table if not exists team_manager (
  league_id   uuid not null references league(id) on delete cascade,
  roster_id   int  not null,
  app_user_id uuid not null references app_user(id) on delete cascade,
  added_by    uuid,
  created_at  timestamptz not null default now(),
  primary key (league_id, roster_id, app_user_id)
);
alter table team_manager enable row level security;
-- No policies (0016 pattern): reads and writes go through the RPCs below.

-- owns_roster now means "may act as this seat": the seated owner, or a
-- co-manager. Every RPC already gating on owns_roster — team rename, avatar,
-- lineup-policy reads, native-league drops/adds/claims — opens to co-managers
-- with this one change, which is the point of extending it here rather than
-- teaching each caller about the new table.
create or replace function owns_roster(l_id uuid, r_id int) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from league_membership m
                 where m.league_id = l_id and m.sleeper_roster_id = r_id
                   and m.app_user_id = auth.uid() and m.enrolled)
      or exists (select 1 from team_manager tm
                 where tm.league_id = l_id and tm.roster_id = r_id
                   and tm.app_user_id = auth.uid());
$$;

-- Membership for reads (standings, pools, boards) includes co-managers.
create or replace function is_league_member(l_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from league_membership lm
    where lm.league_id = l_id and lm.app_user_id = auth.uid()
  ) or exists (
    select 1 from team_manager tm
    where tm.league_id = l_id and tm.app_user_id = auth.uid()
  );
$$;

-- ── sealed_pick: a co-manager writes THE OWNER'S rows ────────────────────────
-- Same locked=false discipline as the owner policies (0001), and the matchup
-- must belong to the league the co-management grant is for — the same owner
-- can hold seats in several leagues, and a grant in one is not a grant in all.
-- The 0058 window-lock trigger still applies row by row, unchanged.
--
-- The check lives in a SECURITY DEFINER helper, not inline in the policies,
-- and not only for tidiness: a policy's subqueries run AS THE CALLER, so an
-- inline `exists (select … from team_manager …)` is itself subject to
-- team_manager's RLS — which has no policies, so the subquery would see
-- nothing and the policy could never pass. The definer function runs as the
-- table owner and sees the real rows (the owns_roster pattern, 0064).
create or replace function co_manages_pick(p_matchup_id uuid, p_pick_owner uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_manager tm
    join league_membership m on m.league_id = tm.league_id and m.sleeper_roster_id = tm.roster_id and m.enrolled
    join matchup mu on mu.id = p_matchup_id and mu.league_id = tm.league_id
    where tm.app_user_id = auth.uid() and m.app_user_id = p_pick_owner
  );
$$;
grant execute on function co_manages_pick(uuid, uuid) to authenticated;

create policy sealed_select_comanager on sealed_pick
  for select using (co_manages_pick(matchup_id, app_user_id));
create policy sealed_insert_comanager on sealed_pick
  for insert with check (locked = false and co_manages_pick(matchup_id, app_user_id));
create policy sealed_update_comanager on sealed_pick
  for update
  using (locked = false and co_manages_pick(matchup_id, app_user_id))
  with check (locked = false and co_manages_pick(matchup_id, app_user_id));

-- ── Commissioner: attach / detach a co-manager ───────────────────────────────
-- By email (must already be an account — a co-manager grant to nobody is a
-- typo, not a pending invite; the seat-hold flow via claim_email covers "not
-- signed up yet") or by app_user_id (straight from the waitlist). Attaching a
-- waitlisted user clears their waitlist row: they're in the league now.
create or replace function commish_set_manager(
  p_league_id uuid, p_roster_id int,
  p_email text default null, p_app_user_id uuid default null, p_remove boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid; e text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  uid := p_app_user_id;
  if uid is null and e is not null then
    select id into uid from app_user where lower(email) = e;
    if uid is null then
      return jsonb_build_object('ok', false, 'error', 'no account with that email — have them sign up first, or hold the seat for them by email instead');
    end if;
  end if;
  if uid is null then return jsonb_build_object('ok', false, 'error', 'email or user required'); end if;

  if p_remove then
    delete from team_manager where league_id = p_league_id and roster_id = p_roster_id and app_user_id = uid;
    if not found then return jsonb_build_object('ok', false, 'error', 'not a co-manager of that team'); end if;
    return jsonb_build_object('ok', true, 'removed', true);
  end if;

  if not exists (select 1 from league_membership m
                  where m.league_id = p_league_id and m.sleeper_roster_id = p_roster_id and m.enrolled) then
    return jsonb_build_object('ok', false, 'error', 'that seat has no owner yet — assign an owner first, then add co-managers');
  end if;
  if exists (select 1 from league_membership m
              where m.league_id = p_league_id and m.sleeper_roster_id = p_roster_id and m.app_user_id = uid) then
    return jsonb_build_object('ok', false, 'error', 'they already own that seat');
  end if;
  insert into team_manager (league_id, roster_id, app_user_id, added_by)
    values (p_league_id, p_roster_id, uid, auth.uid())
  on conflict do nothing;
  delete from league_join where league_id = p_league_id and app_user_id = uid;
  return jsonb_build_object('ok', true);
end $$;

-- Every co-manager in a league (commissioner's management view).
create or replace function team_managers(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if not (is_admin() or is_league_commish(p_league_id) or is_league_member(p_league_id)) then
    return jsonb_build_object('error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'roster_id', tm.roster_id, 'app_user_id', tm.app_user_id, 'email', u.email)
    order by tm.roster_id, tm.created_at), '[]'::jsonb) into result
  from team_manager tm left join app_user u on u.id = tm.app_user_id
  where tm.league_id = p_league_id;
  return result;
end $$;

-- ── my_teams: every seat I can act for — owned or co-managed ─────────────────
-- Shaped like the client's Enrollment rows plus two fields:
--   pick_user_id — the app_user_id sealed picks must be written AS (the seat
--                  owner's; your own when you own the seat)
--   comanager    — you steer this team but the seat isn't yours
create or replace function my_teams()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(r order by r -> 'league' ->> 'name'), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', m.league_id, 'team_name', m.team_name, 'sleeper_roster_id', m.sleeper_roster_id,
      'avatar_url', m.avatar_url, 'pick_user_id', m.app_user_id, 'comanager', (m.app_user_id <> auth.uid()),
      'league', jsonb_build_object(
        'name', l.name, 'season', l.season, 'preseason_at', l.preseason_at, 'provider', l.provider,
        'avatar_url', l.avatar_url, 'is_mock', l.is_mock, 'kind', l.kind, 'contest_week', l.contest_week)
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

-- ── The waiting room, visible to the person in it ────────────────────────────
create or replace function my_waitlist()
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'league_id', j.league_id, 'name', l.name, 'season', l.season,
      'avatar_url', l.avatar_url, 'joined_at', j.created_at)
    order by j.created_at desc), '[]'::jsonb) into result
  from league_join j join league l on l.id = j.league_id
  where j.app_user_id = auth.uid()
    and not exists (select 1 from league_membership m
                     where m.league_id = j.league_id and m.app_user_id = auth.uid() and m.enrolled);
  return result;
end $$;

-- native_join v3 (0064 → 0070 → here): a FULL league now waitlists the joiner
-- instead of turning them away — the commissioner assigns seats or attaches
-- co-managers from the pool. Body otherwise identical to 0070's.
create or replace function native_join(p_code text, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype; seat int; e text; nm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into lg from league where invite_code = upper(trim(p_code));
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid invite code'); end if;
  if lg.provider <> 'native' then return jsonb_build_object('ok', false, 'error', 'not a native league — use the join flow'); end if;
  if lg.is_mock then return jsonb_build_object('ok', false, 'error', 'mock drafts are solo practice rooms — no joining'); end if;

  e := nullif(lower(btrim(coalesce(auth.jwt() ->> 'email', ''))), '');
  insert into app_user (id, email) values (auth.uid(), e)
    on conflict (id) do update set email = coalesce(excluded.email, app_user.email);

  -- Already seated? Idempotent.
  select sleeper_roster_id into seat from league_membership
    where league_id = lg.id and app_user_id = auth.uid() and enrolled limit 1;
  if seat is not null then
    return jsonb_build_object('ok', true, 'league_id', lg.id, 'roster_id', seat, 'status', 'enrolled');
  end if;

  perform pg_advisory_xact_lock(hashtext(lg.id::text));
  select sleeper_roster_id into seat from league_membership
    where league_id = lg.id and app_user_id is null and not enrolled
    order by sleeper_roster_id limit 1;
  if seat is null then
    -- Full house → the waiting room, idempotently. 'waitlisted' is a success:
    -- the join HAPPENED, it just doesn't come with a seat yet.
    insert into league_join (league_id, app_user_id, email) values (lg.id, auth.uid(), e)
      on conflict (league_id, app_user_id) do update set email = excluded.email;
    return jsonb_build_object('ok', true, 'league_id', lg.id, 'status', 'waitlisted', 'league', lg.name);
  end if;

  nm := nullif(btrim(coalesce(p_team_name, '')), '');
  update league_membership
    set app_user_id = auth.uid(), enrolled = true, claim_email = e,
        team_name = coalesce(nm, team_name)
    where league_id = lg.id and sleeper_roster_id = seat;
  delete from league_join where league_id = lg.id and app_user_id = auth.uid();

  return jsonb_build_object('ok', true, 'league_id', lg.id, 'roster_id', seat, 'status', 'enrolled', 'league', lg.name);
end $$;

grant execute on function commish_set_manager(uuid, int, text, uuid, boolean) to authenticated;
grant execute on function team_managers(uuid) to authenticated;
grant execute on function my_teams() to authenticated;
grant execute on function my_waitlist() to authenticated;
