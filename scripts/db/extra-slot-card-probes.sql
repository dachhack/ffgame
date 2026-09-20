-- 0304 probes: EXTRA SLOT IS A CARD YOU PLAY ON A WINDOW.
--
-- What must hold:
--   • playing the card consumes ONE owned card and records the slot in all
--     three places the readers look: applied_state.extra (the cap),
--     applied_state.extraSlots[win] (the app), hero_applied.extraSlots[win]
--     (the web board);
--   • a second play stacks the same window to 2 and the cap refuses a third
--     WITHOUT consuming a card;
--   • no card → 'not owned', nothing written; a non-participant → forbidden;
--   • once the week has left 'scheduled' the door is shut ('locked');
--   • a window the week's slate does not have is refused when a slate is
--     loaded; a season with no slate takes the id;
--   • THE POINT: enforce_slot_cap now admits base + the played extras, so a
--     ninth and tenth pick save where an eleventh is refused.
--
-- SCOPED TO THE FIXTURE LEAGUE (season '2077' — no slate; the slate case
-- plants its own rows and removes them). Every suite shares one database.
\set QUIET on
\pset pager off
set client_min_messages = notice;

create or replace function xs_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;

do $$
declare
  lg uuid; mid uuid;
  ua uuid := '00000000-0000-0000-0000-0000000e5101';   -- the manager
  ub uuid := '00000000-0000-0000-0000-0000000e5102';   -- an outsider
  r jsonb; q int; n int; k int;
