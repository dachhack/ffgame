-- 0477 prizes-and-dues probes.
--   • prizes are a commissioner's list, bounded, trimmed, cleared by [];
--   • the league hears them; a contest league's info carries them with the dues;
--   • the board shows the prizes, and the dues setting when the listing's line is blank.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r; end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;
do $$
declare r jsonb; h uuid; code text; row jsonb;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  perform probe_as('a');
  r := create_contest_league('PZ League', 'high', 'h2h', 'season', 4, 50000);
  perform assert_ok(r, 'pz0 a contest league'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'pz0b b joins');
  perform assert_err(set_league_prizes(h, '[{"label":"1st","prize":"$100"}]'), 'commissioner', 'pz1 a member can''t set prizes');
  perform probe_as('a');
  perform assert_err(set_league_prizes(h, '{"1st":"$100"}'), 'list', 'pz2 prizes are a list');
  perform assert_err(set_league_prizes(h, (select jsonb_agg(jsonb_build_object('label', 'p' || i, 'prize', '$1')) from generate_series(1, 9) i)), 'eight', 'pz3 up to eight');
  r := set_league_prizes(h, '[{"label":" 1st ","prize":" $150 "},{"label":"2nd","prize":"$50"},{"label":"","prize":"nothing"},{"label":"Weekly high","prize":""}]');
  perform assert_ok(r, 'pz4 set');
  perform assert_true(r -> 'prizes' = '[{"label":"1st","prize":"$150"},{"label":"2nd","prize":"$50"}]'::jsonb, 'pz4b trimmed, blanks dropped');
  perform assert_true(exists (select 1 from league_message where league_id = h and txn ->> 'kind' = 'prizes' and body like '🏆 Prizes: 1st — $150 · 2nd — $50%'), 'pz5 the league hears the prizes');
  perform assert_ok(set_league_dues(h, 50, 'Venmo @a by week 1'), 'pz6 dues');
  r := contest_league(h);
  perform assert_true(r -> 'bullseye' -> 'prizes' = '[{"label":"1st","prize":"$150"},{"label":"2nd","prize":"$50"}]'::jsonb
                  and (r -> 'bullseye' ->> 'dues_amount')::int = 50 and r -> 'bullseye' ->> 'dues_note' = 'Venmo @a by week 1', 'pz7 the league info carries the money');
  perform assert_ok(post_league_listing(h, 'come play', null), 'pz8 posted to the board with no dues line');
  select x into row from jsonb_array_elements(league_board()) x where x ->> 'league_id' = h::text;
  perform assert_true(row ->> 'dues' = '$50 — Venmo @a by week 1', 'pz9 the board falls back to the dues setting');
  perform assert_true(jsonb_array_length(row -> 'prizes') = 2 and row -> 'prizes' -> 0 ->> 'prize' = '$150', 'pz9b and shows the prizes');
  perform assert_ok(post_league_listing(h, null, 'twenty bucks, cash'), 'pz10 a listing line of its own');
  select x into row from jsonb_array_elements(league_board()) x where x ->> 'league_id' = h::text;
  perform assert_true(row ->> 'dues' = 'twenty bucks, cash', 'pz10b the listing''s own line wins');
  perform assert_ok(set_league_prizes(h, '[]'), 'pz11 cleared');
  perform assert_true((contest_league(h) -> 'bullseye' -> 'prizes') = '[]'::jsonb, 'pz11b gone');
end $$;
select 'ALL CONTEST-PRIZES PROBES PASSED' as result;
