-- 0409 probes: DECLARED — this year's NFL draft class, shown only after the
-- early-entry deadline and until the summer.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function dc_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

do $$
declare n int;
begin
  delete from nfl_prospect where draft_id in ('990001', '990002', '990003');
  n := upsert_nfl_prospects(2027, '[{"draft_id":"990001","espn_id":"8800001","name":"A"},{"draft_id":"990002","espn_id":null,"name":"B"},{"draft_id":"x1","espn_id":"8800009"},{"draft_id":"990003","espn_id":"88a"}]'::jsonb);
  perform dc_true(n = 2, 'dc1 two good rows land; a non-numeric draft id or espn id is refused (got ' || n || ')');
  perform dc_true(nfl_prospect_known(2027) @> array['990001', '990002'], 'dc1a the worker can ask what it holds');

  perform dc_true(not _college_declared('8800001', timestamptz '2027-01-10 12:00+00'), 'dc2 before the deadline: a big board, not declared');
  perform dc_true(_college_declared('8800001', timestamptz '2027-01-20 12:00+00'), 'dc2a after the deadline: declared');
  perform dc_true(_college_declared('8800001', timestamptz '2027-04-24 12:00+00'), 'dc2b draft weekend: still declared');
  perform dc_true(not _college_declared('8800001', timestamptz '2027-08-02 12:00+00'), 'dc2c by August the tag is gone');
  perform dc_true(not _college_declared('8800001', timestamptz '2028-02-01 12:00+00'), 'dc2d a past class does not say next year');
  perform dc_true(not _college_declared('8800002', timestamptz '2027-02-01 12:00+00'), 'dc2e someone else is not');

  -- a re-read keeps a known college id when an entry comes back without one
  perform upsert_nfl_prospects(2027, '[{"draft_id":"990001","espn_id":null}]'::jsonb);
  perform dc_true((select espn_id from nfl_prospect where draft_year = 2027 and draft_id = '990001') = '8800001', 'dc3 a re-read never forgets the id');

  delete from nfl_prospect where draft_id in ('990001', '990002', '990003');
  raise notice 'declared probes done';
end $$;

select 'ALL DECLARED PROBES PASSED' as result;
