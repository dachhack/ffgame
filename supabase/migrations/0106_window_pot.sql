-- 0106: THE WINDOW POT v1 — an OPT-IN wager ladder on any game window.
--
-- Two managers, one game window, one pool of drip-coin. Nothing is automatic:
-- a pot only exists because somebody put ◎10 on the table and the other side
-- picked it up. Spec: docs/window-pot.md — §6's scenarios are the acceptance
-- criteria and are asserted one-for-one in scripts/db/window-pot-probes.sql.
--
-- THE SHAPE
--   1. Either manager ANTES ◎10 on a window. That's the offer; nothing else is
--      possible until it's answered.
--   2. The other manager MATCHES the ◎10 (or ignores it — at picks lock an
--      unmatched offer voids and the ante goes home; no contest, no winner).
--   3. The player who LED the ante gets first action. On your turn you may
--      CHECK (pass), WAGER ◎N, or FOLD. Facing a wager you may CALL, RAISE
--      (call + open), or FOLD. Turn passes on every action. Rinse and repeat.
--   4. Betting closes the instant that window's PICKS lock — kickoff − 1h, the
--      exact expression enforce_window_lock (0102) uses, so the two can never
--      drift apart. At the close any unmatched chips go home and the pot is
--      frozen; it rides to the window's final and pays the winner.
--
-- BACKING OUT COSTS EXACTLY THE ANTE. A fold hands the folder's ◎10 to the
-- other manager and returns every wagered chip to whoever bet it, however deep
-- the ladder went. So a wager is only truly at risk AFTER picks lock: before
-- then the ladder is a commitment ratchet, not a bluff-caller, and the live
-- question is "will you still be here at lock?" rather than "are you bluffing?"
-- (Founder's explicit call, 2026-08-08, over the poker-standard alternative of
-- forfeiting everything you had matched.)
--
-- WHAT ISN'T HERE, BY DESIGN
--   • No automatic ante. A league that never taps has no pots and no rows.
--   • No standing auto-call policy and no response clocks. Every move is a
--     deliberate tap; the only deadline is picks lock, and letting a wager sit
--     unanswered simply returns it — silence is never punished.
--   • No reveal/live streets. Betting is over before a single pick is revealed,
--     so the whole ladder is played blind, which is the point.
--
-- SHIPS OFF. `league.pot_ante` defaults to 0, which disables the feature end to
-- end: pot_ante refuses, pot_state returns `off`, and the client renders no
-- trace. Flip it per league by hand:
--   update league set pot_ante = 10 where id = '…';
--
-- HARD GUARDRAIL — coin in, coin out. A pot moves drip-coin between two team
-- wallets and nothing else: never points, never roster advantage. The +5
-- window-win POINTS bonus is untouched and independent.
--
-- Concurrency + replay: every mutation takes the per-matchup advisory xact lock
-- (the same serialization as draft picks), and the strict turn field means two
-- managers racing the same pot can't both act — the loser of the race finds the
-- turn already passed. Every wallet move carries an idempotency key, so the
-- worker's 25s sweep and its restarts replay as no-ops. Debits key off the
-- action seq (each is a distinct action); the payouts key off the CAUSE with no
-- seq — they are terminal and once-per-pot, and a seq-bearing key would
-- double-pay if a replay ever allocated a fresh seq.
--
-- DB is the authority: the deadline, the turn, the effective stack and the
-- empty-chair rule are all checked inside the RPCs, never inferred from how
-- often the sweep happens to run.

-- ─────────────────────────────────────────────────────────────────────────────
-- Feature flag + league tunables
-- ─────────────────────────────────────────────────────────────────────────────

-- The ante, which doubles as the feature flag: 0 = OFF (the shipping default),
-- 10 = the spec's entry fee.
alter table league add column if not exists pot_ante int not null default 0
  check (pot_ante >= 0 and pot_ante <= 100);
-- Ceiling on one window's pot; each side may commit at most half (◎60), of
-- which the ante is the first ◎10.
alter table league add column if not exists pot_cap int not null default 120
  check (pot_cap >= 0 and pot_cap <= 1000);

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

