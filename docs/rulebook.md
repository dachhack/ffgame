# Drip Fantasy — Scoring Rulebook

Drip Fantasy is head-to-head fantasy where **what** you start matters less than
**how** you score it. Every slot is a hidden bet: a player *and* a secret
**metric** that decides how that player's real NFL game converts to points — and
how it attacks or defends against your opponent. Picks stay sealed until kickoff —
**each window's kickoff**: your Sunday and Monday picks stay editable (and hidden)
after Thursday's game reveals, so what you learn can change what you play.

> **The §4 catalog and §6 power-up tables below are auto-generated** from
> `src/data/metrics.ts` and `src/data/powerups.ts` (run `npm run gen:rulebook`),
> so they can never drift from the live engine. The same data drives the in-app
> Rulebook (Settings gear → Rulebook). Edit prose by hand; never edit between the
> `AUTO-*` markers.

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
- Windows lock **one at a time, each at its own first kickoff** — a TNF pick is
  final Thursday night, but your SUN/SNF/MNF picks stay editable until those
  windows kick off. Thursday's reveal is intel: you can counter-pick the rest of
  your week against what your opponent already showed. (Pre-match power-ups are
  the exception — they arm only before the week's FIRST kickoff.)

---

## 2. Two kinds of metric

Every metric does one or both of:

- **Scores** — banks points for you (flat points, or a *drip* that accrues over time).
- **Effects** — does something to the opponent slot (wipe, erase, halve, multiply…).

The big idea: **flat metrics are predictable, drips are explosive but fragile, and
effect metrics win by denial.** It's rock-paper-scissors — see §5.

---

## 3. The Drip system (the heart of the game)

Drip metrics (**Rush Yards**, **Receiving Yards**, and the Combo/Return unlocks)
don't score yards directly. Each productive touch raises a **rate** (points per
minute), and that rate **accrues over time while your team has the ball.**

- **Rate** = yards × **0.01**/min for a WR or RB · **0.005**/min for a TE (half).
  Rate **builds gradually** — yards early in the game accrue over far more time than
  yards late.
- **Accrues only on offense**, on the real game clock (it pauses at quarter & half).
- **HOT** — **3 straight productive touches with no opponent score in between**
  doubles your drip (**×2**). A stuffed run (<3 yds), short return (<10 yds), or
  incompletion breaks the streak. (Combo/Return drips need **4**.)
- **A touchdown wipes the bank** — drips reward *sustained production*, not boom
  plays. The rate survives; the bank doesn't.

### WR vs TE drip — the key difference

| | WR / RB drip | TE drip |
|---|---|---|
| Rate | **0.01**/yd per min | **0.005**/yd per min (half) |
| Erase/pause immunity | **Fragile** — opponent catches erase + pause it | **Bulletproof** vs WR/RB erases & pauses |
| Cooled by per-play scorers? | Yes | **Yes** (immunity does *not* cover this) |

A TE drip can't be erased by an opposing receiver — but it builds at half rate, and
its hot streak can still be **cooled** by an opponent who banks points every play
(a passing QB). See the worked example in §7.

---

## 4. Metric catalog

<!-- AUTO-CATALOG:START -->

### Quarterback

| Metric | Tag | Scores | Effect |
|---|---|---|---|
| **Field General** | MULTIPLIER | 0 direct pts | Passing yards set a window-wide drip multiplier on all your skill players. 300 yds = 2.8×. The QB scores nothing himself. |
| **Passing Yards** | FLAT | 0.04 pts / yd + 4 / TD | Flat points on passing yards and TDs. No drip, no nuke, no interaction. Predictable. |
| **Rush Yards** | FLAT | 0.1 pts / yd + 6 / TD | Flat points on your scrambles and rushing TDs. Purely additive — no nuke, no erase, no interaction. |
| **Air Raid** | TD HEAVY | 0.04 / yd + 10 / TD | Unlock (1 wk): passing yards at 0.04/yd plus a huge 10 pts per passing TD. Flat — no nuke or erase. |

### Running Back

