-- ═══════════════════════════════════════════════════════════════════════════
-- 0415 · THE CLOSED-ISSUE CARD (v0.598.0).
--
-- Founder: "print a header in the chat from the computer when issues are
-- closed: 'Issue xxx closed. (Short 1-2 sentence description). Click to
-- expand a brief report of the issue and solution'".
--
-- The worker (computer.js relayFixes) posts a 'computer' line whose body is
-- the header and whose txn holds { fix: { issue, url, report, pr? } }. This
-- serves it to the clients as `fix`, which they render as an expandable card.
-- Old clients keep showing the header as a plain "💻 Computer" line.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── _chat_message_json v8: 0364's body, plus a computer line's fix report ──
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
     -- 0415: a closed-issue card carries its report.
     when m.kind = 'computer' and m.txn ? 'fix' then jsonb_build_object('fix', m.txn -> 'fix')
     else '{}'::jsonb end;
$$;
