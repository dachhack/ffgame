-- 0106 Window Pot probes. Run with ON_ERROR_STOP; every failed assertion raises.
--
-- One probe per scenario in docs/window-pot.md §6. Same style as
-- native-league-probes.sql: build a throwaway fixture, drive the real RPCs,
-- assert on the real tables and the real wallets.
--
-- Every scenario gets its OWN league + matchup + week, so each block's coin
-- assertions are absolute rather than cumulative — a broken probe can't cascade
-- into the next one's arithmetic. The per-fixture WEEK matters: window_kickoff()
-- (0058) resolves the newest season carrying a week number, so two fixtures
-- sharing a week would resolve each other's kickoffs.
\set QUIET on
\pset pager off

grant select, insert, update, delete on all tables in schema public to authenticated, anon, service_role;

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
create or replace function assert_eq(a int, b int, msg text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception 'PROBE FAIL % — expected %, got %', msg, b, a; end if; end $$;
create or replace function assert_txt(a text, b text, msg text) returns void language plpgsql as $$
begin if a is distinct from b then raise exception 'PROBE FAIL % — expected %, got %', msg, b, a; end if; end $$;

-- ── fixture helpers ──────────────────────────────────────────────────────────

-- Identity: roster 1 (home) is probe user 7, roster 2 (away) is probe user 8.
-- The WORKER is "nobody" — auth.uid() null, exactly like the service role.
create or replace function pot_as(u text) returns void language plpgsql as $$
begin
  perform set_config('app.uid', case when u is null then ''
    else '00000000-0000-0000-0000-00000000000' || u end, false);
  perform set_config('app.email', coalesce(u, '') || '@test.dev', false);
end $$;
create or replace function pot_as_worker() returns void language plpgsql as $$
begin perform set_config('app.uid', '', false); perform set_config('app.email', '', false); end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000007', '7@test.dev'),
  ('00000000-0000-0000-0000-000000000008', '8@test.dev')
on conflict (id) do nothing;
insert into app_user (id, email) values
  ('00000000-0000-0000-0000-000000000007', '7@test.dev'),
  ('00000000-0000-0000-0000-000000000008', '8@test.dev')
on conflict (id) do nothing;

create sequence if not exists pot_probe_week start 900;

/** A fresh league + matchup + slate + wallets on its own week. Windows are named
 *  w1…wN and kick off p_hours from now, six hours apart — so with the default
 *  p_hours = 3 the betting deadline (kickoff − 1h) is two hours out and the
 *  ladder is wide open. */
create or replace function pot_fixture(
  p_tag text, p_home_coins int, p_away_coins int,
  p_ante int default 10, p_hours numeric default 3, p_windows int default 2,
  p_away_controller text default 'human', p_away_enrolled boolean default true
) returns uuid language plpgsql as $$
declare lid uuid; mid uuid; wk int; i int;
begin
  wk := nextval('pot_probe_week')::int;
  insert into league (sleeper_league_id, season, name, pot_ante, pot_cap)
    values ('potprobe-' || p_tag, 'potprobe', 'Pot ' || p_tag, p_ante, 120) returning id into lid;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, controller, team_name)
    values (lid, 1, '00000000-0000-0000-0000-000000000007', true, 'human', 'Home'),
           (lid, 2, case when p_away_enrolled then '00000000-0000-0000-0000-000000000008'::uuid end,
            p_away_enrolled, p_away_controller, 'Away');
  for i in 1..p_windows loop
    insert into nfl_slate (season, week, home, away, win, kickoff) values
      ('potprobe', wk, 'H' || i, 'A' || i, 'w' || i,
       now() + make_interval(mins => (p_hours * 60)::int + (i - 1) * 360));
  end loop;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
    values (lid, wk, 1, 2, 'scheduled', now() + make_interval(mins => (p_hours * 60)::int - 60))
    returning id into mid;
  -- Seed through credit_wallet, not a raw insert, so the 0025 invariant
  -- (sum(coin_ledger.delta) per team == team_wallet.coins) holds from the start.
  perform credit_wallet(lid, 1, null, null, p_home_coins, 'seed');
  perform credit_wallet(lid, 2, null, null, p_away_coins, 'seed');
  return mid;
end $$;

/** Mark a window's games FINAL (the 0103 explicit state) and publish the resolve
 *  pass's per-window scores — the same matchup_state rows the +5 window bonus is
 *  paid off, which is what settlement reads. */
