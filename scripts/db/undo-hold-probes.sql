-- 0354 probes: THE COMMISSIONER CAN TAKE IT BACK.
--   UNDO
--   • an add with a drop: the pickup goes back on waivers, the drop comes
--     home, both register rows are marked undone, the undo's own rows are
--     labelled, the league is told, and the same move cannot be undone twice;
--   • a FAAB waiver win: the bid refunded and the waiver order restored — or
--     left alone, and said so, when it has moved since;
--   • a lone drop: the player comes back, unless the seat is full;
--   • refusals: a manager asking, a pickup who has moved on, a drop who has
--     been picked up since, a trade;
--   • the register offers `can_undo` to the commissioner only, and only where
--     the undo would accept it.
--   HOLDS
--   • free now, until the next run, until a chosen time — and nothing else;
--   • a rostered player refused; a manager refused;
--   • pending claims re-dated with the hold; the league told.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function uh_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function uh_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function uh_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function uh_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000017' || u, false);
      perform set_config('app.email', 'uh' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001701', 'uh01@test.dev'), ('00000000-0000-0000-0000-000000001702', 'uh02@test.dev'),
  ('00000000-0000-0000-0000-000000001703', 'uh03@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001701', 'uh01@test.dev'), ('00000000-0000-0000-0000-000000001702', 'uh02@test.dev'),
  ('00000000-0000-0000-0000-000000001703', 'uh03@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001701', '00000000-0000-0000-0000-000000001702',
              '00000000-0000-0000-0000-000000001703');

-- EACH SECTION IS ITS OWN TRANSACTION, as a move and its undo are in
-- production: now() is fixed for a transaction, and a register row's `at` is
-- how a move is recognised. The fixture's ids ride a temp table between them.
create temp table uh_ctx (k_lid uuid, k_a int, k_b int, k_c int, k_pb int);
do $$
declare r jsonb; lid uuid; code text; a int; b int; c int;
begin
  perform uh_as('01');
  r := create_native_league('UndoHold', '2026', 3, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform uh_ok(r, 'uh0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform uh_as('02'); perform uh_ok(native_join(code, 'UH-B'), 'uh0 B joins');
  perform uh_as('03'); perform uh_ok(native_join(code, 'UH-C'), 'uh0 C joins');
  perform uh_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'uh-' || g, 'full', 'Undo Player ' || g, 'pos', 'RB', 'team', 'UHH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001701';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001702';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001703';
  perform uh_ok(native_generate_schedule(lid, 2), 'uh0 schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'uh-1', 'draft'), (lid, b, 'uh-2', 'draft'), (lid, b, 'uh-3', 'draft'), (lid, c, 'uh-4', 'draft');
  perform uh_ok(set_transaction_rules(lid, p_fa_mode => 'open',
    p_waiver_days => '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb, p_waiver_game_hold_dow => -1), 'uh0 free agency open');
  insert into uh_ctx values (lid, a, b, c, null);

end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  -- ── u1. an add with a drop ──
  perform uh_as('02');
  perform uh_ok(add_free_agent(lid, b, 'uh-10', 'uh-2'), 'u1 B adds uh-10 dropping uh-2');
end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  perform uh_as('02');
  select id into tid from league_txn where league_id = lid and kind = 'add' and slug = 'uh-10' order by id desc limit 1;
  perform uh_refused(commish_undo_txn(tid), 'commissioner only', 'u1 a manager cannot undo');
  perform uh_true(not coalesce(((select r2 from jsonb_array_elements(league_register(lid) -> 'rows') r2 where (r2 ->> 'id')::bigint = tid) ->> 'can_undo')::boolean, false),
    'u1 a manager is never offered the undo');
  perform uh_as('01');
  perform uh_true(((select r2 from jsonb_array_elements(league_register(lid) -> 'rows') r2 where (r2 ->> 'id')::bigint = tid) ->> 'can_undo')::boolean,
    'u1 the commissioner is');
  select count(*) into msgs from league_message where league_id = lid and txn ->> 'kind' = 'undo';
  r := commish_undo_txn(tid); perform uh_ok(r, 'u1 the commissioner undoes it');
  perform uh_true(not exists (select 1 from native_roster where league_id = lid and slug = 'uh-10'), 'u1 the pickup left');
  perform uh_true((select waived_until from league_pool where league_id = lid and slug = 'uh-10') > now(), 'u1 and is back on waivers');
  perform uh_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'uh-2'), 'u1 the drop came home');
  perform uh_true((select waived_until from league_pool where league_id = lid and slug = 'uh-2') is null, 'u1 with no hold on him');
  perform uh_true((select count(*) from league_txn where league_id = lid and slug in ('uh-10', 'uh-2') and undone_at is not null) = 2,
    'u1 both original rows marked undone');
  perform uh_true((select count(*) from league_txn where league_id = lid and undo_of = tid) = 2, 'u1 the undo''s own rows are labelled');
  perform uh_true((select count(*) from league_message where league_id = lid and txn ->> 'kind' = 'undo') = msgs + 1, 'u1 the league is told');
  perform uh_true((select body from league_message where league_id = lid and txn ->> 'kind' = 'undo' order by created_at desc limit 1)
    like '↩ The commissioner undid UH-B''s pickup of Undo Player 10 (dropping Undo Player 2)%', 'u1 in words');
  perform uh_refused(commish_undo_txn(tid), 'already undone', 'u1 not twice');
  perform uh_refused(commish_undo_txn((select id from league_txn where undo_of = tid limit 1)), 'itself an undo', 'u1 nor its own lines');

end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  -- ── u2. a FAAB waiver win ──
  perform uh_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'off'), 'u2 FAAB, free agency shut');
  update league_membership set waiver_priority = sleeper_roster_id where league_id = lid;
  select waiver_priority into pb from league_membership where league_id = lid and sleeper_roster_id = b;
  update uh_ctx set k_pb = (select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = b);
end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  perform uh_as('02');
  r := submit_waiver_claim(lid, b, 'uh-11', 'uh-3', 25); perform uh_ok(r, 'u2 B bids 25 on uh-11 dropping uh-3');
  update waiver_claim set clears_at = now() - interval '1 second' where league_id = lid and status = 'pending';
  update league_pool set waived_until = null where league_id = lid and slug = 'uh-11';
  perform uh_as('01');
  r := process_waivers(lid); perform uh_true((r ->> 'won')::int = 1, 'u2 the claim wins');
end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  perform uh_as('01');
  perform uh_true(member_faab(lid, b) = 75, 'u2 the bid was charged');
  perform uh_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = b) <> pb, 'u2 and B went to the back');
  select id into tid from league_txn where league_id = lid and kind = 'waiver' and slug = 'uh-11' order by id desc limit 1;
  -- Undo from the DROP line: it is the same move.
  r := commish_undo_txn((select id from league_txn where league_id = lid and kind = 'drop' and slug = 'uh-3' order by id desc limit 1));
  perform uh_ok(r, 'u2 undone from its drop line');
  perform uh_true(member_faab(lid, b) = 100, 'u2 the bid refunded');
  perform uh_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = b) = pb, 'u2 the place in line restored');
  perform uh_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'uh-3'), 'u2 uh-3 home');
  perform uh_true(r ->> 'note' like '%$25 refunded, waiver order restored%', 'u2 and said');
  -- Again, but the order moves before the undo.
  perform uh_as('02');
  perform uh_ok(submit_waiver_claim(lid, b, 'uh-12', null, 5), 'u2 B bids again');
  update waiver_claim set clears_at = now() - interval '1 second' where league_id = lid and status = 'pending';
  update league_pool set waived_until = null where league_id = lid and slug = 'uh-12';
  perform uh_as('01');
  perform process_waivers(lid);
  update league_membership set waiver_priority = 99 where league_id = lid and sleeper_roster_id = b;
