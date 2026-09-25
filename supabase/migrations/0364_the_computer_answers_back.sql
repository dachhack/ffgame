-- 0364 · THE COMPUTER ANSWERS BACK (v0.538.0)
--
-- Founder: "Could it paste in the chat a generic response that the message was
-- received? Maybe have 20 or so snarky responses banked with a computer icon?"
--
-- A league chat line tagged @computer (0363) now gets a house reply: kind
-- 'computer', no author, rendered as "💻 Computer". It is a new KIND rather than
-- a flag on 'text' so nothing can mistake it for somebody typing — chat_edit
-- already refuses anything authorless or not 'text', and the every-message push
-- skips it with the other house lines.
--
-- Old clients: an unknown kind falls through to the plain-text branch on web
-- and app, and the author name comes from the server — so a build from before
-- this one shows the same "💻 Computer" line with nothing to update.

-- The kind check, by name. (Not 0290's sweep over every check mentioning
-- `kind` — that took a neighbouring constraint with it once already.)
alter table league_message drop constraint if exists league_message_kind_check;
alter table league_message add constraint league_message_kind_check
  check (kind in ('text', 'poll', 'report', 'txn', 'computer'));

-- ── _chat_message_json v7: 0351's body, naming the computer ─────────────────
create or replace function _chat_message_json(m league_message, me uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'body', m.body, 'at', m.created_at,
    'author', case when m.kind = 'computer' then '💻 Computer'
                   when m.author_id is null then 'Drip Fantasy'
                   else _chat_display_name(m.league_id, m.author_id) end,
    'author_id', m.author_id,
    'mine', coalesce(m.author_id = me, false),
    'kind', m.kind,
    'pinned', m.pinned,
    'caption', m.caption,
    'edited_at', m.edited_at,
    -- null for a self-edit: the clients render that as a plain "edited".
    'edited_by', case when m.edited_by is null or m.edited_by = m.author_id
                      then null else _chat_display_name(m.league_id, m.edited_by) end,
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
