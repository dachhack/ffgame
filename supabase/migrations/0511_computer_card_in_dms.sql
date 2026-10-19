-- 0511 · COMPUTER'S CARD IN A DM (v0.730.23)
--
-- Founder: "Can you post in the dm the results of the fix?" and then "this
-- should be identical to the at computer process in regular chat. Please."
-- A league ask's close posts the closed-issue card (0415: a header line, and
-- behind READ THE REPORT what was wrong and how it was fixed); a DM ask's
-- close only sent the asker a push, because a DM line had nowhere to keep the
-- card. Now dm_message has the same `fix` (league_message keeps it in
-- txn.fix), dm_messages returns it, and the worker posts the same card into
-- the DM the ask came from (server/src/computer.js relayFixes / recard).

alter table dm_message add column if not exists fix jsonb;

-- ── dm_messages v6: 0509's body, carrying the card ──────────────────────────
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
           'fix', m.fix,
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
