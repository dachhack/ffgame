# Playtester — balance findings

_Produced by the headless harness in `tools/playtester/` over the pure engine
(`resolveLiveMatchup`), baked weeks 1–14. Deterministic and reproducible: every
number below re-runs from the seeds shown. Companion to `docs/playtester-handoff.md`._

## How to reproduce
```
npx tsx tools/playtester/season.mjs    --teams=12 --weeks=14 --seasons=40  # season economy (primary)
npx tsx tools/playtester/aggregate.mjs --week=1-14 --n=120 --seed=4242     # unilateral lever A/B
npx tsx tools/playtester/harness.mjs   --week=1-14 --n=300                 # single-week honest field
npx tsx tools/playtester/scenario.mjs  --week=1-14 --n=200                 # suspect probes
```

## Model (read this first)
- **Season start = 100 drip coin** (`wallet_seed()`, migration `0035`); weekly coin
  (stipend 50 + bounties + events) is **banked and carried over**, then spent next week.
- **Both sides run the same blind AI** — `aiLineup`/`aiBudgetPass` read only their own
  roster, never the opponent's players, metrics, or buys. The only opponent info that
  leaks pre-game is **extra-slot count** (it adds a slot for you too) and the opponent's
  **roster-by-window** (not their starters/metrics).
- **Extra Slot is SYMMETRIC**: a bought slot is added "for you AND your opponent", so it
  is **contested** — both sides field a bench player in it. (An earlier draft modeled it
  unilaterally and wrongly flagged it as a breaker; corrected below.)

## 1. Full-season AI vs AI — the headline (`season.mjs`, 40 seasons × 12 teams × 14 wk)
| signal | result | reading |
|---|---|---|
| **mean wallet by week** | hovers **96–101** all season | **economy is bounded** — spend ≈ earn, coin stays scarce, **no runaway** |
| **standings: full-budget vs no-power-up league** | **r = 0.96** | symmetric power-ups **cancel out** — buys barely move who wins |
| **mandatory-tax probe** (one team opts out all year) | 48.0% → **45.2%** (Δ 2.9 pts) | opting out is **~free** — power-ups are near-cosmetic to outcomes |
| **wins vs roster strength** | r = 0.61 | sim **rewards roster** (the thing it should) |
| **home win-rate** | 50.4% | fair, no structural bias |

**Conclusion: under the correct symmetric, blind, carried-over economy, the game is
well-balanced.** The "overpowered power-up" worry mostly dissolves in AI-vs-AI because
both sides buy the same things and they cancel — exactly the hypothesis. With the 100-coin
seed, weekly spend ≈ weekly earnings, so nobody accumulates a runaway war-chest. _(Side
effect of 100 coin: the AI now buys combo-drip + a buff or two and is **broke before it can
afford an 80-coin extra slot** — extra-slot stacking is effectively off the table for AI
play. Intended trade-off; flag if you want the AI to reach extra slots.)_

## 2. Unilateral lever A/B — "is a lever worth buying?" (`aggregate.mjs`)
Paired A/B (same two rosters, home arms one lever, away stripped honest; control home
WR ≈ 50%). This measures **unilateral EV** — the incentive to buy — *not* symmetric
balance (§1 covers that). 1,680 pairs/lever, seed 4242.

| lever | cost | home WR | margin lift | flag |
|---|--:|--:|--:|---|
| garbage-time | 75 | 60.8% | +14.5 | cheap edge |
| overtime | 60 | 60.1% | +14.5 | cheap edge · best pts/coin |
| **extra-slot ×2** | 160 | **59.3%** | +10.8 | _(was 67% unilateral; symmetric kills the runaway)_ |
| momentum | 70 | 58.9% | +15.7 | cheap edge |
| air-raid / combo-drip | 60/65 | 57.1% | +7.8 | cheap edge |
| **extra-slot ×1** | 80 | **56.6%** | +7.1 | _(was 61%; now just rewards bench depth)_ |
| floodgates / counter-nuke / insurance / ot-shield | 80–95 | ~51–53% | ~0 | **DEAD vs honest** |
| def-suppress / te-nuke (1 or all) | 0 | ~51% | ~0 | neutral |
| **rb-nuke / wr-nuke (all → td)** | 0 | **28–30%** | **−26 to −30** | **self-sabotage** |

