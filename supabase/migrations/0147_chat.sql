-- 0147: CHAT — league chat + member-to-member DMs.
--
-- The league already talks AT people (commish note, flags, trade signals);
-- this is the members talking to each other. Two surfaces, both league-scoped:
--
--   • LEAGUE CHAT — one channel per league, every member + the commissioner.
--   • DMs — one thread per (league, member pair). Scoped to the league on
--     purpose: discovery is the league member list, display names are that
--     league's team names, and leaving a league walks away from its threads.
--     A pair sharing two leagues gets two threads — that mirrors how the rest
--     of the product thinks (everything is a league surface).
--
-- Access is RPC-only (RLS deny-all, same as trade_signal 0140): every gate in
-- one place, payloads shaped server-side (author display names joined in, so
-- clients never need a second members fetch to render a message).
--
-- Reads are polled, not pushed — the clients poll while a chat surface is
-- open (the live board's cadence) and poll a cheap unread-count RPC for
-- badges. Fetching the LATEST page marks the surface read (opening the chat
-- is reading it); the badge RPC never touches read markers.
--
-- Moderation: authors delete their own messages, the commissioner (or admin)
-- deletes anything. Hard delete — a 500-char chat line isn't a record worth
-- tombstoning.

create table league_message (
  id          bigint generated always as identity primary key,
  league_id   uuid not null references league(id) on delete cascade,
  author_id   uuid not null references app_user(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on league_message(league_id, id desc);
alter table league_message enable row level security;   -- no policies: RPC-only

create table league_chat_read (
  league_id    uuid not null references league(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  last_read    bigint not null default 0,
  primary key (league_id, app_user_id)
);
alter table league_chat_read enable row level security; -- no policies: RPC-only

create table dm_thread (
  id            uuid primary key default gen_random_uuid(),
  league_id     uuid not null references league(id) on delete cascade,
  user_lo       uuid not null references app_user(id) on delete cascade,
  user_hi       uuid not null references app_user(id) on delete cascade,
  lo_last_read  bigint not null default 0,
  hi_last_read  bigint not null default 0,
  last_msg_at   timestamptz not null default now(),
  unique (league_id, user_lo, user_hi),
  check (user_lo < user_hi)
);
create index on dm_thread(user_lo);
create index on dm_thread(user_hi);
alter table dm_thread enable row level security;        -- no policies: RPC-only

create table dm_message (
  id          bigint generated always as identity primary key,
  thread_id   uuid not null references dm_thread(id) on delete cascade,
  author_id   uuid not null references app_user(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index on dm_message(thread_id, id desc);
alter table dm_message enable row level security;       -- no policies: RPC-only

-- ── helpers ─────────────────────────────────────────────────────────────────

-- A member's display name inside a league: their team name, else the front of
-- their email. Team managers (co-managers, 0125) resolve through their team.
create or replace function _chat_display_name(l_id uuid, u_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(lm.team_name, '') from league_membership lm
      where lm.league_id = l_id and lm.app_user_id = u_id limit 1),
    (select nullif(lm.team_name, '') from team_manager tm
      join league_membership lm on lm.league_id = tm.league_id and lm.sleeper_roster_id = tm.roster_id
      where tm.league_id = l_id and tm.app_user_id = u_id limit 1),
    (select split_part(au.email, '@', 1) from app_user au where au.id = u_id),
    'someone');
$$;

-- Body rules in one place: trimmed, 1..500 chars.
create or replace function _chat_clean_body(p text) returns text
  language plpgsql immutable as $$
declare b text := btrim(coalesce(p, ''));
begin
  if b = '' then raise exception 'say something — empty messages don''t send'; end if;
  if length(b) > 500 then raise exception 'keep it under 500 characters'; end if;
  return b;
end $$;

-- ── league chat ─────────────────────────────────────────────────────────────

create or replace function chat_post(p_league_id uuid, p_body text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare b text; mid bigint;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  begin b := _chat_clean_body(p_body);
  exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
  -- flood guard: one message every couple of seconds
  if exists (select 1 from league_message
               where league_id = p_league_id and author_id = auth.uid()
                 and created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'error', 'easy there — one message every couple of seconds');
  end if;
  insert into league_message (league_id, author_id, body) values (p_league_id, auth.uid(), b)
    returning id into mid;
  -- your own message is read the moment you send it
  insert into league_chat_read (league_id, app_user_id, last_read) values (p_league_id, auth.uid(), mid)
    on conflict (league_id, app_user_id) do update set last_read = greatest(league_chat_read.last_read, excluded.last_read);
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

-- Latest page (p_before null) or older history (p_before = oldest id you
-- have). Fetching the LATEST page marks the channel read — opening the chat
-- is reading it. Rows come newest-first; clients reverse for display.
create or replace function chat_messages(p_league_id uuid, p_before bigint default null, p_limit int default 50)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 50), 1), 100); out jsonb; top bigint;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'body', m.body, 'at', m.created_at,
           'author', _chat_display_name(p_league_id, m.author_id),
           'author_id', m.author_id,
           'mine', m.author_id = auth.uid()) order by m.id desc), '[]'::jsonb)
    into out
    from (select * from league_message
            where league_id = p_league_id and (p_before is null or id < p_before)
            order by id desc limit lim) m;
  if p_before is null then
    select max(id) into top from league_message where league_id = p_league_id;
    if top is not null then
      insert into league_chat_read (league_id, app_user_id, last_read) values (p_league_id, auth.uid(), top)
        on conflict (league_id, app_user_id) do update set last_read = greatest(league_chat_read.last_read, excluded.last_read);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'messages', out);
end $$;

