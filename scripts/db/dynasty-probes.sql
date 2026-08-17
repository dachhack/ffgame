-- 0182 dynasty probes: season rollover with keepers, and the rookie-draft
-- shape that falls out of it.
--
-- What must hold:
--   • keeper_count is commissioner-only, capped at rounds−1, and refused once
--     the season has rolled;
--   • set_keepers validates the WHOLE list before touching stored state, caps
--     at keeper_count, and only ever names players on that roster;
--   • rollover: new league row at season+1 (same sleeper_league_id), same
--     settings/memberships/pool, keepers on native_roster as 'keeper'
--     (declared first, topped up by pool rank), fresh pending draft with
--     keeper_slots, a generated schedule, and NO wallets (fresh season seed);
--   • the response NAMES the game mode it carried (v0.251.0 rule);
--   • the next draft makes (rounds − keepers) picks per team and completes
--     there — while the roster cap stays the full roster size;
--   • rollover is refused twice, pre-draft, for mocks, and for non-commish;
--   • rookie-only rollover carries keepers only, forces pool_filter to
--     {max_exp:0}, and refuses to start the draft until the reseed;
--   • seed_league_pool PRESERVES rostered players (its old delete-all
--     cascaded through native_roster's FK and would have eaten every keeper).
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
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; nl uuid; code text; pool jsonb; i int; s text;
  b_worst text[]; c_worst text; c_best text; c_mid text; lid2 uuid; nl2 uuid;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-00000000000d', 'd@test.dev'),
    ('00000000-0000-0000-0000-00000000000e', 'e@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id in ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e');

  -- ── fixture: 4 teams × 7 rounds, d commish on seat 1, e on seat 2 ─────────
  perform probe_as('d');
  r := create_native_league('Dynasty League', '2024', 4, 7, 60);
  perform assert_ok(r, 'dy0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('e'); perform assert_ok(native_join(code, 'DY-E'), 'dy0a e joins');
  perform probe_as('d');

  pool := '[]'::jsonb;
  for i in 1..40 loop
    pool := pool || jsonb_build_object(
      'slug', 'p' || lpad(i::text, 2, '0'), 'full', 'Player ' || i,
      'pos', case when i % 2 = 0 then 'WR' else 'RB' end, 'team', 'T' || (i % 8),
      'exp', 3);
  end loop;
  perform assert_ok(seed_league_pool(lid, pool), 'dy0b pool');

  -- ── keeper_count gates ────────────────────────────────────────────────────
  perform probe_as('e');
  perform assert_err(set_keeper_count(lid, 2), 'commissioner only', 'dy1 member refused');
  perform probe_as('d');
  perform assert_err(set_keeper_count(lid, 7), 'keepers must be 0', 'dy1a rounds-1 cap');
  perform assert_err(set_keeper_count(lid, -1), 'keepers must be 0', 'dy1b negative');
  perform assert_ok(set_keeper_count(lid, 2), 'dy1c count = 2');
  perform assert_true((select (settings_json ->> 'keeper_count')::int from league where id = lid) = 2,
    'dy1d stored');

  -- pre-draft: declarations and rollover both refuse
  perform assert_err(set_keepers(lid, 1, '["p01"]'::jsonb), 'after the season''s draft', 'dy2 declare pre-draft');
  perform assert_err(rollover_league(lid), 'never finished', 'dy2a rollover pre-draft');

  -- ── run the season's draft: commish proxy-picks best-available ────────────
  perform assert_ok(start_draft(lid), 'dy3 start');
  for i in 1..28 loop
    select lp.slug into s from league_pool lp
      where lp.league_id = lid
        and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
      order by lp.rank limit 1;
    r := make_draft_pick(lid, s);
    perform assert_ok(r, 'dy3a pick ' || i);
  end loop;
  perform assert_true((select status from draft where league_id = lid) = 'complete', 'dy3b draft complete');
  perform assert_true((select count(*) from native_roster where league_id = lid and roster_id = 1) = 7,
    'dy3c full rosters');

  -- ── declarations ──────────────────────────────────────────────────────────
  -- d (roster 1) keeps his two WORST-ranked players — proving declarations
  -- beat the rank default. e (roster 2) declares one worst; top-up adds his
  -- best. Seats 3/4 declare nothing; defaults take their top 2 by rank.
  select array_agg(slug) into b_worst from (
    select nr.slug from native_roster nr join league_pool lp
      on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid and nr.roster_id = 1 order by lp.rank desc limit 2) t;
  select nr.slug into c_worst from native_roster nr join league_pool lp
    on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid and nr.roster_id = 2 order by lp.rank desc limit 1;
  select nr.slug into c_best from native_roster nr join league_pool lp
    on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid and nr.roster_id = 2 order by lp.rank asc limit 1;
  -- a third DISTINCT roster-2 player for the over-the-cap probe. A literal
  -- ('p01') flaked here: the draft order is random, so roster 2 sometimes
  -- OWNS p01 as its best pick — the list collapsed to 2 distinct slugs and
  -- sailed under the cap. Pick the middle player instead, guaranteed to be
  -- neither the best nor the worst on a 7-man roster.
  select nr.slug into c_mid from native_roster nr join league_pool lp
    on lp.league_id = nr.league_id and lp.slug = nr.slug
    where nr.league_id = lid and nr.roster_id = 2 order by lp.rank asc offset 3 limit 1;

  perform probe_as('e');
  perform assert_err(set_keepers(lid, 1, to_jsonb(b_worst)), 'forbidden', 'dy4 not your roster');
  perform assert_err(set_keepers(lid, 2, jsonb_build_array(c_worst, c_best, c_mid)), 'at most 2', 'dy4a over the cap');
  perform assert_err(set_keepers(lid, 2, '["p99"]'::jsonb), 'not on this roster', 'dy4b foreign slug');
  perform assert_true((select count(*) from keeper_pick where league_id = lid and roster_id = 2) = 0,
    'dy4c refused calls stored nothing');
  perform assert_ok(set_keepers(lid, 2, jsonb_build_array(c_worst)), 'dy4d e declares 1');
  perform probe_as('d');
  perform assert_ok(set_keepers(lid, 1, to_jsonb(b_worst)), 'dy4e d declares 2');

  -- keeper_state preview: declared first, top-up by rank
  r := keeper_state(lid);
  perform assert_true((r ->> 'keeper_count')::int = 2 and (r ->> 'next_season') = '2025',
    'dy5 state basics');
  perform assert_true(
    (select count(*) from jsonb_array_elements(r -> 'teams') t
      where (t ->> 'roster_id')::int = 2
        and t -> 'keep' @> jsonb_build_array(jsonb_build_object('slug', c_worst, 'declared', true))
        and t -> 'keep' @> jsonb_build_array(jsonb_build_object('slug', c_best, 'declared', false))) = 1,
    'dy5a e keeps declared + best-by-rank top-up');

  -- ── the rollover itself ───────────────────────────────────────────────────
  -- name-the-mode check rides on a classic league
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
      || '{"game_mode": "classic", "classic_ok": true}'::jsonb
    where id = lid;

  perform probe_as('e');
  perform assert_err(rollover_league(lid), 'commissioner only', 'dy6 member refused');
  perform probe_as('d');
  r := rollover_league(lid);
  perform assert_ok(r, 'dy6a rollover');
  nl := (r ->> 'league_id')::uuid;
  perform assert_true(r ->> 'season' = '2025', 'dy6b season+1');
  perform assert_true(r ->> 'game_mode' = 'classic', 'dy6c the response NAMES the mode');
  perform assert_true((r ->> 'kept')::int = 8 and (r ->> 'keeper_slots')::int = 2
    and (r ->> 'draft_rounds')::int = 5 and (r ->> 'roster_size')::int = 7, 'dy6d keeper arithmetic');

  -- the new row: same identity, next season, settings carried
  perform assert_true((select count(*) from league where id = nl and season = '2025'
      and sleeper_league_id = (select sleeper_league_id from league where id = lid)
      and provider = 'native'
      and settings_json ->> 'game_mode' = 'classic'
      and (settings_json ->> 'keeper_count')::int = 2) = 1,
    'dy7 new league row');
  perform assert_true((select invite_code from league where id = nl)
      is distinct from (select invite_code from league where id = lid), 'dy7a fresh invite code');

  -- memberships: same seats and managers; balances fresh
  perform assert_true((select count(*) from league_membership where league_id = nl) = 4, 'dy8 four seats');
  perform assert_true((select count(*) from league_membership where league_id = nl
      and sleeper_roster_id = 1 and enrolled
      and app_user_id = '00000000-0000-0000-0000-00000000000d') = 1, 'dy8a d still on seat 1');
  perform assert_true((select count(*) from league_membership where league_id = nl
      and sleeper_roster_id = 3 and app_user_id is null and not enrolled) = 1, 'dy8b seat 3 open');
  perform assert_true(not exists (select 1 from league_membership where league_id = nl
      and (faab_budget is not null or waiver_priority is not null)), 'dy8c balances fresh');

  -- pool carried whole, waiver clocks cleared
  perform assert_true((select count(*) from league_pool where league_id = nl) = 40
      and not exists (select 1 from league_pool where league_id = nl and waived_until is not null),
    'dy9 pool carried');

  -- keepers: exactly the resolved set, as 'keeper', active
  perform assert_true(not exists (
      (select kr.roster_id, kr.slug from _keeper_resolve(lid, 2) kr
       except
       select nr.roster_id, nr.slug from native_roster nr where nr.league_id = nl)
      union all
      (select nr.roster_id, nr.slug from native_roster nr where nr.league_id = nl
       except
       select kr.roster_id, kr.slug from _keeper_resolve(lid, 2) kr)),
    'dy10 keepers match the preview exactly');
  perform assert_true(not exists (select 1 from native_roster where league_id = nl
      and (acquired <> 'keeper' or spot <> 'active')), 'dy10a acquired=keeper, spot=active');
  perform assert_true((select count(*) from native_roster nr where nr.league_id = nl
      and nr.roster_id = 1 and nr.slug = any (b_worst)) = 2, 'dy10b declarations beat rank');
  perform assert_true((select count(*) from native_roster nr where nr.league_id = nl
      and nr.roster_id = 3) = 2, 'dy10c undeclared seat topped up');

  -- fresh pending draft; schedule generated; wallets NOT carried
  perform assert_true((select count(*) from draft where league_id = nl and status = 'pending'
      and rounds = 7 and keeper_slots = 2 and pick_seconds = 60) = 1, 'dy11 pending draft');
  perform assert_true((select count(*) from matchup where league_id = nl) = 28, 'dy11a 14-week schedule');
  perform assert_true((select count(*) from sleeper_lineup where league_id = nl) > 0, 'dy11b keepers materialized');
  perform assert_true(not exists (select 1 from team_wallet where league_id = nl), 'dy11c wallets fresh');

  -- rolled-over season is closed to more meddling
  perform assert_err(rollover_league(lid), 'already rolled', 'dy12 no double rollover');
  perform assert_err(set_keeper_count(lid, 3), 'already rolled', 'dy12a count frozen');
  perform assert_err(set_keepers(lid, 1, to_jsonb(b_worst)), 'already rolled', 'dy12b declarations frozen');

  -- ── the next season's draft: 5 rounds of picks onto 2 keepers ─────────────
  perform assert_ok(start_draft(nl), 'dy13 next draft starts');
  perform assert_true((select (draft_state(nl) ->> 'rounds'))::int = 5
      and (select (draft_state(nl) ->> 'keeper_slots'))::int = 2
      and (select (draft_state(nl) ->> 'roster_size'))::int = 7, 'dy13a draft_state reports effective rounds');
  for i in 1..20 loop
    select lp.slug into s from league_pool lp
      where lp.league_id = nl
        and not exists (select 1 from native_roster nr where nr.league_id = nl and nr.slug = lp.slug)
      order by lp.rank limit 1;
    r := make_draft_pick(nl, s);
    perform assert_ok(r, 'dy13b pick ' || i);
  end loop;
  perform assert_true((select status from draft where league_id = nl) = 'complete',
    'dy13c completes at (rounds − keepers) × teams');
  perform assert_true(not exists (select 1 from native_roster where league_id = nl
      group by roster_id having count(*) <> 7), 'dy13d every roster holds exactly roster_size');
  perform assert_true((select max(round) from draft_pick where league_id = nl) = 5, 'dy13e round numbering');
  -- the cap consumers still see the FULL roster: an add now says roster full
  perform assert_err(add_free_agent(nl, 1, (select slug from league_pool lp where lp.league_id = nl
      and not exists (select 1 from native_roster nr where nr.league_id = nl and nr.slug = lp.slug)
      order by lp.rank limit 1)), 'roster full', 'dy13f cap = roster size');

  -- ── rookie-only rollover (dynasty phase 2) ────────────────────────────────
  perform probe_as('d');
  r := create_native_league('Rookie Pipe', '2024', 2, 5, 60);
  perform assert_ok(r, 'dy14 create');
  lid2 := (r ->> 'league_id')::uuid;
  pool := '[]'::jsonb;
  for i in 1..6 loop
    pool := pool || jsonb_build_object('slug', 'vet' || i, 'full', 'Vet ' || i,
      'pos', case when i % 2 = 0 then 'WR' else 'RB' end, 'team', 'T1', 'exp', 5);
  end loop;
  for i in 1..6 loop
    pool := pool || jsonb_build_object('slug', 'rk' || i, 'full', 'Rook ' || i,
      'pos', case when i % 2 = 0 then 'WR' else 'RB' end, 'team', 'T2', 'exp', 0);
  end loop;
  perform assert_ok(seed_league_pool(lid2, pool), 'dy14a pool');
  perform assert_ok(set_keeper_count(lid2, 2), 'dy14b keepers = 2');

  -- mock leagues refuse (flag it, try, unflag)
  update league set is_mock = true where id = lid2;
  perform assert_err(rollover_league(lid2), 'don''t roll over', 'dy14c mock refused');
  update league set is_mock = false where id = lid2;

  perform assert_ok(start_draft(lid2), 'dy15 draft');
  for i in 1..10 loop
    select lp.slug into s from league_pool lp
      where lp.league_id = lid2
        and not exists (select 1 from native_roster nr where nr.league_id = lid2 and nr.slug = lp.slug)
      order by lp.rank limit 1;
    perform assert_ok(make_draft_pick(lid2, s), 'dy15a pick ' || i);
  end loop;
  perform assert_true((select status from draft where league_id = lid2) = 'complete', 'dy15b complete');

  r := rollover_league(lid2, 14, true);
  perform assert_ok(r, 'dy16 rookie-only rollover');
  nl2 := (r ->> 'league_id')::uuid;
  perform assert_true((r ->> 'rookie_only')::boolean, 'dy16a flagged in response');
  perform assert_true((select (settings_json -> 'pool_filter' ->> 'max_exp')::int from league where id = nl2) = 0,
    'dy16b pool_filter forced rookies-only');
  -- pool carries ONLY the keepers (their roster rows need the FK)
  perform assert_true((select count(*) from league_pool where league_id = nl2) = 4
      and not exists (select 1 from league_pool lp where lp.league_id = nl2
        and not exists (select 1 from native_roster nr where nr.league_id = nl2 and nr.slug = lp.slug)),
    'dy16c pool = keepers only');
  -- no free players ⇒ the draft cannot start until the rookie reseed
  perform assert_err(start_draft(nl2), 'pool smaller', 'dy16d start refused before reseed');

  -- the reseed PRESERVES rostered keepers (the FK-cascade bug this guards)
  pool := '[]'::jsonb;
  for i in 7..12 loop
    pool := pool || jsonb_build_object('slug', 'rk' || i, 'full', 'Rook ' || i,
      'pos', case when i % 2 = 0 then 'WR' else 'RB' end, 'team', 'T3', 'exp', 0);
  end loop;
  perform assert_ok(seed_league_pool(nl2, pool), 'dy17 rookie reseed');
  perform assert_true((select count(*) from native_roster where league_id = nl2) = 4,
    'dy17a keepers survive the reseed');
  perform assert_true((select count(*) from league_pool where league_id = nl2) = 10,
    'dy17b pool = 4 keepers + 6 rookies');

  perform assert_ok(start_draft(nl2), 'dy18 rookie draft starts');
  for i in 1..6 loop
    select lp.slug into s from league_pool lp
      where lp.league_id = nl2
        and not exists (select 1 from native_roster nr where nr.league_id = nl2 and nr.slug = lp.slug)
      order by lp.rank limit 1;
    perform assert_ok(make_draft_pick(nl2, s), 'dy18a pick ' || i);
  end loop;
  perform assert_true((select status from draft where league_id = nl2) = 'complete', 'dy18b complete');
  perform assert_true(not exists (select 1 from native_roster where league_id = nl2
      group by roster_id having count(*) <> 5), 'dy18c rosters full at 5');

end $$;

select 'ALL DYNASTY PROBES PASSED' as result;
