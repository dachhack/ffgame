-- 0484 contest-plays probes: a seat arms a play before the week's first
-- kickoff from its wallet — the catalog and prices, the one-a-week cap (two
-- head-to-head), each play's target rule, the ghost evicting the player and
-- holding the spot through the squad check, a disarm's refund, the kickoff
-- closing the shop, and what the reads carry.
\set QUIET on
\pset pager off
\set ON_ERROR_STOP on
create or replace function assert_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function assert_err(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) then raise exception 'PROBE FAIL % — expected an error, got %', msg, r; end if; end $$;
create or replace function assert_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function probe_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', '00000000-0000-0000-0000-00000000000' || u, false);
  perform set_config('app.email', u || '@test.dev', false);
end $$;
create or replace function cp_bal(p_league uuid, p_roster int) returns numeric language sql as $$
  select coalesce((select coins from team_wallet where league_id = p_league and roster_id = p_roster), 0);
$$;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev')
on conflict (id) do nothing;
do $$
declare r jsonb; h uuid; g uuid; code text; gcode text; wk int := 45; sq jsonb; m1 uuid;
begin
  insert into app_user (id, email) values ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'), ('00000000-0000-0000-0000-00000000000b', 'b@test.dev') on conflict (id) do nothing;
  perform probe_as('a');
  r := create_contest_league('CP H2H', 'high', 'h2h', 'season', 4, 50000); perform assert_ok(r, 'cp0'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  r := create_contest_league('CP Board', 'high', 'board', 'season', 12, 50000); perform assert_ok(r, 'cp0b'); g := (r ->> 'league_id')::uuid; gcode := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'cp0c'); perform assert_ok(join_contest(gcode, 'Bees B'), 'cp0d');
  perform probe_as('a');
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() + interval '2 days'), ('2026', wk, 'SF', 'KC', '', now() + interval '2 days'), ('2026', wk, 'NYJ', 'BUF', '', now() + interval '2 days') on conflict do nothing;
  update nfl_slate set kickoff = now() + interval '2 days' where season = '2026' and week = wk;
  insert into pod_salary (season, week, slug, name, pos, team, salary, proj) values
    ('2026', wk, 'cp-qb1', 'Q One', 'QB', 'PHI', 7000, 20), ('2026', wk, 'cp-qb2', 'Q Two', 'QB', 'SF', 6000, 18), ('2026', wk, 'cp-qb3', 'Q Three', 'QB', 'KC', 4000, 12),
    ('2026', wk, 'cp-rb1', 'R One', 'RB', 'PHI', 6000, 14), ('2026', wk, 'cp-rb2', 'R Two', 'RB', 'SF', 5500, 13), ('2026', wk, 'cp-rb3', 'R Three', 'RB', 'KC', 3500, 6),
    ('2026', wk, 'cp-wr1', 'W One', 'WR', 'NYJ', 6000, 14), ('2026', wk, 'cp-wr2', 'W Two', 'WR', 'SF', 5500, 13), ('2026', wk, 'cp-wr3', 'W Three', 'WR', 'KC', 5000, 12), ('2026', wk, 'cp-wr4', 'W Four', 'WR', 'BUF', 3000, 0),
    ('2026', wk, 'cp-te1', 'T One', 'TE', 'PHI', 4000, 9), ('2026', wk, 'cp-k1', 'K One', 'K', 'PHI', 3000, 8), ('2026', wk, 'cp-d1', 'D One', 'DEF', 'SF', 3000, 7)
    on conflict do nothing;
  sq := '{"S1":"cp-qb1","S2":"cp-rb1","S3":"cp-rb3","S4":"cp-wr1","S5":"cp-wr2","S6":"cp-wr4","S7":"cp-te1","S8":"cp-k1","S9":"cp-d1"}';
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 1, 2, 'scheduled') returning id into m1;
  perform assert_ok(save_contest_entry(h, wk, sq), 'cp1 a saves'); perform assert_ok(save_contest_entry(g, wk, sq), 'cp1b a saves on the board');
  -- coin off: no plays
  perform assert_err(contest_arm_play(h, wk, 'hail-mary'), 'cp2 coin off: nothing to arm');
  perform assert_ok(set_contest_rules(h, null, null, null, null, null, null, null, null, true), 'cp2b coin on'); perform assert_ok(set_contest_rules(g, null, null, null, null, null, null, null, null, true), 'cp2c');
  perform assert_true(cp_bal(h, 1) = 100 and (contest_state(h, wk) ->> 'play_cap')::int = 2 and (contest_state(g, wk) ->> 'play_cap')::int = 1, 'cp2d seeded; two plays head-to-head, one on the board');
  -- the catalog
  perform assert_err(contest_arm_play(h, wk, 'napalm'), 'cp3 no such play');
  perform assert_err(contest_arm_play(h, wk, 'underdog'), 'cp3b a spot play needs a spot');
  perform assert_err(contest_arm_play(h, wk, 'underdog', 'S2'), 'cp3c Underdog refuses a $6k back (bottom third of RB is $3.5k)');
  update team_wallet set coins = 200 where league_id = h and roster_id = 1;   -- room for two plays
  r := contest_arm_play(h, wk, 'underdog', 'S3'); perform assert_ok(r, 'cp3d Underdog on the $3.5k back');
  perform assert_true((r ->> 'wallet')::numeric = 165 and jsonb_array_length(r -> 'plays') = 1 and r -> 'plays' -> 0 ->> 'slot' = 'S3', 'cp3e ◎35 spent, the play listed on its spot');
  perform assert_err(contest_arm_play(h, wk, 'double-or-nothing', 'S3'), 'cp3f a spot carries one play');
  perform assert_err(contest_arm_play(h, wk, 'double-or-nothing', 'S6'), 'cp3g Double or Nothing needs a projection to beat (W Four projects 0)');
  r := contest_arm_play(h, wk, 'double-or-nothing', 'S1'); perform assert_ok(r, 'cp3h Double or Nothing on Q One');
  perform assert_true((select proj from contest_play where league_id = h and roster_id = 1 and play_id = 'double-or-nothing') = 20, 'cp3i …storing his projection');
  perform assert_err(contest_arm_play(h, wk, 'hail-mary'), 'cp3j two plays a week head-to-head: a third is refused');
  perform assert_true(cp_bal(h, 1) = 200 - 35 - 80, 'cp3k the wallet paid both');
  -- the board: one a week; not enough coin
  perform probe_as('b'); perform assert_ok(save_contest_entry(g, wk, sq), 'cp4 b saves on the board');
  perform assert_ok(contest_arm_play(g, wk, 'pick-six'), 'cp4b b arms Pick Six on the board');
  perform assert_err(contest_arm_play(g, wk, 'hail-mary'), 'cp4c one play a week on the board');
  perform assert_ok(contest_disarm_play(g, wk, 'pick-six'), 'cp4d disarmed');
  perform assert_true(cp_bal(g, 2) = 55 and (select qty from team_inventory where league_id = g and roster_id = 2 and powerup_id = 'pick-six') = 1, 'cp4e …back to the hand, not the wallet (0486)');
  update team_wallet set coins = 100 where league_id = g and roster_id = 2;
  perform assert_ok(contest_arm_play(g, wk, 'ghost', 'S6'), 'cp4f the ghost takes W Four''s spot');
  perform assert_true(not exists (select 1 from sleeper_lineup sl, jsonb_array_elements(sl.starters_json) e where sl.league_id = g and sl.week = wk and sl.roster_id = 2 and e ->> 'slot' = 'S6'), 'cp4g W Four stepped out');
  perform assert_true(exists (select 1 from contest_swap where league_id = g and week = wk and roster_id = 2 and slot = 'S6' and out_slug = 'cp-wr4'), 'cp4h …as a swap in the history');
  perform assert_err(save_contest_entry(g, wk, sq), 'cp4i a player on the ghosted spot is refused');
  perform assert_ok(save_contest_entry(g, wk, sq - 'S6'), 'cp4j the squad saves with the spot empty: the ghost holds it');
  perform assert_err(contest_arm_play(g, wk, 'underdog', 'S3'), 'cp4k one play a week: the ghost was it');
  perform assert_ok(contest_disarm_play(g, wk, 'ghost', 'S6'), 'cp4l the ghost disarmed');
  perform assert_err(save_contest_entry(g, wk, sq - 'S6'), 'cp4m …and the empty spot blocks the save again');
  -- (the ghost is in b's hand now: playing it again costs nothing)
  perform assert_ok(contest_arm_play(g, wk, 'ghost', 'S6'), 'cp4o the ghost again, from the hand');
  perform assert_true(cp_bal(g, 2) = 25 and coalesce((select qty from team_inventory where league_id = g and roster_id = 2 and powerup_id = 'ghost'), 0) = 0, 'cp4p ◎25 still; the card left the hand');
  perform assert_ok(contest_disarm_play(g, wk, 'ghost', 'S6'), 'cp4q');
  update team_wallet set coins = 100 where league_id = g and roster_id = 2;
  perform assert_ok(contest_arm_play(g, wk, 'double-or-nothing', 'S1'), 'cp4r ◎80 from ◎100');
  perform assert_ok(contest_disarm_play(g, wk, 'double-or-nothing', 'S1'), 'cp4s');
  delete from team_inventory where league_id = g and roster_id = 2;
  update team_wallet set coins = 30 where league_id = g and roster_id = 2;
  r := contest_arm_play(g, wk, 'ghost', 'S6'); perform assert_err(r, 'cp4t ◎30 can''t buy a ◎75 ghost'); perform assert_true(r ->> 'error' like 'not enough coin%45%', 'cp4u …and says how short');
  -- the reads: mine open, the opponent's sealed until kickoff
  perform probe_as('a');
  perform assert_true(jsonb_array_length(contest_state(h, wk) -> 'plays') = 2, 'cp5 contest_state carries my plays');
  perform assert_true(jsonb_array_length(contest_plays(h, wk) -> 'plays') = 2, 'cp5b mine read');
  perform probe_as('b'); perform assert_true((contest_plays(h, wk, 1) ->> 'sealed')::boolean and jsonb_array_length(contest_plays(h, wk, 1) -> 'plays') = 0, 'cp5b2 the opponent''s are sealed to b (a, the commissioner, sees every seat)'); perform probe_as('a');
  r := contest_matchup(h, wk); perform assert_true(jsonb_array_length(r -> 'matchup' -> 'home_plays') = 2 and jsonb_array_length(r -> 'matchup' -> 'away_plays') = 0, 'cp5c the matchup: mine open, theirs sealed');
  -- kickoff closes the shop
  update nfl_slate set kickoff = now() - interval '1 hour' where season = '2026' and week = wk and home = 'PHI';
  perform assert_err(contest_arm_play(h, wk, 'hail-mary'), 'cp6 no arming after the first kickoff');
  -- 0490: a spot play lives on its player's own clock — Q One (PHI) has kicked off, R Three (KC) has not
  perform assert_err(contest_disarm_play(h, wk, 'double-or-nothing', 'S1'), 'cp6b …nor taking back a play on a spot whose player kicked off');
  perform assert_ok(contest_disarm_play(h, wk, 'underdog', 'S3'), 'cp6b2 …but a spot whose player has not kicked off still gives its play back');
  perform assert_ok(contest_arm_play(h, wk, 'underdog', 'S3'), 'cp6b3 …and takes it again, from the hand');
  perform probe_as('b'); perform assert_true(not (contest_plays(h, wk, 1) ->> 'sealed')::boolean and jsonb_array_length(contest_plays(h, wk, 1) -> 'plays') = 2, 'cp6c the opponent''s plays unseal');
end $$;
-- ── PR 3 (0485): Spy, Jinx, Magnet, Re-deal ──────────────────────────────────
do $$
declare r jsonb; h uuid; g uuid; b2 uuid; code text; gcode text; bcode text; wk int := 46; sq jsonb; m1 uuid;
begin
  perform probe_as('a');
  r := create_contest_league('CP3 H2H', 'high', 'h2h', 'season', 4, 50000); perform assert_ok(r, 'cq0'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  r := create_contest_league('CP3 Board', 'high', 'board', 'season', 12, 50000); perform assert_ok(r, 'cq0b'); g := (r ->> 'league_id')::uuid; gcode := r ->> 'invite_code';
  r := create_contest_league('CP3 Bull', 'bullseye', 'h2h', 'season', 4, 50000, 'slots', 10); perform assert_ok(r, 'cq0c'); b2 := (r ->> 'league_id')::uuid; bcode := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'cq0d'); perform assert_ok(join_contest(gcode, 'Bees B'), 'cq0e'); perform assert_ok(join_contest(bcode, 'Bees Bull'), 'cq0f');
  perform probe_as('a');
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() + interval '2 days'), ('2026', wk, 'SF', 'KC', '', now() + interval '2 days'), ('2026', wk, 'NYJ', 'BUF', '', now() + interval '2 days') on conflict do nothing;
  update nfl_slate set kickoff = now() + interval '2 days' where season = '2026' and week = wk;
  insert into pod_salary (season, week, slug, name, pos, team, salary, proj)
    select '2026', wk, replace(slug, 'cp-', 'cq-'), name, pos, team, salary, proj from pod_salary where season = '2026' and week = 45 and slug like 'cp-%' on conflict do nothing;
  sq := '{"S1":"cq-qb1","S2":"cq-rb1","S3":"cq-rb3","S4":"cq-wr1","S5":"cq-wr2","S6":"cq-wr3","S7":"cq-te1","S8":"cq-k1","S9":"cq-d1"}';
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 1, 2, 'scheduled') returning id into m1;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (b2, wk, 1, 2, 'scheduled');
  perform assert_ok(save_contest_entry(h, wk, sq), 'cq1 a saves'); perform assert_ok(save_contest_entry(g, wk, sq), 'cq1b'); perform assert_ok(save_contest_entry(b2, wk, sq), 'cq1c');
  perform probe_as('b'); perform assert_ok(save_contest_entry(h, wk, sq), 'cq1d b saves'); perform assert_ok(save_contest_entry(b2, wk, sq), 'cq1e'); perform probe_as('a');
  for r in select to_jsonb(x) from (select h as id union all select g union all select b2) x loop
    perform assert_ok(set_contest_rules((r ->> 'id')::uuid, null, null, null, null, null, null, null, null, true), 'cq2 coin on');
  end loop;
  update team_wallet set coins = 300 where league_id in (h, g, b2);
  -- where each play belongs
  perform assert_err(contest_arm_play(g, wk, 'spy', 'S1'), 'cq3 Spy is a head-to-head play');
  perform assert_err(contest_arm_play(g, wk, 'jinx', 'S1'), 'cq3b so is Jinx');
  perform assert_err(contest_arm_play(h, wk, 'magnet', 'S2'), 'cq3c Magnet is a Bullseye play');
  perform assert_err(contest_arm_play(h, wk, 're-deal'), 'cq3d so is Re-deal');
  perform assert_err(contest_arm_play(h, wk, 'spy'), 'cq3e Spy wants a spot');
  -- SPY: the opponent's pick there shows to me, and only to me, before kickoff
  perform assert_true((contest_matchup(h, wk) -> 'matchup' -> 'away_entry' -> 0 ->> 'sealed')::boolean, 'cq4 their S1 is sealed');
  r := contest_arm_play(h, wk, 'spy', 'S1'); perform assert_ok(r, 'cq4b Spy on their S1');
  perform assert_true((contest_matchup(h, wk) -> 'matchup' -> 'away_entry' -> 0 ->> 'player_slug') = 'cq-qb1' and (contest_matchup(h, wk) -> 'matchup' -> 'away_entry' -> 1 ->> 'sealed')::boolean, 'cq4c the matchup shows me their S1, the rest stay sealed');
  perform assert_true((contest_state(h, wk) -> 'opponent' -> 'entry' -> 0 ->> 'player_slug') = 'cq-qb1', 'cq4d the builder''s opponent view shows it too');
  perform probe_as('b');
  perform assert_true((contest_matchup(h, wk) -> 'matchup' -> 'home_entry' -> 0 ->> 'sealed')::boolean, 'cq4e …and b sees nothing of a''s');
  perform probe_as('a');
  -- JINX rides alongside: an opponent's spot can carry both, and neither takes one of my spots
  perform assert_ok(contest_arm_play(h, wk, 'jinx', 'S1'), 'cq5 Jinx on their S1 as well');
  perform assert_err(contest_arm_play(h, wk, 'underdog', 'S3'), 'cq5b …two plays a week, and they count');
  perform assert_true((select count(*) from contest_play where league_id = h and week = wk and roster_id = 1) = 2, 'cq5c two rows');
  -- MAGNET and RE-DEAL under the dart
  perform assert_err(contest_arm_play(b2, wk, 'magnet'), 'cq6 Magnet wants a spot in a per-spot league');
  perform assert_ok(contest_arm_play(b2, wk, 'magnet', 'S2'), 'cq6b Magnet on my RB1');
  perform assert_ok(contest_arm_play(b2, wk, 're-deal'), 'cq6c Re-deal');
  perform assert_true((select count(*) from contest_play where league_id = b2 and week = wk and roster_id = 1 and play_id = 're-deal') = 1, 'cq6d …one row');
  perform assert_err(contest_arm_play(b2, wk, 're-deal'), 'cq6e …and not twice (the cap, and the row)');
  perform assert_ok(set_league_bullseye(b2, 'total'), 'cq7 a one-team-total league') ;
  perform assert_ok(contest_disarm_play(b2, wk, 'magnet', 'S2'), 'cq7b the per-spot magnet taken back');
  r := contest_arm_play(b2, wk, 'magnet', 'S2'); perform assert_ok(r, 'cq7c Magnet under a one-team total takes the squad');
  perform assert_true(r -> 'plays' -> 1 ->> 'slot' is null or (select count(*) from contest_play where league_id = b2 and roster_id = 1 and play_id = 'magnet' and slot is null) = 1, 'cq7d …no spot on its row');
