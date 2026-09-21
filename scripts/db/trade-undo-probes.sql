-- 0328 probes: UNDO THE TRADE.
--   • only a commissioner, and only a COMPLETED trade;
--   • a two-seat reversal puts the players, the picks and the FAAB back;
--   • a three-team reversal runs every leg backwards;
--   • it refuses when a piece has moved on, when the undo would not fit a
--     roster, and when the FAAB has already been spent;
--   • the trade is stamped 'reversed' rather than deleted, and the league
--     hears about it.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function tu_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function tu_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tu_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tu_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000018' || u, false); perform set_config('app.email', 'tu' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001801', 'tu01@test.dev'), ('00000000-0000-0000-0000-000000001802', 'tu02@test.dev'),
  ('00000000-0000-0000-0000-000000001803', 'tu03@test.dev'), ('00000000-0000-0000-0000-000000001804', 'tu04@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001801', 'tu01@test.dev'), ('00000000-0000-0000-0000-000000001802', 'tu02@test.dev'),
  ('00000000-0000-0000-0000-000000001803', 'tu03@test.dev'), ('00000000-0000-0000-0000-000000001804', 'tu04@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001801', '00000000-0000-0000-0000-000000001802',
              '00000000-0000-0000-0000-000000001803', '00000000-0000-0000-0000-000000001804');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c int; tid uuid;
