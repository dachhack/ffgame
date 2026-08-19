-- 0196 taxi-rules probes.
--
--   • the commissioner names a TENURE ceiling and it bites: a veteran is
--     refused, a rookie rides, and a player whose experience nobody knows is
--     refused too (he cannot prove he qualifies);
--   • the squad LOCKS at the season's first kickoff — adding is refused,
--     REMOVING is not, and the commissioner may still do either;
--   • a league that turns the lock off never shuts;
--   • and both settings move at ANY time, including mid-season.
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

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; b_seat int; mid uuid;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  r := create_native_league('Taxi Rules', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'tr0 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'TR-B'), 'tr0a join'); perform probe_as('a');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'tr0b a three-spot lineup');
  perform assert_ok(set_league_roster_shape(lid, 2, 3, 0), 'tr0c two bench, three taxi — room to test eligibility, not capacity');

  -- A pool with a rookie, a second-year, a veteran and an unknown.
  perform seed_league_pool(lid, '[
    {"slug":"tx-rook","full":"Rook","pos":"RB","team":"KC","exp":0},
    {"slug":"tx-soph","full":"Soph","pos":"RB","team":"KC","exp":1},
    {"slug":"tx-vet","full":"Vet","pos":"RB","team":"KC","exp":7},
    {"slug":"tx-unknown","full":"Unknown","pos":"RB","team":"KC"},
    {"slug":"tx-x1","full":"X1","pos":"WR","team":"KC","exp":3},
    {"slug":"tx-x2","full":"X2","pos":"QB","team":"KC","exp":3}]'::jsonb);
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  -- Put the four on B's roster by hand: this is about designations, not drafts.
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, b_seat, 'tx-rook', 'draft'), (lid, b_seat, 'tx-soph', 'draft'),
    (lid, b_seat, 'tx-vet', 'draft'), (lid, b_seat, 'tx-unknown', 'draft');

  -- ══ NO RULES YET: ANYONE RIDES ═══════════════════════════════════════════
  perform probe_as('b');
  perform assert_ok(set_roster_spot(lid, 'tx-vet', 'taxi'), 'tr1 with no ceiling set, a veteran may ride');
  perform assert_ok(set_roster_spot(lid, 'tx-vet', 'active'), 'tr1a and come back off');

  -- ══ THE TENURE CEILING ═══════════════════════════════════════════════════
  perform probe_as('a');
  perform assert_err(set_taxi_rules(lid, 99, null), 'must be 0-30', 'tr2 an absurd ceiling is refused');
  perform assert_err(set_taxi_rules(lid, -2, null), 'must be 0-30', 'tr2b …and so is a nonsense negative');
  perform assert_ok(set_taxi_rules(lid, 1, null), 'tr2a first- and second-year players only');
  perform probe_as('b');
  perform assert_ok(set_roster_spot(lid, 'tx-rook', 'taxi'), 'tr3 a rookie rides');
  perform assert_ok(set_roster_spot(lid, 'tx-soph', 'taxi'), 'tr3a so does a second-year');
  perform assert_err(set_roster_spot(lid, 'tx-vet', 'taxi'), 'or fewer years', 'tr3b a seven-year veteran does not');
  perform assert_err(set_roster_spot(lid, 'tx-unknown', 'taxi'), 'isn''t known',
    'tr3c and neither does a player whose experience nobody knows');
  -- The refusal names the numbers, so the manager knows what would qualify.
  perform assert_true(position('he has 7' in (set_roster_spot(lid, 'tx-vet', 'taxi') ->> 'error')) > 0,
    'tr3d the refusal says how many years he has');

  -- ══ THE LOCK ═════════════════════════════════════════════════════════════
  -- No schedule yet ⇒ no kickoff ⇒ nothing to lock.
  perform assert_true(taxi_is_locked(lid) = false, 'tr4 with no schedule there is no lock');
  perform assert_ok(set_roster_spot(lid, 'tx-rook', 'active'), 'tr4a still free to move');
  -- Give the league a week 1 whose kickoff has passed.
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status, lock_at)
    values (gen_random_uuid(), lid, 1, 1, b_seat, 'final', now() - interval '2 days')
    returning id into mid;
  perform assert_true(taxi_is_locked(lid), 'tr5 the season''s first kickoff shut it');
  perform probe_as('b');
  perform assert_err(set_roster_spot(lid, 'tx-rook', 'taxi'), 'locked at the season',
    'tr5a a manager may no longer ADD to the taxi');
  -- …but taking one OFF is always allowed, which is the point of having him.
  perform assert_ok(set_roster_spot(lid, 'tx-soph', 'active'), 'tr5b and may always take one OFF');
  -- The commissioner moves players either way, whenever.
  perform probe_as('a');
  perform assert_ok(set_roster_spot(lid, 'tx-rook', 'taxi'), 'tr6 the commissioner is not locked out');

  -- ══ A LEAGUE THAT DOESN'T LOCK ═══════════════════════════════════════════
  perform assert_ok(set_taxi_rules(lid, null, false), 'tr7 lock off');
  perform assert_true(taxi_is_locked(lid) = false, 'tr7a …and it is open again');
  perform probe_as('b');
  perform assert_ok(set_roster_spot(lid, 'tx-soph', 'taxi'), 'tr7b a manager can add again');

  -- ══ THE CEILING CLEARS ═══════════════════════════════════════════════════
  perform probe_as('a');
  perform assert_ok(set_taxi_rules(lid, -1, null), 'tr8 -1 clears the ceiling');
  perform probe_as('b');
  perform assert_ok(set_roster_spot(lid, 'tx-vet', 'taxi'), 'tr8a and the veteran may ride again');

  -- Members cannot set the rules.
  perform assert_err(set_taxi_rules(lid, 0, null), 'commissioner only', 'tr9 a member cannot set them');

  raise notice 'taxi-rules probes done';
end $$;

select 'ALL TAXI-RULES PROBES PASSED' as result;
