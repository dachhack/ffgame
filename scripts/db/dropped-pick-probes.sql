-- 0278 dropped-pick probes: a dropped player leaves the lineup while it is open.
--
-- What must hold:
--   • native: drop_player on a picked player clears the still-open pick;
--     a pick on a player who has already kicked off (classic per-player lock)
--     stays; a row the server sealed (locked) stays; a trade away clears the
--     giver's pick; the drop itself never fails because of a pick;
--   • external: a synced roster that no longer carries the player clears the
--     open pick; an EMPTY synced roster clears nothing;
--   • someone else's pick on the same slug in the same league is untouched.
\set QUIET on
\pset pager off

create or replace function dp_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
create or replace function dp_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;
create or replace function probe_as_server() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev')
on conflict (id) do nothing;

do $$
declare lid uuid; code text; mid uuid; b uuid := '00000000-0000-0000-0000-00000000000b';
        c uuid := '00000000-0000-0000-0000-00000000000c'; seat_b int; seat_c int; r jsonb; n int;
begin
  insert into app_user (id, email) values (b, 'b@test.dev'), (c, 'c@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in (b, c);
  perform probe_as('b');
  lid := (create_native_league('Dropped Picks', '2026', 4, 7, 60, 'snake', 200, 15, 1,
                               null, null, null, 'classic') ->> 'league_id')::uuid;
  code := (select invite_code from league where id = lid);
  perform probe_as('c'); perform dp_ok(native_join(code, 'DP-C'), 'dp0 c joins');
  select sleeper_roster_id into seat_b from league_membership where league_id = lid and app_user_id = b;
  select sleeper_roster_id into seat_c from league_membership where league_id = lid and app_user_id = c;

  reset role;
  -- The slate (a week the real calendar never covers): BUF kicked off two
  -- hours ago, PHI/DAL play in three days.
  insert into nfl_slate (season, week, win, home, away, kickoff) values
    ('2026', 91, 'thu', 'NYJ', 'BUF', now() - interval '2 hours'),
    ('2026', 91, 'sun_early', 'PHI', 'DAL', now() + interval '3 days')
  on conflict do nothing;
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'dp-thu',   'Thursday Man', 'RB', 'BUF', 1),
    (lid, 'dp-sun',   'Sunday Man',   'RB', 'PHI', 2),
    (lid, 'dp-sun2',  'Other Sunday', 'WR', 'DAL', 3),
    (lid, 'dp-sun3',  'Third Sunday', 'WR', 'PHI', 4),
    (lid, 'dp-sun4',  'Fourth Sunday','WR', 'DAL', 5),
    (lid, 'dp-c-sun', 'C Sunday',     'RB', 'PHI', 6)
  on conflict do nothing;
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, seat_b, 'dp-thu', 'draft'), (lid, seat_b, 'dp-sun', 'draft'), (lid, seat_b, 'dp-sun2', 'draft'),
    (lid, seat_b, 'dp-sun3', 'draft'), (lid, seat_b, 'dp-sun4', 'draft'), (lid, seat_c, 'dp-c-sun', 'draft');
  update draft set status = 'complete' where league_id = lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 91, seat_b, seat_c, 'scheduled') returning id into mid;
  perform set_config('probe.dp_lid', lid::text, false);
  perform set_config('probe.dp_mid', mid::text, false);
  perform set_config('probe.dp_seat_b', seat_b::text, false);
  perform set_config('probe.dp_seat_c', seat_c::text, false);

  -- b's lineup: S1 Sunday Man (open), S2 Thursday Man (already kicked off —
  -- staged by the server, a manager could not write it now), S3 Other Sunday
  -- (open, will be traded away), S4 Third Sunday sealed by the server (locked),
  -- S5 Fourth Sunday (open, for the external-sync case). c's lineup: S1 on
  -- his own Sunday man, and — to prove scoping — nothing on b's players.
  set local role authenticated;
  perform probe_as('b');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values
    (mid, b, 'wk', 'S1', 'dp-sun'), (mid, b, 'wk', 'S3', 'dp-sun2'), (mid, b, 'wk', 'S4', 'dp-sun3'), (mid, b, 'wk', 'S5', 'dp-sun4');
  perform probe_as('c');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values (mid, c, 'wk', 'S1', 'dp-c-sun');
  reset role;
  perform probe_as_server();
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values (mid, b, 'wk', 'S2', 'dp-thu');
  update sealed_pick set locked = true where matchup_id = mid and app_user_id = b and roster_slot = 'S4';
  select count(*) into n from sealed_pick where matchup_id = mid;
  perform dp_true(n = 6, 'dp1 six picks staged');
end $$;

-- ── 1. native: drop clears the open pick, keeps the kicked-off and the sealed ──
do $$
declare lid uuid := current_setting('probe.dp_lid')::uuid; mid uuid := current_setting('probe.dp_mid')::uuid;
        seat_b int := current_setting('probe.dp_seat_b')::int; seat_c int := current_setting('probe.dp_seat_c')::int;
        b uuid := '00000000-0000-0000-0000-00000000000b'; r jsonb;
