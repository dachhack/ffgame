-- 0106 Window Pot probes. Run with ON_ERROR_STOP; every failed assertion raises.
--
-- One probe per scenario in docs/window-pot.md §6 that is in v1 scope
-- (S1–S9, S11–S15), plus the feature-flag-off posture the release ships in.
-- Same style as native-league-probes.sql: build a throwaway fixture, drive the
-- real RPCs, assert on the real tables and the real wallets.
--
-- Every scenario gets its OWN league + matchup + wallets, so each block's
-- coin assertions are absolute rather than cumulative — a broken probe can't
-- cascade into the next one's arithmetic.
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

/** A fresh league + matchup + slate + wallets. Windows are named w1…wN and kick
 *  off p_hours from now, six hours apart, so the blind street is wide open and
 *  the 30-minute last-raise cutoff is comfortably in the future. */
create or replace function pot_fixture(
  p_tag text, p_home_coins int, p_away_coins int,
  p_ante int default 5, p_hours numeric default 3, p_windows int default 2,
  p_away_controller text default 'human', p_away_enrolled boolean default true
) returns uuid language plpgsql as $$
declare lid uuid; mid uuid; sn text; i int;
begin
  sn := 'pp-' || p_tag;
  insert into league (sleeper_league_id, season, name, pot_ante, pot_cap)
    values ('potprobe-' || p_tag, sn, 'Pot ' || p_tag, p_ante, 60) returning id into lid;
  insert into league_membership (league_id, sleeper_roster_id, app_user_id, enrolled, controller, team_name)
    values (lid, 1, '00000000-0000-0000-0000-000000000007', true, 'human', 'Home'),
           (lid, 2, case when p_away_enrolled then '00000000-0000-0000-0000-000000000008'::uuid end,
            p_away_enrolled, p_away_controller, 'Away');
  for i in 1..p_windows loop
    insert into nfl_slate (season, week, home, away, win, kickoff) values
      (sn, 900, 'H' || i, 'A' || i, 'w' || i,
       now() + make_interval(mins => (p_hours * 60)::int + (i - 1) * 360));
  end loop;
  insert into matchup (league_id, week, home_roster_id, away_roster_id, status, lock_at)
    values (lid, 900, 1, 2, 'live', now()) returning id into mid;
  -- Seed through credit_wallet, not a raw insert, so the 0025 invariant
  -- (sum(coin_ledger.delta) per team == team_wallet.coins) holds from the start
  -- and probe 12m can assert the pot never breaks it.
  perform credit_wallet(lid, 1, null, null, p_home_coins, 'seed');
  perform credit_wallet(lid, 2, null, null, p_away_coins, 'seed');
  return mid;
end $$;

/** Mark a window's games FINAL (the 0103 explicit state) and publish the resolve
 *  pass's per-window scores — the same matchup_state rows the +5 window bonus is
 *  paid off, which is what settlement reads. */
create or replace function pot_finish(p_mid uuid, p_win text, p_home numeric, p_away numeric)
  returns void language plpgsql as $$
declare m matchup%rowtype; lg league%rowtype; s record;
begin
  select * into m from matchup where id = p_mid;
  select * into lg from league where id = m.league_id;
  for s in select * from nfl_slate where season = lg.season and week = m.week and win = p_win loop
    insert into game_feed (week, game_id, key, away, home, state)
      values (m.week, lg.season || ':' || s.home, s.away || '@' || s.home, s.away, s.home, 'post')
      on conflict (week, game_id) do update set state = 'post';
  end loop;
  insert into matchup_state (matchup_id, game_window, home_score, away_score)
    values (p_mid, p_win, p_home, p_away)
    on conflict (matchup_id, game_window) do update set home_score = p_home, away_score = p_away;
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
/** Force a window's kickoff into the past — the street's hard close (S9). */
create or replace function pot_force_kickoff(p_mid uuid, p_win text, p_offset interval)
  returns void language plpgsql as $$
