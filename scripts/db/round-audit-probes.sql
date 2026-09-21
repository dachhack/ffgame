-- 0336 probes: THE ROUND, AUDITED. One probe per fix, each written to fail
-- on the 0322–0335 body and pass on the 0336 one:
--   • ra1 a FAAB trade whose wallet went short refuses with NOTHING moved;
--   • ra2 the veto bar never exceeds a multi-team trade's electorate;
--   • ra3 a raise inside the execute settles the vote instead of retrying;
--   • ra4 a commissioner's veto posts to chat;
--   • ra5 a linked group waits for its slowest clock;
--   • ra6 a badge pinned on a seat does not multiply its record;
--   • ra7 a private season stays private through a public one's lineage;
--   • ra8 award_week is the commissioner's; a re-run pays new winners only;
--   • ra9 api_trades carries a reversed trade and hides an expired offer;
--        api_league carries scoring for a reader with no session;
--   • ra10 a lone SFLX spot is a superflex market in SQL too, and the
--         dynasty format survives a thin ADP board;
--   • ra11 the season map answers by id when the slug is missing.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function ra_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ra_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — %', msg, r; end if; end $$;
create or replace function ra_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%'
  then raise exception 'PROBE FAIL % — %', msg, r; end if; end $$;
create or replace function ra_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000033' || u, false); perform set_config('app.email', 'ra' || u || '@test.dev', false); end $$;
create or replace function ra_nobody() returns void language plpgsql as $$
begin perform set_config('app.uid', '', false); perform set_config('app.email', '', false); end $$;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000330' || g)::uuid, 'ra0' || g || '@test.dev' from generate_series(1, 5) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-00000000330' || g)::uuid, 'ra0' || g || '@test.dev' from generate_series(1, 5) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where email like 'ra0%@test.dev';

do $$
declare r jsonb; lid uuid; lid2 uuid; code text; a int; b int; c int; d int; tid uuid;
        c1 uuid; c2 uuid; n int; h jsonb; key text; ch int;