create or replace function chat_delete(p_league_id uuid, p_id bigint)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  delete from league_message
    where id = p_id and league_id = p_league_id
      and (author_id = auth.uid() or is_league_commish(p_league_id) or is_admin());
  if not found then return jsonb_build_object('ok', false, 'error', 'not yours to delete'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── DMs ─────────────────────────────────────────────────────────────────────

create or replace function dm_send(p_league_id uuid, p_to uuid, p_body text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare b text; lo uuid; hi uuid; tid uuid; mid bigint; me uuid := auth.uid();
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_to is null or p_to = me then
    return jsonb_build_object('ok', false, 'error', 'pick someone else in the league');
  end if;
  -- the recipient must live in this league too (member, co-manager, or its commissioner)
  if not (exists (select 1 from league_membership lm where lm.league_id = p_league_id and lm.app_user_id = p_to)
          or exists (select 1 from team_manager tm where tm.league_id = p_league_id and tm.app_user_id = p_to)
          or exists (select 1 from league l where l.id = p_league_id and l.commissioner_id = p_to)) then
    return jsonb_build_object('ok', false, 'error', 'they''re not in this league');
  end if;
  begin b := _chat_clean_body(p_body);
  exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
  lo := least(me, p_to); hi := greatest(me, p_to);
  insert into dm_thread (league_id, user_lo, user_hi) values (p_league_id, lo, hi)
    on conflict (league_id, user_lo, user_hi) do update set last_msg_at = now()
    returning id into tid;
  -- flood guard, per thread
  if exists (select 1 from dm_message where thread_id = tid and author_id = me
               and created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'error', 'easy there — one message every couple of seconds');
  end if;
  insert into dm_message (thread_id, author_id, body) values (tid, me, b) returning id into mid;
  update dm_thread set last_msg_at = now(),
    lo_last_read = case when user_lo = me then greatest(lo_last_read, mid) else lo_last_read end,
    hi_last_read = case when user_hi = me then greatest(hi_last_read, mid) else hi_last_read end
    where id = tid;
  return jsonb_build_object('ok', true, 'thread_id', tid, 'id', mid);
end $$;

create or replace function dm_threads(p_league_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); out jsonb;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(row_j order by last_at desc), '[]'::jsonb) into out from (
    select jsonb_build_object(
             'thread_id', t.id,
             'peer_id', case when t.user_lo = me then t.user_hi else t.user_lo end,
             'peer', _chat_display_name(p_league_id, case when t.user_lo = me then t.user_hi else t.user_lo end),
             'last_at', t.last_msg_at,
             'preview', (select left(m.body, 80) from dm_message m where m.thread_id = t.id order by m.id desc limit 1),
             'unread', (select count(*) from (
                 select 1 from dm_message m where m.thread_id = t.id and m.author_id <> me
                   and m.id > case when t.user_lo = me then t.lo_last_read else t.hi_last_read end
                 limit 100) c)
           ) as row_j, t.last_msg_at as last_at
      from dm_thread t
      where t.league_id = p_league_id and (t.user_lo = me or t.user_hi = me)
  ) s;
  return jsonb_build_object('ok', true, 'threads', out);
end $$;

create or replace function dm_messages(p_thread_id uuid, p_before bigint default null, p_limit int default 50)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t dm_thread; lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
        out jsonb; top bigint;
begin
  select * into t from dm_thread where id = p_thread_id and (user_lo = me or user_hi = me);
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'body', m.body, 'at', m.created_at,
           'mine', m.author_id = me) order by m.id desc), '[]'::jsonb)
    into out
    from (select * from dm_message
            where thread_id = p_thread_id and (p_before is null or id < p_before)
            order by id desc limit lim) m;
  if p_before is null then
    select max(id) into top from dm_message where thread_id = p_thread_id;
    if top is not null then
      update dm_thread set
        lo_last_read = case when user_lo = me then greatest(lo_last_read, top) else lo_last_read end,
        hi_last_read = case when user_hi = me then greatest(hi_last_read, top) else hi_last_read end
        where id = p_thread_id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'messages', out,
    'peer', _chat_display_name(t.league_id, case when t.user_lo = me then t.user_hi else t.user_lo end));
end $$;

-- ── badges + the recipient picker ───────────────────────────────────────────

-- Cheap poll for badge counts. NEVER touches read markers.
create or replace function chat_unread(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); lr bigint; lu int; du int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce((select last_read from league_chat_read where league_id = p_league_id and app_user_id = me), 0) into lr;
  select count(*) into lu from (
    select 1 from league_message where league_id = p_league_id and id > lr and author_id <> me limit 100) s;
  select coalesce(sum(n), 0) into du from (
    select (select count(*) from (
        select 1 from dm_message m where m.thread_id = t.id and m.author_id <> me
          and m.id > case when t.user_lo = me then t.lo_last_read else t.hi_last_read end
        limit 100) c) as n
      from dm_thread t where t.league_id = p_league_id and (t.user_lo = me or t.user_hi = me)
  ) s;
  return jsonb_build_object('ok', true, 'league', lu, 'dm', du);
end $$;

-- Who can I message? Every enrolled member (and the commissioner, seated or
-- not) with their in-league display name. Member-gated: this is the same
-- roster every league screen already shows.
create or replace function chat_members(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); out jsonb;
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
  return jsonb_build_object('ok', true, 'members', out);
end $$;

grant execute on function chat_post(uuid, text) to authenticated;
grant execute on function chat_messages(uuid, bigint, int) to authenticated;
grant execute on function chat_delete(uuid, bigint) to authenticated;
grant execute on function dm_send(uuid, uuid, text) to authenticated;
grant execute on function dm_threads(uuid) to authenticated;
grant execute on function dm_messages(uuid, bigint, int) to authenticated;
grant execute on function chat_unread(uuid) to authenticated;
grant execute on function chat_members(uuid) to authenticated;