end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  perform uh_as('01');
  r := commish_undo_txn((select id from league_txn where league_id = lid and kind = 'waiver' and slug = 'uh-12' order by id desc limit 1));
  perform uh_ok(r, 'u2 undone after the order moved');
  perform uh_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = b) = 99, 'u2 the order left alone');
  perform uh_true(r ->> 'note' like '%waiver order left as it is%', 'u2 and said so');

end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  -- ── u3. a lone drop ──
  perform uh_as('03');
  perform uh_ok(drop_player(lid, c, 'uh-4'), 'u3 C drops uh-4');
end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  perform uh_as('01');
  tid := (select id from league_txn where league_id = lid and kind = 'drop' and slug = 'uh-4' order by id desc limit 1);
  perform uh_ok(commish_undo_txn(tid), 'u3 undone');
  perform uh_true(exists (select 1 from native_roster where league_id = lid and roster_id = c and slug = 'uh-4'), 'u3 uh-4 back on C');

end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  -- ── u4. refusals ──
  perform uh_as('03'); perform drop_player(lid, c, 'uh-4'); perform uh_as('01');
  tid := (select id from league_txn where league_id = lid and kind = 'drop' and slug = 'uh-4' order by id desc limit 1);
  perform commish_move_player(lid, 'uh-4', a);
  perform uh_refused(commish_undo_txn(tid), 'picked up since', 'u4 a drop who has been picked up since');
  perform uh_ok(set_transaction_rules(lid, p_fa_mode => 'open'), 'u4 free agency open again');
  perform uh_as('02'); perform uh_ok(add_free_agent(lid, b, 'uh-13'), 'u4 B adds uh-13'); perform uh_as('01');
  tid := (select id from league_txn where league_id = lid and kind = 'add' and slug = 'uh-13' order by id desc limit 1);
  perform commish_move_player(lid, 'uh-13', c);
  perform uh_refused(commish_undo_txn(tid), 'no longer on that team', 'u4 a pickup who has moved on');
  perform uh_true(not coalesce(((select r2 from jsonb_array_elements(league_register(lid) -> 'rows') r2 where (r2 ->> 'id')::bigint = tid) ->> 'can_undo')::boolean, false),
    'u4 and the register does not offer it');
  insert into league_txn (league_id, kind, roster_id, slug, from_roster) values (lid, 'trade', a, 'uh-1', b) returning id into tid;
  perform uh_refused(commish_undo_txn(tid), 'trade floor', 'u4 a trade is reversed elsewhere');

