-- 0126 Sleeper-parity waiver probes: reverse-standings priority + clear days.
-- Fixtures are inserted directly (a completed draft is heavy machinery this
-- suite doesn't need to re-prove — native-league-probes owns that).
\set QUIET on
\pset pager off

grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;
create or replace function probe_uid(u text) returns uuid language sql as $$
  select ('00000000-0000-0000-0000-00000000000' || u)::uuid
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;
select probe_as('a');
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- ── 0. fixtures: a "finished" league with standings a > c > b ────────────────
do $$
declare r jsonb; lid uuid; code text; aseat int; bseat int; cseat int;
begin
  perform probe_as('a');
  r := create_native_league('Waiver Probe League', '2026', 4, 7, 60);
  perform assert_ok(r, 'w0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform set_config('probe.wv_lid', lid::text, false);
  perform set_config('probe.wv_lid', lid::text, false);
  perform probe_as('b'); perform assert_ok(native_join(code, 'W-B'), 'w1 b joins');
  perform probe_as('c'); perform assert_ok(native_join(code, 'W-C'), 'w2 c joins');
  select sleeper_roster_id into aseat from league_membership where league_id = lid and app_user_id = probe_uid('a');
  select sleeper_roster_id into bseat from league_membership where league_id = lid and app_user_id = probe_uid('b');
  select sleeper_roster_id into cseat from league_membership where league_id = lid and app_user_id = probe_uid('c');
  perform set_config('probe.wv_a', aseat::text, false);
  perform set_config('probe.wv_b', bseat::text, false);
  perform set_config('probe.wv_c', cseat::text, false);

  -- the draft "happened" (fixture): waivers only process on complete drafts
  update draft set status = 'complete' where league_id = lid;
  -- a small pool + rolling priorities
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'wp1', 'Waiver Target One', 'WR', 'SEA', 1),
    (lid, 'wp2', 'Waiver Target Two', 'RB', 'KC', 2),
    (lid, 'wp3', 'Waiver Target Three', 'TE', 'DAL', 3);
  update league_membership set waiver_priority = sleeper_roster_id where league_id = lid;

  -- standings: a 2-0, c 1-1, b 0-2  →  reverse order: b (worst), c, a
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 1, aseat, cseat, 'final', 100, 50),
    (lid, 2, aseat, bseat, 'final', 100, 40),
    (lid, 3, cseat, bseat, 'final', 60, 50);
end $$;

-- ── 1. reverse-standings priority: the worst record wins the contested claim ─
do $$
declare r jsonb; lid uuid := current_setting('probe.wv_lid')::uuid;
        bseat int := current_setting('probe.wv_b')::int;
        cseat int := current_setting('probe.wv_c')::int; bprio int;
begin
  perform probe_as('a');
  perform assert_ok(set_transaction_rules(lid, p_waiver_mode => 'standings'), 'w3 standings mode accepted');

  -- contested: b (0-2) and c (1-1) both want wp1; c filed FIRST, so created_at
  -- would favor c — the standings rank must beat it
  insert into waiver_claim (league_id, roster_id, add_slug) values (lid, cseat, 'wp1');
  insert into waiver_claim (league_id, roster_id, add_slug) values (lid, bseat, 'wp1');
  select waiver_priority into bprio from league_membership where league_id = lid and sleeper_roster_id = bseat;

  r := process_waivers(lid);
  perform assert_ok(r, 'w4 processed');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = bseat and slug = 'wp1'),
    'w5 the worst record won');
  perform assert_true((select status from waiver_claim where league_id = lid and roster_id = cseat and add_slug = 'wp1') = 'lost',
    'w6 the better record lost');
  -- standings mode never rotates: priority is your record, not a queue
  perform assert_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = bseat) = bprio,
    'w7 no rotation in standings mode');
end $$;

-- ── 2. rolling still rolls (regression) ──────────────────────────────────────
do $$
declare r jsonb; lid uuid := current_setting('probe.wv_lid')::uuid;
        bseat int := current_setting('probe.wv_b')::int;
        cseat int := current_setting('probe.wv_c')::int; maxp int;
