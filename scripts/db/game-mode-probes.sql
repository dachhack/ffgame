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
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev')
on conflict (id) do nothing;

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

  -- the mode freezes once the draft leaves pending
  reset role;
  update draft set status = 'live' where league_id = lid;
  set local role authenticated;
  perform probe_as('b');
  perform assert_err(set_league_game_mode(lid, 'drip'), 'locks once the draft starts', 'gm13 frozen after draft start');
  reset role;
end $$;

select 'ALL GAME-MODE PROBES PASSED' as result;
