-- 0318 probes: THE DOOR OPENING CLEARS THE CLAIMS.
--
-- What must hold:
--   • claims filed while free agency was off carry the run's clock; the
--     commissioner opening free agency settles them in that same call —
--     the higher bid wins, nobody adds past them;
--   • the door opened WITHOUT the console (a data fix on settings_json)
--     still makes them due: the next run settles them, and a manager's add
--     on one of them settles the claim first and is refused;
--   • a HELD player's claim is untouched by the open door;
--   • a window arriving is a door opening: the stamp forecasts it, and the
--     window covering now settles it;
--   • agent waivers switched off cancels the worker's pending claims only;
--   • a rolling league (no run) behaves the same at the door.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function do_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function do_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function do_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function do_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000009' || u, false); perform set_config('app.email', 'do' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000901', 'do01@test.dev'), ('00000000-0000-0000-0000-000000000902', 'do02@test.dev'), ('00000000-0000-0000-0000-0000000009b1', 'agent-do@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000000901', 'do01@test.dev'), ('00000000-0000-0000-0000-000000000902', 'do02@test.dev'), ('00000000-0000-0000-0000-0000000009b1', 'agent-do@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000902');

do $$
declare r jsonb; lid uuid; code text; a int; b int; cseat int; c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; run_min int; fs int; fe int; nxt timestamptz;
begin
  perform do_as('01');
  r := create_native_league('DoorOpens', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform do_ok(r, 'do0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform do_as('02'); perform do_ok(native_join(code, 'DO-B'), 'do0 B takes a seat'); perform do_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'do-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'DOH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000901';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000902';
  select min(sleeper_roster_id) into cseat from league_membership where league_id = lid and app_user_id is null;
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, a, 'do-1', 'draft'), (lid, b, 'do-2', 'draft');
  -- The founder's shape: FAAB, a run three hours from now, free agency OFF.
  run_min := (et_minutes(now()) + 180) % 1440;
  perform do_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'off', p_waiver_clear_min => run_min), 'do0 faab, run in 3h, FA off');
  nxt := next_waiver_run(lid);
  perform do_true(nxt > now() + interval '170 minutes' and nxt < now() + interval '190 minutes', 'do0 the next run is ~3h out');

  -- ── do1. claims behind the shut door; the commissioner opens it ──
  r := submit_waiver_claim(lid, a, 'do-10', null, 5); perform do_ok(r, 'do1 A claims do-10 $5'); c1 := (r ->> 'claim_id')::uuid;
  perform do_as('02');
  r := submit_waiver_claim(lid, b, 'do-10', null, 7); perform do_ok(r, 'do1 B claims do-10 $7'); c2 := (r ->> 'claim_id')::uuid;
  perform do_as('01');
  r := submit_waiver_claim(lid, a, 'do-11', null, 1); perform do_ok(r, 'do1 A claims do-11 $1'); c3 := (r ->> 'claim_id')::uuid;
  perform do_true((select clears_at from waiver_claim where id = c1) = nxt and (select clears_at from waiver_claim where id = c3) = nxt,
    'do1 with the door shut the claims wait for the run');
  perform do_true((select count(*) from waiver_claim where league_id = lid and status = 'pending') = 3, 'do1 three pending');
  perform do_ok(set_transaction_rules(lid, p_fa_mode => 'open'), 'do1 the commissioner opens free agency');
  perform do_true((select status from waiver_claim where id = c2) = 'won' and (select status from waiver_claim where id = c1) = 'lost'
    and (select note from waiver_claim where id = c1) = 'outbid', 'do1 the run settles them in the same call: $7 beats $5 (got '
    || (select string_agg(id::text || ':' || status || '/' || coalesce(note, ''), ' ') from waiver_claim where id in (c1, c2)) || ')');
  perform do_true((select status from waiver_claim where id = c3) = 'won', 'do1 and the uncontested one wins');
  perform do_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'do-10')
    and exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'do-11'), 'do1 both on the rosters');
  perform do_true((select count(*) from waiver_claim where league_id = lid and status = 'pending') = 0, 'do1 nothing left waiting for 2pm');

  -- ── do2. the door opened by a data fix, not the console ──
  perform do_ok(set_transaction_rules(lid, p_fa_mode => 'off'), 'do2 shut again');
  r := submit_waiver_claim(lid, a, 'do-12', null, 1); perform do_ok(r, 'do2 A claims do-12'); c4 := (r ->> 'claim_id')::uuid;
  perform do_true((select clears_at from waiver_claim where id = c4) = next_waiver_run(lid), 'do2 stamped with the run');
  update league set settings_json = settings_json || '{"fa_mode": "open"}'::jsonb where id = lid;   -- 0310's way
  perform do_true((select clears_at from waiver_claim where id = c4) = next_waiver_run(lid), 'do2 the stamp still says the run');
  r := process_waivers(lid); perform do_ok(r, 'do2 the next sweep');
  perform do_true((select status from waiver_claim where id = c4) = 'won', 'do2 settles it anyway — the open door is the fact');

  -- ── do3. a manager's add on a claimed player settles the claim first ──
  update league set settings_json = settings_json || '{"fa_mode": "off"}'::jsonb where id = lid;
  r := submit_waiver_claim(lid, a, 'do-13', null, 2); perform do_ok(r, 'do3 A claims do-13'); c5 := (r ->> 'claim_id')::uuid;
  update league set settings_json = settings_json || '{"fa_mode": "open"}'::jsonb where id = lid;
  perform do_as('02');
  r := add_free_agent(lid, b, 'do-13', null); perform do_refused(r, 'already rostered', 'do3 B''s add is refused — the claim got there first');
  perform do_true((select status from waiver_claim where id = c5) = 'won'
    and exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'do-13'), 'do3 A has him');
  perform do_ok(add_free_agent(lid, b, 'do-14', null), 'do3 an unclaimed player adds fine');
  perform do_as('01');

  -- ── do4. a HELD player is not reached by the open door ──
  perform do_ok(drop_player(lid, a, 'do-1'), 'do4 A drops do-1 — onto waivers');
  perform do_true((select waived_until from league_pool where league_id = lid and slug = 'do-1') > now(), 'do4 he is held');
  perform do_as('02');
  r := submit_waiver_claim(lid, b, 'do-1', null, 3); perform do_ok(r, 'do4 B claims the held man'); c6 := (r ->> 'claim_id')::uuid;
  perform do_as('01');
  r := process_waivers(lid); perform do_ok(r, 'do4 a sweep with the door open');
  perform do_true((select status from waiver_claim where id = c6) = 'pending', 'do4 still pending — his hold is on the run''s schedule');
  perform do_ok(set_transaction_rules(lid, p_fa_mode => 'open'), 'do4 (a save while open)');
  perform do_true((select status from waiver_claim where id = c6) = 'pending', 'do4 and a save does not hand him out either');

  -- ── do5. a window is a door: the stamp forecasts it; its arrival settles ──
  perform do_ok(set_transaction_rules(lid, p_fa_mode => 'off'), 'do5 shut');
  r := submit_waiver_claim(lid, a, 'do-15', null, 1); perform do_ok(r, 'do5 A claims do-15'); c1 := (r ->> 'claim_id')::uuid;
  fs := (et_minutes(now()) + 60) % 1440; fe := (fs + 60) % 1440;
  perform do_ok(set_transaction_rules(lid, p_fa_mode => 'window', p_fa_start_min => fs, p_fa_end_min => fe), 'do5 a window an hour from now');
  perform do_true((select clears_at from waiver_claim where id = c1) between now() + interval '55 minutes' and now() + interval '65 minutes',
    'do5 the stamp moved forward to the window (got ' || (select clears_at from waiver_claim where id = c1)::text || ', run ' || next_waiver_run(lid)::text || ')');
  perform do_true((select status from waiver_claim where id = c1) = 'pending', 'do5 not yet');
  fs := (et_minutes(now()) + 1380) % 1440; fe := (et_minutes(now()) + 60) % 1440;   -- now sits inside it
  perform do_ok(set_transaction_rules(lid, p_fa_start_min => fs, p_fa_end_min => fe), 'do5 the window now covers this minute');
  perform do_true((select status from waiver_claim where id = c1) = 'won', 'do5 the door opened: settled in the save');

  -- ── do6. agent waivers off cancels the worker's claims, not a human's ──
  perform do_ok(set_transaction_rules(lid, p_fa_mode => 'off', p_agent_waivers => true), 'do6 shut, agents on');
  insert into seat_agent (league_id, roster_id, agent_user_id) values (lid, cseat, '00000000-0000-0000-0000-0000000009b1') on conflict do nothing;
  perform set_config('app.uid', '', false);
  perform do_true(agent_wire_seat(lid, cseat), 'do6 the open seat is an agent seat');
  r := submit_waiver_claim(lid, cseat, 'do-16', null, 4); perform do_ok(r, 'do6 the worker files for it'); c2 := (r ->> 'claim_id')::uuid;
  perform do_as('01');
  r := submit_waiver_claim(lid, a, 'do-17', null, 1); perform do_ok(r, 'do6 A files too'); c3 := (r ->> 'claim_id')::uuid;
  perform do_ok(set_transaction_rules(lid, p_agent_waivers => false), 'do6 agents off');
  perform do_true((select status from waiver_claim where id = c2) = 'cancelled' and (select note from waiver_claim where id = c2) = 'agent waivers turned off',
    'do6 the worker''s claim is cancelled with the reason');
  perform do_true((select status from waiver_claim where id = c3) = 'pending' and (select status from waiver_claim where id = c6) = 'pending',
    'do6 the humans'' claims stand');
