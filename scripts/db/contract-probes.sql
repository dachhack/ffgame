-- CONTRACT probes (0217) — the salary-cap engine, end to end on the real
-- acquisition paths: an auction bid becomes the salary, the winner assigns a
-- length, a waiver claim signs at its FAAB bid, an FA add at the $1 minimum,
-- a startup pick at the rookie scale, trades carry the deal to a receiver who
-- must fit it, cuts release it, and the cap holds at commit.
-- Run with ON_ERROR_STOP; every failed assertion raises.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict do nothing;
select probe_as('a');
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- One auction league runs §1–§8; §9 uses its own linear league.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text; lot uuid; msg text;
begin
  perform probe_as('a');
  r := create_native_league('Cap City', '2026', 2, 5, 60, 'auction', 20);
  perform assert_ok(r, 'ct0 create auction (budget 20)');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Signs'), 'ct0b B joins');
  perform probe_as('a');
  for i in 1..14 loop pool := pool || jsonb_build_object('slug', 'ct-rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ct0c seed');

  -- ── 1. the rules switch ────────────────────────────────────────────────────
  perform probe_as('b');
  perform assert_err(set_contract_rules(lid, 30), 'commissioner', 'ct1a members do not set the cap');
  perform probe_as('a');
  perform assert_err(set_contract_rules(lid, 15), 'auction budget', 'ct1b pre-draft, the cap must cover the startup spend');
  perform assert_ok(set_contract_rules(lid, 30), 'ct1c cap on at $30');
  perform assert_true(contracts_on(lid) and league_salary_cap(lid) = 30 and contract_years_max(lid) = 4,
    'ct1d contracts on, defaults read back');

  -- ── 2. the auction bid IS the salary ───────────────────────────────────────
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), 'ct2a start');
  perform assert_ok(nominate(lid, 'ct-rb1', 6), 'ct2b A opens at $6');
  perform probe_as('b');
  perform assert_ok(place_bid(lid, 2, 8), 'ct2c B answers $8');
  update auction_lot set deadline = now() - interval '1 second' where league_id = lid;
  perform probe_as('a');
  perform draft_tick(lid);
  perform assert_true((select count(*) from contract where league_id = lid and slug = 'ct-rb1') = 1,
    'ct2d the award dealt a contract');
  perform assert_true((select (roster_id, salary, years, acquired) = (2, 8, 1, 'auction')
      from contract where league_id = lid and slug = 'ct-rb1'),
    'ct2e THE POINT: the winning bid is the exact salary — $8, 1yr, to the winner');

  -- ── 3. the winner assigns a length ─────────────────────────────────────────
  perform probe_as('c');
  perform assert_err(set_contract_years(lid, 'ct-rb1', 3), 'not your contract', 'ct3a a stranger does not sign extensions');
  perform probe_as('b');
  perform assert_err(set_contract_years(lid, 'ct-rb1', 5), '1–4', 'ct3b length caps at the league max');
  perform assert_ok(set_contract_years(lid, 'ct-rb1', 4), 'ct3c the winner takes the 4-year deal');
  perform assert_true((select years from contract where league_id = lid and slug = 'ct-rb1') = 4, 'ct3d stored');
  update draft set status = 'complete', deadline_at = null where league_id = lid;
  delete from auction_lot where league_id = lid;
  -- 0229 changed this law: the room closing no longer freezes the pen — the
  -- owner's own 🔒 lock does (the full lifecycle is §17's).
  perform assert_ok(set_contract_years(lid, 'ct-rb1', 2), 'ct3e the room closing no longer ends the owner''s window (0229)');
  perform assert_ok(lock_contracts(lid, 2), 'ct3e2 B locks');
  perform assert_err(set_contract_years(lid, 'ct-rb1', 4), 'locked', 'ct3e3 the LOCK is what ends it');
  perform probe_as('a');
  perform assert_ok(set_contract_years(lid, 'ct-rb1', 3), 'ct3f …but the commissioner may still correct a deal');

  -- ── 4 + 5. FA minimum and the FAAB-bid waiver salary ───────────────────────
  perform probe_as('b');
  perform assert_ok(add_free_agent(lid, 2, 'ct-rb9', null), 'ct4a FA add');
  perform assert_true((select (salary, years, acquired) = (1, 1, 'fa') from contract
      where league_id = lid and slug = 'ct-rb9'), 'ct4b the street deal: $1, 1 year');
  perform probe_as('a');
  perform assert_ok(set_transaction_rules(lid, 'faab', 100, null), 'ct5a0 FAAB on');
  update league_pool set waived_until = now() + interval '1 day' where league_id = lid and slug = 'ct-rb10';
  perform probe_as('b');
  perform assert_ok(submit_waiver_claim(lid, 2, 'ct-rb10', null, 5), 'ct5a claim at $5');
  update league_pool set waived_until = now() - interval '1 second' where league_id = lid and slug = 'ct-rb10';
  perform probe_as('a');
  r := process_waivers(lid);
  perform assert_true((r ->> 'won')::int = 1, 'ct5b waivers run, claim won');
  perform assert_true((select (salary, acquired) = (5, 'waiver') from contract
      where league_id = lid and slug = 'ct-rb10'),
    'ct5c THE POINT: the waiver salary is the FAAB bid, not a flat minimum');

  -- ── 6. the cap holds ───────────────────────────────────────────────────────
  -- B carries $8 + $1 + $5 = $14. Tighten the cap to $15 (legal now the room
  -- is closed): one more $1 deal fits exactly; the next must bounce, and the
  -- bounce must ROLL BACK the roster add, not just complain about it.
  perform assert_ok(set_contract_rules(lid, 15), 'ct6a cap tightens to $15 post-draft');
  perform probe_as('b');
  perform assert_ok(add_free_agent(lid, 2, 'ct-rb11', null), 'ct6b $15 of $15 — exactly at the cap is legal');
  begin
    set constraints all immediate;
    perform add_free_agent(lid, 2, 'ct-rb12', null);
    raise exception 'PROBE FAIL ct6c an over-cap signing went through';
  exception when others then
    msg := sqlerrm;
    if position('salary cap exceeded' in msg) = 0 then raise; end if;
  end;
  perform assert_true(not exists (select 1 from native_roster where league_id = lid and slug = 'ct-rb12'),
    'ct6d the refused signing rolled the roster add back too');

  -- ── 7. a trade carries the deal to a receiver who must fit it ──────────────
  perform probe_as('b');
  r := propose_trade(lid, 2, 1, '["ct-rb1"]'::jsonb, '[]'::jsonb, null, null, null);
  perform assert_ok(r, 'ct7a B offers the $8 deal to A');
  perform probe_as('a');
  perform assert_ok(respond_trade((r ->> 'trade_id')::uuid, true), 'ct7b A accepts');
  perform assert_true((select (roster_id, salary, years) = (1, 8, 3) from contract
      where league_id = lid and slug = 'ct-rb1'),
    'ct7c the contract moved seats with its terms intact');
  -- Send it back with the cap at $10: A fits ($8 → $0), B does not ($7 + $8).
  perform assert_ok(set_contract_rules(lid, 10), 'ct7d cap tightens to $10');
  r := propose_trade(lid, 1, 2, '["ct-rb1"]'::jsonb, '[]'::jsonb, null, null, null);
  perform assert_ok(r, 'ct7e A offers it back');
  perform probe_as('b');
  begin
    set constraints all immediate;
    perform respond_trade((r ->> 'trade_id')::uuid, true);
    raise exception 'PROBE FAIL ct7f an over-cap trade went through';
  exception when others then
    msg := sqlerrm;
    if position('salary cap exceeded' in msg) = 0 then raise; end if;
  end;
  perform assert_true((select roster_id from contract where league_id = lid and slug = 'ct-rb1') = 1,
    'ct7g the refused trade left the deal where it was');

  -- ── 8. a cut releases the deal ─────────────────────────────────────────────
  delete from native_roster where league_id = lid and slug = 'ct-rb11';
  perform assert_true(not exists (select 1 from contract where league_id = lid and slug = 'ct-rb11'),
    'ct8a cut player, released contract (dead money is the v2 offseason pack)');

  -- the cap sheet reads it all back
  perform probe_as('b');
  r := league_contracts(lid);
  perform assert_true((r ->> 'contracts')::boolean and (r ->> 'salary_cap')::int = 10,
    'ct8b the cap sheet carries the rules');
  perform assert_true(jsonb_array_length(r -> 'deals') = 3, 'ct8c three deals stand');
