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
  perform assert_err(set_contract_years(lid, 'ct-rb1', 2), 'lock', 'ct3e lengths lock when the room closes');
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

select 'ALL CONTRACT PROBES PASSED' as result;
