# Drip Fantasy — Scoring Rulebook

Drip Fantasy is head-to-head fantasy where **what** you start matters less than
**how** you score it. Every slot is a hidden bet: a player *and* a secret
**metric** that decides how that player's real NFL game converts to points — and
how it attacks or defends against your opponent. Picks stay sealed until kickoff.

---

## 1. The shape of a week

Your lineup is **8 slots** spread across the five game windows:

| Window | When | Slots |
|---|---|---|
| TNF | Thursday night | 1 |
| SUN 1PM | Sunday early | 3 |
| SUN 4PM | Sunday late | 2 |
| SNF | Sunday night | 1 |
| MNF | Monday night | 1 |

- Each slot = **one player + one hidden metric**. A player is only eligible in the
  window their real NFL team plays.
- Head-to-head, your slots are paired against your opponent's **by window and slot
  position**. Slot 1 fights slot 1, etc.
- Your score is the sum of every slot's banked points. Most metrics also *attack*
  the slot they're matched against — so a slot can win by scoring big **or** by
  zeroing out the player across from it.
- Picks are **sealed**: neither side sees the other's players or metrics until the
  window locks at kickoff.

---

## 2. Two kinds of metric

Every metric does one or both of:

- **Scores** — banks points for you (flat points, or a *drip* that accrues over time).
- **Effects** — does something to the opponent slot (wipe, erase, halve, multiply…).

The catalog below lists each. The big idea: **flat metrics are predictable, drips
are explosive but fragile, and effect metrics win by denial.** It's
rock-paper-scissors — see §5.

---

## 3. The Drip system (the heart of the game)

Drip metrics (**Rush Yards**, **Receiving Yards**, and the Combo/Return unlocks)
don't score yards directly. Each productive touch raises a **rate** (points per
minute), and that rate **accrues over time while your team has the ball.**

- **Rate** = yards × **0.01**/min for a WR or RB · **0.005**/min for a TE (half).
  So a WR with 100 receiving yards builds a 1.0/min rate; a TE needs 200 yards for
  the same. Rate **builds gradually** — yards early in the game accrue over far more
  time than yards late.
- **Accrues only on offense** — the rate only ticks while that player's team
  possesses the ball, on the real game clock (it pauses at every quarter and half).
- **HOT** — **3 straight productive touches with no opponent score in between**
  doubles your drip (**×2**). A stuffed run (<3 yds), a short return (<10 yds), or
  an incompletion breaks the streak and cools you back to normal. (Combo/Return
  drips need **4** straight.)
- **A touchdown wipes the bank** — scoring a TD on a drip metric zeroes everything
  banked so far. The rate survives; the bank doesn't. (Drips reward *sustained
  production*, not boom plays — use a flat metric for a TD hunter.)

### WR vs TE drip — the key difference

| | WR / RB drip | TE drip |
|---|---|---|
| Rate | **0.01**/yd per min | **0.005**/yd per min (half) |
| Erase/pause immunity | **Fragile** — opponent catches erase + pause it | **Bulletproof** vs WR/RB erases & pauses |
| Cooled by per-play scorers? | Yes | **Yes** (immunity does *not* cover this) |

A TE drip can't be erased by an opposing receiver — but it builds at half rate, and
its hot streak can still be **cooled** by an opponent who banks points every play
(a passing QB). See the worked example in §6.

---

## 4. Metric catalog

### QB
| Metric | Scores | Effect |
|---|---|---|
| **Field General** (MULTIPLIER) | 0 direct | Passing yards set a **window-wide multiplier** on all *your* skill players (≈300 yds = 2.8×). The QB scores nothing himself. |
| **Passing Yards** (FLAT) | 0.04/yd + 4/TD | None — predictable. |
| **Rush Yards** (FLAT) | 0.1/yd + 6/TD | None. |
| **Air Raid** (unlock) | 0.04/yd + **10**/TD | None — TD-heavy flat. |

### RB
| Metric | Scores | Effect |
|---|---|---|
| **Rush Yards** (DRIP) | 0.01/yd → rate | Standard drip (fragile). |
| **Carries** (COMPRESSION) | 0.5/carry | A 3+ carry streak with no opponent score **trims the opponent's most recent score by 25% per further carry.** |
| **Receptions** (RATE RESET) | 1/catch | Each catch **zeroes the opponent's drip *rate*** — they keep the bank but rebuild from scratch. |
| **Touchdowns** (NUKE) | 6/TD | Each TD **wipes the opponent's entire bank to 0.** |
| **Combo Drip / Return Yards** (unlocks) | 0.01/yd → rate | Two touch streams feed one drip; need 4 straight to go hot. |

### WR
| Metric | Scores | Effect |
|---|---|---|
| **Receiving Yards** (DRIP) | 0.01/yd → rate | Standard drip (fragile). |
| **Receptions** (ERASE) | 1/catch | Each catch **erases the opponent's drip from the last 10 minutes.** |
| **Targets** (CLOCK STOP) | 0.5/target | Every target **stops the opponent's drip clock** — pure denial, no erase. |
| **Touchdowns** (NUKE) | 6/TD | Wipes the opponent's entire bank to 0. |
| **Combo Drip / Return Yards** (unlocks) | 0.01/yd → rate | Two-stream drip; 4 straight to go hot. |

