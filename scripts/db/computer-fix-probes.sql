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
\echo ALL COMPUTER-FIX PROBES PASSED
