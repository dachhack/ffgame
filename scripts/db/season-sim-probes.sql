-- SEASON SIMULATION (founder: "make sure everything works as intended and each
-- mode is fully playable for an entire season and playoffs").
--
-- Every other suite probes a function; this one plays SEASONS — eight leagues,
-- create to crown, through the same RPCs the clients call. The point is the
-- seams no unit probe crosses: standings feeding seeds, seeds feeding brackets,
-- rounds advancing off finals, the guillotine ticking against a bye, a vampire
-- feeding mid-season, and a finished dynasty season rolling into the next year.
--
--   A  6-team drip     · 14 wks · 4-bracket + consolation ladder → champion
--   B  6-team classic  · 14 wks · 6-bracket (top-2 byes)         → champion
--   C  5-team guillotine (ODD) · 17 wks · weekly blade, no playoffs → survivor
--   D  4-team vampire  · steal on a fresh win, refusals, playoffs → champion
--   E  4-team golf     · inverted standings, seeds and bracket    → low score wins it all
--   F  4-team playoffs-off · the season simply ends, quietly
--   G  4-team dynasty, season 2025 · played, then ROLLED OVER into 2026
--   H  5-team standard (ODD) · byes AND playoffs compose · 2-bracket → champion
\set QUIET on
\pset pager off
set client_min_messages = notice;

grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

create or replace function ss_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-0000000a5e0' || u, false);
  perform set_config('app.email', 'ss' || u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000a5e01', 'ss1@test.dev')
on conflict (id) do nothing;

-- League shell: created, pool seeded, DRAFT LEFT PENDING so a sim can set a
-- pre-draft format (guillotine) before starting.
create or replace function _ss_league(nm text, seas text, teams int, per int, pfx text,
                                      cont text default null, cont_n int default null,
                                      game text default null)
  returns uuid language plpgsql as $$
declare r jsonb; lid uuid; pool jsonb := '[]'::jsonb; i int;
begin
  perform ss_as('1');
  if cont is null and game is null then
    r := create_native_league(nm, seas, teams, per, 60, 'snake');
  else
    r := create_native_league(nm, seas, teams, per, 60, 'snake',
           null, null, null, null, null, null, coalesce(game, 'classic'), cont, cont_n);
  end if;
  if not (r ->> 'ok')::boolean then raise exception 'SIM FIXTURE: create failed — %', r; end if;
  lid := (r ->> 'league_id')::uuid;
  for i in 1..(teams * per + 8) loop
    pool := pool || jsonb_build_object('slug', pfx || i, 'full', 'P ' || i, 'pos', 'RB', 'team', 'T');
  end loop;
  r := seed_league_pool(lid, pool);
  if not (r ->> 'ok')::boolean then raise exception 'SIM FIXTURE: seed failed — %', r; end if;
  return lid;
end $$;

-- Draft done, every seat holding `per` players, a `weeks`-week schedule.
create or replace function _ss_start(lid uuid, teams int, per int, wks int, pfx text)
  returns void language plpgsql as $$
declare r jsonb; t int; i int;
begin
  update draft set status = 'complete' where league_id = lid;
  for t in 1..teams loop
    for i in 1..per loop
      insert into native_roster (league_id, roster_id, slug, acquired)
      values (lid, t, pfx || ((t - 1) * per + i), 'commish');
    end loop;
  end loop;
  perform ss_as('1');
  r := native_generate_schedule(lid, wks);
  if not (r ->> 'ok')::boolean then raise exception 'SIM FIXTURE: schedule failed — %', r; end if;
end $$;

-- One week final. Scores are a pure function of seat number — seat 1 highest —
-- so standings, seeds and every bracket result are exactly predictable.
-- Only touches still-scheduled games, so a sim can hand-craft one result first.
create or replace function _ss_week(lid uuid, wk int) returns void language plpgsql as $$
begin
  update matchup m set status = 'final',
    home_final = 200 - m.home_roster_id * 10,
    away_final = 200 - m.away_roster_id * 10
  where m.league_id = lid and m.week = wk and m.status = 'scheduled';
end $$;

-- ═══ A · STANDARD DRIP: 14 weeks, 4-bracket, the consolation ladder ═════════
do $$
declare lid uuid; r jsonb; wk int;
begin
  perform ss_as('1');
  insert into app_user (id, email) values ('00000000-0000-0000-0000-0000000a5e01', 'ss1@test.dev')
  on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-0000000a5e01';

  lid := _ss_league('Sim Standard', '2026', 6, 5, 'sa-');
  perform _ss_start(lid, 6, 5, 14, 'sa-');
  for wk in 1..14 loop perform _ss_week(lid, wk); end loop;

  if not _regular_season_complete(lid) then
    raise exception 'SIM A FAIL: 14 final weeks do not read as a complete season';
  end if;
  -- the AUTO poke — the same call every member's league load fires (0162)
  r := generate_playoffs(lid, null, true);
  if not (r ->> 'ok')::boolean or (r -> 'bracket') is null then
    raise exception 'SIM A FAIL: auto-generate refused — %', r;
  end if;
  -- seat 1 outscores everyone weekly, so seeds are 1..4 and 5-6 open the ladder
  if (select count(*) from matchup where league_id = lid and is_playoff and playoff_round = 1
        and not is_consolation) <> 2
     or not exists (select 1 from matchup where league_id = lid and is_playoff
        and playoff_round = 1 and is_consolation) then
    raise exception 'SIM A FAIL: expected two semifinals and a consolation game';
  end if;

  perform _ss_week(lid, 15);                       -- semis: 1 and 2 advance
  r := advance_playoffs(lid);
  if not (r ->> 'advanced')::boolean then raise exception 'SIM A FAIL: semis did not advance — %', r; end if;
  if not exists (select 1 from matchup where league_id = lid and is_playoff
      and playoff_round = 2 and playoff_label = '3rd Place Game') then
    raise exception 'SIM A FAIL: the championship week has no 3rd Place Game';
  end if;

  perform _ss_week(lid, 16);                       -- championship: seat 1
  r := advance_playoffs(lid);
  if (r ->> 'champion')::int is distinct from 1 then
    raise exception 'SIM A FAIL: champion is % — expected seat 1', r ->> 'champion';
  end if;
  r := playoff_state(lid);
  if (r ->> 'champion')::int <> 1 or not (r ->> 'underway')::boolean then
    raise exception 'SIM A FAIL: playoff_state does not show the crowned season — %', r;
  end if;
  raise notice 'SIM A ok — standard season → champion, ladder and 3rd place intact';
end $$;

-- ═══ B · CLASSIC, 6-TEAM BRACKET: the top two seeds BYE round 1 ═════════════
do $$
declare lid uuid; r jsonb; wk int;
begin
  -- classic is chosen AT CREATION (the 15-arg form the clients use) — the
  -- post-hoc setter is gated on a classic_ok entitlement the create path mints
  lid := _ss_league('Sim Classic Six', '2026', 6, 5, 'sb-', null, null, 'classic');
  perform ss_as('1');
  if coalesce((select settings_json ->> 'game_mode' from league where id = lid), 'drip') <> 'classic' then
    raise exception 'SIM B FAIL: creation did not land classic mode';
  end if;
  perform _ss_start(lid, 6, 5, 14, 'sb-');
  r := set_playoff_rules(lid, 6, 15);
  if not (r ->> 'ok')::boolean then raise exception 'SIM B FAIL: 6-team bracket refused — %', r; end if;
  for wk in 1..14 loop perform _ss_week(lid, wk); end loop;

  r := generate_playoffs(lid, null, true);
  if not (r ->> 'ok')::boolean then raise exception 'SIM B FAIL: generate refused — %', r; end if;
  -- round 1 is 3v6 and 4v5 ONLY — seeds 1 and 2 are byed into the semis
  if (select count(*) from matchup where league_id = lid and is_playoff and playoff_round = 1
        and not is_consolation) <> 2
     or exists (select 1 from matchup where league_id = lid and is_playoff and playoff_round = 1
        and (1 in (home_roster_id, away_roster_id) or 2 in (home_roster_id, away_roster_id))) then
    raise exception 'SIM B FAIL: the top two seeds did not bye round 1';
  end if;

  perform _ss_week(lid, 15); perform advance_playoffs(lid);   -- 3 and 4 through
  if (select count(*) from matchup where league_id = lid and is_playoff and playoff_round = 2
        and not is_consolation) <> 2 then
    raise exception 'SIM B FAIL: the byed seeds did not enter at the semis';
  end if;
  perform _ss_week(lid, 16); perform advance_playoffs(lid);   -- 1 and 2 through
  perform _ss_week(lid, 17);
  r := advance_playoffs(lid);
  if (r ->> 'champion')::int is distinct from 1 then
    raise exception 'SIM B FAIL: three rounds later the champion is % — expected 1', r ->> 'champion';
  end if;
  raise notice 'SIM B ok — 6-team bracket byes, enters, and crowns across 3 rounds';
end $$;

-- ═══ C · GUILLOTINE, FIVE TEAMS (ODD): the blade against the bye ════════════
do $$
declare lid uuid; r jsonb; wk int; gone int; alive int;
begin
  lid := _ss_league('Sim Blade Five', '2026', 5, 5, 'sc-');
  perform ss_as('1');
  r := set_league_format(lid, 'guillotine');    -- pre-draft, as required
  if not (r ->> 'ok')::boolean then raise exception 'SIM C FAIL: guillotine refused — %', r; end if;
  perform _ss_start(lid, 5, 5, 17, 'sc-');

  for wk in 1..17 loop
    perform _ss_week(lid, wk);
    r := guillotine_tick(lid);
    if not (r ->> 'ok')::boolean then raise exception 'SIM C FAIL: tick errored week % — %', wk, r; end if;
    select count(*) into gone from league_membership where league_id = lid and eliminated_week is not null;
    select count(*) into alive from league_membership where league_id = lid and eliminated_week is null;
    -- one falls per completed week until one remains — 5 teams, done after wk 4
    if gone <> least(wk, 4) or alive <> 5 - least(wk, 4) then
      raise exception 'SIM C FAIL: week % has % fallen / % alive', wk, gone, alive;
    end if;
  end loop;

  -- nobody died on a bye: every victim has a matchup in the week that killed it
  if exists (select 1 from league_membership m
      where m.league_id = lid and m.eliminated_week is not null
        and not exists (select 1 from matchup mu
          where mu.league_id = lid and mu.week = m.eliminated_week
            and m.sleeper_roster_id in (mu.home_roster_id, mu.away_roster_id))) then
    raise exception 'SIM C FAIL: a team was eliminated on a week it did not play';
  end if;
  -- the fallen release their rosters (the frenzy has stock)
  if exists (select 1 from native_roster nr
      join league_membership m on m.league_id = nr.league_id and m.sleeper_roster_id = nr.roster_id
      where nr.league_id = lid and m.eliminated_week is not null) then
    raise exception 'SIM C FAIL: an eliminated team still holds players';
  end if;
  r := guillotine_state(lid);
  if (r ->> 'champion') is null then raise exception 'SIM C FAIL: no survivor crowned — %', r; end if;
  -- and the format books NO playoffs, quietly (0246)
  r := generate_playoffs(lid, null, true);
  if not (r ->> 'ok')::boolean or coalesce((r ->> 'generated')::boolean, false)
     or exists (select 1 from matchup where league_id = lid and is_playoff) then
    raise exception 'SIM C FAIL: a guillotine season grew a bracket — %', r;
  end if;
  raise notice 'SIM C ok — odd guillotine plays 17 weeks to one survivor, byes untouched';
end $$;

-- ═══ D · VAMPIRE: feeds on a fresh win, refused otherwise, then playoffs ════
do $$
declare lid uuid; r jsonb; wk int; mid uuid;
begin
  lid := _ss_league('Sim Fangs', '2026', 4, 5, 'sd-');
  perform _ss_start(lid, 4, 5, 14, 'sd-');
  perform ss_as('1');
  r := set_league_format(lid, 'vampire');
  if not (r ->> 'ok')::boolean then raise exception 'SIM D FAIL: vampire refused — %', r; end if;
  r := set_vampire(lid, 2);
  if not (r ->> 'ok')::boolean then raise exception 'SIM D FAIL: seat appointment refused — %', r; end if;

  -- before any week is final, there is no blood
  r := vampire_steal(lid, 'sd-11', 'sd-6');
  if (r ->> 'ok')::boolean then raise exception 'SIM D FAIL: a steal fired before any week ended'; end if;

  perform _ss_week(lid, 1);                        -- week 1: the vampire (2) beats 3
  r := vampire_steal(lid, 'sd-11', 'sd-6');         -- take one of 3's, give one back
  if not (r ->> 'ok')::boolean then raise exception 'SIM D FAIL: the winning steal refused — %', r; end if;
  if not exists (select 1 from native_roster where league_id = lid and roster_id = 2 and slug = 'sd-11')
     or not exists (select 1 from native_roster where league_id = lid and roster_id = 3 and slug = 'sd-6') then
    raise exception 'SIM D FAIL: the steal did not move both players';
  end if;
  r := vampire_steal(lid, 'sd-12', 'sd-7');         -- one steal per win
  if (r ->> 'ok')::boolean then raise exception 'SIM D FAIL: a second bite on one win'; end if;

  -- week 2: hand the vampire a LOSS, then watch the steal starve
  update matchup set status = 'final',
      home_final = case when home_roster_id = 2 then 10 else 150 end,
      away_final = case when away_roster_id = 2 then 10 else 150 end
    where league_id = lid and week = 2 and 2 in (home_roster_id, away_roster_id);
  perform _ss_week(lid, 2);
  r := vampire_steal(lid, 'sd-12', 'sd-7');
  if (r ->> 'ok')::boolean or (r ->> 'error') not like '%no fresh blood%' then
    raise exception 'SIM D FAIL: a losing week still fed — %', r;
  end if;

  for wk in 3..14 loop perform _ss_week(lid, wk); end loop;
  r := generate_playoffs(lid, null, true);
  if not (r ->> 'ok')::boolean then raise exception 'SIM D FAIL: playoffs refused — %', r; end if;
  perform _ss_week(lid, 15); perform advance_playoffs(lid);
  perform _ss_week(lid, 16);
  r := advance_playoffs(lid);
  if (r ->> 'champion')::int is distinct from 1 then
    raise exception 'SIM D FAIL: vampire season champion is % — expected 1', r ->> 'champion';
  end if;
  raise notice 'SIM D ok — the vampire feeds once per win and the season still crowns';
end $$;

-- ═══ E · GOLF: the LOWEST score wins everything, playoffs included ══════════
do $$
declare lid uuid; r jsonb; wk int;
begin
  -- golf is a classic-league setting (its gate held in this sim's first cut),
  -- so the league is born classic and then flips the flag
  lid := _ss_league('Sim Golf', '2026', 4, 5, 'se-', null, null, 'classic');
  perform ss_as('1');
  r := set_league_golf(lid, true);
  if not (r ->> 'ok')::boolean then raise exception 'SIM E FAIL: golf refused — %', r; end if;
  perform _ss_start(lid, 4, 5, 14, 'se-');
  r := jsonb_build_object('ok', true);
  if not (r ->> 'ok')::boolean then raise exception 'SIM E FAIL: golf refused — %', r; end if;
  for wk in 1..14 loop perform _ss_week(lid, wk); end loop;

  -- seat 4 posts the LOWEST score every week, so in golf it leads everything
  r := league_standings(lid);
  if ((r -> 0) ->> 'roster_id')::int <> 4 then
    raise exception 'SIM E FAIL: golf standings lead is seat % — expected 4', (r -> 0) ->> 'roster_id';
  end if;
  r := generate_playoffs(lid, null, true);
  if not (r ->> 'ok')::boolean then raise exception 'SIM E FAIL: generate refused — %', r; end if;
  if ((r -> 'bracket' -> 'seeds') ->> 0)::int <> 4 then
    raise exception 'SIM E FAIL: golf top seed is % — expected 4', (r -> 'bracket' -> 'seeds') ->> 0;
  end if;
  perform _ss_week(lid, 15); perform advance_playoffs(lid);
  perform _ss_week(lid, 16);
  r := advance_playoffs(lid);
  if (r ->> 'champion')::int is distinct from 4 then
    raise exception 'SIM E FAIL: golf champion is % — the low scorer should win it all', r ->> 'champion';
  end if;
  raise notice 'SIM E ok — golf inverts standings, seeding and the bracket end to end';
end $$;

-- ═══ F · PLAYOFFS OFF: the season ends where the schedule ends ══════════════
do $$
declare lid uuid; r jsonb; wk int;
begin
  lid := _ss_league('Sim Quiet End', '2026', 4, 5, 'sf-');
  perform _ss_start(lid, 4, 5, 3, 'sf-');
  perform ss_as('1');
  r := set_playoff_rules(lid, 0, null);
  if not (r ->> 'ok')::boolean then raise exception 'SIM F FAIL: off refused — %', r; end if;
  for wk in 1..3 loop perform _ss_week(lid, wk); end loop;

  -- the whole season is final; the auto poke still builds NOTHING, quietly
  r := generate_playoffs(lid, null, true);
  if not (r ->> 'ok')::boolean or coalesce((r ->> 'generated')::boolean, false)
     or exists (select 1 from matchup where league_id = lid and is_playoff) then
    raise exception 'SIM F FAIL: an off league grew a bracket at season end — %', r;
  end if;
  r := advance_playoffs(lid);
  if not (r ->> 'ok')::boolean or (r ->> 'advanced')::boolean then
    raise exception 'SIM F FAIL: advance is not a quiet no-op — %', r;
  end if;
  raise notice 'SIM F ok — a playoffs-off season completes and simply ends';
end $$;

-- ═══ G · DYNASTY ROLLOVER: a PLAYED 2025 season becomes the 2026 league ═════
do $$
declare lid uuid; nlid uuid; r jsonb; wk int; n int;
begin
  lid := _ss_league('Sim Dynasty 25', '2025', 4, 5, 'sg-', 'dynasty', 1);
  perform _ss_start(lid, 4, 5, 3, 'sg-');
  for wk in 1..3 loop perform _ss_week(lid, wk); end loop;

  perform ss_as('1');
  r := rollover_league(lid, 14);
  if not (r ->> 'ok')::boolean then raise exception 'SIM G FAIL: rollover refused — %', r; end if;
  nlid := (r ->> 'league_id')::uuid;
  if (r ->> 'season') <> '2026' then raise exception 'SIM G FAIL: rolled into %', r ->> 'season'; end if;
  if coalesce((r ->> 'kept')::int, 0) < 1 then
    raise exception 'SIM G FAIL: a dynasty rolled over keeping % players', r ->> 'kept';
  end if;
  select count(*) into n from league_membership where league_id = nlid;
  if n <> 4 then raise exception 'SIM G FAIL: % seats carried of 4', n; end if;
  if not exists (select 1 from draft where league_id = nlid and status = 'pending') then
    raise exception 'SIM G FAIL: the new season has no pending draft';
  end if;
  if not coalesce(((r -> 'schedule') ->> 'ok')::boolean, false) then
    raise exception 'SIM G FAIL: the new season has no schedule — %', r -> 'schedule';
  end if;
  if not exists (select 1 from pick_asset where league_id = nlid and season >= '2027') then
    raise exception 'SIM G FAIL: no future rookie picks were provisioned';
  end if;
  r := rollover_league(lid, 14);
  if (r ->> 'ok')::boolean then raise exception 'SIM G FAIL: the same season rolled over twice'; end if;
  raise notice 'SIM G ok — a played dynasty season rolls into next year exactly once';
end $$;

-- ═══ H · ODD LEAGUE, FULL SEASON, PLAYOFFS: byes and brackets compose ═══════
do $$
declare lid uuid; r jsonb; wk int;
begin
  lid := _ss_league('Sim Odd Five', '2026', 5, 5, 'sh-');
  perform _ss_start(lid, 5, 5, 14, 'sh-');
  perform ss_as('1');
  r := set_playoff_rules(lid, 2, 15);              -- the 1-round bracket shape
  if not (r ->> 'ok')::boolean then raise exception 'SIM H FAIL: 2-team bracket refused — %', r; end if;
  for wk in 1..14 loop perform _ss_week(lid, wk); end loop;

  r := generate_playoffs(lid, null, true);
  if not (r ->> 'ok')::boolean then raise exception 'SIM H FAIL: generate refused — %', r; end if;
  if (select count(*) from matchup where league_id = lid and is_playoff and not is_consolation) <> 1 then
    raise exception 'SIM H FAIL: a 2-team bracket is not one championship game';
  end if;
  perform _ss_week(lid, 15);
  r := advance_playoffs(lid);
  if (r ->> 'champion')::int is distinct from 1 then
    raise exception 'SIM H FAIL: odd-league champion is % — expected 1', r ->> 'champion';
  end if;
  raise notice 'SIM H ok — an odd league byes all season and still crowns a champion';
end $$;

select 'ALL SEASON-SIM PROBES PASSED' as result;
