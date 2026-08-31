-- FORMAT probes (0221/0222) — 🔪 guillotine and 🧛 vampire, end to end: the
-- blade falls on the lowest score and releases the roster to the frenzy, the
-- dead seat is sealed at the roster door, the vampire steals only on a fresh
-- win (and only from the active roster), the commissioner's steal review
-- parks and rules, and every event prints in the league register.
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

-- Shared fixture builder: an N-team league, pool seeded, draft force-complete,
-- every seat holding `per` players, a `weeks`-week schedule generated.
create or replace function _fmt_fixture(nm text, teams int, per int, weeks int, pfx text)
  returns uuid language plpgsql as $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; t int; code text; u text;
begin
  perform probe_as('a');
  r := create_native_league(nm, '2026', teams, 5, 60, 'snake');
  if not (r ->> 'ok')::boolean then raise exception 'fixture create failed: %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b'); perform native_join(code, 'Team B');
  if teams >= 3 then perform probe_as('c'); perform native_join(code, 'Team C'); end if;
  perform probe_as('a');
  for i in 1..(teams * per + 8) loop
    pool := pool || jsonb_build_object('slug', pfx || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  r := seed_league_pool(lid, pool);
  if not (r ->> 'ok')::boolean then raise exception 'fixture seed failed: %', r; end if;
  update draft set status = 'complete' where league_id = lid;
  -- hand out rosters directly (probes elsewhere do the same): seat t gets
  -- players (t-1)*per+1 .. t*per
  for t in 1..teams loop
    for i in 1..per loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid, t, pfx || ((t - 1) * per + i), 'commish');
    end loop;
  end loop;
  r := native_generate_schedule(lid, weeks);
  if not (r ->> 'ok')::boolean then raise exception 'fixture schedule failed: %', r; end if;
  return lid;
end $$;

-- Score one week: seat 1 highest, each later seat lower — seat `teams` is the
-- floor. Deterministic and different per week (base shifts).
create or replace function _fmt_score_week(lid uuid, wk int, base numeric)
  returns void language plpgsql as $$
begin
  update matchup m set status = 'final',
    home_final = base + 100 - m.home_roster_id * 10,
    away_final = base + 100 - m.away_roster_id * 10
  where m.league_id = lid and m.week = wk;
end $$;

-- ── 1. the format axis ───────────────────────────────────────────────────────
do $$
declare lid uuid; r jsonb; msg text;
begin
  lid := _fmt_fixture('Head Chopper', 4, 3, 3, 'gl-');
  perform probe_as('b');
  perform assert_err(set_league_format(lid, 'guillotine'), 'commissioner', 'f1a members do not pick the format');
  perform probe_as('a');
  perform assert_err(set_league_format(lid, 'battle-royale'), 'format must be', 'f1b unknown format refused');
  -- draft is already complete in the fixture: guillotine is a pre-draft choice
  perform assert_err(set_league_format(lid, 'guillotine'), 'before the draft', 'f1c guillotine locks at the draft');
  update draft set status = 'pending' where league_id = lid;
  r := set_league_format(lid, 'guillotine');
  perform assert_ok(r, 'f1d guillotine set pre-draft');
  update draft set status = 'complete' where league_id = lid;
  perform assert_true(league_format(lid) = 'guillotine', 'f1e axis reads back');
  perform assert_true((select settings_json ->> 'waiver_mode' from league where id = lid) = 'faab'
    and (select (settings_json ->> 'faab_budget')::int from league where id = lid) = 1000,
    'f1f THE PRESET: guillotine lives on a $1000 FAAB market');

  -- ── 2. the blade ───────────────────────────────────────────────────────────
  perform _fmt_score_week(lid, 1, 0);
  perform probe_as('b');
  r := guillotine_tick(lid);
  perform assert_ok(r, 'f2a any member pokes the blade');
  perform assert_true((r ->> 'eliminated')::int = 1, 'f2b one head rolls');
  perform assert_true((select eliminated_week from league_membership
      where league_id = lid and sleeper_roster_id = 4) = 1,
    'f2c the floor dies: seat 4 had the lowest score');
  perform assert_true(not exists (select 1 from native_roster where league_id = lid and roster_id = 4),
    'f2d the dead roster is EMPTY');
  perform assert_true((select count(*) from league_pool lp where lp.league_id = lid
      and lp.slug in ('gl-10', 'gl-11', 'gl-12') and lp.waived_until > now()) = 3,
    'f2e all three players on waivers — the frenzy');
  perform assert_true((guillotine_tick(lid) ->> 'eliminated')::int = 0, 'f2f the tick is idempotent');
  -- the register kept the whole event
  perform assert_true(exists (select 1 from league_txn where league_id = lid
      and kind = 'elimination' and roster_id = 4 and note like 'week 1%'),
    'f2g register: the elimination');
  perform assert_true((select count(*) from league_txn where league_id = lid
      and kind = 'release' and roster_id = 4 and note = 'guillotine week 1') = 3,
    'f2h register: three releases, named as releases (not anonymous drops)');

  -- a dead seat never gains a player, by any path
  begin
    perform probe_as('a');
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, 4, 'gl-13', 'commish');
    raise exception 'PROBE FAIL f2i a dead seat gained a player';
  exception when others then
    msg := sqlerrm;
    if position('guillotine' in msg) = 0 then raise; end if;
  end;

  -- state: cutline + fallen + frenzy
  r := guillotine_state(lid);
  perform assert_true((r ->> 'guillotine')::boolean and jsonb_array_length(r -> 'alive') = 3
      and jsonb_array_length(r -> 'fallen') = 1 and jsonb_array_length(r -> 'frenzy') >= 3,
    'f2j the cutline reads back');

  -- weeks 2 and 3: the blade keeps falling until one stands
  perform _fmt_score_week(lid, 2, 0);
  perform _fmt_score_week(lid, 3, 0);
  r := guillotine_tick(lid);
  perform assert_true((r ->> 'eliminated')::int = 2, 'f2k catch-up: two overdue weeks, two heads');
  r := guillotine_state(lid);
  perform assert_true((r ->> 'champion')::int = 1, 'f2l last one standing is the champion');
