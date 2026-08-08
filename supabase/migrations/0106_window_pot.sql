-- 0106: THE WINDOW POT v1 — ante / raise / call on every game window.
--
-- Poker-style drip-coin betting between the two managers of a matchup, one pot
-- per (matchup, game_window). Spec: docs/window-pot.md — §6's scenarios are the
-- acceptance criteria and are asserted one-for-one in
-- scripts/db/window-pot-probes.sql. v1 scope = ante + BLIND street + standing
-- auto-call policy + settlement (S1–S9, S11–S15). The reveal/live streets (S10)
-- and the AI bidding personality (§8) are v2/v3: the `street` domain and the
-- per-street raise counters below are their seam, but nothing here ever leaves
-- 'blind' → 'closed'.
--
-- SHIPS OFF. `league.pot_ante` defaults to **0**, which disables the feature for
-- that league end to end: pot_ante_all creates no rows, pot_raise/pot_respond
-- refuse, pot_state returns `off`, and the client renders no trace. Flip it on
-- per league by hand:  update league set pot_ante = 5 where id = '…';
--
-- HARD GUARDRAIL — coin in, coin out. A pot moves drip-coin between the two
-- team wallets and nothing else: never points, never roster advantage. The +5
-- window-win POINTS bonus is untouched and independent.
--
-- The three load-bearing rules, all of which fall out of one accounting choice:
--
--   MATCHED-ONLY (S3/S5/S7/S12). A pot's real size is `2 × least(home_in,
--   away_in)`. Everything above that — an uncalled raise, the fat half of a
--   short ante — is UNMATCHED and returns to whoever put it in, win or lose.
--   That one rule is simultaneously the uncalled-bet refund (S3), the cap on
--   what sleeping through a clock can cost you (S5), the short-ante rule (S7),
--   and the tie split (S12: 2 × matched is always even, so a tie hands each
--   side its own contribution back).
--
--   COMMITTED MONEY (§5, same posture as the 0069 auction budgets). Every ante,
--   raise and call is DEBITED at commit time via spend_from_wallet — the coin
--   leaves the bank the moment it enters the pot, so you can never promise coin
--   you have since spent in the shop. Settlement credits the wallets back.
--
--   TABLE STAKES (S6). The effective stack —
--   `least(my bank, their bank, side cap − the larger side's contribution)` —
--   caps every raise, so no raise can ever demand more than the shorter stack
--   can call. No side pots, ever. The UI just stops the slider there; neither
--   bank is disclosed.
--
-- Concurrency + replay: every mutation takes the per-matchup advisory xact lock
-- (same serialization as draft picks — S8), and every wallet mutation carries an
-- idempotency key, so the worker re-resolving every 25s and restarting mid-slate
-- replays as no-ops (S13). Debits key off the action seq (each is a distinct
-- action); settlement keys WITHOUT a seq — it is a terminal once-per-window
-- event, and a seq-bearing key would double-pay if a replay ever allocated a
-- fresh seq.
--
-- DB is the authority: legality (street window, last-raise cutoff, raise count,
-- effective stack, S11's empty-chair rule) is checked inside the RPCs, never
-- inferred from how often the sweep happens to run.
--
-- One deliberate deviation from the build brief: the standing policy lives in
-- its own `pot_policy` table rather than as `league_membership.pot_auto_call`.
-- It must be OWNER-ONLY read (it is a hidden number — the whole point), and
-- league_membership carries a league-wide read policy. Postgres has no
-- column-level RLS, and revoking table SELECT to re-grant per column would break
-- every existing membership read. A separate table with RLS on and NO select
-- policy is this repo's established pattern for hidden numbers (`lot_proxy`,
-- `draft_queue`, 0067/0069) — same intent, honest mechanism.

-- ─────────────────────────────────────────────────────────────────────────────
-- Feature flag + league tunables
-- ─────────────────────────────────────────────────────────────────────────────

-- 0 = OFF (the shipping default). 5 is the spec's ambient stake.
alter table league add column if not exists pot_ante int not null default 0
  check (pot_ante >= 0 and pot_ante <= 100);
-- Total coin allowed in one window's pot; each side may commit at most half.
alter table league add column if not exists pot_cap int not null default 60
  check (pot_cap >= 0 and pot_cap <= 1000);
-- Quiet hours for the response clocks (minutes since midnight ET). NULL falls
-- back to the league's draft quiet hours, then to 22:00 → 08:00 ET.
alter table league add column if not exists pot_night_start_min int;
alter table league add column if not exists pot_night_end_min int;

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists window_pot (
  matchup_id       uuid not null references matchup(id) on delete cascade,
  game_window      text not null,
  -- Coin DEBITED from each side's wallet into this pot (ante + raises + calls).
  -- Absolute, not caller-relative; pot_state orients it as you/them.
  home_in          int  not null default 0,
  away_in          int  not null default 0,
  -- Standing-policy allowance already spent this window (S4: the policy is a
  -- per-WINDOW allowance, not a per-raise ceiling).
  home_policy_used int  not null default 0,
  away_policy_used int  not null default 0,
  -- Raises OPENED by each side on the current street (max 2 — §2).
  home_raises      int  not null default 0,
  away_raises      int  not null default 0,
  state            text not null default 'open'
                   check (state in ('open', 'folded_home', 'folded_away', 'settled', 'split')),
  -- v1 only ever moves blind → closed; 'reveal'/'live' are the v2 seam (S10).
  street           text not null default 'blind'
                   check (street in ('blind', 'reveal', 'live', 'closed')),
  -- The outstanding raise awaiting a response, if any.
  raise_by         text check (raise_by in ('home', 'away')),
  raise_amount     int,
  raise_seq        int,
  raise_deadline   timestamptz,
  seq              int  not null default 0,   -- action counter → debit idem keys
  winner           text check (winner in ('home', 'away', 'split')),
  settled_at       timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (matchup_id, game_window)
);
-- The sweep only ever scans live pots; with the flag off there are none at all.
create index if not exists window_pot_open on window_pot(state) where state = 'open';

-- Append-only audit of every pot event — the log the UI renders as "They raised
-- ◎15 on SNF". roster_id is the wallet that moved (AI/empty seats have no
-- app_user, exactly like team_wallet).
create table if not exists pot_action (
  id          bigint generated always as identity primary key,
  matchup_id  uuid not null references matchup(id) on delete cascade,
  game_window text not null,
  seq         int  not null,
  side        text check (side in ('home', 'away')),
  roster_id   int,
  app_user_id uuid references app_user(id) on delete set null,
  kind        text not null check (kind in
                ('ante', 'raise', 'call', 'fold', 'auto_call', 'auto_fold', 'settle', 'refund')),
  amount      int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (matchup_id, game_window, seq)
);
create index if not exists pot_action_pot on pot_action(matchup_id, game_window, seq);