end $$;

-- ── 9. a pick-based startup deals at the rookie scale ────────────────────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  perform probe_as('a');
  r := create_native_league('Scale Model', '2026', 2, 5, 60, 'linear');
  perform assert_ok(r, 'ct9a create linear');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Scales'), 'ct9b B joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'sm-rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ct9c seed');
  perform assert_ok(set_contract_rules(lid, 100), 'ct9d cap on');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), 'ct9e start');
  perform assert_ok(make_draft_pick(lid, 'sm-rb1'), 'ct9f A takes 1.01');
  perform probe_as('b');
  perform assert_ok(make_draft_pick(lid, 'sm-rb2'), 'ct9g B takes 1.02');
  perform probe_as('a');
  perform assert_ok(make_draft_pick(lid, 'sm-rb3'), 'ct9h A takes 2.01 (linear: same order)');
  perform assert_true((select (salary, acquired) = (12, 'draft') from contract where league_id = lid and slug = 'sm-rb1'),
    'ct9i round 1 signs at the $12 scale');
  perform assert_true((select salary from contract where league_id = lid and slug = 'sm-rb3') = 6,
    'ct9j round 2 signs at $6 — the scale follows the round');
end $$;

-- ── 10. contract LEAGUE TYPES (0218): the selection presets the rest ─────────
do $$
declare lid uuid; r jsonb;
begin
  perform probe_as('a');
  -- 'contract': mode is FORCED to auction (snake requested, auction dealt),
  -- cap lands at the auction budget, axis reads back
  r := create_native_league('Deal Flow', '2026', 2, 5, 60, 'snake', 25, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 'ct10a create with continuity=contract');
  lid := (r ->> 'league_id')::uuid;
  perform assert_true((r ->> 'contracts')::boolean and not (r ->> 'dynasty')::boolean, 'ct10b says contracts on, not dynasty');
  perform assert_true((select mode from draft where league_id = lid) = 'auction',
    'ct10c THE PRESET: snake was asked for, the contract type dealt an auction');
  perform assert_true(contracts_on(lid) and league_salary_cap(lid) = 25 and contract_years_max(lid) = 4,
    'ct10d cap on at the auction budget, 4-year max');
  perform assert_true(league_continuity(lid) = 'contract' and not league_is_dynasty(lid), 'ct10e axis reads contract');
  perform assert_true(not coalesce((league_contracts(lid) ->> 'locked')::boolean, true),
    'ct10f cap sheet: lengths not locked while the room is open');
  -- switching to a plain mode turns contracts OFF — the axis owns contract-ness
  perform assert_ok(set_league_continuity(lid, 'redraft'), 'ct10g switch to plain redraft');
  perform assert_true(not contracts_on(lid) and league_continuity(lid) = 'redraft', 'ct10h contracts off with it');
  -- and back on through the axis
  perform assert_ok(set_league_continuity(lid, 'contract'), 'ct10i back to contract');
  perform assert_true(contracts_on(lid) and league_salary_cap(lid) = 25, 'ct10j cap re-lands at the budget');

  -- 'contract_dynasty': the dynasty machinery AND the cap
  r := create_native_league('Deal Horizon', '2026', 2, 6, 60, 'snake', 30, 15, 1, null, null, null, 'drip', 'contract_dynasty', 2);
  perform assert_ok(r, 'ct10k create with continuity=contract_dynasty');
  lid := (r ->> 'league_id')::uuid;
  perform assert_true((r ->> 'contracts')::boolean and (r ->> 'dynasty')::boolean, 'ct10l both flags fly');
  perform assert_true((select mode from draft where league_id = lid) = 'auction', 'ct10m auction preset here too');
  perform assert_true(contracts_on(lid) and league_salary_cap(lid) = 30, 'ct10n cap at the budget');
  perform assert_true(league_continuity(lid) = 'contract_dynasty' and league_is_dynasty(lid),
    'ct10o contract_dynasty IS a dynasty to the machinery');
  perform assert_true((select count(distinct season) from pick_asset where league_id = lid) = 3,
    'ct10p the three-year pick horizon dealt');
  perform assert_true((select (settings_json ->> 'rookie_rounds')::int from league where id = lid) = 2,
    'ct10q rookie rounds stored');
  perform assert_err(create_native_league('Bad Axis', '2026', 2, 5, 60, 'snake', 200, 15, 1, null, null, null, 'drip', 'contracts', null),
    'continuity must be', 'ct10r a typo''d axis value refuses');
