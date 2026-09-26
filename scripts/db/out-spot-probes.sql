-- 0307 probes: TWO KINDS OF INJURED SPOT — OUT beside IR.
--
-- What must hold:
--   • the shape takes an OUT count (5-arg setter); the 4-arg setter still
--     works and leaves OUT where it is; both shelves are stash_slots;
--   • league_out_tags defaults to O/D; set_out_rules narrows/widens with the
--     report's vocabulary only, refuses an empty list, and the IR list is
--     untouched by it;
--   • set_roster_spot 'out' takes only players on the OUT list, up to OUT's
--     cap, and IR keeps its own list and cap — a player can be right for one
--     shelf and wrong for the other;
--   • an OUT player is stashed (spot <> 'active') like any other;
--   • after the draft OUT spots can be added, and one someone stands in
--     cannot be removed;
--   • roster_rules carries out_tags beside ir_tags.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
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
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;

do $$
declare r jsonb; lid uuid; code text; a_seat int; b_seat int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
    ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000b');
  perform probe_as('a');

  r := create_native_league('Out And IR', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'os0 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'OS-B'), 'os0a join'); perform probe_as('a');
  perform assert_ok(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'os0b a three-spot lineup');

  -- ══ THE SHAPE TAKES AN OUT COUNT ═════════════════════════════════════════
  r := set_league_roster_shape(lid, 2, 0, 1, 2);
  perform assert_ok(r, 'os1 bench 2 · IR 1 · OUT 2');
  perform assert_true(r -> 'shape' = '{"bench": 2, "taxi": 0, "ir": 1, "out": 2}'::jsonb, 'os1a the shape carries OUT: ' || (r -> 'shape')::text);
  perform assert_true((r ->> 'rounds')::int = 8 and (r ->> 'draft_rounds')::int = 5, 'os1b roster 8, draft 5 — neither shelf is a round: ' || r::text);
  perform assert_true((select stash_slots from draft where league_id = lid) = 3, 'os1c stash_slots counts both shelves');
  perform assert_true((select rounds from draft where league_id = lid) = 8, 'os1d draft.rounds is the roster');
  -- the four-argument form an older build calls: OUT stays put
  r := set_league_roster_shape(lid, 3, 0, 1);
  perform assert_ok(r, 'os2 the 4-arg setter still works');
  perform assert_true(r -> 'shape' = '{"bench": 3, "taxi": 0, "ir": 1, "out": 2}'::jsonb, 'os2a …and leaves OUT where it was: ' || (r -> 'shape')::text);
  perform assert_true((league_game_mode(lid) -> 'shape' ->> 'out')::int = 2, 'os2b the game-mode read carries it');

  -- ══ THE LISTS ═══════════════════════════════════════════════════════════
  perform assert_true(league_out_tags(lid) = array['O', 'D'], 'os3 OUT defaults to O/D');
  perform assert_true(league_ir_tags(lid) = array['IR', 'O'], 'os3a IR''s default is untouched');
  perform assert_err(set_out_rules(lid, array['PUP']), 'O, D, Q and IR', 'os3b a tag the report never emits is refused');
  perform assert_err(set_out_rules(lid, array[]::text[]), 'at least one designation', 'os3c an empty list is refused');
  perform assert_ok(set_out_rules(lid, array['o', 'd', 'q']), 'os3d OUT widens to Q');
  perform assert_true(league_out_tags(lid) = array['O', 'D', 'Q'], 'os3e stored uppercase, in order');
  perform assert_true(league_ir_tags(lid) = array['IR', 'O'], 'os3f …without touching IR');
  perform assert_ok(set_ir_rules(lid, array['IR']), 'os3g the commissioner narrows IR to season-ending');
  perform assert_true(league_out_tags(lid) = array['O', 'D', 'Q'], 'os3h …without touching OUT');
  perform assert_true(roster_rules(lid) -> 'out_tags' = '["O","D","Q"]'::jsonb and roster_rules(lid) -> 'ir_tags' = '["IR"]'::jsonb,
    'os3i roster_rules carries both lists');
  perform probe_as('b');
  perform assert_err(set_out_rules(lid, array['O']), 'commissioner only', 'os3j a member cannot set it');
  perform probe_as('a');

  -- ══ THE PLAYERS ═════════════════════════════════════════════════════════
  perform seed_league_pool(lid, '[
    {"slug":"os-out","full":"Out Guy","pos":"RB","team":"KC","exp":3},
    {"slug":"os-doubt","full":"Doubtful Guy","pos":"RB","team":"KC","exp":3},
    {"slug":"os-quest","full":"Questionable Guy","pos":"WR","team":"KC","exp":3},
    {"slug":"os-ir","full":"IR Guy","pos":"WR","team":"KC","exp":3},
    {"slug":"os-fit","full":"Fit Guy","pos":"WR","team":"KC","exp":3}]'::jsonb);
  insert into injury_status (player_slug, status) values
    ('os-out', 'O'), ('os-doubt', 'D'), ('os-quest', 'Q'), ('os-ir', 'IR')
  on conflict (player_slug) do update set status = excluded.status;
  select sleeper_roster_id into b_seat from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  select sleeper_roster_id into a_seat from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, b_seat, 'os-out', 'draft'), (lid, b_seat, 'os-doubt', 'draft'), (lid, b_seat, 'os-quest', 'draft'),
    (lid, b_seat, 'os-ir', 'draft'), (lid, b_seat, 'os-fit', 'draft');
  perform probe_as('b');

  -- ══ TWO SHELVES, TWO LISTS ═══════════════════════════════════════════════
  perform assert_ok(set_roster_spot(lid, 'os-out', 'out'), 'os4 an Out player goes on OUT');
  perform assert_true((select spot from native_roster where league_id = lid and slug = 'os-out') = 'out', 'os4a …and is stashed there');
  perform assert_err(set_roster_spot(lid, 'os-ir', 'out'), 'OUT is for players designated O/D/Q', 'os4b an IR-tagged player is not an OUT player');
  perform assert_true(position('this one is IR' in (set_roster_spot(lid, 'os-ir', 'out') ->> 'error')) > 0, 'os4c …and the refusal says what he is');
  -- (checked BEFORE the one IR place is taken, so the refusal is the list's, not the cap's)
  perform assert_err(set_roster_spot(lid, 'os-out', 'ir'), 'IR is for players designated IR', 'os4e and an Out player is not an IR player under IR-only');
  perform assert_ok(set_roster_spot(lid, 'os-ir', 'ir'), 'os4d he goes on IR');
  perform assert_err(set_roster_spot(lid, 'os-fit', 'out'), 'no designation', 'os4f a healthy player fits neither shelf');
  perform assert_ok(set_roster_spot(lid, 'os-quest', 'out'), 'os4g a Questionable player fits the widened OUT list');
  perform assert_err(set_roster_spot(lid, 'os-doubt', 'out'), 'OUT is full — 2 spots', 'os4h the second shelf has its own cap');
  perform assert_ok(set_roster_spot(lid, 'os-quest', 'active'), 'os4i back to active');
  perform assert_ok(set_roster_spot(lid, 'os-doubt', 'out'), 'os4j …and the Doubtful man takes the place');
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = b_seat and spot <> 'active') = 3,
    'os4k three stashed: two OUT, one IR');
  perform assert_err(set_roster_spot(lid, 'os-fit', 'bench'), 'spot must be active, taxi, ir, out, or devy', 'os4l the spot vocabulary names OUT (and devy, 0366)');

  -- ══ AFTER THE DRAFT: OUT MOVES LIKE IR ═══════════════════════════════════
  perform probe_as('a');
  update draft set status = 'complete' where league_id = lid;
  r := set_league_roster_shape(lid, null, null, 1, 3);
  perform assert_ok(r, 'os5 a third OUT spot after the draft');
  perform assert_true((r -> 'shape' ->> 'out')::int = 3 and (r ->> 'rounds')::int = 10 and (r ->> 'draft_rounds')::int = 6, 'os5a the roster grows, the draft does not: ' || r::text);
  perform assert_err(set_league_roster_shape(lid, null, null, 1, 1), 'players on OUT', 'os5b a shelf someone stands on cannot be removed');
  perform assert_err(set_league_roster_shape(lid, 5, null, 1, 3), 'bench and taxi squad lock', 'os5c the bench is still locked, and the message names both shelves');
  perform assert_true(position('OUT spots' in (set_league_roster_shape(lid, 5, null, 1, 3) ->> 'error')) > 0, 'os5d …by name');

  delete from league where id = lid;
  delete from injury_status where player_slug like 'os-%';
  raise notice 'out-spot probes done';
end $$;
select 'ALL OUT-SPOT PROBES PASSED' as result;
