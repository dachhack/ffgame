-- 0459: THE DEV ROOM (v0.658.0).
--
-- Founder: "Can I have a special dev group chat and invite users into the
-- chat where they can log changes and suggestions for the game?" Every chat
-- before this (0147) belonged to a league: one league channel, 1:1 DMs. A dev
-- room belongs to no league. It has members, and nobody is in it without an
-- invite.
--
--   • ROOMS. An admin (is_admin, 0006) makes one, and is its first member.
--   • INVITES. Only an admin makes an invite code: eight hex characters, the
--     shape gen_invite_code (0002) makes, redeemable by anyone signed in until
--     it is revoked or its uses run out. Joining by code is the only way in.
--     An admin removes a member; a member can leave.
--   • MESSAGES. Members post (1..1000 chars). A message may carry a TAG,
--     'idea' or 'bug', set when it is posted or later by its author (or an
--     admin) until it is filed.
--   • FILING. The founder chose "auto-file every tag": the worker files every
--     tagged message as a GitHub issue (server/src/devRoom.js) and writes the
--     issue number back here. A filed message's tag is final; the issue is
--     the record. `filing_at` is the worker's claim, so two sweeps cannot file
--     the same line twice, and a claim that never finished is retaken after
--     ten minutes.
--
-- Access is RPC-only (RLS on, no policies), the 0147 pattern: every gate in
-- one place, display names joined server-side. The worker writes with the
-- service role.

create table if not exists dev_room (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_by  uuid references app_user(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table dev_room enable row level security;            -- no policies: RPC-only

create table if not exists dev_room_member (
  room_id      uuid not null references dev_room(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  role         text not null default 'member' check (role in ('member', 'admin')),
  last_read    bigint not null default 0,
  joined_at    timestamptz not null default now(),
  primary key (room_id, app_user_id)
);
create index if not exists dev_room_member_user on dev_room_member(app_user_id);
alter table dev_room_member enable row level security;     -- no policies: RPC-only

create table if not exists dev_room_invite (
  code        text primary key,
  room_id     uuid not null references dev_room(id) on delete cascade,
  created_by  uuid references app_user(id) on delete set null,
  max_uses    int check (max_uses is null or max_uses > 0),   -- null = unlimited
  uses        int not null default 0,
  revoked     boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table dev_room_invite enable row level security;     -- no policies: RPC-only

create table if not exists dev_room_message (
  id            bigint generated always as identity primary key,
  room_id       uuid not null references dev_room(id) on delete cascade,
  author_id     uuid references app_user(id) on delete set null,
  body          text not null,
  tag           text check (tag in ('idea', 'bug')),
  filing_at     timestamptz,           -- the worker's claim (devRoom.js)
  issue_number  int,                   -- set once filed
  created_at    timestamptz not null default now()
);
create index if not exists dev_room_message_room on dev_room_message(room_id, id desc);
-- The worker's queue: tagged, not yet filed.
create index if not exists dev_room_message_unfiled on dev_room_message(id)
  where tag is not null and issue_number is null;
alter table dev_room_message enable row level security;    -- no policies: RPC-only

-- ── helpers ─────────────────────────────────────────────────────────────────

create or replace function _dev_room_member(p_room uuid) returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from dev_room_member where room_id = p_room and app_user_id = auth.uid());
$$;

-- A member's name in the room: their display name, else the front of their
-- email. (A room has no team names to borrow, unlike league chat.)
create or replace function _dev_room_name(u_id uuid) returns text
  language sql stable security definer set search_path = public as $$
  select coalesce(
    (select nullif(btrim(au.display_name), '') from app_user au where au.id = u_id),
    (select split_part(au.email, '@', 1) from app_user au where au.id = u_id),
    'someone');
$$;

-- ── rooms ───────────────────────────────────────────────────────────────────

-- Admin only. The admin who makes it is its first member, with role admin.
create or replace function dev_room_create(p_name text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_name, '')); rid uuid;
begin
  if not is_admin() then return jsonb_build_object('ok', false, 'error', 'only an admin can make a dev room'); end if;
  if n = '' then n := 'Dev room'; end if;
  if length(n) > 60 then return jsonb_build_object('ok', false, 'error', 'keep the name under 60 characters'); end if;
  insert into dev_room (name, created_by) values (n, auth.uid()) returning id into rid;
  insert into dev_room_member (room_id, app_user_id, role) values (rid, auth.uid(), 'admin');
  return jsonb_build_object('ok', true, 'room_id', rid);
end $$;

-- The rooms I am in, with an unread count each. An admin who is in none is
-- told so (`can_create`), which is how the client offers "make one".
create or replace function dev_rooms_mine()
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'name', r.name, 'role', m.role,
           'members', (select count(*) from dev_room_member x where x.room_id = r.id),
           'unread', (select count(*) from dev_room_message g
                       where g.room_id = r.id and g.id > m.last_read
                         and g.author_id is distinct from auth.uid()))
         order by r.created_at), '[]'::jsonb)
    into out
    from dev_room_member m join dev_room r on r.id = m.room_id
   where m.app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'rooms', out, 'can_create', is_admin());
