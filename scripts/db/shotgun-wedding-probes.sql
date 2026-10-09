-- 0453 probes: SHOTGUN WEDDING.
--   • the commissioner's switch: classic + redraft + head-to-head only, one
--     chat card on, one off, a member cannot flip it;
--   • the worker files a 2-for-2 for a FINAL matchup; the winner is golf-aware;
--     a tie has no winner; open offers naming the four are cancelled;
--   • the four can't move: no drop, no add-with-drop, no IR, no trade offer —
--     each refusal says 💍; the commissioner's force-move still works;
--   • the winner (only) may call it off; a tie can't be;
--   • new vows: either side offers, only the other says yes, and yes trades
--     at once and replaces the original;
--   • the deadline marries what's left; a wedding whose players moved fails
--     cleanly; switching the mode off annuls what's pending;
--   • 0454's house rules: the veto goes to the winner, the loser or nobody;
--     the deadline is Tue 8 PM, Wed 8 PM or Thu noon, never inside the hour
--     before the next kickoff; a rule change is announced;
--   • 0456's commissioner's hand: rewrite any pending wedding's vows (the
--     lock follows), or call it off whatever the veto rule says.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function sw_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function sw_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function sw_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function sw_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000063' || u, false); perform set_config('app.email', 'sw' || u || '@test.dev', false); end $$;
create or replace function sw_worker() returns void language plpgsql as $$
begin perform set_config('app.uid', '', false); perform set_config('app.email', '', false); end $$;
create or replace function sw_last_card(lid uuid) returns text language sql as $$
  select body from league_message where league_id = lid and txn ->> 'kind' = 'wedding' order by id desc limit 1;
$$;
-- Run a statement that must RAISE (a row guard); returns the message.
create or replace function sw_raises(stmt text) returns text language plpgsql as $$
begin execute stmt; return null; exception when others then return sqlerrm; end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000006301', 'sw01@test.dev'), ('00000000-0000-0000-0000-000000006302', 'sw02@test.dev'), ('00000000-0000-0000-0000-000000006303', 'sw03@test.dev'), ('00000000-0000-0000-0000-000000006304', 'sw04@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000006301', 'sw01@test.dev'), ('00000000-0000-0000-0000-000000006302', 'sw02@test.dev'), ('00000000-0000-0000-0000-000000006303', 'sw03@test.dev'), ('00000000-0000-0000-0000-000000006304', 'sw04@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id::text like '00000000-0000-0000-0000-00000000630_';