-- The standing policy: "auto-call raises for me up to ◎N per window." A HIDDEN
-- number — RLS is on with NO select policy, so it is unreadable at rest even by
-- its owner; pot_state hands the owner their own value and nobody else's.
create table if not exists pot_policy (
  league_id  uuid not null references league(id) on delete cascade,
  roster_id  int  not null,
  auto_call  int  not null default 10 check (auto_call >= 0),
  updated_at timestamptz not null default now(),
  primary key (league_id, roster_id)
);

alter table window_pot enable row level security;
alter table pot_action enable row level security;
alter table pot_policy enable row level security;   -- no policies: hidden at rest

drop policy if exists window_pot_read on window_pot;
create policy window_pot_read on window_pot for select using (is_matchup_participant(matchup_id));
drop policy if exists pot_action_read on pot_action;
create policy pot_action_read on pot_action for select using (is_matchup_participant(matchup_id));
-- No write policies anywhere: every mutation goes through the RPCs below.

-- ─────────────────────────────────────────────────────────────────────────────
-- Constants (functions so the probes and the client can read the same numbers)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function pot_min_raise() returns int language sql immutable as $$ select 5 $$;
create or replace function pot_max_raises_per_street() returns int language sql immutable as $$ select 2 $$;
/** Response clock on the blind street: 2h of AWAKE time (§3). */
create or replace function pot_response_secs() returns int language sql immutable as $$ select 7200 $$;
/** Last-raise cutoff: no raise may be OPENED inside this much of a street's hard
 *  close unless the opponent's standing policy already covers it (§3). */
create or replace function pot_cutoff_secs() returns int language sql immutable as $$ select 1800 $$;
create or replace function pot_default_auto_call() returns int language sql immutable as $$ select 10 $$;

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

/** S11 — the empty chair. Raising needs a real manager on BOTH seats: an
 *  AI-controlled seat (no bidding personality until v3) or an unenrolled no-show
 *  can be ANTED against but never raised against, so nobody farms an empty
 *  chair with raise/fold. Antes still happen — the ambient stakes stay. */
create or replace function pot_both_live(p_m matchup) returns boolean
  language sql stable security definer set search_path = public as $$
  select (select count(*) from league_membership lm
          where lm.league_id = p_m.league_id
            and lm.sleeper_roster_id in (p_m.home_roster_id, p_m.away_roster_id)
            and lm.enrolled and lm.app_user_id is not null and lm.controller = 'human') = 2;
$$;

/** A side's standing policy (hidden). Absent row ⇒ the ◎10 default. */
create or replace function pot_auto_call_for(p_league_id uuid, p_roster_id int) returns int
  language sql stable security definer set search_path = public as $$
  select coalesce((select p.auto_call from pot_policy p
                   where p.league_id = p_league_id and p.roster_id = p_roster_id),
                  pot_default_auto_call());