begin
  insert into auth.users (id, email) values (ua, 'xs-a@test.dev'), (ub, 'xs-b@test.dev') on conflict (id) do nothing;
  insert into app_user (id, email) values (ua, 'xs-a@test.dev'), (ub, 'xs-b@test.dev') on conflict (id) do nothing;
  insert into league (id, sleeper_league_id, name, season, provider, invite_code, commissioner_id, settings_json)
  values (gen_random_uuid(), 'EXTRA-SLOT-PROBE', 'Slot League', '2077', 'native', 'XSLT0001', ua, '{"game_mode":"drip"}'::jsonb)
  returning id into lg;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, team_name) values
    (lg, 1, ua, true, 'Slotters'), (lg, 2, null, false, 'Nobody');
  insert into matchup (id, league_id, week, home_roster_id, away_roster_id, status, lock_at)
  values (gen_random_uuid(), lg, 5, 1, 2, 'scheduled', now() + interval '3 days') returning id into mid;
  -- Two Extra Slot cards in the hand, as the shop would have left them.
  insert into team_inventory (league_id, roster_id, powerup_id, qty) values (lg, 1, 'extra-slot', 2)
    on conflict (league_id, roster_id, powerup_id) do update set qty = 2;

  -- ── an outsider is refused ───────────────────────────────────────────────
  perform set_config('app.uid', ub::text, false);
  perform set_config('app.email', 'xs-b@test.dev', false);
  r := apply_extra_slot(mid, 'early');
  perform xs_true(not (r ->> 'ok')::boolean and r ->> 'error' = 'forbidden', 'xs0 a non-participant is refused: ' || r::text);

  -- ── 1. the manager plays the card on SUN 1PM ─────────────────────────────
  perform set_config('app.uid', ua::text, false);
  perform set_config('app.email', 'xs-a@test.dev', false);
  r := apply_extra_slot(mid, 'early');
  perform xs_true((r ->> 'ok')::boolean and (r ->> 'extra')::int = 1 and (r -> 'extraSlots' ->> 'early')::int = 1,
    'xs1 the card plays: ' || r::text);
  select qty into q from team_inventory where league_id = lg and roster_id = 1 and powerup_id = 'extra-slot';
  perform xs_true(q = 1, 'xs1a one card consumed (2 → 1), got ' || q);
  perform xs_true(my_extra(mid) = 1, 'xs1b applied_state.extra = 1 — the number the cap reads');
  perform xs_true((select (payload_json -> 'extraSlots' ->> 'early')::int from applied_state
                    where matchup_id = mid and app_user_id = ua) = 1,
    'xs1c applied_state.extraSlots names the window (the app reads this)');
  perform xs_true((select (payload_json -> 'extraSlots' ->> 'early')::int from hero_applied
                    where matchup_id = mid and app_user_id = ua) = 1,
    'xs1d hero_applied.extraSlots names it too (the web board reads this)');

  -- ── 2. a second card stacks the same window; a third hits the cap ────────
  r := apply_extra_slot(mid, 'early');
  perform xs_true((r ->> 'ok')::boolean and (r ->> 'extra')::int = 2 and (r -> 'extraSlots' ->> 'early')::int = 2,
    'xs2 the second card stacks SUN 1PM to +2: ' || r::text);
  -- Give one more card, so the refusal is the CAP's and not the hand's.
  update team_inventory set qty = 1 where league_id = lg and roster_id = 1 and powerup_id = 'extra-slot';
  r := apply_extra_slot(mid, 'late');
  perform xs_true(not (r ->> 'ok')::boolean and r ->> 'error' = 'cap', 'xs2a the third is refused by the cap: ' || r::text);
  select qty into q from team_inventory where league_id = lg and roster_id = 1 and powerup_id = 'extra-slot';
  perform xs_true(q = 1, 'xs2b …and the refused play consumed nothing');
  perform xs_true(my_extra(mid) = 2, 'xs2c extra stays 2');

  -- ── 3. THE POINT: the pick cap admits base + extras ──────────────────────
  -- No slate for 2077 → base 8; with 2 extras, 10 picks save and an 11th
  -- does not. (Windows spread so no window lock is in the way: none of them
  -- has a kickoff in this season.)
  for k in 1..3 loop insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id) values (mid, ua, 'early', k::text, 'xs-e' || k, 'rush'); end loop;
  for k in 1..2 loop insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id) values (mid, ua, 'late', k::text, 'xs-l' || k, 'rush'); end loop;
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id) values
    (mid, ua, 'tnf', '0', 'xs-t0', 'rush'), (mid, ua, 'snf', '0', 'xs-s0', 'rush'), (mid, ua, 'mnf', '0', 'xs-m0', 'rush');
  -- eight in; the ninth and tenth are the played extras
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id) values
    (mid, ua, 'early', '4', 'xs-e4', 'rush'), (mid, ua, 'early', '5', 'xs-e5', 'rush');
  select count(*) into n from sealed_pick where matchup_id = mid and app_user_id = ua and player_slug is not null;
  perform xs_true(n = 10, 'xs3 ten picks saved with two extras played (base 8 + 2), got ' || n);
  begin
    insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id) values (mid, ua, 'early', '6', 'xs-e6', 'rush');
    raise exception 'PROBE FAIL xs3a an eleventh pick was admitted';
  exception when check_violation then null;
  end;

  -- ── 4. no card → not owned, nothing written ──────────────────────────────
  -- A fresh seat with no cards (roster 2, claimed by ub for this check).
  update league_membership set app_user_id = ub, enrolled = true where league_id = lg and sleeper_roster_id = 2;
  perform set_config('app.uid', ub::text, false);
  perform set_config('app.email', 'xs-b@test.dev', false);
  r := apply_extra_slot(mid, 'early');
  perform xs_true(not (r ->> 'ok')::boolean and r ->> 'error' = 'not owned', 'xs4 no card → not owned: ' || r::text);
  perform xs_true(not exists (select 1 from applied_state where matchup_id = mid and app_user_id = ub), 'xs4a …and nothing was written for that seat');

  -- ── 5. a slate that lacks the window refuses it ──────────────────────────
  perform set_config('app.uid', ua::text, false);
  perform set_config('app.email', 'xs-a@test.dev', false);
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2077', 5, 'KC', 'PHI', 'snf', now() + interval '2 days') on conflict do nothing;
  update applied_state set payload_json = payload_json - 'extra' where matchup_id = mid and app_user_id = ua;  -- room under the cap for this check
  r := apply_extra_slot(mid, 'wed');
  perform xs_true(not (r ->> 'ok')::boolean and r ->> 'error' = 'no such window', 'xs5 a window the slate lacks is refused: ' || r::text);
  r := apply_extra_slot(mid, 'snf');
  perform xs_true((r ->> 'ok')::boolean and (r -> 'extraSlots' ->> 'snf')::int = 1 and (r -> 'extraSlots' ->> 'early')::int = 2,
    'xs5a a window the slate has is accepted, and the map keeps its earlier windows: ' || r::text);
  delete from nfl_slate where season = '2077';

  -- ── 6. the door shuts with the week's first lock ─────────────────────────
  update matchup set status = 'live' where id = mid;
  update team_inventory set qty = 1 where league_id = lg and roster_id = 1 and powerup_id = 'extra-slot';
  update applied_state set payload_json = payload_json - 'extra' where matchup_id = mid and app_user_id = ua;
  r := apply_extra_slot(mid, 'late');
  perform xs_true(not (r ->> 'ok')::boolean and r ->> 'error' = 'locked', 'xs6 a started week refuses: ' || r::text);
  select qty into q from team_inventory where league_id = lg and roster_id = 1 and powerup_id = 'extra-slot';
  perform xs_true(q = 1, 'xs6a …without consuming the card');

  delete from league where id = lg;   -- cascades the fixture
  delete from app_user where id in (ua, ub);
  perform set_config('app.uid', '', false);
  perform set_config('app.email', '', false);
  raise notice 'extra-slot-card probes done';
end $$;
select 'ALL EXTRA-SLOT-CARD PROBES PASSED' as result;