declare m matchup%rowtype; lg league%rowtype;
begin
  select * into m from matchup where id = p_mid;
  select * into lg from league where id = m.league_id;
  update nfl_slate set kickoff = now() + p_offset
    where season = lg.season and week = m.week and win = p_win;
end $$;

-- ── 0. feature OFF is the shipping default ───────────────────────────────────
-- The definition of done: a league with pot_ante = 0 sees no trace of any of it.
do $$
declare mid uuid; r jsonb;
begin
  perform pot_as_worker();
  mid := pot_fixture('off', 200, 200, 0);
  perform assert_true((select pot_ante from league where id = pot_league(mid)) = 0, '0a default league ships with pot_ante 0');
  r := pot_ante_all(mid);
  perform assert_ok(r, '0b ante pass runs');
  perform assert_true((r ->> 'off')::boolean, '0c ante pass reports the feature off');
  perform assert_eq((select count(*)::int from window_pot where matchup_id = mid), 0, '0d no pot rows exist at all');
  perform assert_eq((select count(*)::int from coin_ledger
                     where league_id = pot_league(mid) and reason like 'pot:%'), 0, '0e no coin moved');
  perform pot_as('7');
  r := pot_state(mid);
  perform assert_true((r ->> 'off')::boolean, '0f pot_state reports off');
  perform assert_err(pot_raise(mid, 'w1', 5), 'pots are off', '0g raising refused');
  perform assert_err(pot_respond(mid, 'w1', 'call'), 'pots are off', '0h responding refused');
end $$;

-- Every league in the DB (including the ones the native-league probes built)
-- must be flag-OFF unless a probe turned it on: this is the ships-off contract.
do $$
begin
  perform assert_eq((select count(*)::int from league where pot_ante <> 0 and season not like 'pp-%'), 0,
    '0i no pre-existing league gets a pot by accident');
end $$;

-- ── 1. S1 · nobody does anything (the default week) ──────────────────────────
do $$
declare mid uuid; r jsonb; wp window_pot%rowtype; ledger int;
begin
  perform pot_as_worker();
  mid := pot_fixture('s1', 200, 200);
  r := pot_ante_all(mid);
  perform assert_ok(r, '1a ante pass');
  perform assert_eq((r ->> 'pots')::int, 2, '1b one pot per window');
  wp := pot_row(mid, 'w1');
  perform assert_eq(wp.home_in, 5, '1c home anted 5');
  perform assert_eq(wp.away_in, 5, '1d away anted 5');
  perform assert_true(wp.state = 'open' and wp.street = 'blind', '1e opens on the blind street');
  perform assert_eq(pot_bank_of(mid, 1), 190, '1f ante is DEBITED at commit time (both windows)');
  perform assert_eq(pot_bank_of(mid, 2), 190, '1g …on both sides');

  -- home takes the window 40–35 → winner banks the whole ◎10 pot (net +5).
  perform pot_finish(mid, 'w1', 40, 35);
  perform assert_ok(pot_sweep(), '1h sweep');
  wp := pot_row(mid, 'w1');
  perform assert_true(wp.state = 'settled' and wp.winner = 'home', '1i settled to the window winner');
  perform assert_eq(pot_bank_of(mid, 1), 200, '1j winner +10 (net +5 on the window)');
  perform assert_eq(pot_bank_of(mid, 2), 190, '1k loser is out its ante only');

  -- S12 · a dead-even window splits it back: each side gets its own chips.
  perform pot_finish(mid, 'w2', 20, 20);
  perform assert_ok(pot_sweep(), '1l sweep the tie');
  wp := pot_row(mid, 'w2');
  perform assert_true(wp.state = 'split' and wp.winner = 'split', '1m tie is a split');
  perform assert_eq(pot_bank_of(mid, 1), 205, '1n tie returns each side its own contribution');
  perform assert_eq(pot_bank_of(mid, 2), 195, '1o …on both sides');

  -- S13 · the worker re-resolves every tick and after restarts: replays are no-ops.
  select count(*)::int into ledger from coin_ledger where league_id = pot_league(mid);
  perform pot_sweep(); perform pot_sweep(); perform pot_ante_all(mid);
  perform assert_eq((select count(*)::int from coin_ledger where league_id = pot_league(mid)), ledger,
    '1p re-sweeps and a re-lock ante pass move no coin');
  perform assert_eq(pot_bank_of(mid, 1), 205, '1q balances unmoved by the replay');
  perform assert_eq(pot_bank_of(mid, 2), 195, '1r …on both sides');
