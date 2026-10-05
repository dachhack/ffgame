-- 0442 probes: WHAT A LEAGUE'S SEASONS ALLOW.
--
--   • a redraft league: no devy spots, no devy market, no taxi squad — at
--     creation (commish_setup_college), from the roster shape, from the
--     older devy setup and the market switch (the backstop); college
--     lineup spots are fine;
--   • a keeper league takes all three;
--   • a dynasty league: no guillotine, no vampire — set_league_format and
--     the backstop; a redraft league takes guillotine;
--   • continuity can't move to redraft under a shelf, nor to dynasty under
--     one of those formats; only a NEW violation is refused.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function sr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function sr_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function sr_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function sr_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000060' || u, false); perform set_config('app.email', 'sr' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000006001', 'sr01@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000006001', 'sr01@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id = '00000000-0000-0000-0000-000000006001';

do $$
declare r jsonb; a uuid; b uuid; c uuid; boom text;
begin
  perform sr_as('01');

  -- ══ sr1. A REDRAFT LEAGUE HAS NOTHING TO DEVELOP ═════════════════════════
  r := create_native_league('SR Redraft', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  a := (r ->> 'league_id')::uuid;
  perform sr_true(league_continuity(a) = 'redraft', 'sr1 a league is redraft by default');
  perform sr_err(commish_setup_college(a, 'none', 1, 2, false), 'keeper and dynasty', 'sr1a devy spots at creation');
  perform sr_err(commish_setup_college(a, 'none', 1, 0, true), 'keeper and dynasty', 'sr1b the market at creation');
  perform sr_ok(commish_setup_college(a, 'mixed', 1, 0, false), 'sr1c college lineup spots score this season — fine');
  perform sr_err(set_league_roster_shape(a, (_roster_shape(a) ->> 'bench')::int, 2, 0, 0, 0), 'taxi squad is for keeper', 'sr1d a new taxi squad');
  perform sr_err(set_league_roster_shape(a, (_roster_shape(a) ->> 'bench')::int, 0, 0, 0, 2), 'devy spots are for keeper', 'sr1e a new devy shelf');
  perform sr_ok(set_league_roster_shape(a, (_roster_shape(a) ->> 'bench')::int, 0, 2, 0, 0), 'sr1f IR spots are not a shelf');
  perform sr_err(commish_setup_devy(a, 'spots'), 'keeper and dynasty', 'sr1g the older devy setup (0398) is refused through the roster shape');
  boom := null;
  begin perform set_league_devy_mode(a, 'shares'); exception when others then boom := sqlerrm; end;
  perform sr_true(boom like '%redraft league%', 'sr1h the market switch hits the backstop: ' || coalesce(boom, 'no error'));
  perform sr_true(_devy_slots(a) = 0 and coalesce((_roster_shape(a) ->> 'taxi')::int, 0) = 0 and not _devy_shares_on(a), 'sr1i nothing stuck');

  -- ══ sr2. A KEEPER LEAGUE TAKES ALL THREE ═════════════════════════════════
  r := create_native_league('SR Keeper', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic', 'keeper', 2);
  b := (r ->> 'league_id')::uuid;
  perform sr_ok(commish_setup_college(b, 'none', 1, 2, false), 'sr2 devy spots on a keeper league');
  perform sr_ok(set_league_roster_shape(b, (_roster_shape(b) ->> 'bench')::int, 2, 0, 0, 2), 'sr2a and a taxi squad');
  perform sr_err(set_league_continuity(b, 'redraft'), 'set those to 0', 'sr2b …which bars the way back to redraft');
  perform sr_ok(set_league_roster_shape(b, (_roster_shape(b) ->> 'bench')::int, 0, 0, 0, 0), 'sr2c shelves off');
  perform sr_ok(set_league_continuity(b, 'redraft'), 'sr2d …and redraft is open again');

  -- ══ sr3. A DYNASTY LEAGUE PLAYS HEAD-TO-HEAD ═════════════════════════════
  r := create_native_league('SR Dynasty', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic', 'dynasty', 3);
  c := (r ->> 'league_id')::uuid;
  perform sr_true(league_continuity(c) = 'dynasty', 'sr3 a dynasty league');
  perform sr_err(set_league_format(c, 'guillotine'), 'head-to-head', 'sr3a no guillotine');
  perform sr_err(set_league_format(c, 'vampire'), 'head-to-head', 'sr3b no vampire');
  perform sr_ok(set_league_format(c, 'standard'), 'sr3c head-to-head is fine');
  perform sr_ok(set_league_format(a, 'guillotine'), 'sr3d a redraft league takes guillotine');
  perform sr_err(set_league_continuity(a, 'dynasty', 3), 'switch the format', 'sr3e …and can''t become dynasty under it');
  perform sr_ok(set_league_format(a, 'standard'), 'sr3f back to head-to-head');
  perform sr_ok(set_league_continuity(a, 'dynasty', 3), 'sr3g …then dynasty is open');
  boom := null;
  begin update league set settings_json = settings_json || '{"format":"vampire"}'::jsonb where id = a; exception when others then boom := sqlerrm; end;
  perform sr_true(boom like '%dynasty league plays head-to-head%', 'sr3h the backstop catches a direct write: ' || coalesce(boom, 'no error'));

  -- ══ sr4. ONLY A NEW VIOLATION IS REFUSED ═════════════════════════════════
  -- A league already in the state (made before 0442) keeps working: its
  -- other settings still save, and the shelf it has stays.
  alter table league disable trigger user;
  update league set settings_json = settings_json || '{"continuity":"redraft","roster_shape":{"bench":6,"taxi":2,"ir":0,"out":0}}'::jsonb where id = b;
  alter table league enable trigger user;
  perform sr_ok(set_league_roster_shape(b, 5, 2, 0, 0, 0), 'sr4 a redraft league that already has a taxi squad can still change its bench');
  perform sr_err(set_league_roster_shape(b, 5, 3, 0, 0, 0), 'taxi squad is for keeper', 'sr4a …but not grow the squad');
  perform sr_ok(set_league_roster_shape(b, 5, 0, 0, 0, 0), 'sr4b …or drop it');

  delete from league where id in (a, b, c);
  raise notice 'season rules probes done';
end $$;

select 'ALL SEASON-RULES PROBES PASSED' as result;
