# The Window Pot — ante / raise / call on every window

> **Status: SPEC — not built.** Written 2026-08-07, the morning after the first
> live-fire (preseason CAR@ARI). Pairs with `docs/powerups.md` (the Bets family
> this extends), `docs/premium-model.md` (the never-pay-to-win line), and the
> slow-auction machinery in `docs/native-league-plan.md` §3 (0068/0069), which
> this reuses for async turn-taking. Argue with the scenarios in §6 before
> anyone writes code.

## 1. The idea

Poker-style betting on each game window, between the two managers of a matchup.
Both sides **ante** drip-coin into a per-window pot; either side may **raise**;
the other **calls** or **folds**; the window's winner takes the pot.

Why this belongs in Drip specifically: betting rounds are an *information*
game, and this product already has poker's two ingredients — **hidden hands**
(sealed lineups) and **staged reveals** (each window flips at its own kickoff).
A raise on SNF is a claim about a sealed slot the opponent can't see… or a
bluff. No other fantasy product can offer that, because no other product has
sealed picks.

### Design goals
1. Every window has stakes by default (the ante), replacing "the +5 bonus
   isn't exciting" with chips physically on the felt.
2. Betting deepens the hidden-information core — signaling, bluffing, reading.
3. Zero new pressure on passive managers: standing policies answer for you.
4. The fantasy layer is untouched: **folding concedes coin, never points.**

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
| **Pot** | Per (matchup, window) coin pool. Winner of the window takes it at window final. |
| **Ante** | Auto-contribution from both wallets when the matchup locks. Default **◎5** per window (league-tunable; `0` disables the feature for a league). |
| **Street** | A phase in which raising is open. Streets follow the reveal structure (§3). |
| **Raise** | Add ◎N to the pot; the opponent owes a response. Min step ◎5. |
| **Call** | Match the outstanding raise. Pot grows symmetrically. |
| **Fold** | Concede the pot immediately. Your window still scores points normally. |
| **Check** | Do nothing. Perfectly fine; ante-only pots are the default outcome. |
| **Standing policy** | A hidden per-manager number: "auto-call raises up to ◎N per window." The async answer (§4). |
| **Effective stack** | `min(your bank, their bank, pot cap − pot)` — the most any raise can demand (§6, All-in). |

### Economy sizing (defaults, all league-tunable)
- Ante **◎5** × 5 windows = ◎25/week committed automatically — half the weekly
  stipend (◎50), before signature-play (+5s), MVP (◎15), and unopposed (◎15)
  income. Meaningful, not ruinous.
- **Pot cap ◎60 per window** (each side ≤ ◎30 in) — a maxed pot swings about
  one power-up's worth of coin. Keeps bankroll oppression impossible.
- Max **2 raises per side per street** — betting stays punchy, not a grind.

## 3. Streets — when betting is open

Betting on window **W** maps onto the existing lock/reveal timeline:

1. **Blind street** — from matchup lock (first kickoff − 1h) until W's first
   kickoff − 30 min. You know only your own lineup. Classic bluff country.
2. **Reveal streets** — re-opened for 1h each time an *earlier* window kicks
   off (its picks flip face-up). Thursday's reveal is the flop: you've seen
   part of their hand and can re-price your SNF confidence.
3. **The live street** — while W itself is live, until the earlier of W's last
   game reaching halftime or the pot capping. Raising with the board showing:
   your drip bank is fat and visible, and so is your nerve.
4. **Close** — betting on W ends at W's halftime. Settlement at window final.

**Last-raise cutoff:** no new raise may be OPENED in the final 30 min before a
street's hard close (kickoff or halftime) unless the opponent's standing
policy already covers it. A raise your opponent has no realistic window to
answer is a snipe, not a bet — the cutoff makes it structurally impossible.

**Response clocks:** a raise starts a response clock — **2h, quiet-hours
aware** (reuses the slow-auction `awake_deadline` arithmetic: clocks skip the
configured overnight hours, so nothing expires while a league sleeps). On the
live street the clock is **10 min** (both parties are presumed watching; the
standing policy answers for anyone who isn't). Clock expiry → standing policy
answers; policy insufficient → **auto-fold** (§6).

## 4. Standing policy — the async backbone

Every manager has `pot_auto_call` (default **◎10**): "call raises for me up to
this much per window." Set in the same UI family as the slow-auction hidden
max bids, and works identically — a hidden number the opponent never sees.

- Raise ≤ remaining policy allowance → **instant auto-call**. Feels live even
  when the opponent is asleep.
- Raise beyond allowance → response clock starts; the manager gets the push/
  UI prompt to call, re-raise, or fold by hand.
- Clock expires unanswered → auto-fold (the raiser takes the pot as it stood
  BEFORE the unanswered raise — see §6, "expired clock").

**Fair-play rule:** if the opponent seat is AI-controlled with no bidding
policy, or an unenrolled/no-show manager, the window is **ante-only** — raises
are disabled. You cannot farm an empty chair. (AI seats WITH the bidding
personality enabled — §8 — count as having a policy.)

## 5. Settlement

At window final (the same resolve pass that pays the +5 bonus and MVP coin):
- Win → pot credits the winner's wallet (`credit_wallet`, idempotent key
  `pot:<matchup>:<window>`; re-resolves can never double-pay).
