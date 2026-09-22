-- 0347/0348 probes: THE SHELF SHOWS THE WEEK, and the report's chat switch.
--   • sh1 the shelf carries only MY leagues, and nobody else's;
--   • sh2 my game comes back as me/opp rather than home/away — whichever side
--         of the fixture the schedule put me on;
--   • sh3 …with both records, from the same standings the league page reads;
--   • sh4 a week with no fixture for my seat is a null game, not a 0-0;
--   • sh5 the unread count rides along, so the list costs one call not N;
--   • sh6 an archived league is off the shelf;
--   • sh7 report_chat defaults ON for a league that predates the setting —
--         the 0343 NULL trap, which cost a whole fleet its waiver schedule;
--   • sh8 …and the commissioner can turn it off; a manager cannot.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function sh_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function sh_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%'
  then raise exception 'PROBE FAIL % — %', msg, r; end if; end $$;
create or replace function sh_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000047' || u, false); perform set_config('app.email', 'sh' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000470' || g)::uuid, 'sh0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-00000000470' || g)::uuid, 'sh0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where email like 'sh0%@test.dev';

do $$
declare r jsonb; lid uuid; other uuid; sl jsonb; mine jsonb; g jsonb; seas text := '2026';
        me uuid := '00000000-0000-0000-0000-000000004701';
        mid uuid; wk int := 88;
begin
  perform sh_as('01');
  r := create_native_league('Shelf', seas, 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;
  -- A league I am NOT in, to prove the shelf is mine and not the database's.
  perform sh_as('02');
  other := (create_native_league('NotMine', seas, 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic') ->> 'league_id')::uuid;
  perform sh_as('01');

  -- My seat is 1 (the creator's). Put me on the AWAY side on purpose: the
  -- shelf must read from the seat, not from the fixture.
  delete from matchup where league_id = lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (lid, wk, 2, 1, 'final', 111.7, 147.4) returning id into mid;
  -- A finished earlier week, so the standings have something to say.
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (lid, wk - 1, 1, 2, 'final', 120.0, 100.0);

  -- ── sh1. mine, and only mine ──
  sl := my_league_slate();
  perform sh_true((sl ->> 'ok')::boolean, 'sh1 the shelf loads: ' || sl::text);
  perform sh_true(exists (select 1 from jsonb_array_elements(sl -> 'leagues') x where (x ->> 'league_id')::uuid = lid),
    'sh1 my league is on it');
  perform sh_true(not exists (select 1 from jsonb_array_elements(sl -> 'leagues') x where (x ->> 'league_id')::uuid = other),
    'sh1 …and a league I am not in is not');

  select x into mine from jsonb_array_elements(sl -> 'leagues') x where (x ->> 'league_id')::uuid = lid;
  g := mine -> 'game';

  -- ── sh2. me/opp, not home/away ──
  perform sh_true((mine ->> 'roster_id')::int = 1, 'sh2 the shelf knows which seat is mine');
  perform sh_true((g -> 'me' ->> 'roster_id')::int = 1 and (g -> 'opp' ->> 'roster_id')::int = 2,
    'sh2 I am `me` even filed as the away side: ' || g::text);
  perform sh_true((g -> 'me' ->> 'points')::numeric = 147.4 and (g -> 'opp' ->> 'points')::numeric = 111.7,
    'sh2 …and the scores follow the seat, not the fixture');

  -- ── sh3. the records, from the league's own standings ──
  perform sh_true((g -> 'me' -> 'record' ->> 'wins')::int = 2 and (g -> 'me' -> 'record' ->> 'losses')::int = 0,
    'sh3 my record comes from league_standings, not a second expression: ' || (g -> 'me')::text);
  perform sh_true((g -> 'opp' -> 'record' ->> 'losses')::int = 2,
    'sh3 …and so does the opponent''s');

  -- ── sh4. no fixture is a NULL game, never a 0-0 ──
  -- A card that prints a score is claiming a game was played.
  update matchup set home_roster_id = 3, away_roster_id = 4 where id = mid;
  update matchup set home_roster_id = 3, away_roster_id = 4 where league_id = lid and week = wk - 1;
  select x into mine from jsonb_array_elements(my_league_slate() -> 'leagues') x where (x ->> 'league_id')::uuid = lid;
  perform sh_true(mine -> 'game' = 'null'::jsonb or mine ->> 'game' is null,
    'sh4 a week with no fixture for my seat draws no game: ' || mine::text);
  update matchup set home_roster_id = 2, away_roster_id = 1 where id = mid;
  update matchup set home_roster_id = 1, away_roster_id = 2 where league_id = lid and week = wk - 1;

  -- ── sh5. the badge rides along ──
  insert into league_message (league_id, author_id, kind, body, mentions)
    values (lid, '00000000-0000-0000-0000-000000004702', 'text', 'anybody home', '{}');
  select x into mine from jsonb_array_elements(my_league_slate() -> 'leagues') x where (x ->> 'league_id')::uuid = lid;
  perform sh_true((mine -> 'unread' ->> 'league')::int = 1,
    'sh5 unread comes back on the same call — the list costs one round trip, not one per league');
  perform sh_true(mine -> 'unread' -> 'ok' is null,
    'sh5 …without chat_unread''s own ok flag, which is the caller''s business and not a count');

  -- ── sh6. the shelf (0239) is off the shelf ──
  insert into user_league_archive (app_user_id, league_id) values (me, lid) on conflict do nothing;
  perform sh_true(not exists (select 1 from jsonb_array_elements(my_league_slate() -> 'leagues') x
                               where (x ->> 'league_id')::uuid = lid),
    'sh6 an archived league is not on the shelf');
  delete from user_league_archive where app_user_id = me and league_id = lid;

  -- ── sh7. 0348 defaults ON, through a coalesce ──
  -- Every league alive today predates this key, so it is SQL NULL for all of
  -- them. Read with `= true` the whole fleet would have gone silent on a
  -- default nobody chose — which is exactly what 0343 found on
  -- league_waiver_day_clears.
  perform sh_true(league_report_chat(lid),
    'sh7 a league with no report_chat key still posts — an absent key is NULL, not false');
  perform sh_true((league_report_weeks(lid) ->> 'report_chat')::boolean,
    'sh7 …and the console is told so on the call it already makes');

  -- ── sh8. the switch, and who may throw it ──
  perform sh_as('02');
  perform sh_refused(commish_set_report_chat(lid, false), 'commissioner', 'sh8 a stranger cannot quiet a league');
  perform sh_as('01');
  perform sh_true((commish_set_report_chat(lid, false) ->> 'ok')::boolean, 'sh8 the commissioner can');
  perform sh_true(not league_report_chat(lid), 'sh8 …and it takes');
  perform sh_true((league_report_weeks(lid) ->> 'report_chat')::boolean is false,
    'sh8 …and the console sees it');
  -- Two statements, not one `and`: league_report_chat is STABLE, so inside a
  -- single expression it reads the snapshot taken before the write beside it
  -- and would answer about the row as it was. That is Postgres being correct
  -- and the probe being sloppy.
  perform sh_true((commish_set_report_chat(lid, true) ->> 'ok')::boolean, 'sh8 …and back on again');
  perform sh_true(league_report_chat(lid), 'sh8 …and that takes too');

  delete from league_message where league_id = lid;
  delete from matchup where league_id = lid;
end $$;

select 'ALL SHELF PROBES PASS' as result;
drop function if exists sh_true(boolean, text);
drop function if exists sh_refused(jsonb, text, text);
drop function if exists sh_as(text);
