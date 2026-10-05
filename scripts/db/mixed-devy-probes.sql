-- 0440 probes: DEVY SPOTS BESIDE COLLEGE STARTING SPOTS — the shelf is a
-- taxi squad.
--
--   • a league made with MIXED + devy spots is mixed, has both, and drafts
--     both;
--   • a college player lands active while the active roster has room, on
--     the shelf once it is full; a row inserted as devy stays devy;
--   • he moves devy ⇄ active; a devy-only league still refuses the move;
--   • he is legal active in the mixed league, illegal outside devy in the
--     devy-only one;
--   • the caps: with the shelf full a college player takes an NFL spot in
--     the mixed league and is refused in the devy-only one;
--   • the builder stores the first college spot in a devy league, and the
--     backstop lets devy spots join a lineup with levels;
--   • the worker's readers see the league; autopick fills an open college
--     starting spot with a college player.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function md_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function md_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function md_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function md_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000058' || u, false); perform set_config('app.email', 'md' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005801', 'md01@test.dev'), ('00000000-0000-0000-0000-000000005802', 'md02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005801', 'md01@test.dev'), ('00000000-0000-0000-0000-000000005802', 'md02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005801', '00000000-0000-0000-0000-000000005802');
insert into app_admin (email, note) values ('md01@test.dev', 'mixed-devy probe admin') on conflict (email) do nothing;

insert into college_school (school_id, school_abbr, conference, tier) values ('98900', 'MDU', 'SEC', 'P4') on conflict (school_id) do nothing;
insert into college_player (espn_id, full_name, pos, school_id, school_abbr, class_year, active, division) values
  ('98901', 'Shelf Runner', 'RB', '98900', 'MDU', 2, true, 'FBS'),
  ('98902', 'Shelf Receiver', 'WR', '98900', 'MDU', 3, true, 'FBS'),
  ('98903', 'Shelf Passer', 'QB', '98900', 'MDU', 3, true, 'FBS'),
  ('98904', 'Shelf Tight', 'TE', '98900', 'MDU', 4, true, 'FBS')
  on conflict (espn_id) do update set full_name = excluded.full_name, pos = excluded.pos, school_id = excluded.school_id,
    class_year = excluded.class_year, active = excluded.active, division = excluded.division;

-- A pool: 9 NFL starters' worth plus bench depth, and the three college players.
create or replace function md_pool() returns jsonb language sql as $$
  select (select jsonb_agg(jsonb_build_object('slug', 'md-' || p.pos || '-' || i, 'full', 'Md ' || p.pos || ' ' || i, 'pos', p.pos, 'team', 'KC'))
            from (values ('QB'), ('RB'), ('WR'), ('TE'), ('K'), ('DEF')) p(pos), generate_series(1, 6) i)
      || '[{"slug":"c-98901","full":"Shelf Runner","pos":"RB"},{"slug":"c-98902","full":"Shelf Receiver","pos":"WR"},{"slug":"c-98903","full":"Shelf Passer","pos":"QB"},{"slug":"c-98904","full":"Shelf Tight","pos":"TE"}]'::jsonb
$$;

