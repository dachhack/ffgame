-- 0339 probes: THE COMMISSIONER REPOSTS A WEEK.
--   • rr1 a manager cannot; the commissioner can see the week list;
--   • rr2 the list carries the gate, the chat line and the drift count;
--   • rr3 the guard: a week still being played is refused, with the reason;
--   • rr4 …and a SHORT feed is refused too — the exact shape of v0.457.0;
--   • rr5 a complete week queues one request, and asking twice does not queue
--         a second;
--   • rr6 nothing stamped is refused before the guard ever gets involved;
--   • rr7 a super-admin is NOT guarded — the override stays an override.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function rr_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function rr_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — %', msg, r; end if; end $$;
create or replace function rr_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%'
  then raise exception 'PROBE FAIL % — %', msg, r; end if; end $$;
create or replace function rr_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000039' || u, false); perform set_config('app.email', 'rr' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) select ('00000000-0000-0000-0000-00000000390' || g)::uuid, 'rr0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
insert into app_user (id, email) select ('00000000-0000-0000-0000-00000000390' || g)::uuid, 'rr0' || g || '@test.dev' from generate_series(1,2) g on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where email like 'rr0%@test.dev';

do $$
declare r jsonb; lid uuid; wks jsonb; w2 jsonb; mid uuid; seas text := '2026';
begin
  perform rr_as('01');
  r := create_native_league('ReportRegen', seas, 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  lid := (r ->> 'league_id')::uuid;

  -- A week of our own, with a slate and a feed we control.
  delete from nfl_slate where season = seas and week = 97;
  delete from game_feed where week = 97;
  insert into nfl_slate (season, week, home, away, win, kickoff)
    values (seas, 97, 'WSH', 'DAL', 'early', now() - interval '4 hours'),
           (seas, 97, 'PHI', 'NYG', 'late',  now() - interval '3 hours');
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final)
    values (lid, 97, 1, 2, 'final', 101.5, 99.5) returning id into mid;

  -- ── rr1. who may ask ──
  perform rr_as('02');
  perform rr_refused(league_report_weeks(lid), 'forbidden', 'rr1 a non-commissioner cannot read the week list');
  perform rr_refused(commish_request_week_report(lid, 97), 'forbidden', 'rr1 …nor file a request');
  perform rr_as('01');
  perform rr_ok(league_report_weeks(lid), 'rr1 the commissioner can');

  -- ── rr2. what the list says ──
  wks := league_report_weeks(lid) -> 'weeks';
  perform rr_true(jsonb_array_length(wks) = 1, 'rr2 one week with matchups');
  w2 := wks -> 0;
  perform rr_true((w2 ->> 'week')::int = 97 and (w2 ->> 'matchups')::int = 1
              and (w2 ->> 'final')::int = 1 and (w2 ->> 'stamped')::int = 1,
    'rr2 the worker''s own gate is carried: ' || w2::text);
  perform rr_true((w2 ->> 'report')::boolean is false and w2 ->> 'posted_at' is null,
    'rr2 nothing posted yet, and the panel can say so without a second call');
  perform rr_true((w2 ->> 'drifted')::int = 0,
    'rr2 a final with NO window rows has nothing to disagree with, so it is not drift');
  -- Give it window rows that do not add up to the stored final, and it is.
  insert into matchup_state (matchup_id, game_window, home_score, away_score)
    values (mid, 'early', 50.0, 40.0) on conflict do nothing;
  perform rr_true(((league_report_weeks(lid) -> 'weeks' -> 0) ->> 'drifted')::int = 1,
    'rr2 …and a stored 101.5 over window rows summing to 50.0 is');
  delete from matchup_state where matchup_id = mid;

  -- ── rr3. the guard: a game still on ──
  insert into game_feed (week, game_id, key, away, home, state)
    values (97, 'g1', 'DAL@WSH', 'DAL', 'WSH', 'post'),
           (97, 'g2', 'NYG@PHI', 'NYG', 'PHI', 'in');
  perform rr_true(not (nfl_week_complete(97, seas) ->> 'complete')::boolean,
    'rr3 a week with a game still running is not complete');
  perform rr_refused(commish_request_week_report(lid, 97), 'still being played',
    'rr3 …and the commissioner is refused, because this is v0.457.0''s bug with a button on it');
  perform rr_refused(commish_request_week_report(lid, 97), '1 game is not final yet',
    'rr3 the refusal counts the games rather than saying "not yet"');
  perform rr_true(not exists (select 1 from report_request where league_id = lid and week = 97),
    'rr3 and nothing was queued');

  -- ── rr4. the guard: a SHORT feed, which is the bug's real shape ──
  -- `games.every(g => g.completed)` is vacuously true over a list missing the
  -- game still being played. Every game the feed HOLDS is post here.
  delete from game_feed where week = 97 and game_id = 'g2';
  perform rr_true(not (nfl_week_complete(97, seas) ->> 'complete')::boolean,
    'rr4 one game of two, all post, is still not a complete week');
  perform rr_refused(commish_request_week_report(lid, 97), 'holds 1 of 2',
    'rr4 …and the refusal names what is missing, not just that something is');

  -- ── rr5. a complete week queues exactly one request ──
  insert into game_feed (week, game_id, key, away, home, state)
    values (97, 'g2', 'NYG@PHI', 'NYG', 'PHI', 'post');
  perform rr_true((nfl_week_complete(97, seas) ->> 'complete')::boolean, 'rr5 now the week is in');
  r := commish_request_week_report(lid, 97);
  perform rr_ok(r, 'rr5 the commissioner may post it');
  perform rr_true((r ->> 'queued')::boolean, 'rr5 …and it is queued');
  perform rr_true((select count(*) from report_request where league_id = lid and week = 97) = 1,
    'rr5 one row in the queue');
  r := commish_request_week_report(lid, 97);
  perform rr_ok(r, 'rr5 asking again is not an error');
  perform rr_true((select count(*) from report_request where league_id = lid and week = 97) = 1,
    'rr5 …and still one row — a double tap is not a second post');
  perform rr_true(r ->> 'note' ilike '%already queued%', 'rr5 and it says so: ' || coalesce(r ->> 'note', 'null'));

  -- ── rr6. nothing stamped ──
  update matchup set home_final = null, away_final = null where id = mid;
  delete from report_request where league_id = lid and week = 97;
  perform rr_refused(commish_request_week_report(lid, 97), 'nothing to report',
    'rr6 a week with no stamped final is refused before anything is queued');
  update matchup set home_final = 101.5, away_final = 99.5 where id = mid;

  -- ── rr7. the override is still an override ──
  -- An admin door that asks permission is not one; 0277's path stays unguarded
  -- and this one is its guarded twin, not its replacement.
  delete from game_feed where week = 97;                    -- week wide open again
  perform rr_true(not (nfl_week_complete(97, seas) ->> 'complete')::boolean, 'rr7 the week is not in');
  perform rr_refused(commish_request_week_report(lid, 97), 'not fully in', 'rr7 the commissioner is held');
  insert into app_admin (email) values ('rr01@test.dev') on conflict do nothing;
  perform rr_ok(commish_request_week_report(lid, 97), 'rr7 …and an admin is not');
  delete from report_request where league_id = lid and week = 97;
  perform rr_ok(admin_request_week_report(lid, 97), 'rr7 0277''s own door is untouched');
  delete from app_admin where email = 'rr01@test.dev';

  delete from game_feed where week = 97;
  delete from nfl_slate where season = seas and week = 97;
end $$;

select 'ALL REPORT-REGEN PROBES PASS' as result;
drop function if exists rr_true(boolean, text);
drop function if exists rr_ok(jsonb, text);
drop function if exists rr_refused(jsonb, text, text);
drop function if exists rr_as(text);
