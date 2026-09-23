-- ═══════════════════════════════════════════════════════════════════════════
-- 0351 · THE COMMENT CAN BE CORRECTED — editing a chat message
--
-- Founder: "Let's have long press on a comment to edit it if you are the author
-- or the league commish. The comment adds an edited note with the name of who
-- edited it."
--
-- Until now the only way to fix a typo was chat_delete and say it again, which
-- costs the reactions, the pin and the place in the conversation. This keeps
-- the message and changes the words.
--
-- THE NOTE IS THE POINT, not a footnote to it. An edit that leaves no mark is a
-- commissioner quietly rewriting what somebody said, and the person who said it
-- finding out never. So edited_by is a USER, rendered as a name — because the
-- question a reader actually has is not "was this changed" but "who changed
-- it". Both are set in the same statement as the new text; there is no path
-- through this function that edits without signing.
--
-- WHAT CANNOT BE EDITED, and why each one is refused rather than left to the
-- clients to hide:
--
--   • THE HOUSE'S OWN LINES. A weekly report or a wire entry (kind 'report' /
--     'txn', author_id null) is the league's record of what happened. The
--     commissioner is precisely the person with both the motive and the
--     buttons, so the record is not his to reword.
--   • A POLL. Editing the question after votes are in changes what those votes
--     meant, silently. Delete it and post another; that already works.
--   • THE PICTURE ITSELF. A message whose body is a bare URL is an image or a
--     GIF (0148), and an edit rewrites its CAPTION only. Swapping the URL would
--     strand the uploaded file in the bucket with nothing pointing at it and
--     turn "fix a typo" into "replace the evidence". The body is kept as-is
--     here whatever the client sends, so this holds even for a client that
--     forgets.
--
-- MENTIONS ARE RECOMPUTED, through the same membership filter chat_post uses:
-- adding "@Allen" in an edit has to reach Allen, and removing it has to stop
-- reaching him. The clients derive the ids from the new text (body and caption
-- both) and this re-filters them to people who are really in the league.
--
-- NO EDIT WINDOW. Not an oversight: the author can fix a week-old typo, and the
-- record of who touched it is what makes that safe rather than a clock is.
-- ═══════════════════════════════════════════════════════════════════════════

alter table league_message add column if not exists edited_at timestamptz;
alter table league_message add column if not exists edited_by uuid references app_user(id) on delete set null;

-- Is this body a bare URL — i.e. a picture or a GIF, whose words live in the
-- caption? Mirrors isBareUrlBody in core/data/chatEdit.ts; check:chatedit holds
-- the two together.
create or replace function _chat_is_media_body(p text) returns boolean
  language sql immutable as $$
  select btrim(coalesce(p, '')) ~ '^https?://[^[:space:]]+$';
$$;

create or replace function chat_edit(p_league_id uuid, p_id bigint, p_body text,
                                     p_mentions uuid[] default '{}', p_caption text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m league_message; me uuid := auth.uid(); b text; cap text; men uuid[];
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into m from league_message where id = p_id and league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such message'); end if;
  if m.author_id is null or m.kind <> 'text' then
    return jsonb_build_object('ok', false, 'error', 'that one is not yours to reword');
  end if;
  if not (m.author_id = me or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'only the author or the commissioner can edit a message');
  end if;

  -- A picture keeps its picture: the stored body wins over whatever arrived.
  if _chat_is_media_body(m.body) then
    b := m.body;
    begin cap := _chat_clean_caption(p_caption);
    exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
  else
    begin b := _chat_clean_body(p_body); cap := _chat_clean_caption(p_caption);
    exception when others then return jsonb_build_object('ok', false, 'error', sqlerrm); end;
  end if;

  -- Nothing actually changed: say so rather than stamping an edit on a message
  -- somebody opened and closed again.
  if b = m.body and cap is not distinct from m.caption then
    return jsonb_build_object('ok', true, 'unchanged', true);
  end if;

  select coalesce(array_agg(distinct u), '{}') into men from (
    select unnest(p_mentions[1:8]) u) s
    where u is not null and u <> m.author_id
      and (exists (select 1 from league_membership lm where lm.league_id = p_league_id and lm.app_user_id = u)
           or exists (select 1 from team_manager tm where tm.league_id = p_league_id and tm.app_user_id = u)
           or exists (select 1 from league l where l.id = p_league_id and l.commissioner_id = u));

  update league_message
     set body = b, caption = cap, mentions = men, edited_at = now(), edited_by = me
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id,
    'edited_at', now(), 'edited_by', _chat_display_name(p_league_id, me));
end $$;

-- ── _chat_message_json v6: 0350's body, carrying the edit ───────────────────
-- edited_by comes back as a NAME. A uuid would make every client join the
-- member list to render three words, and the app already has enough to do.
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
    'edited_at', m.edited_at,
    'edited_by', case when m.edited_by is null then null else _chat_display_name(m.league_id, m.edited_by) end,
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

grant execute on function chat_edit(uuid, bigint, text, uuid[], text) to authenticated;
grant execute on function _chat_is_media_body(text) to authenticated, anon;
