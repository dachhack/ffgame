-- 0272 probes: the chopped are told, and refused politely.
--
-- What must hold:
--   • league_standings carries `eliminated` — the week the blade fell, null
--     while a seat lives — so the boards can say so;
--   • native_team_state carries the caller's own `eliminated`;
--   • add_free_agent and submit_waiver_claim ANSWER {ok:false, error} for a
--     dead seat instead of letting the trigger raise;
--   • the same for a non-vampire under a locked wire;
--   • a living seat in an unlocked league is untouched by either check;
--   • the seat-guard trigger still stands behind them.
\set QUIET on
\pset pager off

create or replace function tc_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000e2c0' || u, false);
  perform set_config('app.email', 'tc' || u || '@test.dev', false);
end $$;
create or replace function tc_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000e2c01', 'tc1@test.dev')
on conflict (id) do nothing;

create or replace function _tc_league(nm text, pfx text, n int, fmt text) returns uuid
  language plpgsql as $$
declare r jsonb; lid uuid; pool jsonb := '[]'::jsonb; t int; i int;
begin
  perform tc_as('1');
  r := create_native_league(nm, '2026', n, 8, 60, 'snake');
  if not (r ->> 'ok')::boolean then raise exception 'TC FIXTURE: create — %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  r := set_league_format(lid, fmt);
  if not (r ->> 'ok')::boolean then raise exception 'TC FIXTURE: format — %', r; end if;
  for i in 1..(n * 6 + 8) loop
    pool := pool || jsonb_build_object('slug', pfx || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  r := seed_league_pool(lid, pool);
  if not (r ->> 'ok')::boolean then raise exception 'TC FIXTURE: seed — %', r; end if;
  update draft set status = 'complete' where league_id = lid;
  for t in 1..n loop
    for i in 1..5 loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid, t, pfx || ((t - 1) * 5 + i), 'draft');
    end loop;
  end loop;
  r := native_generate_schedule(lid, 2);
  if not (r ->> 'ok')::boolean then raise exception 'TC FIXTURE: schedule — %', r; end if;
  return lid;
end $$;

do $$
declare lid uuid; vlid uuid; r jsonb; row_j jsonb; m record; dead int; live_seat int; fa text; msg text;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000e2c01', 'tc1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000e2c01';

  -- ══ 🔪 a guillotine league, one blade ══════════════════════════════════
  lid := _tc_league('Tell The Chopped', 'tc-', 4, 'guillotine');
  perform tc_as('1');

  -- alive: standings say nothing about elimination yet
  r := league_standings(lid);
  perform tc_true(not exists (select 1 from jsonb_array_elements(r) x
      where (x ->> 'eliminated') is not null),
    'tc1 no seat is eliminated before the first blade');
  perform tc_true(exists (select 1 from jsonb_array_elements(r) x where x ? 'eliminated'),
    'tc1a …but the key is present, so the client can trust it');

  -- week 1: seat 1 scores the floor and falls
  for m in select id, home_roster_id, away_roster_id from matchup where league_id = lid and week = 1 loop
    update matchup set status = 'final',
      home_final = case when m.home_roster_id = 1 then 10.0 else 120.0 end,
      away_final = case when m.away_roster_id = 1 then 10.0 else 118.0 end where id = m.id;
  end loop;
  perform guillotine_tick(lid);
  select sleeper_roster_id into dead from league_membership where league_id = lid and eliminated_week = 1;
  perform tc_true(dead = 1, 'tc2 seat 1 fell');

  -- THE TELLING: standings carry the week
  r := league_standings(lid);
  select x into row_j from jsonb_array_elements(r) x where (x ->> 'roster_id')::int = dead;
  perform tc_true((row_j ->> 'eliminated')::int = 1,
    'tc3 standings name the week the blade fell');
  perform tc_true((select count(*) from jsonb_array_elements(r) x
      where (x ->> 'eliminated') is not null) = 1,
    'tc3a …and only for the seat that fell');

  -- the team desk knows its own fate (the caller owns seat 1, the dead one)
  r := native_team_state(lid);
  perform tc_true((r ->> 'my_roster_id')::int = dead, 'tc4 the caller holds the chopped seat');
  perform tc_true((r ->> 'eliminated')::int = 1,
    'tc4a the team desk carries the caller''s own elimination week');

  -- THE POLITE REFUSAL: an answer, not a raise
  select slug into fa from league_pool lp where lp.league_id = lid
    and not exists (select 1 from native_roster nr where nr.league_id = lid and nr.slug = lp.slug)
    and coalesce(lp.waived_until, now() - interval '1 day') < now() limit 1;
  r := add_free_agent(lid, dead, fa);
  perform tc_true(coalesce((r ->> 'ok')::boolean, true) is false
      and position('guillotine' in coalesce(r ->> 'error', '')) > 0,
    'tc5 add_free_agent ANSWERS a dead seat instead of raising: ' || r::text);
  r := submit_waiver_claim(lid, dead, fa, null, 5);
  perform tc_true(coalesce((r ->> 'ok')::boolean, true) is false
      and position('guillotine' in coalesce(r ->> 'error', '')) > 0,
    'tc5a submit_waiver_claim answers too: ' || r::text);

  -- the helper agrees, and clears the living
  perform tc_true(wire_block_reason(lid, dead) is not null, 'tc6 the helper blocks the dead');
  select sleeper_roster_id into live_seat from league_membership
    where league_id = lid and eliminated_week is null order by sleeper_roster_id limit 1;
  perform tc_true(wire_block_reason(lid, live_seat) is null, 'tc6a …and clears the living');

  -- the trigger still stands behind the pre-check
  begin
    insert into native_roster (league_id, roster_id, slug, acquired) values (lid, dead, fa, 'fa');
    perform tc_true(false, 'tc7 the seat guard must still refuse a direct insert');
  exception when others then
    get stacked diagnostics msg = message_text;
    perform tc_true(position('guillotine' in msg) > 0, 'tc7 the seat guard still raises: ' || msg);
  end;

  -- ══ 🧛 the locked wire answers the same way ════════════════════════════
  vlid := _tc_league('Tell The Locked', 'tl-', 4, 'vampire');
  perform tc_as('1');
  perform tc_true(wire_block_reason(vlid, 2) is null,
    'tc8 an UNLOCKED vampire league blocks nobody');
  r := set_vampires(vlid, jsonb_build_array(1), null, true);
  perform tc_true(coalesce((r ->> 'ok')::boolean, false), 'tc8a the coven is appointed and the wire locked');
  perform tc_true(wire_block_reason(vlid, 2) is not null,
    'tc9 a non-vampire is blocked by the locked wire');
  perform tc_true(wire_block_reason(vlid, 1) is null,
    'tc9a …and the vampire itself is not');
  select slug into fa from league_pool lp where lp.league_id = vlid
    and not exists (select 1 from native_roster nr where nr.league_id = vlid and nr.slug = lp.slug) limit 1;
  r := add_free_agent(vlid, 2, fa);
  perform tc_true(coalesce((r ->> 'ok')::boolean, true) is false
      and position('vampire' in coalesce(r ->> 'error', '')) > 0,
    'tc10 the locked wire ANSWERS instead of raising: ' || r::text);

  -- ══ a standard league is untouched ═════════════════════════════════════
  perform tc_true(wire_block_reason(_tc_league('Tell The Normal', 'tn-', 4, 'standard'), 1) is null,
    'tc11 a standard league blocks nobody');

  raise notice 'tell-the-chopped probes done';
end $$;

select 'ALL TELL-THE-CHOPPED PROBES PASSED' as status;
