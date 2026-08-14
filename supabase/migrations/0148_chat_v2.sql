-- 0148: CHAT v2 — pinned messages, polls, @mentions (playtest asks, same day
-- as 0147 shipped).
--
--   • PINS — the commissioner pins up to 5 messages; they render in a strip
--     at the top of the league chat until unpinned. Pinning is curation of
--     the conversation, distinct from the LEAGUE NOTE banner (0141), which
--     stays the one standing announcement.
--   • POLLS — the commissioner posts a question with 2–6 options as a chat
--     message (kind='poll'); members vote and re-vote; counts are live in
--     every fetch. No closing mechanic v1 — deleting the message retires the
--     poll (votes cascade).
--   • MENTIONS — a message carries the mentioned members' ids (client sends
--     them from its @-autocomplete; the server keeps only actual league
--     members, capped at 8). The badge RPC now counts messages that mention
--     YOU separately, so "someone said my name" survives a busy channel.
--
-- GIFs need no SQL: a message whose body is an image URL renders inline
-- client-side (allowlisted hosts), and the GIF picker is a client feature.

alter table league_message add column pinned boolean not null default false;
alter table league_message add column kind text not null default 'text' check (kind in ('text', 'poll'));
alter table league_message add column poll jsonb;                       -- poll options: ["...", ...]
alter table league_message add column mentions uuid[] not null default '{}';
create index on league_message(league_id) where pinned;

create table poll_vote (
  message_id   bigint not null references league_message(id) on delete cascade,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  choice       int not null,
  created_at   timestamptz not null default now(),
  primary key (message_id, app_user_id)
);
alter table poll_vote enable row level security;   -- no policies: RPC-only

-- ── message JSON in one place (chat_messages + its pins strip) ──────────────
create or replace function _chat_message_json(m league_message, me uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'body', m.body, 'at', m.created_at,
    'author', _chat_display_name(m.league_id, m.author_id),
    'author_id', m.author_id,
    'mine', m.author_id = me,
    'kind', m.kind,
    'pinned', m.pinned,
    'mentions_me', me = any(m.mentions))
  || case when m.kind = 'poll' then jsonb_build_object('poll', jsonb_build_object(
       'options', (select coalesce(jsonb_agg(jsonb_build_object(
                      'text', o.opt,
                      'votes', (select count(*) from poll_vote v where v.message_id = m.id and v.choice = o.i)
                    ) order by o.i), '[]'::jsonb)
                    from (select opt, (row_number() over ()) - 1 as i
                            from jsonb_array_elements_text(m.poll) opt) o),
       'total', (select count(*) from poll_vote v where v.message_id = m.id),
       'mine', (select v.choice from poll_vote v where v.message_id = m.id and v.app_user_id = me)))
     else '{}'::jsonb end;
$$;

-- ── chat_post v2: + mentions (old 2-arg dropped — PostgREST overloads) ──────
drop function if exists chat_post(uuid, text);
create or replace function chat_post(p_league_id uuid, p_body text, p_mentions uuid[] default '{}')
  returns jsonb language plpgsql security definer set search_path = public as $$
declare b text; mid bigint; men uuid[];
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  begin b := _chat_clean_body(p_body);
  exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
  if exists (select 1 from league_message
               where league_id = p_league_id and author_id = auth.uid()
                 and created_at > now() - interval '2 seconds') then
    return jsonb_build_object('ok', false, 'error', 'easy there — one message every couple of seconds');
  end if;
  -- keep only mentioned users who actually live in this league, cap 8
  select coalesce(array_agg(distinct u), '{}') into men from (
    select unnest(p_mentions[1:8]) u) s
    where u is not null and u <> auth.uid()
      and (exists (select 1 from league_membership lm where lm.league_id = p_league_id and lm.app_user_id = u)
           or exists (select 1 from team_manager tm where tm.league_id = p_league_id and tm.app_user_id = u)
           or exists (select 1 from league l where l.id = p_league_id and l.commissioner_id = u));
  insert into league_message (league_id, author_id, body, mentions) values (p_league_id, auth.uid(), b, men)
    returning id into mid;
  insert into league_chat_read (league_id, app_user_id, last_read) values (p_league_id, auth.uid(), mid)
    on conflict (league_id, app_user_id) do update set last_read = greatest(league_chat_read.last_read, excluded.last_read);
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

-- ── polls ───────────────────────────────────────────────────────────────────
create or replace function chat_post_poll(p_league_id uuid, p_question text, p_options text[])
  returns jsonb language plpgsql security definer set search_path = public as $$