end $$;

-- ── 11 + 12. SALARY MECHANICS (0219): retention, cap trading, IR relief,
-- the rules surface — then the cut that writes the ledger (0220) ─────────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text; msg text;
begin
  perform probe_as('a');
  r := create_native_league('Salary Lab', '2026', 2, 5, 60, 'snake', 30, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 's11a create contract league (cap $30)');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Retains'), 's11b B joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'sl-p' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 's11c seed');
  update draft set status = 'complete' where league_id = lid;

  -- the rules surface
  perform probe_as('b');
  perform assert_err(set_salary_rules(lid, 50), 'commissioner', 's11d members do not write the rulebook');
  perform probe_as('a');
  r := set_salary_rules(lid, 50, null, true, true, null, null, null);
  perform assert_ok(r, 's11e dead 50% + cap trading + IR relief on');
  perform assert_true((r ->> 'dead_pct')::int = 50 and (r ->> 'cap_trading')::boolean
      and (r ->> 'ir_relief')::boolean and (r ->> 'retention')::boolean,
    's11f the rules read back (retention defaults on)');

  -- build the books: A holds a $10 three-year deal, B two street deals
  perform assert_ok(add_free_agent(lid, 1, 'sl-p1', null), 's11g A signs p1');
  perform probe_as('b');
  perform assert_ok(add_free_agent(lid, 2, 'sl-p2', null), 's11h B signs p2');
  perform assert_ok(add_free_agent(lid, 2, 'sl-p3', null), 's11i B signs p3');
  update contract set salary = 10, years = 3 where league_id = lid and slug = 'sl-p1';

  -- ── retention: A eats $4 sending the $10 deal to B ─────────────────────────
  perform probe_as('a');
  r := propose_trade(lid, 1, 2, '["sl-p1"]'::jsonb, '[]'::jsonb, null, null, null,
                     '[{"slug":"sl-p1","amount":4}]'::jsonb, null);
  perform assert_ok(r, 's11j retention offer stands');
  perform probe_as('b');
  perform assert_ok(respond_trade((r ->> 'trade_id')::uuid, true), 's11k B accepts');
  perform assert_true((select (roster_id, amount) = (1, 4) from salary_retention
      where league_id = lid and slug = 'sl-p1'),
    's11l THE GHOST: A retains $4 on the player A no longer holds');
  perform assert_true(team_payroll(lid, 1) = 4, 's11m A''s payroll IS the ghost');
  perform assert_true(team_payroll(lid, 2) = 8, 's11n B pays the net: $6 + two $1 deals');

  -- over-retention refuses: $4 already eaten, salary 10 → at most $5 more
  r := propose_trade(lid, 2, 1, '["sl-p1"]'::jsonb, '[]'::jsonb, null, null, null,
                     '[{"slug":"sl-p1","amount":6}]'::jsonb, null);
  perform assert_err(r, 'retention on', 's11o the receiver always pays at least $1');

  -- ── cap dollars move like a pick ───────────────────────────────────────────
  perform probe_as('a');
  r := propose_trade(lid, 1, 2, '[]'::jsonb, '[]'::jsonb, null, null, null, null, 5);
  perform assert_ok(r, 's11p a pure cash offer stands');
  perform probe_as('b');
  perform assert_ok(respond_trade((r ->> 'trade_id')::uuid, true), 's11q accepted');
  perform assert_true(team_cap(lid, 1) = 25 and team_cap(lid, 2) = 35,
    's11r THE POINT: cap room moved — $25 / $35');
  -- a cash deal that would sink the sender is refused whole
  perform probe_as('a');
  r := propose_trade(lid, 1, 2, '[]'::jsonb, '[]'::jsonb, null, null, null, null, 22);
  perform assert_ok(r, 's11s the doomed offer stands (judged at accept)');
  perform probe_as('b');
  begin
    perform respond_trade((r ->> 'trade_id')::uuid, true);
    raise exception 'PROBE FAIL s11t an over-cap cash deal went through';
  exception when others then
    msg := sqlerrm;
    if position('salary cap exceeded' in msg) = 0 then raise; end if;
  end;
  perform assert_true(team_cap(lid, 1) = 25, 's11u the refused cash deal rolled back');

  -- ── IR relief: the stashed deal comes off the books ────────────────────────
  update native_roster set spot = 'ir' where league_id = lid and slug = 'sl-p1';
  perform assert_true(team_payroll(lid, 2) = 2, 's11v B''s $6 net parked on IR');
  perform probe_as('a');
  perform assert_ok(set_salary_rules(lid, null, null, null, false, null, null, null), 's11w relief off');
  perform assert_true(team_payroll(lid, 2) = 8, 's11x …and the salary is back');
  update native_roster set spot = 'active' where league_id = lid and slug = 'sl-p1';

  -- retention can be switched off
  perform assert_ok(set_salary_rules(lid, null, false, null, null, null, null, null), 's11y retention off');
  perform probe_as('b');
  r := propose_trade(lid, 2, 1, '["sl-p1"]'::jsonb, '[]'::jsonb, null, null, null,
                     '[{"slug":"sl-p1","amount":2}]'::jsonb, null);
  perform assert_err(r, 'retention turned off', 's11z the switch holds');

  -- ── 12. the cut writes the ledger ──────────────────────────────────────────
  -- B cuts the $10 deal (3yr, $4 retained by A): A's ghost hardens into dead
  -- money, B eats 50% of their $6 share, both for the deal's remaining life.
  delete from native_roster where league_id = lid and slug = 'sl-p1';
  perform assert_true(not exists (select 1 from contract where league_id = lid and slug = 'sl-p1')
    and not exists (select 1 from salary_retention where league_id = lid and slug = 'sl-p1'),
    's12a deal and retention released');
  perform assert_true((select (amount, years_left) = (4, 3) from dead_money
      where league_id = lid and roster_id = 1 and slug = 'sl-p1'),
    's12b THE TRAP: A''s retained $4 is dead for 3 years');
  perform assert_true((select (amount, years_left) = (3, 3) from dead_money
      where league_id = lid and roster_id = 2 and slug = 'sl-p1'),
    's12c B''s penalty: 50% of the $6 share, 3 years');
  perform assert_true(team_payroll(lid, 1) = 4 and team_payroll(lid, 2) = 5,
    's12d the ledger sums: A $4 dead, B $2 live + $3 dead');
