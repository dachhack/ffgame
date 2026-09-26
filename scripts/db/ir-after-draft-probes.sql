-- 0296 IR-after-the-draft probes. Founder, week 2: "Michael Pittman is out.
-- Can we make sure his injury status is correct and that players can move him
-- to IR in the classic leagues?"
--
--   • the failure as found: a classic league drafted with no IR spots refuses
--     every stash ("IR is full — 0 spots"), and the shape setter refused to
--     add one after the draft;
--   • after the draft the commissioner adds an IR spot, and (0376) can move
--     the bench and taxi too, announced in chat; a member cannot;
--   • the Out player goes on IR, the second one finds the spot full, the seat
--     he freed takes a signing, and the roster is still legal at rounds + 1;
--   • a spot someone is standing in cannot be removed; an empty one can;
--   • a league that NEVER set a shape gets its bench derived from the rounds,
--     so its active seats are exactly what they were.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

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
declare r jsonb; lid uuid; lid2 uuid; code text; a_seat int; b_seat int; seats int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  -- ══ A CLASSIC LEAGUE THAT DRAFTED WITH NO IR ═════════════════════════════
  r := create_native_league('IR After', '2024', 2, 5, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'ia0 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'IA-B'), 'ia0a join'); perform probe_as('a');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'ia0b a three-spot lineup');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 0), 'ia0c two bench, no IR — the shape as drafted');

  perform seed_league_pool(lid, '[
    {"slug":"ia-out","full":"Out Guy","pos":"WR","team":"PIT","exp":6},
    {"slug":"ia-q","full":"Questionable Guy","pos":"RB","team":"KC","exp":3},
    {"slug":"ia-fit","full":"Fit Guy","pos":"QB","team":"KC","exp":3},
    {"slug":"ia-x1","full":"Extra One","pos":"RB","team":"KC","exp":3},
    {"slug":"ia-x2","full":"Extra Two","pos":"WR","team":"KC","exp":3},
    {"slug":"ia-free","full":"Free Guy","pos":"WR","team":"KC","exp":3},
    {"slug":"ia-c","full":"Commish Guy","pos":"QB","team":"KC","exp":3}]'::jsonb);
  insert into injury_status (player_slug, status) values ('ia-out', 'O'), ('ia-q', 'Q')
  on conflict (player_slug) do update set status = excluded.status;

  select sleeper_roster_id into a_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, b_seat, 'ia-out', 'draft'), (lid, b_seat, 'ia-q', 'draft'), (lid, b_seat, 'ia-fit', 'draft'),
    (lid, b_seat, 'ia-x1', 'draft'), (lid, b_seat, 'ia-x2', 'draft'), (lid, a_seat, 'ia-c', 'draft');
  update draft set status = 'complete' where league_id = lid;

  -- ══ THE FAILURE AS FOUND ═════════════════════════════════════════════════
  perform probe_as('b');
  perform assert_err(set_roster_spot(lid, 'ia-out', 'ir'), 'IR is full — 0 spots',
    'ia1 with no IR spots an Out player has nowhere to go');
  perform assert_err(set_league_roster_shape(lid, 2, 0, 1), 'commissioner only',
    'ia1a and a member cannot add one');

  -- ══ THE COMMISSIONER ADDS ONE, AFTER THE DRAFT ═══════════════════════════
  perform probe_as('a');
  -- 0376: after the draft the bench and taxi move too, and chat says so.
  r := set_league_roster_shape(lid, 3, 0, 0);
  perform assert_ok(r, 'ia2 the bench grows after the draft (0376)');
  perform assert_true((r ->> 'rounds')::int = 6 and (select rounds from draft where league_id = lid) = 6, 'ia2a the roster grows with it');
  perform assert_true((select body from league_message where league_id = lid order by id desc limit 1)
                      = 'Roster spots changed by the commissioner: bench 2 → 3.', 'ia2b the league hears about it');
  perform assert_true((select txn ->> 'kind' from league_message where league_id = lid order by id desc limit 1) = 'roster_shape',
    'ia2c …as a house line carrying what changed');
  perform assert_err(set_league_roster_shape(lid, 1, 0, 0), 'the bench can drop to 2',
    'ia2d the bench cannot shrink below a team''s players');
  perform assert_ok(set_league_roster_shape(lid, 2, 1, 0), 'ia2e bench back to 2, and a taxi spot');
  perform assert_true((select body from league_message where league_id = lid order by id desc limit 1)
                      = 'Roster spots changed by the commissioner: bench 3 → 2, taxi 0 → 1.', 'ia2f one line names both');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 0), 'ia2g taxi back to 0');
  r := set_league_roster_shape(lid, 2, 0, 0);
  perform assert_ok(r, 'ia2h asking for the shape it has reads it back');
  perform assert_true((r -> 'shape' ->> 'ir')::int = 0 and (r ->> 'rounds')::int = 5, 'ia2i …unchanged');
  perform assert_true((select count(*) from league_message where league_id = lid and txn ->> 'kind' = 'roster_shape') = 3, 'ia2j …and says nothing');
  r := set_league_roster_shape(lid, 2, 0, 1);
  perform assert_ok(r, 'ia3 one IR spot, after the draft');
  perform assert_true(r -> 'shape' = '{"bench": 2, "taxi": 0, "ir": 1, "out": 0}'::jsonb, 'ia3a the shape carries it');
  perform assert_true((r ->> 'rounds')::int = 6 and (r ->> 'draft_rounds')::int = 5,
    'ia3b the roster grew by one; the draft did not');
  perform assert_true((select rounds from draft where league_id = lid) = 6, 'ia3c draft.rounds moved with it');
  perform assert_true(league_active_seats(lid) = 5, 'ia3d active seats are what they were');
  perform assert_true((select body from league_message where league_id = lid order by id desc limit 1)
                      = 'Roster spots changed by the commissioner: IR 0 → 1.', 'ia3e an IR change is announced too');
  r := set_league_roster_shape(lid, 3, 0, 2);
  perform assert_ok(r, 'ia3f a bench change beside an IR change applies both (0376)');
  perform assert_true(r -> 'shape' = '{"bench": 3, "taxi": 0, "ir": 2, "out": 0}'::jsonb, 'ia3f …' || r::text);
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 1), 'ia3f back');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 1), 'ia3g back to one');

  -- ══ THE OUT PLAYER GOES ON IR ════════════════════════════════════════════
  perform probe_as('b');
  perform assert_ok(set_roster_spot(lid, 'ia-out', 'ir'), 'ia4 the Out player goes on IR');
  perform assert_err(set_roster_spot(lid, 'ia-q', 'ir'), 'IR is full — 1 spots',
    'ia4a the second finds the spot taken');
  perform assert_true(roster_seat_error(lid, b_seat) is null, 'ia4b the seat he freed is open to a signing');
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, b_seat, 'ia-free', 'fa');
  perform assert_true(roster_illegal_reason(lid, b_seat) is null,
    'ia4c six held against a roster of six — legal, because rounds moved');

  -- ══ A SPOT SOMEONE STANDS IN STAYS ═══════════════════════════════════════
  perform probe_as('a');
  perform assert_err(set_league_roster_shape(lid, 2, 0, 0), 'players on IR',
    'ia5 the spot cannot go while he is on it');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 3), 'ia5a it can grow');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 1), 'ia5b and shrink back to what is used');
  perform assert_true((select rounds from draft where league_id = lid) = 6, 'ia5c rounds follow');

  -- ══ A LEAGUE THAT NEVER SET A SHAPE ══════════════════════════════════════
  r := create_native_league('Never Shaped', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'ia6 a classic league with the default roster'); lid2 := (r ->> 'league_id')::uuid;
  perform assert_ok(set_league_classic_slots(lid2,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'ia6a three starters');
  update draft set status = 'complete' where league_id = lid2;
  perform assert_true(_roster_shape(lid2) = '{}'::jsonb, 'ia6b no shape was ever written');
  seats := league_active_seats(lid2);
  perform assert_true(seats = 8, 'ia6c its whole roster is active seats (0199)');
  r := set_league_roster_shape(lid2, 0, 0, 2);
  perform assert_ok(r, 'ia7 two IR spots, after the draft, on a never-shaped league');
  perform assert_true(r -> 'shape' = '{"bench": 5, "taxi": 0, "ir": 2, "out": 0}'::jsonb,
    'ia7a the bench is derived from the rounds (8 − 3 starters)');
  perform assert_true((r ->> 'rounds')::int = 10, 'ia7b the roster is rounds + IR');
  perform assert_true(league_active_seats(lid2) = seats, 'ia7c active seats did not move');
  -- 0376: the bench it was sent (0) was the client's default beside an IR change.

  raise notice 'ir-after-draft probes done';
end $$;

select 'ALL IR-AFTER-DRAFT PROBES PASSED' as result;
