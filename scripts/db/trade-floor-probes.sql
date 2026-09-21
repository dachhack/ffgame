-- 0321 probes: THE TRADE FLOOR.
--   • the trade rules: the third review mode, the window, the veto bar, the
--     offer's default life and the FAAB switch — set, validated, reported;
--   • expiry: an offer with its own clock, the league default, "stands until
--     answered", the refusal at acceptance and the sweep that marks it;
--   • counters: the receiver answers with an offer, the original is closed
--     and the new one points back at it;
--   • the league vote: the window opens on acceptance, a team in the trade
--     does not vote, the bar kills it, unanimous approval settles it early,
--     a silent window executes it at the sweep, and the commissioner still
--     outranks the floor;
--   • FAAB as an asset: refused outside a FAAB league, refused with the
--     switch off, refused over budget, and the dollars move on execution.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function tf_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function tf_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tf_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function tf_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000012' || u, false); perform set_config('app.email', 'tf' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001201', 'tf01@test.dev'), ('00000000-0000-0000-0000-000000001202', 'tf02@test.dev'),
  ('00000000-0000-0000-0000-000000001203', 'tf03@test.dev'), ('00000000-0000-0000-0000-000000001204', 'tf04@test.dev'),
  ('00000000-0000-0000-0000-000000001205', 'tf05@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001201', 'tf01@test.dev'), ('00000000-0000-0000-0000-000000001202', 'tf02@test.dev'),
  ('00000000-0000-0000-0000-000000001203', 'tf03@test.dev'), ('00000000-0000-0000-0000-000000001204', 'tf04@test.dev'),
  ('00000000-0000-0000-0000-000000001205', 'tf05@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001201', '00000000-0000-0000-0000-000000001202',
              '00000000-0000-0000-0000-000000001203', '00000000-0000-0000-0000-000000001204',
              '00000000-0000-0000-0000-000000001205');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c int; d int; e int; tid uuid; tid2 uuid; row_ jsonb;
