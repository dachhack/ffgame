-- 0249 probes: the WORKER (service role) may drive the endgame.
--
-- Playoffs and the guillotine used to move only when a member opened a screen.
-- The Fly worker calls as the service role — auth.uid() is null — where
-- generate_playoffs(auto) and guillotine_tick refused it. These assert that a
-- NULL-uid caller can now build round 1, advance a finished round, and drop a
-- guillotine week (exactly what a member's poke already did), while the
-- MANUAL/seeded generate stays commissioner-only. `app.uid = ''` is the worker:
-- the shim's auth.uid() reads that GUC, and empty → null.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function wp_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000d1e0' || u, false);
  perform set_config('app.email', 'wp' || u || '@test.dev', false);
end $$;
-- the worker: no identity at all
create or replace function wp_worker() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d1e01', 'wp1@test.dev')
on conflict (id) do nothing;

create or replace function wp_stamp(lid uuid, wk int) returns void language plpgsql as $$
begin
  update matchup m set status = 'final',
    home_final = 200 - m.home_roster_id * 10,
    away_final = 200 - m.away_roster_id * 10
  where m.league_id = lid and m.week = wk;
end $$;

do $$
declare r jsonb; lg uuid; t int; i int; pool jsonb := '[]'::jsonb;
begin
  perform wp_as('1');
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000d1e01', 'wp1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000d1e01';

  -- ═══ STANDARD LEAGUE: worker builds round 1 and advances it ════════════════
  r := create_native_league('Worker Playoffs', '2026', 4, 5, 60, 'snake');
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: create refused — %', r; end if;
  lg := (r ->> 'league_id')::uuid;
  for i in 1..28 loop pool := pool || jsonb_build_object('slug','wp-'||i,'full','P '||i,'pos','RB','team','T'); end loop;
  r := seed_league_pool(lg, pool);
  update draft set status = 'complete' where league_id = lg;
  for t in 1..4 loop for i in 1..5 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lg, t, 'wp-'||((t-1)*5+i), 'commish');
  end loop; end loop;
  r := native_generate_schedule(lg, 14);
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: schedule refused — %', r; end if;
  r := set_playoff_rules(lg, 4, 15);
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: bracket size refused — %', r; end if;
  for i in 1..14 loop perform wp_stamp(lg, i); end loop;

  -- the WORKER (no identity) builds round 1 — refused before 0249
  perform wp_worker();
  r := generate_playoffs(lg, null, true);
  if not (r ->> 'ok')::boolean or (r -> 'bracket') is null then
    raise exception 'PROBE FAIL: the worker could not build round 1 — %', r;
  end if;
  if (select count(*) from matchup where league_id = lg and is_playoff and playoff_round = 1 and not is_consolation) <> 2 then
    raise exception 'PROBE FAIL: round 1 is not two semifinals';
  end if;

  -- a MANUAL (seeded) generate from the worker must STILL be refused
  r := generate_playoffs(lg, '[1,2,3,4]'::jsonb, false);
  if (r ->> 'ok')::boolean then
    raise exception 'PROBE FAIL: the worker performed a manual seeded generate (should be commish-only)';
  end if;

  -- worker advances the finished round → the championship
  perform wp_stamp(lg, 15);
  r := advance_playoffs(lg);
  if not (r ->> 'advanced')::boolean then
    raise exception 'PROBE FAIL: the worker could not advance round 1 — %', r;
  end if;
  if (select count(*) from matchup where league_id = lg and is_playoff and playoff_round = 2 and not is_consolation) < 1 then
    raise exception 'PROBE FAIL: the championship was not built on advance';
  end if;

  -- and it crowns
  perform wp_stamp(lg, 16);
  r := advance_playoffs(lg);
  if (r ->> 'champion') is null then
    raise exception 'PROBE FAIL: no champion after the worker ran the final — %', r;
  end if;

  -- ═══ GUILLOTINE LEAGUE: worker drops a week ════════════════════════════════
  perform wp_as('1');
  r := create_native_league('Worker Blade', '2026', 4, 5, 60, 'snake');
  lg := (r ->> 'league_id')::uuid;
  pool := '[]'::jsonb;
  for i in 1..28 loop pool := pool || jsonb_build_object('slug','wb-'||i,'full','P '||i,'pos','RB','team','T'); end loop;
  perform seed_league_pool(lg, pool);
  r := set_league_format(lg, 'guillotine');
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: guillotine refused — %', r; end if;
  update draft set status = 'complete' where league_id = lg;
  for t in 1..4 loop for i in 1..5 loop
    insert into native_roster (league_id, roster_id, slug, acquired) values (lg, t, 'wb-'||((t-1)*5+i), 'commish');
  end loop; end loop;
  r := native_generate_schedule(lg, 17);
  if not (r ->> 'ok')::boolean then raise exception 'PROBE FAIL: guillotine schedule refused — %', r; end if;
  perform wp_stamp(lg, 1);

  -- the WORKER ticks the blade — refused before 0249
  perform wp_worker();
  r := guillotine_tick(lg);
  if not (r ->> 'ok')::boolean then
    raise exception 'PROBE FAIL: the worker could not tick the guillotine — %', r;
  end if;
  if (r ->> 'eliminated')::int <> 1 then
    raise exception 'PROBE FAIL: the worker tick eliminated % (expected 1)', r ->> 'eliminated';
  end if;
  if (select count(*) from league_membership where league_id = lg and eliminated_week = 1) <> 1 then
    raise exception 'PROBE FAIL: no seat carries eliminated_week after the worker tick';
  end if;

  raise notice 'worker-progression probes done';
end $$;
select 'ALL WORKER-PROGRESSION PROBES PASSED' as result;