- **Dead-even window → split**; odd chip goes to the away/lower roster id
  (deterministic, documented, boring on purpose).
- A fold settles **immediately** (pot to the non-folder) — no waiting for the
  window to finish. The battle bar shows `POT ◎20 → taken (they folded)`.
- Every ante/raise/call is **debited at commit time** (`spend_from_wallet`,
  idempotent per action id) — committed money leaves the bank the moment it
  enters the pot, exactly like parallel-auction committed budgets (0069), so
  you can never promise coin you've since spent in the shop.

## 6. Scenarios, played out

The heart of the spec. Every rule above earns its keep here.

**S1 · Nobody does anything (the default week).**
Both ante ◎5 at lock. No raises. Window finals → winner +◎10 (net +5).
A tie splits it back. The feature never demanded a single tap.

**S2 · The bluff.**
A raises ◎15 on SNF during the blind street; A's SNF slot is actually weak.
B's policy (◎10) doesn't cover it → B is prompted. B folds → A takes the
◎10+◎15 pot* immediately, and B never learns whether it was a bluff — the
sealed pick reveals at kickoff, but by then the coin has moved. (*See S3 for
what "the pot" contains mid-raise.)

**S3 · What's in the pot when someone folds mid-raise?**
Antes ◎5+◎5. A raises ◎15 (A has now committed ◎20). B folds. B loses only
the ante; A's raise **returns to A** and A takes both antes → A nets +◎5, B
nets −◎5. Rationale: in heads-up poker an uncalled bet is returned — you win
what was *matched*, not what you merely offered. Prevents "raise huge, win
huge from a fold" farming; a fold always costs the folder exactly their
matched contribution (usually just the ante).

**S4 · Auto-call, exactly on the line.**
B's policy is ◎10. A raises ◎10 → instant auto-call, pot ◎30, B's remaining
policy for this window is ◎0. A raises ◎10 again (street allows 2 raises) →
policy exhausted → B prompted; clock runs. Policy is a per-window allowance,
not per-raise — otherwise two ◎10 raises would sneak past a "◎10 max" intent.

**S5 · Expired clock.**
A raises ◎20 beyond B's policy. B never responds (2h quiet-hours-aware clock
expires). **Auto-fold**: per S3, B loses their matched contribution to that
point, A's unanswered ◎20 returns, A takes the matched pot. The prompt UI and
push notification make silence a choice, and the S3 refund rule caps the
damage of sleeping through it at the already-matched amount.

**S6 · All-in (one side is nearly broke).**
A has ◎200 banked; B has ◎12 (spent big in the shop). Effective stack =
min(bank, bank, cap−pot) → **no raise may demand more than B can match**
(heads-up table-stakes: bet only what the shorter stack can call — no side
pots, ever). A "raise all-in ◎12" is legal and dramatic; a ◎50 raise against
B simply isn't offerable. The UI shows the raise slider maxing at the
effective stack, unexplained bankroll privacy preserved (B's exact balance
isn't shown — the slider just stops; "table stakes" is the tooltip).

**S7 · Can't afford the ante.**
Wallet < ◎5 at matchup lock (possible after a shop spree — the AI budget pass
seeds wallets, but humans can zero out). Options considered:
- ~~Skip the ante, window has no pot~~ — punishes the opponent, invites
  strategic poverty ("spend to zero so my windows are ante-free").
- ~~Debt / negative wallet~~ — new failure states everywhere, no.
- **Chosen: short ante.** You ante what you have (◎0 is legal). The pot is
  asymmetric; if you WIN the window you take only *matched* coin (your ◎0
  matches ◎0 of theirs — their unmatched ante returns), if you lose they take
  your short ante. Raising requires a positive effective stack, so a broke
  manager can check/fold but not raise. Poverty is survivable, never
  advantageous, and self-heals at next week's stipend.

**S8 · Both raise "simultaneously."**
A and B tap raise within the same second. All pot mutations take the
per-matchup advisory lock (same serialization as draft picks): first write
wins and becomes the raise; the second arrives against a changed pot and
comes back to its author as "pot changed — your raise is now a re-raise of
◎N, confirm?" No corrupted pots, no double-counts.

**S9 · Raise pending when the street hard-closes.**
A raises 40 min before kickoff (legal — before the 30-min cutoff); B's clock
would run past kickoff. The street's hard close **forces resolution at
close**: policy covers it → auto-call; else → auto-fold per S5/S3. A raise
can never straddle the reveal (nobody gets to answer a blind-street raise
with post-reveal information).

**S10 · The live-street hero call.**
W is live; A's drip bank visibly leads 22–9. A raises ◎20 ("pay to see the
ending"). B has watched their own SNF stud warming up for a 4th-quarter
comeback script and CALLS. Everything settles at window final as usual. This
is the moment the feature exists for — chips moving while the board burns.
Live raises ride the existing Realtime channel; the 10-min clock + standing
policy covers a manager who put the phone down.

**S11 · The empty chair.**
B's seat is AI-without-personality or an unenrolled no-show. Ante-only (§4
fair-play): pots exist (the ambient stakes stay) but no raising. Prevents
ante/fold farming against nobody. When the AI bidding personality ships (§8),
AI seats graduate to full participation and this rule applies only to
unenrolled humans.

