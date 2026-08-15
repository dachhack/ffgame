-- 0162 auto-playoffs probes: the season closes itself.
--
-- What must hold:
--   • the AUTO path is member-callable but refuses while the regular season
--     is unfinished (draft pending, or any non-final game);
--   • once every regular-season game is final, a member's seedless poke
--     builds round 1 from the standings;
--   • a second poke does NOT regenerate (the commissioner's bracket is safe);
--   • the commissioner's explicit-seed path still works and still refuses
--     for members.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
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
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Auto Playoffs League', '2026', 4, 7, 60);
  perform assert_ok(r, 'ap0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'AP-C'), 'ap1 c joins');

  -- auto path: member refused while the draft is pending
  perform assert_err(generate_playoffs(lid, null, true), 'not finished', 'ap2 auto refused pre-draft');
  -- member never gets the seeded path
  perform assert_err(generate_playoffs(lid, '[1,2,3,4]'::jsonb), 'forbidden', 'ap3 member cannot seed');

  -- finish the season: draft complete + two FINAL regular-season games
  reset role;
  update draft set status = 'complete' where league_id = lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 1, 1, 2, 'final', 100, 90),
    (lid, 1, 3, 4, 'final', 80, 70);
  set local role authenticated;

  -- with one game still live, auto refuses
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (lid, 2, 1, 3, 'live');
  set local role authenticated;
  perform probe_as('c');
  perform assert_err(generate_playoffs(lid, null, true), 'not finished', 'ap4 auto waits for the last game');
  reset role;
  update matchup set status = 'final', home_final = 50, away_final = 40
    where league_id = lid and week = 2;
  set local role authenticated;

  -- season over: the member's poke builds round 1
  perform probe_as('c');
  r := generate_playoffs(lid, null, true);
  perform assert_ok(r, 'ap5 auto-generates once the season is final');
  perform assert_true(exists (select 1 from matchup where league_id = lid and is_playoff), 'ap6 playoff matchups exist');

  -- a second poke leaves the bracket alone
  r := generate_playoffs(lid, null, true);
  perform assert_ok(r, 'ap7 second poke is a no-op');
  perform assert_true((r ->> 'generated') = 'false', 'ap8 no-op reported (got ' || r::text || ')');

  -- the commissioner can still regenerate with explicit seeds
  perform probe_as('b');
  perform assert_ok(generate_playoffs(lid, (select jsonb_agg(to_jsonb(x)) from unnest(array[2,1,4,3]) x)), 'ap9 commish seed override still works');
  reset role;
end $$;

select 'ALL AUTO-PLAYOFFS PROBES PASSED' as result;
