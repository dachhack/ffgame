-- 0320 probes: THE COMMISSIONER'S DESK.
--   • a co-commissioner has every commissioner power; only the primary adds,
--     removes and hands over; a hand-over keeps the old primary on as co;
--     commish_overview lists the league for a co-commissioner;
--   • the league-wide wire lock shuts adds, drops and claims for everyone
--     and says so; a team lock shuts one team's adds, drops, claims and
--     trades; the commissioner's force-move still works under both;
--   • the waiver order set at once, refused when a team is missing;
--   • the median game adds a win or a loss per week without touching points;
--   • a score edit on a final matchup moves the standings; refused live;
--   • dues: the amount, the note, marking a seat paid, readable by a member.
\set QUIET on
\pset pager off
-- A suite that dies mid-way must not print its closing PASS line (v0.451.0).
\set ON_ERROR_STOP on
create or replace function cd_true(b boolean, msg text) returns void language plpgsql as $$
begin if b is not true then raise exception 'PROBE FAIL %', msg; end if; end $$;
create or replace function cd_ok(r jsonb, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, false) is not true then raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cd_refused(r jsonb, needle text, msg text) returns void language plpgsql as $$
begin if coalesce((r ->> 'ok')::boolean, true) or coalesce(r ->> 'error', '') not ilike '%' || needle || '%' then
  raise exception 'PROBE FAIL % — got %', msg, r; end if; end $$;
create or replace function cd_as(u text) returns void language plpgsql as $$
begin perform set_config('app.uid', '00000000-0000-0000-0000-0000000011' || u, false); perform set_config('app.email', 'cd' || u || '@test.dev', false); end $$;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000001101', 'cd01@test.dev'), ('00000000-0000-0000-0000-000000001102', 'cd02@test.dev'), ('00000000-0000-0000-0000-000000001103', 'cd03@test.dev') on conflict (id) do nothing;
insert into app_user (id, email) values ('00000000-0000-0000-0000-000000001101', 'cd01@test.dev'), ('00000000-0000-0000-0000-000000001102', 'cd02@test.dev'), ('00000000-0000-0000-0000-000000001103', 'cd03@test.dev') on conflict (id) do nothing;
update app_user set features = coalesce(features, '{}'::jsonb) || '{"native": true}'::jsonb where id in ('00000000-0000-0000-0000-000000001101', '00000000-0000-0000-0000-000000001102', '00000000-0000-0000-0000-000000001103');