create or replace function pot_finish(p_mid uuid, p_win text, p_home numeric, p_away numeric)
  returns void language plpgsql as $$
declare m matchup%rowtype; s record;
begin
  select * into m from matchup where id = p_mid;
  for s in select * from nfl_slate where season = 'potprobe' and week = m.week and win = p_win loop
    insert into game_feed (week, game_id, key, away, home, state)
      values (m.week, m.week || ':' || s.home, s.away || '@' || s.home, s.away, s.home, 'post')
      on conflict (week, game_id) do update set state = 'post';
  end loop;
  insert into matchup_state (matchup_id, game_window, home_score, away_score)
    values (p_mid, p_win, p_home, p_away)
    on conflict (matchup_id, game_window) do update set home_score = p_home, away_score = p_away;
end $$;

/** Move a window's kickoff, so the betting deadline (kickoff − 1h) can be pushed
 *  into the past on demand. */
create or replace function pot_move_kickoff(p_mid uuid, p_win text, p_offset interval)
  returns void language plpgsql as $$
declare m matchup%rowtype;
begin
  select * into m from matchup where id = p_mid;
  update nfl_slate set kickoff = now() + p_offset
    where season = 'potprobe' and week = m.week and win = p_win;
end $$;

create or replace function pot_bank_of(p_mid uuid, p_roster int) returns int language sql as $$
  select pot_bank(m.league_id, p_roster) from matchup m where m.id = p_mid;
$$;
create or replace function pot_row(p_mid uuid, p_win text) returns window_pot language sql as $$
  select * from window_pot where matchup_id = p_mid and game_window = p_win;
$$;
create or replace function pot_league(p_mid uuid) returns uuid language sql as $$
  select league_id from matchup where id = p_mid;
$$;

-- ── 0. feature OFF is the shipping default ───────────────────────────────────
-- The definition of done: a league with pot_ante = 0 sees no trace of any of it.
do $$
declare mid uuid; r jsonb;
begin
  perform pot_as_worker();
  mid := pot_fixture('off', 200, 200, 0);
  perform assert_eq((select pot_ante from league where id = pot_league(mid)), 0, '0a leagues ship with pot_ante 0');
  perform pot_as('7');
  perform assert_err(pot_ante(mid, 'w1'), 'pots are off', '0b anteing refused');
  perform assert_err(pot_act(mid, 'w1', 'wager', 20), 'pots are off', '0c acting refused');
  r := pot_state(mid);
  perform assert_true((r ->> 'off')::boolean, '0d pot_state reports off');
  perform assert_eq((select count(*)::int from window_pot where matchup_id = mid), 0, '0e no pot rows exist at all');
  perform assert_eq((select count(*)::int from coin_ledger
                     where league_id = pot_league(mid) and reason like 'pot:%'), 0, '0f no coin moved');
end $$;

do $$
begin
  perform assert_eq((select count(*)::int from league where pot_ante <> 0 and season <> 'potprobe'), 0,
    '0g no pre-existing league gets a pot by accident');
end $$;

-- ── 1. wagering is OPT-IN: nothing exists until somebody taps ────────────────
do $$
declare mid uuid; r jsonb;
begin
  perform pot_as_worker();
  mid := pot_fixture('optin', 200, 200);
  perform assert_ok(pot_sweep(), '1a a sweep over a league nobody touched');
  perform assert_eq((select count(*)::int from window_pot where matchup_id = mid), 0,
    '1b no pot rows — the ante is never automatic');
  perform assert_eq(pot_bank_of(mid, 1), 200, '1c nobody was charged anything');
  perform assert_eq(pot_bank_of(mid, 2), 200, '1d …on either side');
  perform pot_as('7');
  perform assert_eq(jsonb_array_length(pot_state(mid) -> 'windows'), 0, '1e pot_state shows no pots');

  -- The offer: ◎10 down, and nothing else is possible until it's answered.
  r := pot_ante(mid, 'w1');
  perform assert_ok(r, '1f home leads the ante');
  perform assert_true((r ->> 'led')::boolean, '1g …as the leader');
  perform assert_txt((pot_row(mid, 'w1')).state, 'offered', '1h the pot is an OFFER, not a pot yet');
  perform assert_txt((pot_row(mid, 'w1')).leader, 'home', '1i leader recorded');
  perform assert_eq((pot_row(mid, 'w1')).home_ante, 10, '1j ◎10 in');
  perform assert_eq(pot_bank_of(mid, 1), 190, '1k committed money — debited at once');
  perform assert_err(pot_ante(mid, 'w1'), 'you led this one', '1l can''t ante twice');
  perform assert_err(pot_act(mid, 'w1', 'wager', 20), 'hasn''t been matched', '1m no wagering into an unmatched offer');
