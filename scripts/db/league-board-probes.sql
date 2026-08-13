-- 0123 league-board probes. Run with ON_ERROR_STOP; every failed assertion raises.
-- Self-contained: redefines the shared helpers (create or replace — harmless
-- when native-league-probes already ran) and builds its own league.
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
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test.dev')
on conflict (id) do nothing;
select probe_as('a');
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- ── 1. post / authz / provider gates ─────────────────────────────────────────
do $$
declare r jsonb; lid uuid; sl_id uuid;
begin
  perform probe_as('a');
  r := create_native_league('Board Probe League', '2026', 4, 7, 60);
  perform assert_ok(r, 'b1 create');
  lid := (r ->> 'league_id')::uuid;
  perform set_config('probe.board_lid', lid::text, false);

  -- a random member (not even seated yet) may not post someone else's league
  perform probe_as('b');
  perform assert_err(post_league_listing(lid, 'gimme'), 'forbidden', 'b2 non-commish post gated');

  -- non-native league: gate fires even for the admin
  perform probe_as('a');
  insert into league (sleeper_league_id, season, name, provider)
    values ('BOARD-SLPR', '2026', 'Sleeper Probe', 'sleeper') returning id into sl_id;
  perform assert_err(post_league_listing(sl_id, 'nope'), 'only native', 'b3 provider gate');

  -- the real post, with a blurb past the cap — stored trimmed to 280
  r := post_league_listing(lid, repeat('x', 400));
  perform assert_ok(r, 'b4 post');
  perform assert_true((select length(blurb) from league_listing where league_id = lid) = 280, 'b5 blurb capped');

  -- editing: re-post with a new blurb updates in place; null keeps the old one
  perform assert_ok(post_league_listing(lid, 'Two seats open, auction draft Sunday.'), 'b6 re-post');
  perform assert_ok(post_league_listing(lid, null), 'b7 null blurb post');
  perform assert_true((select blurb from league_listing where league_id = lid) like 'Two seats%', 'b8 null kept blurb');
end $$;

-- ── 2. the board read ────────────────────────────────────────────────────────
do $$
declare b jsonb; row jsonb; lid uuid := current_setting('probe.board_lid')::uuid;
begin
  perform probe_as('b');
  b := league_board();
  select x into row from jsonb_array_elements(b) x where (x ->> 'league_id')::uuid = lid;
  perform assert_true(row is not null, 'b9 listed on the board');
  perform assert_true((row ->> 'seats_open')::int = 3, 'b10 three open seats');
  perform assert_true((row ->> 'seats_total')::int = 4, 'b11 four total');
  perform assert_true((row ->> 'mine')::boolean = false, 'b12 not mine (b)');
  perform assert_true(row ->> 'draft_status' = 'pending', 'b13 draft pending');
  perform assert_true(row ? 'invite_code' = false, 'b14 the code NEVER crosses the wire');

  perform probe_as('a');
  b := league_board();
  select x into row from jsonb_array_elements(b) x where (x ->> 'league_id')::uuid = lid;
  perform assert_true((row ->> 'mine')::boolean and (row ->> 'commish')::boolean, 'b15 mine+commish (a)');
end $$;

-- ── 3. league_invite: enrolled members only ──────────────────────────────────
do $$
declare r jsonb; lid uuid := current_setting('probe.board_lid')::uuid;
begin
  perform probe_as('b');
  perform assert_err(league_invite(lid), 'forbidden', 'b16 outsider cannot fetch the code');
  perform probe_as('a');
  r := league_invite(lid);
  perform assert_ok(r, 'b17 commish fetches code');
  perform assert_true(length(r ->> 'invite_code') = 8, 'b18 code shape');
end $$;

