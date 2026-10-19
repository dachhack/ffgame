-- 0509 · COMPUTER ANSWERS IN DMs (v0.730.20)
--
-- Founder, after an @computer ask in a Gridiron Gang DM was filed (#1372) but
-- nothing came back in the DM: "I'd like it to log an issue and respond that
-- the message was received." League chat and the dev room have always had the
-- house reply (0364); a DM couldn't, because every DM line needed a human
-- author. Now a DM line may have no author when its kind is 'computer', the
-- worker posts the same reply there (server/src/computer.js), and dm_messages
-- says which lines are Computer's so the apps draw them as Computer's, not as
-- the other person's.

alter table dm_message alter column author_id drop not null;
alter table dm_message add column if not exists kind text not null default 'text';
alter table dm_message drop constraint if exists dm_message_author_kind;
alter table dm_message add constraint dm_message_author_kind
  check (author_id is not null or kind = 'computer');

-- ── dm_messages v5: 0452's body, carrying the kind ─────────────────────────
-- `mine` is false (not null) on Computer's lines.
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
           'kind', m.kind,
           'mine', coalesce(m.author_id = me, false)) order by m.id desc), '[]'::jsonb)
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
grant execute on function dm_messages(uuid, bigint, int) to authenticated;

-- ── The asks that waited ───────────────────────────────────────────────────
-- DM asks filed in the last three days (#1372 among them) get the reply they
-- should have had, in their own thread. The worker posts it from now on.
insert into dm_message (thread_id, author_id, kind, body)
select m.thread_id, null, 'computer',
       'Received. Noted and sent to Computer. (#' || a.issue || ')'
  from computer_ask a
  join dm_message m on m.id = a.message_id
 where a.source = 'dm' and a.issue is not null
   and m.created_at > now() - interval '3 days'
   and not exists (select 1 from dm_message r where r.thread_id = m.thread_id and r.kind = 'computer'
                     and r.body like '%(#' || a.issue || ')%');