end $$;
-- ── THE SHOP AND THE HAND (0486) ────────────────────────────────────────────
do $$
declare r jsonb; h uuid; code text; wk int := 47; sq jsonb;
begin
  perform probe_as('a');
  r := create_contest_league('CP4 H2H', 'high', 'h2h', 'season', 4, 50000); perform assert_ok(r, 'cs0'); h := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform probe_as('b'); perform assert_ok(join_contest(code, 'Bees'), 'cs0b'); perform probe_as('a');
  insert into nfl_slate (season, week, home, away, win, kickoff) values ('2026', wk, 'PHI', 'DAL', '', now() + interval '2 days') on conflict do nothing;
  update nfl_slate set kickoff = now() + interval '2 days' where season = '2026' and week = wk;
  insert into pod_salary (season, week, slug, name, pos, team, salary, proj)
    select '2026', wk, replace(slug, 'cp-', 'cs-'), name, pos, team, salary, proj from pod_salary where season = '2026' and week = 45 and slug like 'cp-%' on conflict do nothing;
  sq := '{"S1":"cs-qb1","S2":"cs-rb1","S3":"cs-rb3","S4":"cs-wr1","S5":"cs-wr2","S6":"cs-wr3","S7":"cs-te1","S8":"cs-k1","S9":"cs-d1"}';
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status) values (h, wk, 1, 2, 'scheduled');
  perform assert_ok(save_contest_entry(h, wk, sq), 'cs1 a saves');
  perform assert_err(contest_buy_play(h, 'hail-mary'), 'cs2 coin off: no shop');
  perform assert_ok(set_contest_rules(h, null, null, null, null, null, null, null, null, true), 'cs2b coin on');
  perform assert_err(contest_buy_play(h, 'magnet', null), 'cs2c a Bullseye play is not for sale here');
  r := contest_buy_play(h, 'hail-mary'); perform assert_ok(r, 'cs3 bought');
  perform assert_true((r ->> 'wallet')::numeric = 65 and (r -> 'inventory' ->> 'hail-mary')::int = 1, 'cs3b ◎35 paid, one in the hand');
  r := contest_buy_play(h, 'hail-mary'); perform assert_ok(r, 'cs3c and another');
  perform assert_true((r -> 'inventory' ->> 'hail-mary')::int = 2 and (contest_state(h, wk) -> 'inventory' ->> 'hail-mary')::int = 2, 'cs3d two in the hand, and contest_state says so');
  r := contest_arm_play(h, wk, 'hail-mary'); perform assert_ok(r, 'cs4 played from the hand');
  perform assert_true((r ->> 'wallet')::numeric = 30 and (r -> 'inventory' ->> 'hail-mary')::int = 1, 'cs4b no coin moved; one left in the hand');
  r := contest_disarm_play(h, wk, 'hail-mary'); perform assert_ok(r, 'cs4c taken back');
  perform assert_true((r ->> 'wallet')::numeric = 30 and (r -> 'inventory' ->> 'hail-mary')::int = 2, 'cs4d …to the hand');
  update team_wallet set coins = 10 where league_id = h and roster_id = 1;
  perform assert_ok(contest_arm_play(h, wk, 'hail-mary'), 'cs5 a card in hand plays with an empty wallet');
  perform assert_err(contest_buy_play(h, 'pick-six'), 'cs5b …but the shop wants coin');