declare q text; opts jsonb; mid bigint; o text; n int := 0;
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'only the commissioner posts polls');
  end if;
  begin q := _chat_clean_body(p_question);
  exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
  opts := '[]'::jsonb;
  foreach o in array coalesce(p_options, '{}') loop
    o := btrim(o);
    if o = '' then continue; end if;
    if length(o) > 60 then return jsonb_build_object('ok', false, 'error', 'keep each option under 60 characters'); end if;
    opts := opts || to_jsonb(o); n := n + 1;
  end loop;
  if n < 2 or n > 6 then
    return jsonb_build_object('ok', false, 'error', 'a poll needs 2–6 options');
  end if;
  insert into league_message (league_id, author_id, body, kind, poll)
    values (p_league_id, auth.uid(), q, 'poll', opts) returning id into mid;
  insert into league_chat_read (league_id, app_user_id, last_read) values (p_league_id, auth.uid(), mid)
    on conflict (league_id, app_user_id) do update set last_read = greatest(league_chat_read.last_read, excluded.last_read);
  return jsonb_build_object('ok', true, 'id', mid);
end $$;

create or replace function poll_cast(p_league_id uuid, p_message_id bigint, p_choice int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m league_message;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into m from league_message where id = p_message_id and league_id = p_league_id and kind = 'poll';
  if not found then return jsonb_build_object('ok', false, 'error', 'no such poll'); end if;
  if p_choice is null or p_choice < 0 or p_choice >= jsonb_array_length(m.poll) then
    return jsonb_build_object('ok', false, 'error', 'pick one of the options');
  end if;
  insert into poll_vote (message_id, app_user_id, choice) values (p_message_id, auth.uid(), p_choice)
    on conflict (message_id, app_user_id) do update set choice = excluded.choice, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- ── pins ────────────────────────────────────────────────────────────────────
create or replace function chat_pin(p_league_id uuid, p_id bigint, p_on boolean)
  returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not (is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'only the commissioner pins');
  end if;
  if p_on and (select count(*) from league_message where league_id = p_league_id and pinned) >= 5 then
    return jsonb_build_object('ok', false, 'error', 'five pins is plenty — unpin one first');
  end if;
  update league_message set pinned = coalesce(p_on, false)
    where id = p_id and league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such message'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ── chat_messages v2: shared shape + pins strip on the latest page ──────────
create or replace function chat_messages(p_league_id uuid, p_before bigint default null, p_limit int default 50)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare lim int := least(greatest(coalesce(p_limit, 50), 1), 100); me uuid := auth.uid();
        out jsonb; pins jsonb := '[]'::jsonb; top bigint;
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
    select max(id) into top from league_message where league_id = p_league_id;
    if top is not null then
      insert into league_chat_read (league_id, app_user_id, last_read) values (p_league_id, me, top)
        on conflict (league_id, app_user_id) do update set last_read = greatest(league_chat_read.last_read, excluded.last_read);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'messages', out, 'pins', pins);
end $$;

-- ── chat_unread v2: mentions counted apart ──────────────────────────────────
create or replace function chat_unread(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); lr bigint; lu int; du int; mu int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce((select last_read from league_chat_read where league_id = p_league_id and app_user_id = me), 0) into lr;
  select count(*) into lu from (
    select 1 from league_message where league_id = p_league_id and id > lr and author_id <> me limit 100) s;
  select count(*) into mu from (
    select 1 from league_message where league_id = p_league_id and id > lr and me = any(mentions) limit 100) s;
  select coalesce(sum(n), 0) into du from (
    select (select count(*) from (
        select 1 from dm_message m where m.thread_id = t.id and m.author_id <> me
          and m.id > case when t.user_lo = me then t.lo_last_read else t.hi_last_read end
        limit 100) c) as n
      from dm_thread t where t.league_id = p_league_id and (t.user_lo = me or t.user_hi = me)
  ) s;
  return jsonb_build_object('ok', true, 'league', lu, 'dm', du, 'mention', mu);
end $$;

grant execute on function chat_post(uuid, text, uuid[]) to authenticated;
grant execute on function chat_post_poll(uuid, text, text[]) to authenticated;
grant execute on function poll_cast(uuid, bigint, int) to authenticated;
grant execute on function chat_pin(uuid, bigint, boolean) to authenticated;
grant execute on function chat_messages(uuid, bigint, int) to authenticated;
grant execute on function chat_unread(uuid) to authenticated;
