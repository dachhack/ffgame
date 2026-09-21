-- 0317 probes: NO DROPS AFTER KICKOFF.
--
-- What must hold, in a DRIP league (0179's trigger never covered it):
--   • a player whose game in the live week has kicked off cannot be dropped
--     outright, cannot be the drop on a free-agent add, and cannot be named
--     as the drop on a waiver claim — each refused with an answer, not a raise;
--   • a player with no game yet (or no game at all) moves freely;
--   • a claim filed BEFORE its drop kicked off and settled AFTER: the drop
--     stays, the claim wins into an open seat with a note, and loses with the
--     reason when the seat was full;
--   • the moment the week is final the lock lets go.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function dl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function dl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function dl_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function dl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000008' || u, false); perform set_config('app.email', 'dl' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000801', 'dl01@test.dev'), ('00000000-0000-0000-0000-000000000802', 'dl02@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000000801', 'dl01@test.dev'), ('00000000-0000-0000-0000-000000000802', 'dl02@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in ('00000000-0000-0000-0000-000000000801', '00000000-0000-0000-0000-000000000802');

do $$
declare r jsonb; lid uuid; code text; a int; b int; wk int; c1 uuid; c2 uuid; i int; n int;
begin
  perform dl_as('01');
  r := create_native_league('DropLock', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'drip');
  perform dl_ok(r, 'dl0 drip league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform dl_true(coalesce((select settings_json ->> 'game_mode' from league where id = lid), 'drip') = 'drip', 'dl0 it is a drip league');
  perform dl_as('02'); perform dl_ok(native_join(code, 'DL-B'), 'dl0 B takes a seat'); perform dl_as('01');
  -- DLH plays this week (and has kicked off); DLZ has no game on the slate.
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'dl-' || g, 'full', 'Player ' || g, 'pos', 'RB',
                                        'team', case when g <= 30 then 'DLH' else 'DLZ' end, 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000801';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000802';
  perform dl_ok(native_generate_schedule(lid, 2), 'dl0 the schedule');
  update draft set status = 'complete' where league_id = lid;
  select league_live_week(lid) into wk;
  perform dl_true(wk is not null, 'dl0 the league has a live week');
  perform set_config('probe.dl_lid', lid::text, false);
  perform set_config('probe.dl_wk', wk::text, false);
  perform dl_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'open', p_waiver_clear_min => -1), 'dl0 faab, FA open');
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'dl-1', 'draft'), (lid, a, 'dl-2', 'draft'), (lid, a, 'dl-31', 'draft'), (lid, a, 'dl-32', 'draft'),
    (lid, b, 'dl-3', 'draft');
  perform dl_true(drop_lock_reason(lid, 'dl-1') is null, 'dl0 before kickoff nobody is locked');

  -- DLH kicks off, six hours ago.
  insert into nfl_slate (season, week, win, home, away, kickoff)
    values ('2026', wk, 'sun_early', 'DLH', 'DLA', now() - interval '6 hours')
    on conflict (season, week, home) do update set kickoff = excluded.kickoff;
  perform dl_true(drop_lock_reason(lid, 'dl-1') ilike '%can''t be dropped%', 'dl0 and dl-1 is now locked (got ' || coalesce(drop_lock_reason(lid, 'dl-1'), 'null') || ')');
  perform dl_true(drop_lock_reason(lid, 'dl-31') is null, 'dl0 a player with no game is not');

  -- ── dl1. drop_player ──
  r := drop_player(lid, a, 'dl-1'); perform dl_refused(r, 'can''t be dropped', 'dl1 a started player cannot be dropped');
  perform dl_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'dl-1'), 'dl1 he is still on the roster');
  perform dl_ok(drop_player(lid, a, 'dl-31'), 'dl1 a player without a game drops fine');

  -- ── dl2. add_free_agent with a drop ──
  r := add_free_agent(lid, a, 'dl-33', 'dl-1'); perform dl_refused(r, 'can''t be dropped', 'dl2 an add cannot drop a started player');
  perform dl_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'dl-1')
    and not exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'dl-33'), 'dl2 nothing moved');
  perform dl_ok(add_free_agent(lid, a, 'dl-33', 'dl-32'), 'dl2 the same add dropping an unstarted player goes through');
  perform dl_ok(add_free_agent(lid, a, 'dl-4', null), 'dl2 a started player may still be ADDED (his windows are simply locked)');

  -- ── dl3. submit_waiver_claim naming the drop ──
  perform dl_ok(set_transaction_rules(lid, p_fa_mode => 'off'), 'dl3 free agency off, so claims are the way in');
  r := submit_waiver_claim(lid, a, 'dl-5', 'dl-1', 1); perform dl_refused(r, 'can''t be dropped', 'dl3 a started player cannot be named as the drop');
  r := submit_waiver_claim(lid, a, 'dl-5', 'dl-33', 1); perform dl_ok(r, 'dl3 naming an unstarted drop is fine'); c1 := (r ->> 'claim_id')::uuid;
  perform dl_ok(cancel_waiver_claim(c1), 'dl3 (tidy) cancelled');

  -- ── dl4. the run: filed before kickoff, settled after ──
  -- Move the kickoff ahead, file against dl-2, then bring the kickoff back.
  update nfl_slate set kickoff = now() + interval '6 hours' where season = '2026' and week = wk and home = 'DLH';
  perform dl_true(drop_lock_reason(lid, 'dl-2') is null, 'dl4 unlocked while the kickoff is ahead');
  r := submit_waiver_claim(lid, a, 'dl-6', 'dl-2', 2); perform dl_ok(r, 'dl4 A: add dl-6 drop dl-2'); c1 := (r ->> 'claim_id')::uuid;
  update nfl_slate set kickoff = now() - interval '6 hours' where season = '2026' and week = wk and home = 'DLH';
  update waiver_claim set clears_at = now() - interval '1 second' where id = c1;
  r := process_waivers(lid); perform dl_ok(r, 'dl4 the run');
  perform dl_true((select status from waiver_claim where id = c1) = 'won', 'dl4 the claim wins — the seat had room (got ' || (select status || '/' || coalesce(note, '') from waiver_claim where id = c1) || ')');
  perform dl_true((select drop_slug from waiver_claim where id = c1) is null
    and (select note from waiver_claim where id = c1) ilike '%game had started%', 'dl4 its row says the drop was kept');
  perform dl_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'dl-2')
    and exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'dl-6'), 'dl4 dl-2 stays, dl-6 arrives');
  -- Now a FULL seat: the same claim loses with the reason.
  i := 10; n := 0;
  while roster_seat_error(lid, a, null) is null and n < 30 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, a, 'dl-' || i, 'draft'); i := i + 1; n := n + 1;
  end loop;
  perform dl_true(roster_seat_error(lid, a, null) is not null, 'dl4 A is full');
  update nfl_slate set kickoff = now() + interval '6 hours' where season = '2026' and week = wk and home = 'DLH';
  r := submit_waiver_claim(lid, a, 'dl-25', 'dl-2', 2); perform dl_ok(r, 'dl4 full: add dl-25 drop dl-2'); c2 := (r ->> 'claim_id')::uuid;
  update nfl_slate set kickoff = now() - interval '6 hours' where season = '2026' and week = wk and home = 'DLH';
  update waiver_claim set clears_at = now() - interval '1 second' where id = c2;
  r := process_waivers(lid); perform dl_ok(r, 'dl4 the run, full');
  perform dl_true((select status from waiver_claim where id = c2) = 'lost'
    and (select note from waiver_claim where id = c2) ilike 'drop player''s game has started%', 'dl4 full: it loses with the reason (got ' || coalesce((select note from waiver_claim where id = c2), 'null') || ')');
  perform dl_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'dl-2')
    and not exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'dl-25'), 'dl4 full: nothing moved');
  perform dl_true((select count(*) from waiver_claim where league_id = lid and status = 'pending') = 0, 'dl4 the run settled everything (nothing aborted)');

  -- ── dl5. the week goes final: the lock lets go ──
  update matchup set status = 'final' where league_id = lid and week = wk;
  perform dl_true(league_live_week(lid) is distinct from wk, 'dl5 the live week moved on');
  perform dl_true(drop_lock_reason(lid, 'dl-1') is null, 'dl5 dl-1 unlocked');
  perform dl_ok(drop_player(lid, a, 'dl-1'), 'dl5 and drops');