begin
  perform probe_as('a');
  perform assert_ok(set_transaction_rules(lid, p_waiver_mode => 'rolling'), 'w8 back to rolling');
  update league_membership set waiver_priority = case sleeper_roster_id when cseat then 1 else 5 end
    where league_id = lid and sleeper_roster_id in (bseat, cseat);
  insert into waiver_claim (league_id, roster_id, add_slug) values (lid, bseat, 'wp2');
  insert into waiver_claim (league_id, roster_id, add_slug) values (lid, cseat, 'wp2');
  r := process_waivers(lid);
  perform assert_ok(r, 'w9 processed');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and roster_id = cseat and slug = 'wp2'),
    'w10 lower priority number wins in rolling');
  select max(waiver_priority) into maxp from league_membership where league_id = lid;
  perform assert_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = cseat) = maxp,
    'w11 winner rotated to the back');
end $$;

-- ── 3. clear days: holds land on a configured day, at the clear time ─────────
do $$
declare lid uuid := current_setting('probe.wv_lid')::uuid; target int; t timestamptz; r jsonb;
begin
  perform probe_as('a');
  -- gates first
  perform assert_err(set_transaction_rules(lid, p_waiver_mode => 'bogus'), 'waiver mode', 'w12 mode gate');
  perform assert_err(set_transaction_rules(lid, p_waiver_clear_dow => '[9]'::jsonb), 'Sunday', 'w13 dow gate');
  perform assert_err(set_transaction_rules(lid, p_waiver_clear_dow => '"wed"'::jsonb), 'list', 'w14 dow shape gate');

  -- pick a single clear day ~3 ET-days out, so the hold (1 day) can't reach it early
  target := extract(dow from (now() + interval '3 days') at time zone 'America/New_York')::int;
  r := set_transaction_rules(lid, p_waiver_clear_min => 180, p_waiver_hold_days => 1,
                             p_waiver_clear_dow => to_jsonb(array[target]));
  perform assert_ok(r, 'w15 dow config accepted');
  t := waiver_hold_until(lid);
  perform assert_true(extract(dow from t at time zone 'America/New_York')::int = target, 'w16 hold lands on the configured day');
  perform assert_true(extract(hour from t at time zone 'America/New_York')::int = 3, 'w17 …at the 3:00am ET clear');
  perform assert_true(t > now(), 'w18 …in the future');

  -- [] clears the schedule → plain daily behavior returns
  perform assert_ok(set_transaction_rules(lid, p_waiver_clear_dow => '[]'::jsonb), 'w19 clear the days');
  t := waiver_hold_until(lid);
  perform assert_true(t > now() and t < now() + interval '2 days', 'w20 daily clear again');

  -- the reader reports the schedule (null now that it was cleared)
  r := roster_rules(lid);
  perform assert_ok(r, 'w21 roster_rules reads');
  perform assert_true(r -> 'waiver_clear_dow' is null or jsonb_typeof(r -> 'waiver_clear_dow') = 'null', 'w22 dow cleared in reader');
end $$;

-- ── 4. FA after waivers, per day (0127) ──────────────────────────────────────
-- Deterministic despite being time-of-day logic: the clear time is set
-- RELATIVE to the current ET minute, so "before the run" and "after the run"
-- are chosen by the probe, not by when CI happens to run it.
do $$
declare lid uuid := current_setting('probe.wv_lid')::uuid;
        today int; nowmin int; r jsonb;
begin
  perform probe_as('a');
  today := extract(dow from now() at time zone 'America/New_York')::int;
  nowmin := et_minutes(now());

  -- shape gates
  perform assert_err(set_transaction_rules(lid, p_fa_after_waivers_dow => '[7]'::jsonb), 'Sunday', 'w23 dow gate');
  perform assert_err(set_transaction_rules(lid, p_fa_after_waivers_dow => '5'::jsonb), 'list', 'w24 shape gate');

  -- today is a wait-day and the run is still an hour out → FA closed
  r := set_transaction_rules(lid,
        p_waiver_clear_min => least(nowmin + 60, 1439),
        p_fa_after_waivers_dow => to_jsonb(array[today]));
  perform assert_ok(r, 'w25 config accepted');
  if nowmin < 1439 - 60 then   -- skip the assert only in the last hour before ET midnight
    perform assert_true(not fa_window_open(lid), 'w26 FA waits for the run');
  end if;

  -- the run already happened today → FA open again
  perform assert_ok(set_transaction_rules(lid, p_waiver_clear_min => greatest(nowmin - 60, 0)), 'w27 run moved behind us');
  if nowmin > 60 then          -- skip only in the first hour after ET midnight
    perform assert_true(fa_window_open(lid), 'w28 FA opens after the run');
  end if;

  -- a wait-day that ISN'T today never blocks
  perform assert_ok(set_transaction_rules(lid,
    p_waiver_clear_min => least(nowmin + 60, 1439),
    p_fa_after_waivers_dow => to_jsonb(array[(today + 3) % 7])), 'w29 other-day config');
  perform assert_true(fa_window_open(lid), 'w30 other days unaffected');

  -- [] clears the gate entirely
  perform assert_ok(set_transaction_rules(lid, p_fa_after_waivers_dow => '[]'::jsonb), 'w31 cleared');
  perform assert_true(fa_window_open(lid), 'w32 no gate, FA open');

  -- the reader reports it for the editors
  perform assert_ok(set_transaction_rules(lid, p_fa_after_waivers_dow => '[2,5]'::jsonb), 'w33 set two days');
  r := roster_rules(lid);
  perform assert_true(r -> 'fa_after_waivers_dow' = '[2,5]'::jsonb, 'w34 reader reports the days');