end $$;

-- ── 13 + 14. THE OFFSEASON (0220): tag, extend, RFA — then the rollover
-- carries every live deal and decrements the ledger ──────────────────────────
do $$
declare lid uuid; nlid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
        mkt int; extsal int; tagsal int;
begin
  perform probe_as('a');
  r := create_native_league('Carry On', '2026', 2, 5, 60, 'snake', 25, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 's13a create contract league');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Carries'), 's13b B joins');
  perform probe_as('a');
  -- 25 deep: next season's room re-checks pool ≥ picks AFTER the carriage
  -- takes its five off the board
  for i in 1..25 loop pool := pool || jsonb_build_object('slug', 'co-p' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 's13c seed');
  update draft set status = 'complete' where league_id = lid;
  -- age the league so the Super Bowl gate is GENUINELY open — the offseason
  -- tools are member actions, not admin ones, and must work as plain seats
  update league set season = '2020' where id = lid;

  -- the books: A holds an $8 3yr deal and an expiring $5; B a $6 2yr, an
  -- expiring $4 (to tag), an expiring $1 (to extend), an expiring $1 (RFA)
  perform assert_ok(add_free_agent(lid, 1, 'co-p1', null), 's13d');
  perform assert_ok(add_free_agent(lid, 1, 'co-p2', null), 's13e');
  perform probe_as('b');
  perform assert_ok(add_free_agent(lid, 2, 'co-p3', null), 's13f');
  perform assert_ok(add_free_agent(lid, 2, 'co-p4', null), 's13g');
  perform assert_ok(add_free_agent(lid, 2, 'co-p5', null), 's13h');
  perform assert_ok(add_free_agent(lid, 2, 'co-p6', null), 's13i');
  update contract set salary = 8, years = 3 where league_id = lid and slug = 'co-p1';
  update contract set salary = 5, years = 1 where league_id = lid and slug = 'co-p2';
  update contract set salary = 6, years = 2 where league_id = lid and slug = 'co-p3';
  update contract set salary = 4, years = 1 where league_id = lid and slug = 'co-p4';
  -- A retains $2 on B's co-p3 (as if traded earlier) and carries $3 dead, 2yr
  insert into salary_retention (league_id, slug, roster_id, amount) values (lid, 'co-p3', 1, 2);
  insert into dead_money (league_id, roster_id, slug, amount, years_left, note) values (lid, 1, 'co-p0', 3, 2, 'probe');
  update league_membership set cap_adjust = 7 where league_id = lid and sleeper_roster_id = 1;

  -- ── 14a. the franchise tag ─────────────────────────────────────────────────
  perform probe_as('a');              -- the commish may tag any seat's player
  mkt := contract_market_value(lid, 'co-p4');
  tagsal := greatest(mkt, ceil(4 * 1.20)::int);
  r := franchise_tag(lid, 'co-p4');
  perform assert_ok(r, 's14a tag lands');
  perform assert_true((select (salary, years, tagged) = (tagsal, 1, true) from contract
      where league_id = lid and slug = 'co-p4'),
    's14b tag price: max(top-5 positional market, salary + 20%)');
  perform assert_err(franchise_tag(lid, 'co-p5'), 'one tag per team', 's14c one tag per team');
  perform assert_err(franchise_tag(lid, 'co-p1'), 'years left', 's14d tags are for expiring deals');

  -- ── 14b. the extension — 0230: the base is HIS market (the value curve at
  -- his pool rank), not his position's top-5 elite ───────────────────────────
  mkt := player_market_value(lid, 'co-p5');
  extsal := greatest(1, ceil(mkt * 0.85)::int);
  r := extend_contract(lid, 'co-p5', 2);
  perform assert_ok(r, 's14e extension signs');
  perform assert_true((select (salary, years) = (extsal, 3) from contract
      where league_id = lid and slug = 'co-p5'),
    's14f 85% of market, stored 2+1 so the rollover lands it at 2');
  perform assert_err(extend_contract(lid, 'co-p3', 2), 'years left', 's14g extensions are for expiring deals');
  perform assert_err(extend_contract(lid, 'co-p4', 1), 'tag year', 's14h no extension on a tag');

  -- ── 14c. RFA: tender, bid, walk ────────────────────────────────────────────
  perform probe_as('b');
  perform assert_ok(rfa_tender(lid, 'co-p6'), 's14i B tenders the expiring $1');
  perform probe_as('a');
  perform assert_err(rfa_bid(lid, 1, 'co-p6', 0, 1), 'at least', 's14j a $0 bid is not a bid');
  perform assert_ok(rfa_bid(lid, 1, 'co-p6', 7, 2), 's14k A offers $7 for 2yr');
  perform assert_err(rfa_bid(lid, 1, 'co-p6', 6, 2), 'beat the standing offer', 's14l bids must climb');
  perform probe_as('b');
  r := rfa_resolve(lid, 'co-p6', false);   -- let him walk
  perform assert_ok(r, 's14m B lets him walk');
  perform assert_true((select (roster_id, salary, years) = (1, 7, 3) from contract
      where league_id = lid and slug = 'co-p6'),
    's14n the deal moved to the bidder at the offer, stored 2+1');
  perform assert_true(exists (select 1 from native_roster
      where league_id = lid and roster_id = 1 and slug = 'co-p6'), 's14o the player moved with it');

  -- ── 13z. THE ROLLOVER carries the book ─────────────────────────────────────
  perform probe_as('a');
  r := rollover_league(lid, 14, false);
  perform assert_ok(r, 's13j rollover runs (admin bypasses the Super Bowl gate)');
  nlid := (r ->> 'league_id')::uuid;
  perform assert_true((select (roster_id, salary, years) = (1, 8, 2) from contract
      where league_id = nlid and slug = 'co-p1'),
    's13k THE KEYSTONE: the 3-year deal carries at years−1');
  perform assert_true(not exists (select 1 from native_roster where league_id = nlid and slug = 'co-p2'),
    's13l the expiring deal walked to the pool');
  perform assert_true((select (roster_id, salary, years) = (2, 6, 1) from contract
      where league_id = nlid and slug = 'co-p3'),
    's13m the 2-year deal enters its final year');
  perform assert_true((select (salary, years, tagged) = (tagsal, 1, false) from contract
      where league_id = nlid and slug = 'co-p4'),
    's13n the tag buys exactly one more season');
  perform assert_true((select years = 2 from contract where league_id = nlid and slug = 'co-p5'),
    's13o the 2-year extension lands at 2');
  perform assert_true((select (roster_id, years) = (1, 2) from contract where league_id = nlid and slug = 'co-p6'),
    's13p the walked RFA deal carries to its new team');
  perform assert_true((select (amount, years_left) = (3, 1) from dead_money
      where league_id = nlid and roster_id = 1),
    's13q dead money follows at years_left−1');
  perform assert_true((select (roster_id, amount) = (1, 2) from salary_retention
      where league_id = nlid and slug = 'co-p3'),
    's13r the retained-salary ghost follows its contract');
  perform assert_true((select cap_adjust from league_membership
      where league_id = nlid and sleeper_roster_id = 1) = 0,
    's13s traded cap room does NOT carry — fresh season, fresh money');

  -- the next room opens pre-docked: seat budgets are budget − carried payroll
  perform assert_ok(start_draft(nlid, '[1,2]'::jsonb), 's13t next season''s room opens');
  perform assert_true((select draft_budget from league_membership
      where league_id = nlid and sleeper_roster_id = 1)
      = greatest(1, 25 - team_payroll(nlid, 1)),
    's13u the carried payroll already spent part of seat 1''s money');