$$;

/** First kickoff of a window, from the league's own season slate. Null when the
 *  slate carries no kickoff for it — raising is then refused outright, since the
 *  street close and the last-raise cutoff are both anchored to this. */
create or replace function pot_window_kickoff(p_matchup_id uuid, p_win text) returns timestamptz
  language sql stable security definer set search_path = public as $$
  select min(s.kickoff)
  from matchup m
  join league l on l.id = m.league_id
  join nfl_slate s on s.season = l.season and s.week = m.week and s.win = p_win
  where m.id = p_matchup_id;
$$;

/** Have this window's games actually FINISHED?
 *  Primary signal is game_feed.state = 'post' — the explicit ESPN state added in
 *  0103 after the first live-fire caught the client inferring FINAL from a
 *  halftime pause. The elapsed-time fallback applies ONLY to games with no live
 *  feed at all, so an overtime thriller with a feed is never settled early. A
 *  final matchup settles everything. */
create or replace function pot_window_final(p_matchup_id uuid, p_win text) returns boolean
  language plpgsql stable security definer set search_path = public as $$
declare m matchup%rowtype; lg league%rowtype; games int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return false; end if;
  if m.status = 'final' then return true; end if;
  select * into lg from league where id = m.league_id;
  select count(*) into games from nfl_slate s
    where s.season = lg.season and s.week = m.week and s.win = p_win;
  if games = 0 then return false; end if;
  return not exists (
    select 1 from nfl_slate s
    where s.season = lg.season and s.week = m.week and s.win = p_win
      and not (
        exists (select 1 from game_feed gf where gf.week = m.week and gf.home = s.home and gf.state = 'post')
        or (
          not exists (select 1 from game_feed gf where gf.week = m.week and gf.home = s.home and gf.state is not null)
          and s.kickoff is not null and s.kickoff + interval '4 hours' <= now()
        )
      )
  );
end $$;

/** now() + the response clock in AWAKE time — the 0069 quiet-hours arithmetic,
 *  so a raise landing at 11pm is answerable in the morning instead of expiring
 *  while the league sleeps. Hours resolve league override → the league's draft
 *  quiet hours → 22:00–08:00 ET. */
create or replace function pot_deadline(p_league_id uuid, p_secs int) returns timestamptz
  language plpgsql stable security definer set search_path = public as $$
declare ns int; ne int;
begin
  select coalesce(l.pot_night_start_min, d.night_start_min, 1320),
         coalesce(l.pot_night_end_min,   d.night_end_min,   480)
    into ns, ne
  from league l left join draft d on d.league_id = l.id
  where l.id = p_league_id;
  return awake_deadline(now(), p_secs, coalesce(ns, 1320), coalesce(ne, 480));
end $$;

/** S6 — the effective stack: the most a NEW raise by p_side may demand, from the
 *  pot's current (matched) state. `least(my bank, their bank, side cap − the
 *  larger contribution)`: the bank terms are heads-up table stakes (never demand
 *  more than the shorter stack can call), the cap term keeps both sides inside
 *  the league's per-window ceiling once the raise is called. 0 ⇒ no raise is
 *  offerable at all (a broke manager, or a capped pot). */
create or replace function pot_effective_stack(p_matchup_id uuid, p_win text, p_side text) returns int
  language plpgsql stable security definer set search_path = public as $$
declare m matchup%rowtype; lg league%rowtype; wp window_pot%rowtype; side_cap int;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return 0; end if;
  select * into lg from league where id = m.league_id;
  select * into wp from window_pot where matchup_id = p_matchup_id and game_window = p_win;
  if not found then return 0; end if;
  side_cap := lg.pot_cap / 2;
  return greatest(0, least(
    pot_bank(m.league_id, pot_roster(m, p_side)),
    pot_bank(m.league_id, pot_roster(m, pot_other(p_side))),
    side_cap - greatest(wp.home_in, wp.away_in)));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Mutation core (internal — every caller below already holds the advisory lock)
-- ─────────────────────────────────────────────────────────────────────────────

/** Move coin from a side's wallet INTO the pot and log it. Returns the amount
 *  actually committed, which is `least(p_amount, bank)` — the short-ante rule
 *  (S7) and, for a call, table stakes when a shop spree has thinned the bank
 *  since the raise was offered. The debit's idem key carries the action seq, so
 *  a replayed transaction re-uses it and charges nothing. */
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
    -- the pot on THIS pass, so commit nothing.
    if not coalesce((sp ->> 'ok')::boolean, false) then amt := 0; end if;
  end if;

  update window_pot set
      home_in = home_in + case when p_side = 'home' then amt else 0 end,
      away_in = away_in + case when p_side = 'away' then amt else 0 end,
      updated_at = now()
    where matchup_id = p_m.id and game_window = p_win;

  insert into pot_action (matchup_id, game_window, seq, side, roster_id, app_user_id, kind, amount)
    values (p_m.id, p_win, sq, p_side, rid, uid, p_kind, amt);
  return amt;
