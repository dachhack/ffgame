-- 0178 probes — CLASSIC PLAYS WITH THE LINEUPS OPEN.
--
-- This suite exists because 0178 edits THE security boundary. supabase/README
-- calls sealed_pick's policy "the one property that must never regress", and
-- the whole hidden-pick game rests on it, so every assertion below is written
-- as a pair: the classic league may, the drip league may NOT.
--
-- What must hold:
--   • VISIBILITY — in a classic league any LEAGUE MEMBER reads any team's
--     weekly picks, sealed or not (including a member who isn't in that
--     matchup); a non-member still reads nothing; and in a DRIP league an
--     opponent still cannot read an unlocked pick.
--   • LATE SWAP — a classic pick may be changed until THAT PLAYER's game
--     kicks off; after it, the swap is refused, the outgoing player is
--     protected too (you can't pull a man who has already played), and the
--     DELETE path is refused for the same reason. A player whose game is
--     later that week stays editable — the point of the whole feature.
--   • A BYE player and an unknown slug are NOT locked by the trigger (there is
--     no kickoff to be late for); the worker's own sweep is what seals them.
--   • DRIP is untouched: its window rule still fires exactly as before.
\set QUIET on
\pset pager off

create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin
  if coalesce((r ->> 'ok')::boolean, false) is not true then
    raise exception 'PROBE FAIL % — got %', msg, r;
  end if;
end $$;
-- The SERVER: no auth uid at all, which is how the worker writes (service role
-- bypasses RLS and the trigger's first line). Probes need it to stage a state
-- only the worker could have produced — a kicked-off player already seated.
create or replace function probe_as_server() returns void language plpgsql as $$
begin
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.dev'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.dev'),
  ('00000000-0000-0000-0000-00000000000e', 'e@test.dev')
on conflict (id) do nothing;
insert into app_admin (email, note) values ('a@test.dev', 'probe admin') on conflict (email) do nothing;

do $$
declare
  lid uuid; code text; mid uuid; drip_lid uuid; drip_code text; drip_mid uuid;
  seen int;
begin
  -- ── A classic league: b (commish) vs c, with d also a member and e outside ──
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb
    where id = '00000000-0000-0000-0000-00000000000b';
  perform probe_as('b');
  lid := (create_native_league('Open Lineups', '2026', 4, 7, 60, 'snake', 200, 15, 1,
                               null, null, null, 'classic') ->> 'league_id')::uuid;
  code := (select invite_code from league where id = lid);
  perform probe_as('c'); perform assert_ok(native_join(code, 'OL-C'), 'ol0 c joins');
  perform probe_as('d'); perform assert_ok(native_join(code, 'OL-D'), 'ol0a d joins');

  -- The slate: BUF kick off Thursday (already gone), PHI on Sunday (still to come).
  reset role;
  insert into nfl_slate (season, week, win, home, away, kickoff) values
    ('2026', 1, 'thu', 'NYJ', 'BUF', now() - interval '2 hours'),
    ('2026', 1, 'sun_early', 'PHI', 'DAL', now() + interval '3 days')
  on conflict do nothing;
  -- The league's pool places each player on a team — the join the trigger uses.
  insert into league_pool (league_id, slug, full_name, pos, team, rank) values
    (lid, 'thursday-man', 'Thursday Man', 'RB', 'BUF', 1),
    (lid, 'sunday-man',   'Sunday Man',   'RB', 'PHI', 2),
    (lid, 'other-sunday', 'Other Sunday', 'WR', 'DAL', 3),
    (lid, 'bye-man',      'Bye Man',      'WR', 'ZZZ', 4)
  on conflict do nothing;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (lid, 1, 1, 2, 'scheduled') returning id into mid;
  set local role authenticated;

  -- ── VISIBILITY ────────────────────────────────────────────────────────────
  perform probe_as('c');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S1', 'sunday-man');
  perform assert_true((select count(*) from sealed_pick where matchup_id = mid) = 1, 'ol1 c reads their own');

  -- The opponent reads it UNSEALED — the thing 0178 changes.
  perform probe_as('b');
  perform assert_true((select count(*) from sealed_pick where matchup_id = mid and player_slug = 'sunday-man') = 1,
    'ol2 the opponent reads an UNLOCKED classic pick');
  -- …and so does a league member who is not even in this matchup.
  perform probe_as('d');
  perform assert_true((select count(*) from sealed_pick where matchup_id = mid and player_slug = 'sunday-man') = 1,
    'ol3 any league member reads it, not just the opponent');
  -- A non-member still reads nothing. "Open" means open to the LEAGUE.
  perform probe_as('e');
  perform assert_true((select count(*) from sealed_pick where matchup_id = mid) = 0,
    'ol4 a non-member still reads nothing');

  -- ── LATE SWAP ─────────────────────────────────────────────────────────────
  perform probe_as('c');
  -- Sunday's player is still editable although the week has started (BUF played
  -- Thursday). This is the whole feature: a Thursday game no longer freezes it.
  update sealed_pick set player_slug = 'other-sunday'
    where matchup_id = mid and roster_slot = 'S1';
  perform assert_true((select player_slug from sealed_pick where matchup_id = mid and roster_slot = 'S1') = 'other-sunday',
    'ol5 a player yet to kick off is still swappable mid-week');

  -- A player whose game has kicked off cannot be brought IN.
  begin
    update sealed_pick set player_slug = 'thursday-man'
      where matchup_id = mid and roster_slot = 'S1';
    raise exception 'PROBE FAIL ol6 — a kicked-off player was started';
  exception when check_violation then null;
  end;

  -- …and one already IN cannot be pulled out once his game starts.
  -- Seat him the only way a probe can once his game has started: as the SERVER
  -- — which is also the only thing that could have done it legitimately (the
  -- manager set this lineup before Thursday). That takes BOTH halves: the owner
  -- role to pass RLS, and no auth uid to pass the trigger.
  reset role; perform probe_as_server();
  update sealed_pick set player_slug = 'thursday-man' where matchup_id = mid and roster_slot = 'S1';
  set local role authenticated; perform probe_as('c');
  begin
    update sealed_pick set player_slug = 'sunday-man'
      where matchup_id = mid and roster_slot = 'S1';
    raise exception 'PROBE FAIL ol7 — a player who had already played was pulled out';
  exception when check_violation then null;
  end;
  -- The same rule on the DELETE path — otherwise "swap" just becomes "drop".
  begin
    delete from sealed_pick where matchup_id = mid and roster_slot = 'S1';
    raise exception 'PROBE FAIL ol8 — a kicked-off pick was deleted';
  exception when check_violation then null;
  end;

  -- A BYE player (team known, no game this week) has no kickoff to be late
  -- for, so he never locks — the same answer as an empty spot.
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S2', 'bye-man');
  perform assert_true((select count(*) from sealed_pick where matchup_id = mid and roster_slot = 'S2') = 1,
    'ol9 a player on a bye is never locked');
  -- An UNPLACEABLE slug is the opposite: unknown resolves to the STRICTER rule,
  -- the week-wide lock every classic pick obeyed before 0178. Otherwise a slug
  -- the pool didn't know would stay swappable all week.
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S3', 'nobody-knows-him');
    raise exception 'PROBE FAIL ol10 — an unplaceable slug escaped the week-wide fallback';
  exception when check_violation then null;
  end;

  -- Clearing a spot is always allowed while its own player has not kicked off:
  -- an empty spot has nobody to be late for. (This is the case a naive
  -- "unknown → week rule" fallback breaks: a cleared spot has no slug at all.)
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (mid, '00000000-0000-0000-0000-00000000000c', 'wk', 'S4', 'other-sunday');
  update sealed_pick set player_slug = null where matchup_id = mid and roster_slot = 'S4';
  perform assert_true((select player_slug from sealed_pick where matchup_id = mid and roster_slot = 'S4') is null,
    'ol10a a spot can still be cleared mid-week');

  -- A SEALED row is still un-writable: 0178 loosened WHEN things lock, never
  -- the rule that a locked pick is final.
  reset role; perform probe_as_server();
  update sealed_pick set locked = true where matchup_id = mid and roster_slot = 'S2';
  set local role authenticated; perform probe_as('c');
  update sealed_pick set player_slug = 'other-sunday' where matchup_id = mid and roster_slot = 'S2';
  perform assert_true((select player_slug from sealed_pick where matchup_id = mid and roster_slot = 'S2') = 'bye-man',
    'ol11 a sealed pick is still immutable (RLS refuses the write)');

  -- ── THE ROSTER (0179): a started player stops moving ─────────────────────
  -- The lineup rule above has a roster half: IR, a drop, or an add all move a
  -- player just as surely as a lineup swap does. One trigger on native_roster
  -- covers every door, so these assert through the RPCs a manager really uses.
  reset role; perform probe_as_server();
  update draft set status = 'complete' where league_id = lid;   -- roster moves need a finished draft
  insert into native_roster (league_id, roster_id, slug, acquired) values
    (lid, 1, 'thursday-man', 'draft'), (lid, 1, 'sunday-man', 'draft');
  set local role authenticated; perform probe_as('c');
  -- Wrong seat first: roster_id 1 is b's (c joined second), so c is refused for
  -- a reason that has nothing to do with kickoffs. Guards the guard.
  perform assert_true((drop_player(lid, 1, 'sunday-man') ->> 'error') = 'forbidden', 'ol20 the permission check still runs first');
  perform probe_as('b');
  -- Sunday's player still moves: his game is ahead.
  perform assert_ok(drop_player(lid, 1, 'sunday-man'), 'ol21 a player yet to kick off can still be dropped');
  -- Thursday's cannot — he is mid-game.
  begin
    perform drop_player(lid, 1, 'thursday-man');
    raise exception 'PROBE FAIL ol22 — a player mid-game was dropped';
  exception when check_violation then null;
  end;
  -- IR needs a real designation and a spot to put him in, so give him both:
  -- otherwise set_roster_spot refuses for its OWN reasons and proves nothing
  -- about kickoffs. (That is the trap this probe was written wrong once for.)
  reset role; perform probe_as_server();
  insert into injury_status (player_slug, status) values ('thursday-man', 'O')
    on conflict (player_slug) do update set status = 'O';
  -- The shape RPC locks once the draft starts, so set it as the server: this
  -- probe is about kickoffs, not about who may reshape a roster.
  update league set settings_json = coalesce(settings_json, '{}'::jsonb)
    || jsonb_build_object('roster_shape', jsonb_build_object('bench', 6, 'taxi', 0, 'ir', 2))
    where id = lid;
  set local role authenticated; perform probe_as('b');
  begin
    perform set_roster_spot(lid, 'thursday-man', 'ir');
    raise exception 'PROBE FAIL ol23 — a player mid-game was moved to IR';
  exception when check_violation then null;
  end;
  -- And the BEST-BALL exploit: adding someone whose game has already been
  -- played, so a best-ball spot could field him with his score known.
  -- Free him up OUTSIDE the exception block: a caught exception rolls the whole
  -- block back, so staging done inside it would be undone with the failure.
  reset role; perform probe_as_server();
  update league_pool set waived_until = null where league_id = lid and slug = 'thursday-man';
  delete from native_roster where league_id = lid and slug = 'thursday-man';
  set local role authenticated; perform probe_as('b');
  begin
    perform add_free_agent(lid, 1, 'thursday-man');
    raise exception 'PROBE FAIL ol24 — a player whose game had started was added';
  exception when check_violation then null;
  end;
  -- The SERVER still moves anyone: the worker must never jam mid-Sunday.
  reset role; perform probe_as_server();
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, 1, 'thursday-man', 'fa');
  perform assert_true(exists (select 1 from native_roster where league_id = lid and slug = 'thursday-man'),
    'ol25 the server is exempt');
  set local role authenticated; perform probe_as('b');

  -- ── DRIP IS UNTOUCHED ─────────────────────────────────────────────────────
  perform probe_as('b');
  drip_lid := (create_native_league('Still Hidden', '2026', 4, 12, 60) ->> 'league_id')::uuid;
  drip_code := (select invite_code from league where id = drip_lid);
  perform probe_as('c'); perform assert_ok(native_join(drip_code, 'DR-C'), 'ol12 c joins the drip league');
  reset role;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status)
    values (drip_lid, 1, 1, 2, 'scheduled') returning id into drip_mid;
  set local role authenticated;
  perform probe_as('c');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
    values (drip_mid, '00000000-0000-0000-0000-00000000000c', 'sun_late', 'S1', 'sunday-man');
  perform probe_as('b');
  perform assert_true((select count(*) from sealed_pick where matchup_id = drip_mid) = 0,
    'ol13 DRIP: the opponent still cannot read an unlocked pick');
  reset role; perform probe_as_server();
  update sealed_pick set locked = true where matchup_id = drip_mid;
  set local role authenticated; perform probe_as('b');
  perform assert_true((select count(*) from sealed_pick where matchup_id = drip_mid) = 1,
    'ol14 DRIP: a LOCKED pick is readable, exactly as before');

  -- A DRIP roster is untouched by 0179 even for the same kicked-off player.
  reset role; perform probe_as_server();
  update draft set status = 'complete' where league_id = drip_lid;
  insert into league_pool (league_id, slug, full_name, pos, team, rank)
    values (drip_lid, 'thursday-man', 'Thursday Man', 'RB', 'BUF', 1) on conflict do nothing;
  insert into native_roster (league_id, roster_id, slug, acquired) values (drip_lid, 1, 'thursday-man', 'draft');
  set local role authenticated; perform probe_as('b');
  perform assert_ok(drop_player(drip_lid, 1, 'thursday-man'), 'ol15a DRIP: roster moves are not gated on kickoff');

  -- DRIP's window rule still bites: 'thu' kicked off two hours ago.
  perform probe_as('c');
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug)
      values (drip_mid, '00000000-0000-0000-0000-00000000000c', 'thu', 'S2', 'thursday-man');
    raise exception 'PROBE FAIL ol15 — a kicked-off DRIP window accepted a pick';
  exception when check_violation then null;
  end;

  -- And the classic gate really is the gate: the same helper says so.
  perform assert_true(matchup_is_classic(mid), 'ol16 the classic matchup reads classic');
  perform assert_true(not matchup_is_classic(drip_mid), 'ol17 the drip matchup does not');
  perform assert_true(is_league_member_of_matchup(mid), 'ol18 a member is a member');
  perform probe_as('e');
  perform assert_true(not is_league_member_of_matchup(mid), 'ol19 an outsider is not');
end $$;

select 'ALL CLASSIC-OPEN-LINEUP PROBES PASSED' as result;
