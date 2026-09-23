-- 0353 probes: THE COMMISSIONER RE-SCORES A WEEK.
--   • only the commissioner may ask; classic only; a week with no finals, or
--     one still being played, is refused;
--   • one open request per league-week;
--   • APPLY confirms a PREVIEW: none, a failed one, a stale one, one that
--     found nothing, or one already applied — each refuses;
--   • the state read says what the console needs, including can_apply;
--   • rescore_finish is the service role's: it closes the request, and an
--     apply that moved anything posts one house line naming the results;
--     a preview, a failure and a no-change apply post nothing.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function rs_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function rs_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function rs_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function rs_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000016' || u, false);
      perform set_config('app.email', 'rs' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001601', 'rs01@test.dev'), ('00000000-0000-0000-0000-000000001602', 'rs02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001601', 'rs01@test.dev'), ('00000000-0000-0000-0000-000000001602', 'rs02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001601', '00000000-0000-0000-0000-000000001602');

do $$
declare r jsonb; lid uuid; code text; a int; b int; pv bigint; ap bigint; n int; line text;
  -- Weeks with NO slate rows count as complete, so the fixture owns them
  -- outright: 60 is finished, 61 has a game still on, 62 has no finals.
  done_wk constant int := 60; live_wk constant int := 61; empty_wk constant int := 62;
begin
  perform rs_as('01');
  r := create_native_league('Rescore', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform rs_ok(r, 'rs0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform rs_as('02'); perform rs_ok(native_join(code, 'RS-B'), 'rs0 B joins');
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001601';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001602';
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, done_wk,  a, b, 'final', 100.0, 90.0),
    (lid, live_wk,  a, b, 'final', 10.0, 20.0),
    (lid, empty_wk, a, b, 'scheduled', null, null);
  insert into game_feed (week, game_id, key, away, home, state) values (live_wk, 'RS-LIVE', 'AAA@BBB', 'AAA', 'BBB', 'in');

  -- ── rs1. who, which league, which week ──
  perform rs_as('02');
  perform rs_refused(commish_request_rescore(lid, done_wk), 'commissioner only', 'rs1 a manager cannot ask');
  perform rs_refused(league_rescore_state(lid, done_wk), 'forbidden', 'rs1 nor read the state');
  perform rs_as('01');
  update league set settings_json = settings_json || '{"game_mode": "drip"}' where id = lid;
  perform rs_refused(commish_request_rescore(lid, done_wk), 'drip week can''t be re-scored', 'rs1 never a drip week');
  update league set settings_json = settings_json || '{"game_mode": "classic"}' where id = lid;
  perform rs_refused(commish_request_rescore(lid, empty_wk), 'no final scores', 'rs1 a week with no finals');
  perform rs_refused(commish_request_rescore(lid, live_wk), 'still being played', 'rs1 a week still on');
  perform rs_refused(commish_request_rescore(lid, done_wk, true), 'preview week', 'rs1 apply with no preview');

  -- ── rs2. a preview, and one at a time ──
  r := commish_request_rescore(lid, done_wk); perform rs_ok(r, 'rs2 preview filed'); pv := (r ->> 'id')::bigint;
  perform rs_refused(commish_request_rescore(lid, done_wk), 'already being re-scored', 'rs2 one open request per week');
  r := league_rescore_state(lid, done_wk);
  perform rs_true((r #>> '{request,id}')::bigint = pv and (r ->> 'can_apply')::boolean = false, 'rs2 state shows it running, no apply yet');

  -- The worker finishes it — as the service role, the only role allowed.
  perform rs_true(not has_function_privilege('authenticated', 'rescore_finish(bigint,jsonb,text)', 'execute')
              and has_function_privilege('service_role', 'rescore_finish(bigint,jsonb,text)', 'execute'),
    'rs2 only the worker closes a request');
  select count(*) into n from league_message where league_id = lid and kind = 'txn';
  perform rescore_finish(pv, jsonb_build_object('changed', 1, 'flipped', 1, 'matchups', jsonb_build_array(
    jsonb_build_object('home_roster_id', a, 'away_roster_id', b, 'moved', true, 'flipped', true,
      'was', jsonb_build_object('home', 100, 'away', 90), 'now', jsonb_build_object('home', 88, 'away', 90)))), null);
  perform rs_true((select count(*) from league_message where league_id = lid and kind = 'txn') = n,
    'rs2 a preview posts nothing to chat');
  r := league_rescore_state(lid, done_wk);
  perform rs_true((r ->> 'can_apply')::boolean and (r #>> '{request,result,changed}')::int = 1, 'rs2 a finished preview that found a change can be applied');

  -- ── rs3. the apply ──
  r := commish_request_rescore(lid, done_wk, true); perform rs_ok(r, 'rs3 apply filed'); ap := (r ->> 'id')::bigint;
  perform rs_true((select preview_id from rescore_request where id = ap) = pv, 'rs3 the apply names the preview it confirms');
  perform rescore_finish(ap, jsonb_build_object('changed', 1, 'flipped', 1, 'matchups', jsonb_build_array(
    jsonb_build_object('home_roster_id', a, 'away_roster_id', b, 'moved', true, 'flipped', true,
      'was', jsonb_build_object('home', 100, 'away', 90), 'now', jsonb_build_object('home', 88, 'away', 90))), 'report', 'rebuilt'), null);
  select body into line from league_message where league_id = lid and kind = 'txn' and txn ->> 'kind' = 'rescore' order by created_at desc limit 1;
  perform rs_true(line like '📝 The commissioner re-scored week ' || done_wk || ':%', 'rs3 the league is told — got ' || coalesce(line, 'nothing'));
  perform rs_true(line like '%100→88%' and line like '%(result changed)%', 'rs3 with the numbers and the flip');
  perform rs_refused(commish_request_rescore(lid, done_wk, true), 'preview week', 'rs3 a preview confirms one apply, not two');
  perform rescore_finish(ap, '{"changed": 9}'::jsonb, null);
  perform rs_true((select count(*) from league_message where league_id = lid and txn ->> 'kind' = 'rescore') = 1,
    'rs3 finishing a closed request again does nothing');

  -- ── rs4. previews that cannot be confirmed ──
  r := commish_request_rescore(lid, done_wk); pv := (r ->> 'id')::bigint;
  perform rescore_finish(pv, '{"changed": 0, "flipped": 0, "matchups": []}'::jsonb, null);
  perform rs_refused(commish_request_rescore(lid, done_wk, true), 'preview week', 'rs4 a preview that found nothing');
  r := commish_request_rescore(lid, done_wk); pv := (r ->> 'id')::bigint;
  perform rescore_finish(pv, null, 'scorer blew up');
  perform rs_refused(commish_request_rescore(lid, done_wk, true), 'preview week', 'rs4 a preview that failed');
  r := commish_request_rescore(lid, done_wk); pv := (r ->> 'id')::bigint;
  perform rescore_finish(pv, '{"changed": 1, "flipped": 0, "matchups": []}'::jsonb, null);
  update rescore_request set done_at = now() - interval '31 minutes' where id = pv;
  perform rs_refused(commish_request_rescore(lid, done_wk, true), 'preview week', 'rs4 a preview over 30 minutes old');

  -- ── rs5. an apply that moved nothing, or failed, says nothing ──
  update rescore_request set done_at = now() where id = pv;
  r := commish_request_rescore(lid, done_wk, true); ap := (r ->> 'id')::bigint;
  perform rescore_finish(ap, '{"changed": 0, "flipped": 0, "matchups": []}'::jsonb, null);
  r := commish_request_rescore(lid, done_wk); pv := (r ->> 'id')::bigint;
  perform rescore_finish(pv, '{"changed": 1, "flipped": 0, "matchups": []}'::jsonb, null);
  r := commish_request_rescore(lid, done_wk, true); ap := (r ->> 'id')::bigint;
  perform rescore_finish(ap, null, 'stamp failed');
  perform rs_true((select count(*) from league_message where league_id = lid and txn ->> 'kind' = 'rescore') = 1,
    'rs5 no line for a no-change apply or a failed one');
  perform rs_true((league_rescore_state(lid, done_wk) #>> '{request,error}') = 'stamp failed', 'rs5 the failure is what the console reads');
end $$;
select 'ALL RESCORE PROBES PASS' as result;
drop function if exists rs_true(boolean, text);
drop function if exists rs_ok(jsonb, text);
drop function if exists rs_refused(jsonb, text, text);
drop function if exists rs_as(text);