-- A row exists only because someone anted. Absolute (home/away), not
-- caller-relative; pot_state orients it as you/them.
create table if not exists window_pot (
  matchup_id  uuid not null references matchup(id) on delete cascade,
  game_window text not null,
  -- Who put the first ◎10 down. They also get first action once it's matched.
  leader      text not null check (leader in ('home', 'away')),
  -- The entry fee, tracked apart from wagers because a fold forfeits ONLY this.
  home_ante   int  not null default 0,
  away_ante   int  not null default 0,
  -- Everything wagered on top. Always returns to its owner on a fold.
  home_bet    int  not null default 0,
  away_bet    int  not null default 0,
  state       text not null default 'offered' check (state in (
                'offered',      -- one ante down, waiting for the other side
                'live',         -- both in; the ladder is open
                'locked',       -- picks locked; frozen, riding to the final
                'void',         -- never matched; the ante went home
                'folded_home', 'folded_away',
                'settled', 'split')),
  -- Whose action it is. Null unless the pot is live.
  turn        text check (turn in ('home', 'away')),
  -- The outstanding wager the turn-holder must answer (0 = nothing owed, so
  -- they may check or open).
  owed        int  not null default 0,
  seq         int  not null default 0,   -- action counter → debit idem keys
  winner      text check (winner in ('home', 'away', 'split')),
  settled_at  timestamptz,
  updated_at  timestamptz not null default now(),
  primary key (matchup_id, game_window)
);
-- The sweep only ever scans pots that can still move.
create index if not exists window_pot_active on window_pot(state)
  where state in ('offered', 'live', 'locked');

-- Append-only audit of every move — the log the UI renders as "They wagered
-- ◎15 on SNF". roster_id is the wallet that moved.
create table if not exists pot_action (
  id          bigint generated always as identity primary key,
  matchup_id  uuid not null references matchup(id) on delete cascade,
  game_window text not null,
  seq         int  not null,
  side        text check (side in ('home', 'away')),
  roster_id   int,
  app_user_id uuid references app_user(id) on delete set null,
  kind        text not null check (kind in
                ('ante', 'match', 'check', 'wager', 'call', 'fold', 'settle', 'refund', 'void')),
  amount      int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (matchup_id, game_window, seq)
);
create index if not exists pot_action_pot on pot_action(matchup_id, game_window, seq);

alter table window_pot enable row level security;
alter table pot_action enable row level security;

drop policy if exists window_pot_read on window_pot;
create policy window_pot_read on window_pot for select using (is_matchup_participant(matchup_id));
drop policy if exists pot_action_read on pot_action;
create policy pot_action_read on pot_action for select using (is_matchup_participant(matchup_id));
-- No write policies anywhere: every mutation goes through the RPCs below.

-- ─────────────────────────────────────────────────────────────────────────────
-- Constants (functions so the probes and the client read the same numbers)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pot_min_wager() returns int language sql immutable as $$ select 5 $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Read helpers
-- ─────────────────────────────────────────────────────────────────────────────