end $$;

-- ── 2. the offer nobody picks up → VOID at picks lock ────────────────────────
do $$
declare mid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('void', 200, 200);
  perform pot_as('7');
  perform assert_ok(pot_ante(mid, 'w1'), '2a home offers');
  perform assert_eq(pot_bank_of(mid, 1), 190, '2b ante is committed while the offer stands');

  perform pot_as_worker();
  perform pot_move_kickoff(mid, 'w1', interval '30 minutes');  -- lock_at = kickoff − 1h, now past
  perform assert_ok(pot_sweep(), '2c sweep at picks lock');
  perform assert_txt((pot_row(mid, 'w1')).state, 'void', '2d an unanswered offer voids');
  perform assert_true((pot_row(mid, 'w1')).winner is null, '2e no contest, no winner');
  perform assert_eq(pot_bank_of(mid, 1), 200, '2f the ante goes home in full');
  perform assert_eq(pot_bank_of(mid, 2), 200, '2g ignoring an offer costs nothing');
end $$;

-- ── 3. ante → match → the LEADER acts first, and turns alternate ─────────────
do $$
declare mid uuid; r jsonb; wp window_pot%rowtype;
begin
  perform pot_as_worker();
  mid := pot_fixture('turn', 200, 200);
  perform pot_as('8');
  perform assert_ok(pot_ante(mid, 'w1'), '3a AWAY leads this one');
  perform pot_as('7');
  r := pot_ante(mid, 'w1');
  perform assert_ok(r, '3b home matches');
  perform assert_true((r ->> 'matched')::boolean, '3c …as the matcher');
  wp := pot_row(mid, 'w1');
  perform assert_txt(wp.state, 'live', '3d matching is what makes the pot real');
  perform assert_txt(wp.turn, 'away', '3e the player who LED the ante acts first');
  perform assert_eq(wp.home_ante + wp.away_ante, 20, '3f ◎20 on the table');
  perform assert_eq(pot_bank_of(mid, 1), 190, '3g both charged');
  perform assert_eq(pot_bank_of(mid, 2), 190, '3h …exactly the ante');

  -- Out of turn is refused — which is also how two managers racing one pot are
  -- resolved: the advisory lock serializes them and the loser finds the turn gone.
  perform assert_err(pot_act(mid, 'w1', 'wager', 20), 'not your turn', '3i home can''t jump the leader');
  perform assert_err(pot_act(mid, 'w1', 'check'), 'not your turn', '3j …not even to check');
  perform assert_err(pot_ante(mid, 'w1'), 'already under way', '3k …nor re-ante');

  -- Checking passes the action without committing anything. Nobody is forced to
  -- bet just because they anted in.
  perform pot_as('8');
  perform assert_ok(pot_act(mid, 'w1', 'check'), '3l leader checks');
  perform assert_txt((pot_row(mid, 'w1')).turn, 'home', '3m turn passes');
  perform assert_eq(pot_bank_of(mid, 2), 190, '3n a check costs nothing');
  perform pot_as('7');
  perform assert_ok(pot_act(mid, 'w1', 'check'), '3o and back again');
  perform assert_txt((pot_row(mid, 'w1')).turn, 'away', '3p rinse and repeat — betting stays open until lock');
  perform pot_as('8');
  perform assert_err(pot_act(mid, 'w1', 'call'), 'nothing to call', '3q nothing owed to call');
end $$;