end $$;

-- ── dl6. the classic league's agent seat: the worker used to pass the trigger ──
do $$
declare r jsonb; lid uuid; a int; wk int;
begin
  perform dl_as('01');
  r := create_native_league('DropLockClassic', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform dl_ok(r, 'dl6 classic league'); lid := (r ->> 'league_id')::uuid;
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'dc-' || g, 'full', 'Classic ' || g, 'pos', 'RB', 'team', 'DLH', 'exp', 0))
    from generate_series(1, 20) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000801';
  perform dl_ok(native_generate_schedule(lid, 2), 'dl6 the schedule');
  update draft set status = 'complete' where league_id = lid;
  select league_live_week(lid) into wk;
  perform dl_ok(set_transaction_rules(lid, p_fa_mode => 'open', p_agent_waivers => true), 'dl6 FA open, agents may transact');
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, a, 'dc-1', 'draft');
  insert into nfl_slate (season, week, win, home, away, kickoff)
    values ('2026', wk, 'sun_early', 'DLH', 'DLA', now() - interval '6 hours')
    on conflict (season, week, home) do update set kickoff = excluded.kickoff;
  -- As the SERVER (no uid), over a seat nobody holds: the 0179 trigger waves
  -- the worker through; the RPC now answers for it.
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000008a1', 'agent-dl@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000008a1', 'agent-dl@test.dev') on conflict (id) do nothing;
  update league_membership set app_user_id = null, enrolled = false where league_id = lid and sleeper_roster_id = a;
  insert into seat_agent (league_id, roster_id, agent_user_id) values (lid, a, '00000000-0000-0000-0000-0000000008a1') on conflict do nothing;
  perform set_config('app.uid', '', false);
  perform dl_true(agent_wire_seat(lid, a), 'dl6 the seat is an agent seat');
  r := add_free_agent(lid, a, 'dc-2', 'dc-1'); perform dl_refused(r, 'can''t be dropped', 'dl6 the worker cannot cut a started player either');
  perform dl_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'dc-1'), 'dl6 he stays');
end $$;

select 'ALL DROP-LOCK PROBES PASSED' as result;
