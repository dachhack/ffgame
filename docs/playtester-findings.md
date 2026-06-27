# Playtester — round 1 balance findings

_Produced by the headless harness in `tools/playtester/` over the pure engine
(`resolveLiveMatchup`), baked weeks 1–14. Deterministic and reproducible: every
number below re-runs from the seeds shown. Companion to `docs/playtester-handoff.md`._

## How to reproduce
```
npx tsx tools/playtester/harness.mjs   --week=1-14 --n=300            # honest field
npx tsx tools/playtester/aggregate.mjs --week=1-14 --n=120 --seed=4242 # lever A/B
npx tsx tools/playtester/scenario.mjs  --week=1-14 --n=200            # suspect probes
```

## 1. The honest field (baseline meta)
4,200 matchups (300/week × 14), both sides the shipping AI on its real loadout:

| | value |
|---|---|
| team score | mean **115**, p95 212, max **441** |
| margin (abs) | mean ~55, p95 ~150 |
| drip-coin / side / week | mean **82**, p95 110, max **160** |
| home win-rate | **49.0%** (no structural bias — the harness is fair) |
| biggest single slot | **200–295 pts**, always a drip metric (`rush` / `recyd` / `combodrip`) |

**Takeaways.** The game is **blowout-heavy** (mean margin ~half the mean score) and
its scoring is dominated by a **heavy right tail**: a single Field-General-multiplied
drip slot routinely outscores an entire normal lineup. There is **no per-week coin
cap**, and coin already spreads 50→160 in honest play.

## 2. Lever A/B vs the honest field
Paired A/B (same two rosters resolved with/without one lever on the home side; control
home win-rate ≈ 50%). 1,680 pairs/lever (120/week × 14), seed 4242.

| lever | cost | home WR | margin lift | avg coin | flag |
|---|--:|--:|--:|--:|---|
| **extra-slot ×2** | 160 | **67.0%** | +22.0 | **114.8** | DOMINANT · COIN-RUNAWAY |
| **extra-slot ×1** | 80 | **61.1%** | +13.6 | 99.0 | DOMINANT · cheap edge |
| **garbage-time** | 75 | **60.8%** | +14.5 | 81.8 | DOMINANT |
| **overtime** | 60 | **60.1%** | +14.5 | 81.8 | DOMINANT · best pts/coin |
| **momentum** | 70 | 58.9% | +15.7 | 81.8 | cheap edge |
| air-raid (`passbig`) | 60 | 57.1% | +7.8 | 81.8 | cheap edge |
| combo-drip | 65 | 57.1% | +7.9 | 80.7 | cheap edge |
| ot-shield | 70 | 53.2% | +2.3 | 81.8 | ~dead vs honest |
| carries-wipe | 70 | 53.0% | +1.9 | 87.3 | dead vs honest |
| **floodgates / counter-nuke / insurance** | 85/95/80 | ~51.5% | **0.0** | 81.8 | **DEAD vs honest** |
| def-suppress | 0 | 51.2% | -0.4 | 84.3 | neutral |
| **te-nuke (1 or all TEs)** | 0 | 50.9% | -0.3 | 81.5 | neutral |
| **rb-nuke (all RBs → td)** | 0 | **29.9%** | **-26.0** | 81.1 | **self-sabotage** |
| **wr-nuke (all WRs → td)** | 0 | **28.5%** | **-30.1** | 82.1 | **self-sabotage** |

### Headline findings
1. **Extra Slot is the strongest *and* self-funding purchase.** It wins (61–67%) **and**
   farms coin (each slot adds ~**+16 coin/week**, linearly, uncapped — probe D: 82→99→115).
   A unilaterally-bought slot is unopposed → best-ball backup score **plus** the 15-coin
   unopposed bounty. With no coin cap this **compounds** week over week. _This is the
   clearest balance breaker._ Suggested retune: cap extra slots' coin, or pair the
   bounty to actually-contested slots, or raise the price past its self-funding point.