### TE
| Metric | Scores | Effect |
|---|---|---|
| **Receiving Yards** (DRIP) | 0.005/yd → rate | Half rate, but **immune to WR/RB erases & pauses.** |
| **Targets** (WIDE ERASE) | 1/target | Every target — catch *or* incompletion — **erases the opponent's last 15 minutes.** Fires on volume. |
| **Receptions** (ERASE) | 1.5/catch | Erases the opponent's last 10 minutes. |
| **Touchdowns** (**8-PT NUKE**) | 8/TD | The strongest play in the game: wipes the matched opponent's bank **AND** knocks **every** opposing drip in the window down 1.0/min. |
| **Combo Drip / Return Yards** (unlocks) | 0.005/yd → rate | Half-rate two-stream drip; 4 straight to go hot. |

### K
| Metric | Scores | Effect |
|---|---|---|
| **Banker** (XP BONUS) | FG by distance | Each **XP made adds +1 pt to ALL your TDs** that week. |
| **Negation** (SHUTDOWN) | 0 | **6+ kicks → the matched opponent scores 0** and all their effects are negated. |

### DEF
| Metric | Scores | Effect |
|---|---|---|
| **Suppress** (HALVING) | 0 | Banks nothing; its defensive score (sk1 / int3 / fr2 / TD6) becomes a **kill-bar — every opponent slot in *any* window that scores at or below it is halved.** |
| **Earn Points** (FLAT) | sk1 / int3 / fr2 / TD6 / saf2 | Plain flat scoring. |

### IDP (DL / LB / DB)
| Metric | Scores |
|---|---|
| **Tackles** (FLAT) | tkl1 / sk2 / int3 / FR2 / TD6 / saf2 — steady, volume-driven. |
| **Splash Plays** (BIG PLAY) | sk4 / int6 / FR4 / TD6 / saf2 / tkl0.5 — boom-or-bust. |

---

## 5. Effects & counterplay

The hidden-metric layer is a counter game. The core triangle:

- **Drips** rack up the highest ceilings — but they're **fragile**:
  - **Receptions (ERASE)** wipes a drip's recent minutes.
  - **Targets (CLOCK STOP / WIDE ERASE)** denies on volume alone.
  - **RB Receptions (RATE RESET)** zeroes the rate itself.
  - **Touchdowns (NUKE)** / **TE TD (8-PT NUKE)** wipe the whole bank.
  - **Per-play scorers cool the HOT streak** — a flat passing QB that banks points
    every completion keeps your drip from ever doubling. (TE drips shrug off WR/RB
    scoring, but **not** a QB.)
- **Effect metrics** (erase / nuke / suppress / shutdown) win by **denial** — they
  score little themselves, so they lose to **flat scorers** that just pile up points
  and don't care about being erased.
- **Flat scorers** are steady but have no ceiling and no defense — they lose the
  big-points race to a drip that **goes hot**.

Cross-window effects reach beyond their own pairing: **Field General** multiplies
your whole window, **TE 8-PT NUKE** hits every drip in the window, **DEF Suppress**
halves matching slots in *any* window, and **K Banker** boosts *all* your TDs.

---

## 6. Worked example — why 127 yards scored 4 points

A TE posts **127 receiving yards, 0 TD** and banks just **4.0**, while a WR with
**60 yards + 2 TD** banks 16.0. Not a bug — a clean counter:

1. The TE drip builds at **half rate** (0.005), so 127 TE yards ≈ a 0.64/min rate —
   about the same as 60 WR yards.
2. The opponent slotted a **passing QB** — in fact *the TE's own QB*. Every catch
   was also a completion that **banked points for the opponent**, which **cools the
   TE's hot streak** every single time.
3. The TE is immune to *erases*, so the bank was never wiped — but he could never
   string 3 unanswered catches, so the drip **never went hot (×2)**. Half rate, no
   doubling → 4.0.

The counter to a drip isn't always an eraser — sometimes it's just a player who
**scores on every snap.** Pairing a catcher against his own QB is the sharpest
version of that read.

---

## 7. Banks, backups & edge cases

- **Missed picks** — if you don't set a slot, your league's policy decides: your
  best available lineup is auto-filled (default), an AI fills it, or it scores 0.
- **Backups** — depth behind a beatable starter can sub in; with two-plus unopposed
  slots, the rest bank half credit.
- **Overtime** — drip keeps ticking past regulation (with the Overtime power-up).
- **Garbage Time / Momentum / EMP** — power-ups bought with **drip-coin** (earned
  each week) can double late-game points, push a hot drip to ×3, or freeze an
  opponent's drip for 10 minutes. See the power-up shop in-app.

---

*This rulebook mirrors the live scoring engine (`src/data/metrics.ts`,
`src/engine/sim.ts`). If a number here disagrees with the game, the game wins —
tell us and we'll fix the doc.*