end $$;

-- ── §15. contract rooms preset FAAB (0226) ───────────────────────────────────
-- In a contract league the winning waiver bid IS the signing salary, so the
-- preset lands waiver_mode='faab' with the cap as the season budget — but a
-- wire the commissioner already chose is never overwritten.
do $$
declare lid uuid; r jsonb;
begin
  perform probe_as('a');
  -- fresh contract league → FAAB rides in, budget = cap
  r := create_native_league('Bid To Sign', '2026', 2, 5, 60, 'snake', 40, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 'ct15a create contract league');
  lid := (r ->> 'league_id')::uuid;
  perform assert_true((select settings_json ->> 'waiver_mode' from league where id = lid) = 'faab',
    'ct15b the contract preset lands FAAB waivers');
  perform assert_true((select (settings_json ->> 'faab_budget')::int from league where id = lid) = 40,
    'ct15c and the season budget speaks the cap''s currency');

  -- a chosen wire survives the switch INTO a contract type
  r := create_native_league('Chose Rolling', '2026', 2, 5, 60, 'auction', 40);
  perform assert_ok(r, 'ct15d create plain league');
  lid := (r ->> 'league_id')::uuid;
  perform assert_ok(set_transaction_rules(lid, 'rolling', null, null), 'ct15e commish picks rolling waivers');
  perform assert_ok(set_league_continuity(lid, 'contract'), 'ct15f switch to contract');
  perform assert_true((select settings_json ->> 'waiver_mode' from league where id = lid) = 'rolling',
    'ct15g a preset never overwrites a commissioner''s chosen wire');
  perform assert_true((select (settings_json ->> 'salary_cap')::int from league where id = lid) = 40,
    'ct15h ...while the cap still lands');