end $$;

-- ── invites ─────────────────────────────────────────────────────────────────

-- Admin only (a room admin, or any app admin). `p_max_uses` null = unlimited.
create or replace function dev_room_invite_create(p_room uuid, p_max_uses int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c text;
begin
  if not (is_admin() or exists (select 1 from dev_room_member
            where room_id = p_room and app_user_id = auth.uid() and role = 'admin')) then
    return jsonb_build_object('ok', false, 'error', 'only an admin can invite people');
  end if;
  if not exists (select 1 from dev_room where id = p_room) then
    return jsonb_build_object('ok', false, 'error', 'no such room');
  end if;
  loop
    c := gen_invite_code();
    exit when not exists (select 1 from dev_room_invite where code = c);
  end loop;
  insert into dev_room_invite (code, room_id, created_by, max_uses)
    values (c, p_room, auth.uid(), case when p_max_uses is null or p_max_uses < 1 then null else p_max_uses end);
  return jsonb_build_object('ok', true, 'code', c);
end $$;

create or replace function dev_room_invites(p_room uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not (is_admin() or exists (select 1 from dev_room_member
            where room_id = p_room and app_user_id = auth.uid() and role = 'admin')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', i.code, 'uses', i.uses, 'max_uses', i.max_uses, 'at', i.created_at)
         order by i.created_at desc), '[]'::jsonb)
    into out from dev_room_invite i where i.room_id = p_room and not i.revoked;
  return jsonb_build_object('ok', true, 'invites', out);
end $$;

create or replace function dev_room_invite_revoke(p_code text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  select room_id into rid from dev_room_invite where code = upper(btrim(coalesce(p_code, '')));
  if rid is null then return jsonb_build_object('ok', false, 'error', 'no such invite'); end if;
  if not (is_admin() or exists (select 1 from dev_room_member
            where room_id = rid and app_user_id = auth.uid() and role = 'admin')) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  update dev_room_invite set revoked = true where code = upper(btrim(p_code));
  return jsonb_build_object('ok', true);
end $$;

-- Anyone signed in, with a live code. Joining twice is a no-op that still
-- answers with the room, so a tapped link always lands somewhere.
create or replace function dev_room_join(p_code text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare c text := upper(btrim(coalesce(p_code, ''))); inv dev_room_invite; nm text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sign in first'); end if;
  select * into inv from dev_room_invite where code = c for update;
  if inv.code is null or inv.revoked then
    return jsonb_build_object('ok', false, 'error', 'that invite code isn''t valid');
  end if;
  select name into nm from dev_room where id = inv.room_id;
  if exists (select 1 from dev_room_member where room_id = inv.room_id and app_user_id = auth.uid()) then
    return jsonb_build_object('ok', true, 'room_id', inv.room_id, 'name', nm, 'already', true);
  end if;
  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    return jsonb_build_object('ok', false, 'error', 'that invite has been used up');
  end if;
  insert into dev_room_member (room_id, app_user_id) values (inv.room_id, auth.uid());
  update dev_room_invite set uses = uses + 1 where code = c;
  return jsonb_build_object('ok', true, 'room_id', inv.room_id, 'name', nm);
end $$;

-- ── members ─────────────────────────────────────────────────────────────────

create or replace function dev_room_members(p_room uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not (_dev_room_member(p_room) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.app_user_id, 'name', _dev_room_name(m.app_user_id),
           'role', m.role, 'me', m.app_user_id = auth.uid(), 'joined_at', m.joined_at)
         order by m.role desc, m.joined_at), '[]'::jsonb)
    into out from dev_room_member m where m.room_id = p_room;
  return jsonb_build_object('ok', true, 'members', out,
    'admin', is_admin() or exists (select 1 from dev_room_member
      where room_id = p_room and app_user_id = auth.uid() and role = 'admin'));
end $$;

-- An admin removes anyone but the last admin; anyone removes themselves
-- (leaving). The room keeps their messages.
create or replace function dev_room_remove(p_room uuid, p_user uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare isadm boolean;
begin
  isadm := is_admin() or exists (select 1 from dev_room_member
             where room_id = p_room and app_user_id = auth.uid() and role = 'admin');
  if not (isadm or p_user = auth.uid()) then
    return jsonb_build_object('ok', false, 'error', 'only an admin can remove someone');
  end if;
  if exists (select 1 from dev_room_member where room_id = p_room and app_user_id = p_user and role = 'admin')
     and (select count(*) from dev_room_member where room_id = p_room and role = 'admin') <= 1 then
    return jsonb_build_object('ok', false, 'error', 'the room''s last admin can''t leave it');
  end if;
  delete from dev_room_member where room_id = p_room and app_user_id = p_user;
  return jsonb_build_object('ok', true);
end $$;

-- ── messages ────────────────────────────────────────────────────────────────

create or replace function dev_room_post(p_room uuid, p_body text, p_tag text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare b text := btrim(coalesce(p_body, '')); tg text := nullif(lower(btrim(coalesce(p_tag, ''))), ''); mid bigint;
begin
  if not _dev_room_member(p_room) then return jsonb_build_object('ok', false, 'error', 'you''re not in this room'); end if;
  if b = '' then return jsonb_build_object('ok', false, 'error', 'say something — empty messages don''t send'); end if;
  if length(b) > 1000 then return jsonb_build_object('ok', false, 'error', 'keep it under 1000 characters'); end if;
  if tg is not null and tg not in ('idea', 'bug') then return jsonb_build_object('ok', false, 'error', 'a tag is idea or bug'); end if;
  if exists (select 1 from dev_room_message where room_id = p_room and author_id = auth.uid()
               and created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'error', 'easy there — one message every couple of seconds');
  end if;
  insert into dev_room_message (room_id, author_id, body, tag) values (p_room, auth.uid(), b, tg)
    returning id into mid;
  update dev_room_member set last_read = greatest(last_read, mid)
   where room_id = p_room and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

-- Tag or untag a message after the fact: its author or an admin, and only
-- until it is filed (a filed line's issue is its record).
create or replace function dev_room_tag(p_message bigint, p_tag text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m dev_room_message; tg text := nullif(lower(btrim(coalesce(p_tag, ''))), '');
begin
  select * into m from dev_room_message where id = p_message for update;
  if m.id is null or not _dev_room_member(m.room_id) then return jsonb_build_object('ok', false, 'error', 'no such message'); end if;
  if not (m.author_id = auth.uid() or is_admin() or exists (select 1 from dev_room_member
            where room_id = m.room_id and app_user_id = auth.uid() and role = 'admin')) then
    return jsonb_build_object('ok', false, 'error', 'only its author can tag a message');
  end if;
  if tg is not null and tg not in ('idea', 'bug') then return jsonb_build_object('ok', false, 'error', 'a tag is idea or bug'); end if;
  if m.issue_number is not null or m.filing_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already sent to the issue list');
  end if;
  update dev_room_message set tag = tg where id = p_message;
  return jsonb_build_object('ok', true);
end $$;

-- Latest page (p_before null) or older history. Fetching the latest page
-- marks the room read. Rows come newest-first; clients reverse for display.
create or replace function dev_room_messages(p_room uuid, p_before bigint default null, p_limit int default 50)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 50), 1), 100); out jsonb; top bigint; nm text;
begin
  if not _dev_room_member(p_room) then return jsonb_build_object('ok', false, 'error', 'you''re not in this room'); end if;
  select name into nm from dev_room where id = p_room;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'body', m.body, 'at', m.created_at, 'tag', m.tag,
           'issue', m.issue_number, 'filing', m.filing_at is not null and m.issue_number is null,
           'author', case when m.author_id is null then 'someone' else _dev_room_name(m.author_id) end,
           'author_id', m.author_id, 'mine', m.author_id = auth.uid()) order by m.id desc), '[]'::jsonb)
    into out
    from (select * from dev_room_message
            where room_id = p_room and (p_before is null or id < p_before)
            order by id desc limit lim) m;
  if p_before is null then
    select max(id) into top from dev_room_message where room_id = p_room;
    if top is not null then
      update dev_room_member set last_read = greatest(last_read, top)
       where room_id = p_room and app_user_id = auth.uid();
    end if;
  end if;
  return jsonb_build_object('ok', true, 'name', nm, 'messages', out);
