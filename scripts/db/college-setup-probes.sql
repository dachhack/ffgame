-- 0439 probes: THE COLLEGE CHOICES AT CREATION — three questions, mixed and
-- matched as far as the engine goes.
--
--   • nothing chosen leaves an NFL-only league untouched;
--   • MIXED adds college-only starting spots (levels) and grows the rounds;
--   • COLLEGE ONLY puts the league on the college calendar, pool college only;
--   • devy spots and the market still set up as 0398 did;
--   • the pairings the engine can't honour are refused with the reason, and
--     nothing is written; a member can't; not after the draft;
--   • set_league_calendar keeps its admin gate.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function cs_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cs_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cs_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function cs_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000057' || u, false); perform set_config('app.email', 'cs' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005701', 'cs01@test.dev'), ('00000000-0000-0000-0000-000000005702', 'cs02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005701', 'cs01@test.dev'), ('00000000-0000-0000-0000-000000005702', 'cs02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005701', '00000000-0000-0000-0000-000000005702');
-- NOT an admin: an ordinary commissioner makes every one of these leagues.

do $$
declare r jsonb; a uuid; b uuid; c uuid; d uuid; e uuid; f uuid; g uuid; code text; n0 int;
begin
  perform cs_as('01');

  -- ══ cs1. NOTHING CHOSEN ═══════════════════════════════════════════════════
  r := create_native_league('CS None', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  a := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  r := commish_setup_college(a, 'none', 1, 0, false);
  perform cs_ok(r, 'cs1 nothing chosen is fine');
  perform cs_true(not _league_has_college((select settings_json from league where id = a)), 'cs1a …and leaves college off');

  -- ══ cs2. MIXED: college starting spots beside the NFL lineup ══════════════
  r := create_native_league('CS Mixed', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  b := (r ->> 'league_id')::uuid; n0 := (select rounds from draft where league_id = b);
  r := commish_setup_college(b, 'mixed', 2, 0, false);
  perform cs_ok(r, 'cs2 THE POINT: a commissioner makes a mixed league at creation');
  perform cs_true(_league_has_college((select settings_json from league where id = b)) and league_is_mixed(b) and not league_is_college_calendar(b),
    'cs2a college on, mixed, on the NFL calendar');
  perform cs_true((select count(*) from jsonb_array_elements((select settings_json -> 'roster_slots' from league where id = b)) s where s ->> 'level' = 'college') = 2,
    'cs2b two college-only starting spots in the lineup');
  perform cs_true((select rounds from draft where league_id = b) = n0 + 2 and (r ->> 'rounds')::int = n0 + 2,
    'cs2c …drafted: the rounds grew by two (' || n0 || ' → ' || (select rounds from draft where league_id = b) || ')');
  perform cs_true((r ->> 'college_spots')::int = 2 and (r ->> 'devy_spots')::int = 0 and not (r ->> 'market')::boolean, 'cs2d the reply says what was set: ' || r::text);
  perform cs_true(_devy_slots(b) = 0, 'cs2e no devy spots');

  -- ══ cs3. COLLEGE ONLY: the college calendar ═══════════════════════════════
  r := create_native_league('CS College', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  c := (r ->> 'league_id')::uuid;
  perform cs_ok(commish_setup_college(c, 'college', 1, 0, false), 'cs3 a college-only league at creation');
  perform cs_true(league_is_college_calendar(c) and _league_has_college((select settings_json from league where id = c)), 'cs3a on the college calendar, college on');
  perform cs_true((select settings_json -> 'pool_filter' ->> 'level' from league where id = c) = 'college', 'cs3b the pool is college only');
  perform cs_true(not coalesce(jsonb_path_exists((select settings_json -> 'roster_slots' from league where id = c), '$[*].pos[*] ? (@ == "K" || @ == "DEF")'), true),
    'cs3c the lineup is the college default — no K or D/ST');

  -- ══ cs4. DEVY SPOTS, AS 0398 ══════════════════════════════════════════════
  r := create_native_league('CS Devy', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  d := (r ->> 'league_id')::uuid; n0 := (select rounds from draft where league_id = d);
  perform cs_ok(commish_setup_college(d, 'none', 1, 3, false), 'cs4 devy holding spots');
  perform cs_true(_devy_slots(d) = 3 and (select rounds from draft where league_id = d) = n0 + 3, 'cs4a three devy spots, drafted on top of the rounds');
  perform cs_true(_league_has_college((select settings_json from league where id = d)) and not _devy_shares_on(d) and not league_is_mixed(d), 'cs4b college on, no market, not mixed');

  -- ══ cs5. THE MARKET, AS 0398 ══════════════════════════════════════════════
  r := create_native_league('CS Market', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  e := (r ->> 'league_id')::uuid;
  perform cs_ok(commish_setup_college(e, 'none', 1, 0, true), 'cs5 the devy market');
  perform cs_true(_devy_shares_on(e) and _league_has_college((select settings_json from league where id = e)), 'cs5a market on, college on');

  -- ══ cs6. THE PAIRINGS THE ENGINE CAN'T HONOUR YET — refused, nothing written ══
  r := create_native_league('CS Refuse', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  f := (r ->> 'league_id')::uuid;
  -- (0440: college lineup spots + devy spots combine — mixed-devy-probes has it)
  perform cs_err(commish_setup_college(f, 'college', 1, 2, false), 'no devy spots', 'cs6b college only + devy spots');
  perform cs_err(commish_setup_college(f, 'none', 1, 2, true), 'market and devy spots', 'cs6c market + devy spots');
  perform cs_err(commish_setup_college(f, 'mixed', 1, 0, true), 'out of the draft pool', 'cs6d market + college lineup spots');
  perform cs_err(commish_setup_college(f, 'college', 1, 0, true), 'NFL schedule', 'cs6e market + college only');
  perform cs_err(commish_setup_college(f, 'both', 1, 0, false), 'none, mixed or college', 'cs6f an unknown lineup');
  perform cs_true(not _league_has_college((select settings_json from league where id = f)) and _devy_slots(f) = 0
              and (select settings_json -> 'roster_slots' from league where id = f) is null,
    'cs6g a refusal writes nothing');
  perform cs_ok(commish_setup_college(f, 'mixed', 1, 2, false), 'cs6k college lineup spots + devy spots combine (0440)');
  perform cs_true(league_is_mixed(f) and _devy_slots(f) = 2, 'cs6l …mixed, with the shelf');
  r := create_native_league('CS Auction', '2031', 2, 8, 60, 'auction', 200, 15, 1, null, null, null, 'classic');
  g := (r ->> 'league_id')::uuid;
  perform cs_err(commish_setup_college(g, 'none', 1, 0, true), 'auction', 'cs6h no market with an auction draft');
  perform cs_ok(commish_setup_college(g, 'mixed', 1, 0, false), 'cs6i …but mixed is fine with an auction');
  r := create_native_league('CS Drip', '2031', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'drip');
  perform cs_err(commish_setup_college((r ->> 'league_id')::uuid, 'mixed', 1, 0, false), 'classic', 'cs6j college players need classic');
  delete from league where id = (r ->> 'league_id')::uuid;

  -- ══ cs7. WHO MAY, AND WHEN ════════════════════════════════════════════════
  perform cs_as('02'); perform native_join(code, 'CS-2');
  perform cs_err(commish_setup_college(a, 'mixed', 1, 0, false), 'commissioner only', 'cs7 a member cannot');
  perform cs_err(set_league_calendar(a, 'college'), 'admin only', 'cs7a the calendar switch keeps its admin gate');
  perform cs_as('01');
  perform cs_err(set_league_calendar(a, 'college'), 'admin only', 'cs7b …for the commissioner too');
  update draft set status = 'complete' where league_id = a;
  perform cs_err(commish_setup_college(a, 'mixed', 1, 0, false), 'before the draft', 'cs7c not after the draft');

  delete from league where id in (a, b, c, d, e, f, g);
  raise notice 'college setup probes done';
end $$;

select 'ALL COLLEGE-SETUP PROBES PASSED' as result;
