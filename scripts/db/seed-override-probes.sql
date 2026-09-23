-- 0359 probes: THE COMMISSIONER SEEDS THE BRACKET.
--   • the default order is the league's own seeding;
--   • seeding as the standings needs no reason and says nothing;
--   • seeding against them needs a reason, and the league is told the seeds;
--   • the bracket records by_hand; saved round-1 lineups are counted as cleared;
--   • a manager is refused; once underway the generator's lock still holds.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function so_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function so_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function so_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function so_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000022' || u, false);
      perform set_config('app.email', 'so' || u || '@test.dev', false); end $$;
insert into auth.users (id, email)
  select ('00000000-0000-0000-0000-0000000022' || lpad(g::text, 2, '0'))::uuid, 'so' || lpad(g::text, 2, '0') || '@test.dev'
  from generate_series(1, 4) g on conflict (id) do nothing;
insert into app_user (id, email)
  select ('00000000-0000-0000-0000-0000000022' || lpad(g::text, 2, '0'))::uuid, 'so' || lpad(g::text, 2, '0') || '@test.dev'
  from generate_series(1, 4) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id::text like '00000000-0000-0000-0000-0000000022%';

do $$
declare r jsonb; lid uuid; code text; d jsonb; n int; line text;
begin
  perform so_as('01');
  r := create_native_league('Seeded', '2026', 4, 7, 60);
  perform so_ok(r, 's0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform so_as('02'); perform so_ok(native_join(code, 'SO-B'), 's0 B');
  perform so_as('03'); perform so_ok(native_join(code, 'SO-C'), 's0 C');
  perform so_as('04'); perform so_ok(native_join(code, 'SO-D'), 's0 D');
  perform so_as('01');
  perform so_ok(set_playoff_rules(lid, 4, 15), 's0 four-team playoffs from week 15');
  update draft set status = 'complete' where league_id = lid;
  -- 1 beats 2 and 3 beats 4, then 1 beats 3 and 2 beats 4: the standings read 1, 2|3, 4.
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 1, 1, 2, 'final', 100, 90), (lid, 1, 3, 4, 'final', 80, 70),
    (lid, 2, 1, 3, 'final', 100, 60), (lid, 2, 2, 4, 'final', 90, 50);

  -- ── s1. the default order ──
  d := league_default_seeds(lid) -> 'seeds';
  perform so_true(jsonb_array_length(d) = 4 and (d ->> 0)::int = 1 and (d ->> 3)::int = 4, 's1 default seeds: ' || d::text);

  -- ── s2. as the standings: no reason needed, nothing said ──
  select count(*) into n from league_message where league_id = lid;
  r := commish_seed_playoffs(lid, d, null);
  perform so_ok(r, 's2 seeded as the standings');
  perform so_true((r ->> 'by_hand')::boolean = false, 's2 not by hand');
  perform so_true((select count(*) from league_message where league_id = lid) = n, 's2 nothing said');
  perform so_true((select home_roster_id = (d ->> 0)::int and away_roster_id = (d ->> 3)::int from matchup
                    where league_id = lid and is_playoff and bracket_pos = 1), 's2 1 plays 4');

  -- ── s3. against the standings ──
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    select id, '00000000-0000-0000-0000-000000002201', 'wk', 'S1', 'somebody' from matchup where league_id = lid and is_playoff and bracket_pos = 1;
  perform so_refused(commish_seed_playoffs(lid, '[4,3,2,1]'::jsonb, null), 'say why', 's3 needs a reason');
  r := commish_seed_playoffs(lid, '[4,3,2,1]'::jsonb, 'the tiebreak was misapplied');
  perform so_ok(r, 's3 seeded by hand');
  perform so_true((r ->> 'by_hand')::boolean and (r ->> 'lineups_cleared')::int = 1, 's3 by hand, one saved lineup cleared: ' || r::text);
  perform so_true((select settings_json #>> '{playoff_bracket,by_hand}' from league where id = lid) = 'true', 's3 recorded');
  perform so_true((select home_roster_id = 4 and away_roster_id = 1 from matchup where league_id = lid and is_playoff and bracket_pos = 1), 's3 4 plays 1');
  select body into line from league_message where league_id = lid order by created_at desc, id desc limit 1;
  perform so_true(line like '🏆 The commissioner seeded the playoffs: #1 SO-D · #2 SO-C · #3 SO-B · #4 % — the tiebreak was misapplied',
    's3 told: ' || coalesce(line, '∅'));

  -- ── s4. refusals ──
  perform so_refused(commish_seed_playoffs(lid, '[1,1,2,3]'::jsonb, 'x'), 'different', 's4 a team twice');
  perform so_as('02');
  perform so_refused(commish_seed_playoffs(lid, d, null), 'commissioner only', 's4 a manager');
  perform so_as('01');
  update matchup set status = 'live' where league_id = lid and is_playoff;
  perform so_refused(commish_seed_playoffs(lid, d, null), 'underway', 's4 underway');
end $$;
select 'ALL SEED-OVERRIDE PROBES PASS';