begin
  set local role authenticated;
  perform probe_as('b');
  perform dp_ok(drop_player(lid, seat_b, 'dp-sun'), 'dp2 b drops Sunday Man');
  perform dp_true(not exists (select 1 from sealed_pick where matchup_id = mid and app_user_id = b and roster_slot = 'S1'),
    'dp3 the open pick on him is gone');
  perform dp_ok(drop_player(lid, seat_b, 'dp-thu'), 'dp4 b drops Thursday Man (already kicked off) — the drop itself goes through');
  perform dp_true(exists (select 1 from sealed_pick where matchup_id = mid and app_user_id = b and roster_slot = 'S2' and player_slug = 'dp-thu'),
    'dp5 the pick on a player who has kicked off stays — that spot is locked');
  perform dp_ok(drop_player(lid, seat_b, 'dp-sun3'), 'dp6 b drops Third Sunday (sealed by the server)');
  perform dp_true(exists (select 1 from sealed_pick where matchup_id = mid and app_user_id = b and roster_slot = 'S4' and locked),
    'dp7 a sealed pick stays');
  perform dp_true(exists (select 1 from sealed_pick where matchup_id = mid and roster_slot = 'S1' and player_slug = 'dp-c-sun'),
    'dp8 c''s own pick was never touched');
  -- a trade away is an UPDATE of roster_id, not a delete
  reset role;
  update native_roster set roster_id = seat_c, acquired = 'trade' where league_id = lid and slug = 'dp-sun2';
  perform dp_true(not exists (select 1 from sealed_pick where matchup_id = mid and app_user_id = b and roster_slot = 'S3'),
    'dp9 a player traded away leaves the giver''s lineup');
  perform dp_true((select count(*) from sealed_pick where matchup_id = mid and app_user_id = b) = 3,
    'dp10 b keeps exactly the kicked-off, the sealed, and the untouched S5');
end $$;

-- ── 2. native: a materialized (sleeper_lineup) copy never speaks for the roster ──
do $$
declare lid uuid := current_setting('probe.dp_lid')::uuid; mid uuid := current_setting('probe.dp_mid')::uuid;
        seat_b int := current_setting('probe.dp_seat_b')::int;
        b uuid := '00000000-0000-0000-0000-00000000000b';
begin
  insert into sleeper_lineup (league_id, week, roster_id, starters_json) values (lid, 91, seat_b, '[{"player_slug":"stale"}]'::jsonb)
    on conflict (league_id, week, roster_id) do update set starters_json = excluded.starters_json;
  perform dp_true(exists (select 1 from sealed_pick where matchup_id = mid and app_user_id = b and roster_slot = 'S5'),
    'dp11 a native league''s materialized copy clears nothing — native_roster is the roster');
end $$;

-- ── 3. external: the synced roster decides ──────────────────────────────────
do $$
declare lid uuid; mid uuid; b uuid := '00000000-0000-0000-0000-00000000000b';
begin
  -- a Sleeper-mirrored league: provider is not 'native'; the worker's sync
  -- writes sleeper_lineup and the manager's pool is exactly that row.
  insert into league (sleeper_league_id, season, name, settings_json) values ('dp-external-1', '2026', 'External DP', '{}'::jsonb)
    returning id into lid;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name) values (lid, 1, b, true, 'DP-EXT-B');
  insert into league_membership (league_id, sleeper_roster_id, enrolled, team_name) values (lid, 2, false, 'DP-EXT-2');
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (lid, 91, 1, 2, 'scheduled') returning id into mid;
  insert into sleeper_lineup (league_id, week, roster_id, starters_json) values
    (lid, 91, 1, '[{"player_slug":"ext-a"},{"player_slug":"ext-b"},{"player_slug":"ext-c"}]'::jsonb);
  perform probe_as_server();
  -- windowed picks (sun_early kicks off in three days, so open); one sealed by the server
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug) values
    (mid, b, 'sun_early', 'S1', 'ext-a'), (mid, b, 'sun_early', 'S2', 'ext-b'), (mid, b, 'sun_early', 'S3', 'ext-c');
  update sealed_pick set locked = true where matchup_id = mid and roster_slot = 'S3';

  -- a sync that came back EMPTY is a failed fetch, not a dozen drops
  update sleeper_lineup set starters_json = '[]'::jsonb where league_id = lid and week = 91 and roster_id = 1;
  perform dp_true((select count(*) from sealed_pick where matchup_id = mid) = 3, 'dp12 an empty synced roster clears nothing');
  -- ext-b was dropped on Sleeper: the next sync no longer carries him
  update sleeper_lineup set starters_json = '[{"player_slug":"ext-a"},{"player_slug":"ext-d"}]'::jsonb
    where league_id = lid and week = 91 and roster_id = 1;
  perform dp_true(not exists (select 1 from sealed_pick where matchup_id = mid and roster_slot = 'S2'),
    'dp13 a player missing from the synced roster leaves the open spot');
  perform dp_true(exists (select 1 from sealed_pick where matchup_id = mid and roster_slot = 'S1' and player_slug = 'ext-a'),
    'dp14 the player still rostered keeps his spot');
  perform dp_true(exists (select 1 from sealed_pick where matchup_id = mid and roster_slot = 'S3' and locked),
    'dp15 a sealed pick survives even though the synced roster dropped him (ext-c)');
  -- the same roster synced again (the hourly rewrite) changes nothing
  update sleeper_lineup set starters_json = '[{"player_slug":"ext-a"},{"player_slug":"ext-d"}]'::jsonb
    where league_id = lid and week = 91 and roster_id = 1;
  perform dp_true((select count(*) from sealed_pick where matchup_id = mid) = 2, 'dp16 a re-sync of the same roster is a no-op');
  raise notice 'dropped-pick probes done';
end $$;

select 'ALL DROPPED-PICK PROBES PASSED' as status;