-- ── 4. the ladder: wager · call · raise, up to the league cap ────────────────
do $$
declare mid uuid; wp window_pot%rowtype;
begin
  perform pot_as_worker();
  mid := pot_fixture('ladder', 400, 400);
  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '4a home leads');
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '4b away matches');

  -- ◎120 cap ⇒ ◎60 a side, of which the ◎10 ante is already down.
  perform assert_eq(pot_effective_stack(mid, 'w1', 'home'), 50, '4c ◎50 of ladder left a side');
  perform pot_as('7');
  perform assert_ok(pot_act(mid, 'w1', 'wager', 20), '4d home opens ◎20');
  wp := pot_row(mid, 'w1');
  perform assert_eq(wp.owed, 20, '4e away owes ◎20');
  perform assert_txt(wp.turn, 'away', '4f their move');
  perform assert_eq(wp.home_bet, 20, '4g wager is committed money');

  perform pot_as('8');
  perform assert_err(pot_act(mid, 'w1', 'check'), 'wager to answer', '4h can''t check past a wager');
  perform assert_ok(pot_act(mid, 'w1', 'raise', 20), '4i away calls ◎20 and raises ◎20');
  wp := pot_row(mid, 'w1');
  perform assert_eq(wp.away_bet, 40, '4j called 20 + wagered 20');
  perform assert_eq(wp.owed, 20, '4k home owes the raise');
  perform assert_txt(wp.turn, 'home', '4l back to home');

  perform pot_as('7');
  perform assert_ok(pot_act(mid, 'w1', 'call'), '4m home calls — ◎50 a side, turn passes back');
  perform assert_eq(pot_effective_stack(mid, 'w1', 'away'), 10, '4n ◎10 of headroom left');
  perform pot_as('8');
  perform assert_err(pot_act(mid, 'w1', 'wager', 20), 'table stakes', '4o the cap refuses more');
  perform assert_ok(pot_act(mid, 'w1', 'wager', 10), '4p …but the last ◎10 is fine');
  perform pot_as('7');
  perform assert_ok(pot_act(mid, 'w1', 'call'), '4q home calls it off');
  wp := pot_row(mid, 'w1');
  perform assert_eq(wp.home_ante + wp.home_bet + wp.away_ante + wp.away_bet, 120, '4r pot maxes at the league cap');
  perform assert_eq(pot_effective_stack(mid, 'w1', 'away'), 0, '4s nothing more is offerable');
  perform pot_as('8');
  perform assert_err(pot_act(mid, 'w1', 'wager', 5), 'table stakes', '4t a capped pot offers no wager');
end $$;

-- ── 5. backing out costs EXACTLY the ante, however deep the ladder went ──────
do $$
declare mid uuid; wp window_pot%rowtype;
begin
  perform pot_as_worker();
  mid := pot_fixture('fold', 200, 200);
  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '5a home leads');
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '5b away matches');
  perform pot_as('7'); perform assert_ok(pot_act(mid, 'w1', 'wager', 20), '5c home opens ◎20');
  perform pot_as('8'); perform assert_ok(pot_act(mid, 'w1', 'call'), '5d away calls');
  perform pot_as('7'); perform assert_ok(pot_act(mid, 'w1', 'wager', 20), '5e home opens ◎20 more');
  perform assert_eq(pot_bank_of(mid, 1), 150, '5f ◎50 committed');
  perform assert_eq(pot_bank_of(mid, 2), 170, '5g ◎30 committed');

  perform pot_as('8');
  perform assert_ok(pot_act(mid, 'w1', 'fold'), '5h away backs out');
  wp := pot_row(mid, 'w1');
  perform assert_txt(wp.state, 'folded_away', '5i settles immediately — no waiting for the games');
  perform assert_txt(wp.winner, 'home', '5j to the other manager');
  perform assert_eq(pot_bank_of(mid, 2), 190,
    '5k the folder is out EXACTLY the ◎10 ante — every wagered chip came back');
  perform assert_eq(pot_bank_of(mid, 1), 210, '5l the other manager is up exactly ◎10');
  perform assert_true(exists (select 1 from pot_action where matchup_id = mid and game_window = 'w1' and kind = 'fold'),
    '5m the fold is in the audit log');
end $$;

-- ── 5b. folding straight off the ante is the same ◎10 ───────────────────────
do $$
declare mid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('fold2', 200, 200);
  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '5n home leads');
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '5o away matches');
  perform pot_as('7');
  perform assert_ok(pot_act(mid, 'w1', 'fold'), '5p the leader can back out on its own turn');
  perform assert_eq(pot_bank_of(mid, 1), 190, '5q −◎10');
  perform assert_eq(pot_bank_of(mid, 2), 210, '5r +◎10');
end $$;

