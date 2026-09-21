-- 0322 probes: THE THREE-TEAM TRADE.
--   • the shape: 3–8 teams, each seat in it once, every asset addressed to
--     another seat in the deal, no seat in the room for nothing;
--   • the gates: only a team in the trade may offer it, only its own players
--     may be sent, a player or pick appears once, retention is refused;
--   • acceptance: nothing moves until the LAST seat says yes, any seat may
--     kill it, and the players land where their own line named;
--   • the league vote over a three-way: the electorate is every seat outside
--     it, and a team IN it cannot vote;
--   • FAAB and picks travel, and the register keeps the dollars.
\set QUIET on
\pset pager off
create or replace function mt_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function mt_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function mt_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function mt_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000013' || u, false); perform set_config('app.email', 'mt' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001301', 'mt01@test.dev'), ('00000000-0000-0000-0000-000000001302', 'mt02@test.dev'),
  ('00000000-0000-0000-0000-000000001303', 'mt03@test.dev'), ('00000000-0000-0000-0000-000000001304', 'mt04@test.dev'),
  ('00000000-0000-0000-0000-000000001305', 'mt05@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001301', 'mt01@test.dev'), ('00000000-0000-0000-0000-000000001302', 'mt02@test.dev'),
  ('00000000-0000-0000-0000-000000001303', 'mt03@test.dev'), ('00000000-0000-0000-0000-000000001304', 'mt04@test.dev'),
  ('00000000-0000-0000-0000-000000001305', 'mt05@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001301', '00000000-0000-0000-0000-000000001302',
              '00000000-0000-0000-0000-000000001303', '00000000-0000-0000-0000-000000001304',
              '00000000-0000-0000-0000-000000001305');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c int; d int; e int; tid uuid; legs jsonb; row_ jsonb;
