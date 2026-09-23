-- 0358 probes: THE LEAGUE COUNTS ITS MOVES.
--   • off by default: nothing is counted or refused;
--   • adds per week: the third add refused with when it resets; a new week
--     (the rows backdated past the turnover) lets it through;
--   • adds per season: counted across weeks;
--   • an undone add gives its add back; a commissioner's move never counts;
--   • drops are never blocked;
--   • a waiver run: a team with one add left wins one claim, the next is a
--     loss that says why;
--   • trades per season: the second acceptance is refused;
--   • the setter: commissioner only, sane numbers, the league told.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function tl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function tl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tl_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000021' || u, false);
      perform set_config('app.email', 'tl' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002101', 'tl01@test.dev'), ('00000000-0000-0000-0000-000000002102', 'tl02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000002101', 'tl01@test.dev'), ('00000000-0000-0000-0000-000000002102', 'tl02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000002101', '00000000-0000-0000-0000-000000002102');
create temp table tl_ctx (k_lid uuid, k_a int, k_b int);

do $$
declare r jsonb; lid uuid; code text; a int; b int;
begin
  perform tl_as('01');
  r := create_native_league('Counted', '2026', 2, 20, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform tl_ok(r, 't0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform tl_as('02'); perform tl_ok(native_join(code, 'TL-B'), 't0 B joins');
  perform tl_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'tl-' || g, 'full', 'Count Player ' || g, 'pos', 'RB', 'team', 'TLL', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000002101';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000002102';
  -- The draft's own players go in before it completes, so the register (which
  -- starts at completion) doesn't read them as adds.
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'tl-1', 'draft'), (lid, a, 'tl-2', 'draft'), (lid, b, 'tl-3', 'draft'), (lid, b, 'tl-4', 'draft');
  update draft set status = 'complete' where league_id = lid;
  perform tl_ok(set_transaction_rules(lid, p_fa_mode => 'open',
    p_waiver_days => '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb, p_waiver_game_hold_dow => -1), 't0 free agency open');
  insert into tl_ctx values (lid, a, b);

  -- ── t1. off by default ──
  perform tl_as('02');
  perform tl_true(add_limit_reason(lid, b) is null, 't1 no limit set');
  perform tl_ok(add_free_agent(lid, b, 'tl-10', null), 't1 an add');
  r := league_txn_limits(lid, b);
  perform tl_true(r -> 'max_adds_week' = 'null'::jsonb and (r #>> '{used,week}')::int = 1, 't1 counted, not limited: ' || r::text);

  -- ── t2. the setter ──
  perform tl_refused(commish_set_txn_limits(lid, 2, 4, 1), 'commissioner only', 't2 a manager');
  perform tl_as('01');
  perform tl_refused(commish_set_txn_limits(lid, 5, 3, 1), 'more than the season', 't2 week over season');
  perform tl_refused(commish_set_txn_limits(lid, 99, null, null), 'no limit', 't2 absurd');
  r := commish_set_txn_limits(lid, 2, 4, 1); perform tl_ok(r, 't2 set');
  perform tl_true(r ->> 'note' = '📏 The commissioner set transaction limits: 2 adds a week, 4 adds a season, 1 trade a season', 't2 told: ' || (r ->> 'note'));

  -- ── t3. adds per week ──
  perform tl_as('02');
  perform tl_ok(add_free_agent(lid, b, 'tl-11', null), 't3 second add');
  r := add_free_agent(lid, b, 'tl-12', null);
  perform tl_refused(r, 'all 2 of its adds this week', 't3 third refused');
  perform tl_true(r ->> 'error' like '% ET', 't3 says when it resets: ' || (r ->> 'error'));
  perform tl_ok(drop_player(lid, b, 'tl-3'), 't3 a drop is never blocked');

  -- ── t4. a commissioner move doesn't count ──
  perform tl_as('01');
  perform tl_ok(commish_move_player(lid, 'tl-13', b), 't4 commish move');
  perform tl_true((league_txn_limits(lid, b) #>> '{used,week}')::int = 2, 't4 still 2');

  -- ── t5. a new week ──
  update league_txn set at = league_txn_week_start(lid) - interval '1 hour' where league_id = lid and roster_id = b;
  perform tl_as('02');
  perform tl_true((league_txn_limits(lid, b) #>> '{used,week}')::int = 0, 't5 the week turned');
  perform tl_ok(add_free_agent(lid, b, 'tl-14', null), 't5 an add in the new week (season 3 of 4)');
  perform tl_ok(add_free_agent(lid, b, 'tl-15', null), 't5 season 4 of 4');
  update league_txn set at = league_txn_week_start(lid) - interval '1 hour' where league_id = lid and roster_id = b;
  perform tl_refused(add_free_agent(lid, b, 'tl-16', null), 'for the season', 't5 the season is spent');

  -- ── t6. an undone add gives it back ──
  update league_txn set undone_at = now() where id = (select max(id) from league_txn where league_id = lid and roster_id = b and kind = 'add');
  perform tl_ok(add_free_agent(lid, b, 'tl-16', null), 't6 the undone add was given back');
end $$;

-- ── t7. a waiver run: one add left, two claims ──
do $$
declare r jsonb; lid uuid; a int; b int;
begin
  select k_lid, k_a, k_b into lid, a, b from tl_ctx;
  perform tl_as('01');
  perform tl_ok(commish_set_txn_limits(lid, null, null, 1), 't7 adds unlimited');
  perform tl_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'off'), 't7 FAAB, free agency shut');
  perform tl_as('02');
  perform tl_ok(submit_waiver_claim(lid, b, 'tl-20', null, 10), 't7 claim 1');
  perform tl_ok(submit_waiver_claim(lid, b, 'tl-21', null, 5), 't7 claim 2');
  -- The limit arrives between the claims and the run: one add left this week.
  perform tl_as('01');
  perform tl_ok(commish_set_txn_limits(lid, (select count(*)::int + 1 from league_txn where league_id = lid and roster_id = b
      and kind in ('add', 'waiver') and undone_at is null and undo_of is null and at >= league_txn_week_start(lid)), null, 1), 't7 one left');
  update waiver_claim set clears_at = now() - interval '1 second' where league_id = lid and status = 'pending';
  update league_pool set waived_until = null where league_id = lid and slug in ('tl-20', 'tl-21');
  r := process_waivers(lid);
  perform tl_true((r ->> 'won')::int = 1, 't7 one claim won: ' || r::text);
  perform tl_true((select note from waiver_claim where league_id = lid and add_slug = 'tl-21') like 'this team has used all % of its adds this week%',
    't7 the other lost, with why: ' || coalesce((select note from waiver_claim where league_id = lid and add_slug = 'tl-21'), '∅'));
end $$;

-- ── t8. trades: one a season ──
do $$
declare r jsonb; lid uuid; a int; b int;
begin
  select k_lid, k_a, k_b into lid, a, b from tl_ctx;
  perform tl_as('01');
  perform commish_set_trade_rules(lid, 'none', null, null, null, null);
  r := propose_trade(lid, a, b, '["tl-1"]'::jsonb, '["tl-4"]'::jsonb, null, null, null); perform tl_ok(r, 't8 offer 1');
  perform tl_as('02');
  perform tl_ok(respond_trade((r ->> 'trade_id')::uuid, true), 't8 the first trade goes through');
end $$;
do $$
declare r jsonb; lid uuid; a int; b int;
begin
  select k_lid, k_a, k_b into lid, a, b from tl_ctx;
  perform tl_true((league_txn_limits(lid, a) #>> '{used,trades}')::int = 1, 't8 one trade counted for A');
  perform tl_as('01');
  r := propose_trade(lid, a, b, '["tl-2"]'::jsonb, '["tl-1"]'::jsonb, null, null, null); perform tl_ok(r, 't8 offer 2 is allowed');
  perform tl_as('02');
  perform tl_refused(respond_trade((r ->> 'trade_id')::uuid, true), 'of its trades for the season', 't8 the second acceptance refused');
end $$;
select 'ALL TXN-LIMIT PROBES PASS';