end $$;
-- ── THE PLAYS, ON AND OFF (0490): the commissioner turns a play off; the shop and the arm refuse it ──
do $$
declare r jsonb; h uuid; wk int;
begin
  perform probe_as('a');
  select id into h from league where name = 'CP H2H' order by created_at desc limit 1;
  select max(week) into wk from matchup where league_id = h;
  perform assert_true(jsonb_array_length(contest_state(h, wk) -> 'plays_off') = 0, 'po0 every play on to start');
  perform probe_as('b'); perform assert_err(set_contest_plays(h, '["spy"]'), 'po1 a member cannot'); perform probe_as('a');
  perform assert_err(set_contest_plays(h, '["winning"]'), 'po2 not a play');
  perform assert_err(set_contest_plays(h, '"spy"'), 'po3 a list, not a word');
  r := set_contest_plays(h, '["spy", "pick-six", "spy"]'); perform assert_ok(r, 'po4 spy and pick six off');
  perform assert_true(r -> 'plays_off' = '["spy", "pick-six"]'::jsonb, 'po5 …once each: ' || (r -> 'plays_off')::text);
  perform assert_true(exists (select 1 from league_message where league_id = h and txn ->> 'kind' = 'plays_off' and body like '%Spy, Pick Six off%'), 'po6 the league hears it');
  perform assert_true(contest_state(h, wk) -> 'plays_off' = '["spy", "pick-six"]'::jsonb and contest_coin_rules(h) -> 'plays_off' = '["spy", "pick-six"]'::jsonb, 'po7 the reads carry it');
  update team_wallet set coins = 500 where league_id = h and roster_id = 1;
  perform assert_err(contest_buy_play(h, 'pick-six'), 'po8 the shop refuses an off play');
  perform assert_err(contest_arm_play(h, wk, 'pick-six', 'S1'), 'po9 …and so does the arm');
  perform assert_ok(contest_buy_play(h, 'underdog'), 'po10 an on play still sells');
  perform assert_ok(set_contest_plays(h, '[]'), 'po11 everything back on');
  perform assert_ok(contest_buy_play(h, 'pick-six'), 'po12 …and pick six sells again');
  perform assert_true(exists (select 1 from league_message where league_id = h and txn ->> 'kind' = 'plays_off' and body like '%every play is on%'), 'po13 the league hears that too');
