# The Window Pot — an optional wager ladder on any game window

> **Status: v1 BUILT — flagged off.** Spec written 2026-08-07, the morning after
> the first live-fire (preseason CAR@ARI); **redesigned and built 2026-08-08**
> in migration `0106_window_pot.sql`, shipped with `league.pot_ante = 0`
> everywhere (see §12 for what shipped and how to flip it on).
>
> The redesign, in one line: betting went from **automatic and post-lock** to
> **opt-in and pre-lock**. Both managers now choose a window and put ◎10 up
> before it locks, instead of every window being anted for them at lock. That
> change removed the standing auto-call policy and the quiet-hours response
> clocks the first draft needed — with an explicit turn and a hard deadline at
> picks lock, there is nothing left to answer on your behalf.
>
> Pairs with `docs/powerups.md` (the Bets family this extends) and
> `docs/premium-model.md` (the never-pay-to-win line). §6's scenarios are the
> acceptance criteria and are asserted one-for-one in
> `scripts/db/window-pot-probes.sql`.

## 1. The idea

Poker-style betting on a game window, between the two managers of a matchup —
but only when both of them want it. One puts **◎10** on a window; the other
**matches** it or ignores it. If it's matched, they trade **wagers** back and
forth until that window's **picks lock**, and the window's winner takes the pot.

Why this belongs in Drip specifically: betting rounds are an *information* game,
and this product already has poker's load-bearing ingredient — **hidden hands**
(sealed lineups). The entire ladder is played before a single pick is revealed.
A wager on SNF is a claim about a sealed slot the opponent can't see… or a
bluff. No other fantasy product can offer that, because no other product has
sealed picks.

### Design goals
1. **Opt-in, always.** A manager who never taps never bets, is never charged,
   and never sees a pot. Nothing is automatic.
2. Betting deepens the hidden-information core — signalling, bluffing, reading.
3. Turn-taking is explicit, so nobody has to sit watching the app: your move is
   waiting for you whenever you open it, and the only deadline is picks lock.
4. The fantasy layer is untouched: **backing out concedes coin, never points.**

### Hard guardrails
- **Coin in, coin out.** Pots pay drip-coin only — never points, never roster
  advantages. The +5 window-win *points* bonus is unchanged and separate.
- Pots are pure transfers between the two wallets (zero-sum): no inflation,
  no new coin faucet, no sink.
- **Watch-item for 2027:** this stays clean while drip-coin is earned-only.
  If coin ever becomes purchasable for cash, this feature is the first thing
  gambling regulators would examine. Keep the earned-only line hard
  (`docs/premium-model.md`), and re-review here before any coin IAP.

## 2. Definitions

| Term | Meaning |
|---|---|
| **Pot** | Per (matchup, window) coin pool. Exists only because both managers anted into it. |
| **Ante** | The ◎10 entry fee. One manager leads it, the other matches — and matching is what makes the pot real. League-tunable; `0` disables the feature for a league. |
| **Leader** | Whoever put the ◎10 up first. They get first action once it's matched. |
| **Wager** | Put ◎N up on your turn; the opponent owes a response. Min step ◎5. |
| **Call** | Match the outstanding wager. |
| **Raise** | Call, then open a new wager in the same move. |
| **Check** | Pass your turn without committing anything. Perfectly fine — an ante-only ◎20 pot is a real outcome. |
| **Back out** | Concede the pot. Costs you **exactly your ante**; every wagered chip goes back to whoever bet it. Your window still scores normally. |
| **Effective stack** | `min(your bank, their bank, side cap − the larger side's total)` — the most any wager can put up (§6, table stakes). |

### Economy sizing (defaults, all league-tunable)
- Ante **◎10** — a fifth of the weekly stipend (◎50), and only on windows you
  chose. A manager who plays every window of a five-window week has committed
  ◎50 of antes, which is why it has to be opt-in rather than automatic.
- **Pot cap ◎120 per window** (each side ≤ ◎60 in, of which ◎10 is the ante) —
  ◎50 of ladder a side. Keeps bankroll oppression impossible.

## 3. Timing — when betting is open

Betting on window **W** runs from the moment the matchup exists until **W's
picks lock**, which is `W's first kickoff − 1h` — the same instant
`enforce_window_lock` (0102) stops accepting lineup edits, and deliberately the
same expression, so the two can never drift apart.