end $$;

-- ── 2. S2/S3 · the bluff, and what's in the pot when someone folds mid-raise ──
do $$
declare mid uuid; wp window_pot%rowtype; r jsonb;
begin
  perform pot_as_worker();
  mid := pot_fixture('s3', 200, 200, 5, 3, 1);
  perform assert_ok(pot_ante_all(mid), '2a ante pass');

  perform pot_as('7');
  r := pot_raise(mid, 'w1', 15);
  perform assert_ok(r, '2b home raises 15 on the blind street');
  perform assert_true(not (r ->> 'auto_called')::boolean, '2c 15 is past the default ◎10 policy → clock, not auto-call');
  wp := pot_row(mid, 'w1');
  perform assert_eq(wp.home_in, 20, '2d the raise is committed money — debited at once');
  perform assert_eq(pot_bank_of(mid, 1), 180, '2e …and gone from the bank');
  perform assert_true(wp.raise_by = 'home' and wp.raise_amount = 15, '2f raise is pending');
  perform assert_true(wp.raise_deadline is not null, '2g response clock started');

  -- The raiser may not answer their own raise, and the responder may not raise
  -- around it (S8 — that comes back as a re-raise confirmation instead).
  perform assert_err(pot_respond(mid, 'w1', 'call'), 'that raise is yours', '2h raiser can''t call themselves');
  perform pot_as('8');
  r := pot_raise(mid, 'w1', 10);
  perform assert_err(r, 'pot changed', '2i S8 — a raise into a changed pot comes back to its author');
  perform assert_true((r ->> 're_raise')::boolean, '2j …flagged as a re-raise to confirm');

  -- B folds. S3: B loses only its MATCHED contribution (the ante); A's uncalled
  -- ◎15 returns to A, who takes the two antes. A nets +5, B nets −5.
  perform assert_ok(pot_respond(mid, 'w1', 'fold'), '2k away folds');
  wp := pot_row(mid, 'w1');
  perform assert_true(wp.state = 'folded_away' and wp.winner = 'home', '2l fold settles immediately');
  perform assert_true(wp.settled_at is not null, '2m …no waiting for the window to finish');
  perform assert_eq(pot_bank_of(mid, 1), 205, '2n S3 — uncalled raise returned; raiser nets +5');
  perform assert_eq(pot_bank_of(mid, 2), 195, '2o S3 — a fold costs the folder exactly its matched chips (−5)');
  perform assert_true(exists (select 1 from pot_action where matchup_id = mid and game_window = 'w1' and kind = 'fold'),
    '2p the fold is in the audit log');
end $$;

-- ── 3. S4 · auto-call, exactly on the line (policy is a per-WINDOW allowance) ─
do $$
declare mid uuid; wp window_pot%rowtype; r jsonb; lid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('s4', 200, 200);
  lid := pot_league(mid);
  perform assert_ok(pot_ante_all(mid), '3a ante pass');

  perform pot_as('8');
  perform assert_ok(set_pot_auto_call(lid, 10), '3b away sets a ◎10 standing policy');

  perform pot_as('7');
  r := pot_raise(mid, 'w1', 10);
  perform assert_ok(r, '3c home raises exactly on the line');
  perform assert_true((r ->> 'auto_called')::boolean, '3d covered by policy → instant auto-call');
  wp := pot_row(mid, 'w1');
  perform assert_eq(wp.home_in + wp.away_in, 30, '3e pot ◎30, symmetric');
  perform assert_eq(wp.away_policy_used, 10, '3f allowance spent');
  perform assert_true(wp.raise_by is null, '3g nothing pending — it felt live while they slept');

  r := pot_raise(mid, 'w1', 10);
  perform assert_ok(r, '3h second raise on the same street is allowed');
  perform assert_true(not (r ->> 'auto_called')::boolean,
    '3i S4 — the allowance is per WINDOW, so two ◎10 raises can''t sneak past a ◎10 intent');
  wp := pot_row(mid, 'w1');
  perform assert_true(wp.raise_by = 'home' and wp.raise_amount = 10, '3j clock runs on the second');

  perform pot_as('8');
  perform assert_ok(pot_respond(mid, 'w1', 'call'), '3k away calls by hand');
  wp := pot_row(mid, 'w1');
  perform assert_eq(wp.home_in + wp.away_in, 50, '3l pot ◎50');
  perform assert_eq(wp.away_policy_used, 10, '3m a manual call does NOT spend policy allowance');

  -- §2: max two raises per side per street.
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 5), 'raise limit', '3n third raise refused');
end $$;

