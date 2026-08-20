-- 0205 identity probes: a player is an id, not a name.
--
--   • the pool stores a Sleeper id, and it survives a seed;
--   • the SAME person cannot occupy two rows in one league — the mirror of the
--     bug this fixes;
--   • but the same ID may appear in DIFFERENT leagues, which is normal;
--   • a team pseudo-player has no id and is not forced to invent one, and
--     several of them coexist rather than colliding on a blank;
--   • an empty-string id becomes NULL, or the partial unique index would fire
--     on the second team unit;
--   • two people whose names collapse to one slug both survive, because the
--     client renames the loser — the row the old code dropped;
--   • and `league_pool_ids` serves the map to members and nobody else.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; lid2 uuid; code text; boom boolean;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a',
                 '00000000-0000-0000-0000-00000000000b',
                 '00000000-0000-0000-0000-00000000000c');
  perform probe_as('a');

  r := create_native_league('Ident', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'id0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'ID-B'), 'id0a join'); perform probe_as('a');

  -- ══ THE ID IS STORED AND SURVIVES A SEED ═════════════════════════════════
  r := seed_league_pool(lid, '[
    {"slug":"byron-young","full":"Byron Young","pos":"LB","team":"LA","sleeper_id":"9001"},
    {"slug":"byron-young-9002","full":"Byron Young","pos":"DL","team":"PHI","sleeper_id":"9002"},
    {"slug":"la-dst","full":"LA D/ST","pos":"DEF","team":"LA"},
    {"slug":"la-k","full":"LA Kicker","pos":"K","team":"LA","sleeper_id":""}
  ]'::jsonb);
  perform assert_ok(r, 'id1 seeded');
  perform assert_true((select sleeper_id from league_pool where league_id = lid and slug = 'byron-young') = '9001',
    'id1a the id is stored');

  -- THE ROW THE OLD CODE DROPPED. Both Byron Youngs are here, distinguished by
  -- a slug the client disambiguated with the losing player's own Sleeper id.
  perform assert_true((select count(*) from league_pool
    where league_id = lid and full_name = 'Byron Young') = 2,
    'id2 two people with one name BOTH survive');
  perform assert_true((select pos from league_pool where league_id = lid and slug = 'byron-young-9002') = 'DL',
    'id2a …and the renamed one keeps his own position, not the other man''s');

  -- ══ A TEAM UNIT HAS NO ID, AND IS NOT MADE TO INVENT ONE ═════════════════
  perform assert_true((select sleeper_id from league_pool where league_id = lid and slug = 'la-dst') is null,
    'id3 a defence has no Sleeper id');
  -- '' must become NULL: the unique index is partial, so two empty strings
  -- would collide the moment a league had two team units.
  perform assert_true((select sleeper_id from league_pool where league_id = lid and slug = 'la-k') is null,
    'id3a an empty id is stored as NULL, not as an empty string');
  perform assert_true((select count(*) from league_pool
    where league_id = lid and sleeper_id is null) = 2,
    'id3b …so several team units coexist rather than colliding on a blank');

  -- ══ THE SAME PERSON TWICE IN ONE POOL IS REFUSED ═════════════════════════
  -- The mirror of the bug being fixed: a name may repeat, an identity may not.
  boom := false;
  begin
    insert into league_pool (league_id, slug, full_name, pos, team, rank, sleeper_id)
    values (lid, 'byron-young-dupe', 'Byron Young', 'LB', 'LA', 999, '9001');
  exception when unique_violation then boom := true;
  end;
  perform assert_true(boom, 'id4 the same Sleeper id cannot occupy two rows in one league');

  -- …but the same person in ANOTHER league is entirely normal.
  r := create_native_league('Ident2', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'id5 second league'); lid2 := (r ->> 'league_id')::uuid;
  r := seed_league_pool(lid2, '[{"slug":"byron-young","full":"Byron Young","pos":"LB","team":"LA","sleeper_id":"9001"}]'::jsonb);
  perform assert_ok(r, 'id5a seeded');
  perform assert_true((select count(*) from league_pool where sleeper_id = '9001') = 2,
    'id5b the same player belongs to two leagues at once, which is the point of a league');

  -- ══ THE MAP, AND WHO MAY READ IT ═════════════════════════════════════════
  r := league_pool_ids(lid);
  perform assert_ok(r, 'id6 members read the map');
  perform assert_true((r -> 'ids' ->> 'byron-young') = '9001', 'id6a it maps slug to id');
  perform assert_true((r -> 'ids' ->> 'byron-young-9002') = '9002',
    'id6b …including the disambiguated slug, which is the whole reason it exists');
  perform assert_true(not (r -> 'ids' ? 'la-dst'),
    'id6c a team unit is absent rather than mapped to null');

  perform probe_as('b');
  perform assert_ok(league_pool_ids(lid), 'id7 an ordinary member may read it too');
  perform probe_as('c');
  r := league_pool_ids(lid);
  perform assert_true((r ->> 'ok')::boolean is false and r ->> 'error' = 'forbidden',
    'id7a a stranger may not');
  perform probe_as('a');

  delete from league_pool where league_id in (lid, lid2);
  raise notice 'identity probes done';
end $$;

select 'ALL IDENTITY PROBES PASSED' as result;
