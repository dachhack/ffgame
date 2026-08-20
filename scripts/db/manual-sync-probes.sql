-- 0204 manual-sync probes: the button, and the cooldown that makes it safe.
--
--   • a NATIVE league has nothing upstream, and is told so rather than queued;
--   • a member may ask; a stranger may not;
--   • pressing twice while one is in flight is the SAME ask, not two rows;
--   • the cooldown runs from the last COMPLETED refresh, so a failed request
--     does not lock the league out for a minute;
--   • inside the cooldown the answer is a refusal that is not an error —
--     ok:true, queued:false, retry_in:N — because nothing went wrong;
--   • the caller cannot backdate `requested_at` to defeat any of it;
--   • and nothing but the RPC can write the table.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; n int; t0 timestamptz;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a',
                 '00000000-0000-0000-0000-00000000000b',
                 '00000000-0000-0000-0000-00000000000c');
  perform probe_as('a');

  r := create_native_league('Refresh', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'ms0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'MS-B'), 'ms0a join'); perform probe_as('a');

  -- ══ A NATIVE LEAGUE HAS NOTHING TO REFRESH ═══════════════════════════════
  -- The case that must be REFUSED rather than queued. Note this is keyed on
  -- `provider`: a native league is minted with a namespaced `native-<uuid>` in
  -- sleeper_league_id because the column is NOT NULL, so an "is it blank" test
  -- would pass for every league in the table and queue work for all of them.
  -- This probe caught exactly that.
  perform assert_true((select provider from league where id = lid) = 'native',
    'ms1pre the fixture really is a native league');
  perform assert_true((select coalesce(sleeper_league_id, '') from league where id = lid) <> '',
    'ms1pre2 …and it still carries a non-empty namespaced id, which is the trap');
  r := request_league_sync(lid);
  perform assert_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'not a Sleeper league',
    'ms1 a native league is told it has no upstream');
  perform assert_true((select count(*) from sync_request where league_id = lid) = 0,
    'ms1a …and no row was written');

  -- The button hides itself on a native league rather than offering a control
  -- that can only ever refuse.
  r := league_sync_state(lid);
  perform assert_true((r ->> 'ok')::boolean and (r ->> 'sleeper')::boolean is false,
    'ms1b a native league reports no upstream, so no button is drawn');

  -- Make it a Sleeper mirror for everything that follows.
  update league set provider = 'sleeper', sleeper_league_id = 'probe-sleeper-1' where id = lid;

  -- ══ A MEMBER MAY ASK; A STRANGER MAY NOT ═════════════════════════════════
  perform probe_as('c');
  r := request_league_sync(lid);
  perform assert_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'forbidden',
    'ms2 a non-member cannot queue a refresh');
  perform assert_true((select count(*) from sync_request where league_id = lid) = 0,
    'ms2a …and a refusal writes nothing');

  perform probe_as('b');                                    -- an ordinary member, not the commish
  r := request_league_sync(lid);
  perform assert_true((r ->> 'queued')::boolean, 'ms3 any member may refresh, not just the commish');
  perform assert_true((r ->> 'pending')::boolean is false, 'ms3a the first ask is not already pending');
  perform assert_true((select count(*) from sync_request where league_id = lid) = 1, 'ms3b one row');
  select requested_at into t0 from sync_request where league_id = lid;

  -- ══ PRESSING AGAIN WHILE IN FLIGHT IS THE SAME ASK ═══════════════════════
  r := request_league_sync(lid);
  perform assert_true((r ->> 'queued')::boolean and (r ->> 'pending')::boolean,
    'ms4 a second press while pending is answered yes, and says it is pending');
  perform assert_true((select count(*) from sync_request where league_id = lid) = 1,
    'ms4a …and does not stack a second row');
  perform assert_true((select requested_at from sync_request where league_id = lid) = t0,
    'ms4b …and does not push the in-flight request''s timestamp forward');

  -- state reflects it, so the button can show a spinner
  r := league_sync_state(lid);
  perform assert_ok(r, 'ms5 state readable');
  perform assert_true((r ->> 'sleeper')::boolean,
    'ms5pre state says this league IS a Sleeper mirror, so the button belongs on screen');
  perform assert_true((r ->> 'pending')::boolean, 'ms5a state says pending while in flight');
  perform assert_true((r ->> 'retry_in')::int = 0, 'ms5b nothing to wait for while it is running');

  -- ══ THE COOLDOWN RUNS FROM THE LAST COMPLETED REFRESH ════════════════════
  update sync_request set started_at = now(), finished_at = now(), ok = true, note = 'probe'
    where league_id = lid;
  r := request_league_sync(lid);
  perform assert_true((r ->> 'ok')::boolean, 'ms6 a cooldown refusal is NOT an error');
  perform assert_true((r ->> 'queued')::boolean is false, 'ms6a …but it did not queue');
  perform assert_true((r ->> 'retry_in')::int between 1 and manual_sync_cooldown_s(),
    'ms6b …and it says how long to wait');
  perform assert_true((select ok from sync_request where league_id = lid) is true,
    'ms6c …and the completed run is left intact');

  r := league_sync_state(lid);
  perform assert_true((r ->> 'pending')::boolean is false and (r ->> 'retry_in')::int > 0,
    'ms7 state agrees with the refusal');
  perform assert_true((r ->> 'last_ok')::boolean is true, 'ms7a and reports the last outcome');

  -- Past the cooldown it queues again, and CLEARS the previous outcome so the
  -- worker cannot mistake a finished run for this one.
  update sync_request set finished_at = now() - (manual_sync_cooldown_s() + 1) * interval '1 second'
    where league_id = lid;
  r := request_league_sync(lid);
  perform assert_true((r ->> 'queued')::boolean, 'ms8 past the cooldown it queues again');
  perform assert_true((select finished_at from sync_request where league_id = lid) is null
    and (select ok from sync_request where league_id = lid) is null,
    'ms8a …and the previous run''s outcome is cleared');

  -- ══ THE CALLER CANNOT BACKDATE THE REQUEST ═══════════════════════════════
  -- requested_at comes from the server clock inside the function; there is no
  -- parameter for it, so this asserts the shape rather than an attack: a fresh
  -- request is always ~now, whatever the caller wishes.
  perform assert_true(
    (select requested_at from sync_request where league_id = lid) > now() - interval '5 seconds',
    'ms9 requested_at is the server clock');

  -- ══ THE RPC IS THE ONLY DOOR ═════════════════════════════════════════════
  -- Read is granted to members; there is deliberately NO insert/update/delete
  -- policy, so a client holding an anon key cannot write a flattering timestamp
  -- and skip the cooldown.
  perform assert_true((select count(*) from pg_policies
    where tablename = 'sync_request' and cmd = 'SELECT') = 1,
    'ms10 members can read their league''s row');
  perform assert_true((select count(*) from pg_policies
    where tablename = 'sync_request' and cmd <> 'SELECT') = 0,
    'ms10a and nothing but the RPC may write it');
  perform assert_true((select relrowsecurity from pg_class where relname = 'sync_request'),
    'ms10b row security is on');

  delete from sync_request where league_id = lid;
  raise notice 'manual-sync probes done';
end $$;

select 'ALL MANUAL-SYNC PROBES PASSED' as result;