do $$
declare r jsonb; lid uuid; code text; a int; b int; c int; wk int; mid uuid; tid uuid; st jsonb; ha numeric; hb numeric; i int;
begin
  perform cd_as('01');
  r := create_native_league('CommishDesk', '2026', 4, 8, 60, 'snake', 200, 15, 1, null, null, null, 'classic');
  perform cd_ok(r, 'cd0 league'); lid := (r ->> 'league_id')::uuid; code := r ->> 'invite_code';
  perform cd_as('02'); perform cd_ok(native_join(code, 'CD-B'), 'cd0 B joins');
  perform cd_as('03'); perform cd_ok(native_join(code, 'CD-C'), 'cd0 C joins');
  perform cd_as('01');
  perform seed_league_pool(lid, (
    select jsonb_agg(jsonb_build_object('slug', 'cd-' || g, 'full', 'Player ' || g, 'pos', 'RB', 'team', 'CDH', 'exp', 0))
    from generate_series(1, 40) g));
  select sleeper_roster_id into a from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001101';
  select sleeper_roster_id into b from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001102';
  select sleeper_roster_id into c from league_membership where league_id = lid and app_user_id = '00000000-0000-0000-0000-000000001103';
  perform cd_ok(native_generate_schedule(lid, 2), 'cd0 the schedule');
  update draft set status = 'complete' where league_id = lid;
  insert into native_roster (league_id, roster_id, slug, acquired) values (lid, a, 'cd-1', 'draft'), (lid, b, 'cd-2', 'draft'), (lid, b, 'cd-3', 'draft'), (lid, c, 'cd-4', 'draft');
  perform cd_ok(set_transaction_rules(lid, p_waiver_mode => 'rolling', p_fa_mode => 'open'), 'cd0 rolling, FA open');

  -- ── cd1. co-commissioners ──
  perform cd_as('02');
  perform cd_true(not is_league_commish(lid), 'cd1 B is not a commissioner');
  r := add_commissioner(lid, 'cd03@test.dev'); perform cd_refused(r, 'only the league', 'cd1 B cannot add one');
  perform cd_as('01');
  r := add_commissioner(lid, 'nobody@test.dev'); perform cd_refused(r, 'no account', 'cd1 an unknown email is refused');
  perform cd_ok(add_commissioner(lid, 'cd02@test.dev'), 'cd1 A adds B');
  perform cd_as('02');
  perform cd_true(is_league_commish(lid) and not is_primary_commish(lid), 'cd1 B is now a commissioner, not the primary');
  perform cd_ok(set_transaction_rules(lid, p_waiver_hold_days => 2), 'cd1 B may change the rules');
  perform cd_ok(commish_move_player(lid, 'cd-4', a), 'cd1 B may force-move a player');
  perform cd_ok(commish_move_player(lid, 'cd-4', c), 'cd1 (and back)');
  perform cd_true((select count(*) from jsonb_array_elements(commish_overview()) e where (e ->> 'league_id')::uuid = lid and (e ->> 'primary')::boolean = false) = 1,
    'cd1 the league lists for B, flagged not primary');
  r := add_commissioner(lid, 'cd03@test.dev'); perform cd_refused(r, 'only the league', 'cd1 a co-commissioner cannot add another');
  r := remove_commissioner(lid, '00000000-0000-0000-0000-000000001102'); perform cd_ok(r, 'cd1 B may step down');
  perform cd_true(not is_league_commish(lid), 'cd1 and is no longer one');
  perform cd_as('01');
  perform cd_ok(add_commissioner(lid, 'cd02@test.dev'), 'cd1 A adds B again');
  perform cd_ok(transfer_commissioner(lid, '00000000-0000-0000-0000-000000001102'), 'cd1 A hands the league to B');
  perform cd_true(not is_primary_commish(lid) and is_league_commish(lid), 'cd1 A is now a co-commissioner');
  perform cd_true((league_commissioners(lid) -> 'primary' ->> 'email') = 'cd02@test.dev'
    and (select count(*) from jsonb_array_elements(league_commissioners(lid) -> 'co')) = 1, 'cd1 the reader: B primary, A co');
  perform cd_as('02');
  perform cd_ok(transfer_commissioner(lid, '00000000-0000-0000-0000-000000001101'), 'cd1 B hands it back');
  perform cd_as('01');
  perform cd_true(is_primary_commish(lid), 'cd1 A is primary again');

  -- ── cd2. the two locks ──
  perform cd_ok(commish_set_wire_lock(lid, true), 'cd2 the wire is locked');
  perform cd_true((roster_rules(lid) ->> 'wire_lock')::boolean, 'cd2 the reader says so');
  perform cd_as('03');
  r := add_free_agent(lid, c, 'cd-10', null); perform cd_refused(r, 'locked all free agent', 'cd2 C cannot add');
  r := drop_player(lid, c, 'cd-4'); perform cd_refused(r, 'locked all free agent', 'cd2 C cannot drop');
  perform cd_true((native_team_state(lid) ->> 'wire_block') ilike '%locked all%', 'cd2 the team screen is told why');
  perform cd_as('01');
  perform cd_ok(commish_move_player(lid, 'cd-10', c), 'cd2 the commissioner''s force-add still works');
  perform cd_ok(commish_set_wire_lock(lid, false), 'cd2 reopened');
  perform cd_as('03');
  perform cd_ok(drop_player(lid, c, 'cd-10'), 'cd2 C drops again');
  perform cd_as('01');
  perform cd_ok(commish_lock_team(lid, b, true), 'cd2 B''s team is locked');
  perform cd_true((roster_rules(lid) -> 'locked_rosters') @> to_jsonb(array[b]), 'cd2 the reader lists B');
  perform cd_as('02');
  r := add_free_agent(lid, b, 'cd-11', null); perform cd_refused(r, 'locked this team', 'cd2 B cannot add');
  r := propose_trade(lid, b, c, '["cd-2"]'::jsonb, '["cd-4"]'::jsonb, null, null, null); perform cd_refused(r, 'locked this team', 'cd2 B cannot offer a trade');
  perform cd_as('03');
  perform cd_ok(add_free_agent(lid, c, 'cd-12', null), 'cd2 C, unlocked, adds fine');
  r := propose_trade(lid, c, b, '["cd-4"]'::jsonb, '["cd-2"]'::jsonb, null, null, null); perform cd_refused(r, 'locked that team', 'cd2 nobody can offer B a trade');
  perform cd_as('01');
  perform cd_ok(commish_lock_team(lid, b, false), 'cd2 B unlocked');
  perform cd_as('03');
  r := propose_trade(lid, c, b, '["cd-4"]'::jsonb, '["cd-2"]'::jsonb, null, null, null); perform cd_ok(r, 'cd2 and the offer goes through'); tid := (r ->> 'trade_id')::uuid;
  perform cd_ok(cancel_trade(tid), 'cd2 (withdrawn)');
  perform cd_as('01');

  -- ── cd3. the waiver order ──
  r := commish_set_waiver_priority(lid, to_jsonb(array[c, a])); perform cd_refused(r, 'every team', 'cd3 a short list is refused');
  select array_to_json(array_agg(sleeper_roster_id order by sleeper_roster_id))::jsonb into r from league_membership where league_id = lid;
  perform cd_ok(commish_set_waiver_priority(lid, (select jsonb_agg(x order by x desc) from jsonb_array_elements(r) x)), 'cd3 reversed order set');
  perform cd_true((select waiver_priority from league_membership where league_id = lid and sleeper_roster_id = (select max(sleeper_roster_id) from league_membership where league_id = lid)) = 1,
    'cd3 the highest seat now picks first');

  -- ── cd4. the median game ──
  select league_live_week(lid) into wk;
  update matchup set status = 'final', home_final = 100 + home_roster_id, away_final = 100 + away_roster_id where league_id = lid and week = wk;
  st := league_standings(lid);
  perform cd_true((select sum((e ->> 'wins')::int) from jsonb_array_elements(st) e) = 2, 'cd4 two winners in a four-team week');
  perform cd_ok(commish_set_median_game(lid, true), 'cd4 median game on');
  st := league_standings(lid);
  perform cd_true((select sum((e ->> 'wins')::int) from jsonb_array_elements(st) e) = 4 and (select sum((e ->> 'losses')::int) from jsonb_array_elements(st) e) = 4,
    'cd4 now four wins and four losses across the league');
  perform cd_true((select (e ->> 'wins')::int from jsonb_array_elements(st) e where (e ->> 'roster_id')::int = 4) = 2
    and (select (e ->> 'median_w')::int from jsonb_array_elements(st) e where (e ->> 'roster_id')::int = 4) = 1,
    'cd4 the top scorer beat the median too');
  perform cd_true((select sum((e ->> 'pf')::numeric) from jsonb_array_elements(st) e) = (select sum(home_final + away_final) from matchup where league_id = lid and week = wk),
    'cd4 points for are untouched by the median game');
  perform cd_ok(commish_set_median_game(lid, false), 'cd4 off again');

  -- ── cd5. score edits ──
  select id, home_final, away_final into mid, ha, hb from matchup where league_id = lid and week = wk order by id limit 1;
  r := commish_week_scores(lid, wk); perform cd_ok(r, 'cd5 the week reads');
  perform cd_true((select count(*) from jsonb_array_elements(r -> 'matchups')) = 2, 'cd5 two matchups in it');
  perform cd_ok(commish_set_matchup_score(mid, hb + 50, hb), 'cd5 the home side is handed 50 more');
  perform cd_true((select home_final from matchup where id = mid) = hb + 50, 'cd5 stored');
  st := league_standings(lid);
  perform cd_true((select (e ->> 'wins')::int from jsonb_array_elements(st) e where (e ->> 'roster_id')::int = (select home_roster_id from matchup where id = mid)) = 1,
    'cd5 and the standings follow');
  update matchup set status = 'live' where id = mid;
  r := commish_set_matchup_score(mid, 1, 1); perform cd_refused(r, 'final', 'cd5 a live matchup is refused');
  update matchup set status = 'final' where id = mid;
  perform cd_as('03');
  r := commish_set_matchup_score(mid, 1, 1); perform cd_refused(r, 'commissioner', 'cd5 a manager is refused');
  perform cd_as('01');

  -- ── cd6. dues ──
  perform cd_ok(set_league_dues(lid, 50, 'Venmo @commish before week 1'), 'cd6 dues set');
  perform cd_ok(commish_set_dues_paid(lid, b, true), 'cd6 B marked paid');
  perform cd_as('03');
  r := league_dues(lid); perform cd_ok(r, 'cd6 a member reads the tracker');
  perform cd_true((r ->> 'amount')::int = 50 and (r ->> 'note') like 'Venmo%'
    and (select (e ->> 'paid')::boolean from jsonb_array_elements(r -> 'teams') e where (e ->> 'roster_id')::int = b)
    and not (select (e ->> 'paid')::boolean from jsonb_array_elements(r -> 'teams') e where (e ->> 'roster_id')::int = c),
    'cd6 B paid, C not, $50, the note');
  r := commish_set_dues_paid(lid, c, true); perform cd_refused(r, 'commissioner', 'cd6 a manager cannot mark himself paid');
  perform cd_as('01');
  perform cd_ok(commish_set_dues_paid(lid, b, false), 'cd6 B unmarked');
  perform cd_true(not (select (e ->> 'paid')::boolean from jsonb_array_elements(league_dues(lid) -> 'teams') e where (e ->> 'roster_id')::int = b), 'cd6 and reads unpaid');
end $$;

select 'ALL COMMISH-DESK PROBES PASSED' as result;
