-- 0183 pick-asset probes: rookie-draft rounds, tradeable picks, and the
-- draft honoring traded ownership on the clock.
--
-- What must hold:
--   • set_rookie_rounds is commissioner-only, 0–10, provisions one asset per
--     seat per round for NEXT season (owner = original), grows additively,
--     and refuses to shrink away rounds containing a traded pick;
--   • trades carry picks: ownership validated at propose AND re-validated at
--     execute (a pick that moved in between fails the trade, which stays
--     pending); ownership flips on execute;
--   • rollover copies next-season assets to the new league (trades intact)
--     and provisions the following season's futures from rookie_rounds;
--   • the new draft runs LINEAR rounds in the base order with each overall
--     owned by its asset's holder — the traded slot goes to the acquirer,
--     the acquirer's manager can pick there, a bystander cannot — and
--     completes at the asset count, not (rounds − keepers) × teams;
--   • a league with NO assets drafts exactly as before (dynasty suite).
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
  ('00000000-0000-0000-0000-00000000000f', 'f@test.dev'),
  ('00000000-0000-0000-0000-000000000009', '9@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; nl uuid; code text; pool jsonb; i int; s text;
  t1 uuid; t2 uuid; g_slug text; f_slug text; ords jsonb;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000f', 'f@test.dev'),
    ('00000000-0000-0000-0000-000000000009', '9@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000009');

  -- ── fixture: 3 teams × 5 rounds; f commish (seat 1), 9 on seat 2 ──────────
  perform probe_as('f');
  r := create_native_league('Pick Trader', '2024', 3, 5, 60);
  perform assert_ok(r, 'pk0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('9'); perform assert_ok(native_join(code, 'PK-9'), 'pk0a 9 joins seat 2');
  perform probe_as('f');

  pool := '[]'::jsonb;
  for i in 1..30 loop
    pool := pool || jsonb_build_object(
      'slug', 'q' || lpad(i::text, 2, '0'), 'full', 'Q Player ' || i,
      'pos', case when i % 2 = 0 then 'WR' else 'RB' end, 'team', 'T' || (i % 6), 'exp', 2);
  end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'pk0b pool');

  -- ── provisioning ──────────────────────────────────────────────────────────
  perform probe_as('9');
  perform assert_err(set_rookie_rounds(lid, 2), 'commissioner only', 'pk1 member refused');
  perform probe_as('f');
  perform assert_err(set_rookie_rounds(lid, 11), '0–10', 'pk1a range');
  perform assert_ok(set_rookie_rounds(lid, 2), 'pk1b two rounds');
  perform assert_true((select count(*) from pick_asset where league_id = lid and season = '2025') = 6,
    'pk1c 2 rounds × 3 seats');
  perform assert_true(not exists (select 1 from pick_asset where league_id = lid
      and owner_roster <> original_roster), 'pk1d all picks start with their originals');
  perform assert_ok(set_rookie_rounds(lid, 3), 'pk1e grow');
  perform assert_true((select count(*) from pick_asset where league_id = lid) = 9, 'pk1f grew to 9');
  perform assert_ok(set_rookie_rounds(lid, 2), 'pk1g shrink while untraded');
  perform assert_true((select count(*) from pick_asset where league_id = lid) = 6, 'pk1h back to 6');

  -- ── the season's draft runs (no assets for 2024 ⇒ plain snake) ────────────
  perform assert_ok(start_draft(lid), 'pk2 start');
  perform assert_true((select pick_owners from draft where league_id = lid) is null,
    'pk2a no owner list without own-season assets');
  for i in 1..15 loop
    select lp.slug into s from league_pool lp
      where lp.league_id = lid
        and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
      order by lp.rank limit 1;
    perform assert_ok(make_draft_pick(lid, s), 'pk2b pick ' || i);
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', 'pk2c complete');

  -- ── trading picks ─────────────────────────────────────────────────────────
  select nr.slug into f_slug from native_roster nr where nr.league_id = lid and nr.roster_id = 1 limit 1;
  select nr.slug into g_slug from native_roster nr where nr.league_id = lid and nr.roster_id = 2 limit 1;

  -- pk3: you can only offer picks you own; a pick appears once; bad shapes fail
  perform assert_err(propose_trade(lid, 1, 2, '[]'::jsonb, '[]'::jsonb, null,
      '[{"round": 1, "orig": 2}]'::jsonb, null),
    'picks you own', 'pk3 offering someone else''s pick');
  perform assert_err(propose_trade(lid, 1, 2, '[]'::jsonb, '[]'::jsonb, null,
      '[{"round": 9, "orig": 1}]'::jsonb, null),
    'no such pick', 'pk3a unknown round');
  perform assert_err(propose_trade(lid, 1, 2, '[]'::jsonb, '[]'::jsonb, null,
      '[{"round": 1, "orig": 1}, {"round": 1, "orig": 1}]'::jsonb, null),
    'appear once', 'pk3b duplicate pick');
  perform assert_err(propose_trade(lid, 1, 2, '[]'::jsonb, '[]'::jsonb), 'moves 1–10', 'pk3c empty trade');

  -- pk4: a player-plus-pick deal executes and flips ownership (both sides
  -- move one player, so the roster caps stay satisfied)
  r := propose_trade(lid, 1, 2, jsonb_build_array(f_slug), jsonb_build_array(g_slug),
      'him plus my 2025 1st for him', '[{"round": 1, "orig": 1}]'::jsonb, null);
  perform assert_ok(r, 'pk4 propose player+pick for player');
  t1 := (r ->> 'trade_id')::uuid;
  perform probe_as('9');
  perform assert_ok(respond_trade(t1, true), 'pk4a accepted + executed');
  perform assert_true((select owner_roster from pick_asset where league_id = lid
      and season = '2025' and round = 1 and original_roster = 1) = 2, 'pk4b pick now team 2''s');
  perform assert_true((select roster_id from native_roster where league_id = lid and slug = g_slug) = 1,
    'pk4c player went the other way');

  -- pk5: re-validation — a deal naming a pick that moved fails at execute
  -- and stays pending. Team 2 offers the acquired pick to team 1 twice;
  -- executing one kills the other.
  r := propose_trade(lid, 2, 1, '[]'::jsonb, '[]'::jsonb, 'deal A', '[{"round": 1, "orig": 1}]'::jsonb,
      '[{"round": 2, "orig": 1}]'::jsonb);
  perform assert_ok(r, 'pk5 deal A');
  t1 := (r ->> 'trade_id')::uuid;
  r := propose_trade(lid, 2, 1, '[]'::jsonb, '[]'::jsonb, 'deal B', '[{"round": 1, "orig": 1}]'::jsonb, null);
  perform assert_ok(r, 'pk5a deal B');
  t2 := (r ->> 'trade_id')::uuid;
  perform probe_as('f');
  perform assert_ok(respond_trade(t1, true), 'pk5b deal A executes');
  perform assert_err(respond_trade(t2, true), 'picks moved', 'pk5c deal B fails re-validation');
  perform assert_true((select status from trade_proposal where id = t2) = 'pending',
    'pk5d deal B stays pending');
  -- after deal A: R1-orig1 back with 1, R2-orig1 with 2
  perform assert_true((select owner_roster from pick_asset where league_id = lid
      and season = '2025' and round = 1 and original_roster = 1) = 1, 'pk5e R1 home again');
  perform assert_true((select owner_roster from pick_asset where league_id = lid
      and season = '2025' and round = 2 and original_roster = 1) = 2, 'pk5f R2-orig1 to team 2');

  -- pk6: shrink refuses to delete a traded round
  perform assert_err(set_rookie_rounds(lid, 1), 'trades already moved', 'pk6 shrink guard');

  -- pk7: the trades feed carries the pick lists
  perform assert_true((select jsonb_array_length(t -> 0 -> 'give_picks') >= 0
      from (select league_trades(lid) as t) x), 'pk7 give_picks in the feed');

  -- ── rollover carries assets + provisions the next generation ──────────────
  perform assert_ok(set_keeper_count(lid, 1), 'pk8 one keeper');
  r := rollover_league(lid);
  perform assert_ok(r, 'pk8a rollover');
  nl := (r ->> 'league_id')::uuid;
  perform assert_true((r ->> 'picks_carried')::int = 6, 'pk8b six assets carried');
  perform assert_true((r ->> 'draft_rounds')::int = 2, 'pk8c draft is the 2 asset rounds');
  perform assert_true((select owner_roster from pick_asset where league_id = nl
      and season = '2025' and round = 2 and original_roster = 1) = 2, 'pk8d trade survives the carry');
  perform assert_true((select count(*) from pick_asset where league_id = nl and season = '2026') = 6,
    'pk8e 2026 futures provisioned');
  perform assert_true(not exists (select 1 from pick_asset where league_id = nl
      and season = '2026' and owner_roster <> original_roster), 'pk8f futures start with originals');

  -- ── the new draft honors ownership on the clock ───────────────────────────
  perform assert_ok(start_draft(nl, '[1, 2, 3]'::jsonb), 'pk9 start with a preset order');
  select pick_owners into ords from draft where league_id = nl;
  -- linear rounds in base order 1,2,3: R1 = orig 1(→1), 2(→2), 3(→3);
  -- R2 = orig 1(→2, traded), 2(→2), 3(→3)
  perform assert_true(ords = '[1, 2, 3, 2, 2, 3]'::jsonb,
    'pk9a owner list: linear, traded slot owned by team 2 — got ' || ords::text);
  perform assert_true((select (draft_state(nl) ->> 'rounds'))::int = 2, 'pk9b room shows 2 rounds');

  -- overall 1: team 1 on the clock; the bystander on seat 2 cannot pick here
  perform probe_as('9');
  perform assert_err(make_draft_pick(nl, (select lp.slug from league_pool lp where lp.league_id = nl
      and not exists (select 1 from native_roster nr where nr.league_id = nl and nr.slug = lp.slug)
      order by lp.rank limit 1)), 'not your pick', 'pk10 not team 2''s turn');
  perform probe_as('f');
  for i in 1..3 loop
    select lp.slug into s from league_pool lp
      where lp.league_id = nl
        and not exists (select 1 from native_roster nr where nr.league_id = nl and nr.slug = lp.slug)
      order by lp.rank limit 1;
    perform assert_ok(make_draft_pick(nl, s), 'pk10a R1 pick ' || i);
  end loop;
  -- overall 4 is the TRADED slot (orig 1, round 2): team 2's manager picks it
  perform assert_true((select (draft_state(nl) ->> 'on_clock'))::int = 2, 'pk10b traded slot on team 2''s clock');
  perform probe_as('9');
  select lp.slug into s from league_pool lp where lp.league_id = nl
    and not exists (select 1 from native_roster nr where nr.league_id = nl and nr.slug = lp.slug)
    order by lp.rank limit 1;
  perform assert_ok(make_draft_pick(nl, s), 'pk10c acquirer drafts with the acquired pick');
  perform probe_as('f');
  for i in 1..2 loop
    select lp.slug into s from league_pool lp
      where lp.league_id = nl
        and not exists (select 1 from native_roster nr where nr.league_id = nl and nr.slug = lp.slug)
      order by lp.rank limit 1;
    perform assert_ok(make_draft_pick(nl, s), 'pk10d pick ' || i);
  end loop;

  -- pk11: completes at the ASSET count (6), not (rounds − keepers) × teams (12)
  perform assert_true((select status from draft where league_id = nl) = 'complete',
    'pk11 completes at the asset count');
  -- rosters: keepers (1 each) + drafted-by-owner — team 1: 1+1, team 2: 1+3, team 3: 1+2
  perform assert_true((select count(*) from native_roster where league_id = nl and roster_id = 1) = 2
      and (select count(*) from native_roster where league_id = nl and roster_id = 2) = 4
      and (select count(*) from native_roster where league_id = nl and roster_id = 3) = 3,
    'pk11a rosters follow pick ownership');

  -- ── continuity at creation (0184/0185) ────────────────────────────────────
  -- pk12: selecting DYNASTY at creation presets the settings, stamps the
  -- identity, and deals THREE seasons of futures; the badge reads all of it.
  r := create_native_league('Dyn Check', '2026', 4, 12, 60, 'snake', 200, 15, 1, null, null, null, 'drip', 'dynasty', 3);
  perform assert_ok(r, 'pk12 dynasty create');
  perform assert_true((r ->> 'dynasty')::boolean and r ->> 'continuity' = 'dynasty', 'pk12a response names it');
  perform assert_true((select (settings_json ->> 'keeper_count')::int = 9
      and (settings_json ->> 'rookie_rounds')::int = 3
      and settings_json ->> 'continuity' = 'dynasty'
      from league where id = (r ->> 'league_id')::uuid), 'pk12b presets: keep 9, 3 rookie rounds');
  perform assert_true((select count(*) from pick_asset
      where league_id = (r ->> 'league_id')::uuid and season = '2027') = 12,
    'pk12c next season dealt (3 rounds × 4 seats)');
  perform assert_true((select count(*) from pick_asset
      where league_id = (r ->> 'league_id')::uuid) = 36,
    'pk12c2 THREE seasons of futures (2027–2029)');
  perform assert_true(league_is_dynasty((r ->> 'league_id')::uuid), 'pk12d badge predicate: selected league');
  perform assert_true(league_is_dynasty(lid), 'pk12e badge predicate: settings-only league (pre-0185)');
  r := create_native_league('Plain Check', '2026', 4, 12, 60);
  perform assert_ok(r, 'pk12f plain create still works');
  perform assert_true(not (r ->> 'dynasty')::boolean
      and not league_is_dynasty((r ->> 'league_id')::uuid), 'pk12g plain league is redraft');
  perform assert_true((select count(*) from jsonb_array_elements(my_teams()) t
      where t ->> 'league_id' = (select id::text from league where name = 'Dyn Check')
        and (t -> 'league' ->> 'dynasty')::boolean
        and t -> 'league' ->> 'continuity' = 'dynasty') = 1, 'pk12h my_teams carries the badge');
  -- keeper at creation: the count is the pick
  r := create_native_league('Keeper Check', '2026', 4, 12, 60, 'snake', 200, 15, 1, null, null, null, 'drip', 'keeper', 4);
  perform assert_ok(r, 'pk12i keeper create');
  perform assert_true((select settings_json ->> 'continuity' = 'keeper'
      and (settings_json ->> 'keeper_count')::int = 4
      and settings_json ->> 'rookie_rounds' is null
      from league where id = (r ->> 'league_id')::uuid), 'pk12j keeper presets');
  perform assert_err(create_native_league('Bad Keeper', '2026', 4, 12, 60, 'snake', 200, 15, 1, null, null, null, 'drip', 'keeper'),
    'keepers must be 1', 'pk12k keeper needs a count');

  -- ── the Super Bowl gate (0185) ────────────────────────────────────────────
  -- pk13: a current-season league cannot roll — the option appears when the
  -- season is over (Feb 15 after the season year); past-season fixtures above
  -- rolled freely.
  perform assert_err(rollover_league((select id from league where name = 'Dyn Check')),
    'after the Super Bowl', 'pk13 current season gated');

  -- ── the MODE & SEASON selector (0185) ─────────────────────────────────────
  -- pk14: redraft/keeper/dynasty transitions on one league, with the same
  -- provisioning and cleanup the create path uses.
  perform probe_as('9');
  perform assert_err(set_league_continuity((select id from league where name = 'Dyn Check'), 'keeper', 4),
    'commissioner only', 'pk14 member refused');
  perform probe_as('f');
  perform assert_err(set_league_continuity((select id from league where name = 'Dyn Check'), 'bestball', 2),
    'redraft, keeper, dynasty, contract or contract_dynasty', 'pk14a unknown mode');
  r := set_league_continuity((select id from league where name = 'Dyn Check'), 'keeper', 4);
  perform assert_ok(r, 'pk14b dynasty → keeper');
  perform assert_true((select count(*) from pick_asset
      where league_id = (select id from league where name = 'Dyn Check')) = 0,
    'pk14c untraded futures cleared on the way out');
  perform assert_true(league_continuity((select id from league where name = 'Dyn Check')) = 'keeper'
      and not league_is_dynasty((select id from league where name = 'Dyn Check')), 'pk14d keeper, not dynasty');
  perform assert_ok(set_league_continuity((select id from league where name = 'Dyn Check'), 'redraft'), 'pk14e → redraft');
  perform assert_true((select settings_json ->> 'keeper_count' is null
      and settings_json ->> 'continuity' is null
      from league where id = (select id from league where name = 'Dyn Check')), 'pk14f cleared');
  r := set_league_continuity((select id from league where name = 'Dyn Check'), 'dynasty', 2);
  perform assert_ok(r, 'pk14g → dynasty, 2 rounds');
  perform assert_true((select count(*) from pick_asset
      where league_id = (select id from league where name = 'Dyn Check')) = 24,
    'pk14h 2 rounds × 4 seats × 3 seasons');
  perform assert_true((select (settings_json ->> 'keeper_count')::int = 10
      from league where id = (select id from league where name = 'Dyn Check')), 'pk14i keepers implied (12 − 2)');

  -- ── multi-year trades (0185) ──────────────────────────────────────────────
  -- pk15: on the rolled league (season 2025), a 2027 pick — two years out —
  -- trades with an explicit season; the current season's own picks refuse.
  perform assert_true((select count(*) from pick_asset where league_id = nl and season = '2027') = 6,
    'pk15 horizon reaches 2027');
  r := propose_trade(nl, 1, 2, '[]'::jsonb, '[]'::jsonb, 'my 2027 1st, gratis',
      '[{"season": "2027", "round": 1, "orig": 1}]'::jsonb, null);
  perform assert_ok(r, 'pk15a two-years-out pick proposes');
  t1 := (r ->> 'trade_id')::uuid;
  perform probe_as('9');
  perform assert_ok(respond_trade(t1, true), 'pk15b executes');
  perform assert_true((select owner_roster from pick_asset where league_id = nl
      and season = '2027' and round = 1 and original_roster = 1) = 2, 'pk15c 2027 pick moved');
  perform probe_as('f');
  -- pk15d USED TO ASSERT THE OPPOSITE, and the change is deliberate (0190).
  -- Under 0183 only FUTURE picks traded: `_clean_trade_picks` resolved every
  -- pick against `_future_pick_season`, so the draft in front of you was the
  -- one draft whose picks you could not deal. That is exactly the founder's
  -- "trade draft positions", so the current season's own picks trade now — the
  -- guards moved to WHICH pick (not one already used, not the one on the
  -- clock) rather than WHICH SEASON.
  r := propose_trade(nl, 1, 2, '[]'::jsonb, '[]'::jsonb, null,
      '[{"season": "2025", "round": 1, "orig": 1}]'::jsonb, null);
  perform assert_ok(r, 'pk15d the pending draft''s own picks DO trade now (0190)');
  perform probe_as('9');
  perform assert_ok(respond_trade((r ->> 'trade_id')::uuid, true), 'pk15e and execute');
  perform assert_true((select owner_roster from pick_asset where league_id = nl
      and season = '2025' and round = 1 and original_roster = 1) = 2,
    'pk15f the rookie draft''s own pick changed hands');
  -- A pick that does not exist is still refused, so the season resolution did
  -- not simply stop checking.
  perform probe_as('f');
  perform assert_err(propose_trade(nl, 1, 2, '[]'::jsonb, '[]'::jsonb, null,
      '[{"season": "2025", "round": 99, "orig": 1}]'::jsonb, null),
    'no such pick', 'pk15g a pick that does not exist is still refused');
end $$;

select 'ALL PICK-ASSET PROBES PASSED' as result;