end $$;

/** Settle a pot — the ONLY place coin leaves a pot, and the only place the
 *  matched-only rule is spent. p_winner: 'home' | 'away' | 'split'.
 *
 *  matched   = least(home_in, away_in)      → the real pot is 2 × matched
 *  refund    = my contribution − matched    → every unmatched chip goes home
 *  the winner takes 2 × matched on top of its own refund.
 *
 *  A tie splits 2 × matched, which is even by construction, so each side ends up
 *  with exactly what it put in (S12); the odd-chip-to-the-away-side rule is
 *  written out anyway — deterministic, documented, boring on purpose.
 *
 *  Credits carry NO seq in their idem key: settlement is terminal and happens
 *  once per window, and a seq-bearing key would double-pay if a replay ever
 *  allocated a fresh seq. */
create or replace function pot_settle(p_m matchup, p_win text, p_winner text, p_cause text)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wp window_pot%rowtype; matched int; pot int; sq int;
  home_take int; away_take int; home_get int; away_get int;
begin
  select * into wp from window_pot where matchup_id = p_m.id and game_window = p_win for update;
  if not found or wp.state <> 'open' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  matched := least(wp.home_in, wp.away_in);
  pot := matched * 2;
  if p_winner = 'home' then
    home_take := pot; away_take := 0;
  elsif p_winner = 'away' then
    home_take := 0; away_take := pot;
  else
    away_take := (pot + 1) / 2;      -- odd chip to the away side
    home_take := pot - away_take;
  end if;
  home_get := (wp.home_in - matched) + home_take;   -- refund of the unmatched + the take
  away_get := (wp.away_in - matched) + away_take;

  if home_get > 0 then
    perform credit_wallet(p_m.league_id, p_m.home_roster_id, p_m.id, p_m.week, home_get,
                          'pot:' || p_win || ':' || p_cause);
  end if;
  if away_get > 0 then
    perform credit_wallet(p_m.league_id, p_m.away_roster_id, p_m.id, p_m.week, away_get,
                          'pot:' || p_win || ':' || p_cause);
  end if;

  update window_pot set
      state = case p_cause
                when 'fold' then case when p_winner = 'home' then 'folded_away' else 'folded_home' end
                else case when p_winner = 'split' then 'split' else 'settled' end end,
      street = 'closed', winner = p_winner, settled_at = now(),
      raise_by = null, raise_amount = null, raise_seq = null, raise_deadline = null,
      seq = seq + 1, updated_at = now()
    where matchup_id = p_m.id and game_window = p_win
    returning seq into sq;

  insert into pot_action (matchup_id, game_window, seq, side, roster_id, kind, amount)
    values (p_m.id, p_win, sq,
            case when p_winner in ('home', 'away') then p_winner end,
            case when p_winner = 'home' then p_m.home_roster_id
                 when p_winner = 'away' then p_m.away_roster_id end,
            'settle', pot);

  return jsonb_build_object('ok', true, 'winner', p_winner, 'pot', pot,
    'home_paid', home_get, 'away_paid', away_get, 'cause', p_cause);
end $$;

/** Open a raise for p_side, validating every §3/§6 rule, then either resolving
 *  it instantly against the opponent's standing policy (S4) or starting the
 *  response clock. Assumes the advisory lock is held and no raise is pending. */
