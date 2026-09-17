-- 0287 probes: a league with no free agency.
--
-- What must hold:
--   • 'off' shuts the wire for EVERY unowned player — including one who was
--     never rostered, which is the case waiver_hold_days could never reach;
--   • the refusal says so, rather than naming hours the league does not have;
--   • waiver CLAIMS still work, which is the whole point of turning FA off;
--   • an unset fa_mode reads from the window, so no existing league changes
--     behaviour: hours ⇒ 'window', none ⇒ 'open';
--   • 'open' ignores a stale stored window rather than half-applying it;
--   • only a commissioner may set it, and only to a real mode.
\set QUIET on
\pset pager off

create or replace function fo_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function fo_no(r jsonb, want text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, true) is not false then
    raise exception 'PROBE FAIL % — expected a refusal, got %', msg, r;
  end if;
  if position(want in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — refused for the wrong reason: %', msg, r ->> 'error';
  end if;
end $$;
create or replace function fo_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
-- app.uid survives `reset role`, so a probe that wants the SERVER has to say
-- so explicitly — otherwise RLS still sees the last signed-in probe user.
create or replace function fo_server() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;
create or replace function fo_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000fa0' || u, false);
  perform set_config('app.email', 'fo' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000fa01', 'fo1@test.dev'),
  ('00000000-0000-0000-0000-00000000fa02', 'fo2@test.dev')
on conflict (id) do nothing;

-- ── fixture: a drafted 2-team league with spare players in the pool ────────
do $$
declare lid uuid; r jsonb; i int; code text; seat2 int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000fa01', 'fo1@test.dev'),
    ('00000000-0000-0000-0000-00000000fa02', 'fo2@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000fa01';
  perform fo_as('1');
  r := create_native_league('No FA', '2026', 2, 5, 60, 'snake', 200, 15, 1);
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform fo_as('2'); perform fo_ok(native_join(code, 'FO-2'), 'fo0 fo2 joins');
  reset role;
  for i in 1..40 loop
    insert into league_pool (league_id, slug, full_name, pos, team, rank)
      values (lid, 'fo-' || i, 'FO ' || i, (array['QB','RB','WR','TE'])[1 + (i % 4)], 'FOT', i)
      on conflict do nothing;
  end loop;
  perform fo_as('1');
  perform fo_ok(start_draft(lid, '[1,2]'::jsonb), 'fo0a the draft opens');
  -- run it out so the wire is legal at all
  perform set_config('app.uid', '', false);
  for i in 1..40 loop
    exit when (select status from draft where league_id = lid) = 'complete';
    update draft set deadline_at = now() - interval '1 second' where league_id = lid and status = 'live';
    perform draft_tick(lid);
  end loop;
  perform fo_true((select status from draft where league_id = lid) = 'complete', 'fo0b and finishes');
  perform set_config('probe.fo_lid', lid::text, false);
end $$;

-- ── 1. an unset mode reads from the window — nobody is migrated ───────────
do $$
declare lid uuid := current_setting('probe.fo_lid')::uuid;
begin
  perform fo_as('1');
  perform fo_true(league_fa_mode(lid) = 'open',
    'fo1 no hours set ⇒ open, exactly as this league already behaved');
  perform fo_true(fa_window_open(lid), 'fo1a and the wire is open');
  perform fo_ok(set_transaction_rules(lid, p_fa_start_min => 600, p_fa_end_min => 660),
    'fo2 the commissioner sets hours');
  perform fo_true(league_fa_mode(lid) = 'window',
    'fo2a hours set ⇒ window, again without migrating anything');
end $$;

-- ── 2. OFF shuts it, including for a player nobody ever rostered ──────────
do $$
declare lid uuid := current_setting('probe.fo_lid')::uuid; free_slug text; r jsonb; seat int;
begin
  perform fo_as('1');
  perform fo_ok(set_transaction_rules(lid, p_fa_mode => 'off'), 'fo3 free agency off');
  perform fo_true(league_fa_mode(lid) = 'off', 'fo3a and it reads back off');
  perform fo_true(not fa_window_open(lid), 'fo3b the wire is shut');

  -- a player who was NEVER on a roster: no waived_until, the case the hold
  -- could never cover
  select lp.slug into free_slug from league_pool lp
    where lp.league_id = lid
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    limit 1;
  perform fo_true(free_slug is not null, 'fo4 an undrafted player is sitting there');
  perform fo_true((select waived_until from league_pool where league_id = lid and slug = free_slug) is null,
    'fo4a with no waiver hold on him at all');
  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000fa01';
  perform fo_no(add_free_agent(lid, seat, free_slug), 'no free agency',
    'fo5 and he still cannot be picked up — the sentence names the league, not hours');
end $$;

-- ── 3. waivers still work, which is the entire point ──────────────────────
do $$
declare lid uuid := current_setting('probe.fo_lid')::uuid; free_slug text; seat int; drop_slug text;
begin
  perform fo_as('1');
  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000fa01';
  select lp.slug into free_slug from league_pool lp
    where lp.league_id = lid
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    limit 1;
  select slug into drop_slug from native_roster where league_id = lid and roster_id = seat limit 1;
  perform fo_ok(submit_waiver_claim(lid, seat, free_slug, drop_slug),
    'fo6 a waiver claim is accepted with free agency off');
  perform fo_true(exists (select 1 from waiver_claim
                    where league_id = lid and roster_id = seat and add_slug = free_slug and status = 'pending'),
    'fo6a and it is sitting there pending');
end $$;

-- ── 3b. THE WHOLE POINT, end to end: FAAB waivers, no free agency ─────────
-- An accepted claim that never resolves would be the same hole one step
-- later, so this runs the market the founder actually asked for: FAAB on,
-- free agency off, a bid on a player nobody ever drafted, resolved.
do $$
declare lid uuid := current_setting('probe.fo_lid')::uuid; seat int; free_slug text; drop_slug text; r jsonb;
begin
  perform fo_as('1');
  perform fo_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100),
    'fo6b the league runs FAAB');
  perform fo_true(league_fa_mode(lid) = 'off', 'fo6c with free agency still off');
  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000fa01';
  -- the mode change reset every balance, so the earlier claim is stale: clear
  -- the board and bid fresh.
  reset role;
  delete from waiver_claim where league_id = lid;
  perform fo_as('1');
  select lp.slug into free_slug from league_pool lp
    where lp.league_id = lid
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  -- a full roster is a full roster whatever the wire looks like, so the claim
  -- carries its drop, exactly as a manager's would
  select slug into drop_slug from native_roster where league_id = lid and roster_id = seat limit 1;
  r := submit_waiver_claim(lid, seat, free_slug, drop_slug, 7);
  perform fo_ok(r, 'fo6d a $7 bid on a player who was never drafted');
  -- 0289: the bid SITS until the league's waiver run — an off league has no
  -- window to wait for, so that run is its clock. It used to settle on the
  -- next sweep, seconds later, which made a blind bid neither blind nor a bid.
  perform fo_true((r ->> 'clears_at')::timestamptz > now(),
    'fo6e it is pending against a clock, not settled on the spot');
  perform fo_ok(process_waivers(lid), 'fo6e1 a sweep before that clock changes nothing');
  perform fo_true(not exists (select 1 from native_roster
                    where league_id = lid and roster_id = seat and slug = free_slug),
    'fo6e2 he is not on the roster yet');
  perform fo_server();
  update waiver_claim set clears_at = now() - interval '1 minute'
    where league_id = lid and add_slug = free_slug and status = 'pending';
  perform fo_as('1');
  perform fo_ok(process_waivers(lid), 'fo6e3 and when the clock passes, the run resolves');
  perform fo_true(exists (select 1 from native_roster
                    where league_id = lid and roster_id = seat and slug = free_slug),
    'fo6f and he is on the roster — an unowned player reached ONLY through FAAB');
  perform fo_true(member_faab(lid, seat) = 93, 'fo6g the bid was paid out of the wallet');
end $$;

-- ── 4. open ignores a stale window; the gate is the mode ──────────────────
do $$
declare lid uuid := current_setting('probe.fo_lid')::uuid;
begin
  perform fo_as('1');
  -- the hours from §1 are still stored; 'open' must not half-apply them
  perform fo_true((select nullif(settings_json ->> 'fa_start_min', '') from league where id = lid) is not null,
    'fo7 the old window is still on the row');
  perform fo_ok(set_transaction_rules(lid, p_fa_mode => 'open'), 'fo7a back to open');
  perform fo_true(fa_window_open(lid),
    'fo7b and the wire is open whatever the hour, because the mode is the answer');
end $$;

-- ── 4b. A CLOSED WINDOW IS WHAT WAIVERS ARE FOR (0288) ────────────────────
-- The founder's league: FAAB, free agency on a daily window, the clock
-- outside it. Before 0288 a player nobody ever dropped was refused by BOTH
-- doors — no waived_until for the claim, no open window for the add — so most
-- of the pool was unobtainable for most of the day.
do $$
declare lid uuid := current_setting('probe.fo_lid')::uuid; seat int; free_slug text; drop_slug text; r jsonb; et_now int;
begin
  perform fo_as('1');
  -- A window shut BY CONSTRUCTION: one minute, three hours from now. The old
  -- fixture used midnight-to-00:01, which is shut 1439 minutes out of 1440 —
  -- a suite that fails once a day at 00:00 ET is a suite nobody trusts. Three
  -- hours out also gives 0289's fa_opens_at something real to be checked
  -- against.
  et_now := et_minutes(now());
  perform fo_ok(set_transaction_rules(lid, p_fa_mode => 'window',
    p_fa_start_min => (et_now + 180) % 1440, p_fa_end_min => (et_now + 181) % 1440),
    'fo10 the league runs a daily window');
  perform fo_true(league_fa_mode(lid) = 'window', 'fo10a mode reads window');
  perform fo_true(not fa_window_open(lid), 'fo10b and the window is shut right now');

  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000fa01';
  -- explicitly one NOBODY HAS EVER DROPPED: earlier probes in this file won a
  -- claim, and a resolved claim puts its drop on a hold, so the top-ranked
  -- free man is not necessarily an untouched one.
  select lp.slug into free_slug from league_pool lp
    where lp.league_id = lid and lp.waived_until is null
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  perform fo_true(free_slug is not null
    and (select waived_until from league_pool where league_id = lid and slug = free_slug) is null,
    'fo11 he has no waiver hold — nobody ever dropped him');
  -- the add is correctly refused: the window is shut
  perform fo_no(add_free_agent(lid, seat, free_slug), 'free agency is closed',
    'fo12 adding him is refused while the window is shut');
  -- …and THAT is exactly when a claim has to work
  reset role;
  delete from waiver_claim where league_id = lid;
  perform fo_as('1');
  select slug into drop_slug from native_roster where league_id = lid and roster_id = seat limit 1;
  r := submit_waiver_claim(lid, seat, free_slug, drop_slug, 4);
  perform fo_ok(r, 'fo13 but a claim on him is ACCEPTED — the closed window is what waivers cover');

  -- 0289: AND IT MUST NOT SETTLE ON THE SPOT.
  --
  -- This is where the suite asserted the opposite — 'and the run resolves it'
  -- — which is exactly the bug the founder reported the next morning: "it
  -- looks like my bid for golden went through immediately". It did: a player
  -- nobody ever dropped has no pool hold, process_waivers read a null hold as
  -- DUE NOW, and the team screen sweeps every fifteen seconds. The claim won
  -- uncontested, and charged FAAB for the privilege. A green probe asserting
  -- the broken behaviour is worse than no probe, so it now asserts the rule:
  -- a claim made behind a closed door clears when that door opens.
  perform fo_true((r ->> 'clears_at') is not null and (r ->> 'clears_at')::timestamptz > now(),
    'fo13a the claim comes back with a clearing time, and it is in the future');
  perform fo_true((r ->> 'clears_at')::timestamptz = fa_opens_at(lid),
    'fo13b which is the moment free agency next opens');
  perform fo_true(fa_opens_at(lid) between now() + interval '2 hours' and now() + interval '4 hours',
    'fo13c and that is the window three hours out, not some other day');
  perform fo_ok(process_waivers(lid), 'fo13d a sweep right now runs clean');
  perform fo_true(not exists (select 1 from native_roster
                    where league_id = lid and roster_id = seat and slug = free_slug),
    'fo13e and does NOT hand him over — the blind-bid window IS the feature');
  perform fo_true(exists (select 1 from waiver_claim where league_id = lid
                    and add_slug = free_slug and status = 'pending'),
    'fo13f the claim is still pending, waiting for the door');

  -- …and once the clock has passed it settles exactly as it always did.
  perform fo_server();
  update waiver_claim set clears_at = now() - interval '1 minute'
    where league_id = lid and add_slug = free_slug and status = 'pending';
  perform fo_as('1');
  perform fo_ok(process_waivers(lid), 'fo13g once the clock has passed, the run resolves it');
  perform fo_true(exists (select 1 from native_roster
                    where league_id = lid and roster_id = seat and slug = free_slug),
    'fo13h onto the roster');

  -- With the window OPEN, an unheld player is an add, not a claim — and the
  -- refusal says so rather than the old, untrue "player not in pool".
  perform fo_ok(set_transaction_rules(lid, p_fa_start_min => -1, p_fa_end_min => -1),
    'fo14 the window is cleared');
  perform fo_ok(set_transaction_rules(lid, p_fa_mode => 'open'), 'fo14a and free agency is open');
  perform fo_true(fa_window_open(lid), 'fo14b so the wire is open');
  select lp.slug into free_slug from league_pool lp
    where lp.league_id = lid and lp.waived_until is null
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  perform fo_no(submit_waiver_claim(lid, seat, free_slug, drop_slug, 1), 'add him directly',
    'fo15 claiming an open free agent points you at the add instead');
end $$;

-- ── 4c. THE CLOCK ITSELF (0289) ───────────────────────────────────────────
-- Three rules the clearing time has to keep:
--   • a league with no free agency at all has no door to wait for, so the
--     claim falls back to the league's own waiver run — otherwise an 'off'
--     league (v0.400.0's whole point) would park every claim forever;
--   • fa_opens_at is null exactly when free agency never opens;
--   • a claim that has come due is settled BEFORE anyone can add the player,
--     even when the add arrives first — the fifteen seconds between the
--     window opening and the next sweep is otherwise a free snipe.
do $$
declare lid uuid := current_setting('probe.fo_lid')::uuid; seat int; seat2 int;
        free_slug text; drop_slug text; r jsonb;
begin
  perform fo_as('1');
  select sleeper_roster_id into seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000fa01';
  select sleeper_roster_id into seat2 from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000fa02';

  -- (a) no free agency at all: the waiver run is the only clock there is
  perform fo_ok(set_transaction_rules(lid, p_fa_mode => 'off'), 'fo16 free agency off');
  perform fo_true(fa_opens_at(lid) is null, 'fo16a a door that never opens has no opening time');
  select lp.slug into free_slug from league_pool lp
    where lp.league_id = lid and lp.waived_until is null
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  select slug into drop_slug from native_roster where league_id = lid and roster_id = seat limit 1;
  r := submit_waiver_claim(lid, seat, free_slug, drop_slug, 2);
  perform fo_ok(r, 'fo17 a claim in an off league is accepted');
  perform fo_true((r ->> 'clears_at')::timestamptz = waiver_hold_until(lid),
    'fo17a and clears on the league waiver run, the only clock that mode has');
  perform fo_true((r ->> 'clears_at')::timestamptz > now(),
    'fo17b which is still in the future — an off league must not settle on the spot either');
  perform fo_ok(process_waivers(lid), 'fo17c a sweep now runs clean');
  perform fo_true(not exists (select 1 from native_roster
                    where league_id = lid and roster_id = seat and slug = free_slug),
    'fo17d and leaves him alone');

  -- (b) a due claim beats an add that arrives in the same breath. The other
  -- seat tries to take the player the instant the door opens; add_free_agent
  -- settles the sweep first and then honestly reports him gone.
  perform fo_server();
  update waiver_claim set clears_at = now() - interval '1 minute'
    where league_id = lid and add_slug = free_slug and status = 'pending';
  perform fo_as('1');
  perform fo_ok(set_transaction_rules(lid, p_fa_mode => 'open'), 'fo18 the door opens');
  perform fo_true(fa_window_open(lid), 'fo18a the wire is open');
  perform fo_true(fa_opens_at(lid) <= now(), 'fo18b and an open door opens now');
  perform fo_as('2');
  perform fo_no(add_free_agent(lid, seat2, free_slug), 'already rostered',
    'fo19 an add racing a due claim loses to it — the claim settled first');
  perform fo_true(exists (select 1 from native_roster
                    where league_id = lid and roster_id = seat and slug = free_slug),
    'fo19a and the claimant has him');
end $$;

-- ── 5. who may set it, and to what ────────────────────────────────────────
do $$
declare lid uuid := current_setting('probe.fo_lid')::uuid;
begin
  perform fo_as('1');
  perform fo_no(set_transaction_rules(lid, p_fa_mode => 'sometimes'), 'open, window or off',
    'fo8 a mode that is not a mode is refused');
  perform fo_as('2');
  perform fo_no(set_transaction_rules(lid, p_fa_mode => 'off'), 'forbidden',
    'fo9 and a member who is not the commissioner cannot turn it off');
  perform fo_true(league_fa_mode(lid) = 'open', 'fo9a so it is still open');
  reset role;
  raise notice 'fa-off probes done';
end $$;

select 'ALL FA-OFF PROBES PASSED' as status;