begin
  perform mt_as('01');
  r := create_native_league('MultiTrade', '2026', 5, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform mt_ok(r, 'mt0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform mt_as('02'); perform mt_ok(native_join(code, 'MT-B'), 'mt0 B joins');
  perform mt_as('03'); perform mt_ok(native_join(code, 'MT-C'), 'mt0 C joins');
  perform mt_as('04'); perform mt_ok(native_join(code, 'MT-D'), 'mt0 D joins');
  perform mt_as('05'); perform mt_ok(native_join(code, 'MT-E'), 'mt0 E joins');
  perform mt_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'mt-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'MTH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001301';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001302';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001303';
  select sleeper_roster_id into d from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001304';
  select sleeper_roster_id into e from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001305';
  perform mt_ok(native_generate_schedule(lid, 2), 'mt0 the schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'mt-1', 'draft'), (lid, a, 'mt-2', 'draft'),
    (lid, b, 'mt-3', 'draft'), (lid, b, 'mt-4', 'draft'),
    (lid, c, 'mt-5', 'draft'), (lid, c, 'mt-6', 'draft');
  perform mt_ok(set_transaction_rules(lid, p_waiver_mode => 'rolling', p_fa_mode => 'open'), 'mt0 rolling, FA open');

  -- ── mt1. the shape ──
  perform mt_refused(propose_multi_trade(lid, jsonb_build_array(
      jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-1', 'to', b))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', a))))),
    '3–8 teams', 'mt1 two teams is an ordinary offer');
  perform mt_refused(propose_multi_trade(lid, jsonb_build_array(
      jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-1', 'to', b))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', a))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-4', 'to', a))))),
    'only appear once', 'mt1 a team twice');
  perform mt_refused(propose_multi_trade(lid, jsonb_build_array(
      jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-1', 'to', e))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', a))),
      jsonb_build_object('roster', c, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-5', 'to', b))))),
    'another team in the trade', 'mt1 sending to a team outside the deal');
  perform mt_refused(propose_multi_trade(lid, jsonb_build_array(
      jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', b))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-4', 'to', c))),
      jsonb_build_object('roster', c, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-5', 'to', a))))),
    'does not hold', 'mt1 sending somebody else''s player');
  perform mt_refused(propose_multi_trade(lid, jsonb_build_array(
      jsonb_build_object('roster', a, 'send', jsonb_build_array(
        jsonb_build_object('slug', 'mt-1', 'to', b), jsonb_build_object('slug', 'mt-1', 'to', c))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', a))),
      jsonb_build_object('roster', c, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-5', 'to', a))))),
    'only appear once', 'mt1 the same player sent twice');
  perform mt_refused(propose_multi_trade(lid, jsonb_build_array(
      jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-1', 'to', b))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', a))),
      jsonb_build_object('roster', c, 'send', '[]'::jsonb))),
    'neither sends nor receives', 'mt1 a team in the room for nothing');
  perform mt_refused(propose_multi_trade(lid, jsonb_build_array(
      jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-1', 'to', b))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', c))),
      jsonb_build_object('roster', c, 'send', '[]'::jsonb, 'send_faab', jsonb_build_array(jsonb_build_object('to', a, 'amount', 5))))),
    'FAAB league', 'mt1 FAAB in a rolling league');
  perform mt_as('05');
  perform mt_refused(propose_multi_trade(lid, jsonb_build_array(
      jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-1', 'to', b))),
      jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', c))),
      jsonb_build_object('roster', c, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-5', 'to', a))))),
    'must be in the trade', 'mt1 an outsider cannot file it');

  -- ── mt2. the three-way, accepted one seat at a time ──
  perform mt_as('01');
  legs := jsonb_build_array(
    jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-1', 'to', b))),
    jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', c))),
    jsonb_build_object('roster', c, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-5', 'to', a))));
  r := propose_multi_trade(lid, legs, 'the carousel');
  perform mt_ok(r, 'mt2 A files the three-way'); tid := (r ->> 'trade_id')::uuid;
  perform mt_true((r ->> 'teams')::int = 3, 'mt2 three teams');
  perform mt_true((select accepted from trade_leg where trade_id = tid and roster_id = a)
    and not (select accepted from trade_leg where trade_id = tid and roster_id = b), 'mt2 the proposer''s leg is in');
  perform mt_as('05');
  perform mt_refused(respond_trade(tid, true), 'not your trade', 'mt2 an outsider cannot answer');
  perform mt_as('02');
  r := respond_trade(tid, true);
  perform mt_true((r ->> 'status') = 'pending' and (r ->> 'awaiting') ilike '%MT-C%', 'mt2 still waiting on C');
  perform mt_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'mt-1'),
    'mt2 nothing has moved yet');
  perform mt_as('03');
  r := respond_trade(tid, true);
  perform mt_true((r ->> 'status') = 'executed', 'mt2 the last yes executes it');
  perform mt_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'mt-1' and acquired = 'trade')
    and exists (select 1 from native_roster where league_id = lid and roster_id = c and slug = 'mt-3')
    and exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'mt-5'),
    'mt2 every player landed where his own line named');
  perform mt_true(exists (select 1 from league_message where league_id = lid and kind = 'txn'
    and (txn ->> 'multi')::boolean and body ilike '%3-team trade%'), 'mt2 the league hears about it');
  -- put them back
  perform mt_as('01');
  perform mt_ok(commish_move_player(lid, 'mt-1', a), 'mt2 (reset 1)');
  perform mt_ok(commish_move_player(lid, 'mt-3', b), 'mt2 (reset 2)');
  perform mt_ok(commish_move_player(lid, 'mt-5', c), 'mt2 (reset 3)');

  -- ── mt3. any seat can kill it ──
  r := propose_multi_trade(lid, legs);
  perform mt_ok(r, 'mt3 filed again'); tid := (r ->> 'trade_id')::uuid;
  perform mt_as('03');
  r := respond_trade(tid, false);
  perform mt_true((r ->> 'status') = 'rejected', 'mt3 C says no');
  perform mt_true(exists (select 1 from native_roster where league_id = lid and roster_id = a and slug = 'mt-1'),
    'mt3 and nothing moved');
  perform mt_as('02');
  perform mt_refused(respond_trade(tid, true), 'already rejected', 'mt3 a dead deal takes no more answers');

  -- ── mt4. the league votes on a three-way ──
  perform mt_as('01');
  perform mt_ok(commish_set_trade_rules(lid, 'league', 24), 'mt4 the floor decides');
  r := propose_multi_trade(lid, legs);
  perform mt_ok(r, 'mt4 filed'); tid := (r ->> 'trade_id')::uuid;
  perform mt_as('02'); perform mt_ok(respond_trade(tid, true), 'mt4 B is in');
  perform mt_as('03'); r := respond_trade(tid, true);
  perform mt_true((r ->> 'status') = 'review', 'mt4 the last yes opens the vote');
  -- three teams are IN it, so the electorate is the other two and the bar
  -- falls back to a majority of those.
  perform mt_true(_trade_electorate(tid) = 2 and league_trade_veto_votes(lid) = 2, 'mt4 two seats outside it');
  perform mt_as('02');
  perform mt_refused(cast_trade_vote(tid, true), 'does not vote on it', 'mt4 a team in the trade cannot vote');
  perform mt_as('04'); perform mt_ok(cast_trade_vote(tid, true), 'mt4 D vetoes');
  perform mt_true((select status from trade_proposal where id = tid) = 'review', 'mt4 one veto is not enough');
  perform mt_as('05'); perform mt_ok(cast_trade_vote(tid, true), 'mt4 E vetoes too');
  perform mt_true((select status from trade_proposal where id = tid) = 'vetoed', 'mt4 the floor kills the three-way');
  perform mt_as('01');
  perform mt_ok(commish_set_trade_rules(lid, 'none'), 'mt4 review off');

  -- ── mt5. picks and FAAB travel too ──
  perform mt_ok(set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100), 'mt5 FAAB waivers, $100');
  perform mt_ok(set_pick_trading(lid, true), 'mt5 pick trading on');
  perform mt_ok(set_rookie_rounds(lid, 2), 'mt5 two rookie rounds');
  r := propose_multi_trade(lid, jsonb_build_array(
    jsonb_build_object('roster', a, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-1', 'to', b))),
    jsonb_build_object('roster', b, 'send', jsonb_build_array(jsonb_build_object('slug', 'mt-3', 'to', c)),
                       'send_faab', jsonb_build_array(jsonb_build_object('to', a, 'amount', 30))),
    jsonb_build_object('roster', c, 'send_picks', jsonb_build_array(
      jsonb_build_object('season', (select (season::int + 1)::text from league where id = lid), 'round', 1, 'orig', c, 'to', a))))
  );
  perform mt_ok(r, 'mt5 players, a pick and dollars'); tid := (r ->> 'trade_id')::uuid;
  perform mt_as('02'); perform mt_ok(respond_trade(tid, true), 'mt5 B is in');
  perform mt_as('03'); r := respond_trade(tid, true);
  perform mt_true((r ->> 'status') = 'executed', 'mt5 executed');
  perform mt_true(member_faab(lid, a) = 130 and member_faab(lid, b) = 70, 'mt5 the dollars moved');
  perform mt_true((select owner_roster from pick_asset where league_id = lid and round = 1 and original_roster = c
                    and season = (select (season::int + 1)::text from league where id = lid)) = a,
    'mt5 the pick moved');
  perform mt_true(exists (select 1 from league_txn where league_id = lid and kind = 'faab' and roster_id = a and from_roster = b),
    'mt5 the register keeps the dollars');
  row_ := (select x from jsonb_array_elements(league_trades(lid)) x where (x ->> 'id')::uuid = tid);
  perform mt_true(jsonb_array_length(row_ -> 'legs') = 3, 'mt5 league_trades carries the legs');

  -- ── mt6. an expired three-way, and a stale one ──
  perform mt_as('01');
  perform mt_ok(commish_move_player(lid, 'mt-1', a), 'mt6 (reset 1)');
  perform mt_ok(commish_move_player(lid, 'mt-3', b), 'mt6 (reset 2)');
  r := propose_multi_trade(lid, legs, null, 6);
  perform mt_ok(r, 'mt6 a six-hour three-way'); tid := (r ->> 'trade_id')::uuid;
  update trade_proposal set expires_at = now() - interval '1 second' where id = tid;
  perform mt_as('02');
  perform mt_refused(respond_trade(tid, true), 'expired', 'mt6 an expired multi cannot be taken');
  -- a player who left between the offer and the last yes stops the whole deal
  perform mt_as('01');
  r := propose_multi_trade(lid, legs);
  tid := (r ->> 'trade_id')::uuid;
  perform mt_ok(commish_remove_player(lid, 'mt-5', false), 'mt6 C''s piece is dropped');
  perform mt_as('02'); perform mt_ok(respond_trade(tid, true), 'mt6 B is in');
  perform mt_as('03');
  perform mt_refused(respond_trade(tid, true), 're-propose', 'mt6 a moved player stops it');
  perform mt_true((select status from trade_proposal where id = tid) = 'pending', 'mt6 and the offer stands');
end $$;

select 'ALL MULTI-TRADE PROBES PASS' as result;
drop function if exists mt_true(boolean, text);
drop function if exists mt_ok(jsonb, text);
drop function if exists mt_refused(jsonb, text, text);
drop function if exists mt_as(text);