-- ── 4. S5 · expired clock → auto-fold ────────────────────────────────────────
do $$
declare mid uuid; wp window_pot%rowtype;
begin
  perform pot_as_worker();
  mid := pot_fixture('s5', 200, 200, 5, 3, 1);
  perform assert_ok(pot_ante_all(mid), '4a ante pass');
  perform pot_as('7');
  perform assert_ok(pot_raise(mid, 'w1', 20), '4b home raises 20, past the ◎10 default policy');
  perform assert_eq(pot_bank_of(mid, 1), 175, '4c committed at once');

  -- Sleep through it: the quiet-hours-aware clock runs out unanswered.
  update window_pot set raise_deadline = now() - interval '1 minute'
    where matchup_id = mid and game_window = 'w1';
  perform pot_as_worker();
  perform assert_ok(pot_sweep(), '4d sweep expires the clock');
  wp := pot_row(mid, 'w1');
  perform assert_true(wp.state = 'folded_away' and wp.winner = 'home', '4e S5 — silence is an auto-fold');
  perform assert_true(exists (select 1 from pot_action where matchup_id = mid and game_window = 'w1' and kind = 'auto_fold'),
    '4f auto-fold is in the audit log');
  perform assert_eq(pot_bank_of(mid, 1), 205, '4g the unanswered ◎20 returns; the raiser takes the matched pot');
  perform assert_eq(pot_bank_of(mid, 2), 195,
    '4h S3''s refund rule caps sleeping through it at the already-matched ◎5');
end $$;

-- ── 5. S6 · all-in, table stakes (one side is nearly broke) ──────────────────
do $$
declare mid uuid; r jsonb;
begin
  perform pot_as_worker();
  mid := pot_fixture('s6', 200, 22);
  perform assert_ok(pot_ante_all(mid), '5a ante pass');
  perform assert_eq(pot_bank_of(mid, 2), 12, '5b away is down to ◎12 after two antes');

  -- least(my bank 190, their bank 12, side cap 30 − 5 in) = 12.
  perform assert_eq(pot_effective_stack(mid, 'w1', 'home'), 12, '5c effective stack is the SHORTER stack');
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 50), 'table stakes', '5d a ◎50 raise simply isn''t offerable');
  perform assert_err(pot_raise(mid, 'w2', 3), 'minimum raise', '5e min step ◎5 below an all-in');
  r := pot_raise(mid, 'w1', 12);
  perform assert_ok(r, '5f "raise all-in ◎12" is legal — not a multiple of 5, but it IS the stack');
  perform assert_eq((pot_row(mid, 'w1')).home_in, 17, '5g committed');

  -- No side pots, ever: away can match all-in exactly.
  perform pot_as('8');
  perform assert_ok(pot_respond(mid, 'w1', 'call'), '5h away calls all-in');
  perform assert_eq(pot_bank_of(mid, 2), 0, '5i shorter stack is all the way in');
  perform assert_eq((pot_row(mid, 'w1')).away_in, 17, '5j matched exactly, no side pot');
  perform assert_eq(pot_effective_stack(mid, 'w1', 'home'), 0, '5k nothing more is offerable');
