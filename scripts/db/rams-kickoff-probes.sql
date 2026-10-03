-- 0414 probes: THE RAMS ARE "LA" ON THE SLATE AND "LAR" IN THE POOL (#1095).
--
-- classic_kickoff_for joined league_pool.team to nfl_slate on upper() alone,
-- so a Rams player (pool LAR, slate LA) had no kickoff: classic_slug_started
-- read false and he could be moved after his game started. Same for WSH/WAS.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function rk_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function rk_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000a41', 'rk01@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000000a41', 'rk01@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id = '00000000-0000-0000-0000-000000000a41';

begin;
do $$
declare r jsonb; lid uuid; wk int; ssn text;
begin
  perform rk_true(_nfl_team('LAR') = 'LA' and _nfl_team('la') = 'LA' and _nfl_team('WSH') = 'WAS' and _nfl_team('JAC') = 'JAX'
              and _nfl_team('KC') = 'KC' and _nfl_team(null) = '', 'rk0 _nfl_team mirrors normTeam');
  perform set_config('app.uid', '00000000-0000-0000-0000-000000000a41', false);
  perform set_config('app.email', 'rk01@test.dev', false);
  r := create_native_league('RamsKick', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform rk_ok(r, 'rk0 classic league'); lid := (r ->> 'league_id')::uuid;
  perform seed_league_pool(lid, '[
    {"slug":"rk-stafford","full":"Rams Quarterback","pos":"QB","team":"LAR","exp":17},
    {"slug":"rk-commander","full":"Commanders Back","pos":"RB","team":"WSH","exp":3},
    {"slug":"rk-eagle","full":"Eagles Receiver","pos":"WR","team":"PHI","exp":3}]'::jsonb);
  perform rk_ok(native_generate_schedule(lid, 2), 'rk0 the schedule');
  update draft set status = 'complete' where league_id = lid;
  select league_live_week(lid) into wk;
  ssn := coalesce((select max(s.season) from nfl_slate s where s.week = wk), '2026');
  insert into nfl_slate (season, week, win, home, away, kickoff) values
    (ssn, wk, 'early', 'PHI', 'LA', now() - interval '1 hour'),
    (ssn, wk, 'late', 'WAS', 'IND', now() + interval '3 hours')
    on conflict (season, week, home) do update set away = excluded.away, kickoff = excluded.kickoff;
  perform rk_true(classic_kickoff_for(lid, wk, 'rk-stafford') is not null, 'rk1 a Rams player (pool LAR, slate LA) has a kickoff');
  perform rk_true(classic_slug_started(lid, 'rk-stafford'), 'rk1a …so once the Rams kick off he is locked');
  perform rk_true(classic_kickoff_for(lid, wk, 'rk-commander') = (select kickoff from nfl_slate where season = ssn and week = wk and home = 'WAS'),
    'rk2 WSH in the pool finds WAS on the slate');
  perform rk_true(not classic_slug_started(lid, 'rk-commander'), 'rk2a and a game still ahead is not started');
  perform rk_true(classic_slug_started(lid, 'rk-eagle'), 'rk3 a plain code still matches');

  -- rk4: a pick the old worker sealed early (Commanders, game 3 h ahead) opens
  -- again; one sealed at its real kickoff (Eagles, started) stays sealed.
  declare mid uuid; me uuid := '00000000-0000-0000-0000-000000000a41'; n int;
  begin
    select id into mid from matchup where league_id = lid and week = wk limit 1;
    perform set_config('app.uid', '', false);   -- the worker writes these, not a manager
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, locked)
      values (mid, me, 'wk', 'RK1', 'rk-commander', true), (mid, me, 'wk', 'RK2', 'rk-eagle', true);
    n := unseal_early_classic_picks();
    perform rk_true(n >= 1 and not (select locked from sealed_pick where matchup_id = mid and roster_slot = 'RK1'), 'rk4 an early-sealed pick opens again');
    perform rk_true((select locked from sealed_pick where matchup_id = mid and roster_slot = 'RK2'), 'rk4a a pick sealed at its real kickoff stays sealed');
  end;
end $$;
rollback;
\echo ALL RAMS-KICKOFF PROBES PASSED
