-- 0267 probes: the chopping block sees live, the vampire keeps score.
--
-- What must hold:
--   • guillotine_state's alive rows carry `live` — the seat's matchup_state
--     total — while the week is in flight (pts stays null until finals), and
--     `bye` is a real no-matchup test, so a 3-team league's odd seat reads
--     BYE while the two playing seats read their live sums;
--   • the alive sort uses what is known (final, else live), byes last;
--   • fallen rows carry the score the blade fell on;
--   • vampire_state's `record` counts finaled weeks (a tie is not a win),
--     `weeks` lists them newest first with the opponent named, and a steal's
--     row carries the victim's team name.
\set QUIET on
\pset pager off

create or replace function cb_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000c0b0' || u, false);
  perform set_config('app.email', 'cb' || u || '@test.dev', false);
end $$;
create or replace function cb_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function cb_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c0b01', 'cb1@test.dev')
on conflict (id) do nothing;

-- League shell: n seats, guillotine or vampire, tiny pool, seeded rosters,
-- 2-week schedule.
create or replace function _cb_league(nm text, pfx text, n int, fmt text) returns uuid
  language plpgsql as $$
declare r jsonb; lid uuid; pool jsonb := '[]'::jsonb; t int; i int;
begin
  perform cb_as('1');
  r := create_native_league(nm, '2026', n, 5, 60, 'snake');
  if not (r ->> 'ok')::boolean then raise exception 'CB FIXTURE: create failed — %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  r := set_league_format(lid, fmt);
  if not (r ->> 'ok')::boolean then raise exception 'CB FIXTURE: format failed — %', r; end if;
  for i in 1..(n * 5 + 4) loop
    pool := pool || jsonb_build_object('slug', pfx || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  r := seed_league_pool(lid, pool);
  if not (r ->> 'ok')::boolean then raise exception 'CB FIXTURE: seed failed — %', r; end if;
  update draft set status = 'complete' where league_id = lid;
  for t in 1..n loop
    for i in 1..5 loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid, t, pfx || ((t - 1) * 5 + i), 'commish');
    end loop;
  end loop;
  r := native_generate_schedule(lid, 2);
  if not (r ->> 'ok')::boolean then raise exception 'CB FIXTURE: schedule failed — %', r; end if;
  return lid;
end $$;

