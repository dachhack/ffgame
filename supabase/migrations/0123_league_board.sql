-- 0123: THE LEAGUE BOARD — post a league that needs managers, browse it, join.
--
-- Recruiting today is out-of-band: a commissioner copies the invite code into a
-- group chat and hopes. That works for a league whose members already know each
-- other and dead-ends for everyone else — a native league short two seats has
-- no way to reach the players scrolling the app looking for one.
--
-- Three pieces, all deliberately thin:
--
--   · league_listing — one row per posted league. The listing IS the consent to
--     be found: nothing appears on the board unless the commissioner posted it,
--     and closing it (or the seats filling) takes it straight back off.
--   · league_board() — the public read. It never returns the invite code; the
--     code is a bearer credential (join with it, no questions asked), and a
--     recruitment board that leaked one per row would be a list of skeleton
--     keys. Joining goes through join_from_board instead.
--   · join_from_board() — resolves the code server-side and calls native_join
--     with it. Same seat rules, same idempotence, same advisory lock — an open
--     listing is simply a second authorization for the join native_join already
--     implements. No parallel join path to keep in step (the redeem_commish
--     lesson, again).
--
-- Native leagues only: the board's promise is "tap join, get a seat", and only
-- native seats are claimable without platform-side ownership. Sleeper/ESPN
-- leagues recruit with their invite links as before.
--
-- league_invite() is the "recruit each other" half: any ENROLLED member may
-- fetch their league's invite code to share. Members could already see it in a
-- screenshot of the commissioner's screen; giving them a supported path means
-- the share message and the code travel together.

create table if not exists league_listing (
  league_id  uuid primary key references league(id) on delete cascade,
  created_by uuid not null references app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  blurb      text not null default '',
  open       boolean not null default true
);

alter table league_listing enable row level security;
-- No policies on purpose (the 0016 pattern): every read and write goes through
-- the SECURITY DEFINER functions below, so the authorization story lives in one
-- place and the table grants nothing by itself.

-- Post (or re-open / edit) the listing. Commissioner or admin.
create or replace function post_league_listing(p_league_id uuid, p_blurb text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  if lg.provider <> 'native' then
    return jsonb_build_object('ok', false, 'error', 'only native leagues can be posted — others recruit with their invite links');
  end if;
  insert into app_user (id) values (auth.uid()) on conflict (id) do nothing;
  insert into league_listing (league_id, created_by, blurb)
    values (p_league_id, auth.uid(), left(coalesce(p_blurb, ''), 280))
  on conflict (league_id) do update
    set open = true, updated_at = now(),
        blurb = case when p_blurb is null then league_listing.blurb else left(p_blurb, 280) end;
  return jsonb_build_object('ok', true);
end $$;

-- Take the listing off the board. Commissioner or admin. The row stays (the
-- blurb survives a re-post); only `open` flips.
create or replace function close_league_listing(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_admin() or is_league_commish(p_league_id)) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update league_listing set open = false, updated_at = now() where league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'not listed'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- The board. Open listings with at least one claimable seat, newest first.
-- `mine` marks leagues the caller is already enrolled in (the UI shows "you're
-- in this one" instead of a JOIN button); `commish` marks the caller's own.
create or replace function league_board()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare result jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'not signed in'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into result from (
    select jsonb_build_object(
      'league_id', l.id, 'name', l.name, 'season', l.season, 'avatar_url', l.avatar_url,
      'blurb', li.blurb, 'posted_at', li.updated_at,
      'seats_total', (select count(*) from league_membership m where m.league_id = l.id),
      'seats_open',  (select count(*) from league_membership m
                       where m.league_id = l.id and m.app_user_id is null and not m.enrolled),
      'draft_status', coalesce((select d.status from draft d where d.league_id = l.id), 'pending'),
      'draft_mode',   coalesce((select d.mode from draft d where d.league_id = l.id), 'snake'),
      'mine',    exists (select 1 from league_membership m
                          where m.league_id = l.id and m.app_user_id = auth.uid() and m.enrolled),
      'commish', l.commissioner_id = auth.uid()
    ) as r
    from league_listing li
    join league l on l.id = li.league_id
    where li.open
      and exists (select 1 from league_membership m
                   where m.league_id = l.id and m.app_user_id is null and not m.enrolled)
    order by li.updated_at desc
  ) t;
  return result;
end $$;

-- Join a posted league. The open listing is the authorization; the invite code
-- is resolved here and never crosses the wire. Everything else — the advisory
-- lock, seat pick, idempotent re-join, "league is full" — is native_join's.
create or replace function join_from_board(p_league_id uuid, p_team_name text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select l.invite_code into code
    from league_listing li join league l on l.id = li.league_id
    where li.league_id = p_league_id and li.open;
  if code is null then
    return jsonb_build_object('ok', false, 'error', 'that league is no longer taking joiners');
  end if;
  return native_join(code, p_team_name);
end $$;

-- The invite code, for any enrolled member (plus commish/admin) — so anyone in
-- the league can recruit a friend, not just whoever holds the commish screen.
create or replace function league_invite(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lg league%rowtype;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if not (is_admin() or is_league_commish(p_league_id) or exists (
    select 1 from league_membership m
     where m.league_id = p_league_id and m.app_user_id = auth.uid() and m.enrolled
  )) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'league not found'); end if;
  return jsonb_build_object('ok', true, 'invite_code', lg.invite_code, 'name', lg.name,
    'seats_open', (select count(*) from league_membership m
                    where m.league_id = lg.id and m.app_user_id is null and not m.enrolled));
end $$;

grant execute on function post_league_listing(uuid, text) to authenticated;
grant execute on function close_league_listing(uuid) to authenticated;
grant execute on function league_board() to authenticated;
grant execute on function join_from_board(uuid, text) to authenticated;
grant execute on function league_invite(uuid) to authenticated;