That means the whole ladder is played **blind**: nothing has kicked off, nothing
has been revealed, and neither manager has seen a single one of the other's
picks. It also means a late-week window (SNF, MNF) has days of betting while a
Thursday window has only until Wednesday night — which is honest, because that's
exactly how much time each manager has to think about that lineup.

**At the close, three things can happen:**
- An offer nobody matched → **voids**. The ◎10 goes home. No contest, no winner.
- A live ladder → **freezes**. Any unmatched chips (one side's unanswered wager)
  go home, so the pot that rides into the window is exactly symmetric and every
  chip left in it is genuinely at risk.
- A pot already ended by a back-out → already settled, nothing to do.

**No clocks.** Letting a wager sit unanswered is a legal answer, not a
forfeit — it simply returns at the close. Silence is never punished, so there is
nothing to auto-fold and nothing to schedule around quiet hours.

## 4. Turn order — the async backbone

Once the ante is matched the pot is **live** and the **leader acts first**. Only
the manager whose turn it is may act, and the turn passes on every move:

| Facing | You may |
|---|---|
| Nothing owed | **check** (pass) · **wager ◎N** · **back out** |
| A wager of ◎N | **call ◎N** · **raise** (call ◎N, then open ◎M) · **back out** |

Rinse and repeat until picks lock. Two checks in a row don't end anything — the
ladder stays open, and either of you can still open a wager later in the week.

The strict turn is also the concurrency answer: every mutation takes the
per-matchup advisory lock (the same serialization as draft picks), so two
managers tapping at once serialize and the second one finds the turn already
passed. No corrupted pots, no double-counts.

**Fair-play rule:** if the opponent seat is AI-controlled or an unenrolled
no-show, the ante is refused outright — nobody could ever answer it, so there is
no point tying up ◎10 on an offer that could only void. You cannot farm an empty
chair. (AI seats graduate to full participation when the bidding personality
ships — §8.)

## 5. Settlement

There are exactly three ways a pot ends.

**Backing out** settles immediately — no waiting for the games. The folder hands
over **exactly their ◎10 ante**, and both managers get every wagered chip back,
however deep the ladder went. The battle bar shows `THEY BACKED OUT → +◎10`.

**Void** — nobody matched the offer by picks lock. Every chip goes home; nobody
wins anything.

**The window's final** (the same resolve pass that pays the +5 bonus and MVP
coin) — the winner's wallet takes the whole frozen pot (`credit_wallet`,
idempotent, so re-resolves can never double-pay). A **dead-even window splits**:
each side gets its own half back.

Every ante, wager and call is **debited at commit time** (`spend_from_wallet`,
idempotent per action) — committed money leaves the bank the moment it enters
the pot, exactly like parallel-auction committed budgets (0069), so you can
never promise coin you've since spent in the shop.

### The consequence worth stating out loud

Because backing out costs a flat ◎10, **the wagers are only truly at risk after
picks lock.** Before then, a call is reversible for the price of the ante. That
makes the ladder a *commitment ratchet* rather than a bluff-caller: the live
question isn't "are you bluffing?" so much as "will you still be here at lock?",
and the coin at stake is a running statement of how much each of you believes in
a lineup neither can see. Founder's explicit call (2026-08-08) over the
poker-standard alternative of forfeiting everything you had matched.

## 6. Scenarios, played out

The heart of the spec. Every rule above earns its keep here. All of these are
asserted in `scripts/db/window-pot-probes.sql`.

**S1 · Nobody does anything (the default week).**
No taps, no pots, no rows, no coin. The feature is invisible to a manager who
isn't interested, and to a whole league that isn't.

**S2 · The offer nobody picks up.**
A puts ◎10 on SNF. B never answers. At SNF's picks lock the pot **voids** and
A's ◎10 goes straight back. Ignoring an offer is free and costs B nothing — the
ante only becomes a stake when somebody agrees it is one.

**S3 · The handshake.**
A puts ◎10 on SNF; B matches. The pot is live at ◎20 and **A acts first**,
because A led. B cannot act until A does — not even to check.

**S4 · The ladder.**
A wagers ◎20. B calls and raises ◎20 in one move. A calls. Either may keep
going; the ◎120 cap (◎60 a side) is what eventually stops them, and the UI's
slider stops there too.

**S5 · The bluff.**
A wagers ◎20 on SNF; A's SNF slot is actually weak. B backs out → A takes B's
◎10 ante, both sides' wagered chips return, and B never learns whether it was a
bluff. The sealed pick reveals at kickoff, but by then the coin has moved.