create or replace function pot_open_raise(p_m matchup, p_win text, p_side text, p_amount int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  wp window_pot%rowtype; osd text; kick timestamptz;
  eff int; mine int; allowance int; committed int; sq int; auto boolean := false;
begin
  select * into wp from window_pot where matchup_id = p_m.id and game_window = p_win;
  if not found then return jsonb_build_object('ok', false, 'error', 'no pot on that window'); end if;
  osd := pot_other(p_side);

  if wp.state <> 'open' then return jsonb_build_object('ok', false, 'error', 'this pot is already settled'); end if;
  if wp.street <> 'blind' then return jsonb_build_object('ok', false, 'error', 'betting is closed on this window'); end if;
  if not pot_both_live(p_m) then
    return jsonb_build_object('ok', false, 'error', 'ante only — the other seat has no manager');
  end if;

  kick := pot_window_kickoff(p_m.id, p_win);
  if kick is null then return jsonb_build_object('ok', false, 'error', 'no kickoff known for this window'); end if;
  if now() >= kick then return jsonb_build_object('ok', false, 'error', 'this street has closed'); end if;

  mine := case when p_side = 'home' then wp.home_raises else wp.away_raises end;
  if mine >= pot_max_raises_per_street() then
    return jsonb_build_object('ok', false, 'error', 'raise limit for this street');
  end if;

  eff := pot_effective_stack(p_m.id, p_win, p_side);
  if eff <= 0 then return jsonb_build_object('ok', false, 'error', 'table stakes — no raise is offerable here'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'error', 'raise an amount'); end if;
  if p_amount > eff then
    return jsonb_build_object('ok', false, 'error', 'table stakes', 'effective_stack', eff);
  end if;
  -- Min step ◎5 — unless the effective stack IS the raise, i.e. all-in (S6: a
  -- "raise all-in ◎12" is legal and dramatic).
  if p_amount < pot_min_raise() and p_amount <> eff then
    return jsonb_build_object('ok', false, 'error', 'minimum raise is ' || pot_min_raise());
  end if;

  -- Standing-policy allowance the opponent has LEFT this window (S4: per-window,
  -- not per-raise — otherwise two ◎10 raises sneak past a "◎10 max" intent).
  allowance := greatest(0, pot_auto_call_for(p_m.league_id, pot_roster(p_m, osd))
                         - case when osd = 'home' then wp.home_policy_used else wp.away_policy_used end);

  -- Last-raise cutoff (§3): a raise the opponent has no realistic window to
  -- answer is a snipe, not a bet. Inside the cutoff only a raise their standing
  -- policy already covers may be opened — and that one resolves instantly.
  if now() > kick - make_interval(secs => pot_cutoff_secs()) and allowance < p_amount then
    return jsonb_build_object('ok', false, 'error', 'last-raise cutoff — too close to kickoff',
      'cutoff_at', kick - make_interval(secs => pot_cutoff_secs()));
  end if;

  committed := pot_commit(p_m, p_win, p_side, p_amount, 'raise');
  if committed < p_amount then
    -- The bank moved under us between the stack check and the debit; nothing
    -- half-committed survives (the whole RPC is one transaction).
    raise exception 'pot raise could not be funded (wanted %, committed %)', p_amount, committed;
  end if;
  update window_pot set
      home_raises = home_raises + case when p_side = 'home' then 1 else 0 end,
      away_raises = away_raises + case when p_side = 'away' then 1 else 0 end,
      updated_at = now()
    where matchup_id = p_m.id and game_window = p_win
    returning seq into sq;

  -- Covered by the standing policy → instant auto-call. This is what makes the
  -- feature feel live against a sleeping opponent (§4).
  if allowance >= p_amount and pot_bank(p_m.league_id, pot_roster(p_m, osd)) >= p_amount then
    perform pot_commit(p_m, p_win, osd, p_amount, 'auto_call');
    update window_pot set
        home_policy_used = home_policy_used + case when osd = 'home' then p_amount else 0 end,
        away_policy_used = away_policy_used + case when osd = 'away' then p_amount else 0 end,
        updated_at = now()
      where matchup_id = p_m.id and game_window = p_win;
    auto := true;
  else
    update window_pot set
        raise_by = p_side, raise_amount = p_amount, raise_seq = sq,
        raise_deadline = least(pot_deadline(p_m.league_id, pot_response_secs()), kick),
        updated_at = now()
      where matchup_id = p_m.id and game_window = p_win;
  end if;

  select * into wp from window_pot where matchup_id = p_m.id and game_window = p_win;
  return jsonb_build_object('ok', true, 'amount', p_amount, 'auto_called', auto,
    'pot', wp.home_in + wp.away_in, 'deadline', wp.raise_deadline);
end $$;

/** Match the outstanding raise. Debits `least(raise, bank)` — a thinned bank
 *  calls all-in and the shortfall simply stays unmatched, which the settlement
 *  rule already refunds. Clears the pending raise. */
create or replace function pot_apply_call(p_m matchup, p_win text, p_side text, p_kind text)
  returns int language plpgsql security definer set search_path = public as $$
declare wp window_pot%rowtype; paid int;
begin
  select * into wp from window_pot where matchup_id = p_m.id and game_window = p_win;
  paid := pot_commit(p_m, p_win, p_side, wp.raise_amount, p_kind);
  update window_pot set
      home_policy_used = home_policy_used + case when p_side = 'home' and p_kind = 'auto_call' then paid else 0 end,
      away_policy_used = away_policy_used + case when p_side = 'away' and p_kind = 'auto_call' then paid else 0 end,
      raise_by = null, raise_amount = null, raise_seq = null, raise_deadline = null,
      updated_at = now()
    where matchup_id = p_m.id and game_window = p_win;
  return paid;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPCs
-- ─────────────────────────────────────────────────────────────────────────────

/** Worker-only, at matchup lock: ante both sides into every window of the week.
 *  Short-antes per S7 (you ante what you have; ◎0 is legal), so a shop spree can
 *  never leave a manager unable to lock. Idempotent — a re-lock finds the pot
 *  rows already there and antes nothing. A league with pot_ante = 0 creates no
 *  rows at all: the feature leaves no trace. */
create or replace function pot_ante_all(p_matchup_id uuid)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matchup%rowtype; lg league%rowtype; w text; sd text; n int; pots int := 0; coin int := 0;
begin
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  select * into lg from league where id = m.league_id;
  if coalesce(lg.pot_ante, 0) <= 0 then return jsonb_build_object('ok', true, 'off', true, 'pots', 0); end if;

  perform pg_advisory_xact_lock(hashtext(p_matchup_id::text));

  for w in select distinct s.win from nfl_slate s
           where s.season = lg.season and s.week = m.week order by 1
  loop
    insert into window_pot (matchup_id, game_window) values (p_matchup_id, w)
      on conflict (matchup_id, game_window) do nothing;
    get diagnostics n = row_count;
    if n = 0 then continue; end if;         -- already anted on an earlier lock pass
    pots := pots + 1;
    foreach sd in array array['home', 'away'] loop
      coin := coin + pot_commit(m, w, sd, lg.pot_ante, 'ante');
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'pots', pots, 'coin', coin, 'ante', lg.pot_ante);
end $$;

