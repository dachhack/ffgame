-- 0452: the chat remembers where you were (v0.649.0).
--
-- Opening a chat fetches the latest page, which marks the channel read up to
-- its newest message (0147/0148). That is right for the badge, and wrong for
-- the reader: the mark they came in with — the last message they had seen —
-- was gone before the page was on screen, so the app could not offer "take
-- me back to where I left off".
--
-- Both page RPCs now read the mark BEFORE advancing it and return it as
-- `last_read` (0 when the reader has never opened the channel), with
-- `unread`: how many messages in the channel sit above that mark. The clients
-- land on the newest message as before and, when the first unread one is off
-- the top of the screen, float a "↑ N new · catch up" pill that scrolls to it.
--
-- Bodies are 0148 (chat_messages) and 0351 (dm_messages) with the two
-- fields added; nothing else changes.

create or replace function chat_messages(p_league_id uuid, p_before bigint default null, p_limit int default 50)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 50), 1), 100); me uuid := auth.uid();
        out jsonb; pins jsonb := '[]'::jsonb; top bigint; was bigint := 0; fresh int := 0;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce(jsonb_agg(_chat_message_json(m, me) order by m.id desc), '[]'::jsonb)
    into out
    from (select * from league_message
            where league_id = p_league_id and (p_before is null or id < p_before)
            order by id desc limit lim) m;
  if p_before is null then
    select coalesce(jsonb_agg(_chat_message_json(m, me) order by m.id desc), '[]'::jsonb)
      into pins
      from (select * from league_message where league_id = p_league_id and pinned
              order by id desc limit 5) m;
    -- The mark as it stood when the reader walked in, and what sits above it.
    select coalesce((select last_read from league_chat_read where league_id = p_league_id and app_user_id = me), 0)
      into was;
    select count(*) into fresh from league_message where league_id = p_league_id and id > was;
    select max(id) into top from league_message where league_id = p_league_id;
    if top is not null then
      insert into league_chat_read (league_id, app_user_id, last_read) values (p_league_id, me, top)
        on conflict (league_id, app_user_id) do update set last_read = greatest(league_chat_read.last_read, excluded.last_read);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'messages', out, 'pins', pins, 'last_read', was, 'unread', fresh);
end $$;

create or replace function dm_messages(p_thread_id uuid, p_before bigint default null, p_limit int default 50)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t dm_thread; lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
        out jsonb; top bigint; was bigint := 0; fresh int := 0;
begin
  select * into t from dm_thread where id = p_thread_id and (user_lo = me or user_hi = me);
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'body', m.body, 'at', m.created_at,
           'caption', m.caption,
           'edited_at', m.edited_at,
           'mine', m.author_id = me) order by m.id desc), '[]'::jsonb)
    into out
    from (select * from dm_message
            where thread_id = p_thread_id and (p_before is null or id < p_before)
            order by id desc limit lim) m;
  if p_before is null then
    was := case when t.user_lo = me then t.lo_last_read else t.hi_last_read end;
    select count(*) into fresh from dm_message where thread_id = p_thread_id and id > was;
    select max(id) into top from dm_message where thread_id = p_thread_id;
    if top is not null then
      update dm_thread set
        lo_last_read = case when user_lo = me then greatest(lo_last_read, top) else lo_last_read end,
        hi_last_read = case when user_hi = me then greatest(hi_last_read, top) else hi_last_read end
        where id = p_thread_id;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'messages', out,
    'peer', _chat_display_name(t.league_id, case when t.user_lo = me then t.user_hi else t.user_lo end),
    'last_read', was, 'unread', fresh);
end $$;