do $$
declare
  lid uuid; vlid uuid; r jsonb; a jsonb; f jsonb; w jsonb; mid uuid;
  h int; aw int; victim int; vwk1 record; vwk2 record;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000c0b01', 'cb1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000c0b01';

  -- ══ 🔪 THE CHOPPING BLOCK ═════════════════════════════════════════════════
  -- 3 seats: the circle method byes one seat per week.
  lid := _cb_league('Chopping Block', 'cb-', 3, 'guillotine');

  -- The week in flight: live banks for the one week-1 pairing.
  select id, home_roster_id, away_roster_id into mid, h, aw
    from matchup where league_id = lid and week = 1 limit 1;
  insert into matchup_state (matchup_id, game_window, home_score, away_score) values
    (mid, 'sun1', 40.5, 22.0),
    (mid, 'snf',  12.0, 30.5);
  update matchup set status = 'live' where id = mid;

  r := guillotine_state(lid);
  perform cb_true((r ->> 'guillotine')::boolean, 'cb1 guillotine league answers');
  a := r -> 'alive';
  perform cb_true(jsonb_array_length(a) = 3, 'cb1a all three alive');
  -- the byed seat: bye true, live null, sorted last
  perform cb_true((a -> 2 ->> 'bye')::boolean and (a -> 2 ->> 'live') is null,
    'cb2 the odd seat reads a true BYE and sorts last');
  -- the playing seats: live sums (home 52.5, away 52.5? no — home 52.5, away 52.5 would tie;
  -- values above: home 40.5+12 = 52.5, away 22+30.5 = 52.5 — make them differ)
  perform cb_true((a -> 0 ->> 'pts') is null and (a -> 1 ->> 'pts') is null,
    'cb3 no finals yet — pts stays null while live carries the week');
  perform cb_true((a -> 0 ->> 'live') is not null and (a -> 1 ->> 'live') is not null,
    'cb3a …and both playing seats carry live totals');

  -- Make the totals differ, then check the sort: lower live first.
  update matchup_state set away_score = 19.0 where matchup_id = mid and game_window = 'snf';
  r := guillotine_state(lid); a := r -> 'alive';
  perform cb_true((a -> 0 ->> 'roster_id')::int = aw and (a -> 0 ->> 'live')::numeric = 41.0,
    'cb4 the block sorts by live while the week runs (away 22+19=41 under home 52.5)');

  -- Week 1 finals; the blade falls; the fallen row carries the fatal score.
  update matchup set status = 'final',
      home_final = 52.5, away_final = 41.0 where id = mid;
  r := guillotine_tick(lid);
  perform cb_ok(r, 'cb5 the tick runs');
  perform cb_true((r ->> 'eliminated')::int = 1, 'cb5a one elimination');
  r := guillotine_state(lid); f := r -> 'fallen';
  perform cb_true(jsonb_array_length(f) = 1
      and (f -> 0 ->> 'roster_id')::int = aw
      and (f -> 0 ->> 'week')::int = 1
      and (f -> 0 ->> 'pts')::numeric = 41.0,
    'cb6 the chopped list names the team, the week, and the score it died on');
  perform cb_true(jsonb_array_length(r -> 'alive') = 2, 'cb6a two remain — the block scales down');

  -- ══ 🧛 THE FEEDING LOG ════════════════════════════════════════════════════
  vlid := _cb_league('Feeding Log', 'vb-', 4, 'vampire');
  r := set_vampire(vlid, 1, false);
  perform cb_ok(r, 'vp0 the vampire is appointed');

  -- Week 1 finals: the vampire (seat 1) wins its pairing; the other pairing
  -- finals too so the week completes.
  for vwk1 in select id, home_roster_id, away_roster_id from matchup where league_id = vlid and week = 1 loop
    if 1 in (vwk1.home_roster_id, vwk1.away_roster_id) then
      victim := case when vwk1.home_roster_id = 1 then vwk1.away_roster_id else vwk1.home_roster_id end;
      update matchup set status = 'final',
        home_final = case when home_roster_id = 1 then 120.0 else 90.0 end,
        away_final = case when away_roster_id = 1 then 120.0 else 90.0 end
        where id = vwk1.id;
    else
      update matchup set status = 'final', home_final = 100, away_final = 99 where id = vwk1.id;
    end if;
  end loop;

  r := vampire_state(vlid);
  perform cb_true((r ->> 'vampire')::boolean and (r ->> 'won')::boolean, 'vp1 fresh blood after the win');
  perform cb_true((r -> 'record' ->> 'wins')::int = 1 and (r -> 'record' ->> 'losses')::int = 0,
    'vp2 the record counts the win');
  w := r -> 'weeks';
  perform cb_true(jsonb_array_length(w) = 1
      and (w -> 0 ->> 'week')::int = 1
      and (w -> 0 ->> 'won')::boolean
      and (w -> 0 ->> 'for')::numeric = 120.0
      and (w -> 0 ->> 'opp')::int = victim
      and (w -> 0 ->> 'opp_team') is not null,
    'vp3 the log has the win, both totals, and the opponent named');
  perform cb_true((r ->> 'seat_team') is not null, 'vp3a the vampire seat is named');

  -- The bite: take the victim's first player, give one back. Review is off,
  -- so it executes; the steal row names the victim's team.
  r := vampire_steal(vlid, 'vb-' || ((victim - 1) * 5 + 1), 'vb-1');
  perform cb_ok(r, 'vp4 the steal executes');
  r := vampire_state(vlid);
  perform cb_true((r -> 'steals' -> 0 ->> 'victim_team') is not null,
    'vp5 the steal names who got bitten');
  perform cb_true((r ->> 'fed')::boolean, 'vp5a …and the week reads fed');

  -- Week 2: the vampire loses. The record and the log both say so.
  for vwk2 in select id, home_roster_id, away_roster_id from matchup where league_id = vlid and week = 2 loop
    if 1 in (vwk2.home_roster_id, vwk2.away_roster_id) then
      update matchup set status = 'final',
        home_final = case when home_roster_id = 1 then 80.0 else 110.0 end,
        away_final = case when away_roster_id = 1 then 80.0 else 110.0 end
        where id = vwk2.id;
    else
      update matchup set status = 'final', home_final = 100, away_final = 99 where id = vwk2.id;
    end if;
  end loop;
  r := vampire_state(vlid);
  perform cb_true((r -> 'record' ->> 'wins')::int = 1 and (r -> 'record' ->> 'losses')::int = 1,
    'vp6 the loss lands in the record');
  w := r -> 'weeks';
  perform cb_true(jsonb_array_length(w) = 2 and (w -> 0 ->> 'week')::int = 2
      and (w -> 0 ->> 'won')::boolean is false,
    'vp7 the log runs newest first and the loss is honest');
  perform cb_true((r ->> 'won')::boolean is false, 'vp8 no fresh blood off a loss');

  raise notice 'chopping-block probes done';
end $$;

select 'ALL CHOPPING-BLOCK PROBES PASSED' as status;
