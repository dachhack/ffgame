-- 0365 probes: COLLEGE PLAYERS, PHASE 1.
--
--   • the worker's batch writes the directory, drops non-fantasy positions and
--     bad ids, never blanks a known value with a null, and follows a transfer;
--   • finish_college_sweep retires exactly the players a sweep did not see;
--   • only the service role may write the directory; signed-in users read it;
--   • league_pool.level is GENERATED from the slug: c-<digits> is college,
--     c-smith is not, and a pool copy that drops espn_id keeps the level;
--   • COLLEGE is an admin position group, refused on a Drip league, and a
--     league holding it cannot go to Drip — by RPC or by any other write;
--   • seed_league_pool takes college rows only where COLLEGE is on, and takes
--     their espn_id from the slug;
--   • league_pool_college serves school and class to members only.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function cp_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cp_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cp_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000036' || u, false); perform set_config('app.email', 'cp' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003601', 'cp01@test.dev'),
  ('00000000-0000-0000-0000-000000003602', 'cp02@test.dev'),
  ('00000000-0000-0000-0000-000000003603', 'cp03@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000003601', 'cp01@test.dev'),
  ('00000000-0000-0000-0000-000000003602', 'cp02@test.dev'),
  ('00000000-0000-0000-0000-000000003603', 'cp03@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000003601', '00000000-0000-0000-0000-000000003602',
              '00000000-0000-0000-0000-000000003603');