-- ── 6. table stakes + all-in (one side is nearly broke) ─────────────────────
do $$
declare mid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('stakes', 200, 22);
  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '6a home leads');
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '6b away scrapes the ante together');
  perform assert_eq(pot_bank_of(mid, 2), 12, '6c ◎12 left');

  -- least(my bank 190, their bank 12, side cap 60 − 10 in) = 12.
  perform assert_eq(pot_effective_stack(mid, 'w1', 'home'), 12, '6d the stack is the SHORTER bank');
  perform pot_as('7');
  perform assert_err(pot_act(mid, 'w1', 'wager', 50), 'table stakes', '6e a ◎50 wager simply isn''t offerable');
  perform assert_err(pot_act(mid, 'w1', 'wager', 3), 'minimum wager', '6f min step ◎5 below an all-in');
  perform assert_ok(pot_act(mid, 'w1', 'wager', 12), '6g "all-in ◎12" is legal — not a round number, but it IS the stack');
  perform pot_as('8');
  perform assert_ok(pot_act(mid, 'w1', 'call'), '6h and the shorter stack can cover it exactly');
  perform assert_eq(pot_bank_of(mid, 2), 0, '6i all the way in');
  perform assert_eq((pot_row(mid, 'w1')).away_bet, 12, '6j matched exactly — no side pot');

  -- A broke manager can't open a new offer anywhere either.
  perform assert_err(pot_ante(mid, 'w2'), 'not enough coin', '6k …and can''t afford a second ante');
end $$;

-- ── 7. betting closes the instant PICKS lock ────────────────────────────────
do $$
declare mid uuid; m matchup%rowtype;
begin
  perform pot_as_worker();
  mid := pot_fixture('lock', 200, 200);
  select * into m from matchup where id = mid;
  -- The deadline is literally the pick-lock expression, so the two can't drift.
  perform assert_true(pot_lock_at(mid, 'w1') = window_kickoff(m.week, 'w1') - interval '1 hour',
    '7a the wager deadline IS the pick-lock instant');

  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '7b home leads');
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '7c away matches');
  perform pot_as_worker();
  perform pot_move_kickoff(mid, 'w1', interval '30 minutes');   -- lock_at now 30 min in the past

  -- A move arriving after the deadline is refused AND closes the pot properly,
  -- rather than being allowed through on a stale client poll.
  perform pot_as('7');
  perform assert_err(pot_act(mid, 'w1', 'wager', 20), 'picks are locked', '7d a late move is refused');
  perform assert_txt((pot_row(mid, 'w1')).state, 'locked', '7e …and the pot froze on the spot');

  perform pot_as_worker();
  perform pot_move_kickoff(mid, 'w2', interval '30 minutes');
  perform pot_as('7');
  perform assert_err(pot_ante(mid, 'w2'), 'picks are locked', '7f no new offers past the deadline');
end $$;

-- ── 8. an unanswered wager at the close goes home — silence is never punished ─
do $$
declare mid uuid; wp window_pot%rowtype;
begin
  perform pot_as_worker();
  mid := pot_fixture('unans', 200, 200);
  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '8a home leads');
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '8b away matches');
  perform pot_as('7'); perform assert_ok(pot_act(mid, 'w1', 'wager', 30), '8c home opens ◎30');
  perform assert_eq(pot_bank_of(mid, 1), 160, '8d committed');

  perform pot_as_worker();
  perform pot_move_kickoff(mid, 'w1', interval '30 minutes');
  perform assert_ok(pot_sweep(), '8e sweep at the close');
  wp := pot_row(mid, 'w1');
  perform assert_txt(wp.state, 'locked', '8f frozen, riding to the final');
  perform assert_eq(wp.home_bet, 0, '8g the unmatched ◎30 went home');
  perform assert_eq(wp.home_ante + wp.home_bet + wp.away_ante + wp.away_bet, 20,
    '8h what rides is exactly what BOTH sides put up');
  perform assert_eq(pot_bank_of(mid, 1), 190, '8i letting a wager sit is a legal answer, not a fold');
  perform assert_eq(pot_bank_of(mid, 2), 190, '8j nobody forfeited anything');
  perform assert_true(exists (select 1 from pot_action where matchup_id = mid and game_window = 'w1' and kind = 'refund'),
    '8k the refund is in the audit log');
  perform pot_as('7');
  perform assert_err(pot_act(mid, 'w1', 'wager', 5), 'betting is closed', '8l no more moves, ever');
end $$;