end $$;

-- ── §16. trashing a contract draft leaves no scars (0227) ────────────────────
-- The reset's roster deletes fire _contract_release per row; before 0227 each
-- one was a CUT — multi-year deals left dead money for a draft that no longer
-- existed, and the register got a wall of drops. Now the deals dissolve and
-- the register gets one summary row; a signing made AFTER the draft survives
-- with its contract.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text; before_n int;
begin
  perform probe_as('a');
  r := create_native_league('Scorched Earth', '2026', 2, 5, 60, 'snake', 30, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 'ct16a create contract league');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Rebuilds'), 'ct16b B joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'se-p' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ct16c seed');
  update draft set status = 'complete', started_at = now() where league_id = lid;

  -- the "auction results": two picks with prices, one on a 3-year deal
  insert into draft_pick (league_id, overall, round, roster_id, slug, price)
  values (lid, 1, 1, 1, 'se-p1', 12), (lid, 2, 1, 2, 'se-p2', 8);
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'se-p1'), (lid, 2, 'se-p2');
  update contract set years = 3 where league_id = lid and slug = 'se-p1';
  perform assert_true((select salary from contract where league_id = lid and slug = 'se-p1') = 12,
    'ct16d the bid became the salary');
  -- a post-draft signing that must SURVIVE the reset
  perform assert_ok(add_free_agent(lid, 1, 'se-p3', null), 'ct16e A signs a street deal');

  select count(*) into before_n from league_txn where league_id = lid;
  r := commish_reset_draft(lid, 'RESET');
  perform assert_ok(r, 'ct16f the reset runs');
  perform assert_true((r ->> 'picks_cleared')::int = 2, 'ct16g both picks cleared');

  perform assert_true(not exists (select 1 from dead_money where league_id = lid),
    'ct16h THE POINT: unwinding a 3-year deal is not a cut — no dead money');
  perform assert_true(not exists (select 1 from contract where league_id = lid and slug in ('se-p1', 'se-p2')),
    'ct16i the drafted deals dissolved');
  perform assert_true((select (salary, years) = (1, 1) from contract where league_id = lid and slug = 'se-p3'),
    'ct16j the street deal signed after the draft survives untouched');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 1,
    'ct16k only the street signing still holds a roster spot');
  perform assert_true((select count(*) from league_txn where league_id = lid) = before_n + 1,
    'ct16l the register grew by exactly ONE row, not a wall of drops');
  perform assert_true((select (kind, note) = ('commish', 'draft reset — 2 picks cleared')
      from league_txn where league_id = lid order by id desc limit 1),
    'ct16m and that row says what actually happened');
  perform assert_true((select status from draft where league_id = lid) = 'pending',
    'ct16n the room is back to pending');