do $$
declare r jsonb; lid uuid; code text; a int; b int; c int; d int; w1 uuid; w2 uuid; w3 uuid; w4 uuid; tid uuid; msg text; n int;
begin
  perform sw_as('01');
  r := create_native_league('ShotgunWedding', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform sw_ok(r, 'sw0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform sw_as('02'); perform sw_ok(native_join(code, 'SW-B'), 'sw0 B joins');
  perform sw_as('03'); perform sw_ok(native_join(code, 'SW-C'), 'sw0 C joins');
  perform sw_as('04'); perform sw_ok(native_join(code, 'SW-D'), 'sw0 D joins');
  perform sw_as('01');
  update league_membership set team_name = 'SW-A' where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006301';
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'sw-' || g, 'full', 'Groom ' || g, 'pos', case when g % 2 = 0 then 'WR' else 'RB' end, 'team', 'SWH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006301';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006302';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006303';
  select sleeper_roster_id into d from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000006304';
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) select lid, a, 'sw-' || g, 'draft' from generate_series(1, 4) g;
  insert into native_roster (league_id, roster_id, slug, acquired) select lid, b, 'sw-' || g, 'draft' from generate_series(5, 8) g union all select lid, b, 'sw-' || g, 'draft' from generate_series(17, 20) g;
  insert into native_roster (league_id, roster_id, slug, acquired) select lid, c, 'sw-' || g, 'draft' from generate_series(9, 12) g;
  insert into native_roster (league_id, roster_id, slug, acquired) select lid, d, 'sw-' || g, 'draft' from generate_series(13, 16) g;
  perform sw_ok(set_transaction_rules(lid, p_waiver_mode => 'rolling', p_fa_mode => 'open'), 'sw0 rolling, FA open');
  delete from matchup where league_id = lid;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final) values
    (lid, 1, a, b, 'final', 120, 100), (lid, 1, c, d, 'final', 90, 90),
    (lid, 2, a, b, 'final', 80, 110), (lid, 3, a, b, 'final', 70, 60), (lid, 4, a, b, 'scheduled', null, null);

  -- ── sw0. the switch ──
  perform sw_as('02');
  perform sw_refused(set_league_shotgun(lid, true), 'commissioner only', 'sw0a a member cannot turn it on');
  perform sw_as('01');
  update league set settings_json = settings_json || '{"continuity": "keeper", "keeper_count": 2}' where id = lid;
  perform sw_refused(set_league_shotgun(lid, true), 'redraft', 'sw0b a keeper league is refused');
  update league set settings_json = (settings_json - 'continuity' - 'keeper_count') where id = lid;
  perform sw_refused(shotgun_propose(lid, 1, a, b, '["sw-1","sw-2"]', '["sw-5","sw-6"]', now() + interval '6 hours'), 'off', 'sw0c nothing is filed while it is off');
  perform sw_ok(set_league_shotgun(lid, true), 'sw0d the commissioner turns it on');
  perform sw_true(league_shotgun(lid), 'sw0e it reads on');
  perform sw_true(sw_last_card(lid) like '💍 Shotgun Wedding is on.%', 'sw0f the league hears it');

  -- an open offer that will be caught up in the wedding
  perform sw_as('02');
  r := propose_trade(lid, b, a, '["sw-5"]'::jsonb, '["sw-3"]'::jsonb, null, null, null);
  perform sw_ok(r, 'sw0g B offers A a 1-for-1 naming sw-5');
  tid := (r ->> 'trade_id')::uuid;
  if tid is null then select id into tid from trade_proposal where league_id = lid and status = 'pending' order by created_at desc limit 1; end if;

  -- ── sw1. the worker files ──
  perform sw_worker();
  perform sw_refused(shotgun_propose(lid, 4, a, b, '["sw-1","sw-2"]', '["sw-5","sw-6"]', now() + interval '6 hours'), 'not final', 'sw1a not before the matchup is final');
  perform sw_refused(shotgun_propose(lid, 1, a, b, '["sw-1","sw-2","sw-3"]', '["sw-5","sw-6"]', now() + interval '6 hours'), 'two players each way', 'sw1b two each way, no more');
  perform sw_refused(shotgun_propose(lid, 1, a, b, '["sw-1","sw-9"]', '["sw-5","sw-6"]', now() + interval '6 hours'), 'not on the home', 'sw1c only players on the roster');
  perform sw_refused(shotgun_propose(lid, 1, a, b, '["sw-1","sw-2"]', '["sw-5","sw-6"]', now() + interval '30 minutes'), 'too late', 'sw1d a wedding needs a window');
  r := shotgun_propose(lid, 1, a, b, '["sw-1","sw-2"]', '["sw-5","sw-6"]', now() + interval '6 hours');
  perform sw_ok(r, 'sw1 A and B are handed a wedding'); w1 := (r ->> 'wedding_id')::uuid;
  perform sw_true((r ->> 'winner')::int = a, 'sw1e A won 120-100, so A holds the veto');
  perform sw_true((r ->> 'cancelled')::int = 1, 'sw1f the open offer naming sw-5 is cancelled');
  perform sw_true((select status from trade_proposal where id = tid) = 'cancelled', 'sw1g …and reads cancelled');
  perform sw_true(sw_last_card(lid) like '💍 Shotgun Wedding — SW-A sends Groom 1, Groom 2; SW-B sends Groom 5, Groom 6.%unless SW-A, who won, calls it off.%cancelled.', 'sw1h the card names both sides and the winner');
  perform sw_refused(shotgun_propose(lid, 1, a, b, '["sw-3","sw-4"]', '["sw-7","sw-8"]', now() + interval '6 hours'), 'already married', 'sw1i one wedding per matchup per week');
  r := shotgun_propose(lid, 1, c, d, '["sw-9","sw-10"]', '["sw-13","sw-14"]', now() + interval '6 hours');
  perform sw_ok(r, 'sw1j C and D (a tie) are handed one too'); w2 := (r ->> 'wedding_id')::uuid;
  perform sw_true(r -> 'winner' = 'null'::jsonb, 'sw1k a tie has no winner');
  perform sw_true(sw_last_card(lid) like '%it was a tie, so nobody can call it off.', 'sw1l …and the card says so');

  -- ── sw2. the four can't move ──
  perform sw_as('02');
  perform sw_refused(drop_player(lid, b, 'sw-5'), '💍', 'sw2 B cannot drop a wedded player');
  perform sw_refused(add_free_agent(lid, b, 'sw-30', 'sw-6'), 'Shotgun Wedding', 'sw2a nor add with him as the drop');
  -- set_roster_spot asks IR eligibility first (a healthy player is refused
  -- for that); the row guard is what stops an eligible one, so ask the row.
  msg := sw_raises(format('update native_roster set spot = %L where league_id = %L and slug = %L', 'ir', lid, 'sw-5'));
  perform sw_true(msg like '💍 Groom 5 is in a Shotgun Wedding%', 'sw2b nor move him to IR — got ' || coalesce(msg, 'no error'));
  msg := sw_raises(format('delete from native_roster where league_id = %L and slug = %L', lid, 'sw-6'));
  perform sw_true(msg like '💍 Groom 6%', 'sw2b2 nor take him off the roster by any other road — got ' || coalesce(msg, 'no error'));
  msg := sw_raises(format('select propose_trade(%L, %s, %s, %L::jsonb, %L::jsonb, null, null, null)', lid, b, c, '["sw-6"]', '["sw-11"]'));
  perform sw_true(msg like '💍 Groom 6%', 'sw2c nor offer him in a trade — got ' || coalesce(msg, 'no error'));
  perform sw_ok(drop_player(lid, b, 'sw-8'), 'sw2d an unwedded player drops fine');

  -- ── sw3. calling it off ──
  perform sw_refused(shotgun_decline(w1), 'only the team that won', 'sw3 the loser cannot call it off');
  perform sw_as('03');
  perform sw_refused(shotgun_decline(w2), 'tie', 'sw3a a tie cannot be called off');

  -- ── sw4. new vows ──
  perform sw_as('03');
  perform sw_refused(shotgun_counter(w1, '["sw-1"]', '["sw-5"]'), 'only the two teams', 'sw4 an outsider cannot talk terms');
  perform sw_as('02');
  perform sw_refused(shotgun_counter(w1, '["sw-1","sw-2"]', '["sw-5","sw-6"]'), 'original', 'sw4a the original is not new vows');
  perform sw_refused(shotgun_counter(w1, '[]', '["sw-5"]'), 'one to three', 'sw4b one to three each way');
  perform sw_ok(shotgun_counter(w1, '["sw-1"]', '["sw-7"]'), 'sw4c B proposes Groom 1 for Groom 7');
  perform sw_true(sw_last_card(lid) like '💍 SW-B proposed new vows to SW-A: SW-A sends Groom 1; SW-B sends Groom 7.%', 'sw4d the league hears the offer');
  perform sw_refused(shotgun_accept_counter(w1), 'only SW-A', 'sw4e B cannot say yes to its own vows');
  perform sw_as('01');
  r := shotgun_state(lid);
  perform sw_true((r ->> 'week')::int = 1 and jsonb_array_length(r -> 'weddings') = 2, 'sw4f the reader has both of week 1''s weddings');
  perform sw_true((r -> 'weddings' -> 0 ->> 'id')::uuid = w1 and (r -> 'weddings' -> 0 ->> 'can_decline')::boolean
                  and (r -> 'weddings' -> 0 ->> 'can_accept')::boolean, 'sw4g …A''s own first, which A may call off or accept');
  perform sw_true(jsonb_array_length(r -> 'weddings' -> 0 -> 'rosters' -> 'home') = 4, 'sw4h …with both rosters for composing vows');
  -- (A is also the commissioner, so since 0456 it sees both rosters on every
  -- pending wedding; a plain member sees none on a wedding that isn't theirs.)
  perform sw_as('03');
  perform sw_true((select x -> 'rosters' from jsonb_array_elements(shotgun_state(lid) -> 'weddings') x
                    where (x ->> 'id')::uuid = w1) = 'null'::jsonb, 'sw4i …and no rosters for a member on a wedding that isn''t theirs');
  perform sw_as('01');
  r := shotgun_accept_counter(w1);
  perform sw_ok(r, 'sw4j A says yes');
  perform sw_true((select roster_id from native_roster where league_id = lid and slug = 'sw-1') = b
              and (select roster_id from native_roster where league_id = lid and slug = 'sw-7') = a, 'sw4k the new vows traded at once');
  perform sw_true((select roster_id from native_roster where league_id = lid and slug = 'sw-2') = a, 'sw4l …and the original did not');
  perform sw_true((select status from shotgun_wedding where id = w1) = 'renegotiated', 'sw4m the wedding reads renegotiated');
  perform sw_true((select status || note from trade_proposal where id = (r ->> 'trade_id')::uuid) = 'executed💍 Shotgun Wedding', 'sw4n it is an executed trade on the books');
  perform sw_as('02');
  perform sw_ok(drop_player(lid, b, 'sw-6'), 'sw4o the lock lifts with the agreement');

  -- ── sw5. the deadline ──
  update shotgun_wedding set deadline = now() - interval '1 minute' where id = w2;
  perform sw_worker();
  r := shotgun_sweep();
  perform sw_true((r ->> 'married')::int = 1, 'sw5 the sweep marries the tie''s wedding');
  perform sw_true((select roster_id from native_roster where league_id = lid and slug = 'sw-9') = d
              and (select roster_id from native_roster where league_id = lid and slug = 'sw-13') = c, 'sw5a the original traded');
  perform sw_true(sw_last_card(lid) like '💍 Just married — SW-C and SW-D%', 'sw5b the league hears it');
  perform sw_true((shotgun_sweep() ->> 'married')::int = 0, 'sw5c a second sweep does nothing');

  -- ── sw6. the winner calls it off ──
  r := shotgun_propose(lid, 2, a, b, '["sw-2","sw-3"]', '["sw-5","sw-1"]', now() + interval '6 hours');
  perform sw_ok(r, 'sw6 week 2: B won 110-80'); w3 := (r ->> 'wedding_id')::uuid;
  perform sw_true((r ->> 'winner')::int = b, 'sw6a B holds the veto now');
  perform sw_as('01');
  perform sw_refused(shotgun_decline(w3), 'only the team that won', 'sw6b A lost, so A cannot');
  perform sw_as('02');
  perform sw_ok(shotgun_decline(w3), 'sw6c B calls it off');
  perform sw_true(sw_last_card(lid) = '💔 SW-B called off the wedding with SW-A. Everyone keeps their players.', 'sw6d in those words');
  perform sw_refused(shotgun_decline(w3), 'already settled', 'sw6e once is enough');
  perform sw_ok(drop_player(lid, b, 'sw-5'), 'sw6f the lock lifts');

  -- ── sw7. a wedding whose players moved fails cleanly; the commish can move them ──
  perform sw_worker();
  r := shotgun_propose(lid, 3, a, b, '["sw-2","sw-3"]', '["sw-17","sw-18"]', now() + interval '6 hours');
  perform sw_ok(r, 'sw7 week 3''s wedding'); w4 := (r ->> 'wedding_id')::uuid;
  perform sw_as('01');
  perform sw_ok(commish_move_player(lid, 'sw-2', c), 'sw7a the commissioner can still force-move a wedded player');
  update shotgun_wedding set deadline = now() - interval '1 minute' where id = w4;
  perform sw_worker();
  r := shotgun_sweep();
  perform sw_true((r ->> 'failed')::int = 1, 'sw7b the deadline finds a player gone — failed, not half-done');
  perform sw_true((select status from shotgun_wedding where id = w4) = 'failed'
              and (select note from shotgun_wedding where id = w4) like '%moved%', 'sw7c …with the reason');
  perform sw_true((select roster_id from native_roster where league_id = lid and slug = 'sw-3') = a, 'sw7d nobody else moved');

  -- ── sw8. off annuls ──
  update matchup set status = 'final', home_final = 50, away_final = 40 where league_id = lid and week = 4;
  r := shotgun_propose(lid, 4, a, b, (select jsonb_agg(slug) from (select slug from native_roster where league_id = lid and roster_id = a order by slug limit 2) z),
                                     (select jsonb_agg(slug) from (select slug from native_roster where league_id = lid and roster_id = b order by slug limit 2) z), now() + interval '6 hours');
  perform sw_ok(r, 'sw8 week 4''s wedding');
  perform sw_as('01');
  r := set_league_shotgun(lid, false);
  perform sw_true((r ->> 'annulled')::int = 1, 'sw8a off annuls the pending wedding');
  perform sw_true(sw_last_card(lid) like '💍 Shotgun Wedding is off. This week''s weddings are annulled%', 'sw8b the league hears it');
  perform sw_true(not exists (select 1 from shotgun_wedding where league_id = lid and status = 'pending'), 'sw8c nothing pending');

  -- ── sw10. the house rules (0454): who may call it off, and when it's due ──
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, home_final, away_final, lock_at) values
    (lid, 5, a, b, 'final', 100, 90, now() - interval '5 days'),
    (lid, 6, a, b, 'scheduled', null, null, now() + interval '10 hours'),
    (lid, 7, a, b, 'final', 95, 85, now() - interval '1 day');
  perform sw_as('02');
  perform sw_refused(set_league_shotgun(lid, true, 'loser', 'wed20'), 'commissioner only', 'sw10 a member cannot set the house rules');
  perform sw_as('01');
  perform sw_refused(set_league_shotgun(lid, true, 'both', null), 'winner, loser or none', 'sw10a an unknown veto rule is refused');
  perform sw_refused(set_league_shotgun(lid, true, null, 'fri20'), 'tue20, wed20 or thu12', 'sw10b an unknown deadline is refused');
  r := set_league_shotgun(lid, true, 'loser', 'wed20');
  perform sw_ok(r, 'sw10c on again: the loser holds the veto, Wednesday 8 PM');
  perform sw_true(r ->> 'veto' = 'loser' and r ->> 'deadline' = 'wed20', 'sw10d the setter reads the rules back');
  perform sw_true(sw_last_card(lid) like '💍 Shotgun Wedding is on.%8 PM ET Wednesday%the team that lost can call it off%Waivers run first%', 'sw10e the on card states both rules and warns about waivers — got ' || sw_last_card(lid));
  perform sw_true((shotgun_state(lid) ->> 'veto_rule') = 'loser' and (shotgun_state(lid) ->> 'deadline_rule') = 'wed20', 'sw10f the reader has them');
  perform sw_worker();
  r := shotgun_propose(lid, 5, a, b, (select jsonb_agg(slug) from (select slug from native_roster where league_id = lid and roster_id = a order by slug limit 2) z),
                                     (select jsonb_agg(slug) from (select slug from native_roster where league_id = lid and roster_id = b order by slug limit 2) z));
  perform sw_ok(r, 'sw10g week 5 filed with no deadline given — the setting decides');
  w1 := (r ->> 'wedding_id')::uuid;
  perform sw_true((r ->> 'veto')::int = b and (r ->> 'winner')::int = a, 'sw10h A won, so under "loser" B holds the veto');
  perform sw_true((select deadline from shotgun_wedding where id = w1)
                  = (select min(lock_at) from matchup where league_id = lid and week = 6) - interval '1 hour',
                  'sw10i Wednesday 8 PM is past next week''s kickoff here, so it lands an hour before it');
  perform sw_true(sw_last_card(lid) like '%unless SW-B, who lost, calls it off.', 'sw10j the card names the loser — got ' || sw_last_card(lid));
  perform sw_as('01');
  perform sw_refused(shotgun_decline(w1), 'only the team that lost', 'sw10k the winner cannot call it off under "loser"');
  perform sw_true(not (shotgun_state(lid) -> 'weddings' -> 0 ->> 'can_decline')::boolean, 'sw10l …and the reader says so');
  perform sw_as('02');
  perform sw_ok(shotgun_decline(w1), 'sw10m the loser can');
  perform sw_as('01');
  perform sw_ok(set_league_shotgun(lid, true, 'none', null), 'sw10n nobody holds a veto now');
  perform sw_true(sw_last_card(lid) like '💍 Shotgun Wedding house rules, from next Tuesday: Nobody can call it off%', 'sw10o a rule change is announced — got ' || sw_last_card(lid));
  perform sw_worker();
  r := shotgun_propose(lid, 7, a, b, (select jsonb_agg(slug) from (select slug from native_roster where league_id = lid and roster_id = a order by slug limit 2) z),
                                     (select jsonb_agg(slug) from (select slug from native_roster where league_id = lid and roster_id = b order by slug limit 2) z));
  perform sw_ok(r, 'sw10p week 7 filed under "none"'); w2 := (r ->> 'wedding_id')::uuid;
  perform sw_true(r -> 'veto' = 'null'::jsonb and r ->> 'veto_rule' = 'none', 'sw10q no seat holds the veto');
  perform sw_true(sw_last_card(lid) like '%nobody can call this one off.', 'sw10r the card says so');
  perform sw_as('01');
  perform sw_refused(shotgun_decline(w2), 'nobody can call off', 'sw10s the winner cannot');
  perform sw_as('02');
  perform sw_refused(shotgun_decline(w2), 'nobody can call off', 'sw10t nor the loser');
  perform sw_ok(shotgun_counter(w2, (select home_gives from shotgun_wedding where id = w2) -> 0 || '[]'::jsonb,
                                    (select away_gives from shotgun_wedding where id = w2) -> 0 || '[]'::jsonb), 'sw10u new vows still work');
  perform sw_true(_shotgun_deadline_at('tue20', '2026-10-13 10:00-04') = '2026-10-13 20:00-04'
              and _shotgun_deadline_at('wed20', '2026-10-13 10:00-04') = '2026-10-14 20:00-04'
              and _shotgun_deadline_at('thu12', '2026-10-13 10:00-04') = '2026-10-15 12:00-04', 'sw10v the three deadlines, from a Tuesday morning');

  -- ── sw11. the commissioner's hand (0456): rewrite the vows, call it off ──
  -- w2 (week 7, "nobody can call it off") is still pending with B's new vows on the table.
  declare
    old_b text := (select away_gives ->> 0 from shotgun_wedding where id = w2);
    new_a text := (select slug from native_roster where league_id = lid and roster_id = a and spot = 'active'
                     and not ((select home_gives from shotgun_wedding where id = w2) ? slug) order by slug limit 1);
    new_b text := (select slug from native_roster where league_id = lid and roster_id = b and spot = 'active'
                     and not ((select away_gives from shotgun_wedding where id = w2) ? slug) order by slug limit 1);
  begin
    perform sw_as('02');
    perform sw_refused(shotgun_commish_edit(w2, jsonb_build_array(new_a), jsonb_build_array(new_b)), 'commissioner only', 'sw11 a member cannot rewrite the vows');
    perform sw_refused(shotgun_commish_decline(w2), 'commissioner only', 'sw11a nor call it off for the teams');
    perform sw_true(not coalesce((shotgun_state(lid) -> 'weddings' -> 0 ->> 'can_commish')::boolean, false), 'sw11b the reader gives a member no commissioner''s hand');
    perform sw_as('01');
    r := shotgun_state(lid);
    perform sw_true((r -> 'weddings' -> 0 ->> 'can_commish')::boolean and jsonb_array_length(r -> 'weddings' -> 0 -> 'rosters' -> 'away') > 0,
      'sw11c the commissioner''s reader marks it and hands over both rosters');
    perform sw_refused(shotgun_commish_edit(w2, (select home_gives from shotgun_wedding where id = w2), (select away_gives from shotgun_wedding where id = w2)),
      'already on the table', 'sw11d rewriting it to itself is refused');
    perform sw_refused(shotgun_commish_edit(w2, '[]', jsonb_build_array(new_b)), 'one to three', 'sw11e one to three each way');
    perform sw_ok(shotgun_commish_edit(w2, jsonb_build_array(new_a), jsonb_build_array(new_b)), 'sw11f the commissioner rewrites the vows');
    perform sw_true((select home_gives = jsonb_build_array(new_a) and away_gives = jsonb_build_array(new_b) and counter_from is null
                       from shotgun_wedding where id = w2), 'sw11g the row carries the new trade, and the stale new vows are cleared');
    perform sw_true(sw_last_card(lid) like '💍 The commissioner rewrote the vows between SW-A and SW-B:%It still goes through at%', 'sw11h the league hears it — got ' || sw_last_card(lid));
    perform sw_as('02');
    perform sw_refused(drop_player(lid, b, new_b), '💍', 'sw11i the newly named player is locked');
    perform sw_ok(drop_player(lid, b, old_b), 'sw11j the player taken out is free at once');
    perform sw_as('01');
    perform sw_ok(shotgun_commish_decline(w2), 'sw11k the commissioner calls it off, even under "nobody"');
    perform sw_true((select status = 'declined' and note = 'called off by the commissioner' from shotgun_wedding where id = w2), 'sw11l it reads declined, by the commissioner');
    perform sw_true(sw_last_card(lid) = '💔 The commissioner called off the wedding between SW-A and SW-B. Everyone keeps their players.', 'sw11m in those words');
    perform sw_refused(shotgun_commish_decline(w2), 'already settled', 'sw11n once is enough');
  end;

  -- ── sw9. strangers ──
  perform set_config('app.uid', '00000000-0000-0000-0000-000000006399', false);
  perform sw_refused(shotgun_state(lid), 'forbidden', 'sw9 an outsider cannot read it');
  raise notice 'shotgun-wedding probes done';
end $$;

select 'ALL SHOTGUN-WEDDING PROBES PASSED' as result;
