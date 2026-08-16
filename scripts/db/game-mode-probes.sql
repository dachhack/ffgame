-- 0157 game-mode probes: NORMIE MODE — the classic-fantasy league switch.
--
-- What must hold:
--   • default mode is drip; the commissioner sets classic (+ ppr); a member is
--     refused; ppr outside {0, 0.5, 1} is refused; any member reads the mode;
--   • classic implies power-ups OFF: league_live_buffs reads off, arm_buff and
--     hero additions refuse (hero shrink stays allowed), league_preview's
--     rules.live_buffs goes false and its game_mode says classic;
--   • classic lineups ride sealed_pick under win 'wk': nine starters save,
--     a tenth is rejected by the slot cap, and null metric_id passes the
--     locked-metric guard;
--   • the mode FREEZES once the draft leaves pending.
\set QUIET on
\pset pager off

create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function assert_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then
    raise exception 'PROBE FAIL % — expected error like "%", got %', msg, needle, r;
  end if;
end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

do $$
declare r jsonb; lid uuid; code text; mid uuid; i int;
declare slots text[] := array['QB','RB1','RB2','WR1','WR2','TE','FLEX','K','DEF'];
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  r := create_native_league('Normie League', '2026', 4, 7, 60);
  perform assert_ok(r, 'gm0 create');
  lid := (r ->> 'league_id')::uuid;
  code := r ->> 'invite_code';
  perform probe_as('c'); perform assert_ok(native_join(code, 'GM-C'), 'gm1 c joins');

  -- default drip; member refused the flip; bad ppr refused; outsider reads nothing
  perform assert_true((league_game_mode(lid) ->> 'mode') = 'drip', 'gm2 default drip');
  perform assert_err(set_league_game_mode(lid, 'classic'), 'commissioner', 'gm3 member cannot flip');
  perform probe_as('d');
  perform assert_err(league_game_mode(lid), 'forbidden', 'gm4 outsider reads nothing');
  perform probe_as('b');
  perform assert_err(set_league_game_mode(lid, 'chaos'), 'drip or classic', 'gm5 unknown mode refused');
  perform assert_err(set_league_game_mode(lid, 'classic', 0.75), 'ppr', 'gm5a bad ppr refused');

  -- the feature flag (0158): classic is refused until the ADMIN unlocks it
  perform assert_err(set_league_game_mode(lid, 'classic', 0.5), 'not enabled', 'gm5b classic gated behind the flag');
  perform assert_err(set_league_classic_access(lid, true), 'admin', 'gm5c commish cannot flip the flag');
  perform assert_true(not (league_game_mode(lid) ->> 'classic_ok')::boolean, 'gm5d flag reads off');
  perform probe_as('a');
  perform assert_ok(set_league_classic_access(lid, true), 'gm5e admin unlocks classic');
  perform probe_as('b');
  perform assert_true((league_game_mode(lid) ->> 'classic_ok')::boolean, 'gm5f flag reads on');

  -- commissioner sets classic + half PPR; member reads both
  perform assert_ok(set_league_game_mode(lid, 'classic', 0.5), 'gm6 commish sets classic');
  perform probe_as('c');
  perform assert_true((league_game_mode(lid) ->> 'mode') = 'classic', 'gm7 member reads classic');
  perform assert_true((league_game_mode(lid) ->> 'ppr')::numeric = 0.5, 'gm7a member reads ppr');

  -- classic implies power-ups off at every surface
  perform assert_true(not (league_live_buffs(lid) ->> 'on')::boolean, 'gm8 live_buffs reads off in classic');
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
  values (lid, 1, 2, 1, 'scheduled') returning id into mid;
  set local role authenticated;
  perform probe_as('c');
  perform assert_err(arm_buff(mid, 'momentum'), 'turned off', 'gm9 arm refused in classic');
  perform assert_err(hero_set_buffs(mid, '["momentum"]'::jsonb), 'turned off', 'gm9a hero add refused in classic');
  perform assert_ok(hero_set_buffs(mid, '[]'::jsonb), 'gm9b hero clear still allowed');
  r := league_preview(lid);
  perform assert_true((r ->> 'game_mode') = 'classic', 'gm10 preview says classic');
  perform assert_true(not (r -> 'rules' ->> 'live_buffs')::boolean, 'gm10a preview shows power-ups off');

  -- classic lineup rides sealed_pick under 'wk': 9 starters in, the 10th out
  for i in 1..9 loop
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', slots[i], 'probe-player-' || i);
  end loop;
  perform assert_true((select count(*) from sealed_pick
      where matchup_id = mid and app_user_id = '00000000-0000-0000-0000-00000000000c'
        and game_window = 'wk') = 9, 'gm11 nine classic starters saved');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'BENCH1', 'probe-player-10');
    raise exception 'PROBE FAIL gm12 — a tenth classic pick was accepted';
  exception when check_violation then null;
  end;

  -- once the week's first kickoff passes, 'wk' writes are refused at the DB
  -- (the 0058 anti-sniping trigger, taught the classic pseudo-window)
  reset role;
  insert into nfl_slate (season, week, win, away, home, kickoff)
  values ('2026', 1, 'tnf', 'AAA', 'BBB', now() - interval '1 hour');
  set local role authenticated;
  perform probe_as('c');
  begin
    update sealed_pick set player_slug = 'probe-late-swap'
      where matchup_id = mid and app_user_id = '00000000-0000-0000-0000-00000000000c'
        and game_window = 'wk' and roster_slot = 'QB';
    raise exception 'PROBE FAIL gm12a — classic lineup editable after first kickoff';
  exception when check_violation then null;
  end;
  reset role;
  delete from nfl_slate where season = '2026' and week = 1 and away = 'AAA';
  set local role authenticated;

  -- best ball (0159): classic-only, commish-only, sanitized, member-readable
  perform probe_as('c');
  perform assert_err(set_league_bestball(lid, '["FLEX"]'::jsonb), 'commissioner', 'bb0 member cannot set best ball');
  perform probe_as('b');
  r := set_league_bestball(lid, '["FLEX", "BOGUS", "FLEX", "K"]'::jsonb);
  perform assert_ok(r, 'bb1 commish sets best ball');
  perform assert_true(r -> 'bestball' = '["FLEX","K"]'::jsonb, 'bb2 sanitized to known slots, canonical order (got ' || (r -> 'bestball')::text || ')');
  perform probe_as('c');
  perform assert_true((league_game_mode(lid) -> 'bestball') = '["FLEX","K"]'::jsonb, 'bb3 member reads the set');
  perform probe_as('b');
  r := set_league_bestball(lid, '["QB","RB1","RB2","WR1","WR2","TE","FLEX","K","DEF"]'::jsonb);
  perform assert_true(jsonb_array_length(r -> 'bestball') = 9, 'bb4 entire roster accepted');
  perform assert_ok(set_league_bestball(lid, '[]'::jsonb), 'bb5 clear back to off');
  perform assert_true((league_game_mode(lid) -> 'bestball') = '[]'::jsonb, 'bb6 reads off after clear');
  perform assert_ok(set_league_bestball(lid, '["FLEX"]'::jsonb), 'bb7 re-arm for freeze probe');

  -- classic scoring (0160): commish-only, classic-only, clamped, member-readable
  perform probe_as('c');
  perform assert_err(set_league_classic_scoring(lid, '{"passTd": 6}'::jsonb), 'commissioner', 'cs0 member cannot set scoring');
  perform probe_as('b');
  r := set_league_classic_scoring(lid, '{"passTd": 6, "int": -99, "passYd": 5, "bogus": 9, "sack": "junk"}'::jsonb);
  perform assert_ok(r, 'cs1 commish sets scoring');
  perform assert_true((r -> 'scoring' ->> 'passTd')::numeric = 6, 'cs2 passTd stored');
  perform assert_true((r -> 'scoring' ->> 'int')::numeric = -10, 'cs3 int clamped to -10');
  perform assert_true((r -> 'scoring' ->> 'passYd')::numeric = 1, 'cs4 per-yard clamped to 1');
  perform assert_true(not (r -> 'scoring') ? 'bogus', 'cs5 unknown key dropped');
  perform assert_true(not (r -> 'scoring') ? 'sack', 'cs6 non-numeric dropped');
  perform probe_as('c');
  perform assert_true((league_game_mode(lid) -> 'scoring' ->> 'passTd')::numeric = 6, 'cs7 member reads overrides');
  perform probe_as('b');
  perform assert_ok(set_league_classic_scoring(lid, '{}'::jsonb), 'cs8 clear to defaults');
  perform assert_true((league_game_mode(lid) -> 'scoring') = '{}'::jsonb, 'cs9 reads empty after clear');

  -- custom lineup (0161): commish-only, sanitized, capped, member-readable
  perform probe_as('c');
  perform assert_err(set_league_classic_roster(lid, '{"QB": 2}'::jsonb), 'commissioner', 'rc0 member cannot set lineup');
  perform probe_as('b');
  r := set_league_classic_roster(lid, '{"QB": 2, "RB": 1, "BOGUS": 3, "DL": 9, "WR": "junk"}'::jsonb);
  perform assert_ok(r, 'rc1 commish sets lineup');
  perform assert_true(r -> 'roster' = '{"QB": 2, "RB": 1, "DL": 6}'::jsonb, 'rc2 sanitized: bogus dropped, DL clamped to 6, junk dropped (got ' || (r -> 'roster')::text || ')');
  perform assert_true((r ->> 'starters')::int = 9, 'rc2a starter count reported');
  perform assert_err(set_league_classic_roster(lid, '{"QB": 6, "RB": 6, "WR": 6, "TE": 6}'::jsonb), 'cap at 20', 'rc3 over-20 refused');
  perform assert_err(set_league_classic_roster(lid, '{}'::jsonb), 'at least one', 'rc4 empty lineup refused');
  perform probe_as('c');
  perform assert_true((league_game_mode(lid) -> 'roster') = '{"QB": 2, "RB": 1, "DL": 6}'::jsonb, 'rc5 member reads lineup');

  -- the slot cap admits exactly the configured starter count
  perform probe_as('b');
  perform assert_ok(set_league_classic_roster(lid, '{"QB": 1, "RB": 1}'::jsonb), 'rc6 two-starter lineup');
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
  values (lid, 2, 2, 1, 'scheduled') returning id into mid;
  set local role authenticated;
  perform probe_as('c');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
  values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'QB', 'probe-qb'),
         (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'RB', 'probe-rb');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'FLEX', 'probe-x');
    raise exception 'PROBE FAIL rc7 — a third pick beat a two-starter lineup';
  exception when check_violation then null;
  end;

  -- best ball accepts generated names, rejects junk
  perform probe_as('b');
  r := set_league_bestball(lid, '["SFLX", "WR3", "JUNK$", "SFLX"]'::jsonb);
  perform assert_true(r -> 'bestball' = '["SFLX","WR3"]'::jsonb, 'bb12 generated names pass, junk + dupes drop (got ' || (r -> 'bestball')::text || ')');

  -- the widened scoring catalog accepts the new keys
  r := set_league_classic_scoring(lid, '{"teRec": 0.5, "fg20": 3.5, "idpTackle": 1.5, "pass300": 3}'::jsonb);
  perform assert_ok(r, 'cs11 catalog keys accepted');
  perform assert_true((r -> 'scoring' ->> 'teRec')::numeric = 0.5 and (r -> 'scoring' ->> 'pass300')::numeric = 3, 'cs12 values stored');

  -- 0165 Sleeper-parity keys: distance/volume bonuses, position PPR, targets,
  -- the FG 60+ band and the per-FG-yard rates (yard-clamped like the others)
  r := set_league_classic_scoring(lid,
    '{"targetPt": 0.5, "recB40": 1, "rushTd50": 2, "carries20": 1.5, "rr100": 1, "fg60": 6, "fgYd": 0.1, "fgYd30": 9, "idpTackle10": 2, "pass40": 1, "rbRec": 0.5}'::jsonb);
  perform assert_ok(r, 'cs13 parity keys accepted');
  perform assert_true((r -> 'scoring' ->> 'targetPt')::numeric = 0.5 and (r -> 'scoring' ->> 'fg60')::numeric = 6
    and (r -> 'scoring' ->> 'rushTd50')::numeric = 2 and (r -> 'scoring' ->> 'rbRec')::numeric = 0.5, 'cs14 parity values stored');
  perform assert_true((r -> 'scoring' ->> 'fgYd30')::numeric = 1, 'cs15 per-FG-yard rate clamped to 1');
  perform probe_as('c');
  perform assert_true((league_game_mode(lid) -> 'scoring' ->> 'carries20')::numeric = 1.5, 'cs16 member reads parity keys');
  perform probe_as('b');

  -- 0166 truth-flag knobs: first downs (stat + position), efficiency, 2-pt
  r := set_league_classic_scoring(lid,
    '{"passFd": 0.5, "fdRb": 1, "passCmp": 0.2, "passInc": -0.3, "passAtt": 0.1, "cmp25": 2, "qbSacked": -1, "rush2pt": 2.5}'::jsonb);
  perform assert_ok(r, 'cs17 truth-flag keys accepted');
  perform assert_true((r -> 'scoring' ->> 'passFd')::numeric = 0.5 and (r -> 'scoring' ->> 'qbSacked')::numeric = -1
    and (r -> 'scoring' ->> 'rush2pt')::numeric = 2.5 and (r -> 'scoring' ->> 'fdRb')::numeric = 1, 'cs18 truth-flag values stored');

  -- 0167 bracket keys: PA/YA ladders, the negative fine-grained rates, KR/PR split
  r := set_league_classic_scoring(lid,
    '{"pa0": 12, "pa35": -5, "paPt": -0.05, "yaPt": 0.02, "ya100": 5, "dstBlk": 2, "krYd": 0.1, "prYd": 0.25}'::jsonb);
  perform assert_ok(r, 'cs19 bracket keys accepted');
  perform assert_true((r -> 'scoring' ->> 'paPt')::numeric = -0.05 and (r -> 'scoring' ->> 'yaPt')::numeric = 0.02,
    'cs20 rate keys keep sign + 2dp precision');
  perform assert_true((r -> 'scoring' ->> 'pa35')::numeric = -5 and (r -> 'scoring' ->> 'krYd')::numeric = 0.1
    and (r -> 'scoring' ->> 'dstBlk')::numeric = 2, 'cs20a bracket values stored');

  -- 0168 IDP-fidelity keys: solo/assist premiums, TFL, forced fumbles
  r := set_league_classic_scoring(lid,
    '{"idpSolo": 0.5, "idpAst": 0.25, "idpTfl": 1, "idpFf": 2, "dstFf": 1}'::jsonb);
  perform assert_ok(r, 'cs21 idp-fidelity keys accepted');
  perform assert_true((r -> 'scoring' ->> 'idpSolo')::numeric = 0.5 and (r -> 'scoring' ->> 'idpAst')::numeric = 0.3
    and (r -> 'scoring' ->> 'idpTfl')::numeric = 1 and (r -> 'scoring' ->> 'dstFf')::numeric = 1,
    'cs22 idp values stored (event knobs land on the 0.1 grid: 0.25 → 0.3)');

  -- 0169 true-up keys: QB hits + passes defended, IDP and team
  r := set_league_classic_scoring(lid, '{"idpQbHit": 1, "idpPd": 1.5, "dstQbHit": 0.5, "dstPd": 0.5}'::jsonb);
  perform assert_ok(r, 'cs23 true-up keys accepted');
  perform assert_true((r -> 'scoring' ->> 'idpQbHit')::numeric = 1 and (r -> 'scoring' ->> 'dstPd')::numeric = 0.5, 'cs24 true-up values stored');

  -- best ball + classic scoring have no meaning in a drip league
  perform assert_ok(set_league_game_mode(lid, 'drip'), 'bb8 back to drip');
  perform assert_err(set_league_bestball(lid, '["FLEX"]'::jsonb), 'classic-league setting', 'bb9 refused in drip');
  perform assert_err(set_league_classic_scoring(lid, '{"passTd": 6}'::jsonb), 'classic-league setting', 'cs10 scoring refused in drip');
  perform assert_ok(set_league_game_mode(lid, 'classic'), 'bb10 back to classic');

  -- the mode AND best ball freeze once the draft leaves pending
  reset role;
  update draft set status = 'live' where league_id = lid;
  set local role authenticated;
  perform probe_as('b');
  perform assert_err(set_league_game_mode(lid, 'drip'), 'locks once the draft starts', 'gm13 frozen after draft start');
  perform assert_err(set_league_bestball(lid, '[]'::jsonb), 'locks once the draft starts', 'bb11 best ball frozen after draft start');
  perform assert_err(set_league_classic_roster(lid, '{"QB": 1}'::jsonb), 'locks once the draft starts', 'rc8 lineup frozen after draft start');
  reset role;
end $$;

select 'ALL GAME-MODE PROBES PASSED' as result;