end $$;

-- ── §17. lock-to-play (0229) ─────────────────────────────────────────────────
-- The room closing no longer freezes lengths: a manager keeps assigning until
-- they 🔒 LOCK — and the wire (adds + claims) stays shut for their team until
-- they do. At the deadline unset deals stand at 1 year and the gate lifts on
-- its own. Commissioners correct deals at any time; a reset clears the locks.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  perform probe_as('a');
  r := create_native_league('Pen Or Padlock', '2026', 2, 5, 60, 'snake', 30, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 'ct17a create contract league');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Dawdles'), 'ct17b B joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'lk-p' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ct17c seed');
  update draft set status = 'complete', started_at = now(), completed_at = now() where league_id = lid;
  insert into draft_pick (league_id, overall, round, roster_id, slug, price)
  values (lid, 1, 1, 1, 'lk-p1', 12), (lid, 2, 1, 2, 'lk-p2', 8);
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'lk-p1'), (lid, 2, 'lk-p2');

  -- the wire is shut until the seat locks
  perform assert_err(add_free_agent(lid, 1, 'lk-p3', null), 'lock your contract lengths',
    'ct17d THE MOTIVATOR: no adds before locking');
  perform assert_err(submit_waiver_claim(lid, 1, 'lk-p3', null), 'lock your contract lengths',
    'ct17e ...and no claims either');

  -- the room being closed no longer freezes the owner's pen
  perform assert_ok(set_contract_years(lid, 'lk-p1', 3), 'ct17f the owner assigns a length AFTER the room closed');
  perform assert_true((select years from contract where league_id = lid and slug = 'lk-p1') = 3,
    'ct17g and it lands');

  -- locking opens the wire — for that seat alone
  r := lock_contracts(lid, 1);
  perform assert_ok(r, 'ct17h A locks');
  perform assert_ok(add_free_agent(lid, 1, 'lk-p3', null), 'ct17i A''s wire is open');
  perform probe_as('b');
  perform assert_err(add_free_agent(lid, 2, 'lk-p4', null), 'lock your contract lengths',
    'ct17j B''s wire is still shut — the lock is per seat');
  perform probe_as('a');

  -- the lock ending the OWNER's pen is §3's ct3e3 (a non-commish owner);
  -- seat 1 here is owner AND commissioner, and the commissioner's pen never
  -- goes down — locked deal, own deal, anyone's deal.
  perform assert_ok(set_contract_years(lid, 'lk-p1', 2), 'ct17k a commissioner corrects even their own locked deal');
  perform assert_ok(set_contract_years(lid, 'lk-p2', 2), 'ct17l ...and anyone else''s');
  perform assert_true(coalesce((league_contracts(lid) ->> 'my_locked')::boolean, false),
    'ct17m the cap sheet reports my lock');

  -- the deadline lifts the gate for the dawdler — 1-year deals stand
  update draft set completed_at = now() - interval '73 hours' where league_id = lid;
  perform probe_as('b');
  perform assert_ok(add_free_agent(lid, 2, 'lk-p4', null), 'ct17n past the deadline the gate lifts itself');
  perform assert_err(set_contract_years(lid, 'lk-p2', 3), 'lengths are locked',
    'ct17o ...and the unset lengths are final (1yr default stood)');
  perform probe_as('a');

  -- a reset clears the locks with everything else
  r := commish_reset_draft(lid, 'RESET');
  perform assert_ok(r, 'ct17p reset runs');
  perform assert_true(not exists (select 1 from league_membership
      where league_id = lid and contracts_locked), 'ct17q the locks reset with the room');
end $$;

