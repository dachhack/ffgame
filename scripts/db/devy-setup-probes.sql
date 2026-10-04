-- 0398 probes: DEVY AT LEAGUE CREATION.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function dv_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function dv_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function dv_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function dv_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000056' || u, false); perform set_config('app.email', 'dv' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005601', 'dv01@test.dev'), ('00000000-0000-0000-0000-000000005602', 'dv02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005601', 'dv01@test.dev'), ('00000000-0000-0000-0000-000000005602', 'dv02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005601', '00000000-0000-0000-0000-000000005602');
-- NOT an admin: the point is that an ordinary commissioner can do this.

do $$
declare r jsonb; a uuid; b uuid; c uuid; code text; n0 int;
begin
  perform dv_as('01');
  r := create_native_league('Devy Spots Made', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  a := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  n0 := (select rounds from draft where league_id = a);
  perform dv_ok(commish_setup_devy(a, 'spots'), 'dv1 THE POINT: a commissioner turns devy on at creation');
  perform dv_true(_league_has_college((select settings_json from league where id = a)), 'dv1a college players are on');
  perform dv_true(not _devy_shares_on(a), 'dv1b spots, not the market');
  perform dv_true((_roster_shape(a) ->> 'devy')::int = 3, 'dv1c three devy spots by default');
  perform dv_true((select rounds from draft where league_id = a) = n0 + 3, 'dv1d …added on top of the rounds: ' || n0 || ' → ' || (select rounds from draft where league_id = a) || ' starters ' || _classic_starters(a));

  r := create_native_league('Devy Market Made', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  b := (r ->> 'league_id')::uuid;
  perform dv_ok(commish_setup_devy(b, 'shares'), 'dv2 …or the devy market');
  perform dv_true(_devy_shares_on(b) and _league_has_college((select settings_json from league where id = b)), 'dv2a market on, college on');

  -- 0399: WHEN THE MARKET OPENS is the commissioner's call.
  perform dv_true(_devy_shares_locked(b), 'do1 by default a new market league waits for its first draft');
  perform dv_ok(set_league_devy_open(b, 'now'), 'do2 the commissioner opens it now');
  perform dv_true(not _devy_shares_locked(b), 'do2a …and it is open before the draft');
  perform dv_true((devy_shares_state(b) ->> 'open_now')::boolean and not (devy_shares_state(b) ->> 'drafted')::boolean, 'do2b the state says so');
  update draft set status = 'live' where league_id = b;
  perform dv_true(_devy_shares_locked(b), 'do3 a live draft locks it');
  perform dv_err(set_league_devy_open(b, 'after_draft'), 'draft is running', 'do3a no switching mid-draft');
  update draft set status = 'complete', completed_at = now() where league_id = b;
  perform dv_true(not _devy_shares_locked(b), 'do4 after the draft, the yearly rhythm: open');
  perform dv_err(set_league_devy_open(b, 'after_draft'), 'has drafted', 'do4a the choice is moot after the first draft');
  perform dv_ok(set_league_devy_open(a, 'after_draft'), 'do5 closing again is fine before the draft');

  r := create_native_league('Devy Auction', '2031', 2, 8, 60, 'auction', 200, 15, 1, null, null, null, 'classic');
  c := (r ->> 'league_id')::uuid;
  perform dv_err(commish_setup_devy(c, 'shares'), 'auction', 'dv3 no market with an auction draft');
  r := create_native_league('Devy Drip', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'drip');
  perform dv_err(commish_setup_devy((r ->> 'league_id')::uuid, 'spots'), 'classic', 'dv3a devy needs classic');
  delete from league where id = (r ->> 'league_id')::uuid;

  perform dv_as('02'); perform native_join(code, 'DV-2');
  perform dv_err(set_league_devy_open(a, 'now'), 'commissioner only', 'do6 a member cannot open the market');
  perform dv_err(commish_setup_devy(a, 'shares'), 'commissioner only', 'dv4 a member cannot');
  perform dv_as('01');
  update draft set status = 'complete' where league_id = a;
  perform dv_err(commish_setup_devy(a, 'shares'), 'before the draft', 'dv4a not after the draft');

  delete from league where id in (a, b, c);
  raise notice 'devy setup probes done';
end $$;

select 'ALL DEVY-SETUP PROBES PASSED' as result;