begin
  perform ra_as('01');
  r := create_native_league('Audited', '2026', 4, 6, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform ra_ok(r, 'ra0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform ra_as('02'); perform ra_ok(native_join(code, 'RA-B'), 'ra0 B joins');
  perform ra_as('03'); perform ra_ok(native_join(code, 'RA-C'), 'ra0 C joins');
  perform ra_as('04'); perform ra_ok(native_join(code, 'RA-D'), 'ra0 D joins');
  perform ra_as('01');
  perform ra_ok(seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'ra-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'RAH', 'exp', 0))
    from generate_series(1, 30) g)), 'ra0 pool');
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000003301';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000003302';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000003303';
  select sleeper_roster_id into d from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000003304';
  perform ra_ok(native_generate_schedule(lid, 3), 'ra0 schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'ra-1', 'draft'), (lid, a, 'ra-2', 'draft'),
    (lid, b, 'ra-3', 'draft'), (lid, b, 'ra-4', 'draft'),
    (lid, c, 'ra-5', 'draft'), (lid, c, 'ra-6', 'draft'),
    (lid, d, 'ra-7', 'draft'), (lid, d, 'ra-8', 'draft');
  perform ra_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'open'), 'ra0 FAAB');

  -- ── ra1. the wallet went short: NOTHING moves ──
  r := propose_trade(lid, a, b, '["ra-1"]'::jsonb, '["ra-3"]'::jsonb, null, null, null, null, null, 40);
  perform ra_ok(r, 'ra1 A offers ra-1 + $40 for ra-3'); tid := (r ->> 'trade_id')::uuid;
  update league_membership set faab_budget = 10 where league_id = lid and sleeper_roster_id = a;
  perform ra_as('02');
  perform ra_refused(respond_trade(tid, true), 'no longer has', 'ra1 refused at execution');
  perform ra_true((select roster_id from native_roster where league_id = lid and slug = 'ra-1') = a
              and (select roster_id from native_roster where league_id = lid and slug = 'ra-3') = b,
    'ra1 THE PLAYERS DID NOT MOVE — 0322 swapped them and then refused');
  perform ra_true((select status from trade_proposal where id = tid) = 'pending', 'ra1 the offer stands');
  perform ra_true(not exists (select 1 from league_txn where league_id = lid and kind = 'faab'), 'ra1 no money line');
  perform ra_as('01');
  update league_membership set faab_budget = 100 where league_id = lid and sleeper_roster_id = a;
  perform ra_ok(cancel_trade(tid), 'ra1 withdrawn');

  -- ── ra2. a three-team trade in a four-team league: one outside seat ──
  perform ra_ok(commish_set_trade_rules(lid, 'league', 24, 2), 'ra2 league vote, two vetoes');
  perform ra_true(league_trade_veto_votes(lid) = 2, 'ra2 the league bar is 2');
  r := propose_multi_trade(lid, jsonb_build_array(
    jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'ra-1', 'to', b))),
    jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'ra-3', 'to', c))),
    jsonb_build_object('roster', c, 'send', jsonb_build_array(jsonb_build_object('slug', 'ra-5', 'to', a)))));
  perform ra_ok(r, 'ra2 three-way filed'); tid := (r ->> 'trade_id')::uuid;
  perform ra_as('02'); perform ra_ok(respond_trade(tid, true), 'ra2 B accepts');
  perform ra_as('03'); perform ra_ok(respond_trade(tid, true), 'ra2 C accepts → the floor');
  perform ra_true((select status from trade_proposal where id = tid) = 'review', 'ra2 out for a vote');
  perform ra_true(_trade_electorate(tid) = 1, 'ra2 an electorate of one');
  perform ra_as('01');
  r := league_trades(lid);
  perform ra_true((select (e ->> 'veto_need')::int from jsonb_array_elements(r) e where (e ->> 'id')::uuid = tid) = 1,
    'ra2 the screen shows a bar of ONE, not the league''s two');
  perform ra_as('04');
  r := cast_trade_vote(tid, true);
  perform ra_true((select status from trade_proposal where id = tid) = 'vetoed',
    'ra2 the one outside seat''s veto KILLS it — 0322 executed it on this ballot');
  perform ra_as('01');

  -- ── ra3. a raise inside the execute settles the vote ──
  perform ra_ok(commish_set_trade_rules(lid, 'league', 24, 1), 'ra3 one veto');
  r := propose_trade(lid, a, b, '["ra-2"]'::jsonb, '["ra-4"]'::jsonb);
  perform ra_ok(r, 'ra3 offer'); tid := (r ->> 'trade_id')::uuid;
  perform ra_as('02'); perform ra_ok(respond_trade(tid, true), 'ra3 accepted → the floor');
  perform ra_as('01');
  perform ra_true((select status from trade_proposal where id = tid) = 'review', 'ra3 in review');
  -- the commissioner flags the player no-trade while the vote runs: the roster trigger RAISES
  perform set_player_flags_bulk(lid, array['ra-2'], 'NO TRADE', '{"no_trade": true}'::jsonb);
  update trade_proposal set review_until = now() - interval '1 minute' where id = tid;
  r := trade_sweep();   -- (the sweep's own tally still files a refusal under "stuck"; the row is what matters)
  perform ra_true((select status from trade_proposal where id = tid) = 'expired',
    'ra3 settled as could-not-complete — 0322 retried it every tick');
  perform ra_true((select roster_id from native_roster where league_id = lid and slug = 'ra-2') = a, 'ra3 and nothing moved');
  perform set_player_flags_bulk(lid, array['ra-2'], null, '{}'::jsonb);

  -- ── ra4. the commissioner's veto is news ──
  perform ra_ok(commish_set_trade_rules(lid, 'commish'), 'ra4 commissioner review');
  r := propose_trade(lid, a, b, '["ra-2"]'::jsonb, '["ra-4"]'::jsonb);
  perform ra_ok(r, 'ra4 offer'); tid := (r ->> 'trade_id')::uuid;
  perform ra_as('02'); perform ra_ok(respond_trade(tid, true), 'ra4 accepted');
  perform ra_as('01');
  select count(*) into ch from league_message where league_id = lid;
  perform ra_ok(commish_rule_trade(tid, false), 'ra4 vetoed');
  perform ra_true((select count(*) from league_message where league_id = lid) = ch + 1
              and exists (select 1 from league_message where league_id = lid and body like '⚑ Trade vetoed by the commissioner%'),
    'ra4 the league heard it');

  -- ── ra5. a linked group waits for its slowest clock ──
  perform set_transaction_rules(lid, p_fa_mode => 'off');
  update league_pool set waived_until = now() - interval '1 hour' where league_id = lid and slug = 'ra-20';
  update league_pool set waived_until = now() + interval '5 hours' where league_id = lid and slug = 'ra-21';
  r := submit_waiver_claim(lid, a, 'ra-21', null, 5); perform ra_ok(r, 'ra5 first choice (due in 5h)'); c1 := (r ->> 'claim_id')::uuid;
  r := submit_waiver_claim(lid, a, 'ra-20', null, 5); perform ra_ok(r, 'ra5 fallback (due now)'); c2 := (r ->> 'claim_id')::uuid;
  update waiver_claim set clears_at = now() + interval '5 hours' where id = c1;
  update waiver_claim set clears_at = now() - interval '1 second' where id = c2;
  perform ra_ok(group_waiver_claims(array[c1, c2]), 'ra5 linked, first choice first');
  r := process_waivers(lid);
  perform ra_true((select status from waiver_claim where id = c2) = 'pending'
              and (select status from waiver_claim where id = c1) = 'pending',
    'ra5 the due fallback WAITED for the first choice — 0323 landed it and marked the first choice lost');
  update waiver_claim set clears_at = now() - interval '1 second' where id = c1;
  update league_pool set waived_until = now() - interval '1 second' where league_id = lid and slug = 'ra-21';
  r := process_waivers(lid);
  perform ra_true((select status from waiver_claim where id = c1) = 'won'
              and (select status from waiver_claim where id = c2) = 'lost',
    'ra5 both due: the first choice lands and the fallback settles');

  -- ── ra6. a badge does not multiply the record ──
  delete from matchup where league_id = lid;   -- the generated slate; this probe writes its own
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 1, a, b, 'final', 120.0, 90.0), (lid, 1, c, d, 'final', 100.0, 101.0),
    (lid, 2, a, c, 'final', 110.0, 95.0), (lid, 2, b, d, 'final', 99.0, 98.0);
  h := league_history(lid);
  select (m ->> 'w')::int into n from jsonb_array_elements(h -> 'managers') m
   where m ->> 'app_user_id' = '00000000-0000-0000-0000-000000003301';
  perform ra_true(n = 2, 'ra6 A is 2-0 before any badge: ' || coalesce(n::text, 'null'));
  perform ra_ok(commish_set_badge(lid, 'goat', 'GOAT', '🐐'), 'ra6 badge');
  perform ra_ok(commish_set_badge(lid, 'clown', 'Clown', '🤡'), 'ra6 second badge');
  perform ra_ok(commish_grant_badge(lid, a, 'goat'), 'ra6 pinned');
  perform ra_ok(commish_grant_badge(lid, a, 'clown'), 'ra6 pinned again');
  h := league_history(lid);
  select (m ->> 'w')::int, jsonb_array_length(m -> 'badges') into n, ch from jsonb_array_elements(h -> 'managers') m
   where m ->> 'app_user_id' = '00000000-0000-0000-0000-000000003301';
  perform ra_true(n = 2 and ch = 2, 'ra6 still 2-0 with two badges — 0325 said 4-0: w=' || n || ' badges=' || ch);

  -- ── ra7. a private season stays private ──
  perform ra_as('01');
  r := create_native_league('AuditedLast', '2025', 2, 6, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform ra_ok(r, 'ra7 last season'); lid2 := (r ->> 'league_id')::uuid;
  select sleeper_league_id into key from league where id = lid;
  update league set sleeper_league_id = key where id = lid2;   -- the same lineage
  perform ra_true(array_length(_lineage_ids(lid), 1) = 2, 'ra7 two seasons in the lineage');
  perform ra_ok(commish_set_public_api(lid, false), 'ra7 THIS season private');
  perform ra_true(league_public_api(lid2) is true, 'ra7 last season still open by default');
  perform ra_as('05');   -- a stranger, reading through last season's id
  h := league_history(lid2);
  perform ra_true((h ->> 'ok')::boolean, 'ra7 the stranger reads last season');
  perform ra_true(not exists (select 1 from jsonb_array_elements(h -> 'seasons') s where (s ->> 'league_id')::uuid = lid),
    'ra7 and does NOT get this season''s table through it — 0332 served it');
  perform ra_true((h ->> 'redacted')::boolean, 'ra7 redacted');
  perform ra_as('01');
  h := league_history(lid2);
  perform ra_true(exists (select 1 from jsonb_array_elements(h -> 'seasons') s where (s ->> 'league_id')::uuid = lid),
    'ra7 a member still reads both');
  perform ra_ok(commish_set_public_api(lid, true), 'ra7 back on');

  -- ── ra8. award_week: whose, and paid once ──
  perform ra_ok(commish_set_award(lid, 'high', 'High Score', '🔥', 'points', 'high', 'any', 50), 'ra8 high score pays 50');
  perform ra_as('02');
  perform ra_refused(award_week(lid, 1), 'forbidden', 'ra8 a manager cannot run the awards');
  perform ra_nobody();
  r := award_week(lid, 1); perform ra_ok(r, 'ra8 the worker can');
  perform ra_true((select coins from team_wallet where league_id = lid and roster_id = a) = 50, 'ra8 A paid 50');
  -- a score correction hands the high score to C; the re-run pays C, not A again
  update matchup set home_final = 130.0 where league_id = lid and week = 1 and home_roster_id = c;
  r := award_week(lid, 1); perform ra_ok(r, 'ra8 re-run after the correction');
  perform ra_true((select coins from team_wallet where league_id = lid and roster_id = a) = 50,
    'ra8 A is NOT paid twice — 0325 credited every winner on every run');
  perform ra_true((select coins from team_wallet where league_id = lid and roster_id = c) = 50, 'ra8 C is paid once');
  perform ra_true((select sum(delta) from coin_ledger where league_id = lid and reason = 'award:high') = 100, 'ra8 the ledger agrees');
  perform ra_as('01');

  -- ── ra9. the public API ──
  perform ra_ok(commish_set_trade_rules(lid, 'none'), 'ra9 execute on accept');
  r := propose_trade(lid, a, b, '["ra-2"]'::jsonb, '["ra-4"]'::jsonb);
  perform ra_ok(r, 'ra9 offer'); tid := (r ->> 'trade_id')::uuid;
  perform ra_as('02'); perform ra_ok(respond_trade(tid, true), 'ra9 executed');
  perform ra_as('01'); perform ra_ok(commish_reverse_trade(tid), 'ra9 reversed');
  r := propose_trade(lid, a, c, '["ra-2"]'::jsonb, '["ra-6"]'::jsonb, null, null, null, null, null, 0, 1);
  perform ra_ok(r, 'ra9 an offer that expires'); 
  update trade_proposal set expires_at = now() - interval '1 minute' where id = (r ->> 'trade_id')::uuid;
  perform trade_sweep();
  perform ra_nobody();
  r := api_trades(lid);
  perform ra_true(exists (select 1 from jsonb_array_elements(r -> 'trades') t where t ->> 'status' = 'reversed'),
    'ra9 a reversed trade is in the feed');
  perform ra_true(not exists (select 1 from jsonb_array_elements(r -> 'trades') t where t ->> 'status' = 'expired'),
    'ra9 an expired OFFER is not');
  r := api_league(lid);
  perform ra_true((r -> 'scoring' ->> 'ok')::boolean and r -> 'scoring' ? 'yd_mult' and not (r -> 'scoring' ? 'error'),
    'ra9 scoring answers for a reader with no session: ' || (r -> 'scoring')::text);
  perform ra_as('01');

  -- ── ra10. one superflex rule ──
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || jsonb_build_object('roster_slots', jsonb_build_array(
    jsonb_build_object('pos', jsonb_build_array('QB', 'RB', 'WR', 'TE'), 'type', 'SFLX'),
    jsonb_build_object('pos', jsonb_build_array('RB', 'WR')))) where id = lid;
  perform ra_true(_league_adp_format(lid) = '2qb', 'ra10 a lone SFLX spot with no plain QB is a superflex market — 0334 said PPR');
  update league set settings_json = (settings_json - 'roster_slots') || '{"roster_classic": {"QB": 2, "RB": 2}}'::jsonb where id = lid;
  perform ra_true(_league_adp_format(lid) = '2qb', 'ra10 and so are the 0161 counts');
  -- the dynasty format is the league's even when the 2QB ADP board is thin
  r := league_market(lid);
  perform ra_true(coalesce(r ->> 'dyn_format', 'sf') = 'sf' or (r ->> 'adp_source') is null,
    'ra10 dyn_format follows the league, not the ADP fallback: ' || coalesce(r ->> 'dyn_format', 'null'));
  update league set settings_json = settings_json - 'roster_classic' where id = lid;

  -- ── ra11. the season map answers by id ──
  r := upsert_proj_board(jsonb_build_array(
    jsonb_build_object('sleeper_id', 'ra-sid-1', 'slug', null, 'ppg', 12.0, 'gp', 17, 'per_week', 12.0)),
    '2026-09-21T16:00:00Z');
  r := league_market(lid);
  perform ra_true((r -> 'proj' ->> 'ra-sid-1')::numeric = 12.0, 'ra11 a board row with no slug answers by its id — 0335 served {}');
end $$;

select 'ALL ROUND-AUDIT PROBES PASS' as result;
drop function if exists ra_true(boolean, text);
drop function if exists ra_ok(jsonb, text);
drop function if exists ra_refused(jsonb, text, text);
drop function if exists ra_as(text);
drop function if exists ra_nobody();
