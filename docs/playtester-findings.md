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
5. **A single Field General + drip is the blow-up engine — but it's slot-efficient and self-
   limiting, so it is NOT a balance bug.** One FG QB turns a WR drip slot into **60–150 pts**
   for one QB slot. _Twin Generals (`fg-stack`) is NOT the degenerate corner an early draft
   implied_ — that framing measured only the boosted slot and ignored that **both QBs score 0**.
   Measured NET of the two dead slots, Twin Generals beats its best alternative (usually a
   single general) in just **10/14 weeks and only modestly (+3 to +24)**, *loses* 4/14 (down to
   −24 when a QB underperforms), and the single-general line is consistently competitive — and
   this is the *best case* (top-2 QBs, hindsight). It also needs 2 QBs in the *same* game window
   and eats two slots to boost the *one* drip that remains in a 3-slot window. That's why the
   hindsight adversary (step 3) **never picks it**. **Verdict: keep it — the opportunity cost
   balances it.** Any FG ceiling concern is about the *single* FG curve (`1 + 0.003·passYds`) +
   amplifier compounding (§ probe 2), not Twin Generals — and even that cancels in symmetric play (§1).

### Harness limitations (be honest)
- The pure resolver does **not** model `double-or-nothing`, `turnover-boost`, `spy`,
  `trick-play`, `hail-mary`, `pick-six`, `bye-steal`, `metric/player-swap`, `mulligan`,
  `emp` — so those carry **no signal** here (the doc's "DoN ≠ 50%?" needs engine support).
- §2's defensive-buff verdict is **vs the honest field only**; price them vs a nuking
  adversary (step 3).

## 3. The adversary — hindsight exploit oracle (`adversary.mjs`)
A search tool (not what ships): a MIRROR roster vs a fixed honest opponent (baseline
margin **exactly 0**, verified), where the adversary searches its loadout WITH hindsight.
Any margin is a pure loadout exploit on identical material. 560 draws (40/wk × 14).

| budget | adversary win | avg margin | avg cost |
|---|--:|--:|--:|
| **0 (metrics only, FREE)** | **94.6%** | +11.8 | 0 |
| 65 (one unlock) | 100% | +23.4 | 61 |
| 135 | 100% | +39.6 | 127 |
| 200 | 100% | +62.7 | 191 |

**Recurring exploit levers** (share of draws the search adopts): `RB→combodrip` (>100% —
it stacks *multiple* RBs onto Combo Drip), `QB→passbig` (air-raid) 65%, `+garbage-time`
53%, `+overtime` 41%, `+momentum` 30%, plus `WR/TE→tgt` (denial) as a counter to the
opponent's drip. **Top lines reach +160 to +260** for ~195 coin — all built on **Combo-Drip
RB stacks + a drip amplifier (momentum/overtime/garbage-time)**.

### What the adversary teaches
1. **The degenerate engine is the DRIP ECONOMY — Combo Drip + amplifiers — not the
   handoff's suspects.** The search almost never reaches for FG×FG / Twin Generals or TE-TD
   nuke cascades; it pours points through stacked Combo Drip amplified by momentum/overtime.
   `td` (NUKE) shows up only as a situational counter (~15% of draws), never as the engine —
   confirming §2's "NUKE is weak" from the other direction.
2. **Honest play is reliably beatable by an INFORMED opponent, and the cheapest exploit is
   already reachable** (100% win for one 65-coin unlock). Two honest caveats: (a) it's
   hindsight, so on identical material with a 0 baseline *some* positive margin is expected —
   the **structural** signal (the narrow combodrip+amplifier region) is the takeaway, not the
   raw margin; (b) the opponent here runs no buffs (for a clean 0 baseline), so PAID margins
   are an upper bound. **In symmetric play these buys cancel (§1)** — the exploit bites only
   a *fixed*, non-adapting opponent.
3. **Combo Drip is largely PRE-GAME knowable** (`wantsComboDrip` reads season stats, not
   hindsight), so most of this edge is **blind-legal** — i.e. a smarter shipping AI could
   capture it without cheating. The honest AI's 20/20-ypg combodrip gate is **too
   conservative**: the adversary arms combodrip far more widely and wins.

## 4. Recommendations
**Balance (retune targets), in priority order — now informed by the adversary (§3):**
1. **The drip economy is the dominant strategy region — tune it first.** Combo Drip stacked
   with momentum/overtime/garbage-time is where every exploit line lives (§3). It doesn't
   *break* symmetric play (it cancels, §1), but it's the gravity well: the most rewarding,
   least diverse path. Consider a Combo-Drip cost/limit (one per lineup?), a softer amplifier
   stack (diminishing returns when momentum+overtime+garbage-time pile on the same drip), or
   a drip-rate cap, and re-measure the adversary's ceiling.
2. **Revive NUKE as a counter** (§2 finding 4). It's strictly bad today (RB/WR→`td` is −26/−30;
   TE-TD fires 31% and *lowers* win-rate) and the adversary only touches it situationally.
   Make the TE-TD drip-knock permanent/larger (it's currently out-accrued) or cut NUKE's
   opportunity cost, then confirm `td` lands near 50% in `aggregate.mjs` without overshooting.
3. **Defensive buffs — DONE (§9): they're situational counters, not mis-priced.** Re-measured
   vs a nuker now that NUKE is lethal: `counter-nuke` is strong and correctly priced (77% / +33),
   `insurance` was broken by the nuke retune and was fixed to also protect the drip (now +15,
   earns its cost). `floodgates`/`ot-shield` counter erase-stop/OT metas the honest AI doesn't
   run — dead now, but that's correct for a counter (like counter-nuke vs a non-nuker). No price
   changes. The §2 "DEAD vs honest = trap" framing was wrong.
4. **Do NOT nerf Twin Generals (`fg-stack`)** — measured net of its two zeroed QB slots it's a
   high-variance, slot-expensive gamble that wins only modestly and loses 4/14 weeks (§2 finding
   5); the opportunity cost already balances it and the adversary never picks it. If any FG
   tuning is wanted at all, it's the *single* FG curve + amplifier compounding — and even that
   cancels symmetrically (§1), so it's a feel/variance call, not a balance fix.
5. **Decide the 100-coin / extra-slot interaction** (§1): at 100 the AI never reaches an
   80-coin extra slot. Fine if intended; raise the seed or re-order the budget pass otherwise.

**AI rule set** — see §5: the first iteration is **done and validated**. (Note: the §3
hypothesis "loosen Combo Drip" was tested in `iterate.mjs` and **rejected** — at the 100-coin
seed combodrip crowds out a better buff and only helps a genuine dual-threat. The actual win
was fixing the AI's buff buying. This is exactly why we measure before shipping.)

## 5. AI iteration — first validated change (`iterate.mjs`, step 4)
Method: pit a candidate AI policy against the current one on a **mirror roster, both blind**
(same players → the margin is the pure policy edge). Sweep, pick the winner, ship it, re-check
for regressions. 1,680 mirror draws/policy.

| candidate vs current | win vs current | avg margin |
|---|--:|--:|
| loosen combodrip gate (10/6, 8/5, …) | 39–41% | ~0 | _(rejected — no edge)_ |
| **buy EV buffs (momentum/overtime/garbage-time), drop the random draw** | **59.5%** | **+6.6** |
| combodrip-first then EV buffs | 24% | +3.0 | _(crowds out the buff)_ |

**Root cause:** the shipping AI drew 3 buffs at *random* from a pool that included the
defensive buffs `floodgates`/`ot-shield` — **dead vs the honest field (§2)** — and bought the
`combodrip` unlock *first*. At a 100-coin seed you can afford only one thing, so it often
bought a dead buff or spent on combodrip (which only pays for a true dual-threat) instead of a
drip amplifier that always helps. **Fix (shipped):**
- `src/data/aiLineup.ts` — `AI_LIVE_BUFFS` → `['momentum','overtime','garbage-time']` (EV
  order, dead defensive buffs dropped); `aiLiveBuffs` returns them rotated per team, not sampled.
- `server/src/lock.js` (`aiBudgetPass`) + the harness mirror — **buy buffs before the combodrip
  unlock**.

**Validation (no regression):** season sim after the change — economy still bounded (wallet
94–101), cancellation r=0.95, wins-vs-roster r=0.60, home WR 50.4%, mean team score 58→60; buy
mix is now all EV buffs (no dead buffs), combodrip only when a team banks enough (~1/season).

**On the adversary:** its margin over the AI is **unchanged** (FREE ~flat, PAID +68→+72) — and
that's expected. We improved the AI's *blind buying*, not the game's *mechanics*; a hindsight
oracle with 2× the budget inherits the better buffs for free and exploits past them, so its
ceiling is mechanic-bound. The right proof of this change is the **head-to-head** above, not the
oracle margin. To pull the oracle's ceiling down you must retune mechanics (the drip economy /
NUKE, §4) — the next lever.

_Next: a mechanics retune (drip-amplifier diminishing returns and/or a Combo-Drip limit) driven
by the adversary's ceiling, then re-validate that the oracle's margin actually falls._

## 9. Defensive buffs vs a nuker (`defense.mjs`) — situational counters, insurance fixed
§2/§4 flagged the defensive buffs as "dead vs the honest field." With NUKE now lethal (§6) we
re-measured them against a **nuker** (away flips its actual-TD-scorers to `td` so the nukes land;
a TD-landing nuker beats an unbuffed honest home by ~10 pts). Home (the victim) arms one buff,
paired vs unbuffed. Yardstick: the offensive buffs are ~2 pts/10c.

| buff | cost | home WR vs nuker | margin lift | pts/10c | verdict |
|---|--:|--:|--:|--:|---|
| `counter-nuke` | 95 | **77.2%** | +33.1 | 3.49 | strong, correctly priced (reflect) |
| `insurance` | 80 | **67.1%** | +15.4 | 1.92 | **fixed** → earns its cost (soften) |
| `floodgates` | 85 | 55.3% | +0.0 | 0.00 | not a nuke counter (counters erase/stop) |
| `ot-shield` | 70 | 56.8% | +2.0 | 0.28 | niche (counters OT scoring) |

**Takeaways:**
- The "dead defensive buffs" finding was **wrong**: they're *situational counters*, dead only
  when their threat is absent — which is correct (`counter-nuke` proves it: dead vs a non-nuker,
  77% vs a nuker). No re-pricing needed.
- **`insurance` was genuinely broken by the nuke retune** (it refunded half the bank, but the
  slot died anyway from the rate-reset/blackout). Fixed: an insured slot now **keeps its drip**
  (no reset/blackout) on top of the half-bank refund — a cheaper "soften" counter (67% / +15)
  next to counter-nuke's pricier "reflect" (77% / +33). Both now viable and differentiated.
- `floodgates` (immune to erase/stop) and `ot-shield` (negates OT points) counter metas the
  blind honest AI doesn't deploy, so they're dead *now* but not mis-priced — they'd matter if a
  denial/OT meta emerges, the same way counter-nuke matters once someone nukes.

## 8. Window-level metric optimization (`window.mjs`) — already near-optimal
Question: have the AI find optimal combinations of players/metrics/power-ups *within a
window*. The one real in-window synergy is **Field General** (a QB on `fg` scores 0 but
multiplies its window's drips), so we A/B'd candidate FG rules — count- and projected-yard-
weighted — vs the shipping "≥2 drip teammates" rule (mirror roster, blind).

- **No rule beats the current one.** Every alternative is within noise or worse: `never`
  and `count≥3` *lose* (−3.0 margin — the FG flips do help), `count≥1`/`yds≥40` slightly
  over-flip (−1 to −1.4), and the best alternative (`yds≥100`) is a statistical tie (+0.4,
  5% decisive wins). The shipping `count≥2` sits at the optimum.
- Combined with §4 (metric defaults near-optimal), §5 (the AI's real win was buying EV
  buffs, not metrics), and the best-player fielding fix (§ commit), **the blind within-window
  metric space is essentially flat** — there's no free win left from a smarter heuristic.

**Why blind window-optimization is flat here:** (a) the engine rewards the drip defaults, so
non-drip metrics are mostly opportunity cost; (b) the FG synergy is already captured at its
optimum; (c) the genuinely strong plays are *opponent-dependent* (NUKE as a counter, §6), and
the blind rule forbids reading the opponent's starters/metrics pre-lock; (d) everything cancels
in symmetric play anyway (§1). We then tested the one lever that *might* have added value — **opponent-
ROSTER-aware counters** (`counter.mjs`): the blind rule allows seeing the opponent's players per
window, so meet a drip-heavy opponent window with a now-viable NUKE. **Measured: it hurts**
(home win-rate 43.5%, margin lift −11 across thresholds). Sacrificing a skill player to `td`
loses because you forfeit its drip, your player rarely scores the TD the nuke needs, and a
drip-heavy *roster* doesn't mean the *starter* in your matched slot is the big drip — the read
is too noisy. So even opponent-roster awareness doesn't beat the honest defaults blind.

**Conclusion: the AI's within-window optimization is at its blind ceiling.** Best-player
fielding (§ commit) + drip defaults (§4) + the tuned FG rule (§8) + EV-buff buying (§5) is
already near-optimal; every richer "combination optimizer" tested (yard-weighted FG, opponent-
roster nuke counters) is neutral-to-negative. The headroom that exists is *hindsight-only* (§3)
or *symmetric-cancelling* (§1) — neither is a shippable blind win.

## 7. Does recent form help the AI? (`form.mjs`) — measured, mostly NO
Question: wire in 2025 weekly stats so the AI makes "crude predictions from the weeks
leading up" to optimize player / metric / power-up choices. The baked PBP *is* per-week
2025 data, so we tested it before building any live-data plumbing. Mirror roster, both
blind, weeks 4–14, lookback 2–4.

- **Recent form has real predictive signal** — trailing weeks rank next-week production
  correctly **~70%** of the time (50% = none).
- **But recency LOSES to season-to-date for selection** (form win-rate 19–29%, both
  no-hindsight): last-2-to-4-weeks is a smaller, noisier sample than the full prior
  sample. "Start your hot players" underperforms "use all the data you have."
- **Selection rarely binds anyway** — huge tie counts (the lineup is slate-gated, so most
  windows have ≤ slots eligible and both policies field the same players). Player selection
  is mostly *not* the AI's lever in this game.
- Full-season totals (hindsight) beat both, as expected — more accuracy always wins.

**Takeaways for wiring Stathead weekly stats (`get_player_weekly_stats`, confirmed
available for 2025):**
- The value is **data freshness, not the hot hand**: the AI today reads a *static* season
  projection (`statsForSlug`). In a live 2026 week that projection is *stale prior-season*
  data — replacing it with **season-TO-DATE accumulation** from live weekly stats gives the
  blind AI a *current* no-hindsight projection it otherwise lacks. Use the **full accumulated
  sample, not last-3 recency** (the harness shows the bigger sample predicts better).
- Do **not** build a "recent-form / hot-hand" selector — measured to *hurt*.
- Metric/power-up tuning from form is low-headroom here (§4–§5): the engine rewards the drip
  defaults, lineups are slate-bound, and the AI's real win was buying the EV buffs (§5),
  which is roster-independent. Combodrip targeting could use to-date dual-threat detection,
  but that's a marginal gain.

_Net: weekly stats are worth wiring only as a **freshness upgrade** to the AI's projection
(season-to-date), and mainly matters once the static projection is a season stale. The
"crude recent-weeks prediction" framing specifically does not pay — the playtester saved
us from building it._

## 6. Mechanics retune #1 — revive NUKE as a drip counter (shipped, `sim.ts`)
The dead NUKE class (§2/§4) was the first mechanic retuned. Root cause confirmed: a TD wiped
the victim's banked points but left its drip **rate** intact, so the drip rebuilt and
out-accrued the wipe within a few catches. Final design (after trying a permanent slot-kill,
then softening it to bound the variance):
- **A TD nuke wipes the bank, RESETS the drip rate to 0, and SUPPRESSES all scoring in that
  slot for the next 10 game-minutes** (`nukedUntil`; the slot is inert during the blackout, then
  rebuilds the rate from scratch). The blackout is what makes the wipe stick — a bare rate-reset
  is rebuilt within a few catches. Also nullifies FG-boosted accrual meanwhile (0 rate × mult).
- **A TE TD additionally kills the HOT STREAK** of every opposing drip in the window (on top of
  the existing −1.0/min rate knock).
- Composes with the defensive buffs: counter-nuke reflects the wipe + blackout onto the
  attacker; insurance keeps half the bank but the slot is still suppressed.

Validation:
- Cascade probe: stacked TE-TDs vs a drip window cut the matched drips to **2–38** (was 47–54
  unmitigated; the spread reflects WHEN the TE scored — an early TD leaves time to rebuild after
  the blackout, a late one doesn't).
- `te-nuke` went from strictly-bad to **neutral** in blind play (50.9% → ~51%, conditional
  win-when-fired 43% → 48%): a real situational counter now, not a trap. `rb/wr-nuke-all` stays
  bad (forfeiting your *entire* drip corps is still self-sabotage — correct).
- No economy regression (season: wallet bounded 91–99, home WR 50.0%, cancellation r=0.97).

**Trade-off (measured, not hidden):** reviving NUKE hands the *hindsight* adversary a new free
weapon — its FREE (0-coin) exploit margin rose +10.7 → **+17.4** (the earlier permanent-kill
variant was +20.3; the 10-minute blackout is less swingy), and `RB/WR→td` appear in its lines,
because perfect TD foresight makes it a precision drip-snipe. This is **hindsight-only** (no
real player has it; blind EV is neutral) — it just flags NUKE as somewhat outcome-dependent now.

_On the ceiling: Twin Generals was ruled OUT as a nerf target (§2 finding 5 — opportunity cost
balances it). The only remaining ceiling lever is the single-FG curve + amplifier compounding
(§ probe 2), and since everything cancels in symmetric play (§1) that's a feel/variance choice,
not a balance fix — left to the designer's taste rather than recommended._
