-- 0531 injury-swap probes. Run with ON_ERROR_STOP; every failed assertion
-- raises. Driven by scripts/db/run-scratch-probes.sh.
--
-- What this pins down: the free INJURY SWAP exists only in the locked hour,
-- only for a starter the report rules out (O / IR), only like for like (same
-- position, his team in this window, on the roster, not already fielded, not
-- IR/taxi), once per spot, with the metric kept — and the Player Swap card is
-- back to after kickoff.
\set QUIET on
\pset pager off
grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

create or replace function isw_err(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected error, got ok: %', msg, r; end if;
  if position(needle in coalesce(r ->> 'error', '')) = 0 then raise exception 'PROBE FAIL % — expected "%", got %', msg, needle, r; end if;
end $$;
create or replace function isw_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000015a01', 'is1@test.dev'), ('00000000-0000-0000-0000-000000015a02', 'is2@test.dev') on conflict do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000015a01', 'is1@test.dev'), ('00000000-0000-0000-0000-000000015a02', 'is2@test.dev') on conflict do nothing;

do $$
declare lid uuid := '00000000-0000-0000-0000-000000015b01'; mid uuid := '00000000-0000-0000-0000-000000015c01';
        u1 uuid := '00000000-0000-0000-0000-000000015a01'; wk int := 77; r jsonb; n int;