end $$;
do $$
declare r jsonb; lid uuid; a int; b int; c int; tid bigint; cid uuid; pb int; t0 timestamptz; msgs int;
begin
  select x.k_lid, x.k_a, x.k_b, x.k_c, x.k_pb into lid, a, b, c, pb from uh_ctx x;
  -- ── h1. holds ──
  perform uh_as('02');
  perform uh_refused(commish_set_waiver_hold(lid, 'uh-20', 'free'), 'commissioner only', 'h1 a manager cannot');
  perform uh_as('01');
  perform uh_refused(commish_set_waiver_hold(lid, 'uh-1', 'next_run'), 'on a roster', 'h1 a rostered player refused');
  perform uh_refused(commish_set_waiver_hold(lid, 'uh-20', 'forever'), 'mode is', 'h1 no fourth mode');
  perform uh_refused(commish_set_waiver_hold(lid, 'uh-20', 'until', now() + interval '20 days'), 'two weeks', 'h1 not past two weeks');
  perform uh_refused(commish_set_waiver_hold(lid, 'uh-20', 'until', now() - interval '1 hour'), 'two weeks', 'h1 not in the past');
  perform uh_ok(set_transaction_rules(lid, p_fa_mode => 'off'), 'h1 free agency shut, so a hold matters');
  perform uh_as('02');
  r := submit_waiver_claim(lid, b, 'uh-20', null, 3); perform uh_ok(r, 'h1 a pending claim on uh-20'); cid := (r ->> 'claim_id')::uuid;
  perform uh_as('01');
  t0 := now() + interval '3 days';
  r := commish_set_waiver_hold(lid, 'uh-20', 'until', t0); perform uh_ok(r, 'h1 held for three days');
  perform uh_true((select waived_until from league_pool where league_id = lid and slug = 'uh-20') = t0, 'h1 the hold is set');
  perform uh_true((select clears_at from waiver_claim where id = cid) >= t0, 'h1 and the claim waits for it');
  perform uh_true((league_waiver_holds(lid) -> 'held') @> jsonb_build_array(jsonb_build_object('slug', 'uh-20', 'claims', 1)), 'h1 the list shows him, with his claim');
  r := commish_set_waiver_hold(lid, 'uh-20', 'free'); perform uh_ok(r, 'h1 freed');
  perform uh_true((select waived_until from league_pool where league_id = lid and slug = 'uh-20') is null, 'h1 no hold');
  perform uh_true((select clears_at from waiver_claim where id = cid) < t0, 'h1 and the claim no longer waits three days');
  perform uh_true(r ->> 'note' like '✅ The commissioner cleared Undo Player 20''s waiver hold%', 'h1 the league is told');
  r := commish_set_waiver_hold(lid, 'uh-21', 'next_run'); perform uh_ok(r, 'h1 a free agent put on waivers');
  perform uh_true((select waived_until from league_pool where league_id = lid and slug = 'uh-21') > now(), 'h1 until the next run');
  perform uh_true(jsonb_array_length(league_waiver_holds(lid, 'Undo Player 3') -> 'found') >= 1, 'h1 the search finds unrostered players');
  perform uh_true(not ((league_waiver_holds(lid, 'Undo Player 1') -> 'found') @> '[{"slug": "uh-1"}]'), 'h1 but never a rostered one');
  perform uh_as('02');
  perform uh_refused(league_waiver_holds(lid), 'forbidden', 'h1 the list is the commissioner''s');
end $$;
select 'ALL UNDO-HOLD PROBES PASS' as result;
drop function if exists uh_true(boolean, text);
drop function if exists uh_ok(jsonb, text);
drop function if exists uh_refused(jsonb, text, text);
drop function if exists uh_as(text);
