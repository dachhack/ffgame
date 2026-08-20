-- 0210: QUICK REACTIONS on chat messages.
--
-- Founder: "can we have quick reactions in chat..Like thumbs up, agree, fire,
-- surprise etc."
--
-- Modelled on `poll_vote` (0148), which is the same shape one row down: a per
-- (message, user) row, RPC-only, no RLS policies, folded into the message JSON
-- by `_chat_message_json` so both the message list AND the pins strip get it
-- without a second query.
--
-- ── A FIXED SET, NOT FREE EMOJI ────────────────────────────────────────────
-- Six reactions, whitelisted in SQL. Free-text emoji would mean unbounded
-- distinct values per message (so the aggregate below stops being a small
-- fixed row), a moderation surface nobody asked for, and a UI that cannot lay
-- itself out because it does not know what is coming. A closed set renders as
-- the same six chips every time, which is the whole point of a QUICK reaction:
-- you are choosing, not composing.
--
-- The set is duplicated in packages/core/src/data/chatReactions.ts. That
-- duplication is real and is checked — check-mentions reads THIS FILE and
-- asserts the two lists match, because a reaction the client offers and the
-- server rejects is a button that does nothing.
--
-- ── ONE PERSON MAY PICK SEVERAL ────────────────────────────────────────────
-- The primary key is (message_id, app_user_id, emoji), not (message, user).
-- Unlike a poll vote — where picking a second option must replace the first —
-- 👍 and 😂 on the same message are not in competition. Tapping the same one
-- again removes it; that is what makes it a toggle rather than a tally.

create table if not exists chat_reaction (
  message_id   bigint not null references league_message(id) on delete cascade,
  app_user_id  uuid   not null references app_user(id) on delete cascade,
  emoji        text   not null,
  created_at   timestamptz not null default now(),
  primary key (message_id, app_user_id, emoji)
);
alter table chat_reaction enable row level security;   -- no policies: RPC-only
-- The read path aggregates per message; every message on screen asks at once.
create index if not exists chat_reaction_msg on chat_reaction (message_id);

-- ── THE WHITELIST ──────────────────────────────────────────────────────────
-- Kept as a function rather than inlined so the toggle and any future caller
-- cannot disagree about what is allowed.
create or replace function _chat_reaction_ok(p_emoji text) returns boolean
  language sql immutable set search_path = public as $$
  select p_emoji = any (array['👍', '👎', '🔥', '😂', '😮', '💯']);
$$;

-- ── THE AGGREGATE, in one place ────────────────────────────────────────────
-- Only reactions that someone has actually used are returned: an array of six
-- zeroes on every message would be most of the payload of a chat page, and the
-- client renders the empty state from its own list anyway.
create or replace function _chat_reactions_json(p_message_id bigint, me uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('emoji', e, 'n', n, 'mine', mine) order by n desc, e), '[]'::jsonb)
  from (
    select r.emoji as e, count(*)::int as n,
           bool_or(r.app_user_id = me) as mine
      from chat_reaction r where r.message_id = p_message_id
     group by r.emoji
  ) s;
$$;

-- ── TOGGLE ─────────────────────────────────────────────────────────────────
create or replace function chat_react(p_league_id uuid, p_message_id bigint, p_emoji text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m league_message; removed boolean := false;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if not _chat_reaction_ok(p_emoji) then
    return jsonb_build_object('ok', false, 'error', 'not one of this league''s reactions');
  end if;
  -- SCOPED TO THE LEAGUE, not just to the id. `league_message.id` is a global
  -- sequence, so without the league_id predicate a member of one league could
  -- react to another league's message by guessing a number — and it would show
  -- up there, to people who never shared a room with them.
  select * into m from league_message where id = p_message_id and league_id = p_league_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no such message'); end if;

  delete from chat_reaction
    where message_id = p_message_id and app_user_id = auth.uid() and emoji = p_emoji;
  if found then
    removed := true;
  else
    insert into chat_reaction (message_id, app_user_id, emoji)
      values (p_message_id, auth.uid(), p_emoji)
      on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true, 'on', not removed,
    'reactions', _chat_reactions_json(p_message_id, auth.uid()));
end $$;

-- ── _chat_message_json v2: + reactions ─────────────────────────────────────
-- Body copied VERBATIM from 0148; the only change is the reactions key, which
-- lands on the pins strip too because both paths call this one function.
create or replace function _chat_message_json(m league_message, me uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'body', m.body, 'at', m.created_at,
    'author', _chat_display_name(m.league_id, m.author_id),
    'author_id', m.author_id,
    'mine', m.author_id = me,
    'kind', m.kind,
    'pinned', m.pinned,
    'mentions_me', me = any(m.mentions),
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
     else '{}'::jsonb end;
$$;

grant execute on function chat_react(uuid, bigint, text) to authenticated;