begin
  perform set_config('app.uid', '', false);
  insert into league (id, sleeper_league_id, season, name) values (lid, 'isw-probe', '2026', 'Injury Swap Probe');
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled) values (lid, 1, u1, true), (lid, 2, '00000000-0000-0000-0000-000000015a02', true);
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status) values (mid, lid, wk, 1, 2, 'live');
  insert into sleeper_lineup (league_id, week, roster_id, starters_json) values (lid, wk, 1, '[
    {"slot":"s1","player_slug":"isw-hurt-rb","pos":"RB","grp":"start"},
    {"slot":"s2","player_slug":"isw-bench-rb","pos":"RB","grp":"bench"},
    {"slot":"s3","player_slug":"isw-qb","pos":"QB","grp":"start"},
    {"slot":"s4","player_slug":"isw-bench-wr","pos":"WR","grp":"bench"},
    {"slot":"s5","player_slug":"isw-late-rb","pos":"RB","grp":"bench"},
    {"slot":"s6","player_slug":"isw-ir-rb","pos":"RB","grp":"ir"},
    {"slot":"s7","player_slug":"isw-ghost-rb","pos":"RB","grp":"bench"}]'::jsonb);
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'isw-hurt-rb', 'Hurt Back', 'RB', 'ZQA', 1), (lid, 'isw-bench-rb', 'Bench Back', 'RB', 'ZQB', 2),
    (lid, 'isw-qb', 'A Passer', 'QB', 'ZQA', 3), (lid, 'isw-bench-wr', 'Bench Wideout', 'WR', 'ZQB', 4),
    (lid, 'isw-late-rb', 'Late Back', 'RB', 'ZQC', 5), (lid, 'isw-ir-rb', 'Shelved Back', 'RB', 'ZQB', 6);
  -- 'isw-ghost-rb' is on the roster and nowhere a team can be read from.
  insert into nfl_slate (season, week, home, away, win, kickoff) values
    ('2026', wk, 'ZQA', 'ZQB', 'early', now() + interval '2 hours'), ('2026', wk, 'ZQC', 'ZQD', 'late', now() + interval '6 hours');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked) values
    (mid, u1, 'early', '0', 'isw-hurt-rb', 'rush', true), (mid, u1, 'early', '1', 'isw-qb', 'pass', true);
  insert into injury_status (player_slug, status) values ('isw-hurt-rb', 'Q') on conflict (player_slug) do update set status = excluded.status;

  perform set_config('app.uid', u1::text, false);
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-bench-rb'), 'window not locked', 'i1 before the lock the lineup is still yours to edit');
  update nfl_slate set kickoff = now() + interval '40 minutes' where season = '2026' and week = wk and win = 'early';
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-bench-rb'), 'not ruled out', 'i2 Questionable is not out');
  perform isw_err(injury_swap(mid, 'early', '1', 'isw-bench-rb'), 'not ruled out', 'i3 a healthy starter cannot be swapped');
  update injury_status set status = 'O' where player_slug = 'isw-hurt-rb';
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-nobody'), 'not your player', 'i4 only a man on your roster');
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-qb'), 'already in your lineup', 'i5 not a man already fielded');
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-bench-wr'), 'different position', 'i6 like for like');
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-late-rb'), 'not in this window', 'i7 his team must play in this window');
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-ghost-rb'), 'not in this window', 'i8 a man nobody can place is refused');
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-ir-rb'), 'ir or taxi', 'i9 not off IR');
  perform isw_err(injury_swap(mid, 'early', '5', 'isw-bench-rb'), 'no pick at slot', 'i10 an empty spot has nobody to swap out');
  r := injury_swap(mid, 'early', '0', 'isw-bench-rb');
  perform isw_true((r ->> 'ok')::boolean, 'i11 the injury swap lands in the locked hour — ' || r::text);
  perform isw_true((select player_slug = 'isw-bench-rb' and metric_id = 'rush' and locked from sealed_pick where matchup_id = mid and app_user_id = u1 and game_window = 'early' and roster_slot = '0'),
    'i12 the pick is the new man, the metric kept, still locked');
  select count(*) into n from injury_swap_log where matchup_id = mid and app_user_id = u1 and out_slug = 'isw-hurt-rb' and in_slug = 'isw-bench-rb' and out_status = 'O';
  perform isw_true(n = 1, 'i13 the swap is on the log');
  insert into injury_status (player_slug, status) values ('isw-bench-rb', 'IR') on conflict (player_slug) do update set status = excluded.status;
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-hurt-rb'), 'already swapped', 'i14 once per spot');
  -- The lock still holds for everything else: the seat cannot edit the pick by hand.
  begin
    set local role authenticated;
    update sealed_pick set player_slug = 'isw-hurt-rb' where matchup_id = mid and app_user_id = u1 and game_window = 'early' and roster_slot = '0';
    reset role;
    perform isw_true((select player_slug = 'isw-bench-rb' from sealed_pick where matchup_id = mid and app_user_id = u1 and game_window = 'early' and roster_slot = '0'), 'i15 a hand edit of the locked pick does not land');
  exception when others then reset role;   -- refused outright: also a pass
  end;
  insert into coin_ledger (league_id, roster_id, week, delta, reason, idem_key) values (lid, 1, wk, 0, 'spend:player-swap', 'isw-probe-card');
  perform isw_err(apply_targeted(mid, 'player-swap', jsonb_build_object('win', 'early', 'slot', '1', 'toPlayer', 'isw-bench-wr')), 'window not live', 'i16 the Player Swap card waits for kickoff again');
  -- The other seat cannot swap this seat's spot.
  perform set_config('app.uid', '00000000-0000-0000-0000-000000015a02', false);
  perform isw_err(injury_swap(mid, 'early', '1', 'isw-bench-wr'), 'no pick at slot', 'i17 a seat swaps only its own picks');
  perform set_config('app.uid', u1::text, false);
  delete from injury_swap_log where matchup_id = mid;
  update nfl_slate set kickoff = now() - interval '5 minutes' where season = '2026' and week = wk and win = 'early';
  update injury_status set status = 'O' where player_slug = 'isw-bench-rb';
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-hurt-rb'), 'window kicked off', 'i18 from kickoff it is closed');
  update matchup set status = 'final' where id = mid;
  perform isw_err(injury_swap(mid, 'early', '0', 'isw-hurt-rb'), 'matchup final', 'i19 a final matchup takes no swap');

  perform set_config('app.uid', '', false);
  delete from nfl_slate where season = '2026' and week = wk;
  delete from injury_status where player_slug like 'isw-%';
  delete from league where id = lid;
end $$;
select 'ALL INJURY-SWAP PROBES PASS';
