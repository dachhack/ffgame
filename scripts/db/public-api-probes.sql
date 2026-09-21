-- 0326 probes: THE PUBLIC READ API.
--   • the switch: a full league is 404 until its commissioner opens it, a
--     pod is open by default, and "closed" and "no such league" are the
--     same answer;
--   • every endpoint answers for an open league and nothing for a closed
--     one — asked ANONYMOUSLY, which is the only way this API is ever used;
--   • the secrets hold: a sealed pick whose window has not revealed is not
--     in api_lineups, a pending waiver bid is not in api_transactions, and
--     a pending trade offer is not in api_trades;
--   • no endpoint returns an email, a claim email or an invite code;
--   • the meter: a bucket that empties says so, and refills.
\set QUIET on
\pset pager off
create or replace function pa_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function pa_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000017' || u, false); perform set_config('app.email', 'pa' || u || '@test.dev', false); end $$;
-- Anonymous: no uid, no email — exactly what the edge function's calls look
-- like once the service role has been stripped of a user identity.
create or replace function pa_anon() returns void language plpgsql as $$
begin perform set_config('app.uid', '', false); perform set_config('app.email', '', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001701', 'pa01@test.dev'), ('00000000-0000-0000-0000-000000001702', 'pa02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001701', 'pa01@test.dev'), ('00000000-0000-0000-0000-000000001702', 'pa02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001701', '00000000-0000-0000-0000-000000001702');

do $$
declare r jsonb; lid uuid; code text; a int; b int; mid uuid; js text; wk int;
begin
  perform pa_as('01');
  r := create_native_league('PublicAPI', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform pa_true((r ->> 'ok')::boolean, 'pa0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform pa_as('02'); perform pa_true((native_join(code, 'PA-B') ->> 'ok')::boolean, 'pa0 B joins');
  perform pa_as('01');
  perform pa_true((seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'pa-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'PAH', 'exp', 0))
    from generate_series(1, 20) g)) ->> 'ok')::boolean, 'pa0 pool');
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001701';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001702';
  perform pa_true((native_generate_schedule(lid, 2) ->> 'ok')::boolean, 'pa0 schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'pa-1', 'draft'), (lid, b, 'pa-2', 'draft');

  -- ── pa1. the switch ──
  perform pa_anon();
  perform pa_true(api_league(lid) is null, 'pa1 a private league is nothing to the API');
  perform pa_true(api_teams(lid) is null and api_rosters(lid) is null and api_standings(lid) is null
    and api_matchups(lid) is null and api_transactions(lid) is null and api_trades(lid) is null
    and api_draft(lid) is null and api_picks(lid) is null and api_players(lid) is null
    and api_history(lid) is null and api_awards(lid) is null and api_lineups(lid, 1) is null,
    'pa1 every endpoint is silent');
  perform pa_true(api_league(gen_random_uuid()) is null, 'pa1 and a league that does not exist looks the same');
  perform pa_as('02');
  perform pa_true((commish_set_public_api(lid, true) ->> 'ok')::boolean is not true, 'pa1 a manager cannot open it');
  perform pa_as('01');
  perform pa_true((commish_set_public_api(lid, true) ->> 'public_api')::boolean, 'pa1 the commissioner opens it');

  -- ── pa2. the endpoints, anonymously ──
  perform pa_anon();
  r := api_league(lid);
  perform pa_true(r ->> 'name' = 'PublicAPI' and (r ->> 'teams')::int = 2
    and r -> 'rules' ->> 'waiver_mode' is not null, 'pa2 the league card');
  perform pa_true(jsonb_array_length(api_teams(lid) -> 'teams') = 2, 'pa2 the teams');
  perform pa_true(jsonb_array_length(api_rosters(lid) -> 'rosters') = 2, 'pa2 the rosters');
  perform pa_true(jsonb_array_length(api_standings(lid) -> 'standings') = 2, 'pa2 the standings');
  perform pa_true(jsonb_array_length(api_matchups(lid) -> 'matchups') > 0, 'pa2 the matchups');
  perform pa_true(api_draft(lid) -> 'draft' ->> 'status' = 'complete', 'pa2 the draft');
  perform pa_true(jsonb_array_length(api_players(lid) -> 'players') = 20, 'pa2 the player pool');
  perform pa_true((api_history(lid) -> 'history' ->> 'ok')::boolean, 'pa2 the history, without being a member');
  perform pa_true((api_awards(lid) -> 'awards' ->> 'ok')::boolean, 'pa2 the awards, without being a member');
  perform pa_true(api_transactions(lid) -> 'transactions' is not null, 'pa2 the register');
  perform pa_true(api_trades(lid) -> 'trades' is not null, 'pa2 the trades');
  perform pa_true(api_picks(lid) -> 'picks' is not null, 'pa2 the pick assets');

  -- ── pa3. the secrets hold ──
  -- A sealed pick whose window has not revealed is not served.
  select id, week into mid, wk from matchup where league_id = lid order by week limit 1;
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked)
    values (mid, '00000000-0000-0000-0000-000000001701', 'wk', 'S1', 'pa-1', 'rec_yds', false);
  perform pa_true(jsonb_array_length(api_lineups(lid, wk) -> 'drip') = 0,
    'pa3 an unlocked pick is not in the API');
  update sealed_pick set locked = true where matchup_id = mid;
  perform pa_true(jsonb_array_length(api_lineups(lid, wk) -> 'drip') = 0,
    'pa3 nor a locked one whose window has not revealed');
  -- A pending waiver claim's bid is not served; a settled one's is.
  perform pa_as('01');
  perform pa_true((set_transaction_rules(lid, p_waiver_mode => 'faab', p_faab_budget => 100, p_fa_mode => 'off') ->> 'ok')::boolean, 'pa3 FAAB');
  perform pa_true((submit_waiver_claim(lid, a, 'pa-5', null, 40) ->> 'ok')::boolean, 'pa3 a blind bid is filed');
  perform pa_anon();
  js := api_transactions(lid)::text;
  -- The player he bid on, and the bid itself: a blind auction that an
  -- outsider can poll is not blind. ('%40%' alone would match a timestamp,
  -- so the bid is checked as the field it would appear as.)
  perform pa_true(js not like '%pa-5%' and js not like '%"bid": 40%',
    'pa3 a pending bid is nowhere in the register');
  -- A pending trade offer is not served.
  perform pa_as('01');
  perform pa_true((propose_trade(lid, a, b, '["pa-1"]'::jsonb, '["pa-2"]'::jsonb, 'psst') ->> 'ok')::boolean, 'pa3 an offer is made');
  perform pa_anon();
  perform pa_true(jsonb_array_length(api_trades(lid) -> 'trades') = 0, 'pa3 a negotiation is not news');
  perform pa_as('02');
  perform pa_true((respond_trade((select id from trade_proposal where league_id = lid limit 1), true) ->> 'status') = 'executed',
    'pa3 the deal is struck');
  perform pa_anon();
  perform pa_true(jsonb_array_length(api_trades(lid) -> 'trades') = 1, 'pa3 and a completed deal is');

  -- ── pa4. nothing personal ──
  js := concat(api_league(lid)::text, api_teams(lid)::text, api_rosters(lid)::text, api_standings(lid)::text,
               api_matchups(lid)::text, api_transactions(lid)::text, api_trades(lid)::text, api_draft(lid)::text,
               api_picks(lid)::text, api_players(lid)::text, api_history(lid)::text, api_awards(lid)::text,
               api_lineups(lid, wk)::text);
  perform pa_true(js not like '%@test.dev%', 'pa4 no email address anywhere in the API');
  perform pa_true(js not like '%' || code || '%', 'pa4 nor the invite code');
  perform pa_true(js not like '%claim_email%' and js not like '%app_user_id%', 'pa4 nor a user id');

  -- ── pa5. the meter ──
  perform pa_true(api_take_token('1.2.3.4', 10, 3) = 2, 'pa5 the first call takes a token');
  perform pa_true(api_take_token('1.2.3.4', 10, 3) >= 1, 'pa5 and the second');
  perform api_take_token('1.2.3.4', 0, 3);
  perform api_take_token('1.2.3.4', 0, 3);
  perform pa_true(api_take_token('1.2.3.4', 0, 3) = -1, 'pa5 an empty bucket says so');
  perform pa_true(api_take_token('5.6.7.8', 10, 3) = 2, 'pa5 and one caller does not drain another');
  perform pa_true(api_take_token('', 10, 3) = 3, 'pa5 an unknown caller is let through');

  -- ── pa6. shutting it again ──
  perform pa_as('01');
  perform pa_true((commish_set_public_api(lid, false) ->> 'public_api')::boolean is not true, 'pa6 closed again');
  perform pa_anon();
  perform pa_true(api_league(lid) is null and api_history(lid) is null, 'pa6 and the door is shut');
end $$;

select 'ALL PUBLIC-API PROBES PASS' as result;
drop function if exists pa_true(boolean, text);
drop function if exists pa_as(text);
drop function if exists pa_anon();