-- ── 9. settlement at the window's final ─────────────────────────────────────
do $$
declare mid uuid; wp window_pot%rowtype; ledger int;
begin
  perform pot_as_worker();
  mid := pot_fixture('settle', 200, 200);
  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '9a home leads');
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '9b away matches');
  perform pot_as('7'); perform assert_ok(pot_act(mid, 'w1', 'wager', 30), '9c home opens ◎30');
  perform pot_as('8'); perform assert_ok(pot_act(mid, 'w1', 'call'), '9d away calls');
  perform assert_eq(pot_bank_of(mid, 1), 160, '9e ◎40 a side committed');

  perform pot_as_worker();
  perform pot_move_kickoff(mid, 'w1', interval '30 minutes');
  perform assert_ok(pot_sweep(), '9f freeze at the close');
  perform assert_txt((pot_row(mid, 'w1')).state, 'locked', '9g frozen');
  perform assert_eq(pot_bank_of(mid, 1), 160, '9h a matched pot rides in full — nothing refunded');

  perform pot_finish(mid, 'w1', 44.5, 31.0);
  perform assert_ok(pot_sweep(), '9i settle');
  wp := pot_row(mid, 'w1');
  perform assert_txt(wp.state, 'settled', '9j settled');
  perform assert_txt(wp.winner, 'home', '9k to the window winner');
  perform assert_eq(pot_bank_of(mid, 1), 240, '9l the winner takes the whole ◎80 pot');
  perform assert_eq(pot_bank_of(mid, 2), 160, '9m coin in, coin out — a pure transfer');

  -- The worker re-resolves every tick and after restarts: replays are no-ops.
  select count(*)::int into ledger from coin_ledger where league_id = pot_league(mid);
  perform pot_sweep(); perform pot_sweep(); perform pot_sweep(mid);
  perform assert_eq((select count(*)::int from coin_ledger where league_id = pot_league(mid)), ledger,
    '9n re-resolving three more times moves no coin');
  perform assert_eq(pot_bank_of(mid, 1), 240, '9o the pot pays the winner exactly once');

  -- The 0025 invariant: sum(ledger deltas) per team == the wallet balance.
  perform assert_true(not exists (
    select 1 from team_wallet w where w.league_id = pot_league(mid)
      and w.coins <> (select coalesce(sum(delta), 0) from coin_ledger l
                      where l.league_id = w.league_id and l.roster_id = w.roster_id)
  ), '9p wallet == ledger sum, still');
end $$;

-- ── 10. a dead-even window hands each side its own chips back ───────────────
do $$
declare mid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('tie', 200, 200, 10, 3, 1);
  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '10a home leads');
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '10b away matches');
  perform pot_as('7'); perform assert_ok(pot_act(mid, 'w1', 'wager', 15), '10c home opens ◎15');
  perform pot_as('8'); perform assert_ok(pot_act(mid, 'w1', 'call'), '10d away calls');

  perform pot_as_worker();
  perform pot_move_kickoff(mid, 'w1', interval '30 minutes');
  perform pot_finish(mid, 'w1', 21.5, 21.5);
  perform assert_ok(pot_sweep(), '10e sweep');
  perform assert_txt((pot_row(mid, 'w1')).state, 'split', '10f DEAD EVEN splits');
  perform assert_eq(pot_bank_of(mid, 1), 200, '10g each side gets its own contribution back');
  perform assert_eq(pot_bank_of(mid, 2), 200, '10h …on both sides');
end $$;

-- ── 11. the empty chair ─────────────────────────────────────────────────────
do $$
declare mid uuid;
begin
  -- AI seat with no bidding personality (v3 retires this restriction).
  perform pot_as_worker();
  mid := pot_fixture('ai', 200, 200, 10, 3, 2, 'ai');
  perform pot_as('7');
  perform assert_err(pot_ante(mid, 'w1'), 'no manager on the other seat',
    '11a refused up front — no ◎10 tied up on an offer that could only ever void');
  perform assert_true(not (pot_state(mid) ->> 'both_live')::boolean, '11b the UI is told why');
  perform assert_eq((select count(*)::int from window_pot where matchup_id = mid), 0, '11c no rows');

  -- Unenrolled no-show human: same rule.
  perform pot_as_worker();
  mid := pot_fixture('noshow', 200, 200, 10, 3, 2, 'human', false);
  perform pot_as('7');
  perform assert_err(pot_ante(mid, 'w1'), 'no manager on the other seat', '11d nobody farms an empty chair');