**S12 · Tie window.**
DEAD EVEN happens (it did in the very first live final's battle bar copy).
Pot splits; odd chip to the away side. With S3's matched-only rule the pot is
always even unless a short ante (S7) made it asymmetric — a tie there returns
each side's own contribution.

**S13 · Resolve re-runs / worker restarts.**
The worker re-resolves matchups every tick and after restarts. All pot debits
and credits carry idempotency keys (`pot:<matchup>:<window>:<action-seq>`), so
replays are no-ops — same posture as every other wallet mutation in 0025/0035.

**S14 · Mulligan'd / edited lineups.**
Lineup edits before a window's lock don't touch the pot — you bet on the
window, not on a specific slot. Nothing to reconcile.

**S15 · Preseason (one-window weeks).**
Everything works at n=1 window; the ante is a single ◎5 and streets 2 (reveal)
don't exist. Good first live-fire target — the mechanic's smallest honest form.

## 7. Data model + RPCs (sketch)

```
window_pot        matchup_id · game_window · pot_you int · pot_them int ·
                  state (open|folded_you|folded_them|settled|split) ·
                  street (blind|reveal|live|closed) · raise_pending jsonb ·
                  raise_deadline timestamptz · updated_at
pot_action        id · matchup_id · game_window · app_user_id · seq int ·
                  kind (ante|raise|call|fold|auto_call|auto_fold|settle) ·
                  amount int · created_at        -- the audit log the UI renders
league_membership.pot_auto_call int default 10   -- standing policy (hidden)
league.pot_ante int default 5                    -- 0 disables per league
```

RPCs (all `security definer`, advisory-locked per matchup, wallet mutations
via existing `spend_from_wallet` / `credit_wallet` with idem keys):
- `pot_ante_all(matchup)` — worker calls at lock; short-antes per S7.
- `pot_raise(matchup, win, amount)` — validates street window, cutoff, raise
  count, effective stack (S6); starts the response clock; instant-resolves
  against the opponent's policy when covered.
- `pot_respond(matchup, win, action)` — call / re-raise / fold.
- `pot_sweep()` — worker tick: expire clocks (S5), force street closes (S9),
  settle finals (S13). Client polls can call it too (any-member-advances,
  like `draft_tick`).

RLS: both participants read `window_pot` and `pot_action`; `pot_auto_call` is
owner-only (the hidden number). Writes RPC-only.

## 8. AI bidding personality (v3)

The slow-auction value model (0068) already prices players; a window version
prices lineups: AI raises when its projected window total comfortably leads,
calls proportionally to closeness, folds heavy dogs — **plus a seeded bluff
rate (~15% of blind streets)** so its raises can't be read as pure signal.
Deterministic per (league, roster, week) seed, like every other AI behavior.

## 9. UI

- **Battle bar** grows a pot chip: `POT ◎20` with the felt-chip art in card
  theme; tapping opens the action sheet (raise slider capped at effective
  stack / call / fold, street + clock shown).
- Raises land as felt animations (chips slide in) + a log line in the duel
  feed: `“They raised ◎15 on SNF”` — public by design; amounts are the signal.
- Settlement rides the existing final-state presentation: pot chips slide to
  the winner next to the `★ window + bonus = week` equation line.
- Standing policy lives next to the slow-auction max-bid setting.

## 10. Rollout

1. Feature-flag per league (`pot_ante > 0`), default OFF; pilot leagues opt in.
2. **v1** = ante + blind street + standing policy + settlement (S1–S9, S12–S15).
3. **v2** = reveal streets + live street (S10) over Realtime.
4. **v3** = AI personality (§8) → retire the S11 ante-only restriction for AI.
5. Analytics: `pot_raise`, `pot_fold`, `pot_auto_call`, pot sizes, fold rates —
   the tuning loop for ante size, caps, and the bluff meta.

## 11. Open questions (argue here)

- Ante ◎5 vs ◎10 — is 10% of stipend per window ambient enough, or timid?
- Should fold reveal ANYTHING (e.g. "folded pre-reveal") in the season stats?
  Bluff economies need memory: a `folds forced / bluffs shown` tally per rival
  could be the best trash-talk surface in the game — or too much bookkeeping.
- Live-street close at halftime vs end-of-window: halftime chosen so late
  garbage-time can't turn settled pots into coin flips; playtest may disagree.
- Does the pot cap scale with premium leagues (bigger wallets) or stay flat?