2. **Drip-amplifier buffs are cheap edges; defensive buffs are dead.** `overtime` (60),
   `garbage-time` (75), `momentum` (70) each buy a real **+6–11% win-rate** because they
   amplify the dominant drip engine. `floodgates`, `counter-nuke`, `insurance`,
   `ot-shield` are **near-zero vs the honest field** — they only pay against nukers /
   erasers / OT scoring, which the honest AI doesn't field. They are correctly-priced
   *insurance*, mispriced as *staples*.
3. **NUKE is over-feared and under-powered in honest play — the opposite of the design
   doc's "strongest play".** Forcing TEs to `td` is net-neutral (50.9%); forcing RBs/WRs
   to `td` is **catastrophic** (28–30%). Reasons (scenario probes A/B): a TE-TD nuke only
   **fires 31% of the time** (the TE must actually score), and **when it fires win-rate is
   46%** — *below* baseline; a stacked 2×TE-TD window banks a feeble **16–24 pts** while
   the opponent's drip **out-accrues the temporary wipe** (the −1.0/min knock barely dents
   a 3.0/min elite drip). Choosing `td` forfeits your own drip, which is where the points
   are. **NUKE is a situational counter, not a dominant line.**
4. **Field General + drip is the real power concentration / blowup engine.** A *single*
   FG QB turns one WR drip slot into **60–150 pts** (probe C). **Twin Generals (`fg-stack`,
   85)** multiplies that by a further **1.5–1.8×** → a single slot at **100–240 pts**. The
   honest AI never assembles this (needs 2 QBs in one window, both on `fg`, + the buy), so
   it's a latent **degenerate line for the adversary** (build-plan step 3) and the prime
   candidate to retune (`1 + 0.003·passYds` is steep; `fg-stack` multiplying two steep
   curves is the explosive part).

### Harness limitations (be honest about these)
- The pure resolver does **not** model `double-or-nothing`, `turnover-boost`, `spy`,
  `trick-play`, `hail-mary`, `pick-six`, `bye-steal`, `metric/player-swap`, `mulligan`,
  `emp` — so the doc's "`double-or-nothing` ≠ 50%?" question **can't be answered yet**.
  It needs engine support or a separate driver.
- Defensive-buff value is measured **vs the honest field only**. Against a *nuking
  adversary* (step 3) `counter-nuke` / `insurance` / `floodgates` will look very
  different — that's the right place to price them.

## 3. Proposed AI improvements (to drive with the harness as the fitness fn)
The harness is the fitness function: each change ships only if it lifts honest
win-rate. **Crucially, the data redirects the handoff's improvement ordering** — the
biggest wins are in **coin budgeting**, not threat-aware metric swaps (NUKE *loses*).

1. **Reprioritise `aiBudgetPass` (`server/src/lock.js`) — extra-slots + offensive buffs
   first.** Today it buys combo-drip → 3 *random* buffs → extra-slots *last* (only if
   affordable). But extra-slot is the strongest, self-funding buy and the random buff
   draw wastes coin on dead defensive buffs. New order: **extra-slots up to the cap →
   the high-EV offensive buffs (`overtime`, `garbage-time`, `momentum`) → combo-drip →
   rest.** Expected: clear honest win-rate lift; measure with `aggregate.mjs` framing the
   improved budget pass as a "lever".
2. **Make defensive buys opponent-aware.** `aiLiveBuffs` draws blindly. Buy
   `floodgates` / `counter-nuke` / `insurance` **only when the opponent's revealed picks
   contain `td` (nuke) or `rec`/`tgt` (erase/stop) metrics** — otherwise they're dead
   coin (finding 2). This is honest (post-lock the opponent is revealed) and EV-positive.
3. **Lean into Field General; consider Twin Generals.** Drip-stacking is the highest
   ceiling (finding 4). The current `FG_DRIP_THRESHOLD = 2` is conservative; test
   lowering it, and have the AI buy `fg-stack` when it holds **2 QBs in one window**.
4. **Leave the metric defaults mostly alone.** The handoff's improvement #1 (threat-aware
   metric selection, e.g. "nuke into a drip-heavy opponent") is **low/negative value** in
   honest play — the position defaults already beat the alternatives. Don't chase it;
   spend the complexity budget on (1)–(3).

_Next: build the adversary (step 3) to price the defensive buffs and the FG/Twin-General
ceiling against a searching opponent, then implement improvement #1 above and confirm the
lift._