end $$;

-- ── 3 + 4. the vampire ───────────────────────────────────────────────────────
do $$
declare lid uuid; r jsonb; sid bigint; msg text;
begin
  lid := _fmt_fixture('Night Feeder', 2, 3, 3, 'vp-');
  perform probe_as('a');
  perform assert_err(set_vampire(lid, 2), 'format to vampire', 'f3a the seat needs the format');
  perform assert_ok(set_league_format(lid, 'vampire'), 'f3b format set (any time — vampire is a twist on H2H)');
  perform probe_as('b');
  perform assert_err(set_vampire(lid, 2), 'commissioner', 'f3c members do not appoint the vampire');
  perform probe_as('a');
  perform assert_ok(set_vampire(lid, 2), 'f3d seat 2 is the vampire');

  -- 0268: the vampire BUILDS from the pool (it doesn't draft) — the wire is
  -- open to it by default…
  perform probe_as('b');
  perform assert_ok(add_free_agent(lid, 2, 'vp-7', null), 'f3e the vampire signs from the pool (0268)');
  -- …and the OPTIONAL lock closes it to everyone else instead.
  perform probe_as('a');
  perform assert_ok(set_vampires(lid, '[2]'::jsonb, null, true), 'f3e2 the wire locks to the coven');
  -- 0272: the refusal ANSWERS now (it used to raise from the seat guard, so
  -- the client took its error path where every other rule hands back an
  -- {ok:false, error}). The trigger still stands behind it — pinned below.
  perform assert_err(add_free_agent(lid, 1, 'vp-8', null), 'wire belongs to the vampire',
    'f3e3 a non-vampire is refused the locked wire, in words not exceptions');
  begin
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, 1, 'vp-8', 'fa');
    raise exception 'PROBE FAIL f3e3b the seat guard must still refuse a direct insert';
  exception when others then
    msg := sqlerrm;
    if position('wire belongs to the vampire' in msg) = 0 then raise; end if;
  end;
  perform assert_ok(set_vampires(lid, '[2]'::jsonb, null, false), 'f3e4 …and unlocks again');
  perform probe_as('b');

  perform assert_err(vampire_steal(lid, 'vp-1', 'vp-4'), 'no completed week', 'f3f no blood before a final');
  -- week 1: seat 2 (vampire) WINS — away_final formula gives seat 1 less? Use
  -- explicit scores: vampire 120, seat 1 80.
  update matchup set status = 'final',
    home_final = case when home_roster_id = 2 then 120 else 80 end,
    away_final = case when away_roster_id = 2 then 120 else 80 end
  where league_id = lid and week = 1;
  perform probe_as('c');
  perform assert_err(vampire_steal(lid, 'vp-1', 'vp-4'), 'only the vampire', 'f3g strangers do not feed');
  perform probe_as('b');
  perform assert_err(vampire_steal(lid, 'vp-9', 'vp-4'), 'active roster', 'f3h steal only whats rostered');
  perform assert_err(vampire_steal(lid, 'vp-1', 'vp-9'), 'give back one of your own', 'f3i the swap needs your piece');
  r := vampire_steal(lid, 'vp-1', 'vp-4');
  perform assert_ok(r, 'f3j THE BITE: review off, the steal executes');
  perform assert_true((select roster_id from native_roster where league_id = lid and slug = 'vp-1') = 2
      and (select roster_id from native_roster where league_id = lid and slug = 'vp-4') = 1,
    'f3k the 1-for-1 swap landed');
  perform assert_true((select count(*) from league_txn where league_id = lid and kind = 'steal') = 2,
    'f3l register: both legs print as steals');
  perform assert_err(vampire_steal(lid, 'vp-2', 'vp-5'), 'one steal per win', 'f3m one bite per week');

  -- week 2: the vampire LOSES — no blood
  update matchup set status = 'final',
    home_final = case when home_roster_id = 2 then 60 else 130 end,
    away_final = case when away_roster_id = 2 then 60 else 130 end
  where league_id = lid and week = 2;
  perform assert_err(vampire_steal(lid, 'vp-2', 'vp-5'), 'no fresh blood', 'f3n a loss feeds nobody');

  -- ── 4. the commissioner's hand: steal review ───────────────────────────────
  perform probe_as('a');
  perform assert_ok(set_vampire(lid, 2, true), 'f4a review on');
  -- week 3: vampire wins again
  update matchup set status = 'final',
    home_final = case when home_roster_id = 2 then 110 else 70 end,
    away_final = case when away_roster_id = 2 then 110 else 70 end
  where league_id = lid and week = 3;
  perform probe_as('b');
  r := vampire_steal(lid, 'vp-2', 'vp-5');
  perform assert_true((r ->> 'ok')::boolean and (r ->> 'status') = 'pending',
    'f4b with review on, the steal PARKS for the ruling');
  perform assert_true((select roster_id from native_roster where league_id = lid and slug = 'vp-2') = 1,
    'f4c nothing moved yet');
  select id into sid from vampire_steal where league_id = lid and week = 3 and status = 'pending';
  perform assert_err(commish_rule_steal(lid, sid, true), 'commissioner', 'f4d members do not rule');
  perform probe_as('a');
  perform assert_ok(commish_rule_steal(lid, sid, false), 'f4e vetoed');
  perform assert_true(exists (select 1 from league_txn where league_id = lid
      and kind = 'commish' and note = 'steal vetoed'), 'f4f register: the veto prints');
  -- a veto frees the week: declare again, approve this time
  perform probe_as('b');
  r := vampire_steal(lid, 'vp-2', 'vp-5');
  perform assert_true((r ->> 'status') = 'pending', 'f4g re-declared after the veto');
  select id into sid from vampire_steal where league_id = lid and week = 3 and status = 'pending';
  perform probe_as('a');
  perform assert_ok(commish_rule_steal(lid, sid, true), 'f4h approved');
  perform assert_true((select roster_id from native_roster where league_id = lid and slug = 'vp-2') = 2,
    'f4i the approved steal executed');
  r := vampire_state(lid);
  perform assert_true((r ->> 'vampire')::boolean and (r ->> 'seat')::int = 2
      and (r ->> 'fed')::boolean and jsonb_array_length(r -> 'steals') = 3,
    'f4j the vampire''s window reads back (3 declared: executed, vetoed, executed)');
