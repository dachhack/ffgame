-- 0312 probes: AN EMPTY OPPOSING WINDOW REVEALS AN HOUR BEFORE IT LOCKS.
--
-- What must hold:
--   • a window the opponent left empty is listed from an hour before it
--     locks (kickoff − 2h) and once it has kicked; not before;
--   • a window with a pick in it is never listed, whatever the clock;
--   • an opponent with NO rows at all reveals nothing under best_lineup (the
--     resolver fields them) and everything due under the 'empty' policy;
--   • an AI seat with no rows reveals nothing, whatever the policy;
--   • a non-participant gets [], and so does a classic matchup.
-- Fixture week 8 (backup-assign-probes seeds week 9). Kickoffs are set
-- relative to now() so the probe holds at any hour.
\set QUIET on
\pset pager off

create or replace function ew_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ew_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000005' || u, false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000501', 'ewhome@test.dev'),
  ('00000000-0000-0000-0000-000000000502', 'ewaway@test.dev'),
  ('00000000-0000-0000-0000-000000000503', 'ewoutsider@test.dev')
on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000000501', 'ewhome@test.dev'),
  ('00000000-0000-0000-0000-000000000502', 'ewaway@test.dev'),
  ('00000000-0000-0000-0000-000000000503', 'ewoutsider@test.dev')
on conflict (id) do nothing;

insert into league (id, sleeper_league_id, season, name, commissioner_id) values
  ('00000000-0000-0000-0000-000000000ee1', 'EMPTY-WIN-PROBE', '2026', 'Empty Window Probe', '00000000-0000-0000-0000-000000000501');
insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name) values
  ('00000000-0000-0000-0000-000000000ee1', 1, '00000000-0000-0000-0000-000000000501', true, 'Home'),
  ('00000000-0000-0000-0000-000000000ee1', 2, '00000000-0000-0000-0000-000000000502', true, 'Away');
insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status) values
  ('00000000-0000-0000-0000-000000000ee9', '00000000-0000-0000-0000-000000000ee1', 8, 1, 2, 'live');
-- tnf kicks in 90 min (locks in 30, reveals from now − 30: DUE); snf kicks in
-- 3h (locks in 2h, reveals in 1h: NOT YET); mnf kicked an hour ago (DUE).
insert into nfl_slate (season, week, home, away, win, kickoff) values
  ('2026', 8, 'KC',  'BUF', 'tnf', now() + interval '90 minutes'),
  ('2026', 8, 'SF',  'DAL', 'snf', now() + interval '3 hours'),
  ('2026', 8, 'GB',  'DET', 'mnf', now() - interval '1 hour')
on conflict (season, week, home) do update set kickoff = excluded.kickoff, win = excluded.win;
-- Away filled SNF only.
insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked) values
  ('00000000-0000-0000-0000-000000000ee9', '00000000-0000-0000-0000-000000000502', 'snf', '1', 'some-guy', 'recyd', false);

do $$
declare mid uuid := '00000000-0000-0000-0000-000000000ee9'; lid uuid := '00000000-0000-0000-0000-000000000ee1'; r jsonb;
begin
  -- ew1. home sees away's empty TNF (due) and MNF (kicked), not SNF (filled)
  perform ew_as('01');
  r := opponent_empty_windows(mid);
  perform ew_true(r ? 'tnf' and r ? 'mnf' and not (r ? 'snf'), 'ew1 home sees tnf + mnf empty, snf filled — got ' || r::text);

  -- ew2. move TNF out to 4h: it is no longer within the hour of its lock
  update nfl_slate set kickoff = now() + interval '4 hours' where season = '2026' and week = 8 and win = 'tnf';
  r := opponent_empty_windows(mid);
  perform ew_true(not (r ? 'tnf') and r ? 'mnf', 'ew2 a window three hours from lock is not yet revealed — got ' || r::text);
  update nfl_slate set kickoff = now() + interval '90 minutes' where season = '2026' and week = 8 and win = 'tnf';

  -- ew3. away sees nothing: home has no rows and the resolver fields them (best_lineup)
  perform ew_as('02');
  r := opponent_empty_windows(mid);
  perform ew_true(r = '[]'::jsonb, 'ew3 an opponent with no rows under best_lineup reveals nothing — got ' || r::text);

  -- ew4. under the empty policy a rowless opponent IS empty everywhere that is due
  update league set lineup_policy = 'empty' where id = lid;
  r := opponent_empty_windows(mid);
  perform ew_true(r ? 'tnf' and r ? 'mnf' and not (r ? 'snf'), 'ew4 policy empty: every due window reveals — got ' || r::text);

  -- ew5. an AI seat with no rows reveals nothing, even under the empty policy
  update league_membership set controller = 'ai' where league_id = lid and sleeper_roster_id = 1;
  r := opponent_empty_windows(mid);
  perform ew_true(r = '[]'::jsonb, 'ew5 an AI seat is fielded by the resolver, nothing reveals — got ' || r::text);
  update league_membership set controller = 'human' where league_id = lid and sleeper_roster_id = 1;
  update league set lineup_policy = 'best_lineup' where id = lid;

  -- ew6. the outsider gets nothing, and learns nothing
  perform ew_as('03');
  r := opponent_empty_windows(mid);
  perform ew_true(r = '[]'::jsonb, 'ew6 a non-participant gets [] — got ' || r::text);

  -- ew7. once away fills TNF it stops being listed
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked) values
    (mid, '00000000-0000-0000-0000-000000000502', 'tnf', '1', 'other-guy', 'recyd', false);
  perform ew_as('01');
  r := opponent_empty_windows(mid);
  perform ew_true(not (r ? 'tnf') and r ? 'mnf', 'ew7 a filled window drops off — got ' || r::text);

  -- ew8. a classic matchup has no backups, so nothing reveals
  update league set settings_json = coalesce(settings_json, '{}'::jsonb) || '{"game_mode":"classic"}'::jsonb where id = lid;
  r := opponent_empty_windows(mid);
  perform ew_true(r = '[]'::jsonb, 'ew8 classic: [] — got ' || r::text);
end $$;

select 'ALL EMPTY-WINDOW PROBES PASSED' as result;
