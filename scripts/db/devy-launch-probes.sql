-- 0407 probes: NEW PLAYERS LAUNCH INTO THE DEVY MARKET FAIRLY.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

create or replace function dl_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function dl_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function dl_err(r jsonb, frag text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or position(frag in coalesce(r ->> 'error', '')) = 0 then
  raise exception 'PROBE FAIL % — expected error like "%", got %', msg, frag, r; end if; end $$;
create or replace function dl_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000058' || u, false); perform set_config('app.email', 'dl' || u || '@test.dev', false); end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000005801', 'dl01@test.dev'), ('00000000-0000-0000-0000-000000005802', 'dl02@test.dev'),
  ('00000000-0000-0000-0000-000000005803', 'dl03@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000005801', 'dl01@test.dev'), ('00000000-0000-0000-0000-000000005802', 'dl02@test.dev'),
  ('00000000-0000-0000-0000-000000005803', 'dl03@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id::text like '00000000-0000-0000-0000-0000000058%';

do $$
declare r jsonb; lid uuid; l2 uuid; code text; yr text := extract(year from (now() at time zone 'America/New_York'))::int::text;
        lin text; launch bigint; st jsonb; rid int; won int;
begin
  -- a league with its market open
  perform dl_as('01');
  r := create_native_league('Devy Launch', yr, 3, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic', 'keeper', 2);
  lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code'; lin := _lineage(lid);
  perform dl_ok(commish_setup_devy(lid, 'shares'), 'dl0 a devy market league');
  perform dl_as('02'); perform native_join(code, 'DL-2');
  perform dl_as('03'); perform native_join(code, 'DL-3');
  perform dl_as('01');
  update draft set status = 'complete', completed_at = now() where league_id = lid;

  -- one established player, three that arrive after the league exists
  perform set_config('app.uid', '', false);
  perform upsert_college_players(jsonb_build_array(
    jsonb_build_object('espn_id', '98001', 'full_name', 'Old Hand', 'pos', 'WR', 'school_abbr', 'DLU', 'class_year', 3),
    jsonb_build_object('espn_id', '98002', 'full_name', 'Star Frosh', 'pos', 'QB', 'school_abbr', 'DLU', 'class_year', 1),
    jsonb_build_object('espn_id', '98003', 'full_name', 'Quiet Frosh', 'pos', 'RB', 'school_abbr', 'DLU', 'class_year', 1),
    jsonb_build_object('espn_id', '98004', 'full_name', 'Lineman Frosh', 'pos', 'DL', 'school_abbr', 'DLU', 'class_year', 1)));
  update college_player set first_seen = timestamptz '2026-01-01' where espn_id = '98001';
  update college_player set first_seen = now() + interval '1 minute' where espn_id in ('98002', '98003', '98004');
  insert into stathead_devy (espn_id, name, pos, rank_1qb, as_of) values ('98002', 'Star Frosh', 'QB', 5, now())
    on conflict (espn_id) do update set rank_1qb = 5;
  delete from college_price where espn_id like '9800%';

  -- ══ dl1. A NEW PLAYER LISTS; HE ISN'T BOUGHT ══
  perform dl_as('01');
  perform dl_true(_devy_listing(lin, 'c-98002') = 'pending' and _devy_listing(lin, 'c-98001') is null, 'dl1 new players list; an established one doesn''t');
  perform dl_true(_devy_listing(lin, 'c-98004') is null, 'dl1a only QB/RB/WR/TE list');
  perform dl_err(allot_devy_shares(lid, 1, 'c-98002', 5), 'new listing', 'dl1b a listing can''t be bought');
  perform dl_ok(allot_devy_shares(lid, 1, 'c-98001', 20), 'dl1c an established player can (team 1 has 80 left)');
  st := devy_launch_state(lid, 1);
  perform dl_true((st ->> 'pending_count')::int = 2 and st -> 'open' = 'null'::jsonb, 'dl1d two waiting, nothing open: ' || st::text);

  -- ══ dl2. LAUNCH NOW (the commissioner) ══
  perform dl_as('02');
  perform dl_err(commish_devy_launch_now(lid), 'commissioner only', 'dl2 a member can''t');
  perform dl_as('01');
  r := commish_devy_launch_now(lid);
  perform dl_ok(r, 'dl2a the commissioner opens a launch'); launch := (r ->> 'launch')::bigint;
  perform dl_true((select open_price from devy_launch_player where launch_id = launch and slug = 'c-98002') = 9.01
              and (select open_price from devy_launch_player where launch_id = launch and slug = 'c-98003') = 1,
    'dl2b opening prices: StatHead #20 on the curve is 8, a freshman ×0.85 = 9.01 (0413); unranked is the floor');
  perform dl_true(_devy_price(null, 'c-98002') = 9.01, 'dl2c and that is his market price from now');
  perform dl_true(exists (select 1 from league_message where league_id = lid and txn ->> 'kind' = 'devy_launch'), 'dl2d the league hears about it');
  perform dl_err(commish_devy_launch_now(lid), 'already open', 'dl2e one launch at a time');
  perform dl_err(allot_devy_shares(lid, 1, 'c-98002', 5), 'launch', 'dl2f still no buying — an order');

  -- ══ dl3. SEALED ORDERS ══
  perform dl_err(place_devy_launch_order(lid, 1, 'c-98002', 8), '0 to 7', 'dl3 at 9.01 a share, 7 shares maxes him (60 points)');
  perform dl_ok(place_devy_launch_order(lid, 1, 'c-98002', 7), 'dl3a team 1 orders a full stake');
  perform dl_err(place_devy_launch_order(lid, 1, 'c-98001', 5), 'isn''t in an open launch', 'dl3b only launch players take orders');
  perform dl_err(place_devy_launch_order(lid, 2, 'c-98002', 8), 'not your team', 'dl3c nobody orders for another team');
  perform dl_err(place_devy_launch_order(lid, 1, 'c-98003', 20), 'come to', 'dl3d orders can''t pass your cash (63.07 + 20 > 80)');
  perform dl_as('02'); perform dl_ok(place_devy_launch_order(lid, 2, 'c-98002', 7), 'dl3e team 2 orders a full stake too');
  perform dl_ok(place_devy_launch_order(lid, 2, 'c-98003', 3), 'dl3f and a small one on the quiet frosh');
  perform dl_ok(place_devy_launch_order(lid, 2, 'c-98003', 0), 'dl3g 0 cancels it');
  perform dl_ok(place_devy_launch_order(lid, 2, 'c-98003', 6), 'dl3h and re-orders');
  perform dl_as('03'); perform dl_ok(place_devy_launch_order(lid, 3, 'c-98002', 7), 'dl3i team 3 as well');
  st := devy_launch_state(lid, 3);
  perform dl_true((select (p ->> 'my_order')::int from jsonb_array_elements(st -> 'open' -> 'players') p where p ->> 'slug' = 'c-98003') is null
              and (select (p ->> 'my_order')::int from jsonb_array_elements(st -> 'open' -> 'players') p where p ->> 'slug' = 'c-98002') = 7,
    'dl3j SEALED: team 3 sees its own order and nobody else''s');

  -- ══ dl4. THE FILL — a draw among the maxers ══
  perform set_config('app.uid', '', false);
  update devy_launch set closes_at = now() - interval '1 second' where id = launch;
  r := devy_launch_tick();
  perform dl_true((r ->> 'filled')::int >= 1 and (select status from devy_launch where id = launch) = 'filled', 'dl4 the tick fills a launch at its close');
  perform dl_true((select count(*) from devy_share where lineage = lin and slug = 'c-98002' and maxed_at is not null) = 3,
    'dl4a all three full orders filled and maxed');
  perform dl_true((select count(distinct maxed_at) from devy_share where lineage = lin and slug = 'c-98002') = 3, 'dl4b one at a time, in the draw''s order');
  select r2.roster_id into won from devy_share_rights(lin) r2 where r2.slug = 'c-98002';
  perform dl_true(won = (select roster_id from devy_launch_order where launch_id = launch and slug = 'c-98002' order by draw limit 1),
    'dl4c the right goes to the first maxer in the draw');
  perform dl_true((select filled from devy_launch_order where launch_id = launch and slug = 'c-98003' and roster_id = 2) = 6
              and _devy_cash(lin, 2) = 100 - 63.07 - 6, 'dl4d smaller orders fill too, cash comes off');
  perform dl_true(exists (select 1 from league_message where league_id = lid and txn ->> 'kind' = 'devy_launch_filled' and body like '%won the draw of 3%'),
    'dl4e the chat names the winner of the draw');
  perform dl_true(_devy_listing(lin, 'c-98002') is null, 'dl4f launched: an ordinary market player now');

  -- ══ dl5. THE COMMISSIONER'S SETTINGS ══
  perform dl_as('02');
  perform dl_err(set_league_devy_launch(lid, '{"cap": 5}'::jsonb), 'commissioner only', 'dl5 a member can''t');
  perform dl_as('01');
  perform dl_err(set_league_devy_launch(lid, '{"window_h": 2}'::jsonb), '12 hours', 'dl5a a window too short');
  perform dl_err(set_league_devy_launch(lid, '{"dow": 9}'::jsonb), 'day 0', 'dl5b a day that isn''t one');
  perform dl_err(set_league_devy_launch(lid, '{"speed": 1}'::jsonb), 'unknown', 'dl5c an unknown setting');
  perform dl_ok(set_league_devy_launch(lid, '{"cap": 5, "dow": 4, "hour": 18, "window_h": 48, "catchup_h": 240}'::jsonb), 'dl5d every number is the commissioner''s');
  perform dl_true((_devy_launch_cfg(lid) ->> 'cap')::int = 5 and (_devy_launch_cfg(lid) ->> 'dow')::int = 4, 'dl5e stored');

  -- ══ dl6. OFF: new players are buyable at once; back ON counts from then ══
  perform dl_ok(set_league_devy_launch(lid, '{"on": false}'::jsonb), 'dl6 launches off');
  perform set_config('app.uid', '', false);
  perform upsert_college_players(jsonb_build_array(jsonb_build_object('espn_id', '98005', 'full_name', 'Late Frosh', 'pos', 'WR', 'school_abbr', 'DLU', 'class_year', 1)));
  update college_player set first_seen = now() + interval '1 minute' where espn_id = '98005';
  perform dl_as('01');
  perform dl_true(_devy_listing(lin, 'c-98005') is null, 'dl6a off: no listing');
  perform dl_ok(set_league_devy_launch(lid, '{"on": true}'::jsonb), 'dl6b back on');
  perform dl_true((_devy_launch_cfg(lid) ->> 'since')::timestamptz = now(), 'dl6c counting from now');
  update college_player set first_seen = now() - interval '1 minute' where espn_id = '98005';
  perform dl_true(_devy_listing(lin, 'c-98005') is null, 'dl6d a player who arrived while it was off is no listing');

  -- ══ dl7. CATCH-UP: listings wait out the lock, then open together ══
  update college_player set first_seen = now() + interval '1 minute' where espn_id = '98005';
  insert into devy_launch_lock (lineage, was_locked) values (lin, true) on conflict (lineage) do update set was_locked = true;
  perform set_config('app.uid', '', false);
  r := devy_launch_tick();
  perform dl_true((select kind from devy_launch where lineage = lin and status = 'open') = 'catchup', 'dl7 after a lock the tick opens a CATCH-UP');
  perform dl_true((select closes_at - opens_at from devy_launch where lineage = lin and status = 'open') = interval '240 hours', 'dl7a for the catch-up window');
  perform dl_true(not (select was_locked from devy_launch_lock where lineage = lin), 'dl7b once');
  perform dl_as('01');
  perform dl_err(place_devy_launch_order(lid, 1, 'c-98005', 6), '0 to 5', 'dl7c the commissioner''s cap holds');
  delete from devy_launch where lineage = lin and status = 'open';

  -- a market that hasn't opened yet waits too
  r := create_native_league('Devy Launch Two', yr, 2, 15, 60, 'snake', 200, 15, 1, null, null, null, 'classic', 'keeper', 2);
  l2 := (r ->> 'league_id')::uuid;
  perform dl_ok(commish_setup_devy(l2, 'shares'), 'dl7d a second market, not yet drafted');
  perform set_config('app.uid', '', false);
  update college_player set first_seen = now() + interval '1 minute' where espn_id = '98003';
  r := devy_launch_tick();
  perform dl_true((select was_locked from devy_launch_lock where lineage = _lineage(l2)) and not exists (select 1 from devy_launch where lineage = _lineage(l2)),
    'dl7e a locked market opens nothing and remembers to catch up');

  -- ══ dl8. THE WEEKLY SLOT ══
  perform dl_true(_devy_launch_slot('{"dow": 2, "hour": 12}'::jsonb, timestamptz '2026-10-01 15:00+00') = timestamptz '2026-09-29 16:00+00',
    'dl8 Thursday: the slot was Tuesday noon ET');
  perform dl_true(_devy_launch_slot('{"dow": 2, "hour": 12}'::jsonb, timestamptz '2026-09-29 15:59+00') = timestamptz '2026-09-22 16:00+00',
    'dl8a a minute before: last week''s');
  perform dl_true(_devy_launch_slot('{"dow": 2, "hour": 12}'::jsonb, timestamptz '2026-12-01 17:00+00') = timestamptz '2026-12-01 17:00+00',
    'dl8b in winter it''s noon EST');
  -- no launch since this week's slot, listings waiting: the tick opens the weekly
  delete from devy_launch where lineage = lin;
  update college_player set first_seen = now() + interval '1 minute' where espn_id = '98005';
  r := devy_launch_tick();
  perform dl_true((select kind from devy_launch where lineage = lin and status = 'open') = 'weekly', 'dl8c the tick opens the weekly launch');
  perform dl_true((select closes_at - opens_at from devy_launch where lineage = lin and status = 'open') = interval '48 hours', 'dl8d for the commissioner''s window');
  r := devy_launch_tick();
  perform dl_true((select count(*) from devy_launch where lineage = lin) = 1, 'dl8e and only once a week');

  -- tidy
  delete from devy_launch where lineage in (lin, _lineage(l2));
  delete from devy_launch_lock where lineage in (lin, _lineage(l2));
  delete from devy_share where lineage in (lin, _lineage(l2));
  delete from league where id in (lid, l2);
  delete from stathead_devy where espn_id like '9800%';
  delete from college_price where espn_id like '9800%';
  delete from college_player where espn_id like '9800%';
end $$;

select 'ALL DEVY-LAUNCH PROBES PASSED' as result;
