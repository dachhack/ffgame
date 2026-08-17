-- 0186 league-register probes: the transaction log written by the
-- native_roster trigger.
--
-- What must hold:
--   • NOTHING registers until the draft is complete — draft picks, keeper
--     seeding and pool reseeds stay out of the register entirely;
--   • a free-agent pickup registers 'add'; a pickup WITH a drop registers
--     both, naming two different players;
--   • a won waiver claim registers 'waiver' and carries its winning bid;
--   • an executed trade registers 'trade' per player WITH the seat it came
--     from, and never a phantom 'drop';
--   • a commissioner move registers 'commish' and its delete leg is
--     suppressed (same slug, same transaction = a move, not a drop);
--   • a taxi/IR spot change is NOT roster movement and registers nothing;
--   • the register is newest-first, limit-clamped, and refused to outsiders.
\set QUIET on
\pset pager off

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
-- How many rows of a kind does the register show?
create or replace function reg_count(l uuid, k text) returns int language plpgsql as $$
declare n int;
begin
  select count(*) into n from jsonb_array_elements((league_register(l, 500)) -> 'rows') e
   where e ->> 'kind' = k;
  return n;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000f', 'f@test.dev'),
  ('00000000-0000-0000-0000-000000000001', '1@test.dev'),
  ('00000000-0000-0000-0000-000000000002', '2@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; code text; pool jsonb; i int; s text; rows jsonb; top jsonb;
  a_slug text; b_slug text; give text; get text; tid uuid; n int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000f', 'f@test.dev'),
    ('00000000-0000-0000-0000-000000000001', '1@test.dev'),
    ('00000000-0000-0000-0000-000000000002', '2@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000001',
                 '00000000-0000-0000-0000-000000000002');

  -- ── fixture: 2 teams × 5 rounds, f commish on seat 1, user 1 on seat 2 ────
  perform probe_as('f');
  r := create_native_league('Register League', '2024', 2, 5, 60);
  perform assert_ok(r, 'rg0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('1'); perform assert_ok(native_join(code, 'RG-B'), 'rg0a b joins');
  perform probe_as('f');

  pool := '[]'::jsonb;
  for i in 1..24 loop
    pool := pool || jsonb_build_object(
      'slug', 'r' || lpad(i::text, 2, '0'), 'full', 'Reg Player ' || i,
      'pos', case when i % 2 = 0 then 'WR' else 'RB' end, 'team', 'T' || (i % 8), 'exp', 3);
  end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'rg0b pool');

  -- ── the draft registers NOTHING ───────────────────────────────────────────
  perform assert_ok(start_draft(lid), 'rg1 start');
  for i in 1..10 loop
    select lp.slug into s from league_pool lp
      where lp.league_id = lid
        and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
      order by lp.rank limit 1;
    perform assert_ok(make_draft_pick(lid, s), 'rg1a pick ' || i);
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', 'rg1b draft complete');
  perform assert_true((select count(*) from league_txn where league_id = lid) = 0,
    'rg1c the draft itself registers nothing');

  -- ── a free-agent pickup, then a pickup WITH a drop ────────────────────────
  select lp.slug into a_slug from league_pool lp
    where lp.league_id = lid
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  -- seat 1 is full (5 of 5), so the first pickup must swap someone out
  select nr.slug into b_slug from native_roster nr where nr.league_id = lid and nr.roster_id = 1 limit 1;
  perform assert_ok(add_free_agent(lid, 1, a_slug, b_slug), 'rg2 fa swap');
  perform assert_true(reg_count(lid, 'add') = 1, 'rg2a the pickup registered');
  perform assert_true(reg_count(lid, 'drop') = 1, 'rg2b the drop registered too');
  -- two DIFFERENT players in one transaction — the swap is not collapsed
  perform assert_true((select count(distinct e ->> 'slug') from jsonb_array_elements((league_register(lid, 50)) -> 'rows') e) = 2,
    'rg2c the swap names both players');
  -- the register knows whose move it was
  rows := (league_register(lid, 50)) -> 'rows';
  perform assert_true((rows -> 0 ->> 'team') is not null, 'rg2d team name resolved');

  -- ── a plain drop ─────────────────────────────────────────────────────────
  select nr.slug into s from native_roster nr where nr.league_id = lid and nr.roster_id = 1 limit 1;
  perform assert_ok(drop_player(lid, 1, s), 'rg3 drop');
  perform assert_true(reg_count(lid, 'drop') = 2, 'rg3a the drop registered');

  -- ── a won waiver claim carries its bid ───────────────────────────────────
  perform assert_ok(set_transaction_rules(lid, 'faab', 100, null), 'rg4 faab on');
  select lp.slug into a_slug from league_pool lp
    where lp.league_id = lid
      and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    order by lp.rank limit 1;
  perform assert_ok(submit_waiver_claim(lid, 1, a_slug, null, 7), 'rg4a claim');
  -- clear the hold so the run resolves it now
  update waiver_claim set created_at = now() - interval '3 days' where league_id = lid;
  update league_pool set waived_until = now() - interval '1 minute' where league_id = lid;
  perform assert_ok(process_waivers(lid), 'rg4b run');
  perform assert_true(reg_count(lid, 'waiver') = 1, 'rg4c the claim registered');
  perform assert_true((select (e ->> 'bid')::int from jsonb_array_elements((league_register(lid, 50)) -> 'rows') e
                        where e ->> 'kind' = 'waiver' limit 1) = 7,
    'rg4d the winning bid rode along');

  -- ── a trade: 'trade' per player, from_roster named, no phantom drop ──────
  n := reg_count(lid, 'drop');
  select nr.slug into give from native_roster nr where nr.league_id = lid and nr.roster_id = 1 limit 1;
  select nr.slug into get  from native_roster nr where nr.league_id = lid and nr.roster_id = 2 limit 1;
  perform probe_as('f');
  r := propose_trade(lid, 1, 2, jsonb_build_array(give), jsonb_build_array(get), null);
  perform assert_ok(r, 'rg5 propose');
  tid := (r ->> 'trade_id')::uuid;
  perform probe_as('1');
  perform assert_ok(execute_trade(tid), 'rg5a execute');
  perform assert_true(reg_count(lid, 'trade') = 2, 'rg5b both players registered as trades');
  perform assert_true(reg_count(lid, 'drop') = n, 'rg5c a trade is never a drop');
  perform assert_true((select (e ->> 'from_roster')::int from jsonb_array_elements((league_register(lid, 50)) -> 'rows') e
                        where e ->> 'kind' = 'trade' and e ->> 'slug' = give limit 1) = 1,
    'rg5d the trade names the seat it came from');

  -- ── a commissioner move: 'commish', and its delete leg is suppressed ─────
  perform probe_as('f');
  n := reg_count(lid, 'drop');
  select nr.slug into s from native_roster nr where nr.league_id = lid and nr.roster_id = 2 limit 1;
  perform assert_ok(commish_move_player(lid, s, 1), 'rg6 commish move');
  perform assert_true(reg_count(lid, 'commish') = 1, 'rg6a the move registered');
  perform assert_true(reg_count(lid, 'drop') = n, 'rg6b a move is not a drop');

  -- ── a taxi/IR stash is not roster movement ──────────────────────────────
  n := (select count(*) from league_txn where league_id = lid);
  select nr.slug into s from native_roster nr where nr.league_id = lid and nr.roster_id = 1 limit 1;
  r := set_roster_spot(lid, s, 'ir');
  if coalesce((r ->> 'ok')::boolean, false) then
    perform assert_true((select count(*) from league_txn where league_id = lid) = n,
      'rg7 a stash registers nothing');
  end if;

  -- ── shape: newest first, clamped, and closed to outsiders ───────────────
  rows := (league_register(lid, 500)) -> 'rows';
  perform assert_true(jsonb_array_length(rows) >= 6, 'rg8 the register has the season in it');
  perform assert_true((rows -> 0 ->> 'at')::timestamptz >= (rows -> 1 ->> 'at')::timestamptz,
    'rg8a newest first');
  perform assert_true(jsonb_array_length((league_register(lid, 2)) -> 'rows') = 2, 'rg8b limit honored');
  perform probe_as('2');
  perform assert_err(league_register(lid, 50), 'forbidden', 'rg9 outsider refused');

  raise notice 'register probes done';
end $$;

select 'ALL REGISTER PROBES PASSED' as result;
