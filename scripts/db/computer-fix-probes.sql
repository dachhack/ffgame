-- 0415 probes: a closed-issue card serves its report; a snark line doesn't.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function cf_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
do $$
declare card league_message; snark league_message; j jsonb;
begin
  card := row(1, gen_random_uuid(), null, 'Issue #1095 closed. Rams players no longer lock at Thursday''s kickoff.', now(), false, 'computer', null,
              '{}'::uuid[], null, '{"fix":{"issue":1095,"url":"https://github.com/x/y/issues/1095","report":"Cause\n\nThe slate says LA."}}'::jsonb, null, null, null)::league_message;
  j := _chat_message_json(card, null);
  perform cf_true(j ->> 'author' = '💻 Computer' and j ->> 'kind' = 'computer', 'cf1 the card is the computer''s');
  perform cf_true((j -> 'fix' ->> 'issue')::int = 1095 and j -> 'fix' ->> 'report' like 'Cause%', 'cf2 it carries the report');
  snark := row(2, gen_random_uuid(), null, 'Beep boop. (#7)', now(), false, 'computer', null, '{}'::uuid[], null, null, null, null, null)::league_message;
  perform cf_true(not (_chat_message_json(snark, null) ? 'fix'), 'cf3 a receipt line has no card');
end $$;
-- cf4 (0416): the card can actually be stored — 0290's check refused it.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000a51', 'cf01@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000000a51', 'cf01@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id = '00000000-0000-0000-0000-000000000a51';
begin;
do $$
declare r jsonb; lid uuid; ok boolean := false;
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000a51', false);
  r := create_native_league('CardLeague', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;
  perform set_config('app.uid', '', false);
  insert into league_message (league_id, author_id, kind, body, mentions, txn)
    values (lid, null, 'computer', 'Issue #1 closed. X.', '{}', '{"fix":{"issue":1,"report":"r"}}');
  perform cf_true(true, 'cf4 a computer line stores its card');
  begin
    insert into league_message (league_id, author_id, kind, body, mentions, txn) values (lid, null, 'text', 'x', '{}', '{"a":1}');
  exception when check_violation then ok := true;
  end;
  perform cf_true(ok, 'cf4a a text line still can''t carry a payload');
  ok := false;
  begin
    insert into league_message (league_id, author_id, kind, body, mentions) values (lid, null, 'txn', 'x', '{}');
  exception when check_violation then ok := true;
  end;
  perform cf_true(ok, 'cf4b a txn line still needs one');
end $$;
rollback;
\echo ALL COMPUTER-FIX PROBES PASSED