do $$
declare r jsonb; a uuid; b uuid; code text; n0 int; st int; bench int; i int; k int; e text; pick text;
begin
  perform md_as('01');

  -- ══ md1. MADE WITH BOTH ══════════════════════════════════════════════════
  r := create_native_league('Mixed Devy', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  a := (r ->> 'league_id')::uuid; code := r ->> 'invite_code'; n0 := (select rounds from draft where league_id = a);
  r := commish_setup_college(a, 'mixed', 1, 2, false);
  perform md_ok(r, 'md1 THE POINT: college starting spots and devy spots together');
  perform md_true(league_is_mixed(a) and _devy_slots(a) = 2, 'md1a mixed, with two devy spots');
  perform md_true((select count(*) from jsonb_array_elements((select settings_json -> 'roster_slots' from league where id = a)) s where s ->> 'level' = 'college') = 1,
    'md1b one college starting spot');
  perform md_true((select rounds from draft where league_id = a) = n0 + 1 + 2, 'md1c rounds grew by the spot and the shelf (' || n0 || ' → ' || (select rounds from draft where league_id = a) || ')');
  perform md_ok(seed_league_pool(a, md_pool()), 'md1d the pool seeds, college players in');
  perform md_true(mixed_leagues_exist() and college_calendar_in_use(), 'md1e the worker sees a mixed league');
  st := _classic_starters(a); bench := (_roster_shape(a) ->> 'bench')::int;

  -- ══ md2. LANDING: active while there is room, the shelf once there isn't ══
  perform md_as('02'); perform md_ok(native_join(code, 'MD-2'), 'md2 join'); perform md_as('01');
  insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, 'c-98901', 'draft');
  perform md_true((select spot from native_roster where league_id = a and slug = 'c-98901') = 'active', 'md2a a drafted college player lands ACTIVE in a mixed league');
  -- fill the active roster (starters + bench) with NFL players
  k := 0;
  for i in 1 .. 6 loop
    foreach e in array array['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] loop
      if (select count(*) from native_roster where league_id = a and roster_id = 1 and spot = 'active') < st + bench then
        insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, 'md-' || e || '-' || i, 'draft');
      end if;
    end loop;
  end loop;
  perform md_true((select count(*) from native_roster where league_id = a and roster_id = 1 and spot = 'active') = st + bench, 'md2b the active roster is full (' || (st + bench) || ')');
  insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, 'c-98902', 'draft');
  perform md_true((select spot from native_roster where league_id = a and slug = 'c-98902') = 'devy', 'md2c …so the next college player lands on the shelf');
  insert into native_roster (league_id, roster_id, slug, spot, acquired) values (a, 2, 'c-98903', 'devy', 'draft');
  perform md_true((select spot from native_roster where league_id = a and slug = 'c-98903') = 'devy', 'md2d a row inserted AS devy (the rollover) stays devy, room or not');
  perform md_true(college_live_schools() @> array['98900'], 'md2e the worker polls the active college player''s school');

  -- ══ md3. OFF THE SHELF AND BACK ══════════════════════════════════════════
  perform md_err(set_roster_spot(a, 'c-98902', 'active'), 'active roster is full', 'md3 off the shelf needs an active seat');
  perform md_ok(set_roster_spot(a, 'c-98901', 'devy'), 'md3a an active college player goes to the shelf');
  perform md_true((select spot from native_roster where league_id = a and slug = 'c-98901') = 'devy', 'md3b …and is there');
  perform md_ok(set_roster_spot(a, 'c-98902', 'active'), 'md3c with his seat open the other comes off the shelf');
  perform md_err(set_roster_spot(a, 'md-QB-1', 'devy'), 'devy spots hold college players', 'md3d an NFL player never goes on it');

  -- ══ md4. LEGAL EITHER WAY ════════════════════════════════════════════════
  update draft set status = 'complete' where league_id = a;
  perform md_true(roster_illegal_reason(a, 1) is null, 'md4 a college player active in a mixed league is legal: ' || coalesce(roster_illegal_reason(a, 1), 'null'));

  -- ══ md5. THE CAPS: shelf full, NFL spot open ═════════════════════════════
  update native_roster set spot = 'devy' where league_id = a and slug = 'c-98901';
  update native_roster set spot = 'devy' where league_id = a and slug = 'c-98902';
  update draft set status = 'pending' where league_id = a;
  perform md_true(_devy_open(a, 1) = 0, 'md5 the shelf is full');
  perform md_true(devy_room_error(a, 1, 'c-98903') is null, 'md5a a third college player may take an NFL spot: ' || coalesce(devy_room_error(a, 1, 'c-98903'), 'null'));
  -- fill the NFL spots too
  k := (select rounds from draft where league_id = a) - _devy_slots(a);
  for i in 1 .. 6 loop
    foreach e in array array['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] loop
      if (select count(*) from native_roster where league_id = a and roster_id = 1 and spot <> 'devy') < k
         and not exists (select 1 from native_roster where league_id = a and slug = 'md-' || e || '-' || i) then
        insert into native_roster (league_id, roster_id, slug, acquired) values (a, 1, 'md-' || e || '-' || i, 'draft');
      end if;
    end loop;
  end loop;
  perform md_true(devy_room_error(a, 1, 'c-98903') like 'devy spots are full (2) and so is the NFL roster%', 'md5b both full: refused with both counts: ' || coalesce(devy_room_error(a, 1, 'c-98903'), 'null'));

  -- ══ md6. THE DEVY-ONLY LEAGUE KEEPS 0366 ═════════════════════════════════
  r := create_native_league('Devy Only', '2031', 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  b := (r ->> 'league_id')::uuid;
  perform md_ok(commish_setup_college(b, 'none', 1, 2, false), 'md6 a devy league with no college starting spots');
  perform md_true(not league_is_mixed(b), 'md6a is not mixed');
  perform md_ok(seed_league_pool(b, md_pool()), 'md6b seed');
  insert into native_roster (league_id, roster_id, slug, acquired) values (b, 1, 'c-98901', 'draft');
  perform md_true((select spot from native_roster where league_id = b and slug = 'c-98901') = 'devy', 'md6c a college player lands on the shelf');
  perform md_err(set_roster_spot(b, 'c-98901', 'active'), 'stays in a devy spot', 'md6d …and stays there');
  insert into native_roster (league_id, roster_id, slug, acquired) values (b, 1, 'c-98902', 'draft');
  perform md_true(devy_room_error(b, 1, 'c-98903') = 'devy spots are full — this league has 2', 'md6e the shelf full is the end of it');
  update native_roster set spot = 'active' where league_id = b and slug = 'c-98902';
  update draft set status = 'complete' where league_id = b;
  perform md_true(roster_illegal_reason(b, 1) like '%college player outside the devy spots%', 'md6f a college player outside the shelf is illegal there');
  update draft set status = 'pending' where league_id = b;
  update native_roster set spot = 'devy' where league_id = b and slug = 'c-98902';

  -- ══ md7. THE BUILDER MIXES A DEVY LEAGUE; THE BACKSTOP LETS THE SHELF JOIN ══
  r := set_league_classic_slots(b, _classic_slot_spec(b) || '[{"pos":["RB","WR","TE"],"level":"college","label":"COLLEGE"}]'::jsonb);
  perform md_ok(r, 'md7 the first college spot goes into a devy league');
  perform md_true(league_is_mixed(b), 'md7a …which is mixed now');
  perform md_ok(set_roster_spot(b, 'c-98901', 'active'), 'md7b …and its college player may come off the shelf');
  perform md_ok(set_league_roster_shape(b, (_roster_shape(b) ->> 'bench')::int, 0, 0, 0, 3), 'md7c more devy spots on a lineup with levels — the backstop allows it');
  perform md_true(jsonb_path_exists((select settings_json -> 'roster_slots' from league where id = b), '$[*] ? (@.level == "college")'), 'md7d the level survived');
  r := set_league_classic_slots(b, _classic_slot_spec(b) - (jsonb_array_length(_classic_slot_spec(b)) - 1));
  perform md_ok(r, 'md7e the college spot comes back out');
  perform md_true(not league_is_mixed(b), 'md7f …and the league is devy-only again');

  -- ══ md8. AUTOPICK FILLS AN OPEN COLLEGE STARTING SPOT ════════════════════
  -- Team 2 in the mixed league: every NFL starting spot filled, the college spot open.
  foreach e in array array['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'K', 'DEF'] loop
    i := 1;
    while exists (select 1 from native_roster where league_id = a and slug = 'md-' || e || '-' || i) loop i := i + 1; end loop;
    insert into native_roster (league_id, roster_id, slug, acquired) values (a, 2, 'md-' || e || '-' || i, 'draft');
  end loop;
  -- the flex (RB/WR/TE)
  i := 1; while exists (select 1 from native_roster where league_id = a and slug = 'md-RB-' || i) loop i := i + 1; end loop;
  insert into native_roster (league_id, roster_id, slug, acquired) values (a, 2, 'md-RB-' || i, 'draft');
  -- the college spot is a flex (RB/WR/TE): the college TE fits it, the college QB does not
  pick := native_autopick_slug(a, 2, (select rounds from draft where league_id = a));
  perform md_true(pick = 'c-98904', 'md8 with only the college spot open, autopick takes the college player who fits it: ' || coalesce(pick, 'null'));

  -- ══ md9. WHO MAY ═════════════════════════════════════════════════════════
  perform md_as('02');
  perform md_err(set_roster_spot(a, 'c-98901', 'active'), 'forbidden', 'md9 another manager cannot move my player');

  perform md_as('01');
  delete from league where id in (a, b);
  raise notice 'mixed-devy probes done';
end $$;

delete from college_player where espn_id in ('98901', '98902', '98903', '98904');
delete from college_school where school_id = '98900';
drop function if exists md_pool();

select 'ALL MIXED-DEVY PROBES PASSED' as result;