/** Raise ◎N on a window. The opponent owes a response — instantly answered when
 *  their standing policy covers it, otherwise a quiet-hours-aware clock starts. */
create or replace function pot_raise(p_matchup_id uuid, p_win text, p_amount int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; lg league%rowtype; wp window_pot%rowtype; sd text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  perform pg_advisory_xact_lock(hashtext(p_matchup_id::text));   -- S8: first write wins
  select * into lg from league where id = m.league_id;
  if coalesce(lg.pot_ante, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'pots are off in this league'); end if;
  sd := pot_my_side(m);
  if sd is null then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into wp from window_pot where matchup_id = p_matchup_id and game_window = p_win;
  if not found then return jsonb_build_object('ok', false, 'error', 'no pot on that window'); end if;

  -- S8: someone raised while this one was in flight. Don't silently turn it into
  -- a re-raise — hand it back to its author to confirm against the pot they can
  -- now see (the client re-opens the sheet as "your raise is now a re-raise").
  if wp.raise_by is not null then
    if wp.raise_by = sd then return jsonb_build_object('ok', false, 'error', 'your raise is still awaiting a response'); end if;
    return jsonb_build_object('ok', false, 'error', 'pot changed', 're_raise', true,
      'pending_amount', wp.raise_amount, 'pot', wp.home_in + wp.away_in);
  end if;
  return pot_open_raise(m, p_win, sd, p_amount);
end $$;

/** Answer the outstanding raise: call · fold · re-raise. A re-raise calls first,
 *  then opens a raise of p_amount under all the same rules. A fold settles the
 *  pot IMMEDIATELY — no waiting for the window to finish (§5). */
create or replace function pot_respond(p_matchup_id uuid, p_win text, p_action text, p_amount int default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare m matchup%rowtype; lg league%rowtype; wp window_pot%rowtype; sd text; paid int; r jsonb; rerr text;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  if p_action not in ('call', 'fold', 'raise') then return jsonb_build_object('ok', false, 'error', 'unknown action'); end if;
  select * into m from matchup where id = p_matchup_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'no matchup'); end if;
  perform pg_advisory_xact_lock(hashtext(p_matchup_id::text));
  select * into lg from league where id = m.league_id;
  if coalesce(lg.pot_ante, 0) <= 0 then return jsonb_build_object('ok', false, 'error', 'pots are off in this league'); end if;
  sd := pot_my_side(m);
  if sd is null then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select * into wp from window_pot where matchup_id = p_matchup_id and game_window = p_win;
  if not found then return jsonb_build_object('ok', false, 'error', 'no pot on that window'); end if;
  if wp.state <> 'open' then return jsonb_build_object('ok', false, 'error', 'this pot is already settled'); end if;
  if wp.raise_by is null then return jsonb_build_object('ok', false, 'error', 'nothing to respond to'); end if;
  if wp.raise_by = sd then return jsonb_build_object('ok', false, 'error', 'that raise is yours — wait for a response'); end if;

  if p_action = 'fold' then
    -- S3: the folder loses only what was MATCHED; the raiser's uncalled chips go
    -- straight back to them. A fold always costs exactly your matched
    -- contribution — usually just the ante.
    update window_pot set seq = seq + 1, updated_at = now()
      where matchup_id = p_matchup_id and game_window = p_win;
    insert into pot_action (matchup_id, game_window, seq, side, roster_id, app_user_id, kind, amount)
      select p_matchup_id, p_win, wp2.seq, sd, pot_roster(m, sd), auth.uid(), 'fold', 0
      from window_pot wp2 where wp2.matchup_id = p_matchup_id and wp2.game_window = p_win;
    return pot_settle(m, p_win, pot_other(sd), 'fold');
  end if;

  if p_action = 'call' then
    paid := pot_apply_call(m, p_win, sd, 'call');
    select * into wp from window_pot where matchup_id = p_matchup_id and game_window = p_win;
    return jsonb_build_object('ok', true, 'called', paid, 'pot', wp.home_in + wp.away_in);
  end if;

  -- Re-raise = call, then open. The two are ONE decision: if the raise half is
  -- illegal the call half must not stand either (the manager asked to re-raise,
  -- not to call). The nested block is a subtransaction, so a rejected raise
  -- unwinds the call's debit and we still return the normal jsonb contract.
  begin
    paid := pot_apply_call(m, p_win, sd, 'call');
    r := pot_open_raise(m, p_win, sd, p_amount);
    if not coalesce((r ->> 'ok')::boolean, false) then
      raise exception 'pot re-raise rejected'
        using detail = coalesce(r ->> 'error', 'illegal raise'), errcode = 'raise_exception';
    end if;
  exception when raise_exception then
    get stacked diagnostics rerr = pg_exception_detail;
    return jsonb_build_object('ok', false, 'error', coalesce(nullif(rerr, ''), 'illegal raise'));
  end;
  return jsonb_build_object('ok', true, 'called', paid, 'raised', p_amount,
    'auto_called', r -> 'auto_called', 'pot', r -> 'pot', 'deadline', r -> 'deadline');
end $$;

/** Set the caller's standing policy for a league — "auto-call raises up to ◎N
 *  per window." Hidden from the opponent, exactly like a slow-auction max bid. */
create or replace function set_pot_auto_call(p_league_id uuid, p_max int)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare rid int; cap int; v int;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'not signed in'); end if;
  select lm.sleeper_roster_id into rid from league_membership lm
    where lm.league_id = p_league_id and lm.app_user_id = auth.uid() and lm.enrolled limit 1;
  if rid is null then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  select greatest(0, pot_cap) into cap from league where id = p_league_id;
  v := greatest(0, least(coalesce(p_max, pot_default_auto_call()), coalesce(cap, 60)));
  insert into pot_policy (league_id, roster_id, auto_call) values (p_league_id, rid, v)
    on conflict (league_id, roster_id) do update set auto_call = v, updated_at = now();
  return jsonb_build_object('ok', true, 'auto_call', v);
