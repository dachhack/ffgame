-- 0271 probes: the chopping block keeps history.
--
-- What must hold:
--   • guillotine_state answers `history`, one entry per FULLY-FINAL regular
--     week, newest first;
--   • each entry holds the field AS IT STOOD that week — a seat chopped in
--     week N is IN week N (it played, it scored, it fell) and GONE from N+1;
--   • rows sort by score ascending, so the floor reads first, and the chopped
--     seat is flagged on its row and hoisted to the entry;
--   • a byed seat carries bye=true and a null score — never an imputed 0;
--   • a week still in flight is NOT history (it belongs to `alive`);
--   • the whole thing stays behind the member gate.
\set QUIET on
\pset pager off

create or replace function gh_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000b1c0' || u, false);
  perform set_config('app.email', 'gh' || u || '@test.dev', false);
end $$;
create or replace function gh_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000b1c01', 'gh1@test.dev'),
  ('00000000-0000-0000-0000-0000000b1c02', 'gh2@test.dev')
on conflict (id) do nothing;

-- Own fixture (the suites share one DB and run in any order): n seats,
-- guillotine, tiny pool, seeded rosters, a 2-week schedule.
create or replace function _gh_league(nm text, pfx text, n int) returns uuid
  language plpgsql as $$
declare r jsonb; lid uuid; pool jsonb := '[]'::jsonb; t int; i int;
begin
  perform gh_as('1');
  r := create_native_league(nm, '2026', n, 5, 60, 'snake');
  if not (r ->> 'ok')::boolean then raise exception 'GH FIXTURE: create failed — %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  r := set_league_format(lid, 'guillotine');
  if not (r ->> 'ok')::boolean then raise exception 'GH FIXTURE: format failed — %', r; end if;
  for i in 1..(n * 5 + 4) loop
    pool := pool || jsonb_build_object('slug', pfx || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  r := seed_league_pool(lid, pool);
  if not (r ->> 'ok')::boolean then raise exception 'GH FIXTURE: seed failed — %', r; end if;
  update draft set status = 'complete' where league_id = lid;
  for t in 1..n loop
    for i in 1..5 loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid, t, pfx || ((t - 1) * 5 + i), 'commish');
    end loop;
  end loop;
  r := native_generate_schedule(lid, 2);
  if not (r ->> 'ok')::boolean then raise exception 'GH FIXTURE: schedule failed — %', r; end if;
  return lid;
end $$;

-- Final every matchup in a week, seat `low` scoring the floor.
create or replace function _gh_final_week(lid uuid, wk int, low int) returns void
  language plpgsql as $$
declare m record; i numeric := 100;
begin
  for m in select id, home_roster_id, away_roster_id from matchup
           where league_id = lid and week = wk order by id loop
    i := i + 7;   -- every other seat lands well clear of the floor
    update matchup set status = 'final',
      home_final = case when m.home_roster_id = low then 10.0 else i end,
      away_final = case when m.away_roster_id = low then 10.0 else i + 3 end
      where id = m.id;
  end loop;
end $$;

do $$
declare lid uuid; blid uuid; r jsonb; hist jsonb; e1 jsonb; e2 jsonb; tm jsonb;
        w1_victim int; w2_victim int; byed int;