end $$;

-- ── 12. pot_state is caller-oriented and leaks nothing ──────────────────────
do $$
declare mid uuid; st jsonb;
begin
  perform pot_as_worker();
  mid := pot_fixture('state', 200, 300, 10, 3, 1);
  perform pot_as('8'); perform assert_ok(pot_ante(mid, 'w1'), '12a away leads');
  perform pot_as('7'); perform assert_ok(pot_ante(mid, 'w1'), '12b home matches');
  perform pot_as('8'); perform assert_ok(pot_act(mid, 'w1', 'wager', 25), '12c away opens ◎25');

  perform pot_as('7');
  st := pot_state(mid);
  perform assert_eq((st ->> 'ante')::int, 10, '12d the ante');
  perform assert_eq((st ->> 'cap')::int, 120, '12e the cap');
  perform assert_eq((st ->> 'side_cap')::int, 60, '12f ◎60 a side');
  perform assert_eq((st ->> 'my_bank')::int, 190, '12g my bank');
  perform assert_true((st ->> 'both_live')::boolean, '12h both seats are real managers');
  perform assert_txt(st -> 'windows' -> 0 ->> 'leader', 'them', '12i they led');
  perform assert_txt(st -> 'windows' -> 0 ->> 'turn', 'you', '12j my move');
  perform assert_eq((st -> 'windows' -> 0 ->> 'owed')::int, 25, '12k …and I owe ◎25');
  perform assert_eq((st -> 'windows' -> 0 ->> 'pot')::int, 45, '12l pot ◎45');
  perform assert_eq((st -> 'windows' -> 0 ->> 'you_in')::int, 10, '12m oriented to the caller');
  perform assert_eq((st -> 'windows' -> 0 ->> 'them_in')::int, 35, '12n …on both halves');
  -- Their ◎300 bank is never disclosed; it only shows up as a clamp on the slider.
  perform assert_true(st -> 'windows' -> 0 -> 'log' is not null, '12o the audit log rides along');
  perform assert_true((st ->> 'server_now') is not null, '12p server clock for the countdown');

  perform pot_as('8');
  st := pot_state(mid);
  perform assert_txt(st -> 'windows' -> 0 ->> 'leader', 'you', '12q the same row, flipped');
  perform assert_txt(st -> 'windows' -> 0 ->> 'turn', 'them', '12r …including whose move it is');
  perform assert_eq((st ->> 'my_bank')::int, 265, '12s and my own bank only');

  -- Outsiders see nothing at all.
  perform pot_as('9');
  perform assert_err(pot_state(mid), 'forbidden', '12t a stranger may not read the pot');
  perform assert_err(pot_sweep(mid), 'forbidden', '12u …nor advance it');
  perform assert_err(pot_ante(mid, 'w1'), 'forbidden', '12v …nor join it');
end $$;

-- ── 13. coin in, coin out — a pot is a transfer, never a faucet or a sink ───
do $$
begin
  perform assert_true(not exists (
    select 1 from league lg
    where lg.season = 'potprobe'
      and coalesce((select sum(l.delta) from coin_ledger l
                    where l.league_id = lg.id and l.reason like 'pot:%'), 0)
        + coalesce((select sum(wp.home_ante + wp.home_bet + wp.away_ante + wp.away_bet)
                    from window_pot wp join matchup m on m.id = wp.matchup_id
                    where m.league_id = lg.id and wp.state in ('offered', 'live', 'locked')), 0) <> 0
  ), '13a every league''s pot ledger cancels its open pots exactly');
  perform assert_true(not exists (
    select 1 from coin_ledger where reason like 'pot:%' and idem_key is null
  ), '13b every pot mutation carries an idempotency key');
  perform assert_true(not exists (
    select 1 from team_wallet w join league lg on lg.id = w.league_id
    where lg.season = 'potprobe'
      and w.coins <> (select coalesce(sum(delta), 0) from coin_ledger l
                      where l.league_id = w.league_id and l.roster_id = w.roster_id)
  ), '13c wallet == ledger sum across every fixture');
  perform assert_true(not exists (select 1 from team_wallet where coins < 0),
    '13d no wallet ever goes negative — no debt, anywhere');
end $$;

select 'ALL POT PROBES PASSED' as result;