end $$;

/** Sweep: expire response clocks (S5), force street closes (S9) and settle
 *  finished windows (S13). Deterministic and idempotent — the worker's tick, a
 *  client poll, and a restart replay may all call it as often as they like.
 *  A signed-in caller may only sweep a matchup they play in; the worker (service
 *  role, auth.uid() null) sweeps everything with a null argument. */
create or replace function pot_sweep(p_matchup_id uuid default null)
  returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; m matchup%rowtype; wp window_pot%rowtype; osd text; kick timestamptz;
  allowance int; hs numeric; aws numeric; winner text;
  expired int := 0; closes int := 0; settles int := 0;
begin
  if auth.uid() is not null then
    if p_matchup_id is null then return jsonb_build_object('ok', false, 'error', 'matchup required'); end if;
    if not (is_matchup_participant(p_matchup_id) or is_admin()) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
  end if;

  for r in select wp2.matchup_id, wp2.game_window from window_pot wp2
           where wp2.state = 'open' and (p_matchup_id is null or wp2.matchup_id = p_matchup_id)
           order by wp2.matchup_id, wp2.game_window
  loop
    perform pg_advisory_xact_lock(hashtext(r.matchup_id::text));
    select * into m from matchup where id = r.matchup_id;
    continue when not found;
    select * into wp from window_pot where matchup_id = r.matchup_id and game_window = r.game_window;
    continue when not found or wp.state <> 'open';
    kick := pot_window_kickoff(r.matchup_id, r.game_window);

    -- S9 — the street's hard close forces resolution AT the close, deadline or
    -- not: a raise may never straddle the reveal, so nobody answers a blind
    -- raise with post-kickoff information.
    if wp.raise_by is not null
       and (now() >= wp.raise_deadline or (kick is not null and now() >= kick)) then
      osd := pot_other(wp.raise_by);
      allowance := greatest(0, pot_auto_call_for(m.league_id, pot_roster(m, osd))
                             - case when osd = 'home' then wp.home_policy_used else wp.away_policy_used end);
      if allowance >= wp.raise_amount and pot_bank(m.league_id, pot_roster(m, osd)) >= wp.raise_amount then
        perform pot_apply_call(m, r.game_window, osd, 'auto_call');
      else
        -- Clock expired unanswered → auto-fold (S5). Per S3 the raiser's
        -- uncalled chips return and they take only the matched pot, which caps
        -- the cost of sleeping through it at what was already matched.
        update window_pot set seq = seq + 1, updated_at = now()
          where matchup_id = r.matchup_id and game_window = r.game_window;
        insert into pot_action (matchup_id, game_window, seq, side, roster_id, kind, amount)
          select r.matchup_id, r.game_window, w2.seq, osd, pot_roster(m, osd), 'auto_fold', 0
          from window_pot w2 where w2.matchup_id = r.matchup_id and w2.game_window = r.game_window;
        perform pot_settle(m, r.game_window, wp.raise_by, 'fold');
        expired := expired + 1;
        continue;
      end if;
      expired := expired + 1;
      select * into wp from window_pot where matchup_id = r.matchup_id and game_window = r.game_window;
    end if;

    -- Betting on the window ends at its kickoff (v1 has no reveal/live streets).
    if wp.street <> 'closed' and kick is not null and now() >= kick then
      update window_pot set street = 'closed', updated_at = now()
        where matchup_id = r.matchup_id and game_window = r.game_window;
      closes := closes + 1;
    end if;

    -- Settlement rides the resolve pass: matchup_state carries the authoritative
    -- per-window scores the +5 bonus is paid off.
    if pot_window_final(r.matchup_id, r.game_window) then
      select ms.home_score, ms.away_score into hs, aws from matchup_state ms
        where ms.matchup_id = r.matchup_id and ms.game_window = r.game_window;
      if not found then
        -- No resolved scores yet — wait for the resolve pass. The 12h valve stops
        -- a cancelled/never-played window from holding coin forever; a tie hands
        -- every chip back to whoever put it in.
        if kick is not null and now() >= kick + interval '12 hours' then
          perform pot_settle(m, r.game_window, 'split', 'split');
          settles := settles + 1;
        end if;
        continue;
      end if;
      winner := case when hs > aws then 'home' when aws > hs then 'away' else 'split' end;
      perform pot_settle(m, r.game_window, winner, case when winner = 'split' then 'split' else 'settle' end);
      settles := settles + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'resolved_clocks', expired, 'streets_closed', closes, 'settled', settles);