begin
  insert into app_user (id, email) values
    ('00000000-0000-0000-0000-0000000b1c01', 'gh1@test.dev'),
    ('00000000-0000-0000-0000-0000000b1c02', 'gh2@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000b1c01';

  -- ══ four seats, two weeks, two blades ═════════════════════════════════════
  lid := _gh_league('Block History', 'gh-', 4);
  perform gh_as('1');

  -- A week in flight is not history yet.
  update matchup set status = 'live' where league_id = lid and week = 1;
  r := guillotine_state(lid);
  perform gh_true(jsonb_array_length(r -> 'history') = 0,
    'gh1 a week still running is not history — it belongs to alive');

  -- Week 1: seat 3 scores the floor and falls.
  w1_victim := 3;
  perform _gh_final_week(lid, 1, w1_victim);
  perform guillotine_tick(lid);
  r := guillotine_state(lid); hist := r -> 'history';
  perform gh_true(jsonb_array_length(hist) = 1, 'gh2 one finaled week, one history entry');
  e1 := hist -> 0;
  perform gh_true((e1 ->> 'week')::int = 1, 'gh2a the entry names its week');
  perform gh_true((e1 ->> 'chopped')::int = w1_victim, 'gh2b the chopped seat is hoisted to the entry');
  perform gh_true((e1 ->> 'chopped_team') is not null, 'gh2c …with its team name');
  tm := e1 -> 'teams';
  perform gh_true(jsonb_array_length(tm) = 4,
    'gh3 the week holds the whole field that played it — the chopped seat included');
  perform gh_true((tm -> 0 ->> 'roster_id')::int = w1_victim
      and (tm -> 0 ->> 'chopped')::boolean,
    'gh3a the floor reads first, flagged as chopped');
  perform gh_true((tm -> 0 ->> 'pts')::numeric = 10.0, 'gh3b …carrying the score it died on');
  perform gh_true((tm -> 1 ->> 'chopped')::boolean is false, 'gh3c the survivors are not flagged');
  perform gh_true((tm -> 0 ->> 'pts')::numeric <= (tm -> 1 ->> 'pts')::numeric
      and (tm -> 1 ->> 'pts')::numeric <= (tm -> 2 ->> 'pts')::numeric,
    'gh3d the field sorts by score ascending — the cutline order');

  -- Week 2: the dead seat is out of the field; seat 4 takes the floor.
  w2_victim := 4;
  perform _gh_final_week(lid, 2, w2_victim);
  perform guillotine_tick(lid);
  r := guillotine_state(lid); hist := r -> 'history';
  perform gh_true(jsonb_array_length(hist) = 2, 'gh4 two finaled weeks, two entries');
  perform gh_true((hist -> 0 ->> 'week')::int = 2 and (hist -> 1 ->> 'week')::int = 1,
    'gh4a newest week first');
  e2 := hist -> 0; tm := e2 -> 'teams';
  perform gh_true(jsonb_array_length(tm) = 3,
    'gh5 week 2 holds only the seats still alive going into it');
  perform gh_true(not exists (select 1 from jsonb_array_elements(tm) x
      where (x ->> 'roster_id')::int = w1_victim),
    'gh5a …so week 1''s victim is gone from week 2');
  perform gh_true((tm -> 0 ->> 'roster_id')::int = w2_victim and (tm -> 0 ->> 'chopped')::boolean,
    'gh5b week 2''s own victim is present and flagged');
  -- and week 1 still reads exactly as it did — history does not rewrite
  perform gh_true(jsonb_array_length(hist -> 1 -> 'teams') = 4
      and ((hist -> 1 -> 'teams') -> 0 ->> 'roster_id')::int = w1_victim,
    'gh6 an older week is not rewritten by later blades');

  -- ══ the bye, in history ═══════════════════════════════════════════════════
  -- 3 seats: the circle method sits one out each week.
  blid := _gh_league('Block Bye', 'gb-', 3);
  perform gh_as('1');
  select m.sleeper_roster_id into byed from league_membership m
    where m.league_id = blid
      and not exists (select 1 from matchup mu where mu.league_id = blid and mu.week = 1
        and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id))
    limit 1;
  perform gh_true(byed is not null, 'gh7 the odd league byes a seat in week 1');
  update matchup set status = 'final', home_final = 88.0, away_final = 44.0
    where league_id = blid and week = 1;
  perform guillotine_tick(blid);
  r := guillotine_state(blid); tm := (r -> 'history' -> 0) -> 'teams';
  perform gh_true(exists (select 1 from jsonb_array_elements(tm) x
      where (x ->> 'roster_id')::int = byed
        and (x ->> 'bye')::boolean and (x ->> 'pts') is null),
    'gh8 a byed seat carries bye=true and a null score — never an imputed 0');
  perform gh_true(not exists (select 1 from jsonb_array_elements(tm) x
      where (x ->> 'roster_id')::int = byed and (x ->> 'chopped')::boolean),
    'gh8a …and the blade never takes it');

  -- ══ the gate ══════════════════════════════════════════════════════════════
  perform gh_as('2');
  r := guillotine_state(lid);
  perform gh_true(r ->> 'error' = 'forbidden', 'gh9 history stays behind the member gate');

  raise notice 'block-history probes done';
end $$;

select 'ALL BLOCK-HISTORY PROBES PASSED' as status;
