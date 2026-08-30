-- 0263 convert-to-native probes: an imported league goes native, in place.
--
-- What must hold:
--   • the gates: stranger and plain member refused; a commissioner without
--     the native feature gets the invite-only message; a native league, a
--     league mid-season, a league with no synced rosters, and a league with
--     no commissioner are each refused with their own words;
--   • DRY RUN returns the full summary and writes NOTHING — provider, pool,
--     rosters, draft row and settings all untouched;
--   • the real run: pool seeded (seed_league_pool's filter), rosters matched
--     sleeper_id-first (an entry whose slug drifted still lands on the POOL's
--     slug), then by slug; an unknown rostered player is APPENDED to the pool,
--     not dropped; an unsupported position is skipped and named; grp ir/taxi
--     become native spots;
--   • the flip: provider native, sleeper_league_id rewritten into native-…,
--     the old key kept in converted_from; the mirrored platform scoring blob
--     moves to imported_scoring (a Drip knob object would stay — not probed
--     here, the td_bonus test is one line); teams/rounds/mode written;
--   • rounds = the biggest ACTIVE roster, floored at 5; waiver order seeded;
--   • the draft row is born complete AFTER the rosters, so the register
--     (0186) logs ZERO conversion rows — while a post-convert drop DOES log,
--     proving the trigger was live the whole time;
--   • sleeper_lineup is rematerialized from native_roster (the drifted slug
--     is replaced by the pool's);
--   • and the converted league answers native RPCs (drop_player works).
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
  ('00000000-0000-0000-0000-000000000007', '7@test.dev'),
  ('00000000-0000-0000-0000-000000000008', '8@test.dev'),
  ('00000000-0000-0000-0000-000000000009', '9@test.dev')
on conflict (id) do nothing;

do $$
declare
  r jsonb; lid uuid; lid2 uuid; lid3 uuid; lid4 uuid;
  pool jsonb; new_key text; snap jsonb; n int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-000000000007', '7@test.dev'),
    ('00000000-0000-0000-0000-000000000008', '8@test.dev'),
    ('00000000-0000-0000-0000-000000000009', '9@test.dev')
  on conflict (id) do nothing;

  -- ══ FIXTURE: an imported Sleeper league, pre-season ══════════════════════
  -- Built by hand the way server/src/sync.js builds one: provider sleeper,
  -- raw platform key, the mirrored {settings, scoring, roster_positions}
  -- blob, seats with sleeper_owner_ids, all-scheduled matchups, and lineup
  -- snapshots whose entries carry sleeper_id + player_slug + grp.
  insert into league (sleeper_league_id, season, name, provider, settings_json, commissioner_id, synced_at)
  values ('probe-import-1', '2026', 'Convert Me', 'sleeper',
          jsonb_build_object(
            'settings', jsonb_build_object('playoff_week_start', 15),
            'scoring',  jsonb_build_object('rec', 1, 'pass_td', 4),
            'roster_positions', jsonb_build_array('QB', 'RB', 'WR')),
          '00000000-0000-0000-0000-000000000007', now())
  returning id into lid;
  insert into league_membership (league_id, sleeper_roster_id, sleeper_owner_id, team_name, enrolled, app_user_id) values
    (lid, 1, 'slp-owner-1', 'Converters',  true,  '00000000-0000-0000-0000-000000000007'),
    (lid, 2, 'slp-owner-2', 'Holdouts',    false, null);
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values
    (lid, 1, 1, 2, 'scheduled'),
    (lid, 2, 2, 1, 'scheduled');
  -- Week 2 is the LATEST snapshot — the one the conversion must read. The
  -- week-1 rows are stale on purpose (cv12 proves materialize replaces them).
  insert into sleeper_lineup (league_id, week, roster_id, starters_json) values
    (lid, 1, 1, '[{"slot":0,"sleeper_id":"9001","player_slug":"stale-slug","full":"Probe QB One","pos":"QB","team":"KC","grp":"start"}]'),
    (lid, 2, 1, jsonb_build_array(
      -- sleeper_id 9001 but a DRIFTED slug: must land on the POOL's slug.
      jsonb_build_object('slot', 0, 'sleeper_id', '9001', 'player_slug', 'probe-qb-one-old', 'full', 'Probe QB One', 'pos', 'QB', 'team', 'KC', 'grp', 'start'),
      -- no sleeper_id (the ESPN shape): must match the pool by slug.
      jsonb_build_object('slot', 1, 'player_slug', 'probe-rb-two', 'full', 'Probe RB Two', 'pos', 'RB', 'team', 'DAL', 'grp', 'bench'),
      -- not in the pool at all: must be APPENDED to it, taxi spot kept.
      jsonb_build_object('slot', 2, 'sleeper_id', '9003', 'player_slug', 'probe-wr-extra', 'full', 'Probe WR Extra', 'pos', 'WR', 'team', 'SF', 'grp', 'taxi'),
      -- unsupported position: skipped, and NAMED in the response.
      jsonb_build_object('slot', 3, 'player_slug', 'probe-ol-nope', 'full', 'Probe OL Nope', 'pos', 'OL', 'grp', 'bench'),
      -- a K/DST fill entry (sync.js shape: no sleeper_id, no full).
      jsonb_build_object('slot', 4, 'sleeper_id', null, 'player_slug', 'kc-k', 'pos', 'K', 'grp', 'start'))),
    (lid, 2, 2, jsonb_build_array(
      jsonb_build_object('slot', 0, 'sleeper_id', '9004', 'player_slug', 'probe-qb-four', 'full', 'Probe QB Four', 'pos', 'QB', 'team', 'BUF', 'grp', 'start'),
      jsonb_build_object('slot', 1, 'sleeper_id', '9005', 'player_slug', 'probe-wr-five', 'full', 'Probe WR Five', 'pos', 'WR', 'team', 'MIA', 'grp', 'ir')));

  pool := jsonb_build_array(
    jsonb_build_object('slug', 'probe-qb-one',  'full', 'Probe QB One',  'pos', 'QB',  'team', 'KC',  'sleeper_id', '9001'),
    jsonb_build_object('slug', 'probe-rb-two',  'full', 'Probe RB Two',  'pos', 'RB',  'team', 'DAL', 'sleeper_id', '9002'),
    jsonb_build_object('slug', 'probe-qb-four', 'full', 'Probe QB Four', 'pos', 'QB',  'team', 'BUF', 'sleeper_id', '9004'),
    jsonb_build_object('slug', 'probe-wr-five', 'full', 'Probe WR Five', 'pos', 'WR',  'team', 'MIA', 'sleeper_id', '9005'),
    jsonb_build_object('slug', 'probe-rb-free', 'full', 'Probe RB Free', 'pos', 'RB',  'team', 'NYJ', 'sleeper_id', '9006'),
    jsonb_build_object('slug', 'kc-k',          'full', 'KC Kicker',     'pos', 'K',   'team', 'KC'));

  -- ══ THE GATES ═════════════════════════════════════════════════════════════
  perform probe_as('9');                                    -- a stranger
  r := convert_league_to_native(lid, pool);
  perform assert_err(r, 'forbidden', 'cv1 a stranger cannot convert');

  perform probe_as('7');                                    -- the commissioner…
  update app_user set features = coalesce(features, '{}'::jsonb) - 'native'
    where id = '00000000-0000-0000-0000-000000000007';
  r := convert_league_to_native(lid, pool);
  perform assert_err(r, 'invite-only', 'cv2 …needs the native feature, same door as creation');
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-000000000007';

  -- ══ DRY RUN: the whole conversion, then none of it ════════════════════════
  r := convert_league_to_native(lid, pool, true);
  perform assert_ok(r, 'cv3 dry run answers ok');
  perform assert_true((r ->> 'dry_run')::boolean, 'cv3a …and says it was a dry run');
  perform assert_true((r ->> 'rostered')::int = 6, 'cv3b dry run counts 6 rostered (7 entries − 1 skipped)');
  perform assert_true((r ->> 'skipped_n')::int = 1, 'cv3c …and 1 skipped');
  perform assert_true((r ->> 'unclaimed_seats')::int = 1, 'cv3d …and the open seat is flagged');
  perform assert_true((select provider from league where id = lid) = 'sleeper', 'cv4 dry run left provider alone');
  perform assert_true((select sleeper_league_id from league where id = lid) = 'probe-import-1', 'cv4a …and the key');
  perform assert_true((select count(*) from league_pool where league_id = lid) = 0, 'cv4b …and wrote no pool');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 0, 'cv4c …and no rosters');
  perform assert_true((select count(*) from draft where league_id = lid) = 0, 'cv4d …and no draft row');
  perform assert_true((select settings_json -> 'scoring' ->> 'rec' from league where id = lid) = '1',
    'cv4e …and the platform scoring blob is untouched');

  -- ══ THE REAL RUN ══════════════════════════════════════════════════════════
  r := convert_league_to_native(lid, pool);
  perform assert_ok(r, 'cv5 the commissioner converts');
  perform assert_true((r ->> 'dry_run') is null, 'cv5a not marked dry');
  perform assert_true((r ->> 'teams')::int = 2, 'cv5b two teams');
  perform assert_true((r ->> 'matched_by_id')::int = 3, 'cv5c 9001/9004/9005 matched by sleeper_id');
  perform assert_true((r ->> 'matched_by_slug')::int = 2, 'cv5d probe-rb-two + kc-k matched by slug');
  perform assert_true((r ->> 'added_to_pool')::int = 1, 'cv5e probe-wr-extra appended to the pool');
  perform assert_true((r ->> 'skipped_n')::int = 1
      and r -> 'skipped' -> 0 ->> 'pos' = 'OL', 'cv5f the OL entry is skipped and named');
  perform assert_true((r ->> 'rounds')::int = 5, 'cv5g biggest ACTIVE roster is 3 → floored to the draft minimum 5');
  perform assert_true((r ->> 'snapshot_week')::int = 2, 'cv5h read the LATEST snapshot');

  perform assert_true((select provider from league where id = lid) = 'native', 'cv6 provider flipped');
  new_key := (select sleeper_league_id from league where id = lid);
  perform assert_true(new_key like 'native-%', 'cv6a key rewritten into the native namespace');
  perform assert_true((select settings_json -> 'converted_from' ->> 'key' from league where id = lid) = 'probe-import-1',
    'cv6b …with the platform key kept as provenance');
  perform assert_true((select settings_json -> 'converted_from' ->> 'provider' from league where id = lid) = 'sleeper',
    'cv6c …and the provider it came from');
  perform assert_true((select settings_json ? 'scoring' from league where id = lid) is false,
    'cv7 the platform scoring blob no longer squats on Drip''s key');
  perform assert_true((select settings_json -> 'imported_scoring' ->> 'rec' from league where id = lid) = '1',
    'cv7a …it moved to imported_scoring intact');
  perform assert_true((select (settings_json ->> 'teams')::int from league where id = lid) = 2
      and (select (settings_json ->> 'rounds')::int from league where id = lid) = 5
      and (select settings_json ->> 'mode' from league where id = lid) = 'snake',
    'cv7b teams/rounds/mode written the way creation writes them');

  perform assert_true((select status from draft where league_id = lid) = 'complete', 'cv8 the draft is born complete');
  perform assert_true((select rounds from draft where league_id = lid) = 5, 'cv8a …with rounds = the roster cap');
  perform assert_true((select count(*) from draft_pick where league_id = lid) = 0, 'cv8b …and no fabricated pick log');

  perform assert_true((select slug from native_roster where league_id = lid and roster_id = 1 and slug = 'probe-qb-one') is not null,
    'cv9 the drifted-slug entry landed on the POOL''s slug (sleeper_id won)');
  perform assert_true(not exists (select 1 from native_roster where league_id = lid and slug = 'probe-qb-one-old'),
    'cv9a …and the drifted slug itself was never rostered');
  perform assert_true((select spot from native_roster where league_id = lid and slug = 'probe-wr-extra') = 'taxi',
    'cv9b grp taxi became the native taxi spot');
  perform assert_true((select spot from native_roster where league_id = lid and slug = 'probe-wr-five') = 'ir',
    'cv9c grp ir became the native IR spot');
  perform assert_true((select acquired from native_roster where league_id = lid and slug = 'kc-k') = 'draft',
    'cv9d the K fill entry is rostered like everyone else');
  perform assert_true((select count(*) from native_roster where league_id = lid) = 6, 'cv9e six players total');
  perform assert_true((select rank from league_pool where league_id = lid and slug = 'probe-wr-extra')
      > (select max(rank) from league_pool where league_id = lid and slug <> 'probe-wr-extra'),
    'cv9f the appended player ranks after the seeded pool');

  perform assert_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = 1) = 1
      and (select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = 2) = 2,
    'cv10 waiver order seeded in seat order');

  -- The register: the conversion wrote NOTHING (rosters landed before the
  -- draft row existed, and 0186 only logs once status = 'complete')…
  perform assert_true((select count(*) from league_txn where league_id = lid) = 0,
    'cv11 the conversion is not transaction-log spam');

  -- Materialization: the stale week-1 snapshot was rewritten from the rosters.
  snap := (select starters_json from sleeper_lineup where league_id = lid and week = 1 and roster_id = 1);
  perform assert_true(snap @> '[{"slug": "probe-qb-one"}]', 'cv12 week 1 now holds the pool slug');
  perform assert_true(not snap @> '[{"slug": "stale-slug"}]', 'cv12a …and the stale slug is gone');
  perform assert_true((select count(*) from sleeper_lineup where league_id = lid and week = 2 and roster_id = 2) = 1,
    'cv12b week 2 rematerialized too');

  -- ══ THE LEAGUE IS NATIVE NOW ══════════════════════════════════════════════
  r := convert_league_to_native(lid, pool);
  perform assert_err(r, 'already a native league', 'cv13 converting twice is refused');

  r := drop_player(lid, 1, 'probe-rb-two');
  perform assert_ok(r, 'cv14 native machinery answers: a drop works');
  perform assert_true((select count(*) from league_txn where league_id = lid and kind = 'drop' and slug = 'probe-rb-two') = 1,
    'cv14a …and NOW the register logs — the trigger was live all along');
  r := add_free_agent(lid, 1, 'probe-rb-free');
  perform assert_ok(r, 'cv14b …and a free-agent add works');

  -- ══ THE OTHER REFUSALS, each on its own fixture ═══════════════════════════
  insert into league (sleeper_league_id, season, name, provider, commissioner_id)
  values ('probe-import-2', '2026', 'Too Late', 'sleeper', '00000000-0000-0000-0000-000000000007')
  returning id into lid2;
  insert into league_membership (league_id, sleeper_roster_id, team_name) values (lid2, 1, 'A'), (lid2, 2, 'B');
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (lid2, 1, 1, 2, 'locked');
  insert into sleeper_lineup (league_id, week, roster_id, starters_json)
  values (lid2, 1, 1, '[{"slot":0,"player_slug":"probe-qb-one","pos":"QB","grp":"start"}]');
  r := convert_league_to_native(lid2, pool);
  perform assert_err(r, 'season already underway', 'cv15 a league mid-season is refused');

  insert into league (sleeper_league_id, season, name, provider, commissioner_id)
  values ('probe-import-3', '2026', 'Never Synced', 'sleeper', '00000000-0000-0000-0000-000000000007')
  returning id into lid3;
  insert into league_membership (league_id, sleeper_roster_id, team_name) values (lid3, 1, 'A'), (lid3, 2, 'B');
  r := convert_league_to_native(lid3, pool);
  perform assert_err(r, 'no synced rosters', 'cv16 a league with no lineups is refused');

  insert into league (sleeper_league_id, season, name, provider)
  values ('probe-import-4', '2026', 'Headless', 'sleeper')
  returning id into lid4;
  insert into league_membership (league_id, sleeper_roster_id, team_name, enrolled, app_user_id)
  values (lid4, 1, 'A', true, '00000000-0000-0000-0000-000000000008');
  perform probe_as('8');                                    -- a member, not the commissioner
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-000000000008';
  r := convert_league_to_native(lid4, pool);
  perform assert_err(r, 'forbidden', 'cv17 a plain member cannot convert (no commissioner seat exists at all)');

  raise notice 'convert-league probes done';
end $$;

select 'ALL CONVERT-LEAGUE PROBES PASSED' as status;
