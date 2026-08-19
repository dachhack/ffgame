-- 0198 IR-eligibility probes.
--
--   • the default list is 0164's hardcoded pair, so a league that never opens
--     the setting behaves exactly as it did;
--   • a healthy player is refused, and the refusal NAMES the eligible tags;
--   • the commissioner narrows the list and a previously-eligible player is
--     refused; widens it and a Questionable player qualifies;
--   • an empty list and a tag the report never emits are both refused;
--   • the gate is just as true for the COMMISSIONER'S own roster — unlike the
--     taxi lock, this is a statement about the player, not a deadline;
--   • and roster_rules carries the list, which is the whole point: a screen
--     gates the button instead of discovering the rule from a red error.
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

  r := create_native_league('IR Rules', '2024', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform assert_ok(r, 'ir0 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(native_join(code, 'IR-B'), 'ir0a join'); perform probe_as('a');
  perform assert_ok(set_league_classic_slots(lid,
    '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'ir0b a three-spot lineup');
  perform assert_ok(set_league_roster_shape(lid, 2, 0, 3), 'ir0c three IR spots — this is about eligibility, not capacity');

  perform seed_league_pool(lid, '[
    {"slug":"ir-out","full":"Out Guy","pos":"RB","team":"KC","exp":3},
    {"slug":"ir-ir","full":"IR Guy","pos":"RB","team":"KC","exp":3},
    {"slug":"ir-doubt","full":"Doubtful Guy","pos":"RB","team":"KC","exp":3},
    {"slug":"ir-quest","full":"Questionable Guy","pos":"WR","team":"KC","exp":3},
    {"slug":"ir-fit","full":"Fit Guy","pos":"WR","team":"KC","exp":3},
    {"slug":"ir-c","full":"Commish Guy","pos":"QB","team":"KC","exp":3}]'::jsonb);
  insert into injury_status (player_slug, status) values
    ('ir-out', 'O'), ('ir-ir', 'IR'), ('ir-doubt', 'D'), ('ir-quest', 'Q')
  on conflict (player_slug) do update set status = excluded.status;

  select sleeper_roster_id into a_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000a';
  select sleeper_roster_id into b_seat from league_membership
    where league_id = lid and app_user_id = '00000000-0000-0000-0000-00000000000b';
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, b_seat, 'ir-out', 'draft'), (lid, b_seat, 'ir-ir', 'draft'),
    (lid, b_seat, 'ir-doubt', 'draft'), (lid, b_seat, 'ir-quest', 'draft'),
    (lid, b_seat, 'ir-fit', 'draft'), (lid, a_seat, 'ir-c', 'draft');

  -- ══ THE DEFAULT IS 0164'S PAIR ═══════════════════════════════════════════
  perform assert_true(league_ir_tags(lid) = array['IR', 'O'],
    'ir1 a league that never opens the setting keeps IR/O');
  perform probe_as('b');
  perform assert_ok(set_roster_spot(lid, 'ir-out', 'ir'), 'ir1a an Out player goes on IR');
  perform assert_ok(set_roster_spot(lid, 'ir-ir', 'ir'), 'ir1b so does one tagged IR');
  perform assert_err(set_roster_spot(lid, 'ir-doubt', 'ir'), 'IR is for players designated',
    'ir1c a Doubtful player does not, by default');
  perform assert_err(set_roster_spot(lid, 'ir-fit', 'ir'), 'no designation',
    'ir1d and a healthy player is told he has none');
  -- The refusal names the LIST, so nobody has to go read the settings page.
  perform assert_true(position('IR/O' in (set_roster_spot(lid, 'ir-fit', 'ir') ->> 'error')) > 0,
    'ir1e the refusal names the eligible tags');
  perform assert_true(position('this one is D' in (set_roster_spot(lid, 'ir-doubt', 'ir') ->> 'error')) > 0,
    'ir1f …and what the player actually is');

  -- ══ THE COMMISSIONER NARROWS IT ══════════════════════════════════════════
  perform probe_as('a');
  perform assert_ok(set_ir_rules(lid, array['IR']), 'ir2 season-ending IR only');
  perform assert_true(league_ir_tags(lid) = array['IR'], 'ir2a …and that is what is stored');
  perform probe_as('b');
  perform assert_ok(set_roster_spot(lid, 'ir-out', 'active'), 'ir2b the Out player comes back off');
  perform assert_err(set_roster_spot(lid, 'ir-out', 'ir'), 'IR is for players designated IR',
    'ir2c …and may no longer go back on');
  perform assert_ok(set_roster_spot(lid, 'ir-ir', 'active'), 'ir2d the IR-tagged one moves freely');
  perform assert_ok(set_roster_spot(lid, 'ir-ir', 'ir'), 'ir2e …either way');

  -- ══ AND WIDENS IT ════════════════════════════════════════════════════════
  perform probe_as('a');
  perform assert_ok(set_ir_rules(lid, array['ir', 'o', 'd', 'q']), 'ir3 a loose league takes the whole report');
  perform assert_true(league_ir_tags(lid) = array['IR', 'O', 'D', 'Q'], 'ir3a stored uppercase, in order');
  perform probe_as('b');
  perform assert_ok(set_roster_spot(lid, 'ir-quest', 'ir'), 'ir3b now a Questionable player qualifies');
  perform assert_err(set_roster_spot(lid, 'ir-fit', 'ir'), 'no designation',
    'ir3c a healthy player never does, however loose the list');

  -- ══ THE LIST ITSELF IS GUARDED ═══════════════════════════════════════════
  perform probe_as('a');
  perform assert_err(set_ir_rules(lid, array['PUP']), 'O, D, Q and IR',
    'ir4 a tag the injury report never emits is refused');
  perform assert_err(set_ir_rules(lid, array[]::text[]), 'at least one designation',
    'ir4a and so is an empty list — that is a spot to remove, not a rule');
  perform assert_ok(set_ir_rules(lid, array['IR', 'ir', 'O']), 'ir4b duplicates collapse');
  perform assert_true(league_ir_tags(lid) = array['IR', 'O'], 'ir4c …to one of each');
  perform assert_ok(set_ir_rules(lid, null), 'ir4d null reads without writing');
  perform assert_true(league_ir_tags(lid) = array['IR', 'O'], 'ir4e …and changes nothing');

  -- ══ THE COMMISSIONER IS NOT EXEMPT ═══════════════════════════════════════
  -- Unlike the taxi LOCK (a deadline someone must be able to fix a mistake
  -- after), this is a fact about the player, and it is just as true on the
  -- commissioner's own roster.
  perform assert_err(set_roster_spot(lid, 'ir-c', 'ir'), 'no designation',
    'ir5 the commissioner cannot stash a healthy player either');

  -- ══ THE SCREENS CAN READ IT ══════════════════════════════════════════════
  perform assert_true(roster_rules(lid) -> 'ir_tags' = '["IR","O"]'::jsonb,
    'ir6 roster_rules carries the list, so a host gates the button');
  perform probe_as('b');
  perform assert_err(set_ir_rules(lid, array['IR']), 'commissioner only',
    'ir7 a member cannot set it');

  raise notice 'ir-eligibility probes done';
end $$;

select 'ALL IR-ELIGIBILITY PROBES PASSED' as result;
