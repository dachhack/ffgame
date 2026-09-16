-- 0275 week-report probes: the house's weekly write-up in the league chat.
--
-- What must hold:
--   • the worker (service role) stores a league_report and posts a chat line
--     of kind 'report' with no author; the (league, week) key refuses a
--     second report for the same week;
--   • chat_messages shows the line to members as "Drip Fantasy", not mine,
--     kind 'report', carrying the week; the pins strip carries it too;
--   • league_report_get gives members the payload and outsiders 'forbidden';
--     a week without a report says so;
--   • the report line counts as unread like any message;
--   • the commissioner can delete the line, a member cannot;
--   • RLS: a direct league_report read returns nothing to the caller role;
--   • the kind constraint still refuses nonsense, and a report without a
--     week (or a week without a report kind) is refused.
\set QUIET on
\pset pager off

create or replace function wr_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function wr_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function wr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

-- ── 0. fixture: b commissions, c joins, d stays outside ─────────────────────
do $$
declare r jsonb; lid uuid; code text;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Report League', '2026', 4, 7, 60);
  perform wr_ok(r, 'wr0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.wr_lid', lid::text, false);
  perform probe_as('c'); perform wr_ok(native_join(code, 'WR-C'), 'wr1 c joins');
end $$;

-- ── 1. the worker writes the report and the chat line (service role) ────────
do $$
declare lid uuid := current_setting('probe.wr_lid')::uuid; mid bigint;
begin
  insert into league_report (league_id, week, payload)
    values (lid, 3, '{"v":1,"week":3,"league":"Report League","format":"standard","headline":"WR-C led the week with 101.0.","results":[],"standings":[]}'::jsonb);
  insert into league_message (league_id, author_id, kind, report_week, body, mentions)
    values (lid, null, 'report', 3, '📋 Week 3 report — WR-C led the week with 101.0.', '{}') returning id into mid;
  perform set_config('probe.wr_mid', mid::text, false);
  begin
    insert into league_report (league_id, week, payload) values (lid, 3, '{}'::jsonb);
    raise exception 'PROBE FAIL wr2 a second report for the same week went in';
  exception when unique_violation then null; end;
  begin
    insert into league_message (league_id, author_id, kind, report_week, body) values (lid, null, 'report', null, 'x');
    raise exception 'PROBE FAIL wr3 a report line without a week went in';
  exception when check_violation then null; end;
  begin
    insert into league_message (league_id, author_id, kind, report_week, body) values (lid, null, 'text', 3, 'x');
    raise exception 'PROBE FAIL wr4 a text line with a report week went in';
  exception when check_violation then null; end;
  begin
    insert into league_message (league_id, author_id, kind, body) values (lid, null, 'memo', 'x');
    raise exception 'PROBE FAIL wr5 an unknown kind went in';
  exception when check_violation then null; end;
end $$;

-- ── 2. members read it as the house's line; the pop-up read is gated ────────
do $$
declare lid uuid := current_setting('probe.wr_lid')::uuid; mid bigint := current_setting('probe.wr_mid')::bigint;
        r jsonb; m jsonb; n int;
begin
  set local role authenticated;
  perform probe_as('c');
  r := chat_unread(lid);
  perform wr_true((r ->> 'league')::int >= 1, 'wr6 the report line counts as unread');
  r := chat_messages(lid);
  perform wr_ok(r, 'wr7 member reads the channel');
  m := r -> 'messages' -> 0;
  perform wr_true(m ->> 'kind' = 'report', 'wr8 kind is report');
  perform wr_true(m ->> 'author' = 'Drip Fantasy', 'wr9 the house is the author');
  perform wr_true(m -> 'author_id' = 'null'::jsonb, 'wr10 no author id');
  perform wr_true((m ->> 'mine')::boolean is false, 'wr11 not mine');
  perform wr_true((m ->> 'mentions_me')::boolean is false, 'wr12 mentions_me reads false, not null');
  perform wr_true((m -> 'report' ->> 'week')::int = 3, 'wr13 the line carries its week');
  perform wr_true(m ->> 'body' like '📋 Week 3 report%', 'wr14 the body is the headline line');
  r := league_report_get(lid, 3);
  perform wr_ok(r, 'wr15 member opens the report');
  perform wr_true(r -> 'report' ->> 'headline' = 'WR-C led the week with 101.0.', 'wr16 the payload comes back');
  perform wr_err(league_report_get(lid, 4), 'no report', 'wr17 a week without a report says so');
  perform probe_as('b');
  perform wr_ok(league_report_get(lid, 3), 'wr18 commissioner opens the report');
  perform probe_as('d');
  perform wr_err(league_report_get(lid, 3), 'forbidden', 'wr19 outsider cannot open it');
  select count(*) into n from league_report;
  perform wr_true(n = 0, 'wr20 RLS: direct league_report read returns nothing');
  -- pin it: the strip carries the house's line like any other
  perform probe_as('b');
  perform wr_ok(chat_pin(lid, mid, true), 'wr21 commissioner pins the report');
  perform probe_as('c');
  r := chat_messages(lid);
  perform wr_true(r -> 'pins' -> 0 ->> 'kind' = 'report' and r -> 'pins' -> 0 ->> 'author' = 'Drip Fantasy', 'wr22 the pins strip shows it as the house');
  reset role;
