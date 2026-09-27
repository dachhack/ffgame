-- 0388 probes: A PLAYER WHO CAN'T BE MOVED CAN'T MAKE THE ROSTER ILLEGAL.
--
-- #1028, Kickoff League, Friday night: a manager could not touch his lineup.
-- The deadlock: an IR player whose game kicked off Thursday is upgraded on
-- Friday's report → roster_illegal_reason says "move him off IR or drop him"
-- → every lineup write is refused (0128) → but the kickoff lock (0179) refuses
-- moving or dropping him until the week is final.
--
-- What must hold:
--   • the IR player whose game has kicked off no longer makes the roster
--     illegal, so the lineup saves;
--   • he still cannot be moved or dropped this week (the lock is unchanged);
--   • an IR player whose game is still AHEAD and whose tag lapsed still makes
--     the roster illegal — he can be moved, so the manager must;
--   • the same for an OUT spot;
--   • when the week goes final the excuse ends and the roster is flagged again.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function ls_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function ls_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function ls_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000009' || u, false); perform set_config('app.email', 'ls' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000901', 'ls01@test.dev'), ('00000000-0000-0000-0000-000000000902', 'ls02@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000000901', 'ls01@test.dev'), ('00000000-0000-0000-0000-000000000902', 'ls02@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in ('00000000-0000-0000-0000-000000000901', '00000000-0000-0000-0000-000000000902');

do $$
declare r jsonb; lid uuid; code text; a int; b int; wk int; mid uuid; ssn text; raised text;
  bu uuid := '00000000-0000-0000-0000-000000000902';
begin
  perform ls_as('01');
  r := create_native_league('LockedStash', '2026', 2, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform ls_ok(r, 'ls0 classic league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform ls_as('02'); perform ls_ok(native_join(code, 'LS-B'), 'ls0 B takes a seat'); perform ls_as('01');
  perform ls_ok(set_league_classic_slots(lid, '[{"pos":["QB"]},{"pos":["RB"]},{"pos":["WR"]}]'::jsonb), 'ls0 three spots');
  perform ls_ok(set_league_roster_shape(lid, 2, 0, 2, 1), 'ls0 two bench, two IR, one OUT');
  -- LSH played Thursday; LSS plays Sunday.
  perform seed_league_pool(lid, '[
    {"slug":"ls-thu","full":"Thursday Guy","pos":"WR","team":"LSH","exp":4},
    {"slug":"ls-sun","full":"Sunday Guy","pos":"RB","team":"LSS","exp":4},
    {"slug":"ls-out","full":"Out Guy","pos":"WR","team":"LSH","exp":4},
    {"slug":"ls-qb","full":"Quarter Back","pos":"QB","team":"LSS","exp":4},
    {"slug":"ls-rb","full":"Running Back","pos":"RB","team":"LSS","exp":4},
    {"slug":"ls-wr","full":"Wide Out","pos":"WR","team":"LSS","exp":4}]'::jsonb);
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000000901';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = bu;
  perform ls_ok(native_generate_schedule(lid, 2), 'ls0 the schedule');
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, b, 'ls-thu', 'draft'), (lid, b, 'ls-sun', 'draft'), (lid, b, 'ls-out', 'draft'),
    (lid, b, 'ls-qb', 'draft'), (lid, b, 'ls-rb', 'draft'), (lid, b, 'ls-wr', 'draft');
  update draft set status = 'complete' where league_id = lid;
  select league_live_week(lid) into wk;
  perform ls_true(wk is not null, 'ls0 the league has a live week');
  select id into mid from matchup where league_id = lid and week = wk and b in (home_roster_id, away_roster_id);

  -- Before any kickoff, all three go on their shelves, designated.
  insert into injury_status (player_slug, status) values ('ls-thu', 'IR'), ('ls-sun', 'O'), ('ls-out', 'D')
    on conflict (player_slug) do update set status = excluded.status;
  perform ls_as('02');
  perform ls_ok(set_roster_spot(lid, 'ls-thu', 'ir'), 'ls0 Thursday Guy to IR');
  perform ls_ok(set_roster_spot(lid, 'ls-sun', 'ir'), 'ls0 Sunday Guy to IR');
  perform ls_ok(set_roster_spot(lid, 'ls-out', 'out'), 'ls0 Out Guy to OUT');
  perform ls_true(roster_illegal_reason(lid, b) is null, 'ls0 legal as stashed');

  -- Thursday kicks off (six hours ago); Sunday is a day out.
  ssn := coalesce((select max(s.season) from nfl_slate s where s.week = wk), '2026');
  insert into nfl_slate (season, week, win, home, away, kickoff) values
    (ssn, wk, 'tnf', 'LSH', 'LSA', now() - interval '6 hours'),
    (ssn, wk, 'sun_early', 'LSS', 'LSB', now() + interval '1 day')
    on conflict (season, week, home) do update set kickoff = excluded.kickoff;
  perform ls_true(classic_slug_started(lid, 'ls-thu'), 'ls0 Thursday Guy has kicked off');
  perform ls_true(not classic_slug_started(lid, 'ls-sun'), 'ls0 Sunday Guy has not');

  -- ── ls1. Friday's report upgrades the Thursday IR player ──
  update injury_status set status = 'Q' where player_slug = 'ls-thu';
  perform ls_true(roster_illegal_reason(lid, b) is null,
    'ls1 a lapsed IR tag on a player who can''t be moved does not make the roster illegal (got '
    || coalesce(roster_illegal_reason(lid, b), 'null') || ')');
  -- …so the lineup saves.
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, bu, 'wk', 'S1', 'ls-qb');
  perform ls_true(exists (select 1 from sealed_pick where matchup_id = mid and app_user_id = bu and player_slug = 'ls-qb'),
    'ls1a the lineup save goes through');
  -- …and the lock on him is unchanged.
  raised := null;
  begin
    perform set_roster_spot(lid, 'ls-thu', 'active');
  exception when others then raised := sqlerrm;
  end;
  perform ls_true(raised ilike '%kicked off%', 'ls1b he still cannot come off IR this week (got ' || coalesce(raised, 'no error') || ')');
  perform ls_true((select spot from native_roster where league_id = lid and slug = 'ls-thu') = 'ir', 'ls1c he is still on IR');
  -- No healed row at all reads the same as an upgrade.
  delete from injury_status where player_slug = 'ls-thu';
  perform ls_true(roster_illegal_reason(lid, b) is null, 'ls1d a deleted designation is excused the same way');

  -- ── ls2. a lapsed tag on a player who CAN still be moved is still illegal ──
  update injury_status set status = 'Q' where player_slug = 'ls-sun';
  perform ls_true(roster_illegal_reason(lid, b) ilike 'Sunday Guy is on IR%',
    'ls2 Sunday Guy can be moved, so the roster is illegal (got ' || coalesce(roster_illegal_reason(lid, b), 'null') || ')');
  raised := null;
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid, bu, 'wk', 'S2', 'ls-rb');
  exception when others then raised := sqlerrm;
  end;
  perform ls_true(raised ilike 'Roster over its limits%', 'ls2a and the lineup is locked (got ' || coalesce(raised, 'no error') || ')');
  update injury_status set status = 'O' where player_slug = 'ls-sun';
  perform ls_true(roster_illegal_reason(lid, b) is null, 'ls2b re-designated, legal again');

  -- ── ls3. the OUT spot is excused the same way ──
  update injury_status set status = 'Q' where player_slug = 'ls-out';
  perform ls_true(roster_illegal_reason(lid, b) is null, 'ls3 a kicked-off player in OUT is excused too');

  -- ── ls4. the week goes final: the excuse ends ──
  update matchup set status = 'final' where league_id = lid and week = wk;
  perform ls_true(league_live_week(lid) is distinct from wk, 'ls4 the live week moved on');
  perform ls_true(not classic_slug_started(lid, 'ls-thu'), 'ls4a Thursday Guy is movable again');
  perform ls_true(roster_illegal_reason(lid, b) ilike 'Thursday Guy is on IR%',
    'ls4b and his lapsed tag makes the roster illegal again (got ' || coalesce(roster_illegal_reason(lid, b), 'null') || ')');

  raise notice 'locked-stash probes done';
end $$;

select 'ALL LOCKED-STASH PROBES PASSED' as result;
