-- ═══════════════════════════════════════════════════════════════════════════
-- 0350 · A PICTURE WITH SOMETHING TO SAY — captions on an image message
--
-- Founder, on 0349: "it posts instantly after picking. Allow the user to
-- caption the image so they can QC and add any text."
--
-- Two asks in one sentence, and only the second one is SQL. The QC half is the
-- clients': picking now opens a draft — the picture, a caption box, send or
-- discard — instead of firing the moment the library closes. Nothing uploads
-- until send, so a picture you changed your mind about never reaches the
-- bucket at all. This is the other half: somewhere for the words to live.
--
-- WHY A COLUMN AND NOT THE BODY. The obvious move is to post "<url>\n<caption>"
-- and split it client-side — no migration, and it is what 0349 would have
-- predicted. It is also the one option that BREAKS EVERY CLIENT ALREADY OUT
-- THERE. Inline rendering keys on the body being a bare image URL (0148); add
-- a line under it and every build that predates this one — including the APK
-- that shipped an hour ago — stops showing the picture and prints a link
-- instead. A caption is new information, so it gets its own field, and the body
-- stays exactly the URL it has always been: old builds render the picture as
-- they always did and simply do not show the words.
--
-- That is a real cost and worth naming: on a build older than this, a captioned
-- picture arrives without its caption. The picture is the post and the words
-- are the annotation, so losing the annotation for a build or two beats losing
-- the picture — and the app already nags when it is versions behind.
--
-- 300 CHARACTERS, separate from the body's 500. A caption is a remark under a
-- picture; the two limits do not need to share, and a body full of URL should
-- not shrink what somebody is allowed to say about it.
--
-- MENTIONS STILL WORK, with no change here: the clients derive mention ids from
-- the caption as well as the body and send them in p_mentions, which chat_post
-- has always filtered down to real league members.
-- ═══════════════════════════════════════════════════════════════════════════

alter table league_message add column if not exists caption text;
alter table dm_message    add column if not exists caption text;

-- Trimmed, capped, and empty means none. Returns NULL for "no caption" so the
-- column reads the same for a message posted before this migration and a
-- picture posted without a word.
create or replace function _chat_clean_caption(p text) returns text
  language plpgsql immutable as $$
declare c text := btrim(coalesce(p, ''));
begin
  if c = '' then return null; end if;
  if length(c) > 300 then raise exception 'keep the caption under 300 characters'; end if;
  return c;
end $$;