end $$;

-- ── THE WINDOW (0490): a spot play until the player's own kickoff; a squad play before the first ──
do $$
declare r jsonb; h uuid; wk int;
begin
  perform probe_as('a');
  select id into h from league where name = 'CP H2H' order by created_at desc limit 1;
  select max(week) into wk from matchup where league_id = h;
  update team_wallet set coins = 500 where league_id = h and roster_id = 1;
  delete from contest_play where league_id = h and week = wk and roster_id = 1;   -- a clean week, under the cap
  -- the Eagles kick off; the Niners have not (S1 Q One is PHI, S5 W Two is SF)
  update nfl_slate set kickoff = now() - interval '1 hour' where season = '2026' and week = wk and home = 'PHI';
  update nfl_slate set kickoff = now() + interval '2 days' where season = '2026' and week = wk and home <> 'PHI';
  perform assert_true(not _contest_week_open((select l from league l where l.id = h), wk), 'pw0 the week has kicked off');
  r := contest_arm_play(h, wk, 'pick-six'); perform assert_err(r, 'pw1 a squad play is shut');
  perform assert_true(r ->> 'error' like '%first kickoff%', 'pw2 …and says so: ' || (r ->> 'error'));
  r := contest_arm_play(h, wk, 'double-or-nothing', 'S1'); perform assert_err(r, 'pw3 a spot whose player kicked off is shut');
  perform assert_true(r ->> 'error' like '%kicked off%', 'pw4 …and says so: ' || (r ->> 'error'));
  r := contest_arm_play(h, wk, 'double-or-nothing', 'S5'); perform assert_ok(r, 'pw5 a spot whose player has not kicked off still takes a play');
  r := contest_disarm_play(h, wk, 'double-or-nothing', 'S5'); perform assert_ok(r, 'pw6 …and gives it back on the same clock');
  perform assert_ok(contest_arm_play(h, wk, 'double-or-nothing', 'S5'), 'pw7 armed again');
  update nfl_slate set kickoff = now() - interval '1 minute' where season = '2026' and week = wk and home = 'SF';
  r := contest_disarm_play(h, wk, 'double-or-nothing', 'S5'); perform assert_err(r, 'pw8 once he kicks off the play is set');
  update nfl_slate set kickoff = now() + interval '2 days' where season = '2026' and week = wk;
