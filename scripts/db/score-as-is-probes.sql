-- 0378 probes: SCORING WEEKS ALREADY PLAYED.
--
--   • a classic league made mid-week starts next week; the commissioner can
--     backdate its season to any week already under way, re-laying the
--     schedule from there, and the draft's re-lay keeps it;
--   • not past the first open week, not before Week 1, not once results exist;
--   • commish_score_as_is queues a week that has kicked off, isn't final and
--     isn't already queued — drafted leagues only, classic only, commish only;
--   • score_as_is_state lists the weeks that can be scored.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on

create or replace function sa_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function sa_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function sa_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function sa_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000051' || u, false); perform set_config('app.email', 'sa' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000005101', 'sa01@test.dev'),
  ('00000000-0000-0000-0000-000000005102', 'sa02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000005101', 'sa01@test.dev'),
  ('00000000-0000-0000-0000-000000005102', 'sa02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000005101', '00000000-0000-0000-0000-000000005102');

do $$
declare r jsonb; lid uuid; dl uuid; code text; w int;
begin
  -- Season 2031: weeks 1–3 played, week 4 under way (Thursday gone, Sunday ahead), 5+ ahead.
  for w in 1 .. 14 loop
    insert into nfl_slate (season, week, home, away, win, kickoff, game_id) values
      ('2031', w, 'KC', 'BUF', 'wk', now() + make_interval(days => (w - 4) * 7) - interval '2 days', 'sa' || w || 'a'),
      ('2031', w, 'DAL', 'PHI', 'wk', now() + make_interval(days => (w - 4) * 7) + interval '1 day', 'sa' || w || 'b')
    on conflict do nothing;
  end loop;

  perform sa_as('01');
  r := create_native_league('Score As Is', '2031', 2, 6, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform sa_ok(r, 'sa0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform sa_as('02'); perform sa_ok(native_join(code, 'SA-2'), 'sa0 join'); perform sa_as('01');
  perform sa_ok(native_generate_schedule(lid, 14), 'sa0 schedule');
  perform sa_true((select min(week) from matchup where league_id = lid) = 5, 'sa0a THE PROBLEM: a league made mid-week starts next week');

  -- ══ sa1. BACKDATING ═══════════════════════════════════════════════════════
  r := score_as_is_state(lid);
  perform sa_true((r ->> 'natural_open')::int = 5 and (r ->> 'can_backdate')::boolean and (r ->> 'first_week')::int = 5, 'sa1 the state: open week 5, can backdate');
  perform sa_err(commish_backdate_season(lid, 5), 'only for weeks already under way', 'sa1a a week not yet begun is not a backdate');
  perform sa_err(commish_backdate_season(lid, 0), 'as early as Week 1', 'sa1b nor is a week before Week 1');
  perform sa_ok(commish_backdate_season(lid, 4), 'sa1c back to the week under way');
  perform sa_true((select min(week) from matchup where league_id = lid) = 4, 'sa1d the schedule now starts in Week 4');
  perform sa_ok(commish_backdate_season(lid, 1), 'sa1e …or all the way to Week 1');
  perform sa_true((select min(week) from matchup where league_id = lid) = 1
              and (select count(distinct week) from matchup where league_id = lid) >= 10, 'sa1f every week from 1 has matchups');
  perform sa_true((select body from league_message where league_id = lid order by id desc limit 1) like 'The season now starts in Week 1.%', 'sa1g the league hears about it');
  perform sa_true(league_first_open_week(lid, '2031') = 1, 'sa1h the league''s first week reads the backdate');
  r := _shift_schedule_to_open_week(lid);
  perform sa_true(r ->> 'why' = 'backdated' and (select min(week) from matchup where league_id = lid) = 1, 'sa1i the draft''s re-lay keeps it: ' || r::text);
  perform sa_as('02');
  perform sa_err(commish_backdate_season(lid, 2), 'commissioner only', 'sa1j a member cannot');
  perform sa_as('01');

  -- ══ sa2. SCORING A WEEK ═══════════════════════════════════════════════════
  perform sa_err(commish_score_as_is(lid, 3), 'draft first', 'sa2 not before the draft');
  update draft set status = 'complete' where league_id = lid;
  perform sa_err(commish_score_as_is(lid, 5), 'has kicked off yet', 'sa2a a week ahead is set as usual');
  perform sa_err(commish_score_as_is(lid, 17), 'no matchups in Week 17', 'sa2b a week with no matchups');
  perform sa_ok(commish_score_as_is(lid, 3), 'sa2c Week 3, already played');
  perform sa_true((select count(*) from score_request where league_id = lid and week = 3 and done_at is null) = 1, 'sa2d queued for the worker');
  perform sa_err(commish_score_as_is(lid, 3), 'already being scored', 'sa2e once');
  perform sa_ok(commish_score_as_is(lid, 4), 'sa2f the week under way too');
  r := score_as_is_state(lid);
  perform sa_true(jsonb_array_length(r -> 'weeks') = 4 and (r -> 'weeks' -> 2 -> 'request' ->> 'id') is not null,
    'sa2g the state lists Weeks 1–4, with their requests: ' || (r -> 'weeks')::text);
  perform sa_true((r ->> 'can_backdate')::boolean is false, 'sa2h scoring has begun: the start is fixed');
  perform sa_err(commish_backdate_season(lid, 2), 'has results already', 'sa2i …and a backdate is refused');
  update matchup set status = 'final' where league_id = lid and week = 2;
  perform sa_err(commish_score_as_is(lid, 2), 'is final', 'sa2j a final week is the re-score''s business');
  perform sa_as('02');
  perform sa_err(commish_score_as_is(lid, 1), 'commissioner only', 'sa2k a member cannot');
  perform sa_err(score_as_is_state(lid), 'commissioner only', 'sa2l nor read the card');
  perform sa_as('01');

  -- ══ sa3. DRIP ═════════════════════════════════════════════════════════════
  r := create_native_league('Drip No', '2031', 2, 6, 60, 'snake', 200, 15, 1, null, null, null, 'drip');
  dl := (r ->> 'league_id')::uuid;
  perform sa_err(commish_backdate_season(dl, 1), 'classic league', 'sa3 a drip league cannot backdate');
  perform sa_err(commish_score_as_is(dl, 1), 'classic league', 'sa3a nor score after the fact');

  delete from league where id in (lid, dl);
  delete from nfl_slate where season = '2031';
  raise notice 'score-as-is probes done';
end $$;

select 'ALL SCORE-AS-IS PROBES PASSED' as result;