end $$;

-- ── 5. the register keeps the front office (0222 re-creates) ─────────────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text;
begin
  perform probe_as('a');
  r := create_native_league('Paper Trail', '2026', 2, 5, 60, 'snake', 40, 15, 1, null, null, null, 'drip', 'contract', null);
  perform assert_ok(r, 'f5a contract league');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b'); perform assert_ok(native_join(code, 'B Ledger'), 'f5b joins');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'pt-' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'f5c seed');
  update draft set status = 'complete' where league_id = lid;
  update league set season = '2020' where id = lid;   -- offseason open for real seats
  perform assert_ok(add_free_agent(lid, 1, 'pt-1', null), 'f5d');
  perform probe_as('b');
  perform assert_ok(add_free_agent(lid, 2, 'pt-2', null), 'f5e');
  update contract set salary = 10, years = 3 where league_id = lid and slug = 'pt-1';
  update contract set salary = 4, years = 1 where league_id = lid and slug = 'pt-2';
  -- retention + cap dollars print
  perform probe_as('a');
  perform assert_ok(set_salary_rules(lid, null, null, true, null, null, null, null), 'f5f cap trading on');
  r := propose_trade(lid, 1, 2, '["pt-1"]'::jsonb, '[]'::jsonb, null, null, null,
                     '[{"slug":"pt-1","amount":3}]'::jsonb, 5);
  perform assert_ok(r, 'f5g terms offered');
  perform probe_as('b');
  perform assert_ok(respond_trade((r ->> 'trade_id')::uuid, true), 'f5h accepted');
  perform assert_true(exists (select 1 from league_txn where league_id = lid
      and kind = 'retained' and roster_id = 1 and slug = 'pt-1' and note like '$3%'),
    'f5i register: the retained salary');
  perform assert_true(exists (select 1 from league_txn where league_id = lid
      and kind = 'cap' and note like '$5%'), 'f5j register: the traded cap room');
  -- tag / extension print
  r := franchise_tag(lid, 'pt-2');
  perform assert_ok(r, 'f5k tag');
  perform assert_true(exists (select 1 from league_txn where league_id = lid
      and kind = 'tag' and slug = 'pt-2' and note like 'franchise tagged%'),
    'f5l register: the tag, with its price');
  -- and the read carries notes through
  r := league_register(lid);
  perform assert_true((r ->> 'ok')::boolean and exists (
      select 1 from jsonb_array_elements(r -> 'rows') x
      where x ->> 'kind' = 'tag' and x ->> 'note' is not null),
    'f5m league_register returns the note');
end $$;

drop function _fmt_fixture(text, int, int, int, text);
drop function _fmt_score_week(uuid, int, numeric);
select 'ALL FORMAT PROBES PASSED' as result;
