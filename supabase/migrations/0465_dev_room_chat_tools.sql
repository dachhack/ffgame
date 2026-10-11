-- 0465: THE DEV ROOM GETS EVERY CHAT TOOL (v0.663.0).
--
-- Founder: "Let's have all chat tools in the dev chat, pics, gifs, polls,
-- reactions, @, etc." League chat built them over 0147–0351; the dev room
-- (0459) had plain text and an idea/bug tag. This gives it the same set, in
-- its own tables and behind its own gate (_dev_room_member), with the same
-- shapes, so both clients render it with league chat's own pieces:
--
--   • PICTURES — an image message is a message whose body is the image URL, as
--     in league chat (0349), plus a caption. Uploads go to the same public
--     `chat-image` bucket under `dev/<room>/<author>/<file>`; the policies
--     below let a room member write their own folder, and the author or a room
--     admin delete.
--   • GIFs — a body that is a GIF URL from the picker; nothing server-side,
--     exactly as league chat (0148).
--   • POLLS — kind 'poll' with options; any member may post one (the room is
--     for asking), and anyone votes and re-votes.
--   • REACTIONS — the league's six (_chat_reaction_ok), toggled.
--   • @MENTIONS — ids on the message, kept only if they are room members.
--   • EDITS and PINS — the author edits (a picture's caption, for a picture);
--     a room admin pins, up to five.
--   • CATCH-UP — dev_room_messages returns last_read and the unread count, so
--     the "N new" pill works as it does in league chat.
--
--   • @COMPUTER — then (founder: "let's not have the chat/bug/suggestion
--     distinction. just a chat window. allow at computer for everyone in dev
--     chat"): a dev room line that says @computer becomes a GitHub issue,
--     from ANY member — league chat's pipeline (server/src/computer.js), with
--     the room as a third source. Its house reply and, when the issue closes,
--     its fix card (`fix`, as league chat's txn.fix — 0415) post into the room
--     as kind 'computer', authored by nobody. The idea/bug tag is left in the
--     tables but no client sets it any more.

alter table dev_room_message add column if not exists kind text not null default 'text';
alter table dev_room_message drop constraint if exists dev_room_message_kind_check;
alter table dev_room_message add constraint dev_room_message_kind_check check (kind in ('text', 'poll', 'computer'));
alter table dev_room_message add column if not exists poll jsonb;
alter table dev_room_message add column if not exists mentions uuid[] not null default '{}';
alter table dev_room_message add column if not exists caption text;
alter table dev_room_message add column if not exists pinned boolean not null default false;
alter table dev_room_message add column if not exists edited_at timestamptz;
alter table dev_room_message add column if not exists edited_by uuid references app_user(id) on delete set null;
alter table dev_room_message add column if not exists fix jsonb;

-- @computer from the dev room: a third source for the ask ledger (0363).
alter table computer_ask drop constraint if exists computer_ask_source_check;
alter table computer_ask add constraint computer_ask_source_check check (source in ('league', 'dm', 'dev'));

create table if not exists dev_room_reaction (
  message_id   bigint not null references dev_room_message(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  emoji        text not null,
  created_at   timestamptz not null default now(),
  primary key (message_id, app_user_id, emoji)
);
alter table dev_room_reaction enable row level security;   -- no policies: RPC-only

create table if not exists dev_room_poll_vote (
  message_id   bigint not null references dev_room_message(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  choice       int not null,
  primary key (message_id, app_user_id)
);
alter table dev_room_poll_vote enable row level security;  -- no policies: RPC-only

-- ── helpers ─────────────────────────────────────────────────────────────────

-- The members a mention may name: room members, not the author. Capped at 50
-- (an @all in a big room still notifies, just not unboundedly).
create or replace function _dev_room_mentions(p_room uuid, p_ids uuid[]) returns uuid[]
  language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct u), '{}') from (select unnest(coalesce(p_ids, '{}')) u) s
   where u is not null and u <> auth.uid()
     and exists (select 1 from dev_room_member m where m.room_id = p_room and m.app_user_id = u);
$$;

create or replace function _dev_room_msg_json(m dev_room_message, me uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'body', m.body, 'at', m.created_at, 'tag', m.tag, 'kind', m.kind,
    'issue', m.issue_number, 'filing', m.filing_at is not null and m.issue_number is null,
    'author', case when m.kind = 'computer' then '💻 Computer' when m.author_id is null then 'someone' else _dev_room_name(m.author_id) end,
    'author_id', m.author_id, 'mine', coalesce(m.author_id = me, false),
    'caption', m.caption, 'pinned', m.pinned, 'edited_at', m.edited_at,
    'mentions_me', coalesce(me = any (m.mentions), false),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('emoji', e, 'n', n, 'mine', mine) order by n desc, e), '[]'::jsonb)
                    from (select r.emoji as e, count(*)::int as n, bool_or(r.app_user_id = me) as mine
                            from dev_room_reaction r where r.message_id = m.id group by r.emoji) x))
  || case when m.kind = 'poll' then jsonb_build_object('poll', jsonb_build_object(
       'options', (select coalesce(jsonb_agg(jsonb_build_object('text', o.opt,
                      'votes', (select count(*) from dev_room_poll_vote v where v.message_id = m.id and v.choice = o.i)) order by o.i), '[]'::jsonb)
                     from (select opt, (row_number() over () - 1)::int as i from jsonb_array_elements_text(m.poll) opt) o),
       'total', (select count(*) from dev_room_poll_vote v where v.message_id = m.id),
       'mine', (select v.choice from dev_room_poll_vote v where v.message_id = m.id and v.app_user_id = me)))
     when m.kind = 'computer' and m.fix is not null then jsonb_build_object('fix', m.fix)
     else '{}'::jsonb end;
