-- 0446 bullseye probes — docs/bullseye.md §6 (10, 11) and §7.
--
--   • bullseye is CLASSIC-only, commissioner-only, and freezes at the draft;
--   • it is slots, total or off, with a bounded radius, and clears cleanly;
--   • it refuses golf and golf refuses it;
--   • league_game_mode carries it to the screens;
--   • the card table is league-readable and nobody but the service role deals;
--   • the week board ranks every team's final, highest first, ties shared;
--   • a league that never opens the setting is untouched.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

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
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; nlid uuid; code text; a_seat int; b_seat int; st jsonb; gm jsonb;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
    ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000c');
  perform probe_as('a');

  -- ══ THE SETTING (§6.10) ══════════════════════════════════════════════════
  r := create_native_league('Bullseye', '2024', 2, 8, 60);   -- drip to start
  perform assert_ok(r, 'be0 a drip league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform assert_err(set_league_bullseye(lid, 'slots'), 'classic-league setting',
    'be1 bullseye is a classic setting — a drip league has no starter points to aim');
  perform assert_true(league_bullseye(lid) is null, 'be1a and it is off by default');
  perform probe_as('b'); perform assert_ok(native_join(code, 'BE-B'), 'be1b join'); perform probe_as('a');
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"game_mode":"classic"}'::jsonb
    where id = lid;
  perform assert_ok(set_league_bullseye(lid, 'slots'), 'be2 the commissioner turns it on');
  perform assert_true(league_bullseye(lid) = 'slots', 'be2a …and it reads back');
  gm := league_game_mode(lid);
  perform assert_true(gm ->> 'bullseye' = 'slots' and (gm -> 'bullseye_radius') = 'null'::jsonb,
    'be2b the screens can see it, with no radius override');
  perform assert_ok(set_league_bullseye(lid, 'total', 25), 'be3 total, radius 25');
  perform assert_true(league_bullseye(lid) = 'total' and (league_game_mode(lid) ->> 'bullseye_radius')::int = 25,
    'be3a …both stored');
  perform assert_err(set_league_bullseye(lid, 'total', 1), '2-50', 'be3b the radius is bounded below');
  perform assert_err(set_league_bullseye(lid, 'total', 51), '2-50', 'be3c …and above');
  perform assert_err(set_league_bullseye(lid, 'darts'), 'slots, total, hybrid or off', 'be3d an unknown variant is refused');
  -- THE KNOBS (0448)
  perform assert_ok(set_league_bullseye(lid, 'hybrid'), 'be3e hybrid is a variant');
  perform assert_true(league_bullseye(lid) = 'hybrid', 'be3f …and reads back');
  r := set_league_bullseye(lid, 'hybrid', null, 'fixed', 'team');
  perform assert_ok(r, 'be3g rings + deal store');
  perform assert_true(r ->> 'rings' = 'fixed' and r ->> 'deal' = 'team', 'be3h …and echo');
  gm := league_game_mode(lid);
  perform assert_true(gm ->> 'bullseye_rings' = 'fixed' and gm ->> 'bullseye_deal' = 'team' and (gm ->> 'bullseye_radius')::int = 25,
    'be3i the screens see all three knobs; a null keeps the radius');
  perform assert_err(set_league_bullseye(lid, 'hybrid', null, 'round'), 'continuous or fixed', 'be3j bad rings refused');
  perform assert_err(set_league_bullseye(lid, 'hybrid', null, null, 'each'), 'shared or team', 'be3k bad deal refused');
  perform assert_ok(set_league_bullseye(lid, 'hybrid', null, 'continuous', 'shared'), 'be3l …and back');
  perform probe_as('b');
  perform assert_err(set_league_bullseye(lid, 'slots'), 'commissioner only', 'be4 a member cannot set it');
  perform probe_as('a');

  -- ══ GOLF AND BULLSEYE REFUSE EACH OTHER ═════════════════════════════════
  perform assert_err(set_league_golf(lid, true), 'cannot both be on', 'be5 golf is refused while bullseye is on');
  perform assert_ok(set_league_bullseye(lid, 'off'), 'be5a off clears it');
  perform assert_true(league_bullseye(lid) is null and (league_game_mode(lid) -> 'bullseye') = 'null'::jsonb
    and not ((select settings_json from league where id = lid) ? 'bullseye_radius')
    and not ((select settings_json from league where id = lid) ? 'bullseye_rings')
    and not ((select settings_json from league where id = lid) ? 'bullseye_deal'),
    'be5b …the keys are gone, radius, rings and deal included');
  perform assert_ok(set_league_golf(lid, true), 'be5c golf goes on once bullseye is off');
  perform assert_err(set_league_bullseye(lid, 'slots'), 'cannot both be on', 'be5d bullseye is refused while golf is on');
  perform assert_ok(set_league_golf(lid, false), 'be5e golf off');
  perform assert_ok(set_league_bullseye(lid, null), 'be5f null is off too');
  perform assert_ok(set_league_bullseye(lid, 'SLOTS'), 'be5g case-blind');
  perform assert_true(league_bullseye(lid) = 'slots', 'be5h …stored lower');

  -- ══ FROZEN AT THE DRAFT ═════════════════════════════════════════════════
  update draft set status = 'live' where league_id = lid;
  perform assert_err(set_league_bullseye(lid, 'total'), 'locks once the draft starts', 'be6 the draft freezes it');
  perform assert_err(set_league_bullseye(lid, 'off'), 'locks once the draft starts', 'be6a …off included');
  update draft set status = 'pending' where league_id = lid;

  -- ══ THE CARD TABLE (§7) ═════════════════════════════════════════════════
  -- The worker (service role) deals; this probe plays the worker.
  insert into bullseye_card (league_id, week, slot, target) values
    (lid, 3, 'S1', 20), (lid, 3, 'S2', 10), (lid, 3, 'TOTAL', 30);
  -- …and, under a per-team deal (0448), a card per roster beside it.
  insert into bullseye_card (league_id, week, roster_id, slot, target) values
    (lid, 3, 1, 'S1', 5), (lid, 3, 1, 'S2', 15), (lid, 3, 1, 'TOTAL', 20);
  r := bullseye_card(lid, 3);
  perform assert_ok(r, 'be7 a member reads the card');
  perform assert_true(jsonb_array_length(r -> 'card') = 6 and r ->> 'bullseye' = 'slots', 'be7a every row, with the setting');
  perform assert_true((r -> 'card' -> 2 ->> 'slot') = 'TOTAL' and (r -> 'card' -> 2 ->> 'roster_id')::int = 0
    and (r -> 'card' -> 5 ->> 'slot') = 'TOTAL' and (r -> 'card' -> 5 ->> 'roster_id')::int = 1,
    'be7b the shared card first, each card''s TOTAL row last, roster ids carried');
  perform assert_true(jsonb_array_length(bullseye_card(lid, 4) -> 'card') = 0, 'be7c an undealt week is empty, not an error');
  perform probe_as('b');
  perform assert_ok(bullseye_card(lid, 3), 'be7d the other member reads it too');
  perform probe_as('c');
  perform assert_err(bullseye_card(lid, 3), 'forbidden', 'be7e a stranger cannot');
  -- (The table's own RLS is not probed here: the scratch runner is superuser
  -- and bypasses it; the reader above is the path every client takes.)
  perform probe_as('a');
  -- A dealt card never changes: the worker's upsert is ON CONFLICT DO NOTHING.
  insert into bullseye_card (league_id, week, slot, target) values (lid, 3, 'S1', 5)
    on conflict (league_id, week, roster_id, slot) do nothing;
  perform assert_true((select target from bullseye_card where league_id = lid and week = 3 and roster_id = 0 and slot = 'S1') = 20,
    'be7g a re-deal leaves the card as dealt');

  -- ══ THE WEEK BOARD (§6.11) ══════════════════════════════════════════════
  select sleeper_roster_id into a_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (gen_random_uuid(), lid, 3, a_seat, b_seat, 'final', 61.5, 88);
  st := bullseye_week_board(lid, 3);
  perform assert_ok(st, 'be8 the week board reads');
  perform assert_true(jsonb_array_length(st -> 'board') = 2, 'be8a both teams');
  perform assert_true((st -> 'board' -> 0 ->> 'roster_id')::int = b_seat and (st -> 'board' -> 0 ->> 'rank')::int = 1
    and (st -> 'board' -> 0 ->> 'final')::numeric = 88, 'be8b highest ring total first');
  perform assert_true((st -> 'board' -> 1 ->> 'roster_id')::int = a_seat and (st -> 'board' -> 1 ->> 'rank')::int = 2, 'be8c then the other');
  perform assert_true(jsonb_array_length(bullseye_week_board(lid, 4) -> 'board') = 0, 'be8d a week with no finals is empty');
  -- Standings are untouched: higher wins, as always.
  st := league_standings(lid);
  perform assert_true((select (e ->> 'wins')::int from jsonb_array_elements(st) e where (e ->> 'roster_id')::int = b_seat) = 1,
    'be8e the 88 is a win in the standings');
  perform probe_as('c');
  perform assert_err(bullseye_week_board(lid, 3), 'forbidden', 'be8f a stranger cannot read the board');
  -- ══ ACROSS LEAGUES (0447) ═══════════════════════════════════════════════
  -- Counted by OUR rows (a re-run of this suite leaves an earlier league's
  -- finals on the same board; the real runner never repeats a suite).
  st := bullseye_global_board(3);
  perform assert_ok(st, 'be8g a signed-in stranger reads the global board');
  perform assert_true((select count(*) from jsonb_array_elements(st -> 'board') e where e ->> 'team' = 'BE-B') >= 1,
    'be8h the bullseye league''s teams are on it');
  perform assert_true((select bool_and((e -> 'league') = 'null'::jsonb and (e ->> 'mine')::boolean = false and not e ? 'roster_id')
                        from jsonb_array_elements(st -> 'board') e),
    'be8i …league unnamed to a stranger, nothing marked mine, roster ids never leave');
  perform assert_true((select min((e ->> 'rank')::int) from jsonb_array_elements(st -> 'board') e where e ->> 'team' = 'BE-B')
                      < (select min((e ->> 'rank')::int) from jsonb_array_elements(st -> 'board') e where (e ->> 'final')::numeric = 61.5),
    'be8j ranked by ring total, highest first');
  perform probe_as('a');
  st := bullseye_global_board(3);
  perform assert_true((select bool_and(e ->> 'league' = 'Bullseye') from jsonb_array_elements(st -> 'board') e where e ->> 'team' = 'BE-B' or (e ->> 'mine')::boolean)
                      and (select count(*) from jsonb_array_elements(st -> 'board') e where (e ->> 'mine')::boolean) >= 1,
    'be8k a member sees the league named and their own row marked');
  perform assert_true(jsonb_array_length(bullseye_global_board(4) -> 'board') = 0, 'be8l a week with no finals is empty');

  -- ══ A LEAGUE THAT NEVER OPENS THE SETTING ═══════════════════════════════
  r := create_native_league('Not Bullseye', '2024', 2, 8, 60);
  perform assert_ok(r, 'be9 a second league'); nlid := (r ->> 'league_id')::uuid;
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"game_mode":"classic"}'::jsonb
    where id = nlid;
  perform assert_true(league_bullseye(nlid) is null and (league_game_mode(nlid) -> 'bullseye') = 'null'::jsonb,
    'be9a it plays normally');
  perform assert_ok(set_league_golf(nlid, true), 'be9b …and may still play golf');
  st := bullseye_global_board(3);
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (gen_random_uuid(), nlid, 3, 1, 2, 'final', 150, 140);
  perform assert_true(jsonb_array_length(bullseye_global_board(3) -> 'board') = jsonb_array_length(st -> 'board'),
    'be9c …and its finals never reach the bullseye board');

  raise notice 'bullseye probes done';
end $$;

select 'ALL BULLSEYE PROBES PASSED' as result;
