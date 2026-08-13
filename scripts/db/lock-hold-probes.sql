-- 0134/0135 probes: the emergency lock hold and its client peephole.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

do $$
begin
  -- 0134's migration-time insert: week 102 is held on any DB this ran against.
  perform assert_true(exists (select 1 from lock_hold where week = 102), 'h1 week-102 hold present');

  -- The peephole shows the held weeks to any signed-in client…
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000202', false);
  perform assert_true(102 = any (lock_holds()), 'h2 lock_holds() lists the held week');
  perform assert_true(has_function_privilege('authenticated', 'lock_holds()', 'execute'),
    'h3 clients may call the peephole');

  -- …and releasing the hold empties it (then restore for any later suite).
  delete from lock_hold where week = 102;
  perform assert_true(not (102 = any (lock_holds())), 'h4 release is visible immediately');
  insert into lock_hold (week, note) values (102, 'probe restore');

  -- The table itself stays dark: RLS is on with no policies, so PostgREST
  -- callers see nothing but what the peephole chooses to show.
  perform assert_true((select relrowsecurity from pg_class where relname = 'lock_hold'), 'h5 RLS enabled on lock_hold');
  perform assert_true(not exists (select 1 from pg_policies where tablename = 'lock_hold'), 'h6 and no policies open it');
end $$;

select 'ALL LOCK-HOLD PROBES PASSED' as result;
