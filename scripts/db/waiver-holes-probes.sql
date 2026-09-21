-- 0316 probes: THE WAIVER RUN'S HOLES.
--
-- What must hold:
--   • one clock per player: a second claim on a player with a pending claim
--     clears with the earliest clock, and the run settles them together —
--     the higher bid wins, the lower is "outbid";
--   • a claim on a player signed off free agency while it sat is "player
--     taken", not "outbid";
--   • a claim whose drop already left the roster goes through without the
--     drop when the seat has room, and loses when it would need the drop;
--   • a claim from a seat the vampire's wire lock shuts out loses with the
--     reason — the run completes and the coven's own claim wins.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function wh_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function wh_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function wh_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000007' || u, false); perform set_config('app.email', 'wh' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000701', 'wh01@test.dev'), ('00000000-0000-0000-0000-000000000702', 'wh02@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000000701', 'wh01@test.dev'), ('00000000-0000-0000-0000-000000000702', 'wh02@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in ('00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000702');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c1 uuid; c2 uuid; c3 uuid; c4 uuid; i int; n int;
begin
  perform wh_as('01');
  r := create_native_league('WaiverHoles', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform wh_ok(r, 'wh0 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform wh_as('02'); perform wh_ok(native_join(code, 'WH-B'), 'wh0 B takes a seat'); perform wh_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'wh-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'SEA', 'exp', 0))
    from generate_series(1, 30) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000701';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000702';
  update draft set status = 'complete' where league_id = lid;
  -- FAAB, no free agency, NO run time: the rolling 24-hour hold is each claim's clock.
  perform wh_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'off', p_waiver_clear_min => -1), 'wh0 faab, no FA, no run time');
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, a, 'wh-1', 'draft'), (lid, a, 'wh-2', 'draft'), (lid, b, 'wh-3', 'draft');

  -- ── wh1. one clock per player ──
  r := submit_waiver_claim(lid, a, 'wh-9', null, 5); perform wh_ok(r, 'wh1 A claims wh-9 $5'); c1 := (r ->> 'claim_id')::uuid;
  perform wh_true((select clears_at from waiver_claim where id = c1) is not null, 'wh1 a claim without a run carries its own clock');
  perform wh_as('02');
  r := submit_waiver_claim(lid, b, 'wh-9', null, 10); perform wh_ok(r, 'wh1 B claims wh-9 $10, later'); c2 := (r ->> 'claim_id')::uuid;
  perform wh_true((select clears_at from waiver_claim where id = c2) = (select clears_at from waiver_claim where id = c1),
    'wh1 B''s claim shares A''s (earlier) clock');
  -- make them due and run
  update waiver_claim set clears_at = now() - interval '1 second' where id in (c1, c2);
  perform wh_as('01');
  r := process_waivers(lid); perform wh_ok(r, 'wh1 the run');
  perform wh_true((select status from waiver_claim where id = c2) = 'won' and (select status from waiver_claim where id = c1) = 'lost'
    and (select note from waiver_claim where id = c1) = 'outbid', 'wh1 the higher bid wins in one run, the lower is outbid');

  -- ── wh2. taken off free agency while the claim sat: "player taken" ──
  r := submit_waiver_claim(lid, a, 'wh-10', null, 1); perform wh_ok(r, 'wh2 A claims wh-10'); c3 := (r ->> 'claim_id')::uuid;
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, b, 'wh-10', 'fa');   -- B signed him meanwhile
  update waiver_claim set clears_at = now() - interval '1 second' where id = c3;
  r := process_waivers(lid); perform wh_ok(r, 'wh2 the run');
  perform wh_true((select note from waiver_claim where id = c3) = 'player taken', 'wh2 not outbid — taken (got ' || (select note from waiver_claim where id = c3) || ')');

  -- ── wh3. the drop is a means, not a condition ──
  r := submit_waiver_claim(lid, a, 'wh-11', 'wh-1', 2); perform wh_ok(r, 'wh3 A: add wh-11 drop wh-1'); c1 := (r ->> 'claim_id')::uuid;
  r := submit_waiver_claim(lid, a, 'wh-12', 'wh-1', 1); perform wh_ok(r, 'wh3 A: add wh-12 drop wh-1 too'); c2 := (r ->> 'claim_id')::uuid;
  update waiver_claim set clears_at = now() - interval '1 second' where id in (c1, c2);
  r := process_waivers(lid); perform wh_ok(r, 'wh3 the run');
  perform wh_true((select status from waiver_claim where id = c1) = 'won' and (select status from waiver_claim where id = c2) = 'won',
    'wh3 both claims win: the second goes through without its drop (room on the roster)');
  perform wh_true((select drop_slug from waiver_claim where id = c2) is null and (select note from waiver_claim where id = c2) = 'drop had already left the roster',
    'wh3 the second claim''s row says the drop had already left');
  perform wh_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'wh-11')
    and exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'wh-12')
    and not exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'wh-1'), 'wh3 the roster: wh-1 out, wh-11 and wh-12 in');
  -- Now a FULL roster: fill A to the seat count, then the same pair of claims.
  i := 13; n := 0;
  while roster_seat_error(lid, a, null) is null and n < 30 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, a, 'wh-' || i, 'draft'); i := i + 1; n := n + 1;
  end loop;
  perform wh_true(roster_seat_error(lid, a, null) is not null, 'wh3 A is full');
  r := submit_waiver_claim(lid, a, 'wh-25', 'wh-2', 2); perform wh_ok(r, 'wh3 full: add wh-25 drop wh-2'); c3 := (r ->> 'claim_id')::uuid;
  r := submit_waiver_claim(lid, a, 'wh-26', 'wh-2', 1); perform wh_ok(r, 'wh3 full: add wh-26 drop wh-2 too'); c4 := (r ->> 'claim_id')::uuid;
  update waiver_claim set clears_at = now() - interval '1 second' where id in (c3, c4);
  r := process_waivers(lid); perform wh_ok(r, 'wh3 the run, full');
  perform wh_true((select status from waiver_claim where id = c3) = 'won' and (select status from waiver_claim where id = c4) = 'lost'
    and (select note from waiver_claim where id = c4) like 'drop player no longer on roster%', 'wh3 full: the second loses — it needed the drop (got ' || (select note from waiver_claim where id = c4) || ')');

  -- ── wh4. the vampire's lock does not abort the run ──
  r := submit_waiver_claim(lid, b, 'wh-27', null, 3); perform wh_ok(r, 'wh4 B claims wh-27 before the lock'); c1 := (r ->> 'claim_id')::uuid;
  -- The commissioner appoints A the vampire and locks the wire to the coven.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
    || jsonb_build_object('format', 'vampire', 'vampire_rosters', jsonb_build_array(a), 'vampire_wire_lock', true) where id = lid;
  perform wh_true(wire_block_reason(lid, b) is not null and wire_block_reason(lid, a) is null, 'wh4 B is shut out, A (the vampire) is not');
  -- the vampire's own claim, filed under the lock
  delete from native_roster where league_id = lid and roster_id = a and slug = 'wh-13';   -- make room
  r := submit_waiver_claim(lid, a, 'wh-28', null, 1); perform wh_ok(r, 'wh4 the vampire claims wh-28'); c2 := (r ->> 'claim_id')::uuid;
  update waiver_claim set clears_at = now() - interval '1 second' where id in (c1, c2);
  r := process_waivers(lid); perform wh_ok(r, 'wh4 the run completes under the lock');
  perform wh_true((select status from waiver_claim where id = c1) = 'lost' and (select note from waiver_claim where id = c1) like '%vampire%',
    'wh4 the shut-out seat''s claim loses with the reason (got ' || coalesce((select note from waiver_claim where id = c1), 'null') || ')');
  perform wh_true((select status from waiver_claim where id = c2) = 'won', 'wh4 the vampire''s claim wins in the same run');
end $$;
select 'ALL WAIVER-HOLES PROBES PASSED' as result;