/** A side's banked coin, floored to whole coin (pots are integral). */
create or replace function pot_bank(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select greatest(0, floor(coalesce(
    (select w.coins from team_wallet w where w.league_id = p_league_id and w.roster_id = p_roster_id), 0)))::int;
$$;

create or replace function pot_roster(p_m matchup, p_side text) returns int
  language sql immutable as $$
  select case when p_side = 'home' then p_m.home_roster_id else p_m.away_roster_id end;
$$;

create or replace function pot_other(p_side text) returns text
  language sql immutable as $$ select case when p_side = 'home' then 'away' else 'home' end; $$;

/** The caller's side of a matchup, or null when they aren't a participant. */
create or replace function pot_my_side(p_m matchup) returns text
  language sql stable security definer set search_path = public as $$
  select case when lm.sleeper_roster_id = p_m.home_roster_id then 'home' else 'away' end
  from league_membership lm
  where lm.league_id = p_m.league_id and lm.app_user_id = auth.uid() and lm.enrolled
    and lm.sleeper_roster_id in (p_m.home_roster_id, p_m.away_roster_id)
  limit 1;
$$;

/** Wagering needs a real manager on BOTH seats. An AI seat (no bidding
 *  personality until v3) or an unenrolled no-show can't answer an offer, so the
 *  ante is refused outright rather than tying up ◎10 that can only ever void. */
create or replace function pot_both_live(p_m matchup) returns boolean
  language sql stable security definer set search_path = public as $$
  select (select count(*) from league_membership lm
          where lm.league_id = p_m.league_id
            and lm.sleeper_roster_id in (p_m.home_roster_id, p_m.away_roster_id)
            and lm.enrolled and lm.app_user_id is not null and lm.controller = 'human') = 2;
$$;

/** When betting on a window closes: the instant its PICKS lock. Deliberately
 *  the same expression enforce_window_lock (0102) enforces — window_kickoff()
 *  minus the one-hour lead — so the wager deadline and the lineup deadline can
 *  never drift apart. Null when the slate carries no kickoff for the window,
 *  which refuses the ante outright. */
create or replace function pot_lock_at(p_matchup_id uuid, p_win text) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select window_kickoff(m.week, p_win) - interval '1 hour' from matchup m where m.id = p_matchup_id;
$$;

/** Have this window's games actually FINISHED?
 *  Primary signal is game_feed.state = 'post' — the explicit ESPN state added in
 *  0103 after the first live-fire caught the client inferring FINAL from a
 *  halftime pause. The elapsed-time fallback applies ONLY to games with no live
 *  feed at all, so an overtime thriller with a feed is never settled early. */
create or replace function pot_window_final(p_matchup_id uuid, p_win text) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare m matchup%rowtype; sn text; games int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return false; end if;
  if m.status = 'final' then return true; end if;
  -- Same season resolution as window_kickoff/0058: the newest season carrying
  -- this week number, so a stale prior season can never settle a live pot.
  select max(season) into sn from nfl_slate where week = m.week;
  select count(*) into games from nfl_slate s where s.season = sn and s.week = m.week and s.win = p_win;
  if games = 0 then return false; end if;
  return not exists (
    select 1 from nfl_slate s
    where s.season = sn and s.week = m.week and s.win = p_win
      and not (
        exists (select 1 from game_feed gf where gf.week = m.week and gf.home = s.home and gf.state = 'post')
        or (
          not exists (select 1 from game_feed gf where gf.week = m.week and gf.home = s.home and gf.state is not null)
          and s.kickoff is not null and s.kickoff + interval '4 hours' <= now()
        )
      )
  );
end $$;

/** Table stakes: the most a NEW wager by p_side may put up.
 *  `least(my bank, their bank, side cap − the larger side's total)` — the bank
 *  terms are heads-up table stakes (never demand more than the shorter stack can
 *  cover), the cap term keeps both sides inside the league's per-window ceiling
 *  once the wager is called. 0 ⇒ nothing is offerable (a thin bank, or a pot
 *  already at the cap). The UI just stops the slider; neither bank is shown. */
create or replace function pot_effective_stack(p_matchup_id uuid, p_win text, p_side text) returns int
  language plpgsql stable security definer set search_path = public as $$
declare m matchup%rowtype; cap int; wp window_pot%rowtype; side_cap int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return 0; end if;
  select pot_cap into cap from league where id = m.league_id;
  select * into wp from window_pot where matchup_id = p_matchup_id and game_window = p_win;
  if not found then return 0; end if;
  side_cap := coalesce(cap, 120) / 2;
  return greatest(0, least(
    pot_bank(m.league_id, pot_roster(m, p_side)),
    pot_bank(m.league_id, pot_roster(m, pot_other(p_side))),
    side_cap - greatest(wp.home_ante + wp.home_bet, wp.away_ante + wp.away_bet)));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Mutation core (internal — every caller below already holds the advisory lock)
-- ─────────────────────────────────────────────────────────────────────────────

/** Move coin from a side's wallet INTO the pot and log it. Committed money: the
 *  coin leaves the bank the moment it enters the pot (same posture as the 0069
 *  auction budgets), so you can never promise coin you've since spent in the
 *  shop. Returns what was actually committed — `least(p_amount, bank)`, which
 *  matters only for a CALL whose bank thinned since the wager was offered.
 *  The debit's idem key carries the action seq, so a replayed transaction
 *  re-uses it and charges nothing. */
create or replace function pot_commit(p_m matchup, p_win text, p_side text, p_amount int, p_kind text)
  returns int language plpgsql security definer set search_path = public as $$
declare rid int; uid uuid; amt int; sq int; sp jsonb;
begin
  rid := pot_roster(p_m, p_side);
  amt := greatest(0, least(p_amount, pot_bank(p_m.league_id, rid)));
  select lm.app_user_id into uid from league_membership lm
    where lm.league_id = p_m.league_id and lm.sleeper_roster_id = rid;

  update window_pot set seq = seq + 1, updated_at = now()
    where matchup_id = p_m.id and game_window = p_win
    returning seq into sq;

  if amt > 0 then
    sp := spend_from_wallet(p_m.league_id, rid, amt, p_m.id, p_m.week,
            'pot:' || p_win || ':' || p_kind,
            'pot:' || p_m.id::text || ':' || p_win || ':' || sq::text || ':' || rid::text);
    -- A duplicate idem key means this exact action already charged (replay); a
    -- hard failure means the balance moved under us. Either way nothing entered
    -- the pot on THIS pass.
    if not coalesce((sp ->> 'ok')::boolean, false) then amt := 0; end if;
  end if;

  -- The ante is banked apart from wagers: a fold forfeits the ante and returns
  -- every wagered chip, so the two can never be added together at rest.
  update window_pot set
      home_ante = home_ante + case when p_side = 'home' and p_kind in ('ante', 'match') then amt else 0 end,
      away_ante = away_ante + case when p_side = 'away' and p_kind in ('ante', 'match') then amt else 0 end,
      home_bet  = home_bet  + case when p_side = 'home' and p_kind not in ('ante', 'match') then amt else 0 end,
      away_bet  = away_bet  + case when p_side = 'away' and p_kind not in ('ante', 'match') then amt else 0 end,
      updated_at = now()
    where matchup_id = p_m.id and game_window = p_win;

  insert into pot_action (matchup_id, game_window, seq, side, roster_id, app_user_id, kind, amount)
    values (p_m.id, p_win, sq, p_side, rid, uid, p_kind, amt);
  return amt;
end $$;

/** Append a no-money move (check / fold / void marker) to the audit log. */
create or replace function pot_log(p_m matchup, p_win text, p_side text, p_kind text, p_amount int default 0)
  returns void language plpgsql security definer set search_path = public as $$
declare sq int;
begin
  update window_pot set seq = seq + 1, updated_at = now()
    where matchup_id = p_m.id and game_window = p_win
    returning seq into sq;
  insert into pot_action (matchup_id, game_window, seq, side, roster_id, app_user_id, kind, amount)
    values (p_m.id, p_win, sq, p_side,
            case when p_side is null then null else pot_roster(p_m, p_side) end,
            auth.uid(), p_kind, p_amount);
end $$;

/** Pay a side out of the pot. Credits carry NO seq in their idem key: each
 *  cause fires at most once per pot, and a seq-bearing key would double-pay if
 *  a replay ever allocated a fresh seq. */
create or replace function pot_pay(p_m matchup, p_win text, p_side text, p_amount int, p_cause text)
  returns void language plpgsql security definer set search_path = public as $$
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  perform credit_wallet(p_m.league_id, pot_roster(p_m, p_side), p_m.id, p_m.week, p_amount,
                        'pot:' || p_win || ':' || p_cause);
end $$;

/** Close a pot and pay it out. The three closes, and the only three:
 *
 *   'void'   — nobody ever matched the offer. Every chip goes home; no winner.
 *   'fold'   — somebody backed out before picks lock. The folder forfeits
 *              EXACTLY their ante to the other manager; both sides get every
 *              wagered chip back, however deep the ladder went.
 *   'settle' — the window finished. The pot was frozen symmetric at picks lock
 *              (pot_freeze refunded any unmatched chips there), so the winner
 *              simply takes all of it and a dead-even window hands each side
 *              its own half back. */
create or replace function pot_close(p_m matchup, p_win text, p_cause text, p_winner text default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare wp window_pot%rowtype; home_get int; away_get int;
begin
  select * into wp from window_pot where matchup_id = p_m.id and game_window = p_win for update;
  if not found or wp.state in ('void', 'folded_home', 'folded_away', 'settled', 'split') then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  if p_cause = 'void' then
    home_get := wp.home_ante + wp.home_bet;
    away_get := wp.away_ante + wp.away_bet;
  elsif p_cause = 'fold' then
    -- Backing out costs the ante and nothing else.
    home_get := wp.home_bet + case when p_winner = 'home' then wp.home_ante + wp.away_ante else 0 end;
    away_get := wp.away_bet + case when p_winner = 'away' then wp.home_ante + wp.away_ante else 0 end;
  else
    if p_winner = 'home' then
      home_get := (wp.home_ante + wp.home_bet) + (wp.away_ante + wp.away_bet); away_get := 0;
    elsif p_winner = 'away' then
      away_get := (wp.away_ante + wp.away_bet) + (wp.home_ante + wp.home_bet); home_get := 0;
    else
      home_get := wp.home_ante + wp.home_bet;   -- dead even: each side's own chips back
      away_get := wp.away_ante + wp.away_bet;
    end if;
  end if;

  perform pot_pay(p_m, p_win, 'home', home_get, p_cause);
  perform pot_pay(p_m, p_win, 'away', away_get, p_cause);

  update window_pot set
      state = case p_cause
                when 'void' then 'void'
                when 'fold' then case when p_winner = 'home' then 'folded_away' else 'folded_home' end
                else case when p_winner = 'split' then 'split' else 'settled' end end,
      turn = null, owed = 0, winner = case when p_cause = 'void' then null else p_winner end,
      settled_at = now(), updated_at = now()
    where matchup_id = p_m.id and game_window = p_win;

  perform pot_log(p_m, p_win, case when p_winner in ('home', 'away') then p_winner end,
                  case when p_cause = 'void' then 'void' else 'settle' end,
                  greatest(home_get, away_get));

  return jsonb_build_object('ok', true, 'cause', p_cause, 'winner', p_winner,
    'home_paid', home_get, 'away_paid', away_get);
end $$;

/** Picks just locked: close the betting. Any UNMATCHED chips — one side's
 *  unanswered wager — go straight home, so the pot that rides into the window is
 *  exactly symmetric and every chip left in it is genuinely at risk. Nobody
 *  backed out here, so nobody forfeits anything: letting a wager sit is a legal
 *  answer, not a fold. */
create or replace function pot_freeze(p_m matchup, p_win text)
  returns void language plpgsql security definer set search_path = public as $$
declare wp window_pot%rowtype; matched int; home_back int; away_back int;
begin
  select * into wp from window_pot where matchup_id = p_m.id and game_window = p_win for update;
  if not found or wp.state <> 'live' then return; end if;

  matched := least(wp.home_ante + wp.home_bet, wp.away_ante + wp.away_bet);
  home_back := (wp.home_ante + wp.home_bet) - matched;
  away_back := (wp.away_ante + wp.away_bet) - matched;

  if home_back > 0 or away_back > 0 then
    perform pot_pay(p_m, p_win, 'home', home_back, 'unmatched');
    perform pot_pay(p_m, p_win, 'away', away_back, 'unmatched');
    -- Take it out of the wagers first (that is where an imbalance can only come
    -- from); the ante clause is belt-and-braces for a league whose ante changed
    -- between the two sides putting theirs down. Postgres evaluates every SET
    -- expression against the OLD row, so `home_bet` below is the pre-update value.
    update window_pot set
        home_bet  = home_bet  - least(home_back, home_bet),
        away_bet  = away_bet  - least(away_back, away_bet),
        home_ante = home_ante - greatest(0, home_back - home_bet),
        away_ante = away_ante - greatest(0, away_back - away_bet)
      where matchup_id = p_m.id and game_window = p_win;
    perform pot_log(p_m, p_win, null, 'refund', greatest(home_back, away_back));
  end if;

  update window_pot set state = 'locked', turn = null, owed = 0, updated_at = now()
    where matchup_id = p_m.id and game_window = p_win;
end $$;

/** Put ◎N on the table for p_side, validating table stakes and the minimum, and
 *  pass the turn. Assumes the advisory lock is held and nothing is owed. */
create or replace function pot_open_wager(p_m matchup, p_win text, p_side text, p_amount int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare eff int; committed int;
begin
  eff := pot_effective_stack(p_m.id, p_win, p_side);
  if eff <= 0 then return jsonb_build_object('ok', false, 'error', 'table stakes — nothing is offerable here'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'wager an amount'); end if;
  if p_amount > eff then
    return jsonb_build_object('ok', false, 'error', 'table stakes', 'effective_stack', eff);
  end if;
  -- Minimum ◎5 — unless the effective stack IS the wager, i.e. all-in, which
  -- has to stay reachable even when it isn't a round number.
  if p_amount < pot_min_wager() and p_amount <> eff then
    return jsonb_build_object('ok', false, 'error', 'minimum wager is ' || pot_min_wager());
  end if;

  committed := pot_commit(p_m, p_win, p_side, p_amount, 'wager');
  if committed < p_amount then
    raise exception 'pot wager could not be funded (wanted %, committed %)', p_amount, committed;
  end if;
  update window_pot set owed = p_amount, turn = pot_other(p_side), updated_at = now()
    where matchup_id = p_m.id and game_window = p_win;
  return jsonb_build_object('ok', true, 'wagered', p_amount);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs
-- ─────────────────────────────────────────────────────────────────────────────

/** Put the ◎10 down: leads the offer on an untouched window, or matches the
 *  offer already sitting there. Matching is what makes the pot real — it flips
 *  to live and hands first action to whoever led. */
create or replace function pot_ante(p_matchup_id uuid, p_win text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; lg league%rowtype; wp window_pot%rowtype; sd text; lock_at timestamptz; paid int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  perform pg_advisory_xact_lock(hashtext(p_matchup_id::text));
  select * into lg from league where id = m.league_id;
  if coalesce(lg.pot_ante, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'pots are off in this league'); end if;
  sd := pot_my_side(m);
  if sd is null then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  if not pot_both_live(m) then
    return jsonb_build_object('ok', false, 'error', 'no manager on the other seat — nobody could answer');
  end if;

  lock_at := pot_lock_at(p_matchup_id, p_win);
  if lock_at is null then return jsonb_build_object('ok', false, 'error', 'no kickoff known for this window'); end if;
  if now() >= lock_at then return jsonb_build_object('ok', false, 'error', 'picks are locked — betting is closed on this window'); end if;
  if pot_bank(m.league_id, pot_roster(m, sd)) < lg.pot_ante then
    return jsonb_build_object('ok', false, 'error', 'not enough coin for the ◎' || lg.pot_ante || ' ante');
  end if;

  select * into wp from window_pot where matchup_id = p_matchup_id and game_window = p_win;
  if not found then
    insert into window_pot (matchup_id, game_window, leader, state) values (p_matchup_id, p_win, sd, 'offered');
    paid := pot_commit(m, p_win, sd, lg.pot_ante, 'ante');
    return jsonb_build_object('ok', true, 'led', true, 'ante', paid, 'state', 'offered');
  end if;
  if wp.state <> 'offered' then return jsonb_build_object('ok', false, 'error', 'this pot is already under way'); end if;
  if wp.leader = sd then return jsonb_build_object('ok', false, 'error', 'you led this one — waiting on them'); end if;

  paid := pot_commit(m, p_win, sd, lg.pot_ante, 'match');
  -- Matched: the ladder opens, and the manager who led acts first.
  update window_pot set state = 'live', turn = wp.leader, owed = 0, updated_at = now()
    where matchup_id = p_matchup_id and game_window = p_win;
  return jsonb_build_object('ok', true, 'matched', true, 'ante', paid, 'state', 'live', 'turn_is_theirs', wp.leader <> sd);
end $$;

/** Take your turn: check · wager · call · raise · fold.
 *  Only the turn-holder may act, which is also how two managers racing the same
 *  pot are resolved — the advisory lock serializes them and the loser finds the
 *  turn already passed. */
create or replace function pot_act(p_matchup_id uuid, p_win text, p_action text, p_amount int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matchup%rowtype; lg league%rowtype; wp window_pot%rowtype; sd text;
  lock_at timestamptz; paid int; r jsonb; rerr text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if p_action not in ('check', 'wager', 'call', 'raise', 'fold') then
    return jsonb_build_object('ok', false, 'error', 'unknown action');
  end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  perform pg_advisory_xact_lock(hashtext(p_matchup_id::text));
  select * into lg from league where id = m.league_id;
  if coalesce(lg.pot_ante, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'pots are off in this league'); end if;
  sd := pot_my_side(m);
  if sd is null then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;

  select * into wp from window_pot where matchup_id = p_matchup_id and game_window = p_win;
  if not found then return jsonb_build_object('ok', false, 'error', 'no pot on that window'); end if;
  if wp.state = 'offered' then return jsonb_build_object('ok', false, 'error', 'the ante hasn''t been matched yet'); end if;
  if wp.state <> 'live' then return jsonb_build_object('ok', false, 'error', 'betting is closed on this window'); end if;

  lock_at := pot_lock_at(p_matchup_id, p_win);
  if lock_at is not null and now() >= lock_at then
    -- The deadline passed between the client's last poll and this call. Close it
    -- properly rather than letting a late move land.
    perform pot_freeze(m, p_win);
    return jsonb_build_object('ok', false, 'error', 'picks are locked — betting is closed on this window');
  end if;
  if wp.turn <> sd then return jsonb_build_object('ok', false, 'error', 'not your turn'); end if;

  if p_action = 'fold' then
    -- Backing out: costs exactly the ante, whatever the ladder reached.
    perform pot_log(m, p_win, sd, 'fold', wp.home_ante + wp.away_ante);
    return pot_close(m, p_win, 'fold', pot_other(sd));
  end if;

  if p_action = 'check' then
    if wp.owed > 0 then return jsonb_build_object('ok', false, 'error', 'there''s a wager to answer — call, raise or fold'); end if;
    perform pot_log(m, p_win, sd, 'check', 0);
    update window_pot set turn = pot_other(sd), updated_at = now()
      where matchup_id = p_matchup_id and game_window = p_win;
    return jsonb_build_object('ok', true, 'checked', true);
  end if;

  if p_action = 'wager' then
    if wp.owed > 0 then return jsonb_build_object('ok', false, 'error', 'there''s a wager to answer — call, raise or fold'); end if;
    return pot_open_wager(m, p_win, sd, p_amount);
  end if;

  -- call / raise both start by matching what's owed.
  if wp.owed <= 0 then return jsonb_build_object('ok', false, 'error', 'nothing to call — check or wager'); end if;

  if p_action = 'call' then
    paid := pot_commit(m, p_win, sd, wp.owed, 'call');
    update window_pot set owed = 0, turn = pot_other(sd), updated_at = now()
      where matchup_id = p_matchup_id and game_window = p_win;
    select * into wp from window_pot where matchup_id = p_matchup_id and game_window = p_win;
    return jsonb_build_object('ok', true, 'called', paid,
      'pot', wp.home_ante + wp.home_bet + wp.away_ante + wp.away_bet);
  end if;

  -- Raise = call, then open. The two are ONE decision: if the open half is
  -- illegal the call half must not stand either. The nested block is a
  -- subtransaction, so a rejected raise unwinds the call's debit and we still
  -- return the normal jsonb contract.
  begin
    paid := pot_commit(m, p_win, sd, wp.owed, 'call');
    update window_pot set owed = 0, updated_at = now()
      where matchup_id = p_matchup_id and game_window = p_win;
    r := pot_open_wager(m, p_win, sd, p_amount);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'pot raise rejected'
        using detail = coalesce(r ->> 'error', 'illegal wager'), errcode = 'raise_exception';
    end if;
  exception when raise_exception then
    get stacked diagnostics rerr = pg_exception_detail;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(rerr, ''), 'illegal wager'));
  end;
  return jsonb_build_object('ok', true, 'called', paid, 'wagered', p_amount);
end $$;

/** Sweep: close betting at picks lock (void an unmatched offer, freeze a live
 *  ladder) and settle finished windows. Deterministic and idempotent — the
 *  worker's tick, a client poll, and a restart replay may all call it as often
 *  as they like. A signed-in caller may only sweep a matchup they play in; the
 *  worker (service role, auth.uid() null) sweeps everything with a null
 *  argument. */
create or replace function pot_sweep(p_matchup_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; m matchup%rowtype; wp window_pot%rowtype; lock_at timestamptz;
  hs numeric; aws numeric; winner text;
  voided int := 0; frozen int := 0; settles int := 0;
begin
  if auth.uid() is not null then
    if p_matchup_id is null then return jsonb_build_object('ok', false, 'error', 'matchup required'); end if;
    if not (is_matchup_participant(p_matchup_id) or is_admin()) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  end if;

  for r in select wp2.matchup_id, wp2.game_window from window_pot wp2
           where wp2.state in ('offered', 'live', 'locked')
             and (p_matchup_id is null or wp2.matchup_id = p_matchup_id)
           order by wp2.matchup_id, wp2.game_window
  loop
    perform pg_advisory_xact_lock(hashtext(r.matchup_id::text));
    select * into m from matchup where id = r.matchup_id;
    continue when not found;
    select * into wp from window_pot where matchup_id = r.matchup_id and game_window = r.game_window;
    continue when not found;
    lock_at := pot_lock_at(r.matchup_id, r.game_window);

    -- Picks locked ⇒ betting is over, one way or the other.
    if lock_at is not null and now() >= lock_at then
      if wp.state = 'offered' then
        -- Nobody picked the offer up. No contest, no winner: the ante goes home.
        perform pot_close(m, r.game_window, 'void');
        voided := voided + 1;
        continue;
      elsif wp.state = 'live' then
        perform pot_freeze(m, r.game_window);
        frozen := frozen + 1;
        select * into wp from window_pot where matchup_id = r.matchup_id and game_window = r.game_window;
      end if;
    end if;

    -- Settlement rides the resolve pass: matchup_state carries the authoritative
    -- per-window scores the +5 bonus is paid off.
    if wp.state = 'locked' and pot_window_final(r.matchup_id, r.game_window) then
      select ms.home_score, ms.away_score into hs, aws from matchup_state ms
        where ms.matchup_id = r.matchup_id and ms.game_window = r.game_window;
      if not found then
        -- No resolved scores yet — wait for the resolve pass. The 12h valve stops
        -- a cancelled window from holding coin forever; every chip goes home.
        if lock_at is not null and now() >= lock_at + interval '12 hours' then
          perform pot_close(m, r.game_window, 'settle', 'split');
          settles := settles + 1;
        end if;
        continue;
      end if;
      winner := case when hs > aws then 'home' when aws > hs then 'away' else 'split' end;
      perform pot_close(m, r.game_window, 'settle', winner);
      settles := settles + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'voided', voided, 'frozen', frozen, 'settled', settles);
end $$;

/** One-shot poll for the pot UI: every pot on this matchup oriented to the
 *  CALLER, plus the caller's bank and the numbers the action sheet needs. Only
 *  windows somebody actually anted on appear — the client offers the ◎10 ante on
 *  the rest from the slate it already has. */
create or replace function pot_state(p_matchup_id uuid)
  returns jsonb language plpgsql stable security definer set search_path = public as $$
declare m matchup%rowtype; lg league%rowtype; sd text; osd text; rid int; wins jsonb;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  if not (is_matchup_participant(p_matchup_id) or is_admin()) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  select * into lg from league where id = m.league_id;
  if coalesce(lg.pot_ante, 0) <= 0 then return jsonb_build_object('ok', true, 'off', true, 'windows', '[]'::jsonb); end if;
  sd := coalesce(pot_my_side(m), 'home');
  osd := pot_other(sd);
  rid := pot_roster(m, sd);

  select coalesce(jsonb_agg(x order by x ->> 'win'), '[]'::jsonb) into wins from (
    select jsonb_build_object(
      'win', wp.game_window,
      'state', case wp.state
                 when 'folded_home' then case when sd = 'home' then 'folded_you' else 'folded_them' end
                 when 'folded_away' then case when sd = 'away' then 'folded_you' else 'folded_them' end
                 else wp.state end,
      'leader', case when wp.leader = sd then 'you' else 'them' end,
      'turn', case when wp.turn is null then null when wp.turn = sd then 'you' else 'them' end,
      'owed', wp.owed,
      'pot', wp.home_ante + wp.home_bet + wp.away_ante + wp.away_bet,
      'you_in', case when sd = 'home' then wp.home_ante + wp.home_bet else wp.away_ante + wp.away_bet end,
      'them_in', case when sd = 'home' then wp.away_ante + wp.away_bet else wp.home_ante + wp.home_bet end,
      'you_ante', case when sd = 'home' then wp.home_ante else wp.away_ante end,
      'them_ante', case when sd = 'home' then wp.away_ante else wp.home_ante end,
      'effective_stack', case when wp.state = 'live' then pot_effective_stack(m.id, wp.game_window, sd) else 0 end,
      'lock_at', pot_lock_at(m.id, wp.game_window),
      'winner', case wp.winner when 'split' then 'split' when sd then 'you' when osd then 'them' end,
      'settled_at', wp.settled_at,
      'log', (select coalesce(jsonb_agg(jsonb_build_object(
                  'seq', pa.seq, 'kind', pa.kind, 'amount', pa.amount, 'at', pa.created_at,
                  'side', case when pa.side is null then null when pa.side = sd then 'you' else 'them' end)
                order by pa.seq), '[]'::jsonb)
              from pot_action pa where pa.matchup_id = wp.matchup_id and pa.game_window = wp.game_window)
    ) as x
    from window_pot wp where wp.matchup_id = p_matchup_id
  ) q;

  return jsonb_build_object(
    'ok', true, 'off', false,
    'ante', lg.pot_ante, 'cap', lg.pot_cap, 'side_cap', lg.pot_cap / 2,
    'min_wager', pot_min_wager(),
    'my_side', sd, 'my_roster_id', rid,
    'my_bank', pot_bank(m.league_id, rid),
    'both_live', pot_both_live(m),   -- false ⇒ nobody can answer an offer; no anteing
    'server_now', now(),
    'windows', wins);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — RPC-only writes; the mint-capable internals stay off `authenticated`.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function pot_commit(matchup, text, text, int, text) from public;
revoke all on function pot_log(matchup, text, text, text, int) from public;
revoke all on function pot_pay(matchup, text, text, int, text) from public;
revoke all on function pot_close(matchup, text, text, text) from public;
revoke all on function pot_freeze(matchup, text) from public;
revoke all on function pot_open_wager(matchup, text, text, int) from public;

grant execute on function pot_ante(uuid, text) to authenticated;
grant execute on function pot_act(uuid, text, text, int) to authenticated;
grant execute on function pot_state(uuid) to authenticated;
grant execute on function pot_sweep(uuid) to authenticated;
grant execute on function pot_min_wager() to authenticated;
