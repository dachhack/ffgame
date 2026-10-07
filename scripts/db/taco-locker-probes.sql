-- 0451 probes: THE TACO LOCKER.
--   • locking a team posts one chat card; unlocking posts one; a repeat tap
--     posts nothing;
--   • a locked team cannot drop, cannot add with a drop, cannot offer a trade,
--     and nobody can offer it one — and every refusal says "Taco Locker";
--   • the reader lists it; taco_set_week starts empty and is the worker's.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function tl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function tl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tl_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000062' || u, false); perform set_config('app.email', 'tl' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000006201', 'tl01@test.dev'), ('00000000-0000-0000-0000-000000006202', 'tl02@test.dev'), ('00000000-0000-0000-0000-000000006203', 'tl03@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000006201', 'tl01@test.dev'), ('00000000-0000-0000-0000-000000006202', 'tl02@test.dev'), ('00000000-0000-0000-0000-000000006203', 'tl03@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in ('00000000-0000-0000-0000-000000006201', '00000000-0000-0000-0000-000000006202', '00000000-0000-0000-0000-000000006203');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c int; n0 int; n1 int;
begin
  perform tl_as('01');
  r := create_native_league('TacoLocker', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform tl_ok(r, 'tl0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform tl_as('02'); perform tl_ok(native_join(code, 'TL-B'), 'tl0 B joins');
  perform tl_as('03'); perform tl_ok(native_join(code, 'TL-C'), 'tl0 C joins');
  perform tl_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'tl-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'TLH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006201';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006202';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006203';
  perform tl_ok(native_generate_schedule(lid, 2), 'tl0 the schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, a, 'tl-1', 'draft'), (lid, b, 'tl-2', 'draft'), (lid, b, 'tl-3', 'draft'), (lid, c, 'tl-4', 'draft');
  perform tl_ok(set_transaction_rules(lid, p_waiver_mode => 'rolling', p_fa_mode => 'open'), 'tl0 rolling, FA open');

  -- ── tl1. in: one card ──
  select count(*) into n0 from league_message where league_id = lid and kind = 'txn' and txn ->> 'kind' = 'taco_locker';
  perform tl_ok(commish_lock_team(lid, b, true), 'tl1 B goes in the Taco Locker');
  select count(*) into n1 from league_message where league_id = lid and kind = 'txn' and txn ->> 'kind' = 'taco_locker';
  perform tl_true(n1 = n0 + 1, 'tl1a the league hears it once');
  perform tl_true((select body from league_message where league_id = lid and txn ->> 'kind' = 'taco_locker' order by created_at desc limit 1)
    like '🌮 TL-B is in the Taco Locker%', 'tl1b …by name, with the taco');
  perform tl_ok(commish_lock_team(lid, b, true), 'tl1c a second tap is fine…');
  select count(*) into n1 from league_message where league_id = lid and kind = 'txn' and txn ->> 'kind' = 'taco_locker';
  perform tl_true(n1 = n0 + 1, 'tl1d …and posts nothing');
  perform tl_true((roster_rules(lid) -> 'locked_rosters') @> to_jsonb(array[b]), 'tl1e the reader lists B');
  perform tl_true((select taco_set_week from league_membership where league_id = lid and sleeper_roster_id = b) is null, 'tl1f no lineup set yet — that is the worker''s stamp');
  perform tl_as('03');
  perform tl_refused(commish_lock_team(lid, c, true), 'commissioner only', 'tl1g a member cannot lock');

  -- ── tl2. what the locker refuses, and how it says so ──
  perform tl_as('02');
  perform tl_refused(drop_player(lid, b, 'tl-3'), 'Taco Locker', 'tl2 B cannot drop');
  perform tl_refused(add_free_agent(lid, b, 'tl-11', 'tl-3'), 'Taco Locker', 'tl2a B cannot add with a drop');
  perform tl_refused(add_free_agent(lid, b, 'tl-11', null), 'Taco Locker', 'tl2b …nor add at all while locked (0320''s rule stands)');
  perform tl_refused(propose_trade(lid, b, c, '["tl-2"]'::jsonb, '["tl-4"]'::jsonb, null, null, null), 'Taco Locker', 'tl2c B cannot offer a trade');
  perform tl_as('03');
  perform tl_refused(propose_trade(lid, c, b, '["tl-4"]'::jsonb, '["tl-2"]'::jsonb, null, null, null), 'locked that team', 'tl2d nobody can offer B one');
  perform tl_ok(drop_player(lid, c, 'tl-4'), 'tl2e C, not locked, drops fine');
  perform tl_true((native_team_state(lid) ->> 'wire_block') is null, 'tl2f C''s team screen is clear');
  perform tl_as('02');
  perform tl_true((native_team_state(lid) ->> 'wire_block') ilike '%Taco Locker%', 'tl2g B''s team screen says Taco Locker');

  -- ── tl3. out: one card, and the moves come back ──
  perform tl_as('01');
  perform tl_ok(commish_lock_team(lid, b, false), 'tl3 B comes out');
  select count(*) into n1 from league_message where league_id = lid and kind = 'txn' and txn ->> 'kind' = 'taco_locker';
  perform tl_true(n1 = n0 + 2, 'tl3a the league hears that too');
  perform tl_true((select body from league_message where league_id = lid and txn ->> 'kind' = 'taco_locker' order by created_at desc limit 1)
    = '🌮 TL-B is out of the Taco Locker', 'tl3b …in those words');
  perform tl_as('02');
  perform tl_ok(drop_player(lid, b, 'tl-3'), 'tl3c B drops again');

  raise notice 'taco-locker probes done';
end $$;

select 'ALL TACO-LOCKER PROBES PASSED' as result;