-- ── 4. join from the board ───────────────────────────────────────────────────
do $$
declare r jsonb; b jsonb; row jsonb; lid uuid := current_setting('probe.board_lid')::uuid;
begin
  perform probe_as('b');
  r := join_from_board(lid, 'Board Bandits');
  perform assert_ok(r, 'b19 join');
  perform assert_true((select count(*) from league_membership where league_id = lid and enrolled) = 2, 'b20 seated');

  -- idempotent: joining again returns the same seat, claims nothing new
  r := join_from_board(lid);
  perform assert_ok(r, 'b21 re-join idempotent');
  perform assert_true((select count(*) from league_membership where league_id = lid and enrolled) = 2, 'b22 still 2 seats');

  -- an enrolled member can now recruit: the code is theirs to share
  perform assert_ok(league_invite(lid), 'b23 member fetches code');

  b := league_board();
  select x into row from jsonb_array_elements(b) x where (x ->> 'league_id')::uuid = lid;
  perform assert_true((row ->> 'seats_open')::int = 2, 'b24 seat count moved');
  perform assert_true((row ->> 'mine')::boolean, 'b25 now mine (b)');
end $$;

-- ── 5. close / unlist ────────────────────────────────────────────────────────
do $$
declare r jsonb; b jsonb; lid uuid := current_setting('probe.board_lid')::uuid;
begin
  perform probe_as('b');
  perform assert_err(close_league_listing(lid), 'forbidden', 'b26 member cannot unlist');
  perform probe_as('a');
  perform assert_ok(close_league_listing(lid), 'b27 commish unlists');

  perform probe_as('c');
  b := league_board();
  perform assert_true(not exists (select 1 from jsonb_array_elements(b) x where (x ->> 'league_id')::uuid = lid), 'b28 off the board');
  perform assert_err(join_from_board(lid), 'no longer taking', 'b29 closed listing blocks the join');
end $$;

-- ── 6. fill the league; the board hides it, native_join full-league rule holds ─
do $$
declare r jsonb; b jsonb; lid uuid := current_setting('probe.board_lid')::uuid;
begin
  perform probe_as('a');
  perform assert_ok(post_league_listing(lid, null), 'b30 re-post');
  perform probe_as('c');
  perform assert_ok(join_from_board(lid, 'Seat Three'), 'b31 c joins');
  perform probe_as('d');
  perform assert_ok(join_from_board(lid, 'Seat Four'), 'b32 d joins — league now full');

  b := league_board();
  perform assert_true(not exists (select 1 from jsonb_array_elements(b) x where (x ->> 'league_id')::uuid = lid), 'b33 full league hidden');

  -- listing still open; the fifth joiner rides native_join's full-league rule,
  -- which since 0125 WAITLISTS rather than refuses — the join is a success
  -- that just doesn't come with a seat yet
  perform probe_as('e');
  r := join_from_board(lid);
  perform assert_ok(r, 'b34 full-league board join lands somewhere');
  perform assert_true(r ->> 'status' = 'waitlisted', 'b34b …the waiting room');
end $$;

-- ── 7. league_listing_state (0124): the commissioner's own read ──────────────
do $$
declare r jsonb; lid uuid := current_setting('probe.board_lid')::uuid;
begin
  -- a plain member may not read the dial — the listing is the commissioner's
  perform probe_as('b');
  perform assert_err(league_listing_state(lid), 'forbidden', 'b35 member cannot read listing state');

  -- the league is FULL here (section 6 filled it) and hidden from the board —
  -- but the row is still open, and this read must say so. That divergence is
  -- the whole reason 0124 exists.
  perform probe_as('a');
  r := league_listing_state(lid);
  perform assert_ok(r, 'b36 commish reads state');
  perform assert_true((r ->> 'listed')::boolean, 'b37 still LISTED while full/hidden');
  perform assert_true((r ->> 'seats_open')::int = 0, 'b38 zero open seats');

  perform assert_ok(close_league_listing(lid), 'b39 unlist');
  perform assert_true(((league_listing_state(lid)) ->> 'listed')::boolean = false, 'b40 reads unlisted');

  -- a league never posted reads as unlisted, not as an error
  perform assert_true(((league_listing_state(
    (select id from league where sleeper_league_id = 'BOARD-SLPR'))) ->> 'listed')::boolean = false,
    'b41 never-posted league reads unlisted');
end $$;

select 'ALL BOARD PROBES PASSED' as result;