end $$;

-- ── 6. S6b · the pot cap holds ───────────────────────────────────────────────
do $$
declare mid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('s6b', 400, 400);
  perform assert_ok(pot_ante_all(mid), '6a ante pass');
  -- pot_cap 60 ⇒ ◎30 a side; the ◎5 ante is already in.
  perform assert_eq(pot_effective_stack(mid, 'w1', 'home'), 25, '6b cap term bites before the banks do');
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 26), 'table stakes', '6c a raise past the cap is refused');
  perform assert_ok(pot_raise(mid, 'w1', 25), '6d a raise to the cap is fine');
  perform pot_as('8');
  perform assert_ok(pot_respond(mid, 'w1', 'call'), '6e called');
  perform assert_eq((pot_row(mid, 'w1')).home_in + (pot_row(mid, 'w1')).away_in, 60, '6f pot maxes at the league cap');
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 5), 'table stakes', '6g capped pot offers no raise');
end $$;

-- ── 7. S7 · can't afford the ante → short ante ───────────────────────────────
do $$
declare mid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('s7', 200, 3);
  perform assert_ok(pot_ante_all(mid), '7a ante pass');
  perform assert_eq((pot_row(mid, 'w1')).away_in, 3, '7b S7 — you ante what you have');
  perform assert_eq((pot_row(mid, 'w1')).home_in, 5, '7c the pot is asymmetric, not skipped');
  perform assert_eq((pot_row(mid, 'w2')).away_in, 0, '7d ◎0 is a legal ante');
  perform assert_eq(pot_bank_of(mid, 2), 0, '7e no debt, no negative wallet');

  -- A broke manager can check or fold, but never raise; nor can anyone raise AT
  -- them, because table stakes clamps to their (empty) bank.
  perform pot_as('8');
  perform assert_err(pot_raise(mid, 'w1', 5), 'table stakes', '7f poverty is survivable, never advantageous');
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 5), 'table stakes', '7g …and never farmable');

  -- Away WINS w1: it takes only matched coin (◎3 of home's ◎5); home's unmatched
  -- ◎2 returns. Home wins w2, where nothing was matched at all — so home simply
  -- gets its own ante back and away's ◎0 stake costs it nothing.
  perform pot_as_worker();
  perform pot_finish(mid, 'w1', 10, 20);
  perform pot_finish(mid, 'w2', 30, 10);
  perform assert_ok(pot_sweep(), '7h sweep');
  perform assert_eq(pot_bank_of(mid, 2), 6, '7i the short side takes only what it matched');
  perform assert_eq(pot_bank_of(mid, 1), 197, '7j the unmatched half of an ante always returns');
end $$;

-- ── 8. S12 · a tie on an ASYMMETRIC (short-ante) pot returns own contributions ─
do $$
declare mid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('s12', 200, 3, 5, 3, 1);
  perform assert_ok(pot_ante_all(mid), '8a ante pass');
  perform pot_finish(mid, 'w1', 21, 21);
  perform assert_ok(pot_sweep(), '8b sweep the dead-even window');
  perform assert_true((pot_row(mid, 'w1')).winner = 'split', '8c DEAD EVEN splits');
  perform assert_eq(pot_bank_of(mid, 1), 200, '8d each side gets its own contribution back');
  perform assert_eq(pot_bank_of(mid, 2), 3, '8e …including the short side');
end $$;

-- ── 9. S9 · a raise pending when the street hard-closes ──────────────────────
-- Forced resolution AT the close, so a blind-street raise can never be answered
-- with post-reveal information.
do $$
declare mid uuid; wp window_pot%rowtype;
begin
  -- 9a: policy does NOT cover it at the close → auto-fold per S5/S3.
  perform pot_as_worker();
  mid := pot_fixture('s9a', 200, 200, 5, 3, 1);
  perform assert_ok(pot_ante_all(mid), '9a ante pass');
  perform pot_as('7');
  perform assert_ok(pot_raise(mid, 'w1', 20), '9b raise 40 min out — legal, before the cutoff');
  perform assert_true((pot_row(mid, 'w1')).raise_deadline is not null, '9c clock would run past kickoff');
  perform pot_as_worker();
  perform pot_force_kickoff(mid, 'w1', interval '-1 minute');   -- the street hard-closes
  perform assert_ok(pot_sweep(), '9d sweep at the close');
  wp := pot_row(mid, 'w1');
  perform assert_true(wp.state = 'folded_away', '9e S9 — the close forces resolution: auto-fold');
  perform assert_true(wp.street = 'closed', '9f street closed');
  perform assert_eq(pot_bank_of(mid, 1), 205, '9g uncalled raise returned');

  -- 9h: policy DOES cover it by the close → auto-call, and the pot rides to the final.
  mid := pot_fixture('s9b', 200, 200);
  perform assert_ok(pot_ante_all(mid), '9h ante pass');
  perform pot_as('7');
  perform assert_ok(pot_raise(mid, 'w1', 20), '9i raise past the ◎10 default → clock');
  perform pot_as('8');
  perform assert_ok(set_pot_auto_call(pot_league(mid), 25), '9j away raises its standing policy');
  perform pot_as_worker();
  perform pot_force_kickoff(mid, 'w1', interval '-1 minute');
  perform assert_ok(pot_sweep(), '9k sweep at the close');
  wp := pot_row(mid, 'w1');
  perform assert_true(wp.state = 'open' and wp.raise_by is null, '9l S9 — policy covers it → auto-call at the close');
  perform assert_eq(wp.away_in, 25, '9m away matched');
  perform assert_true(wp.street = 'closed', '9n betting on the window is over');
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 5), 'closed', '9o …and stays over');
end $$;

