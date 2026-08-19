-- 0199 seat-cap probes: A TAXI PLAYER DOESN'T TAKE A BENCH SPOT.
--
--   • stashing a player on the taxi FREES a bench seat — the founder's
--     sentence, and the thing the total-cap check could never do;
--   • a signing that would make more active players than there are active
--     seats is refused, even while the roster total has room in empty taxi/IR
--     places;
--   • dropping a TAXI player frees no bench seat (the same rule, other side);
--   • a waiver claim with no drop is judged on the seat too, at submit time
--     and again at processing;
--   • a league with NO ROSTER SHAPE is bit-for-bit unchanged: the whole roster
--     is its active seats;
--   • and ownership % counts leagues, not rosters.
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
declare r jsonb; lid uuid; dlid uuid; code text; b_seat int; a_seat int; i int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  -- ══ A SHAPED CLASSIC LEAGUE: 3 starters + 2 bench + 2 taxi + 1 IR = 8 ════
  r := create_native_league('Seats', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'sc0 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'SC-B'), 'sc0a join'); perform probe_as('a');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'sc0b three starting spots');
  r := set_league_roster_shape(lid, 2, 2, 1);
  perform assert_ok(r, 'sc0c 2 bench / 2 taxi / 1 IR');
  perform assert_true((r ->> 'rounds')::int = 8, 'sc0d the roster holds eight');
  perform assert_true(league_active_seats(lid) = 5, 'sc1 active seats are starters + bench, not the roster');

  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'sc-' || g, 'full', 'P' || g, 'pos', 'RB', 'team', 'KC', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  -- What a DRAFT leaves behind: rounds − IR = 7 players, every one of them active.
  for i in 1..7 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, b_seat, 'sc-' || i, 'draft');
  end loop;
  update draft set status = 'complete' where league_id = lid;
  -- One of them is genuinely hurt, so the IR place is reachable (0198).
  insert into injury_status (player_slug, status) values ('sc-3', 'IR'), ('sc-6', 'IR')
    on conflict (player_slug) do update set status = excluded.status;

  -- ══ THE SEAT IS THE RULE ═════════════════════════════════════════════════
  perform probe_as('b');
  perform assert_err(add_free_agent(lid, b_seat, 'sc-30', null), 'active roster is full',
    'sc2 seven active in five seats — no room for a free agent, whatever the total says');
  perform assert_true(position('7/5' in roster_seat_error(lid, b_seat, null)) > 0,
    'sc2a the refusal shows the seats, not the roster size');

  -- ══ STASHING FREES A BENCH SEAT (the founder's sentence) ═════════════════
  perform assert_ok(set_roster_spot(lid, 'sc-1', 'taxi'), 'sc3 one to the taxi squad');
  perform assert_ok(set_roster_spot(lid, 'sc-2', 'taxi'), 'sc3a and a second');
  perform assert_err(add_free_agent(lid, b_seat, 'sc-30', null), 'active roster is full',
    'sc3b five active still fills five seats');
  perform assert_ok(set_roster_spot(lid, 'sc-3', 'ir'), 'sc3c and one to IR — now four active');
  perform assert_ok(add_free_agent(lid, b_seat, 'sc-30', null),
    'sc4 THE POINT: a stashed player no longer takes a bench spot, so the signing lands');
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = b_seat) = 8,
    'sc4a the roster is now full at eight');
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = b_seat and spot = 'active') = 5,
    'sc4b five of them active — exactly the seats');

  -- ══ AND THE SAME RULE FROM THE OTHER SIDE ════════════════════════════════
  -- Dropping a TAXI player frees a roster slot but no bench seat, so the next
  -- signing is still refused. Under the old total check this let a sixth
  -- player into five seats.
  perform assert_err(add_free_agent(lid, b_seat, 'sc-31', 'sc-1'), 'active roster is full',
    'sc5 dropping a taxi player frees no bench seat');
  perform assert_ok(add_free_agent(lid, b_seat, 'sc-31', 'sc-4'),
    'sc5a dropping an ACTIVE player does');
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = b_seat and spot = 'active') = 5,
    'sc5b and the active roster never exceeded its seats');

  -- ══ WAIVERS ASK THE SAME QUESTION ════════════════════════════════════════
  update league_pool set waived_until = now() + interval '1 day' where league_id = lid and slug = 'sc-32';
  perform assert_err(submit_waiver_claim(lid, b_seat, 'sc-32', null), 'active roster is full',
    'sc6 a claim with no drop is judged on the seat at submit time');
  perform assert_ok(submit_waiver_claim(lid, b_seat, 'sc-32', 'sc-5'), 'sc6a …and passes with a drop');
  -- Fill the seat back up behind the claim and let the sweep judge it again.
  perform assert_ok(cancel_waiver_claim((
    select id from waiver_claim where league_id = lid and roster_id = b_seat and status = 'pending' limit 1)),
    'sc6b cancel it and re-submit without a drop after freeing a seat');
  perform assert_ok(drop_player(lid, b_seat, 'sc-6'), 'sc6c drop an active player to open a seat');
  perform assert_ok(submit_waiver_claim(lid, b_seat, 'sc-32', null), 'sc6d …and the drop-less claim now stands');
  -- The seat goes away again while the claim sits pending — a signing, a trade,
  -- anything. The SWEEP has to notice, which is the half a submit check can't do.
  perform assert_ok(add_free_agent(lid, b_seat, 'sc-33', null), 'sc6e the seat is taken back before the sweep');
  update league_pool set waived_until = now() - interval '1 minute' where league_id = lid and slug = 'sc-32';
  r := process_waivers(lid);
  perform assert_ok(r, 'sc7 the sweep runs');
  perform assert_true(
    (select status || '/' || coalesce(note, '') from waiver_claim where league_id = lid and add_slug = 'sc-32'
       and roster_id = b_seat and status <> 'cancelled' limit 1) = 'lost/active roster full',
    'sc7a …and drops a claim whose seat went away while it sat pending — got ' ||
    (select status || '/' || coalesce(note, '') from waiver_claim where league_id = lid and add_slug = 'sc-32'
       and roster_id = b_seat and status <> 'cancelled' limit 1));

  -- ══ A LEAGUE WITH NO SHAPE IS UNCHANGED ══════════════════════════════════
  perform probe_as('a');
  r := create_native_league('No Shape', '2024', 2, 6, 60);
  perform assert_ok(r, 'sc8 a drip league, no roster shape'); dlid := (r ->> 'league_id')::uuid;
  perform assert_true(league_active_seats(dlid) = (select rounds from draft where league_id = dlid),
    'sc8a its whole roster IS its active seats');
  select sleeper_roster_id into a_seat from league_membership
    where league_id = dlid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  perform seed_league_pool(dlid, (
    select jsonb_agg(jsonb_build_object('slug', 'ns-' || g, 'full', 'N' || g, 'pos', 'RB', 'team', 'KC'))
    from generate_series(1, 20) g));
  for i in 1..6 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (dlid, a_seat, 'ns-' || i, 'draft');
  end loop;
  update draft set status = 'complete' where league_id = dlid;
  perform assert_err(add_free_agent(dlid, a_seat, 'ns-10', null), 'roster full — drop someone',
    'sc8b and it refuses in exactly the words it always used');

  -- ══ OWNERSHIP COUNTS LEAGUES ═════════════════════════════════════════════
  -- sc-1 is rostered in one of the two drafted leagues; ns-1 in the other.
  perform probe_as('b');
  r := player_ownership(lid);
  select count(*)::int into i from draft where status = 'complete';
  perform assert_true((r ->> 'sc-1')::int = round(100.0 / i)::int,
    'sc9 one drafted league of ' || i || ' rosters him — ' || round(100.0 / i)::int || '%, got ' || coalesce(r ->> 'sc-1', 'null'));
  perform assert_true((r ->> 'ns-1') is not null,
    'sc9a the count is platform-wide: a player in ANOTHER league is in the map too');
  perform assert_true(r ->> 'sc-40' is null, 'sc9b a player nobody rosters simply isn''t in the map');

  raise notice 'seat-cap probes done';
end $$;

select 'ALL SEAT-CAP PROBES PASSED' as result;