$$;

-- ── posting ─────────────────────────────────────────────────────────────────
drop function if exists dev_room_post(uuid, text, text);
create or replace function dev_room_post(p_room uuid, p_body text, p_tag text default null,
                                         p_mentions uuid[] default '{}', p_caption text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare b text := btrim(coalesce(p_body, '')); tg text := nullif(lower(btrim(coalesce(p_tag, ''))), '');
        cap text := nullif(btrim(coalesce(p_caption, '')), ''); mid bigint;
begin
  if not _dev_room_member(p_room) then return jsonb_build_object('ok', false, 'error', 'you''re not in this room'); end if;
  if b = '' then return jsonb_build_object('ok', false, 'error', 'say something — empty messages don''t send'); end if;
  if length(b) > 1000 then return jsonb_build_object('ok', false, 'error', 'keep it under 1000 characters'); end if;
  if cap is not null and length(cap) > 280 then return jsonb_build_object('ok', false, 'error', 'keep the caption under 280 characters'); end if;
  if tg is not null and tg not in ('idea', 'bug') then return jsonb_build_object('ok', false, 'error', 'a tag is idea or bug'); end if;
  if exists (select 1 from dev_room_message where room_id = p_room and author_id = auth.uid()
               and created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'error', 'easy there — one message every couple of seconds');
  end if;
  insert into dev_room_message (room_id, author_id, body, tag, mentions, caption)
    values (p_room, auth.uid(), b, tg, _dev_room_mentions(p_room, p_mentions[1:50]), cap)
    returning id into mid;
  update dev_room_member set last_read = greatest(last_read, mid)
   where room_id = p_room and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

create or replace function dev_room_post_poll(p_room uuid, p_question text, p_options text[])
  returns jsonb language plpgsql security definer set search_path = public as $$
declare q text := btrim(coalesce(p_question, '')); opts text[]; mid bigint;
begin
  if not _dev_room_member(p_room) then return jsonb_build_object('ok', false, 'error', 'you''re not in this room'); end if;
  if q = '' or length(q) > 200 then return jsonb_build_object('ok', false, 'error', 'ask a question (under 200 characters)'); end if;
  select array_agg(btrim(o)) into opts from unnest(coalesce(p_options, '{}')) o where btrim(o) <> '';
  if coalesce(array_length(opts, 1), 0) < 2 or array_length(opts, 1) > 6 then
    return jsonb_build_object('ok', false, 'error', 'a poll has 2–6 options');
  end if;
  if exists (select 1 from unnest(opts) o where length(o) > 60) then
    return jsonb_build_object('ok', false, 'error', 'keep each option under 60 characters');
  end if;
  insert into dev_room_message (room_id, author_id, body, kind, poll)
    values (p_room, auth.uid(), q, 'poll', to_jsonb(opts)) returning id into mid;
  update dev_room_member set last_read = greatest(last_read, mid)
   where room_id = p_room and app_user_id = auth.uid();
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

create or replace function dev_room_poll_cast(p_message bigint, p_choice int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m dev_room_message;
begin
  select * into m from dev_room_message where id = p_message;
  if m.id is null or m.kind <> 'poll' or not _dev_room_member(m.room_id) then return jsonb_build_object('ok', false, 'error', 'no such poll'); end if;
  if p_choice is null or p_choice < 0 or p_choice >= jsonb_array_length(m.poll) then return jsonb_build_object('ok', false, 'error', 'no such option'); end if;
  insert into dev_room_poll_vote (message_id, app_user_id, choice) values (p_message, auth.uid(), p_choice)
    on conflict (message_id, app_user_id) do update set choice = excluded.choice;
  return jsonb_build_object('ok', true);
end $$;

create or replace function dev_room_react(p_message bigint, p_emoji text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m dev_room_message; was boolean;
begin
  select * into m from dev_room_message where id = p_message;
  if m.id is null or not _dev_room_member(m.room_id) then return jsonb_build_object('ok', false, 'error', 'no such message'); end if;
  if not _chat_reaction_ok(p_emoji) then return jsonb_build_object('ok', false, 'error', 'not a reaction we offer'); end if;
  delete from dev_room_reaction where message_id = p_message and app_user_id = auth.uid() and emoji = p_emoji;
  was := found;
  if not was then insert into dev_room_reaction (message_id, app_user_id, emoji) values (p_message, auth.uid(), p_emoji); end if;
  return jsonb_build_object('ok', true, 'on', not was, 'reactions', _dev_room_msg_json(m, auth.uid()) -> 'reactions');
end $$;

-- The author edits a text message (a picture: its caption). A filed line's
-- issue keeps the words it was filed with.
create or replace function dev_room_edit(p_message bigint, p_body text, p_mentions uuid[] default '{}', p_caption text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m dev_room_message; b text := btrim(coalesce(p_body, '')); cap text := nullif(btrim(coalesce(p_caption, '')), '');
begin
  select * into m from dev_room_message where id = p_message for update;
  if m.id is null or not _dev_room_member(m.room_id) then return jsonb_build_object('ok', false, 'error', 'no such message'); end if;
  if not (m.author_id = auth.uid() or _dev_room_admin(m.room_id)) then return jsonb_build_object('ok', false, 'error', 'only its author can edit a message'); end if;
  if m.kind <> 'text' then return jsonb_build_object('ok', false, 'error', 'a poll can''t be edited'); end if;
  if cap is not null and length(cap) > 280 then return jsonb_build_object('ok', false, 'error', 'keep the caption under 280 characters'); end if;
  if _chat_is_media_body(m.body) then
    update dev_room_message set caption = cap, edited_at = now(), edited_by = auth.uid() where id = p_message;
  else
    if b = '' then return jsonb_build_object('ok', false, 'error', 'say something — empty messages don''t send'); end if;
    if length(b) > 1000 then return jsonb_build_object('ok', false, 'error', 'keep it under 1000 characters'); end if;
    update dev_room_message set body = b, mentions = _dev_room_mentions(m.room_id, p_mentions[1:50]),
           edited_at = now(), edited_by = auth.uid() where id = p_message;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function dev_room_pin(p_message bigint, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m dev_room_message;
begin
  select * into m from dev_room_message where id = p_message;
  if m.id is null or not _dev_room_member(m.room_id) then return jsonb_build_object('ok', false, 'error', 'no such message'); end if;
  if not _dev_room_admin(m.room_id) then return jsonb_build_object('ok', false, 'error', 'only an admin can pin'); end if;
  if coalesce(p_on, false) and not m.pinned
     and (select count(*) from dev_room_message where room_id = m.room_id and pinned) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'five pins at most — unpin one first');
  end if;
  update dev_room_message set pinned = coalesce(p_on, false) where id = p_message;
  return jsonb_build_object('ok', true);
end $$;

-- Latest page or older history, newest first; the latest page marks the room
-- read and says where the reader was (last_read, unread) for the catch-up pill.
create or replace function dev_room_messages(p_room uuid, p_before bigint default null, p_limit int default 50)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 50), 1), 100); out jsonb; pins jsonb; top bigint; nm text; lr bigint; un int;
begin
  if not _dev_room_member(p_room) then return jsonb_build_object('ok', false, 'error', 'you''re not in this room'); end if;
  select name into nm from dev_room where id = p_room;
  select last_read into lr from dev_room_member where room_id = p_room and app_user_id = auth.uid();
  select count(*) into un from dev_room_message
   where room_id = p_room and id > coalesce(lr, 0) and author_id is distinct from auth.uid();
  select coalesce(jsonb_agg(_dev_room_msg_json(m, auth.uid()) order by m.id desc), '[]'::jsonb)
    into out
    from (select * from dev_room_message
            where room_id = p_room and (p_before is null or id < p_before)
            order by id desc limit lim) m;
  select coalesce(jsonb_agg(_dev_room_msg_json(m, auth.uid()) order by m.id desc), '[]'::jsonb)
    into pins from dev_room_message m where m.room_id = p_room and m.pinned;
  if p_before is null then
    select max(id) into top from dev_room_message where room_id = p_room;
    if top is not null then
      update dev_room_member set last_read = greatest(last_read, top)
       where room_id = p_room and app_user_id = auth.uid();
    end if;
  end if;
  return jsonb_build_object('ok', true, 'name', nm, 'messages', out, 'pins', pins,
    'last_read', coalesce(lr, 0), 'unread', un);
end $$;

-- ── pictures: dev/<room>/<author>/<file> in the chat-image bucket ───────────
create or replace function public.dev_image_room(p_name text) returns uuid
  language plpgsql immutable as $$
declare parts text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  if coalesce(array_length(parts, 1), 0) <> 4 or parts[1] <> 'dev' then return null; end if;
  return parts[2]::uuid;
exception when others then return null;
end $$;
create or replace function public.dev_image_author(p_name text) returns uuid
  language plpgsql immutable as $$
declare parts text[] := string_to_array(coalesce(p_name, ''), '/');
begin
  if coalesce(array_length(parts, 1), 0) <> 4 or parts[1] <> 'dev' then return null; end if;
  return parts[3]::uuid;
exception when others then return null;
end $$;
grant execute on function public.dev_image_room(text), public.dev_image_author(text) to authenticated, anon;
grant execute on function public._dev_room_member(uuid), public._dev_room_admin(uuid) to authenticated;

drop policy if exists "dev chat image write" on storage.objects;
drop policy if exists "dev chat image delete" on storage.objects;
create policy "dev chat image write" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-image'
    and public.dev_image_author(name) = auth.uid()
    and public._dev_room_member(public.dev_image_room(name)));
create policy "dev chat image delete" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-image'
    and (public.dev_image_author(name) = auth.uid()
         or public._dev_room_admin(public.dev_image_room(name))));

-- ── grants ──────────────────────────────────────────────────────────────────
revoke all on function _dev_room_mentions(uuid, uuid[]), _dev_room_msg_json(dev_room_message, uuid) from public, anon, authenticated;
revoke all on function dev_room_post(uuid, text, text, uuid[], text), dev_room_post_poll(uuid, text, text[]),
  dev_room_poll_cast(bigint, int), dev_room_react(bigint, text), dev_room_edit(bigint, text, uuid[], text),
  dev_room_pin(bigint, boolean), dev_room_messages(uuid, bigint, int) from public, anon;
grant execute on function dev_room_post(uuid, text, text, uuid[], text), dev_room_post_poll(uuid, text, text[]),
  dev_room_poll_cast(bigint, int), dev_room_react(bigint, text), dev_room_edit(bigint, text, uuid[], text),
  dev_room_pin(bigint, boolean), dev_room_messages(uuid, bigint, int) to authenticated;