-- ── chat_post v3: + caption ─────────────────────────────────────────────────
-- Dropped and recreated rather than overloaded, as 0148 did for p_mentions:
-- PostgREST cannot choose between two overloads of one name. A client that
-- sends only the first three arguments still resolves — that is what the
-- default is for — so every app build in the wild keeps posting.
drop function if exists chat_post(uuid, text, uuid[]);
create or replace function chat_post(p_league_id uuid, p_body text, p_mentions uuid[] default '{}',
                                     p_caption text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare b text; cap text; mid bigint; men uuid[];
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  begin b := _chat_clean_body(p_body); cap := _chat_clean_caption(p_caption);
  exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
  if exists (select 1 from league_message
               where league_id = p_league_id and author_id = auth.uid()
                 and created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'error', 'easy there — one message every couple of seconds');
  end if;
  select coalesce(array_agg(distinct u), '{}') into men from (
    select unnest(p_mentions[1:8]) u) s
    where u is not null and u <> auth.uid()
      and (exists (select 1 from league_membership lm where lm.league_id = p_league_id and lm.app_user_id = u)
           or exists (select 1 from team_manager tm where tm.league_id = p_league_id and tm.app_user_id = u)
           or exists (select 1 from league l where l.id = p_league_id and l.commissioner_id = u));
  insert into league_message (league_id, author_id, body, mentions, caption)
    values (p_league_id, auth.uid(), b, men, cap) returning id into mid;
  insert into league_chat_read (league_id, app_user_id, last_read) values (p_league_id, auth.uid(), mid)
    on conflict (league_id, app_user_id) do update set last_read = greatest(league_chat_read.last_read, excluded.last_read);
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

-- ── dm_send v2: + caption (0147's body, otherwise unchanged) ────────────────
drop function if exists dm_send(uuid, uuid, text);
create or replace function dm_send(p_league_id uuid, p_to uuid, p_body text, p_caption text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare b text; cap text; lo uuid; hi uuid; tid uuid; mid bigint; me uuid := auth.uid();
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_to is null or p_to = me then
    return jsonb_build_object('ok', false, 'error', 'pick someone else in the league');
  end if;
  if not (exists (select 1 from league_membership lm where lm.league_id = p_league_id and lm.app_user_id = p_to)
          or exists (select 1 from team_manager tm where tm.league_id = p_league_id and tm.app_user_id = p_to)
          or exists (select 1 from league l where l.id = p_league_id and l.commissioner_id = p_to)) then
    return jsonb_build_object('ok', false, 'error', 'they''re not in this league');
  end if;
  begin b := _chat_clean_body(p_body); cap := _chat_clean_caption(p_caption);
  exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
  lo := least(me, p_to); hi := greatest(me, p_to);
  insert into dm_thread (league_id, user_lo, user_hi) values (p_league_id, lo, hi)
    on conflict (league_id, user_lo, user_hi) do update set last_msg_at = now()
    returning id into tid;
  if exists (select 1 from dm_message where thread_id = tid and author_id = me
               and created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'error', 'easy there — one message every couple of seconds');
  end if;
  insert into dm_message (thread_id, author_id, body, caption) values (tid, me, b, cap) returning id into mid;
  update dm_thread set last_msg_at = now(),
    lo_last_read = case when user_lo = me then greatest(lo_last_read, mid) else lo_last_read end,
    hi_last_read = case when user_hi = me then greatest(hi_last_read, mid) else hi_last_read end
    where id = tid;
  return jsonb_build_object('ok', true, 'thread_id', tid, 'id', mid);
end $$;

-- ── _chat_message_json v5: 0290's body, carrying the caption ────────────────
-- One added key, so chat_messages, the pins strip and every other caller pick
-- it up without being touched.
create or replace function _chat_message_json(m league_message, me uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'body', m.body, 'at', m.created_at,
    'author', case when m.author_id is null then 'Drip Fantasy' else _chat_display_name(m.league_id, m.author_id) end,
    'author_id', m.author_id,
    'mine', coalesce(m.author_id = me, false),
    'kind', m.kind,
    'pinned', m.pinned,
    'caption', m.caption,
    'mentions_me', coalesce(me = any(m.mentions), false),
    'reactions', _chat_reactions_json(m.id, me))
  || case when m.kind = 'poll' then jsonb_build_object('poll', jsonb_build_object(
       'options', (select coalesce(jsonb_agg(jsonb_build_object(
                      'text', o.opt,
                      'votes', (select count(*) from poll_vote v where v.message_id = m.id and v.choice = o.i)
                    ) order by o.i), '[]'::jsonb)
                    from (select opt, (row_number() over ()) - 1 as i
                            from jsonb_array_elements_text(m.poll) opt) o),
       'total', (select count(*) from poll_vote v where v.message_id = m.id),
       'mine', (select v.choice from poll_vote v where v.message_id = m.id and v.app_user_id = me)))
     when m.kind = 'report' then jsonb_build_object('report', jsonb_build_object('week', m.report_week))
     when m.kind = 'txn' then jsonb_build_object('txn', m.txn)
     else '{}'::jsonb end;
$$;

-- ── dm_messages v2: 0147's body, carrying the caption ───────────────────────
create or replace function dm_messages(p_thread_id uuid, p_before bigint default null, p_limit int default 50)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t dm_thread; lim int := least(greatest(coalesce(p_limit, 50), 1), 100);
        out jsonb; top bigint;
begin
  select * into t from dm_thread where id = p_thread_id and (user_lo = me or user_hi = me);
  if not found then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'body', m.body, 'at', m.created_at,
           'caption', m.caption,
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

-- ── dm_threads v2: the caption IS the preview when there is one ─────────────
-- The thread list shows the last message's first 80 characters. For a picture
-- that is 80 characters of storage URL — which said nothing even before
-- captions existed, and would go on saying nothing while the words sat one
-- column over.
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
             'preview', (select left(coalesce(m.caption, m.body), 80)
                           from dm_message m where m.thread_id = t.id order by m.id desc limit 1),
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

grant execute on function chat_post(uuid, text, uuid[], text) to authenticated;
grant execute on function dm_send(uuid, uuid, text, text) to authenticated;
grant execute on function dm_messages(uuid, bigint, int) to authenticated;
grant execute on function dm_threads(uuid) to authenticated;