-- ── 10. §3 · the last-raise cutoff ───────────────────────────────────────────
do $$
declare mid uuid; r jsonb;
begin
  perform pot_as_worker();
  mid := pot_fixture('cut', 200, 200, 5, 0.25);   -- kickoff in 15 min: inside the cutoff
  perform assert_ok(pot_ante_all(mid), '10a ante pass');
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 20), 'last-raise cutoff',
    '10b a raise the opponent can''t realistically answer is structurally impossible');
  r := pot_raise(mid, 'w1', 10);
  perform assert_ok(r, '10c …unless the standing policy already covers it');
  perform assert_true((r ->> 'auto_called')::boolean, '10d which means it resolves instantly');
end $$;

-- ── 11. S11 · the empty chair ────────────────────────────────────────────────
do $$
declare mid uuid;
begin
  -- AI seat with no bidding personality (v3 retires this restriction).
  perform pot_as_worker();
  mid := pot_fixture('s11a', 200, 200, 5, 3, 2, 'ai');
  perform assert_ok(pot_ante_all(mid), '11a ante pass runs against an AI seat');
  perform assert_eq((pot_row(mid, 'w1')).home_in, 5, '11b pots exist — the ambient stakes stay');
  perform assert_eq((pot_row(mid, 'w1')).away_in, 5, '11c the AI seat antes from its own wallet');
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 10), 'ante only', '11d but you cannot farm an empty chair');
  perform assert_true(not (pot_state(mid) ->> 'both_live')::boolean, '11e the UI is told it''s ante-only');

  -- Unenrolled no-show human: same rule.
  perform pot_as_worker();
  mid := pot_fixture('s11b', 200, 200, 5, 3, 2, 'human', false);
  perform assert_ok(pot_ante_all(mid), '11f ante pass runs against a no-show');
  perform assert_eq((pot_row(mid, 'w1')).away_in, 5, '11g the seat still antes');
  perform pot_as('7');
  perform assert_err(pot_raise(mid, 'w1', 10), 'ante only', '11h raising stays disabled');
end $$;