-- ── §18. two markets, two jobs (0230) ────────────────────────────────────────
-- player_market_value prices the PLAYER: the value curve at his pool rank,
-- scaled to the cap — top of the board ≈ a third of the cap, monotone down,
-- $1 in the deeps — independent of what anyone overpaid at auction.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int;
begin
  perform probe_as('a');
  r := create_native_league('Fair Price', '2026', 2, 5, 60, 'snake', 40, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 'ct18a create ($40 cap)');
  lid := (r ->> 'league_id')::uuid;
  for i in 1..220 loop pool := pool || jsonb_build_object('slug', 'fp-p' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ct18b seed 220 ranks');
  perform assert_true(player_market_value(lid, 'fp-p1') between 12 and 14,
    'ct18c the top of the board prices at about a third of the cap');
  perform assert_true(player_market_value(lid, 'fp-p1') > player_market_value(lid, 'fp-p10')
    and player_market_value(lid, 'fp-p10') > player_market_value(lid, 'fp-p40'),
    'ct18d monotone down the board');
  perform assert_true(player_market_value(lid, 'fp-p200') = 1,
    'ct18e a deep-league afterthought prices at the $1 floor');
  -- and the two markets genuinely diverge: an overpaid star inflates the
  -- POSITIONAL top-5 (the tag price) but not a deep player's OWN market
  update draft set status = 'complete' where league_id = lid;
  perform assert_ok(add_free_agent(lid, 1, 'fp-p150', null), 'ct18f sign a deep flier');
  update contract set salary = 39 where league_id = lid and slug = 'fp-p150';   -- someone overpaid wildly
  perform assert_true(contract_market_value(lid, 'fp-p150') >= 39,
    'ct18g the positional tag price inhales the overpay');
  perform assert_true(player_market_value(lid, 'fp-p150') <= 2,
    'ct18h ...while HIS market stays what his rank is worth');
end $$;

-- ── §19. rookie deals run the league's own term (0231) ───────────────────────
-- Default 4 (the NFL's real rookie length), commissioner-settable, clamped to
-- the league max. The rookie branch fires on pick-owner drafts (pick_owners
-- set, no auction price) — the fixture arranges exactly that.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  perform probe_as('a');
  r := create_native_league('Term Limits', '2026', 2, 5, 60, 'snake', 40, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 'ct19a create contract league');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Scouts'), 'ct19b B joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'tl-p' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ct19c seed');
  update draft set status = 'complete', pick_owners = '[]'::jsonb where league_id = lid;

  -- a "rookie draft" pick: pick_owners set, no price → the rookie branch
  insert into draft_pick (league_id, overall, round, roster_id, slug) values (lid, 1, 1, 1, 'tl-p1');
  insert into native_roster (league_id, roster_id, slug) values (lid, 1, 'tl-p1');
  perform assert_true((select (salary, years, acquired) = (12, 4, 'rookie') from contract
      where league_id = lid and slug = 'tl-p1'),
    'ct19d THE DEFAULT: round-1 scale salary, FOUR years — the NFL''s own rookie term');

  -- the knob
  perform probe_as('b');
  perform assert_err(set_rookie_years(lid, 2), 'commissioner', 'ct19e members do not set the term');
  perform probe_as('a');
  perform assert_err(set_rookie_years(lid, 9), '1–4', 'ct19f the term clamps to the league max');
  perform assert_ok(set_rookie_years(lid, 2), 'ct19g commish sets 2-year rookie deals');
  perform assert_true((league_contracts(lid) -> 'rules' ->> 'rookie_years')::int = 2,
    'ct19h the rulebook reads it back');
  insert into draft_pick (league_id, overall, round, roster_id, slug) values (lid, 2, 1, 2, 'tl-p2');
  insert into native_roster (league_id, roster_id, slug) values (lid, 2, 'tl-p2');
  perform assert_true((select years from contract where league_id = lid and slug = 'tl-p2') = 2,
    'ct19i the next rookie signs at the new term');

  -- ── 0232: the startup AUCTION cannot age a rookie ──────────────────────────
  -- tl-p3 is a rookie (exp 0), tl-p4 a vet (exp 5): both won at auction.
  perform assert_ok(set_rookie_years(lid, 4), 'ct19j back to the 4yr default');
  update league_pool set exp = 0 where league_id = lid and slug = 'tl-p3';
  update league_pool set exp = 5 where league_id = lid and slug = 'tl-p4';
  -- the rookie lands on seat 2 (B, not the commissioner): the owner-facing
  -- refusal is the assertion — the commissioner's always-correct escape
  -- hatch is deliberate and stays.
  insert into draft_pick (league_id, overall, round, roster_id, slug, price)
  values (lid, 3, 2, 2, 'tl-p3', 7), (lid, 4, 2, 1, 'tl-p4', 9);
  insert into native_roster (league_id, roster_id, slug) values (lid, 2, 'tl-p3'), (lid, 1, 'tl-p4');
  perform assert_true((select (salary, years, acquired) = (7, 4, 'rookie') from contract
      where league_id = lid and slug = 'tl-p3'),
    'ct19k THE POINT: an auction-won rookie signs at his BID, on the rookie TERM, as a rookie deal');
  perform assert_true((select (salary, years, acquired) = (9, 1, 'auction') from contract
      where league_id = lid and slug = 'tl-p4'),
    'ct19l a veteran''s auction deal is untouched');
  perform probe_as('b');
  perform assert_err(set_contract_years(lid, 'tl-p3', 2), 'rookie term',
    'ct19m and his owner cannot assign the length — the rule holds it');
end $$;

select 'ALL CONTRACT PROBES PASSED' as result;
