-- 0356 probes: THE COMMISSIONER FIXES A LINEUP.
--   • the lock stands for the manager: a kicked-off player can't be brought in;
--   • the commissioner starts him anyway, and an IR player too; the rows land
--     sealed (the week has kicked off), the old and new lineups are logged,
--     the league is told who came in and who went out;
--   • the switch is off again afterwards: the manager still can't touch them;
--   • who may start: the seat's roster, its lineup, a player who left it after
--     kickoff — not another team's player;
--   • refusals: a manager, no reason, a player twice, a spot twice, a drip league;
--   • a stamped week says it needs a re-score.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function lf_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function lf_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function lf_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function lf_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000019' || u, false);
      perform set_config('app.email', 'lf' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001901', 'lf01@test.dev'), ('00000000-0000-0000-0000-000000001902', 'lf02@test.dev')
  on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000001901', 'lf01@test.dev'), ('00000000-0000-0000-0000-000000001902', 'lf02@test.dev')
  on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
 where id in ('00000000-0000-0000-0000-000000001901', '00000000-0000-0000-0000-000000001902');
-- Week 91: a week the real slate doesn't cover. BUF kicked off two hours ago;
-- PHI plays in three days.
insert into nfl_slate (season, week, win, home, away, kickoff) values
  ('2026', 91, 'thu', 'NYJ', 'BUF', now() - interval '2 hours'),
  ('2026', 91, 'sun_early', 'PHI', 'DAL', now() + interval '3 days')
on conflict do nothing;

do $$
declare r jsonb; lid uuid; dlid uuid; code text; a int; b int; mid uuid; bu uuid := '00000000-0000-0000-0000-000000001902';
        line text; n int;
begin
  perform lf_as('01');
  r := create_native_league('Fixed', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform lf_ok(r, 'f0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform lf_as('02'); perform lf_ok(native_join(code, 'LF-B'), 'f0 B joins');
  perform lf_as('01');
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'lf-thu', 'Thursday Back', 'RB', 'BUF', 1), (lid, 'lf-ir', 'Hurt Receiver', 'WR', 'BUF', 2),
    (lid, 'lf-sun', 'Sunday Back', 'RB', 'PHI', 3), (lid, 'lf-a', 'Other Teams Guy', 'WR', 'BUF', 4),
    (lid, 'lf-sun2', 'Second Sunday', 'WR', 'DAL', 5);
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001901';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = bu;
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired, spot) values
    (lid, b, 'lf-thu', 'draft', 'active'), (lid, b, 'lf-ir', 'draft', 'ir'), (lid, b, 'lf-sun', 'draft', 'active'),
    (lid, b, 'lf-sun2', 'draft', 'active'), (lid, a, 'lf-a', 'draft', 'active');
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (lid, 91, a, b, 'live') returning id into mid;

  -- ── f1. the lock stands for the manager ──
  perform lf_as('02');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values (mid, bu, 'wk', 'RB1', 'lf-sun');
  begin
    update sealed_pick set player_slug = 'lf-thu' where matchup_id = mid and roster_slot = 'RB1';
    raise exception 'PROBE FAIL f1 — a manager started a kicked-off player';
  exception when check_violation then null;
  end;

  -- ── f2. the commissioner fixes it ──
  perform lf_as('01');
  r := commish_week_lineup(lid, 91);
  perform lf_true(jsonb_array_length(r -> 'teams') = 2, 'f2 the week''s two seats: ' || r::text);
  r := commish_week_lineup(lid, 91, b);
  perform lf_true(r -> 'stored' = '[{"slot": "RB1", "slug": "lf-sun"}]'::jsonb, 'f2 the stored lineup: ' || (r -> 'stored')::text);
  perform lf_true((select count(*) from jsonb_array_elements(r -> 'candidates') c where c ->> 'slug' in ('lf-thu', 'lf-ir', 'lf-sun', 'lf-sun2')) = 4
    and not exists (select 1 from jsonb_array_elements(r -> 'candidates') c where c ->> 'slug' = 'lf-a'),
    'f2 candidates are this seat''s: ' || (r -> 'candidates')::text);
  r := commish_set_week_lineup(lid, 91, b, '[{"slot": "RB1", "slug": "lf-thu"}, {"slot": "WR1", "slug": "lf-ir"}]', 'app crashed at 12:58');
  perform lf_ok(r, 'f2 fix');
  perform lf_true((r ->> 'rescore')::boolean = false, 'f2 unstamped, no re-score');
  perform lf_true((select player_slug from sealed_pick where matchup_id = mid and app_user_id = bu and roster_slot = 'RB1') = 'lf-thu', 'f2 RB1 is the Thursday back');
  perform lf_true((select player_slug from sealed_pick where matchup_id = mid and app_user_id = bu and roster_slot = 'WR1') = 'lf-ir', 'f2 an IR player started');
  perform lf_true((select bool_and(locked and revealed_at is not null) from sealed_pick where matchup_id = mid and app_user_id = bu), 'f2 sealed, as the week is');
  perform lf_true((select before = '[{"slot": "RB1", "slug": "lf-sun"}]'::jsonb and jsonb_array_length(after) = 2
                     from lineup_edit_log where league_id = lid order by id desc limit 1), 'f2 logged');
  select body into line from league_message where league_id = lid order by created_at desc, id desc limit 1;
  perform lf_true(line = '🧾 The commissioner changed LF-B''s week 91 lineup: in Hurt Receiver, Thursday Back; out Sunday Back — app crashed at 12:58',
    'f2 the league is told: ' || coalesce(line, '∅'));

  -- ── f3. the switch is off again ──
  perform lf_true(not _commish_lineup_override(), 'f3 switch off');
  perform lf_as('02');
  begin
    update sealed_pick set player_slug = 'lf-sun2' where matchup_id = mid and roster_slot = 'RB1';
    raise exception 'PROBE FAIL f3 — the manager changed a started player after the fix';
  exception when check_violation then null;
  end;

  -- ── f4. who may start ──
  perform lf_as('01');
  perform lf_refused(commish_set_week_lineup(lid, 91, b, '[{"slot": "RB1", "slug": "lf-a"}]', 'x'), 'not this team', 'f4 another team''s player');
  delete from native_roster where league_id = lid and roster_id = b and slug = 'lf-sun';   -- dropped after kickoff
  perform lf_ok(commish_set_week_lineup(lid, 91, b, '[{"slot": "RB1", "slug": "lf-sun"}, {"slot": "WR1", "slug": null}]', 'he did play for them'), 'f4 a player who left after kickoff');
  perform lf_true((select player_slug from sealed_pick where matchup_id = mid and app_user_id = bu and roster_slot = 'RB1') = 'lf-sun', 'f4 back in');
  perform lf_true((select player_slug is null from sealed_pick where matchup_id = mid and app_user_id = bu and roster_slot = 'WR1'), 'f4 a spot emptied');

  -- ── f5. refusals ──
  perform lf_as('02');
  perform lf_refused(commish_set_week_lineup(lid, 91, b, '[]', 'x'), 'commissioner only', 'f5 a manager');
  perform lf_refused(commish_week_lineup(lid, 91, b), 'commissioner only', 'f5 a manager reads nothing');
  perform lf_as('01');
  perform lf_refused(commish_set_week_lineup(lid, 91, b, '[]', ' '), 'say why', 'f5 no reason');
  perform lf_refused(commish_set_week_lineup(lid, 91, b, '[{"slot": "RB1", "slug": "lf-thu"}, {"slot": "RB2", "slug": "lf-thu"}]', 'x'), 'one spot', 'f5 twice');
  perform lf_refused(commish_set_week_lineup(lid, 91, b, '[{"slot": "RB1", "slug": "lf-thu"}, {"slot": "RB1", "slug": "lf-sun2"}]', 'x'), 'named twice', 'f5 a spot twice');
  perform lf_refused(commish_set_week_lineup(lid, 99, b, '[]', 'x'), 'no matchup', 'f5 no such week');
  r := create_native_league('Dripping Fix', '2026', 2, 8, 60, 'snake', 200, 15, 1);
  dlid := (r ->> 'league_id')::uuid;
  perform lf_refused(commish_set_week_lineup(dlid, 91, 1, '[]', 'x'), 'classic', 'f5 drip');

  -- ── f6. stamped ──
  update matchup set home_final = 50, away_final = 60, status = 'final' where id = mid;
  select count(*) into n from league_message where league_id = lid;
  r := commish_set_week_lineup(lid, 91, b, '[{"slot": "RB1", "slug": "lf-sun"}, {"slot": "WR1", "slug": null}]', 'no change');
  perform lf_true((r ->> 'rescore')::boolean, 'f6 stamped needs a re-score');
  perform lf_true((select count(*) from league_message where league_id = lid) = n, 'f6 nothing changed, nothing said');
end $$;
select 'ALL LINEUP-FIX PROBES PASS';