-- ── 12. S13 · replays, restarts, and the wallet ledger invariant ─────────────
do $$
declare mid uuid; before int;
begin
  perform pot_as_worker();
  mid := pot_fixture('s13', 200, 200);
  perform assert_ok(pot_ante_all(mid), '12a ante pass');
  perform assert_ok(pot_ante_all(mid), '12b a re-lock is a no-op');
  perform assert_ok(pot_ante_all(mid), '12c …however many times it runs');
  perform assert_eq((pot_row(mid, 'w1')).home_in, 5, '12d anted exactly once');
  perform assert_eq(pot_bank_of(mid, 1), 190, '12e charged exactly once');

  perform pot_as('7');
  perform assert_ok(pot_raise(mid, 'w1', 15), '12f raise');
  perform pot_as('8');
  perform assert_ok(pot_respond(mid, 'w1', 'call'), '12g call');
  perform pot_as_worker();
  perform pot_finish(mid, 'w1', 50, 30);
  perform assert_ok(pot_sweep(mid), '12h settle');
  perform assert_eq(pot_bank_of(mid, 1), 215, '12i winner takes the ◎40 pot');
  perform assert_eq(pot_bank_of(mid, 2), 175, '12j loser is out its matched ◎20');

  select count(*)::int into before from coin_ledger where league_id = pot_league(mid);
  perform pot_sweep(mid); perform pot_sweep(mid); perform pot_sweep();
  perform assert_eq((select count(*)::int from coin_ledger where league_id = pot_league(mid)), before,
    '12k re-resolving twice more pays nothing');
  perform assert_eq(pot_bank_of(mid, 1), 215, '12l …the pot pays the winner exactly once');

  -- The 0025 invariant: sum(ledger deltas) per team == the wallet balance.
  perform assert_true(not exists (
    select 1 from team_wallet w where w.league_id = pot_league(mid)
      and w.coins <> (select coalesce(sum(delta), 0) from coin_ledger l
                      where l.league_id = w.league_id and l.roster_id = w.roster_id)
  ), '12m wallet == ledger sum, still');
end $$;

-- ── 13. S14 · mulligan'd / edited lineups don't touch the pot ────────────────
do $$
declare mid uuid; before window_pot%rowtype;
begin
  perform pot_as_worker();
  mid := pot_fixture('s14', 200, 200);
  perform assert_ok(pot_ante_all(mid), '13a ante pass');
  before := pot_row(mid, 'w1');
  insert into sealed_pick (matchup_id, app_user_id, game_window, roster_slot, player_slug, metric_id, locked)
    values (mid, '00000000-0000-0000-0000-000000000007', 'w1', 'A', 'probe-player', 'rush', false);
  update sealed_pick set player_slug = 'probe-player-2'
    where matchup_id = mid and game_window = 'w1' and roster_slot = 'A';
  delete from sealed_pick where matchup_id = mid and game_window = 'w1' and roster_slot = 'A';
  perform assert_true(pot_row(mid, 'w1') = before,
    '13b S14 — you bet on the WINDOW, not on a slot: nothing to reconcile');
end $$;