| Metric | Tag | Scores | Effect |
|---|---|---|---|
| **Rush Yards** | DRIP | 0.01 / yd → rate (pts/min) | Each carry permanently raises a drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. An opponent catch erases the last 10 min and pauses it; a target pauses it; a TD wipes the bank. Rate survives erases. 3 straight (no opponent score) goes hot → drip doubles; cold when they score. |
| **Carries** | COMPRESSION | 0.5 / carry | 0.5 per carry. A 3+ carry streak with no opponent score compresses: each further carry trims the opponent’s most recent score by 25% — and you keep a quarter of every point trimmed. |
| **Receptions** | RATE RESET | 1 pt / catch | Each catch zeroes the opponent’s active drip rate (they keep the bank, rebuild from scratch); against a flat scorer it halves their last play — and you steal a quarter of any points cut. |
| **Touchdowns** | NUKE | 0.04 / yd + 10 / TD | Boom-or-bust: scrimmage yards at a discount (0.04/yd) plus a big 10 per TD — and each TD wipes the opponent’s entire banked score AND steals a quarter of it. |
| **Combo Drip** | RUSH+REC DRIP | 0.01 / yd → rate (pts/min) | Unlock (1 wk, SINGLE-USE — one Combo Drip slot per lineup): carries AND catches both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; a TD wipes the bank. 4 straight productive touches goes hot → drip doubles (a stuffed run or incomplete cools it). |
| **Return Yards** | RUSH+RET DRIP | 0.01 / yd → rate (pts/min) | Unlock (1 wk): carries AND kick/punt return yards both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; 4 straight productive touches (rush 3+ / return 10+) goes hot → drip doubles, a stuffed run or short return cools it. |

### Wide Receiver

| Metric | Tag | Scores | Effect |
|---|---|---|---|
| **Receiving Yards** | DRIP | 0.01 / yd → rate (pts/min) | Each catch permanently raises a drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. An opponent catch erases the last 10 min and pauses it; a target pauses it; a TD wipes the bank. Rate survives erases. 3 straight (no opponent score) goes hot → drip doubles; cold when they score. |
| **Receptions** | ERASE | 1 pt / catch | Each catch erases the opponent’s drip from the last 10 clock-minutes — and you steal a quarter of every point you erase. |
| **Targets** | CLOCK STOP | 1 pt / target | Every target stops the opponent’s drip clock. No erase — pure denial. |
| **Touchdowns** | NUKE | 0.04 / yd + 10 / TD | Boom-or-bust: scrimmage yards at a discount (0.04/yd) plus a big 10 per TD — and each TD wipes the opponent’s entire banked score AND steals a quarter of it. |
| **Combo Drip** | RUSH+REC DRIP | 0.01 / yd → rate (pts/min) | Unlock (1 wk, SINGLE-USE — one Combo Drip slot per lineup): catches AND carries both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; a TD wipes the bank. 4 straight productive touches goes hot → drip doubles (a stuffed run or incomplete cools it). |
| **Return Yards** | REC+RET DRIP | 0.01 / yd → rate (pts/min) | Unlock (1 wk): catches AND kick/punt return yards both feed one drip rate (yds × 0.01 pts/min) that accrues while your team has the ball. Same pauses/erases as a normal drip; 4 straight (catch / 10+ return) goes hot → drip doubles, an incomplete or short return cools it. |

### Tight End

| Metric | Tag | Scores | Effect |
|---|---|---|---|
| **Receiving Yards** | DRIP | 0.005 / yd → rate (pts/min) | Each catch raises a drip rate (yds × 0.005 pts/min) — half a WR’s — that accrues while your team has the ball. Immune to WR/RB pauses and erases: only a TD (or K shutdown) stops it. 3 straight (no opponent score) goes hot → drip doubles. |
| **Targets** | WIDE ERASE | 1 pt / target | Every target — catch or incompletion — erases the opponent’s drip from the last 15 min (you steal a quarter of every point erased). Wider than any WR, and fires on volume alone. |
| **Receptions** | ERASE | 1.5 pts / catch | Each catch erases the opponent’s drip from the last 10 clock-minutes — and you steal a quarter of every point you erase. |
| **Touchdowns** | 12-PT NUKE | 0.04 / yd + 12 / TD | The strongest single play in the game. Yards at a discount (0.04/yd) plus 12 per TD; each TD wipes the matched opponent’s entire bank (you steal a quarter of it) AND knocks every opposing drip in the window down by 1.0 pts/min (min 0). |
| **Combo Drip** | RUSH+REC DRIP | 0.005 / yd → rate (pts/min) | Unlock (1 wk, SINGLE-USE — one Combo Drip slot per lineup): catches AND carries both feed one drip rate (yds × 0.005 pts/min, TE rate) that accrues while your team has the ball. Immune to WR/RB pauses like any TE drip; a TD wipes the bank. 4 straight productive touches goes hot → drip doubles (an incomplete cools it). |
| **Return Yards** | REC+RET DRIP | 0.005 / yd → rate (pts/min) | Unlock (1 wk): catches AND kick/punt return yards both feed one drip rate (yds × 0.005 pts/min, TE rate) that accrues while your team has the ball. Immune to WR/RB pauses like any TE drip; 4 straight (catch / 10+ return) goes hot → drip doubles, an incomplete or short return cools it. |

