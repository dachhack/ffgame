-- 0266 probes: the rehearsal answers in percent, and defaults to 100×.
--
-- What must hold:
--   • sim_run_state stays admin-gated;
--   • pct is NULL until the worker stamps feed_len (the strip's clock
--     fallback window), then clock ÷ feed_len, capped at 100;
--   • a done run reads pct off its cursor, not the wall clock;
--   • admin_sim_start's default speed is 100 (source-read: the default only
--     applies inside the function, and arming a real run here would fight
--     the one-sim-per-week rule with every other suite in this shared DB).
\set QUIET on
\pset pager off

create or replace function sp_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000d0f0' || u, false);
  perform set_config('app.email', 'sp' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000d0f01', 'sp1@test.dev'),
  ('00000000-0000-0000-0000-0000000d0f02', 'sp2@test.dev')
on conflict (id) do nothing;

do $$
declare lid uuid; r jsonb; run jsonb; def text;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000d0f01', 'sp1@test.dev'),
    ('00000000-0000-0000-0000-0000000d0f02', 'sp2@test.dev')
  on conflict (id) do nothing;
  insert into app_admin (email) values ('sp1@test.dev') on conflict do nothing;

  insert into league (sleeper_league_id, season, name, provider)
  values ('probe-sim-pct', '2026', 'Percent Rehearsal', 'native')
  returning id into lid;
  -- A running row as the sweep would leave it mid-run, BEFORE its first
  -- feed_len stamp: one minute in at 100× ⇒ the feed clock reads ~6000.
  insert into sim_run (league_id, week, src_week, speed, started_at, cursor_at)
  values (lid, 990, 1, 100, now() - interval '1 minute', 0);

  perform sp_as('2');
  r := sim_run_state(lid);
  if coalesce((r ->> 'ok')::boolean, true) then
    raise exception 'PROBE FAIL sp1 — a non-admin read the run state: %', r;
  end if;

  perform sp_as('1');
  r := sim_run_state(lid); run := r -> 'run';
  if not (r ->> 'ok')::boolean or run is null then raise exception 'PROBE FAIL sp2 — %', r; end if;
  if run ->> 'pct' is not null then
    raise exception 'PROBE FAIL sp2a — pct must be null before the worker stamps feed_len: %', run;
  end if;
  if (run ->> 'clock')::numeric <= 0 then
    raise exception 'PROBE FAIL sp2b — the clock fallback must still tick: %', run;
  end if;

  -- The worker's stamp lands: 12000 feed-seconds long ⇒ one minute at 100×
  -- is about halfway.
  update sim_run set feed_len = 12000 where league_id = lid;
  r := sim_run_state(lid); run := r -> 'run';
  if (run ->> 'pct')::numeric not between 45 and 55 then
    raise exception 'PROBE FAIL sp3 — a minute at 100x over a 12000s feed is ~50pct: %', run;
  end if;

  -- The wall clock outrunning the feed caps at 100, never 300.
  update sim_run set started_at = now() - interval '1 hour' where league_id = lid;
  r := sim_run_state(lid); run := r -> 'run';
  if (run ->> 'pct')::numeric <> 100 then
    raise exception 'PROBE FAIL sp4 — pct is capped at 100: %', run;
  end if;

  -- A done run reads off its cursor, not the wall.
  update sim_run set status = 'done', cursor_at = 12000 where league_id = lid;
  r := sim_run_state(lid); run := r -> 'run';
  if (run ->> 'pct')::numeric <> 100 or (run ->> 'clock')::numeric <> 12000 then
    raise exception 'PROBE FAIL sp5 — done pct/clock come from the cursor: %', run;
  end if;

  -- The 100× default (source-read; see header).
  def := pg_get_functiondef('admin_sim_start(uuid, int, int, numeric)'::regprocedure);
  if position('DEFAULT 100' in def) = 0 then
    raise exception 'PROBE FAIL sp6 — admin_sim_start default speed is not 100';
  end if;
  if position('coalesce(p_speed, 100)' in def) = 0 then
    raise exception 'PROBE FAIL sp6a — the null-speed fallback is not 100';
  end if;

  raise notice 'sim-percent probes done';
end $$;

select 'ALL SIM-PERCENT PROBES PASSED' as status;
