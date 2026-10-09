-- 0457 probes: an open seat can be 🤖, and a claimed seat is 👤.
--   • the commissioner sets an unclaimed seat to AI (set_team_controller);
--   • a member cannot;
--   • a person who claims a 🤖 seat (native_join) arrives in control of it;
--   • the other 🤖 open seats stay 🤖;
--   • once in, the person can hand their seat back to the AI.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function ao_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ao_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function ao_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000064' || u, false); perform set_config('app.email', 'ao' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000006401', 'ao01@test.dev'), ('00000000-0000-0000-0000-000000006402', 'ao02@test.dev'), ('00000000-0000-0000-0000-000000006403', 'ao03@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000006401', 'ao01@test.dev'), ('00000000-0000-0000-0000-000000006402', 'ao02@test.dev'), ('00000000-0000-0000-0000-000000006403', 'ao03@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id::text like '00000000-0000-0000-0000-00000000640_';

do $$
declare r jsonb; lid uuid; code text; mine int; n int; s int; rid_text text;
begin
  perform ao_as('01');
  r := create_native_league('AiOpenSeats', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform ao_ok(r, 'ao0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  -- every open seat goes 🤖
  for s in select sleeper_roster_id from league_membership where league_id = lid and app_user_id is null loop
    perform set_team_controller(lid, s, 'ai');
  end loop;
  select count(*) into n from league_membership where league_id = lid and app_user_id is null and controller = 'ai';
  perform ao_true(n = 3, 'ao1 the commissioner sets all three open seats to AI — got ' || n);
  perform ao_as('02');
  begin
    perform set_team_controller(lid, (select min(sleeper_roster_id) from league_membership where league_id = lid and app_user_id is null), 'human');
    rid_text := 'allowed';
  exception when others then rid_text := 'refused';
  end;
  perform ao_true(rid_text = 'refused' or (select count(*) from league_membership where league_id = lid and app_user_id is null and controller = 'ai') = 3,
    'ao2 a member cannot flip someone else''s seat');
  perform ao_ok(native_join(code, 'AO-B'), 'ao3 B joins, landing on a 🤖 seat');
  select sleeper_roster_id into mine from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006402';
  perform ao_true((select controller from league_membership where league_id = lid and sleeper_roster_id = mine) = 'human',
    'ao4 the person who claimed it is in control of it');
  select count(*) into n from league_membership where league_id = lid and app_user_id is null and controller = 'ai';
  perform ao_true(n = 2, 'ao5 the other open seats stay 🤖 — got ' || n);
  -- once in, the person may hand their own seat back to the AI
  perform set_team_controller(lid, mine, 'ai');
  perform ao_true((select controller from league_membership where league_id = lid and sleeper_roster_id = mine) = 'ai',
    'ao6 the new manager can put their own seat on 🤖 afterwards');
  raise notice 'ai-open-seat probes done';
end $$;

select 'ALL AI-OPEN-SEAT PROBES PASSED' as result;