### Kicker

| Metric | Tag | Scores | Effect |
|---|---|---|---|
| **Banker** | XP BONUS | FG by distance | Each XP made adds +1 pt to ALL your TDs for the week. |
| **Negation** | SHUTDOWN | 0 pts | 6+ kicks → the matched opponent scores 0 and all their effects are negated. |

### Defense (DST)

| Metric | Tag | Scores | Effect |
|---|---|---|---|
| **Suppress** | HALVING | 0 pts | Banks 0 itself — instead its own defensive week score (sk/int/fr/TD) becomes a kill-bar: EVERY opponent slot, in ANY window, that scores at or below it is halved. |
| **Earn Points** | FLAT | sk1 / int3 / fr2 | Normal flat head-to-head scoring. No suppress, no halving. |

### IDP (DL / LB / DB)

| Metric | Tag | Scores | Effect |
|---|---|---|---|
| **Tackles** | FLAT | tkl 1 · sk 2 · int 3 · FR 2 | Flat defensive scoring: 1 per tackle, 2 per sack, 3 per interception, 2 per fumble recovery, 6 per defensive/ST TD, 2 per safety. Volume-driven and steady. |
| **Splash Plays** | BIG PLAY | sk 4 · int 6 · FR 4 · TD 6 | Rewards game-wreckers: 4 per sack, 6 per interception, 4 per fumble recovery, 6 per defensive/ST TD, 2 per safety, 0.5 per tackle. Boom-or-bust. |

<!-- AUTO-CATALOG:END -->

---

## 5. Effects & counterplay

The hidden-metric layer is a counter game:

- **Drips** have the highest ceilings — but they're **fragile**: erasers
  (Receptions / Targets), RB rate-reset, and TD nukes all gut them, and a **per-play
  scorer cools the HOT streak** (a flat passing QB that banks points every
  completion keeps your drip from ever doubling — TE drips shrug off WR/RB scoring,
  but **not** a QB).
- **Effect metrics** (erase / nuke / suppress / shutdown) win by **denial** — they
  score little, so they lose to **flat scorers** that just pile up points.
- **Flat scorers** are steady but capless — they lose the big-points race to a drip
  that goes hot.

Cross-window reach: **Field General** multiplies your whole window, **TE 8-PT NUKE**
hits every drip in the window, **DEF Suppress** halves matching slots in *any*
window, and **K Banker** boosts *all* your TDs.

---

## 6. Power-ups (the drip-coin economy)

You earn **drip-coin** each week and spend it on consumables — bought into your
inventory and spent when applied. Two kinds: **action** (a one-time tactical effect)
and **metric** (unlocks an extra metric for the current week only). **Timing** gates
when a power-up can be applied: *pre* locks once a window starts; *live* fires only
during a live window (never retroactive).

<!-- AUTO-POWERUPS:START -->

### Pre-kickoff
*arm during setup; locks once a window starts*