end $$;

-- ═══ THE SECOND DEAL (0491) ═════════════════════════════════════════════════
-- Fourteen one-effect plays: priced, a squad play arms with no spot, Floor
-- remembers the projection, a high-score play is refused elsewhere, the
-- across-the-table plays want a head-to-head league, and a Smoked spot
-- stays sealed from their Spy.
do $$
declare r jsonb; h uuid; g uuid; wk int; m jsonb; e jsonb;
begin
  perform probe_as('a');
  select id into h from league where name = 'CP H2H' order by created_at desc limit 1;
  select id into g from league where name = 'CP Board' order by created_at desc limit 1;
  select max(week) into wk from matchup where league_id = h;
  update nfl_slate set kickoff = now() + interval '2 days' where season = '2026' and week = wk;
  update team_wallet set coins = 900 where league_id = h and roster_id in (1, 2);
  delete from contest_play where league_id = h and week = wk;
  perform assert_true(_contest_play_price('floor') = 60 and _contest_play_price('curse') = 60 and _contest_play_price('long-boot') = 25 and _contest_play_price('nope') is null, 'np0 the new plays are priced');
  r := contest_arm_play(h, wk, 'trick-play'); perform assert_ok(r, 'np1 a squad play arms with no spot');
  r := contest_arm_play(h, wk, 'floor', 'S5'); perform assert_ok(r, 'np2 Floor stakes a spot');
  perform assert_true((select proj from contest_play where league_id = h and week = wk and roster_id = 1 and play_id = 'floor') > 0, 'np3 …and remembers his projection');
  perform assert_ok(contest_disarm_play(h, wk, 'trick-play'), 'np4 a squad play comes back with no spot');
  perform assert_ok(contest_disarm_play(h, wk, 'floor', 'S5'), 'np5 Floor comes back');
  r := contest_arm_play(h, wk, 'mirror'); perform assert_err(r, 'np6 Mirror wants a spot');
  update league set settings_json = settings_json || '{"contest":"golf"}'::jsonb where id = h;
  r := contest_arm_play(h, wk, 'floor', 'S5'); perform assert_err(r, 'np7 no Floor in golf');
  perform assert_true(r ->> 'error' like '%high-score%', 'np8 …and says so: ' || (r ->> 'error'));
  r := contest_buy_play(h, 'curse'); perform assert_err(r, 'np9 …nor a Curse in the shop');
  update league set settings_json = settings_json || '{"contest":"high"}'::jsonb where id = h;
  update team_wallet set coins = 900 where league_id = g and roster_id = 1;
  r := contest_arm_play(g, wk, 'curse'); perform assert_err(r, 'np10 Curse wants a head-to-head league');
  perform assert_true(r ->> 'error' like '%head-to-head%', 'np11 …and says so: ' || (r ->> 'error'));
  -- SMOKE v SPY
  r := contest_arm_play(h, wk, 'smoke', 'S5'); perform assert_ok(r, 'np12 Smoke on my S5');
  perform probe_as('b');
  update team_wallet set coins = 900 where league_id = h and roster_id = 2;
  r := contest_arm_play(h, wk, 'spy', 'S5'); perform assert_ok(r, 'np13 their Spy on it');
  m := contest_matchup(h, wk);
  e := m -> 'matchup' -> (case when (m -> 'matchup' ->> 'home')::int = 1 then 'home_entry' else 'away_entry' end);
  perform assert_true(exists (select 1 from jsonb_array_elements(e) x where x ->> 'slot' = 'S5' and coalesce((x ->> 'sealed')::boolean, false)), 'np14 …sees nothing: the smoked spot stays sealed');
  perform probe_as('a');
  perform assert_ok(contest_disarm_play(h, wk, 'smoke', 'S5'), 'np15 the Smoke comes back');
  perform probe_as('b');
  m := contest_matchup(h, wk);
  e := m -> 'matchup' -> (case when (m -> 'matchup' ->> 'home')::int = 1 then 'home_entry' else 'away_entry' end);
  perform assert_true(exists (select 1 from jsonb_array_elements(e) x where x ->> 'slot' = 'S5' and nullif(x ->> 'player_slug', '') is not null), 'np16 …and the Spy sees the pick again');
  perform probe_as('a');
  delete from contest_play where league_id = h and week = wk;
end $$;

select 'ALL CONTEST-PLAYS PROBES PASSED';