begin
  perform tf_as('01');
  r := create_native_league('TradeFloor', '2026', 5, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform tf_ok(r, 'tf0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform tf_as('02'); perform tf_ok(native_join(code, 'TF-B'), 'tf0 B joins');
  perform tf_as('03'); perform tf_ok(native_join(code, 'TF-C'), 'tf0 C joins');
  perform tf_as('04'); perform tf_ok(native_join(code, 'TF-D'), 'tf0 D joins');
  perform tf_as('05'); perform tf_ok(native_join(code, 'TF-E'), 'tf0 E joins');
  perform tf_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'tf-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'TFH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001201';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001202';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001203';
  select sleeper_roster_id into d from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001204';
  select sleeper_roster_id into e from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001205';
  perform tf_ok(native_generate_schedule(lid, 2), 'tf0 the schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'tf-1', 'draft'), (lid, a, 'tf-2', 'draft'), (lid, a, 'tf-3', 'draft'),
    (lid, b, 'tf-4', 'draft'), (lid, b, 'tf-5', 'draft'), (lid, b, 'tf-6', 'draft');
  perform tf_ok(set_transaction_rules(lid, p_waiver_mode => 'rolling', p_fa_mode => 'open'), 'tf0 rolling, FA open');

  -- ── tf1. the trade rules ──
  perform tf_as('02');
  perform tf_refused(commish_set_trade_rules(lid, 'league'), 'commissioner only', 'tf1 a manager cannot set them');
  perform tf_as('01');
  perform tf_refused(commish_set_trade_rules(lid, 'vibes'), 'none, commish or league', 'tf1 an unknown mode');
  perform tf_refused(commish_set_trade_rules(lid, null, 0), '1–168 hours', 'tf1 a zero-hour window');
  perform tf_refused(commish_set_trade_rules(lid, null, null, 9), '1–3', 'tf1 more vetoes than voters');
  perform tf_refused(commish_set_trade_rules(lid, null, null, null, 30), '0–14 days', 'tf1 a month-long offer');
  perform tf_ok(commish_set_trade_rules(lid, 'league', 48, 2, 3, true), 'tf1 the floor is set');
  perform tf_true((roster_rules(lid) ->> 'trade_review') = 'league'
    and (roster_rules(lid) ->> 'trade_review_hours')::int = 48
    and (roster_rules(lid) ->> 'trade_veto_votes')::int = 2
    and (roster_rules(lid) ->> 'trade_offer_days')::int = 3, 'tf1 the console reads them back');
  -- Unset, the bar is a majority of the seats outside the trade: 5 − 2 = 3 → 2.
  perform tf_ok(commish_set_trade_rules(lid, null, null, -1), 'tf1 the bar is cleared');
  perform tf_true(league_trade_veto_votes(lid) = 2 and (roster_rules(lid) -> 'trade_veto_votes_set') = 'null'::jsonb,
    'tf1 and falls back to a majority of the three outsiders');
  perform tf_ok(commish_set_trade_rules(lid, 'none', null, null, 0), 'tf1 back to no review, no default expiry');

  -- ── tf2. an offer with a clock ──
  perform tf_as('01');
  perform tf_refused(propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb, null, null, null, null, null, 0, 0),
    '1–720 hours', 'tf2 a zero-hour offer');
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb, null, null, null, null, null, 0, 6);
  perform tf_ok(r, 'tf2 a six-hour offer'); tid := (r ->> 'trade_id')::uuid;
  perform tf_true((select expires_at from trade_proposal where id = tid) between now() + interval '5 hours' and now() + interval '7 hours',
    'tf2 the clock is six hours out');
  update trade_proposal set expires_at = now() - interval '1 second' where id = tid;
  perform tf_as('02');
  perform tf_refused(respond_trade(tid, true), 'expired', 'tf2 an expired offer cannot be taken');
  perform tf_true((select status from trade_proposal where id = tid) = 'expired', 'tf2 and it is marked so');
  -- The league default, and the offer that opts out of it.
  perform tf_as('01');
  perform tf_ok(commish_set_trade_rules(lid, null, null, null, 2), 'tf2 offers stand two days');
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb);
  perform tf_ok(r, 'tf2 an offer with no clock of its own'); tid := (r ->> 'trade_id')::uuid;
  perform tf_true((select expires_at from trade_proposal where id = tid) > now() + interval '1 day', 'tf2 takes the league default');
  perform tf_ok(cancel_trade(tid), 'tf2 (withdrawn)');
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb, null, null, null, null, null, 0, -1);
  perform tf_ok(r, 'tf2 an offer that stands'); tid := (r ->> 'trade_id')::uuid;
  perform tf_true((select expires_at from trade_proposal where id = tid) is null, 'tf2 no clock on it');
  -- The sweep is the safety net for an offer nobody answered.
  update trade_proposal set expires_at = now() - interval '1 minute' where id = tid;
  r := trade_sweep();
  perform tf_true((r ->> 'expired')::int >= 1 and (select status from trade_proposal where id = tid) = 'expired',
    'tf2 the sweep closes it');
  perform tf_ok(commish_set_trade_rules(lid, null, null, null, 0), 'tf2 default expiry off again');

  -- ── tf3. a counter ──
  perform tf_as('01');
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb, 'one for one');
  perform tf_ok(r, 'tf3 the offer'); tid := (r ->> 'trade_id')::uuid;
  perform tf_refused(counter_trade(tid, '["tf-4"]'::jsonb, '["tf-1","tf-2"]'::jsonb), 'not your trade', 'tf3 the proposer cannot counter himself');
  perform tf_as('02');
  perform tf_refused(counter_trade(tid, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb), 'your own players', 'tf3 a counter is still validated');
  r := counter_trade(tid, '["tf-4"]'::jsonb, '["tf-1","tf-2"]'::jsonb, 'two for one or nothing');
  perform tf_ok(r, 'tf3 B counters'); tid2 := (r ->> 'trade_id')::uuid;
  perform tf_true((select status from trade_proposal where id = tid) = 'countered', 'tf3 the original is closed');
  perform tf_true((select counters from trade_proposal where id = tid2) = tid
    and (select from_roster from trade_proposal where id = tid2) = b, 'tf3 the counter points back and comes from B');
  perform tf_refused(counter_trade(tid, '["tf-4"]'::jsonb, '["tf-1"]'::jsonb), 'already countered', 'tf3 a closed offer takes no second counter');
  perform tf_as('01');
  r := respond_trade(tid2, true);
  perform tf_true((r ->> 'status') = 'executed', 'tf3 A takes the counter');
  perform tf_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'tf-2' and acquired = 'trade'),
    'tf3 and the pieces moved');
  -- put them back
  perform tf_ok(commish_move_player(lid, 'tf-1', a), 'tf3 (reset 1)');
  perform tf_ok(commish_move_player(lid, 'tf-2', a), 'tf3 (reset 2)');
  perform tf_ok(commish_move_player(lid, 'tf-4', b), 'tf3 (reset 3)');

  -- ── tf4. the league vote ──
  perform tf_ok(commish_set_trade_rules(lid, 'league', 24), 'tf4 the floor decides');
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb);
  perform tf_ok(r, 'tf4 the offer'); tid := (r ->> 'trade_id')::uuid;
  perform tf_as('02');
  r := respond_trade(tid, true);
  perform tf_true((r ->> 'status') = 'review' and (r ->> 'awaiting') = 'the league vote', 'tf4 acceptance opens the vote');
  perform tf_true((select review_until from trade_proposal where id = tid) > now() + interval '23 hours', 'tf4 the window is a day');
  perform tf_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'tf-1'), 'tf4 nothing has moved yet');
  perform tf_refused(cast_trade_vote(tid, true), 'does not vote on it', 'tf4 a team in the trade cannot vote');
  perform tf_as('03');
  perform tf_ok(cast_trade_vote(tid, true), 'tf4 C votes it down');
  perform tf_true((select status from trade_proposal where id = tid) = 'review', 'tf4 one veto is not enough');
  perform tf_as('04');
  perform tf_ok(cast_trade_vote(tid, true), 'tf4 D votes it down too');
  perform tf_true((select status from trade_proposal where id = tid) = 'vetoed', 'tf4 the bar is reached and it dies');
  perform tf_true(exists (select 1 from league_message where league_id = lid and kind = 'txn'
    and txn ->> 'kind' = 'vote' and (txn ->> 'vetoed')::boolean), 'tf4 the league is told');
  perform tf_as('05');
  perform tf_refused(cast_trade_vote(tid, false), 'not out for a vote', 'tf4 a settled trade takes no more votes');
  -- Everyone allowing settles it before the window closes.
  perform tf_as('01');
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform tf_as('02'); perform tf_ok(respond_trade(tid, true), 'tf4 accepted, out to the floor');
  perform tf_as('03'); perform tf_ok(cast_trade_vote(tid, false), 'tf4 C allows it');
  perform tf_true((select status from trade_proposal where id = tid) = 'review',
    'tf4 still open — D and E could still make two vetoes');
  -- D's allow leaves one unvoted seat and a bar of two: the veto is now
  -- arithmetically out of reach, so the trade does not sit out its window.
  perform tf_as('04'); perform tf_ok(cast_trade_vote(tid, false), 'tf4 D allows it');
  perform tf_true((select status from trade_proposal where id = tid) = 'executed', 'tf4 the bar is unreachable — it goes through');
  perform tf_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'tf-1'), 'tf4 the players moved');
  perform tf_as('01');
  perform tf_ok(commish_move_player(lid, 'tf-1', a), 'tf4 (reset 1)');
  perform tf_ok(commish_move_player(lid, 'tf-4', b), 'tf4 (reset 2)');
  -- A window that closes with nobody voting executes at the sweep.
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform tf_as('02'); perform tf_ok(respond_trade(tid, true), 'tf4 accepted again');
  update trade_proposal set review_until = now() - interval '1 minute' where id = tid;
  r := trade_sweep();
  perform tf_true((r ->> 'executed')::int >= 1 and (select status from trade_proposal where id = tid) = 'executed',
    'tf4 silence at the deadline passes it');
  perform tf_as('01');
  perform tf_ok(commish_move_player(lid, 'tf-1', a), 'tf4 (reset 3)');
  perform tf_ok(commish_move_player(lid, 'tf-4', b), 'tf4 (reset 4)');
  -- The commissioner still outranks the floor, in both directions.
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform tf_as('02'); perform tf_ok(respond_trade(tid, true), 'tf4 out to the floor once more');
  perform tf_as('03'); perform tf_ok(cast_trade_vote(tid, true), 'tf4 C objects');
  perform tf_as('01');
  r := commish_rule_trade(tid, true);
  perform tf_true((r ->> 'status') = 'executed', 'tf4 the commissioner passes it over a vote in progress');
  -- …and the votes ride the row the screens read.
  row_ := (select x from jsonb_array_elements(league_trades(lid)) x where (x ->> 'id')::uuid = tid);
  perform tf_true(jsonb_array_length(row_ -> 'votes') = 1 and (row_ ->> 'veto_need')::int = 2, 'tf4 league_trades carries the vote');
  perform tf_ok(commish_move_player(lid, 'tf-1', a), 'tf4 (reset 5)');
  perform tf_ok(commish_move_player(lid, 'tf-4', b), 'tf4 (reset 6)');
  -- A team locked while the vote runs does not get the deal at the deadline.
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform tf_as('02'); perform tf_ok(respond_trade(tid, true), 'tf4 out to the floor again');
  perform tf_as('01'); perform tf_ok(commish_lock_team(lid, b, true), 'tf4 B is locked mid-vote');
  update trade_proposal set review_until = now() - interval '1 minute' where id = tid;
  r := trade_sweep();
  perform tf_true((select status from trade_proposal where id = tid) = 'expired'
    and exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'tf-1'),
    'tf4 a locked team''s deal does not complete');
  perform tf_ok(commish_lock_team(lid, b, false), 'tf4 B unlocked');
  -- Nobody outside the trade = no floor to put it on: it executes like 'none'
  -- rather than waiting out a window whose result cannot change.
  update league_membership set enrolled = false where league_id = lid and sleeper_roster_id in (c, d, e);
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb);
  tid := (r ->> 'trade_id')::uuid;
  perform tf_as('02');
  r := respond_trade(tid, true);
  perform tf_true((r ->> 'status') = 'executed', 'tf4 a two-team league holds no vote');
  update league_membership set enrolled = true where league_id = lid and sleeper_roster_id in (c, d, e);
  perform tf_as('01');
  perform tf_ok(commish_move_player(lid, 'tf-1', a), 'tf4 (reset 7)');
  perform tf_ok(commish_move_player(lid, 'tf-4', b), 'tf4 (reset 8)');
  perform tf_ok(commish_set_trade_rules(lid, 'none'), 'tf4 review off');

  -- ── tf5. FAAB as an asset ──
  perform tf_refused(propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb, null, null, null, null, null, 10),
    'FAAB league', 'tf5 no FAAB to trade in a rolling league');
  perform tf_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100), 'tf5 FAAB waivers, $100');
  perform tf_ok(commish_set_trade_rules(lid, null, null, null, null, false), 'tf5 FAAB trading off');
  perform tf_refused(propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb, null, null, null, null, null, 10),
    'turned off', 'tf5 the switch is respected');
  perform tf_ok(commish_set_trade_rules(lid, null, null, null, null, true), 'tf5 FAAB trading on');
  perform tf_refused(propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb, null, null, null, null, null, 150),
    'of FAAB left', 'tf5 more than the wallet holds');
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-4"]'::jsonb, 'and $25', null, null, null, null, 25);
  perform tf_ok(r, 'tf5 a player and $25'); tid := (r ->> 'trade_id')::uuid;
  perform tf_as('02');
  perform tf_ok(respond_trade(tid, true), 'tf5 B takes it');
  perform tf_true(member_faab(lid, a) = 75 and member_faab(lid, b) = 125, 'tf5 the dollars moved');
  perform tf_true(exists (select 1 from league_txn where league_id = lid and kind = 'faab' and roster_id = b and from_roster = a),
    'tf5 the register keeps it');
  -- Asking FOR dollars is the same trade, signed the other way.
  perform tf_as('01');
  r := propose_trade(lid, a, b, '["tf-2"]'::jsonb, '["tf-1"]'::jsonb, null, null, null, null, null, -50);
  perform tf_ok(r, 'tf5 A asks for $50'); tid := (r ->> 'trade_id')::uuid;
  perform tf_as('02');
  perform tf_ok(respond_trade(tid, true), 'tf5 B agrees');
  perform tf_true(member_faab(lid, a) = 125 and member_faab(lid, b) = 75, 'tf5 the dollars came back the other way');
  -- A wallet emptied between the offer and the acceptance refuses the trade.
  perform tf_as('01');
  r := propose_trade(lid, a, b, '["tf-1"]'::jsonb, '["tf-2"]'::jsonb, null, null, null, null, null, 100);
  perform tf_ok(r, 'tf5 A offers $100'); tid := (r ->> 'trade_id')::uuid;
  update league_membership set faab_budget = 10 where league_id = lid and sleeper_roster_id = a;
  perform tf_as('02');
  perform tf_refused(respond_trade(tid, true), 'no longer has', 'tf5 the wallet is re-checked at execution');
  perform tf_true((select status from trade_proposal where id = tid) = 'pending', 'tf5 and the offer stands');
end $$;

select 'ALL TRADE-FLOOR PROBES PASS' as result;
drop function if exists tf_true(boolean, text);
drop function if exists tf_ok(jsonb, text);
drop function if exists tf_refused(jsonb, text, text);
drop function if exists tf_as(text);