-- 01 is the admin and the commissioner; 02 a member; 03 a stranger.
insert into app_admin (email, note) values ('cp01@test.dev', 'college probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; drip_lid uuid; code text; t0 timestamptz; boom boolean;
begin
  -- ══ cp1. THE DIRECTORY ═══════════════════════════════════════════════════
  r := upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '93601', 'full_name', 'College Qb', 'pos', 'QB', 'espn_pos', 'QB',
      'school_id', '333', 'school', 'Alabama Crimson Tide', 'school_abbr', 'ALA',
      'class_year', 3, 'class_label', 'JR', 'jersey', '7'),
    jsonb_build_object('espn_id', '93602', 'full_name', 'College Edge', 'pos', 'DL', 'espn_pos', 'EDGE',
      'school_id', '57', 'school', 'Florida Gators', 'school_abbr', 'FLA', 'class_year', 2, 'class_label', 'SO'),
    jsonb_build_object('espn_id', '93603', 'full_name', 'Big Lineman', 'pos', 'OL'),
    jsonb_build_object('espn_id', 'abc', 'full_name', 'Bad Id', 'pos', 'RB'),
    jsonb_build_object('espn_id', '93604', 'full_name', '  ', 'pos', 'RB')));
  perform cp_ok(r, 'cp1 upsert');
  perform cp_true((r ->> 'rows')::int = 2, 'cp1 two rows: lineman, bad id and blank name dropped');
  perform cp_true(not exists (select 1 from college_player where espn_id in ('93603', '93604')),
    'cp1 dropped rows are not stored');

  -- A later batch missing the class must not blank it; a new school is a transfer.
  perform upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '93601', 'full_name', 'College Qb', 'pos', 'QB',
      'school_id', '2', 'school', 'Auburn Tigers', 'school_abbr', 'AUB')));
  perform cp_true((select class_label = 'JR' and class_year = 3 and jersey = '7' from college_player where espn_id = '93601'),
    'cp1a a missing column keeps what we had');
  perform cp_true((select school_abbr = 'AUB' and school_id = '2' from college_player where espn_id = '93601'),
    'cp1b a transfer moves him to the new school');

  -- ══ cp2. RETIREMENT ══════════════════════════════════════════════════════
  update college_player set seen_at = now() - interval '2 days' where espn_id = '93602';
  t0 := now() - interval '1 day';
  r := finish_college_sweep(t0);
  perform cp_ok(r, 'cp2 finish');
  perform cp_true((select not active from college_player where espn_id = '93602'), 'cp2 an unseen player is retired');
  perform cp_true((select active from college_player where espn_id = '93601'), 'cp2a a seen player stays active');
  perform cp_true(exists (select 1 from college_player where espn_id = '93602'), 'cp2b retired, not deleted');

  -- ══ cp3. WHO MAY WRITE ═══════════════════════════════════════════════════
  perform cp_true(not has_function_privilege('authenticated', 'upsert_college_players(jsonb)', 'execute'),
    'cp3 a signed-in user cannot write the directory');
  perform cp_true(not has_function_privilege('authenticated', 'finish_college_sweep(timestamptz)', 'execute'),
    'cp3a nor retire from it');
  perform cp_true(has_function_privilege('service_role', 'upsert_college_players(jsonb)', 'execute'),
    'cp3b the worker can');

  -- ══ cp4. THE GATE ════════════════════════════════════════════════════════
  perform cp_as('01');
  r := create_native_league('College', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform cp_ok(r, 'cp4 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  r := create_native_league('College Drip', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'drip');
  perform cp_ok(r, 'cp4 drip league'); drip_lid := (r ->> 'league_id')::uuid;
  perform cp_as('02'); perform cp_ok(native_join(code, 'CP-2'), 'cp4 member joins'); perform cp_as('01');

  r := set_league_position_access(drip_lid, '["COLLEGE"]'::jsonb);
  perform cp_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'college players need a classic league',
    'cp4a COLLEGE is refused on a Drip league');
  perform cp_ok(set_league_position_access(drip_lid, '["IDP"]'::jsonb), 'cp4b the other groups still work there');

  -- Before COLLEGE is on, a college row is quietly skipped by the seed.
  r := seed_league_pool(lid, '[
    {"slug":"c-93601","full":"College Qb","pos":"QB"},
    {"slug":"nfl-guy","full":"Nfl Guy","pos":"WR","team":"BUF","espn_id":"1234"}]'::jsonb);
  perform cp_true((r ->> 'players')::int = 1, 'cp4c without COLLEGE the seed skips college rows');

  r := set_league_position_access(lid, '["college","IDP"]'::jsonb);
  perform cp_ok(r, 'cp4d COLLEGE turns on for a classic league (case-insensitive)');
  perform cp_true((r -> 'positions') @> '["COLLEGE","IDP"]'::jsonb, 'cp4d with the other groups kept');

  -- ══ cp5. NEVER DRIP ══════════════════════════════════════════════════════
  r := set_league_game_mode(lid, 'drip');
  perform cp_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'a league with college players stays classic',
    'cp5 the RPC refuses Drip');
  boom := false;
  begin
    update league set settings_json = settings_json || '{"game_mode":"drip"}'::jsonb where id = lid;
  exception when others then boom := true;
  end;
  perform cp_true(boom, 'cp5a THE BACKSTOP: a raw settings write cannot make it Drip either');
  perform cp_true((select settings_json ->> 'game_mode' from league where id = lid) = 'classic', 'cp5b still classic');
  boom := false;
  begin
    update league set settings_json = settings_json || '{"positions_extra":["COLLEGE"]}'::jsonb where id = drip_lid;
  exception when others then boom := true;
  end;
  perform cp_true(boom, 'cp5c nor can a raw write put COLLEGE on a Drip league');

  -- ══ cp6. THE SEED AND THE LEVEL ══════════════════════════════════════════
  r := seed_league_pool(lid, '[
    {"slug":"c-93601","full":"College Qb","pos":"QB","espn_id":"99999"},
    {"slug":"c-93602","full":"College Edge","pos":"DL"},
    {"slug":"c-smith","full":"C. Smith","pos":"RB","team":"KC"},
    {"slug":"nfl-guy","full":"Nfl Guy","pos":"WR","team":"BUF","espn_id":"1234"}]'::jsonb);
  perform cp_ok(r, 'cp6 seed');
  perform cp_true((r ->> 'players')::int = 4, 'cp6 all four land once COLLEGE is on');
  perform cp_true((select level from league_pool where league_id = lid and slug = 'c-93601') = 'college',
    'cp6a c-<digits> is college');
  perform cp_true((select espn_id from league_pool where league_id = lid and slug = 'c-93601') = '93601',
    'cp6b a college row''s espn_id comes from its slug, not the payload');
  perform cp_true((select level from league_pool where league_id = lid and slug = 'c-smith') = 'nfl',
    'cp6c THE NAME TRAP: an NFL "C. Smith" is not college');
  perform cp_true((select level from league_pool where league_id = lid and slug = 'nfl-guy') = 'nfl', 'cp6d NFL is NFL');

  -- A copy that names its columns and drops espn_id (the practice room's shape)
  -- keeps the level, because nobody writes it.
  insert into league_pool (league_id, slug, full_name, pos, team, rank)
    select drip_lid, slug, full_name, pos, team, rank from league_pool where league_id = lid and slug = 'c-93602';
  perform cp_true((select level from league_pool where league_id = drip_lid and slug = 'c-93602') = 'college',
    'cp6e a pool copy without espn_id keeps the level');
  delete from league_pool where league_id = drip_lid;
  boom := false;
  begin
    insert into league_pool (league_id, slug, full_name, pos, team, rank, level)
      values (lid, 'c-1', 'X', 'QB', '', 99, 'nfl');
  exception when others then boom := true;
  end;
  perform cp_true(boom, 'cp6f nobody can write the level by hand');

  -- ══ cp7. THE READER ══════════════════════════════════════════════════════
  r := league_pool_college(lid);
  perform cp_ok(r, 'cp7 commissioner reads');
  perform cp_true((r -> 'players' -> 'c-93601' ->> 'school_abbr') = 'AUB'
    and (r -> 'players' -> 'c-93601' ->> 'class_label') = 'JR', 'cp7a school and class from the directory');
  perform cp_true((r -> 'players' -> 'c-93602' ->> 'active')::boolean is false, 'cp7b a retired player reads inactive');
  perform cp_true(not (r -> 'players' ? 'nfl-guy') and not (r -> 'players' ? 'c-smith'), 'cp7c NFL rows are not listed');
  perform cp_as('02'); perform cp_ok(league_pool_college(lid), 'cp7d a member reads');
  perform cp_as('03');
  r := league_pool_college(lid);
  perform cp_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'forbidden', 'cp7e a stranger may not');
  perform cp_as('01');

  -- Turning COLLEGE off frees the league to go back to Drip.
  perform cp_ok(set_league_position_access(lid, '["IDP"]'::jsonb), 'cp8 COLLEGE off');
  perform cp_true((select not (settings_json -> 'positions_extra' @> '["COLLEGE"]'::jsonb) from league where id = lid),
    'cp8a and it is gone from settings');

  delete from league_pool where league_id = lid;
  delete from college_player where espn_id like '936%';
  raise notice 'college probes done';
end $$;

select 'ALL COLLEGE PROBES PASSED' as result;