-- ── 14. S15 · preseason, one-window weeks ────────────────────────────────────
-- The mechanic's smallest honest form, and the Aug 13 live-fire shape.
do $$
declare mid uuid; st jsonb;
begin
  perform pot_as_worker();
  mid := pot_fixture('s15', 200, 200, 5, 3, 1);
  perform assert_ok(pot_ante_all(mid), '14a ante pass at n=1 window');
  perform assert_eq((select count(*)::int from window_pot where matchup_id = mid), 1, '14b a single pot');
  perform assert_eq(pot_bank_of(mid, 1), 195, '14c the ante is a single ◎5');

  perform pot_as('7');
  st := pot_state(mid);
  perform assert_true(not (st ->> 'off')::boolean, '14d pot_state is live');
  perform assert_eq((st ->> 'my_bank')::int, 195, '14e my bank');
  perform assert_eq((st ->> 'my_auto_call')::int, 10, '14f the ◎10 default policy');
  perform assert_true((st ->> 'both_live')::boolean, '14g both seats are real managers');
  perform assert_eq((st -> 'windows' -> 0 ->> 'pot')::int, 10, '14h pot ◎10');
  perform assert_eq((st -> 'windows' -> 0 ->> 'you_in')::int, 5, '14i oriented to the caller');
  perform assert_eq((st -> 'windows' -> 0 ->> 'effective_stack')::int, 25, '14j slider max');
  perform assert_eq((st -> 'windows' -> 0 ->> 'raises_left')::int, 2, '14k two raises a street');

  perform assert_ok(pot_raise(mid, 'w1', 15), '14l raise');
  perform pot_as('8');
  st := pot_state(mid);
  perform assert_true(st -> 'windows' -> 0 -> 'pending' ->> 'by' = 'them', '14m the opponent sees a raise on THEM');
  perform assert_eq((st -> 'windows' -> 0 -> 'pending' ->> 'amount')::int, 15, '14n …for the right amount');
  perform assert_ok(pot_respond(mid, 'w1', 'call'), '14o call it');
  perform pot_as_worker();
  perform pot_finish(mid, 'w1', 12, 40);
  perform assert_ok(pot_sweep(), '14p settle');
  perform assert_eq(pot_bank_of(mid, 2), 220, '14q the away side takes the ◎40 pot');
  perform assert_eq(pot_bank_of(mid, 1), 180, '14r coin in, coin out — a pure transfer');
end $$;

-- ── 15. the hidden number stays hidden ───────────────────────────────────────
do $$
declare mid uuid; lid uuid;
begin
  perform pot_as_worker();
  mid := pot_fixture('hide', 200, 200);
  lid := pot_league(mid);
  perform assert_ok(pot_ante_all(mid), '15a ante pass');
  perform pot_as('7'); perform assert_ok(set_pot_auto_call(lid, 20), '15b home sets ◎20');
  perform pot_as('8'); perform assert_ok(set_pot_auto_call(lid, 5), '15c away sets ◎5');
  perform pot_as('7');
  perform assert_eq((pot_state(mid) ->> 'my_auto_call')::int, 20, '15d each side sees only its own number');
  perform pot_as('8');
  perform assert_eq((pot_state(mid) ->> 'my_auto_call')::int, 5, '15e …and never the opponent''s');
  -- pot_policy is RLS-on with no select policy: unreadable at rest by anyone.
  perform assert_true((select relrowsecurity from pg_class where relname = 'pot_policy'), '15f RLS on');
  perform assert_eq((select count(*)::int from pg_policies where tablename = 'pot_policy'), 0,
    '15g …with no read policy at all — hidden at rest');
  -- A non-participant can't read the pot either.
  perform assert_true((pot_state(mid) ->> 'ok')::boolean, '15h participants may read the pot');
  perform pot_as('9');   -- a signed-in stranger (not a member, not an admin)
  perform assert_err(pot_state(mid), 'forbidden', '15i outsiders may not');
  perform assert_err(pot_sweep(mid), 'forbidden', '15j …nor advance it');
end $$;

-- ── 16. coin in, coin out — pots are a zero-sum transfer, never a faucet ─────
do $$
begin
  -- Pots are a pure transfer between two wallets: no faucet, no sink. Every coin
  -- a pot ledger debited is either back in a wallet or still sitting in an OPEN
  -- pot, so the two always cancel exactly.
  perform assert_true(not exists (
    select 1 from league lg
    where lg.season like 'pp-%'
      and coalesce((select sum(l.delta) from coin_ledger l
                    where l.league_id = lg.id and l.reason like 'pot:%'), 0)
        + coalesce((select sum(wp.home_in + wp.away_in) from window_pot wp
                    join matchup m on m.id = wp.matchup_id
                    where m.league_id = lg.id and wp.state = 'open'), 0) <> 0
  ), '16a coin in = coin out — every league''s pot ledger cancels its open pots exactly');
  perform assert_true(not exists (
    select 1 from coin_ledger where reason like 'pot:%' and idem_key is null
  ), '16b every pot mutation carries an idempotency key');
end $$;

select 'ALL POT PROBES PASSED' as result;