end $$;

-- ── do7. a rolling league (no run) at the door ──
do $$
declare r jsonb; lid uuid; a int; c1 uuid;
begin
  perform do_as('01');
  r := create_native_league('DoorRolling', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform do_ok(r, 'do7 league'); lid := (r ->> 'league_id')::uuid;
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'dr-' || g, 'full', 'Rolling ' || g, 'pos', 'RB', 'team', 'DOH', 'exp', 0))
    from generate_series(1, 20) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000901';
  update draft set status = 'complete' where league_id = lid;
  perform do_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'off', p_waiver_clear_min => -1), 'do7 faab, no run, FA off');
  perform do_true(next_waiver_run(lid) is null, 'do7 no run');
  r := submit_waiver_claim(lid, a, 'dr-5', null, 1); perform do_ok(r, 'do7 A claims dr-5'); c1 := (r ->> 'claim_id')::uuid;
  perform do_true((select clears_at from waiver_claim where id = c1) > now() + interval '23 hours', 'do7 on the 24h clock');
  perform do_ok(set_transaction_rules(lid, p_fa_mode => 'open'), 'do7 the door opens');
  perform do_true((select status from waiver_claim where id = c1) = 'won', 'do7 settled in the save');
end $$;

select 'ALL DOOR-OPENS PROBES PASSED' as result;
