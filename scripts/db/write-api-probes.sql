-- 0352 probes: THE WRITE API.
--   • the commissioner opts in, and nobody else can;
--   • keys: minted once, stored as a hash, listed without it, ten a league;
--   • the door: the service role only, a bad key is a 401, a key is pinned
--     to its league;
--   • TEAM scope acts for your own seats and nothing else — commissioner or
--     not; LEAGUE scope is the commissioner's, and only it reaches the
--     commissioner's tools;
--   • a lineup is written with the policies' questions asked out loud, and a
--     trigger's refusal comes back as an answer with nothing half-done;
--   • objects named by id (a claim, a trade) must belong to the key's league;
--   • revoked keys and a switched-off league stop at once; switching back on
--     restores them;
--   • a key never inherits the platform admin's powers;
--   • every write is logged, and the log is read by the right people.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function wa_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function wa_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function wa_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function wa_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000015' || u, false);
      perform set_config('app.email', 'wa' || u || '@test.dev', false); end $$;
-- The API as the edge function calls it. api_write leaves the owner's claims
-- set for the rest of its transaction — which in production ends with the
-- request, and here would leak into the next assertion — so clear them.
create or replace function wa_call(k text, act text, args jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := api_write(k, act, args);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001501', 'wa01@test.dev'), ('00000000-0000-0000-0000-000000001502', 'wa02@test.dev'),
  ('00000000-0000-0000-0000-000000001503', 'wa03@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001501', 'wa01@test.dev'), ('00000000-0000-0000-0000-000000001502', 'wa02@test.dev'),
  ('00000000-0000-0000-0000-000000001503', 'wa03@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001501', '00000000-0000-0000-0000-000000001502',
              '00000000-0000-0000-0000-000000001503');

do $$
declare r jsonb; lid uuid; lid2 uuid; code text; a int; b int; c int;
        kb text; kc text; ka_t text; ka_l text; kb_id uuid; ka_l_id uuid;
        tid uuid; cid uuid; n int; wk int;
begin
  -- ── wa0. a classic league: A is the commissioner, B and C manage ──
  perform wa_as('01');
  r := create_native_league('WriteApi', '2026', 3, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform wa_ok(r, 'wa0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform wa_as('02'); perform wa_ok(native_join(code, 'WA-B'), 'wa0 B joins');
  perform wa_as('03'); perform wa_ok(native_join(code, 'WA-C'), 'wa0 C joins');
  perform wa_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'wa-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'WAH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001501';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001502';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001503';
  perform wa_ok(native_generate_schedule(lid, 2), 'wa0 the schedule');
  -- The schedule starts at the first week still playable (0280), which other
  -- suites' slate rows can move — so read it rather than assume week 1.
  select min(week) into wk from matchup where league_id = lid;
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, a, 'wa-1', 'draft'), (lid, a, 'wa-2', 'draft'), (lid, b, 'wa-4', 'draft'), (lid, b, 'wa-6', 'draft'),
    (lid, c, 'wa-5', 'draft');
  -- Free agency every day, no after-games hold: the fixture must not depend
  -- on which weekday the suite happens to run.
  perform wa_ok(set_transaction_rules(lid, p_fa_mode => 'open',
    p_waiver_days => '["fa","fa","fa","fa","fa","fa","fa"]'::jsonb, p_waiver_game_hold_dow => -1), 'wa0 free agency open');

  -- ── wa1. the switch is the commissioner's, and it starts off ──
  perform wa_true(league_write_api(lid) = false, 'wa1 off until switched on');
  perform wa_as('02');
  perform wa_refused(api_key_create(lid, 'bot'), 'has not turned on', 'wa1 no keys while off');
  perform wa_refused(commish_set_write_api(lid, true), 'commissioner only', 'wa1 a manager cannot switch it on');
  perform wa_as('01');
  perform wa_ok(commish_set_write_api(lid, true), 'wa1 the commissioner switches it on');
  perform wa_true(league_write_api(lid), 'wa1 on');

  -- ── wa2. keys ──
  perform wa_as('02');
  perform wa_refused(api_key_create(lid, 'bot', 'league'), 'only the commissioner', 'wa2 league scope is the commissioner''s');
  perform wa_refused(api_key_create(lid, 'bot', 'root'), 'team or league', 'wa2 no third scope');
  r := api_key_create(lid, 'lineup bot'); perform wa_ok(r, 'wa2 B mints a team key');
  kb := r ->> 'key'; kb_id := (r ->> 'id')::uuid;
  perform wa_true(kb like 'drip_sk_%' and length(kb) = 72, 'wa2 the key''s shape');
  perform wa_true(not exists (select 1 from api_key where secret_hash = kb or prefix = kb or label = kb),
    'wa2 the key itself is stored nowhere');
  perform wa_true((select prefix from api_key where id = kb_id) = left(kb, 14), 'wa2 listed by its prefix');
  perform wa_as('03'); kc := api_key_create(lid, 'c bot') ->> 'key';
  perform wa_as('01');
  ka_t := api_key_create(lid, 'my own team') ->> 'key';
  r := api_key_create(lid, 'league tools', 'league'); perform wa_ok(r, 'wa2 A mints a league key');
  ka_l := r ->> 'key'; ka_l_id := (r ->> 'id')::uuid;
  r := api_keys(lid);
  perform wa_true(jsonb_array_length(r -> 'keys') = 4, 'wa2 the commissioner lists every key');
  perform wa_true(not (r::text like '%' || substr(kb, 15) || '%'), 'wa2 no list carries a key');
  perform wa_as('02');
  perform wa_true(jsonb_array_length(api_keys(lid) -> 'keys') = 1, 'wa2 a manager lists only their own');
  for n in 1..9 loop perform api_key_create(lid, 'spare ' || n); end loop;
  perform wa_refused(api_key_create(lid, 'eleventh'), 'ten live keys', 'wa2 ten a league');
  update api_key set revoked_at = now() where label like 'spare %';

  -- ── wa3. the door ──
  perform wa_true(not has_function_privilege('authenticated', 'api_write(text,text,jsonb)', 'execute')
              and not has_function_privilege('anon', 'api_write(text,text,jsonb)', 'execute')
              and has_function_privilege('service_role', 'api_write(text,text,jsonb)', 'execute'),
    'wa3 only the service role may call the door');
  r := wa_call('drip_sk_nope', 'me');
  perform wa_true((r ->> 'status')::int = 401, 'wa3 a bad key is a 401');
  r := wa_call(kb, 'me');
  perform wa_ok(r, 'wa3 me');
  perform wa_true(r -> 'rosters' = jsonb_build_array(b) and (r ->> 'is_commish')::boolean = false
              and r #>> '{key,scope}' = 'team', 'wa3 me says who, which seat, which scope');
  perform wa_true(auth.uid() = '00000000-0000-0000-0000-000000001502', 'wa3 the claims do not outlive the call');
  r := wa_call(kb, 'me', jsonb_build_object('league_id', gen_random_uuid()));
  perform wa_true((r ->> 'status')::int = 403 and r ->> 'error' like '%different league%', 'wa3 pinned to its league');
  r := wa_call(kb, 'launch_missiles');
  perform wa_true((r ->> 'status')::int = 404, 'wa3 an action that is not listed does not exist');

  -- ── wa4. team scope ──
  r := wa_call(kb, 'add', jsonb_build_object('roster_id', b, 'add', 'wa-20'));
  perform wa_ok(r, 'wa4 B adds for B');
  perform wa_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'wa-20'),
    'wa4 the add landed');
  r := wa_call(kb, 'add', jsonb_build_object('roster_id', a, 'add', 'wa-21'));
  perform wa_true((r ->> 'status')::int = 403, 'wa4 B cannot act for A');
  r := wa_call(ka_t, 'add', jsonb_build_object('roster_id', b, 'add', 'wa-21'));
  perform wa_true((r ->> 'status')::int = 403, 'wa4 a TEAM key is held to its own seat even for the commissioner');
  r := wa_call(kb, 'drop', jsonb_build_object('roster_id', b, 'player', 'wa-20'));
  perform wa_ok(r, 'wa4 B drops');
  r := wa_call(kb, 'claim', jsonb_build_object('roster_id', b, 'add', 'wa-22'));
  perform wa_true((r ->> 'status')::int = 422 and r ->> 'error' like '%add him directly%',
    'wa4 the league''s own refusal comes through as a 422');
  r := wa_call(kb, 'add');
  perform wa_true((r ->> 'status')::int = 400, 'wa4 a team action needs a roster');

  -- ── wa5. league scope and the commissioner's tools ──
  r := wa_call(kb, 'process_waivers');
  perform wa_true((r ->> 'status')::int = 403 and r ->> 'error' like '%league-scope%', 'wa5 not with a team key');
  r := wa_call(ka_t, 'process_waivers');
  perform wa_true((r ->> 'status')::int = 403, 'wa5 not with the commissioner''s TEAM key either');
  perform wa_ok(wa_call(ka_l, 'process_waivers'), 'wa5 the league key runs waivers');
  perform wa_ok(wa_call(ka_l, 'add', jsonb_build_object('roster_id', c, 'add', 'wa-23')), 'wa5 the league key acts for any seat');
  perform wa_ok(wa_call(ka_l, 'move_player', jsonb_build_object('player', 'wa-23', 'to_roster', b)), 'wa5 move a player');
  perform wa_true(exists (select 1 from native_roster where league_id = lid and roster_id = b and slug = 'wa-23'),
    'wa5 the move landed');

  -- ── wa6. lineups ──
  r := wa_call(kb, 'set_lineup', jsonb_build_object('roster_id', b, 'week', wk,
         'picks', jsonb_build_array(jsonb_build_object('game_window', 'wk', 'roster_slot', 'S1', 'player_slug', 'wa-4'))));
  perform wa_ok(r, 'wa6 B sets a lineup');
  perform wa_true(exists (select 1 from sealed_pick where matchup_id = (r ->> 'matchup_id')::uuid
      and app_user_id = '00000000-0000-0000-0000-000000001502' and roster_slot = 'S1' and player_slug = 'wa-4'),
    'wa6 written as the seat''s owner');
  r := wa_call(kb, 'lineup', jsonb_build_object('roster_id', b, 'week', wk));
  perform wa_true(r #>> '{picks,0,player_slug}' = 'wa-4', 'wa6 and read back');
  r := wa_call(kb, 'set_lineup', jsonb_build_object('roster_id', b, 'week', wk,
         'picks', jsonb_build_array(jsonb_build_object('game_window', 'wk', 'roster_slot', 'S2', 'player_slug', 'wa-6'))));
  perform wa_ok(r, 'wa6 a second lineup');
  perform wa_true(not exists (select 1 from sealed_pick where matchup_id = (r ->> 'matchup_id')::uuid and roster_slot = 'S1'),
    'wa6 the window is replaced, so the emptied spot is gone');
  -- A trigger's refusal: WAH has kicked off, so the kickoff lock (0178) says
  -- no — to the new pick AND to the delete that would empty S2. Nothing lands.
  insert into nfl_slate (season, week, home, away, win, kickoff)
  values ('2026', wk, 'WAH', 'WAA', 'early', now() - interval '1 hour');
  r := wa_call(kb, 'set_lineup', jsonb_build_object('roster_id', b, 'week', wk,
         'picks', jsonb_build_array(jsonb_build_object('game_window', 'wk', 'roster_slot', 'S3', 'player_slug', 'wa-4'))));
  perform wa_true((r ->> 'ok')::boolean = false and (r ->> 'status')::int = 409, 'wa6 a locked pick is refused, not a crash');
  perform wa_true(exists (select 1 from sealed_pick s join matchup m on m.id = s.matchup_id
      where m.league_id = lid and s.roster_slot = 'S2' and s.player_slug = 'wa-6')
    and not exists (select 1 from sealed_pick s join matchup m on m.id = s.matchup_id
      where m.league_id = lid and s.roster_slot = 'S3'),
    'wa6 and the refused call left the lineup exactly as it was');
  delete from nfl_slate where season = '2026' and week = wk and home = 'WAH';
  r := wa_call(ka_t, 'set_lineup', jsonb_build_object('roster_id', b, 'week', wk, 'picks', '[]'::jsonb));
  perform wa_true((r ->> 'status')::int = 403, 'wa6 a team key cannot set another team''s lineup');
  perform wa_ok(wa_call(ka_l, 'set_lineup', jsonb_build_object('roster_id', b, 'week', wk,
         'picks', jsonb_build_array(jsonb_build_object('game_window', 'wk', 'roster_slot', 'S2', 'player_slug', 'wa-4')))),
    'wa6 the league key sets a CLASSIC lineup (0320)');
  update league set settings_json = settings_json || '{"game_mode": "drip"}' where id = lid;
  r := wa_call(ka_l, 'set_lineup', jsonb_build_object('roster_id', b, 'week', wk, 'picks', '[]'::jsonb));
  perform wa_refused(r, 'cannot set that team', 'wa6 but never a drip lineup, whose picks are hidden');
  r := wa_call(ka_l, 'lineup', jsonb_build_object('roster_id', b, 'week', wk));
  perform wa_refused(r, 'stay hidden', 'wa6 nor read one before it reveals');
  update league set settings_json = settings_json || '{"game_mode": "classic"}' where id = lid;
  perform wa_ok(wa_call(ka_l, 'lineup', jsonb_build_object('roster_id', b, 'week', wk)), 'wa6 a classic lineup is open to read');
  r := wa_call(kb, 'add', jsonb_build_object('roster_id', 'three', 'add', 'wa-21'));
  perform wa_true((r ->> 'status')::int = 400, 'wa6 a roster_id that is not a number is a 400, not a crash');
  r := wa_call(kb, 'cancel_claim', jsonb_build_object('claim_id', 'not-a-uuid'));
  perform wa_true((r ->> 'status')::int = 400, 'wa6 nor is a claim_id that is not a uuid');
  r := wa_call(kb, 'me', jsonb_build_object('league_id', upper(lid::text)));
  perform wa_ok(r, 'wa6 the league id in a path is not case-sensitive');

  -- ── wa7. trades, and objects named by id ──
  r := wa_call(kb, 'propose_trade', jsonb_build_object('roster_id', b, 'to_roster', a,
         'give', jsonb_build_array('wa-6'), 'get', jsonb_build_array('wa-2')));
  perform wa_ok(r, 'wa7 B proposes'); tid := (r ->> 'trade_id')::uuid;
  r := wa_call(kc, 'cancel_trade', jsonb_build_object('trade_id', tid));
  perform wa_refused(r, 'only the proposer', 'wa7 C cannot withdraw B''s offer');
  r := wa_call(ka_t, 'cancel_trade', jsonb_build_object('trade_id', tid));
  perform wa_refused(r, 'only the proposer', 'wa7 nor can the commissioner''s TEAM key');
  perform wa_ok(wa_call(ka_t, 'respond_trade', jsonb_build_object('trade_id', tid, 'accept', false)), 'wa7 A declines with A''s own key');
  r := wa_call(kb, 'respond_trade', jsonb_build_object('trade_id', gen_random_uuid(), 'accept', true));
  perform wa_true((r ->> 'status')::int = 404, 'wa7 a trade not in this league');
  -- A KEY IS NOT AN ADMIN. respond_trade lets is_admin() answer anybody's
  -- trade; make A a platform admin and A's key still cannot answer B's.
  perform wa_as('03');
  r := propose_trade(lid, c, b, '["wa-5"]'::jsonb, '["wa-4"]'::jsonb);
  perform wa_ok(r, 'wa7 C proposes to B'); tid := (r ->> 'trade_id')::uuid;
  insert into app_admin (email) values ('wa01@test.dev') on conflict do nothing;
  r := wa_call(ka_l, 'respond_trade', jsonb_build_object('trade_id', tid, 'accept', true));
  perform wa_refused(r, 'not your trade', 'wa7 a key never inherits the platform admin');
  delete from app_admin where email = 'wa01@test.dev';
  -- A claim of C's, named by id.
  perform wa_as('01');
  perform wa_ok(set_transaction_rules(lid, p_fa_mode => 'off'), 'wa7 free agency shut, so a pickup is a claim');
  perform wa_as('03');
  r := submit_waiver_claim(lid, c, 'wa-30'); perform wa_ok(r, 'wa7 C claims'); cid := (r ->> 'claim_id')::uuid;
  r := wa_call(kb, 'cancel_claim', jsonb_build_object('claim_id', cid));
  perform wa_refused(r, 'not your claim', 'wa7 B cannot cancel C''s claim');
  perform wa_ok(wa_call(kc, 'cancel_claim', jsonb_build_object('claim_id', cid)), 'wa7 C cancels their own');

  -- ── wa8. another league: the same person, a different key's reach ──
  perform wa_as('02');
  r := create_native_league('WriteApi Two', '2026', 2, 8, 60); lid2 := (r ->> 'league_id')::uuid;
  update league set settings_json = coalesce(settings_json, '{}') || '{"write_api": true}' where id = lid2;
  r := wa_call(kb, 'me', jsonb_build_object('league_id', lid2));
  perform wa_true((r ->> 'status')::int = 403, 'wa8 a key cannot be pointed at its owner''s other league');

  -- ── wa9. revoking, and the switch ──
  perform wa_as('02');
  perform wa_refused(api_key_revoke(ka_l_id), 'forbidden', 'wa9 B cannot revoke A''s key');
  perform wa_ok(api_key_revoke(kb_id), 'wa9 B revokes their own');
  perform wa_true((wa_call(kb, 'me') ->> 'status')::int = 401, 'wa9 a revoked key is a 401');
  perform wa_as('01');
  perform wa_ok(commish_set_write_api(lid, false), 'wa9 the commissioner switches it off');
  r := wa_call(ka_l, 'me');
  perform wa_true((r ->> 'status')::int = 403 and r ->> 'error' like '%has not turned on%', 'wa9 every key stops');
  perform wa_ok(commish_set_write_api(lid, true), 'wa9 and back on');
  perform wa_ok(wa_call(ka_l, 'me'), 'wa9 the keys come back with it');
  -- A seat lost is a key lost.
  update league_membership set app_user_id = null, enrolled = false where league_id = lid and sleeper_roster_id = c;
  perform wa_true((wa_call(kc, 'me') ->> 'status')::int = 403, 'wa9 a manager who left is refused');

  -- ── wa10. the log ──
  perform wa_true(exists (select 1 from api_write_log where league_id = lid and action = 'add' and ok),
    'wa10 a write is logged');
  perform wa_true(exists (select 1 from api_write_log where league_id = lid and action = 'set_lineup' and not ok
      and error is not null), 'wa10 a refusal is logged with its reason');
  perform wa_true(not exists (select 1 from api_write_log where action in ('me', 'lineup')), 'wa10 reads are not');
  perform wa_as('01');
  n := jsonb_array_length(api_write_log_list(lid) -> 'entries');
  perform wa_as('02');
  perform wa_true(jsonb_array_length(api_write_log_list(lid) -> 'entries') between 1 and n - 1,
    'wa10 a manager reads their own lines, the commissioner reads all of them');

end $$;
-- stdout, not a NOTICE: the runner greps stdout, and a notice goes to stderr.
select 'ALL WRITE-API PROBES PASS' as result;
drop function if exists wa_true(boolean, text);
drop function if exists wa_ok(jsonb, text);
drop function if exists wa_refused(jsonb, text, text);
drop function if exists wa_as(text);
drop function if exists wa_call(text, text, jsonb);