begin
  perform tu_as('01');
  r := create_native_league('TradeUndo', '2026', 4, 6, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform tu_ok(r, 'tu0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform tu_as('02'); perform tu_ok(native_join(code, 'TU-B'), 'tu0 B joins');
  perform tu_as('03'); perform tu_ok(native_join(code, 'TU-C'), 'tu0 C joins');
  perform tu_as('01');
  perform tu_ok(seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'tu-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'TUH', 'exp', 0))
    from generate_series(1, 30) g)), 'tu0 pool');
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001801';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001802';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001803';
  perform tu_ok(native_generate_schedule(lid, 2), 'tu0 schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'tu-1', 'draft'), (lid, a, 'tu-2', 'draft'),
    (lid, b, 'tu-3', 'draft'), (lid, b, 'tu-4', 'draft'),
    (lid, c, 'tu-5', 'draft'), (lid, c, 'tu-6', 'draft');
  perform tu_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'open'), 'tu0 FAAB');

  -- ── tu1. the gates ──
  r := propose_trade(lid, a, b, '["tu-1"]'::jsonb, '["tu-3"]'::jsonb, null, null, null, null, null, 20);
  perform tu_ok(r, 'tu1 an offer with money in it'); tid := (r ->> 'trade_id')::uuid;
  perform tu_refused(commish_reverse_trade(tid), 'only a completed trade', 'tu1 a pending trade cannot be reversed');
  perform tu_as('02');
  perform tu_ok(respond_trade(tid, true), 'tu1 B takes it');
  perform tu_refused(commish_reverse_trade(tid), 'commissioner only', 'tu1 a manager cannot reverse it');

  -- ── tu2. the undo ──
  perform tu_as('01');
  perform tu_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'tu-1')
    and member_faab(lid, a) = 80 and member_faab(lid, b) = 120, 'tu2 the trade landed');
  r := commish_reverse_trade(tid, 'account was compromised');
  perform tu_ok(r, 'tu2 reversed');
  perform tu_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'tu-1')
    and exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'tu-3'),
    'tu2 the players are home');
  perform tu_true(member_faab(lid, a) = 100 and member_faab(lid, b) = 100, 'tu2 and so is the money');
  perform tu_true((select status from trade_proposal where id = tid) = 'reversed',
    'tu2 the trade is stamped, not deleted');
  perform tu_true(exists (select 1 from league_message where league_id = lid and kind = 'txn'
    and (txn ->> 'reversed')::boolean and body ilike '%compromised%'), 'tu2 the league hears about it');
  perform tu_refused(commish_reverse_trade(tid), 'this one is reversed', 'tu2 and it cannot be reversed twice');

  -- ── tu3. when a piece has moved on ──
  r := propose_trade(lid, a, b, '["tu-2"]'::jsonb, '["tu-4"]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform tu_as('02'); perform tu_ok(respond_trade(tid, true), 'tu3 done');
  perform tu_as('01');
  perform tu_ok(commish_remove_player(lid, 'tu-2', false), 'tu3 B drops the man he got');
  perform tu_refused(commish_reverse_trade(tid), 'moved on', 'tu3 there is nothing to take back');
  perform tu_ok(commish_move_player(lid, 'tu-2', b), 'tu3 (put him back)');
  perform tu_ok(commish_reverse_trade(tid), 'tu3 and now it reverses');

  -- ── tu4. when the undo would not fit ──
  -- A's roster is full to its 6 spots, so taking a player back has nowhere
  -- to put him.
  r := propose_trade(lid, a, b, '["tu-1","tu-2"]'::jsonb, '["tu-3"]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform tu_as('02'); perform tu_ok(respond_trade(tid, true), 'tu4 two for one');
  perform tu_as('01');
  perform tu_ok(add_free_agent(lid, a, 'tu-10', null), 'tu4 A fills the room he made');
  perform tu_ok(add_free_agent(lid, a, 'tu-11', null), 'tu4 …and again');
  perform tu_ok(add_free_agent(lid, a, 'tu-12', null), 'tu4 …and again');
  perform tu_ok(add_free_agent(lid, a, 'tu-13', null), 'tu4 …and again');
  perform tu_ok(add_free_agent(lid, a, 'tu-14', null), 'tu4 …until his six spots are full');
  perform tu_refused(commish_reverse_trade(tid), 'would not fit', 'tu4 the undo is refused, not forced');

  -- ── tu5. a three-team reversal ──
  perform tu_ok(commish_remove_player(lid, 'tu-10', false), 'tu5 (room again)');
  perform tu_ok(commish_remove_player(lid, 'tu-11', false), 'tu5 (room again)');
  perform tu_ok(commish_remove_player(lid, 'tu-12', false), 'tu5 (room again)');
  perform tu_ok(commish_remove_player(lid, 'tu-13', false), 'tu5 (room again)');
  perform tu_ok(commish_remove_player(lid, 'tu-14', false), 'tu5 (room again)');
  perform tu_ok(commish_reverse_trade(tid), 'tu5 (and the two-for-one goes back)');
  r := propose_multi_trade(lid, jsonb_build_array(
    jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'tu-1', 'to', b))),
    jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'tu-3', 'to', c)),
                       'send_faab', jsonb_build_array(jsonb_build_object('to', a, 'amount', 15))),
    jsonb_build_object('roster', c, 'send', jsonb_build_array(jsonb_build_object('slug', 'tu-5', 'to', a))))
  );
  perform tu_ok(r, 'tu5 a carousel'); tid := (r ->> 'trade_id')::uuid;
  perform tu_as('02'); perform tu_ok(respond_trade(tid, true), 'tu5 B is in');
  perform tu_as('03'); perform tu_ok(respond_trade(tid, true), 'tu5 C is in');
  perform tu_as('01');
  perform tu_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'tu-1')
    and member_faab(lid, a) = 115, 'tu5 the carousel turned');
  perform tu_ok(commish_reverse_trade(tid), 'tu5 reversed');
  perform tu_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'tu-1')
    and exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'tu-3')
    and exists (select 1 from native_roster where league_id = lid and roster_id = c and slug = 'tu-5')
    and member_faab(lid, a) = 100 and member_faab(lid, b) = 100,
    'tu5 every leg ran backwards');

  -- ── tu6. when the money is gone ──
  r := propose_trade(lid, a, b, '["tu-1"]'::jsonb, '["tu-3"]'::jsonb, null, null, null, null, null, 90);
  tid := (r ->> 'trade_id')::uuid;
  perform tu_as('02'); perform tu_ok(respond_trade(tid, true), 'tu6 B takes $90');
  update league_membership set faab_budget = 5 where league_id = lid and sleeper_roster_id = b;
  perform tu_as('01');
  perform tu_refused(commish_reverse_trade(tid), 'already spent', 'tu6 dollars that are gone cannot come back');
end $$;

select 'ALL TRADE-UNDO PROBES PASS' as result;
drop function if exists tu_true(boolean, text);
drop function if exists tu_ok(jsonb, text);
drop function if exists tu_refused(jsonb, text, text);
drop function if exists tu_as(text);
