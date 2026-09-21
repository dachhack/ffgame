-- 0325 probes: WEEKLY AWARDS AND BADGES.
--   • the built-in four run for a league that has configured nothing;
--   • the rule grammar: points/low, margin/high, and the one every league
--     invents — the highest score that still LOST;
--   • ties award everybody tied; a week that is not final awards nobody;
--     preseason (101+) awards nobody; the run is idempotent and re-runnable
--     when a new award is added later;
--   • a coin prize is paid once;
--   • the first edit materializes the built-ins instead of deleting them,
--     and deleting an award keeps what it already handed out;
--   • badges: defined, granted with the season, revoked, and carried into
--     the history's manager lines.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function aw_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function aw_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function aw_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function aw_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000016' || u, false); perform set_config('app.email', 'aw' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001601', 'aw01@test.dev'), ('00000000-0000-0000-0000-000000001602', 'aw02@test.dev'),
  ('00000000-0000-0000-0000-000000001603', 'aw03@test.dev'), ('00000000-0000-0000-0000-000000001604', 'aw04@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001601', 'aw01@test.dev'), ('00000000-0000-0000-0000-000000001602', 'aw02@test.dev'),
  ('00000000-0000-0000-0000-000000001603', 'aw03@test.dev'), ('00000000-0000-0000-0000-000000001604', 'aw04@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001601', '00000000-0000-0000-0000-000000001602',
              '00000000-0000-0000-0000-000000001603', '00000000-0000-0000-0000-000000001604');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c int; d int; aws jsonb; win int;
begin
  perform aw_as('01');
  r := create_native_league('Awards', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform aw_ok(r, 'aw0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform aw_as('02'); perform aw_ok(native_join(code, 'AW-B'), 'aw0 B joins');
  perform aw_as('03'); perform aw_ok(native_join(code, 'AW-C'), 'aw0 C joins');
  perform aw_as('04'); perform aw_ok(native_join(code, 'AW-D'), 'aw0 D joins');
  perform aw_as('01');
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001601';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001602';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001603';
  select sleeper_roster_id into d from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001604';
  update draft set status = 'complete' where league_id = lid;

  -- ── aw1. the built-ins, with nothing configured ──
  aws := league_awards(lid);
  perform aw_true((select count(*) from jsonb_array_elements(aws -> 'awards') e) = 4
    and (select bool_and((e ->> 'is_default')::boolean) from jsonb_array_elements(aws -> 'awards') e),
    'aw1 four built-ins, flagged as defaults');
  -- Week 1: A 150 beats B 100 (the beating, and the high score);
  --         C 80 beats D 60 (the low score). Nobody is unlucky yet —
  --         the highest LOSING score is B's 100.
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 1, a, b, 'final', 150.0, 100.0),
    (lid, 1, c, d, 'final', 80.0, 60.0);
  r := award_week(lid, 1);
  perform aw_true((r ->> 'awarded')::int = 4, 'aw1 four awards handed out');
  perform aw_true((select roster_id from league_award_win where league_id = lid and week = 1 and key = 'high') = a,
    'aw1 the high score');
  perform aw_true((select roster_id from league_award_win where league_id = lid and week = 1 and key = 'low') = d,
    'aw1 the low score');
  perform aw_true((select roster_id from league_award_win where league_id = lid and week = 1 and key = 'blowout') = a,
    'aw1 the biggest beating');
  perform aw_true((select roster_id from league_award_win where league_id = lid and week = 1 and key = 'unlucky') = b,
    'aw1 the highest score that still lost');
  perform aw_true(exists (select 1 from league_message where league_id = lid and kind = 'txn'
    and txn ->> 'kind' = 'award' and body ilike '%Week 1 awards%'), 'aw1 the league hears about it');
  -- idempotent
  r := award_week(lid, 1);
  perform aw_true((r ->> 'awarded')::int = 0, 'aw1 a second run hands out nothing');

  -- ── aw2. the gates ──
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 2, a, b, 'final', 90.0, 80.0),
    (lid, 2, c, d, 'scheduled', null, null);
  r := award_week(lid, 2);
  perform aw_true((r ->> 'awarded')::int = 0 and (r ->> 'skipped') = 'week not final', 'aw2 half a week has no high score');
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 101, a, b, 'final', 400.0, 10.0);
  r := award_week(lid, 101);
  perform aw_true((r ->> 'skipped') = 'preseason', 'aw2 preseason hands out nothing');
  update matchup set status = 'final', home_final = 70.0, away_final = 70.0
   where league_id = lid and week = 2 and home_roster_id = c;
  r := award_week(lid, 2);
  perform aw_true((r ->> 'awarded')::int >= 4, 'aw2 the finished week is awarded');
  -- C and D tied at 70: both are the low score that week
  perform aw_true((select count(*) from league_award_win where league_id = lid and week = 2 and key = 'low') = 2,
    'aw2 a tie awards everybody tied');

  -- ── aw3. the league writes its own ──
  perform aw_as('02');
  perform aw_refused(commish_set_award(lid, 'jug', 'The Brown Jug'), 'commissioner only', 'aw3 a manager cannot');
  perform aw_as('01');
  perform aw_refused(commish_set_award(lid, 'jug', 'The Brown Jug', '🍺', 'vibes'), 'the metric is', 'aw3 an unknown metric');
  perform aw_refused(commish_set_award(lid, 'newone'), 'needs a name', 'aw3 a new award needs a name');
  perform aw_ok(commish_set_award(lid, 'jug', 'The Brown Jug', '🍺', 'points', 'low', 'win', 25), 'aw3 won ugly, for 25 coin');
  perform aw_true((select count(*) from league_award where league_id = lid) = 5,
    'aw3 the first edit wrote the built-ins down beside it');
  perform aw_ok(commish_set_award(lid, 'low', null, null, null, null, null, null, false), 'aw3 the low score is switched off');
  aws := league_awards(lid);
  perform aw_true((select count(*) from jsonb_array_elements(aws -> 'awards') e) = 4
    and not (select bool_or((e ->> 'is_default')::boolean) from jsonb_array_elements(aws -> 'awards') e),
    'aw3 four live awards, none of them defaults now');
  -- week 3: A 120 beats B 110; C 95 beats D 20. The ugliest win is C's 95.
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 3, a, b, 'final', 120.0, 110.0),
    (lid, 3, c, d, 'final', 95.0, 20.0);
  r := award_week(lid, 3);
  perform aw_true((select roster_id from league_award_win where league_id = lid and week = 3 and key = 'jug') = c,
    'aw3 the jug goes to the ugliest win');
  perform aw_true(not exists (select 1 from league_award_win where league_id = lid and week = 3 and key = 'low'),
    'aw3 a switched-off award hands out nothing');
  perform aw_true((select coins from team_wallet where league_id = lid and roster_id = c) = 25,
    'aw3 the prize was paid');
  perform award_week(lid, 3);
  perform aw_true((select coins from team_wallet where league_id = lid and roster_id = c) = 25,
    'aw3 and paid exactly once');
  -- an award added later can still be run over an old week
  perform aw_ok(commish_set_award(lid, 'sandbag', 'Sandbagger', '🏖', 'points_against', 'low'), 'aw3 a new award');
  r := award_week(lid, 1);
  -- Two new rows, not one: the jug was added after week 1 too, and it fills
  -- in there as well (C won ugliest that week). The four already handed out
  -- are untouched — which is the point of the re-run being safe.
  perform aw_true((r ->> 'awarded')::int = 2
    and (select roster_id from league_award_win where league_id = lid and week = 1 and key = 'sandbag') = c
    and (select roster_id from league_award_win where league_id = lid and week = 1 and key = 'high') = a,
    'aw3 a new award fills in an old week without disturbing it');
  -- deleting keeps the record
  r := commish_delete_award(lid, 'jug');
  perform aw_ok(r, 'aw3 the jug is retired');
  perform aw_true((r ->> 'kept_wins')::int = 2, 'aw3 and what it handed out is kept');

  -- ── aw4. badges ──
  perform aw_refused(commish_grant_badge(lid, a, 'goat'), 'make it first', 'aw4 a badge must exist');
  perform aw_ok(commish_set_badge(lid, 'goat', 'The GOAT', '🐐', 'decided by acclaim'), 'aw4 the badge exists');
  perform aw_refused(commish_grant_badge(lid, 99, 'goat'), 'no such team', 'aw4 no such seat');
  perform aw_ok(commish_grant_badge(lid, a, 'goat', null, 'for the 150'), 'aw4 pinned on A');
  perform aw_true((select season from league_badge_grant where league_id = lid and key = 'goat') = '2026',
    'aw4 stamped with the season');
  perform aw_true(exists (select 1 from league_message where league_id = lid and kind = 'txn'
    and txn ->> 'kind' = 'badge'), 'aw4 the league hears about it');
  aws := league_awards(lid);
  perform aw_true((select count(*) from jsonb_array_elements(aws -> 'grants') e) = 1, 'aw4 the grant reads back');
  perform aw_ok(commish_revoke_badge(lid, a, 'goat'), 'aw4 revoked');
  perform aw_refused(commish_revoke_badge(lid, a, 'goat'), 'does not hold it', 'aw4 and cannot be revoked twice');
  perform aw_ok(commish_grant_badge(lid, a, 'goat'), 'aw4 pinned again');

  -- ── aw5. the trophy case in the history ──
  aws := league_history(lid);
  perform aw_true((select (e ->> 'awards')::int from jsonb_array_elements(aws -> 'managers') e
                    where e ->> 'app_user_id' = '00000000-0000-0000-0000-000000001601') >= 3,
    'aw5 A''s award count rides his all-time line');
  perform aw_true((select jsonb_array_length(e -> 'badges') from jsonb_array_elements(aws -> 'managers') e
                    where e ->> 'app_user_id' = '00000000-0000-0000-0000-000000001601') = 1,
    'aw5 and so does his badge');
  perform aw_true((select jsonb_array_length(e -> 'badges') from jsonb_array_elements(aws -> 'managers') e
                    where e ->> 'app_user_id' = '00000000-0000-0000-0000-000000001602') = 0,
    'aw5 B has none');

  -- ── aw6. the sweep does what the worker will ──
  delete from league_award_win where league_id = lid and week = 3;
  r := award_sweep();
  perform aw_true((r ->> 'weeks')::int >= 1
    and exists (select 1 from league_award_win where league_id = lid and week = 3),
    'aw6 the sweep awards a finished week nobody had awarded');
end $$;

select 'ALL AWARD PROBES PASS' as result;
drop function if exists aw_true(boolean, text);
drop function if exists aw_ok(jsonb, text);
drop function if exists aw_refused(jsonb, text, text);
drop function if exists aw_as(text);