end $$;

-- ── 3. moderation: the commissioner deletes it, a member cannot ─────────────
do $$
declare lid uuid := current_setting('probe.wr_lid')::uuid; mid bigint := current_setting('probe.wr_mid')::bigint; n int;
begin
  set local role authenticated;
  perform probe_as('c');
  perform wr_err(chat_delete(lid, mid), 'not yours', 'wr23 a member cannot delete the house line');
  perform probe_as('b');
  perform wr_ok(chat_delete(lid, mid), 'wr24 the commissioner can');
  reset role;
  select count(*) into n from league_message where id = mid;
  perform wr_true(n = 0, 'wr25 and it is gone');
  raise notice 'week-report probes done';
end $$;

-- ── 4. 0277: an admin sees the gate and forces a report ─────────────────────
do $$
declare lid uuid := current_setting('probe.wr_lid')::uuid; r jsonb; n int;
begin
  set local role authenticated;
  perform probe_as('c');
  perform wr_err(admin_week_report_state(lid, 3), 'forbidden', 'wr26 a member cannot read the report gate');
  perform wr_err(admin_request_week_report(lid, 3), 'forbidden', 'wr27 nor force one');
  reset role;
  insert into app_admin (email) values ('b@test.dev') on conflict do nothing;
  set local role authenticated;
  perform probe_as('b');
  r := admin_week_report_state(lid, 3);
  perform wr_ok(r, 'wr28 admin reads the gate');
  perform wr_true((r ->> 'matchups')::int = 0 and (r ->> 'report')::boolean and not (r ->> 'message')::boolean,
    'wr29 the gate shows no matchups, a stored report, and no chat line (deleted in §3)');
  perform wr_err(admin_request_week_report(lid, 3), 'no matchups', 'wr30 a week with no matchups cannot be forced');
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (lid, 3, 1, 2, 'live', 101.0, 90.5);
  set local role authenticated;
  perform probe_as('b');
  r := admin_week_report_state(lid, null);
  perform wr_true((r ->> 'week')::int = 3 and (r ->> 'matchups')::int = 1 and (r ->> 'final')::int = 0
      and (r ->> 'stamped')::int = 1 and r -> 'statuses' ->> 'live' = '1',
    'wr31 null week reads the latest; the gate counts final and stamped apart');
  r := admin_request_week_report(lid, 3);
  perform wr_ok(r, 'wr32 admin forces the report');
  perform wr_true((r ->> 'queued')::boolean, 'wr33 it is queued for the worker');
  r := admin_request_week_report(lid, 3);
  perform wr_true(r ->> 'note' like 'already queued%', 'wr34 a second ask does not queue twice');
  r := admin_week_report_state(lid, 3);
  perform wr_true(r -> 'request' ->> 'requested_at' is not null and r -> 'request' -> 'done_at' = 'null'::jsonb,
    'wr35 the gate shows the open request');
  reset role;
  select count(*) into n from report_request where league_id = lid and week = 3 and done_at is null;
  perform wr_true(n = 1, 'wr36 one open request row');
  -- the worker finishes it
  update report_request set done_at = now() where league_id = lid and week = 3;
  set local role authenticated;
  perform probe_as('b');
  r := admin_request_week_report(lid, 3);
  perform wr_true(r ->> 'id' is not null, 'wr37 once done, a new ask queues afresh');
  reset role;
  raise notice 'week-report probes done';
end $$;

select 'ALL WEEK-REPORT PROBES PASSED' as status;