end $$;

-- ── 5. illegal rosters lose the board (0128) ─────────────────────────────────
-- Runs as the authenticated role: these are trigger probes on RLS'd tables,
-- and the superuser bypasses both.
do $$
declare lid uuid := current_setting('probe.wv_lid')::uuid;
        bseat int := current_setting('probe.wv_b')::int;
        cseat int := current_setting('probe.wv_c')::int;
        mid uuid; i int; caught boolean;
begin
  perform probe_as('a');
  -- b goes ILLEGAL: rounds=7, load the roster to 8 (b already holds wp1)
  for i in 1..7 loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank)
      values (lid, 'ill' || i, 'Illegal Filler ' || i, 'WR', 'SEA', 100 + i);
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, bseat, 'ill' || i, 'commish');
  end loop;
  perform assert_true(roster_illegal_reason(lid, bseat) is not null, 'w35 b is illegal');
  -- a fresh scheduled matchup for the pick writes (week 1 kickoff is future)
  insert into nfl_slate (season, week, home, away, win, kickoff)
    values ('2026', 1, 'SEA', 'KC', 'snf', '2026-09-09T20:20:00-04:00') on conflict do nothing;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 4, bseat, cseat, 'scheduled') returning id into mid;

  set local role authenticated;

  -- b: picks blocked, with the reason in the message
  perform probe_as('b');
  caught := false;
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid, probe_uid('b'), 'snf', 'S1', 'wp1');
  exception when others then
    caught := true;
    perform assert_true(position('over its limits' in SQLERRM) > 0, 'w36b lockout message carries the reason');
  end;
  perform assert_true(caught, 'w36 illegal roster cannot set picks');

  -- b: power-up applies blocked the same way
  caught := false;
  begin
    insert into applied_state (matchup_id, app_user_id, week, payload_json)
      values (mid, probe_uid('b'), 4, '{"buffs": ["probe"]}'::jsonb);
  exception when others then
    caught := true;
    perform assert_true(position('over its limits' in SQLERRM) > 0, 'w37b same message on power-ups');
  end;
  perform assert_true(caught, 'w37 illegal roster cannot apply power-ups');

  -- c (legal): both writes land
  perform probe_as('c');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, probe_uid('c'), 'snf', 'S1', 'wp2');
  insert into applied_state (matchup_id, app_user_id, week, payload_json)
    values (mid, probe_uid('c'), 4, '{}'::jsonb);
  perform assert_true(true, 'w38 legal roster unaffected');

  reset role;

  -- the worker (auth.uid() null) still writes freely — locking rows, reveals
  perform set_config('app.uid', '', false);
  update sealed_pick set locked = true where matchup_id = mid and app_user_id = probe_uid('c');
  perform assert_true(true, 'w39 server writes skip the gate');
  perform probe_as('a');

  -- b drops back to legal (drops always work) → the board unlocks
  delete from native_roster where league_id = lid and roster_id = bseat and slug like 'ill%';
  perform assert_true(roster_illegal_reason(lid, bseat) is null, 'w40 legal again');
  set local role authenticated;
  perform probe_as('b');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, probe_uid('b'), 'snf', 'S1', 'wp1');
  perform assert_true(true, 'w41 picks unlock the moment the roster is legal');
  reset role;
end $$;

select 'ALL WAIVER-RULES PROBES PASSED' as result;