end $$;

/** One-shot poll for the pot UI: every window's pot oriented to the CALLER, the
 *  caller's own bank + hidden policy, the effective stack the raise slider maxes
 *  at, and the action log. Never discloses the opponent's bank or policy — the
 *  slider just stops (S6, "table stakes" is the tooltip). */
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
      'street', wp.street,
      'pot', wp.home_in + wp.away_in,
      'you_in', case when sd = 'home' then wp.home_in else wp.away_in end,
      'them_in', case when sd = 'home' then wp.away_in else wp.home_in end,
      'matched', least(wp.home_in, wp.away_in) * 2,
      'effective_stack', case when wp.state = 'open' then pot_effective_stack(m.id, wp.game_window, sd) else 0 end,
      'raises_left', greatest(0, pot_max_raises_per_street()
                     - case when sd = 'home' then wp.home_raises else wp.away_raises end),
      'policy_left', greatest(0, pot_auto_call_for(m.league_id, rid)
                     - case when sd = 'home' then wp.home_policy_used else wp.away_policy_used end),
      'pending', case when wp.raise_by is null then null else jsonb_build_object(
                   'by', case when wp.raise_by = sd then 'you' else 'them' end,
                   'amount', wp.raise_amount, 'deadline', wp.raise_deadline) end,
      'kickoff', pot_window_kickoff(m.id, wp.game_window),
      'cutoff_at', pot_window_kickoff(m.id, wp.game_window) - make_interval(secs => pot_cutoff_secs()),
      'winner', case wp.winner when 'split' then 'split'
                  when sd then 'you' when osd then 'them' end,
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
    'min_raise', pot_min_raise(), 'max_raises', pot_max_raises_per_street(),
    'my_side', sd, 'my_roster_id', rid,
    'my_bank', pot_bank(m.league_id, rid),
    'my_auto_call', pot_auto_call_for(m.league_id, rid),
    'both_live', pot_both_live(m),          -- false ⇒ ante-only (S11), no raising
    'server_now', now(),
    'windows', wins);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Grants — RPC-only writes; the mint-capable internals stay off `authenticated`.
-- ─────────────────────────────────────────────────────────────────────────────
revoke all on function pot_ante_all(uuid) from public;
revoke all on function pot_commit(matchup, text, text, int, text) from public;
revoke all on function pot_settle(matchup, text, text, text) from public;
revoke all on function pot_open_raise(matchup, text, text, int) from public;
revoke all on function pot_apply_call(matchup, text, text, text) from public;
grant execute on function pot_ante_all(uuid) to service_role;

grant execute on function pot_raise(uuid, text, int) to authenticated;
grant execute on function pot_respond(uuid, text, text, int) to authenticated;
grant execute on function pot_state(uuid) to authenticated;
grant execute on function pot_sweep(uuid) to authenticated;
grant execute on function set_pot_auto_call(uuid, int) to authenticated;
grant execute on function pot_min_raise() to authenticated;
grant execute on function pot_max_raises_per_street() to authenticated;
grant execute on function pot_default_auto_call() to authenticated;