**S6 · Backing out, deep in.**
Antes ◎10+◎10. A wagers ◎20, B calls, A wagers ◎20 more. B backs out. **B is out
exactly ◎10** — their called ◎20 comes back — and A is up exactly ◎10, with
their ◎40 of wagers returned. However tall the ladder, backing out costs the
ante and nothing else.

**S7 · The unanswered wager.**
A wagers ◎30 forty minutes before picks lock. B doesn't get to it. At the close
the ◎30 goes back to A and the ◎20 of antes rides to the final. Nobody folded,
so nobody forfeits — a wager the opponent had no realistic window to answer
simply doesn't happen.

**S8 · Both act "simultaneously."**
A and B tap within the same second. All pot mutations take the per-matchup
advisory lock: the first write wins and passes the turn; the second arrives
against a pot where it is no longer that manager's move and is refused cleanly.

**S9 · Table stakes (one side is nearly broke).**
A has ◎190 banked; B has ◎12 after the ante. Effective stack =
`min(bank, bank, side cap − in)` → **no wager may put up more than B can
cover** (heads-up table stakes: no side pots, ever). A "wager all-in ◎12" is
legal and dramatic; a ◎50 wager against B simply isn't offerable. The slider
maxes at the effective stack, unexplained — bankroll privacy preserved (B's
exact balance isn't shown; "table stakes" is the tooltip).

**S10 · Can't afford the ante.**
Wallet under ◎10 at the moment you tap → the ante is refused, plainly, before
anything is charged. There is no short ante and no debt: an opt-in entry fee you
can't cover is simply an offer you don't make this week. It self-heals at next
week's stipend.

**S11 · The empty chair.**
B's seat is AI or an unenrolled no-show. The ante is refused up front — nobody
could answer it. Prevents ante/fold farming against nobody, and doesn't strand
A's ◎10 on an offer that could only ever void.

**S12 · Tie window.**
DEAD EVEN happens (it did in the very first live final's battle bar copy). The
pot was frozen symmetric at picks lock, so a tie hands each side its own half
back — nobody gains, nobody loses.

**S13 · Resolve re-runs / worker restarts.**
The worker re-resolves matchups every tick and after restarts. Every debit and
payout carries an idempotency key, so replays are no-ops — same posture as every
other wallet mutation in 0025/0035.

**S14 · Mulligan'd / edited lineups.**
Lineup edits before the window's lock don't touch the pot — you bet on the
window, not on a specific slot. Nothing to reconcile.

**S15 · Preseason (one-window weeks).**
Everything works at n=1 window: one optional ◎10 offer, one ladder, one
settlement. Good first live-fire target — the mechanic's smallest honest form.

## 7. Data model + RPCs

```
window_pot   matchup_id · game_window · leader (home|away) ·
             home_ante · away_ante · home_bet · away_bet ·
             state (offered|live|locked|void|folded_home|folded_away|settled|split) ·
             turn (home|away) · owed int · seq int · winner · settled_at
pot_action   id · matchup_id · game_window · seq · side · roster_id ·
             app_user_id · kind · amount · created_at   -- the log the UI renders
league.pot_ante int default 0    -- 0 disables per league; 10 = the entry fee
league.pot_cap  int default 120  -- ◎60 a side
```

The ante is banked apart from the wagers because backing out forfeits only the
ante — the two can never be added together at rest.

RPCs (all `security definer`, advisory-locked per matchup, wallet mutations via
the existing `spend_from_wallet` / `credit_wallet` with idem keys):
- `pot_ante(matchup, win)` — lead the offer, or match the one sitting there.
- `pot_act(matchup, win, action, amount)` — check · wager · call · raise · fold.
- `pot_sweep(matchup)` — void unmatched offers and freeze live ladders at picks
  lock, settle finished windows. The worker's tick and any participant's poll
  both call it (any-member-advances, like `draft_tick`).
- `pot_state(matchup)` — one-shot poll, oriented to the caller.

RLS: both participants read `window_pot` and `pot_action`; writes are RPC-only.

## 8. AI bidding personality (v3)

The slow-auction value model (0068) already prices players; a window version
prices lineups: AI antes when it likes a window, wagers when its projected total
comfortably leads, calls proportionally to closeness, backs out of heavy
dogs — **plus a seeded bluff rate (~15%)** so its wagers can't be read as pure
signal. Deterministic per (league, roster, week) seed, like every other AI
behavior.

## 9. UI

- Each window section grows a **pot chip** — on the window itself, not the
  battle bar, because the ladder is played while lineups are still being built.
  Untouched windows read `WINDOW POT · PUT ◎10 ON THIS WINDOW →`; a live one
  reads `POT ◎50 · YOUR MOVE →` and pulses when the ball is in your court.
- Tapping opens the action sheet: the pot, whose move it is, the countdown to
  picks lock, and the moves available right now (ante / match / check / wager /
  call / raise / back out). The wager slider maxes at the effective stack.
- Backing out asks for confirmation and spells out the cost: your ante, and
  nothing else.
- Wagers land as a log line in the duel feed: `"They wagered ◎15 on SNF"` —
  public by design; amounts are the signal.
- Settlement rides the existing final-state presentation, next to the
  `★ window + bonus = week` equation line and explicitly not part of it.

## 10. Rollout

1. Feature-flag per league (`pot_ante > 0`), default OFF; pilot leagues opt in.
2. **v1** = the opt-in ante + the wager ladder + settlement (S1–S15).
3. **v2** = live-street betting after kickoff, over Realtime, if playtesting
   wants it — v1 deliberately closes everything at picks lock.
4. **v3** = AI personality (§8) → retire the S11 empty-chair restriction for AI.
5. Analytics: offers made / matched / ignored, ladder depth, back-out rate, pot
   sizes — the tuning loop for the ante, the cap, and the bluff meta.

## 11. Open questions (argue here)

- **The flat back-out cost is the one to watch.** Because it's fixed at the
  ante, a call is reversible until picks lock, so the ladder measures conviction
  rather than pricing risk. If playtesting finds managers calling everything and
  bailing, the fix is to make backing out forfeit what you'd matched (the
  poker-standard rule) — a change confined to `pot_close`'s `'fold'` branch.
- Ante ◎10 vs ◎5 — is a fifth of the stipend the right price of entry?
- Should backing out leave a trace in season stats? Bluff economies need memory:
  a `back-outs forced / bluffs shown` tally per rival could be the best
  trash-talk surface in the game — or too much bookkeeping.
- Should betting reopen once a window is live, with the board showing (the old
  §3 "live street")? Cut from v1 to keep the whole ladder blind.
- Does the pot cap scale with premium leagues (bigger wallets) or stay flat?

## 12. What v1 shipped (2026-08-08, `v0.140.0`)

**Built:** the opt-in ◎10 ante, the turn-based wager ladder, the picks-lock
close, and settlement — every scenario in §6. **Not built:** live-street betting
after kickoff (§10.3) and the AI bidding personality (§8).

| Piece | Where |
|---|---|
| Schema + every RPC | `supabase/migrations/0106_window_pot.sql` |
| Scenario probes | `scripts/db/window-pot-probes.sql`, run by `scripts/db/run-scratch-probes.sh` |
| Worker sweep (close at lock, settle at final) | `server/src/pot.js`, called from `server/src/index.js` |
| Pot chip + action sheet | `src/screens/WindowPot.tsx`, mounted per window by `src/screens/Matchup.tsx` |
| Client API bindings | `src/data/liveApi.ts` (`potState` / `potAnte` / `potAct` / `potSweep`) |

### Two implementation notes worth knowing

- **The deadline is not a copy of the pick-lock rule, it IS the pick-lock rule.**
  `pot_lock_at()` is literally `window_kickoff(week, win) - interval '1 hour'`,
  the same expression `enforce_window_lock` enforces. A future change to the lock
  lead moves both at once, and there is no second place to remember.
- **The ante is stored apart from the wagers** (`home_ante` / `home_bet`) purely
  because backing out forfeits only the ante. Keeping them separate at rest means
  the fold payout is arithmetic rather than reconstruction, and the flat-cost rule
  can't drift if the ladder logic changes around it.

### Flipping the flag

The feature is per-league and OFF by default (`league.pot_ante = 0`). There is
no client write path to `league`, so turn it on from the Supabase SQL editor:

```sql
-- ON: ◎10 entry fee. Takes effect immediately — pots are created by managers
-- tapping, not by any scheduled pass, so there is nothing to wait for.
update league set pot_ante = 10 where name = 'Your Test League';

-- Optional: pot_cap 120 by default (◎60 a side).

-- OFF again: existing pots keep closing and settling (coin already committed
-- must come back), but no new offers can be made and no new moves accepted.
update league set pot_ante = 0 where name = 'Your Test League';
```

Worker changes need a `fly deploy`; the migration applies itself on merge to
`main` (`migrate.yml`). A league left at `pot_ante = 0` sees no trace of any of
this: no rows, no chip, no coin.