### What's real vs what was an artifact
1. **Extra Slot is NOT a balance breaker** (correction). With the symmetric model its edge
   falls to 56–59% and the coin-farm vanishes — the opponent fields the contested slot too,
   so there's no free unopposed bounty. The residual edge just rewards **bench depth** (the
   buyer picks its deepest window). And at a 100-coin seed the AI can't afford it anyway (§1).
2. **Offensive buffs (overtime / garbage-time / momentum) have real unilateral EV
   (+10–15%)** because they amplify the dominant drip engine — so a rational team buys them,
   but they **cancel in symmetric play** (§1). Verdict: not breakers, but **homogenizing**
   (everyone wants the same three). A diversity lever, not a balance bug.
3. **Defensive buffs are dead vs the honest field** — floodgates / counter-nuke / insurance /
   ot-shield only pay against nukers / erasers / OT scoring, which the honest AI never fields.
   Correctly-priced *insurance*, mis-positioned as *staples*. (They will look different vs a
   nuking adversary — that's step 3's job to price.)
4. **NUKE is over-feared and under-powered — the opposite of the design doc's "strongest
   play".** A whole class of metrics is **strictly bad** in honest play: TE→`td` is neutral,
   RB/WR→`td` is catastrophic (−26 to −30 margin). Probes (`scenario.mjs`): a TE-TD nuke only
   **fires 31%** of the time and, when it fires, **win-rate is 46%** (below baseline); a
   stacked 2×TE-TD window banks a feeble **16–24 pts** while the opponent's drip **out-accrues
   the temporary wipe** (the −1.0/min knock barely dents a 3.0/min elite drip). This is **dead
   design space**, not a breaker — but worth a retune so NUKE is a viable counter.
5. **Field General + drip is the blow-up ceiling.** One FG QB turns a single WR drip slot into
   **60–150 pts**; **Twin Generals (`fg-stack`) multiplies that 1.5–1.8× more** → 100–240 on
   one slot. The honest AI never assembles it (needs 2 QBs in a window, both on `fg`, + the
   buy), so it's a **latent degenerate line for the adversary** (step 3) and the prime tuning
   candidate (the `1 + 0.003·passYds` curve stacked on itself is the explosive part).

### Harness limitations (be honest)
- The pure resolver does **not** model `double-or-nothing`, `turnover-boost`, `spy`,
  `trick-play`, `hail-mary`, `pick-six`, `bye-steal`, `metric/player-swap`, `mulligan`,
  `emp` — so those carry **no signal** here (the doc's "DoN ≠ 50%?" needs engine support).
- §2's defensive-buff verdict is **vs the honest field only**; price them vs a nuking
  adversary (step 3).

## 3. Recommendations
**Balance (retune targets), in priority order:**
1. **Revive NUKE as a counter** (finding 4). Options: make the TE-TD drip-knock *permanent
   and larger* (it's currently out-accrued), or scale the wipe to a share of the opponent's
   *rate* not just the banked total, or cut NUKE's opportunity cost so a `td` pick doesn't
   forfeit all drip. Use `aggregate.mjs` to confirm `td` lands near 50% (a real choice) without
   overshooting.
2. **Re-price the dead defensive buffs** (finding 3) or give them an honest-field use, so
   they aren't trap purchases vs non-nuking opponents.
3. **Watch the FG / Twin-Generals ceiling** (finding 5) once the adversary (step 3) shows how
   far a searching opponent can push it; the multiplier-on-multiplier is the thing to cap.
4. **Decide on the 100-coin / extra-slot interaction** (§1): at 100 the AI never reaches
   extra slots. Fine if intended; if you want extra-slots in the AI's repertoire, either
   raise the seed or re-order the budget pass.

**AI rule set** — the season sim shows the *current* blind AI is already balanced and
roster-driven, so there's **no honest-play win to chase from opponent-awareness** (and it
would violate the blind rule anyway — retracted from the earlier draft). The remaining AI
work is about **playing the retuned mechanics well**, measured by the harness:
- Once NUKE is a viable counter, teach the AI when to field it (still blind — off its own
  roster + the opponent's roster-by-window, never their starters/metrics).
- Lean into Field General (the highest honest ceiling): test lowering `FG_DRIP_THRESHOLD`
  and buying `fg-stack` when the roster has 2 QBs sharing a window.

_Next: build the adversary (step 3) to price the defensive buffs and the FG/Twin-General
ceiling against a searching opponent, then drive the NUKE retune through `aggregate.mjs`._
