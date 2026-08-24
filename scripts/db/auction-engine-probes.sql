-- AUCTION-ENGINE probes (v0.345.3) — the three corners the 2026 readiness
-- audit found untested. native-league-probes §13–§17 validate the HUMAN
-- auction thoroughly (lifecycle, bid gates, pause, slow bells, hidden proxies,
-- parallel-lot capacity); what had zero direct coverage was:
--
--   1. the AI VALUE MODEL and counter-bidding (ai_player_value /
--      ai_lot_willingness / resolve_lot_proxies with an AI seat) — the exact
--      path that runs when a league drafts against unclaimed seats, live in
--      production untested;
--   2. the PARALLEL-LOT MONEY FORMULA (auction_lot_max: budget − committed −
--      $1 per remaining spot), only ever exercised indirectly;
--   3. the NIGHT-AWARE CLOCK (awake_deadline), probed for snake but never as
--      the pure function every auction bell is computed through.
--
-- Determinism is what makes exact assertions possible here: the AI jitter is
-- a hash of (league, seat, slug), so a probe can CALL the willingness function
-- and assert the resolver settled at exactly willingness + 1. January dates
-- keep the night-clock probes in EST, out of DST's reach.
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
  on conflict do nothing;
select probe_as('a');
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

-- ── 1. the AI value model has the SHAPE the design claims ────────────────────
-- budget × 0.34 × e^(−rank/45), floor $1: top pick ≈ ⅓ of budget, monotone
-- down the board, late-round players a dollar. Asserted as properties, not by
-- re-deriving the formula — a probe that repeats the arithmetic would pass no
-- matter what the arithmetic was.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int;
begin
  perform probe_as('a');
  r := create_native_league('Value Model', '2026', 2, 5, 60, 'auction', 200);
  perform assert_ok(r, 'ae1a create');
  lid := (r ->> 'league_id')::uuid;
  for i in 1..220 loop
    pool := pool || jsonb_build_object('slug', 'v-p' || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ae1b seed 220 ranks');
  perform assert_true(ai_player_value(lid, 'v-p1', 200) between 60 and 68,
    'ae1c the top-ranked player is worth about a third of the budget');
  perform assert_true(ai_player_value(lid, 'v-p1', 200) > ai_player_value(lid, 'v-p10', 200)
    and ai_player_value(lid, 'v-p10', 200) > ai_player_value(lid, 'v-p40', 200),
    'ae1d value is monotone down the board');
  perform assert_true(ai_player_value(lid, 'v-p200', 200) = 1,
    'ae1e a deep-league afterthought is worth exactly the $1 floor');
end $$;

-- ── 2. willingness: jitter inside its band, caps and endgame zero it ─────────
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; v int; w int; w2 int;
begin
  perform probe_as('a');
  r := create_native_league('Willing Or Not', '2026', 2, 5, 60, 'auction', 200);
  perform assert_ok(r, 'ae2a create');
  lid := (r ->> 'league_id')::uuid;
  for i in 1..8 loop pool := pool || jsonb_build_object('slug', 'w-qb' || i, 'full', 'QB ' || i, 'pos', 'QB', 'team', 'T'); end loop;
  for i in 1..8 loop pool := pool || jsonb_build_object('slug', 'w-rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  pool := pool || jsonb_build_object('slug', 'w-k1', 'full', 'K 1', 'pos', 'K', 'team', 'T');
  pool := pool || jsonb_build_object('slug', 'w-d1', 'full', 'D 1', 'pos', 'DEF', 'team', 'T');
  perform assert_ok(seed_league_pool(lid, pool), 'ae2b seed');

  v := ai_player_value(lid, 'w-rb1', 200);
  w := ai_lot_willingness(lid, 2, 'w-rb1', 5, 200);
  w2 := ai_lot_willingness(lid, 2, 'w-rb1', 5, 200);
  perform assert_true(w = w2, 'ae2c willingness is deterministic — the same seat asks twice, hears one number');
  perform assert_true(w >= greatest(1, (v * 0.85)::int - 1) and w <= (v * 1.15)::int + 1,
    'ae2d jitter stays inside its ±15% band');
  perform assert_true(ai_lot_willingness(lid, 2, 'not-in-pool', 5, 200) = 0,
    'ae2e a player outside the pool is worth nothing');

  -- Positional cap: a seat already holding 3 QBs has no use for a fourth.
  insert into native_roster (league_id, roster_id, slug) values
    (lid, 2, 'w-qb1'), (lid, 2, 'w-qb2'), (lid, 2, 'w-qb3');
  perform assert_true(ai_lot_willingness(lid, 2, 'w-qb4', 5, 200) = 0,
    'ae2f the QB cap zeroes a fourth QB');
  -- Endgame: 3 of 5 spots filled, no K and no DEF yet → the last two spots are
  -- SPOKEN FOR. An RB is worth 0; the missing K is still worth bidding on.
  perform assert_true(ai_lot_willingness(lid, 2, 'w-rb1', 5, 200) = 0,
    'ae2g forced-K/DEF endgame zeroes a luxury RB');
  perform assert_true(ai_lot_willingness(lid, 2, 'w-k1', 5, 200) >= 1,
    'ae2h ...but the missing K is exactly what the last spots are for');
end $$;

-- ── 3. the parallel-lot money formula, asserted directly ─────────────────────
-- max bid = budget − (committed on OTHER lots) − $1 × (capacity − 1), where
-- capacity = open spots − other lots held. The formula that keeps four
-- simultaneous lots from bankrupting a seat, previously covered only by §17's
-- capacity gate.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; lot1 uuid; code text;
begin
  perform probe_as('a');
  r := create_native_league('Money Rules', '2026', 2, 5, 60, 'auction', 20, 15, 2);
  perform assert_ok(r, 'ae3a create budget-20 rounds-5 max_lots-2');
  lid := (r ->> 'league_id')::uuid;
  -- Seat 2 must be HUMAN here: an unclaimed seat is an AI bidder (§4 proves
  -- exactly that), and an AI raising the fixture's lot mid-probe would change
  -- every number this section is asserting about seat 1's wallet.
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Holds Still'), 'ae3b2 B joins seat 2');
  perform probe_as('a');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'm-rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ae3b seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), 'ae3c start');

  -- Fresh seat: 5 spots, no lots → 20 − 0 − 4 = 16.
  perform assert_true(auction_lot_max(lid, 1, 5, null) = 16, 'ae3d fresh max reserves $1 for the other four spots');

  -- Hold one lot at $6: a NEW lot may take 20 − 6 − (4 − 1) = 11 …
  perform assert_ok(nominate(lid, 'm-rb1', 6), 'ae3e A opens a lot at $6');
  select id into lot1 from auction_lot where league_id = lid and slug = 'm-rb1';
  perform assert_true(auction_lot_max(lid, 1, 5, null) = 11,
    'ae3f committed money and the held lot both come off a NEW lot''s max');
  -- …while RAISING the held lot releases its own committed $6: 20 − 0 − 4 = 16.
  perform assert_true(auction_lot_max(lid, 1, 5, lot1) = 16,
    'ae3g raising your own lot does not double-count its committed money');

  -- Zero capacity: fill the roster to one open spot, hold one lot → 0.
  insert into native_roster (league_id, roster_id, slug) values
    (lid, 1, 'm-rb8'), (lid, 1, 'm-rb9'), (lid, 1, 'm-rb10'), (lid, 1, 'm-rb11');
  perform assert_true(auction_lot_max(lid, 1, 5, null) = 0,
    'ae3h one open spot + one held lot = no room to win another');
end $$;

-- ── 4. the AI actually bids: second-price resolution against a human ─────────
-- The production path with zero prior coverage. Seat 2 is UNCLAIMED (no
-- app_user_id → not a live human → the resolver bids its willingness for it).
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; lot uuid; w int;
begin
  perform probe_as('a');
  r := create_native_league('Ghost Bidder', '2026', 2, 5, 60, 'auction', 200);
  perform assert_ok(r, 'ae4a create — seat 2 stays unclaimed, so it is the AI');
  lid := (r ->> 'league_id')::uuid;
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'g-rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ae4b seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), 'ae4c start');

  -- A nominates the top player at $1. The AI values him at ~⅓ budget, so the
  -- resolver must take the lot for the AI — at the SECOND price (A's $1) + 1,
  -- not at the AI's own maximum. That gap is the whole point of proxy bidding.
  perform assert_ok(nominate(lid, 'g-rb1', 1), 'ae4d A opens at $1');
  select id into lot from auction_lot where league_id = lid and slug = 'g-rb1';
  perform resolve_lot_proxies(lid, lot);
  perform assert_true((select roster_id from auction_lot where id = lot) = 2,
    'ae4e THE POINT: the AI seat counter-bids a bargain — an unclaimed seat is not a pushover');
  perform assert_true((select bid from auction_lot where id = lot) = 2,
    'ae4f and it pays second price + 1 ($2), not its own valuation');

  -- A answers with a hidden max ABOVE the AI's willingness. The resolver hands
  -- the lot back at exactly willingness + 1 — assertable because the jitter is
  -- deterministic, so the probe can ask the same function the resolver asks.
  w := ai_lot_willingness(lid, 2, 'g-rb1', 5, 200);
  perform assert_ok(set_lot_proxy(lid, 1, w + 40, lot), 'ae4g A sets a hidden max above the AI');
  perform resolve_lot_proxies(lid, lot);
  perform assert_true((select roster_id from auction_lot where id = lot) = 1,
    'ae4h the higher hidden max wins the lot back');
  perform assert_true((select bid from auction_lot where id = lot) = w + 1,
    'ae4i at exactly the AI''s willingness + 1 — second price, to the dollar');
  perform assert_true((select bid from auction_lot where id = lot) < w + 40,
    'ae4j the winner''s own maximum is never what he pays');
end $$;

-- ── 5. the night-aware clock, pinned as the pure function it is ──────────────
-- Every auction bell and nomination window is computed by awake_deadline.
-- January dates → EST, immune to DST. Night = 22:00–10:00 ET (1320 / 600).
do $$
begin
  perform assert_true(
    awake_deadline('2026-01-15 12:00:00-05', 3600, null, null) = '2026-01-15 13:00:00-05'::timestamptz,
    'ae5a no night window configured → plain arithmetic');
  perform assert_true(
    awake_deadline('2026-01-15 12:00:00-05', 3600, 1320, 600) = '2026-01-15 13:00:00-05'::timestamptz,
    'ae5b a clock that fits inside the day is untouched');
  perform assert_true(
    awake_deadline('2026-01-15 21:30:00-05', 3600, 1320, 600) = '2026-01-16 10:30:00-05'::timestamptz,
    'ae5c a clock spanning the night pauses at 22:00 and finishes its remaining 30min after 10:00');
  perform assert_true(
    awake_deadline('2026-01-16 03:00:00-05', 600, 1320, 600) = '2026-01-16 10:10:00-05'::timestamptz,
    'ae5d a bell set AT night counts nothing until morning');
  perform assert_true(
    awake_deadline('2026-01-15 23:00:00-05', 7200, 1320, 600) = '2026-01-16 12:00:00-05'::timestamptz,
    'ae5e set after midnight''s side of the window, the full clock runs from 10:00');
  perform assert_true(
    awake_deadline('2026-01-15 12:00:00-05', 3600, 1320, 600) < '2026-01-15 22:00:00-05'::timestamptz,
    'ae5f no auction deadline can ever land inside the quiet hours');
end $$;

-- ── 6. pacing: the AI's appetite shrinks with its wallet (0225) ──────────────
-- The founder's Contract Test auction ended with every seat at $0–6 and
-- benches full of $1 players: the resolver handed ai_lot_willingness the
-- league's STARTING budget, so a seat that had spent 80% still bid like it
-- was flush. 0225 passes league_membership.draft_budget instead. Proved the
-- same way §4 proves second price: the jitter is deterministic, so the probe
-- asks the willingness function at BOTH wallet sizes and asserts the resolver
-- settled at exactly the half-wallet number + 1 — not the full-wallet one.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; lot uuid; wfull int; whalf int;
begin
  perform probe_as('a');
  r := create_native_league('Pace Yourself', '2026', 2, 5, 60, 'auction', 200);
  perform assert_ok(r, 'ae6a create — seat 2 unclaimed, so it is the AI');
  lid := (r ->> 'league_id')::uuid;
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'p-rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'ae6b seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), 'ae6c start');

  -- Halve the AI's wallet, as winning a star would have.
  update league_membership set draft_budget = 100 where league_id = lid and sleeper_roster_id = 2;
  wfull := ai_lot_willingness(lid, 2, 'p-rb1', 5, 200);
  whalf := ai_lot_willingness(lid, 2, 'p-rb1', 5, 100);
  perform assert_true(whalf < wfull, 'ae6d half the wallet, smaller appetite');

  -- A opens at $1; the AI still counter-bids a bargain…
  perform assert_ok(nominate(lid, 'p-rb1', 1), 'ae6e A opens at $1');
  select id into lot from auction_lot where league_id = lid and slug = 'p-rb1';
  perform resolve_lot_proxies(lid, lot);
  perform assert_true((select roster_id from auction_lot where id = lot) = 2,
    'ae6f a half-spent AI still fights for a bargain');

  -- …but its ceiling is its WALLET's willingness. A's hidden max sits between
  -- the two, and the lot must come back at whalf + 1 — the full-budget number
  -- would have kept the lot with the AI entirely.
  perform assert_true(whalf + 5 < wfull, 'ae6g the two ceilings are distinguishable');
  perform assert_ok(set_lot_proxy(lid, 1, whalf + 5, lot), 'ae6h A bids between the ceilings');
  perform resolve_lot_proxies(lid, lot);
  perform assert_true((select roster_id from auction_lot where id = lot) = 1,
    'ae6i THE POINT: the AI folds where its full-budget self would have kept bidding');
  perform assert_true((select bid from auction_lot where id = lot) = whalf + 1,
    'ae6j and the price is the SHRUNK willingness + 1, to the dollar');
end $$;

-- ── 7. the queue bids for you (0228) ─────────────────────────────────────────
-- A standing max on a queued player becomes his lot's hidden proxy the moment
-- the lot opens — whoever nominates him — and the existing second-price
-- machinery does the rest. Explicit proxies outrank it; reordering the queue
-- keeps it; the tick's auto-nomination installs it too.
do $$
declare lid uuid; r jsonb; pool jsonb := '[]'::jsonb; i int; code text; lot uuid; lot2 uuid;
begin
  perform probe_as('a');
  r := create_native_league('Sleeping Bidder', '2026', 2, 5, 60, 'auction', 200, 60, 3);
  perform assert_ok(r, 'ae7a create — 3 parallel lots, human seat 2');
  lid := (r ->> 'league_id')::uuid;
  select invite_code into code from league where id = lid;
  perform probe_as('b');
  perform assert_ok(native_join(code, 'B Sleeps'), 'ae7b B claims seat 2 (a live human, not the AI)');
  for i in 1..12 loop pool := pool || jsonb_build_object('slug', 'q-rb' || i, 'full', 'RB ' || i, 'pos', 'RB', 'team', 'T'); end loop;
  perform probe_as('a');
  perform assert_ok(seed_league_pool(lid, pool), 'ae7c seed');
  perform assert_ok(start_draft(lid, '[1,2]'::jsonb), 'ae7d start');

  -- B queues rb1 with a $30 ceiling and rb3 with $20, then "goes to sleep".
  perform probe_as('b');
  perform assert_ok(set_draft_queue(lid, 2, '["q-rb1","q-rb3"]'::jsonb), 'ae7e B queues two players');
  perform assert_ok(set_queue_max(lid, 2, 'q-rb1', 30), 'ae7f standing max $30 on rb1');
  perform assert_ok(set_queue_max(lid, 2, 'q-rb3', 20), 'ae7g standing max $20 on rb3');
  perform assert_err(set_queue_max(lid, 2, 'q-rb9', 10), 'queue him first', 'ae7h a max needs a queue entry to ride');

  -- A nominates B's queued player: the standing max answers immediately.
  perform probe_as('a');
  perform assert_ok(nominate(lid, 'q-rb1', 1), 'ae7i A opens B''s guy at $1');
  select id into lot from auction_lot where league_id = lid and slug = 'q-rb1';
  perform assert_true((select (roster_id, bid) = (2, 2) from auction_lot where id = lot),
    'ae7j THE POINT: the sleeping B counter-bids at second price — the queue is bidding for him');
  -- A answers above B's ceiling: the lot comes back at exactly $31.
  perform assert_ok(set_lot_proxy(lid, 1, 50, lot), 'ae7k A hides a $50 max');
  perform resolve_lot_proxies(lid, lot);
  perform assert_true((select (roster_id, bid) = (1, 31) from auction_lot where id = lot),
    'ae7l the standing max is a CEILING: B folds at $30, A pays 30 + 1');

  -- B's nomination turn (commish opens it for him): an EXPLICIT proxy on the
  -- open lot outranks a queue max set afterwards.
  perform assert_ok(nominate(lid, 'q-rb2', 1), 'ae7m commish nominates for B''s turn');
  select id into lot2 from auction_lot where league_id = lid and slug = 'q-rb2';
  perform probe_as('b');
  perform assert_ok(set_lot_proxy(lid, 2, 40, lot2), 'ae7n B sets an explicit $40 on the open lot');
  perform assert_ok(set_draft_queue(lid, 2, '["q-rb3","q-rb2"]'::jsonb), 'ae7o B reorders his queue');
  perform assert_true((select max_bid from draft_queue where league_id = lid and roster_id = 2 and slug = 'q-rb3') = 20,
    'ae7p reordering the queue keeps the standing max');
  perform assert_ok(set_queue_max(lid, 2, 'q-rb2', 10), 'ae7q then queues rb2 with a $10 max');
  perform assert_true((select max_amount from lot_proxy where lot_id = lot2 and roster_id = 2) = 40,
    'ae7r the explicit proxy stands — a queue max never overwrites one');

  -- A's turn again; his clock expires; the tick nominates from HIS queue —
  -- and B's standing max on that player answers, asleep or not.
  perform probe_as('a');
  perform assert_ok(set_draft_queue(lid, 1, '["q-rb3"]'::jsonb), 'ae7s A queues rb3 for himself');
  update draft set deadline_at = now() - interval '1 second' where league_id = lid;
  perform draft_tick(lid);
  perform assert_true((select (roster_id, bid) = (2, 2) from auction_lot where league_id = lid and slug = 'q-rb3'),
    'ae7t the tick''s auto-nomination arms the standing max too — B holds his own target at $2');
end $$;

select 'ALL AUCTION-ENGINE PROBES PASSED' as result;