| Power-up | Cost | Kind | What it does |
|---|---|---|---|
| ➕ **Extra Slot** | ◎ 80 | action | Add a slot to any window — for you AND your opponent. Must be applied before any window starts. |
| 🏈 **Return Yards** | ◎ 60 | metric | This week only: unlock the Return Yards metric for a kick/punt returner — flat 0.1 pts per real return yard + 6 per return TD. |
| 💥 **WR/TE Carries** | ◎ 70 | action | Arm before kickoff: all week, every carry by a WR or TE in your starting spots wipes its matched opponent to 0 — a plus-up on TOP of whatever metric that slot is scoring. |
| 🌀 **Combo Drip** | ◎ 65 | metric | This week only: unlock a Rush + Receiving combo drip for ONE player (single-use — one Combo Drip slot per lineup). Both carries AND catches feed a single drip rate (yds × 0.01 pts/min). |
| 🚀 **Air Raid** | ◎ 60 | metric | This week only: unlock a QB metric where passing TDs are worth 10 pts (plus 0.04 / passing yd). Flat — no nuke or erase. |
| 🎺 **Trick Play** | ◎ 90 | action | Arm before kickoff: if ANY non-QB in your starting spots throws a TD pass this week, your lineup banks a flat +50. |
| 🛡️ **Pick Six** | ◎ 45 | action | Arm before kickoff: if any of your DST starters returns an INT or fumble for a touchdown, bank a flat +25. |
| 🙏 **Hail Mary** | ◎ 35 | action | Arm before kickoff: if a QB in your starting spots throws a touchdown of 40+ yards, bank a flat +15. |
| 📈 **Momentum** | ◎ 70 | action | Arm before kickoff: all week, your drips run 3× when hot instead of 2×. |
| 🗑️ **Garbage Time** | ◎ 75 | action | Arm before kickoff: any points your players score in the final 5 game-minutes count double. |
| 🌊 **Floodgates** | ◎ 85 | action | Arm before kickoff: your drips are immune to opponent pauses and erases all week (TD wipes still apply). |
| ⏱️ **Overtime** | ◎ 60 | action | Arm before kickoff: your Field General multiplier and drips carry into overtime. Without it they reset the moment regulation ends. |
| 🧊 **Overtime Shield** | ◎ 70 | action | Arm before kickoff: any points your opponent scores in overtime this week are negated. |
| 🎖️ **Twin Generals** | ◎ 85 | action | Arm before kickoff: a second Field General QB in the same window stacks — the top two multipliers multiply together instead of you taking just the higher one. |
| ↩️ **Counter-Nuke** | ◎ 95 | action | Arm before kickoff: the first time an opponent nukes one of your slots, it is reflected back — their player is wiped instead. |
| 🛟 **Insurance** | ◎ 80 | action | Arm before kickoff: the first time one of your slots is nuked, half its banked score is refunded instead of zeroed. |
| ⚖️ **Double or Nothing** | ◎ 80 | action | Stake one of your slots before kickoff: at FINAL it scores double if it wins its head-to-head, or zero if it loses. |
| 👁️ **Spy** | ◎ 40 | action | Before a window kicks off: pick any slate slot (blind) and reveal the opponent’s current sealed pick there — their player OR their chosen metric. They can still change it until kickoff; re-checking your peek is free. |
| 🪂 **Bye Steal** | ◎ 55 | action | Before kickoff, field one of your players who is on bye in an open slot for a flat projected score. |
| 🦅 **Ball Hawk** | ◎ 55 | action | Arm before kickoff: raise the turnover coin swing from 10 to 25 this week, across all windows — your giveaways cost more, their giveaways pay more. |

### In-game
*fire anytime a window is live (not retroactive)*

| Power-up | Cost | Kind | What it does |
|---|---|---|---|
| 🔀 **Metric Swap** | ◎ 30 | action | Change a slot’s effective metric. Real-time — applies going forward, not retroactive. |
| 🔁 **Player Swap** | ◎ 50 | action | Swap a slotted player for one on your bench — anytime, even mid-game. |
| 🎲 **Mulligan** | ◎ 30 | action | Re-roll one slot’s metric mid-game for free — does not spend a Metric Swap. |
| 💥 **EMP** | ◎ 65 | action | Fire during a live window to freeze every opponent drip in that window for 10 minutes. |

<!-- AUTO-POWERUPS:END -->

---

## 7. Worked example — why 127 yards scored 4 points

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

## 8. Banks, backups & edge cases

- **Missed picks** — your league policy decides: best available lineup auto-filled
  (default), an AI fills it, or it scores 0.
- **Backups** — depth behind a beatable starter can sub in for full value if it
  outscores them; otherwise it scores 0 (all-or-nothing — no partial credit).
- **Overtime / Garbage Time / Momentum / EMP** — power-ups (above) can keep drips
  ticking past regulation, double late points, push a hot drip to ×3, or freeze an
  opponent's drip.

---

*This rulebook mirrors the live scoring engine. If a number here disagrees with the
game, the game wins — tell us and we'll fix the doc.*
