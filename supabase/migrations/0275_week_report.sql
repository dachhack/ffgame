-- 0275: THE WEEKLY REPORT (v0.391.0) — one per league per week, in the chat.
--
-- Founder: "Can we get a weekly report for each league in the chat? Weekly
-- report posts with a link you can click to open the report in a pop up."
--
-- Two pieces:
--   • league_report — the built payload (core data/weekReport.ts decides its
--     shape; the worker writes it with the service role the moment a week's
--     finals are stamped). One row per (league, week) — that primary key is
--     what makes the worker's post idempotent across ticks and restarts.
--   • a chat message of kind 'report' — no author (the house speaks; the chat
--     shows "Drip Fantasy"), a one-line body, and `report_week` so the clients
--     know which report the link opens. Read through chat_messages like any
--     other message; deleted by the commissioner like any other message.
--
-- Access stays RPC-only: league_report has RLS and no policies; members read a
-- report through league_report_get, gated exactly like chat_messages.

create table if not exists league_report (
  league_id   uuid not null references league(id) on delete cascade,
  week        int  not null,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (league_id, week)
);
alter table league_report enable row level security;   -- no policies: RPC-only

-- The house posts: author_id may be null, kind may be 'report'.
alter table league_message alter column author_id drop not null;
alter table league_message add column if not exists report_week int;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'league_message'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute format('alter table league_message drop constraint %I', c.conname);
  end loop;
end $$;
alter table league_message add constraint league_message_kind_check
  check (kind in ('text', 'poll', 'report'));
alter table league_message add constraint league_message_report_week_check
  check ((kind = 'report') = (report_week is not null));

-- ── _chat_message_json v3: a null author is the house; a report carries its week
-- Body copied from 0210; the changes are the author/mine lines and the
-- `report` block, so the pins strip picks them up too.
create or replace function _chat_message_json(m league_message, me uuid) returns jsonb
  language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'body', m.body, 'at', m.created_at,
    'author', case when m.author_id is null then 'Drip Fantasy' else _chat_display_name(m.league_id, m.author_id) end,
    'author_id', m.author_id,
    'mine', coalesce(m.author_id = me, false),
    'kind', m.kind,
    'pinned', m.pinned,
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
     else '{}'::jsonb end;
$$;

-- ── the pop-up's read ───────────────────────────────────────────────────────
create or replace function league_report_get(p_league_id uuid, p_week int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare r league_report;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into r from league_report where league_id = p_league_id and week = p_week;
  if not found then return jsonb_build_object('ok', false, 'error', 'no report for that week yet'); end if;
  return jsonb_build_object('ok', true, 'report', r.payload, 'at', r.created_at);
end $$;
grant execute on function league_report_get(uuid, int) to authenticated;

-- ── chat_unread v3: the house's line counts as unread ───────────────────────
-- Body copied from 0148; the one change is `author_id is distinct from me` —
-- with `<>`, a null author (the report) compared as unknown and never badged.
create or replace function chat_unread(p_league_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); lr bigint; lu int; du int; mu int;
begin
  if not (is_league_member(p_league_id) or is_league_commish(p_league_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select coalesce((select last_read from league_chat_read where league_id = p_league_id and app_user_id = me), 0) into lr;
  select count(*) into lu from (
    select 1 from league_message where league_id = p_league_id and id > lr and author_id is distinct from me limit 100) s;
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