end $$;

-- Delete: the author, or an admin. A filed message keeps its issue on GitHub.
create or replace function dev_room_delete(p_message bigint)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m dev_room_message;
begin
  select * into m from dev_room_message where id = p_message;
  if m.id is null or not (_dev_room_member(m.room_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'no such message');
  end if;
  if not (m.author_id = auth.uid() or is_admin() or exists (select 1 from dev_room_member
            where room_id = m.room_id and app_user_id = auth.uid() and role = 'admin')) then
    return jsonb_build_object('ok', false, 'error', 'only its author can delete a message');
  end if;
  delete from dev_room_message where id = p_message;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function dev_room_create(text), dev_rooms_mine(), dev_room_invite_create(uuid, int),
  dev_room_invites(uuid), dev_room_invite_revoke(text), dev_room_join(text), dev_room_members(uuid),
  dev_room_remove(uuid, uuid), dev_room_post(uuid, text, text), dev_room_tag(bigint, text),
  dev_room_messages(uuid, bigint, int), dev_room_delete(bigint) from public, anon;
grant execute on function dev_room_create(text), dev_rooms_mine(), dev_room_invite_create(uuid, int),
  dev_room_invites(uuid), dev_room_invite_revoke(text), dev_room_join(text), dev_room_members(uuid),
  dev_room_remove(uuid, uuid), dev_room_post(uuid, text, text), dev_room_tag(bigint, text),
  dev_room_messages(uuid, bigint, int), dev_room_delete(bigint) to authenticated;
