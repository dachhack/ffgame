-- 0251 probes: the board-driven sim's CONTROL PLANE (admin_sim_start /
-- admin_sim_reset / sim_run_state). The worker's sweep math has its own test
-- (server/test/sim-sweep.mjs); what these pin is the DB half:
--   (1) the same double gate as the stamp lever — non-admin refused, admin
--       without 🧪 LIVE TEST refused — because start locks picks and flips a
--       week live, and must never reach a real league;
--   (2) START's pre-flight — picks locked, matchups live, the run row armed —
--       and its refusals: a second start, a week already carrying finals, and
--       a second LEAGUE on the same week (SIM feed rows are week-scoped, so
--       two leagues on one week would share and destroy each other's feed);
--   (3) RESET reverting everything the sim touched — and only that: matchups
--       back to scheduled, picks unlocked, SIM rows gone, the run row gone.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function sr_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000d0e0' || u, false);
  perform set_config('app.email', 'sr' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d0e01', 'sr1@test.dev')
on conflict (id) do nothing;

-- League shell + finished draft + 2-week schedule (the stamp-week fixture).
create or replace function _sr_league(nm text, pfx text) returns uuid language plpgsql as $$
declare r jsonb; lid uuid; pool jsonb := '[]'::jsonb; t int; i int;
begin
  perform sr_as('1');
  r := create_native_league(nm, '2026', 4, 5, 60, 'snake');
  if not (r ->> 'ok')::boolean then raise exception 'SR FIXTURE: create failed — %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  for i in 1..28 loop
    pool := pool || jsonb_build_object('slug', pfx || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  r := seed_league_pool(lid, pool);
  if not (r ->> 'ok')::boolean then raise exception 'SR FIXTURE: seed failed — %', r; end if;
  update draft set status = 'complete' where league_id = lid;
  for t in 1..4 loop
    for i in 1..5 loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid, t, pfx || ((t - 1) * 5 + i), 'commish');
    end loop;
  end loop;
  r := native_generate_schedule(lid, 2);
  if not (r ->> 'ok')::boolean then raise exception 'SR FIXTURE: schedule failed — %', r; end if;
  return lid;
end $$;

do $$
declare lid uuid; lid2 uuid; r jsonb; mid uuid; n int;
begin
  perform sr_as('1');
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000d0e01', 'sr1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000d0e01';

  lid := _sr_league('Sim Control A', 'sra-');

  -- ══ THE DOUBLE GATE ═══════════════════════════════════════════════════════
  r := admin_sim_start(lid);
  if (r ->> 'ok')::boolean or (r ->> 'error') <> 'forbidden' then
    raise exception 'SR1 FAIL: a non-admin armed a sim — %', r;
  end if;
  insert into app_admin (email) values ('sr1@test.dev') on conflict do nothing;
  r := admin_sim_start(lid);
  if (r ->> 'ok')::boolean or position('sandbox' in (r ->> 'error')) = 0 then
    raise exception 'SR2 FAIL: armed without the LIVE TEST flag — %', r;
  end if;

  -- ══ START: pre-flight + the run row ═══════════════════════════════════════
  perform admin_set_test_live(lid, true);
  -- A sealed pick to prove the lock: written pre-lock by the seat's owner.
  select id into mid from matchup where league_id = lid and week = 1 limit 1;
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
  values (mid, '00000000-0000-0000-0000-0000000d0e01', 'tnf', 'S1', 'sra-1');

  r := admin_sim_start(lid);
  if not (r ->> 'ok')::boolean or (r ->> 'week')::int <> 1 then
    raise exception 'SR3 FAIL: start refused or wrong week — %', r;
  end if;
  if exists (select 1 from matchup where league_id = lid and week = 1 and status <> 'live') then
    raise exception 'SR3 FAIL: a week-1 matchup is not live after start';
  end if;
  if exists (select 1 from sealed_pick where matchup_id = mid and not locked) then
    raise exception 'SR3 FAIL: start left a pick unlocked';
  end if;
  if not exists (select 1 from sim_run where league_id = lid and week = 1 and status = 'running') then
    raise exception 'SR3 FAIL: no running sim_run row';
  end if;

  -- The board's status line reads it (and the clock never runs backwards).
  r := sim_run_state(lid);
  if not (r ->> 'ok')::boolean or (r -> 'run' ->> 'week')::int <> 1
     or (r -> 'run' ->> 'clock')::numeric < 0 then
    raise exception 'SR4 FAIL: state unreadable — %', r;
  end if;

  -- ══ THE REFUSALS ══════════════════════════════════════════════════════════
  r := admin_sim_start(lid);
  if (r ->> 'ok')::boolean or position('already running' in (r ->> 'error')) = 0 then
    raise exception 'SR5 FAIL: a second start landed — %', r;
  end if;
  -- A second league on the SAME week: refused, the feed rows are week-scoped.
  lid2 := _sr_league('Sim Control B', 'srb-');
  perform admin_set_test_live(lid2, true);
  r := admin_sim_start(lid2, 1);
  if (r ->> 'ok')::boolean or position('another league' in (r ->> 'error')) = 0 then
    raise exception 'SR6 FAIL: two leagues simming one week — %', r;
  end if;

  -- ══ RESET: everything back, and only the sim's own rows ═══════════════════
  insert into live_play (week, game_id, player_slug, c, t, pid, k, y)
  values (1, 'SIM', 'sra-1', 100, 100, 9001, 'rush', 7);
  insert into game_feed (week, game_id, key, away, home, plays)
  values (1, 'SIM:AA@BB', 'AA@BB', 'AA', 'BB', '[]'::jsonb);
  r := admin_sim_reset(lid);   -- week defaulted from the run row
  if not (r ->> 'ok')::boolean or (r ->> 'week')::int <> 1 then
    raise exception 'SR7 FAIL: reset refused — %', r;
  end if;
  if exists (select 1 from matchup where league_id = lid and week = 1
             and (status <> 'scheduled' or home_final is not null)) then
    raise exception 'SR7 FAIL: a matchup survived reset un-scheduled';
  end if;
  if exists (select 1 from sealed_pick where matchup_id = mid and locked) then
    raise exception 'SR7 FAIL: reset left a pick locked';
  end if;
  if exists (select 1 from sim_run where league_id = lid) then
    raise exception 'SR7 FAIL: the run row survived reset';
  end if;
  select count(*) into n from live_play where week = 1 and game_id = 'SIM';
  if n <> 0 then raise exception 'SR7 FAIL: % SIM live_play rows survived reset', n; end if;
  select count(*) into n from game_feed where week = 1 and game_id like 'SIM:%';
  if n <> 0 then raise exception 'SR7 FAIL: % SIM game_feed rows survived reset', n; end if;

  -- ══ A WEEK WITH FINALS REFUSES A SIM ══════════════════════════════════════
  update matchup set status = 'final', home_final = 100, away_final = 90
    where league_id = lid and week = 2;
  r := admin_sim_start(lid, 2);
  if (r ->> 'ok')::boolean or position('finals' in (r ->> 'error')) = 0 then
    raise exception 'SR8 FAIL: a sim armed over stamped finals — %', r;
  end if;

  raise notice 'sim-run probes done';
end $$;

select 'ALL SIM-RUN PROBES PASSED' as result;
