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
~100), cancellation r≈0.96, wins-vs-roster r≈0.65, home WR ~50%; buy mix is now all EV buffs
(no dead buffs), combodrip only when a team banks enough (~1/season). _(Season mean team score
later rose ~58→~97 once best-player fielding shipped — the § fielding commit — which raised the
wins-vs-roster correlation too; the balance conclusions are version-independent.)_

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

## 10. Late swap — score-aware variance policies all measure NEGATIVE (`lateswap.mjs`)
Per-window locks (v0.95.0) let a manager set each later window knowing the real
margin so far. Both sides still lock a window at the same kickoff and slate-gating
partitions rosters by window — so earlier reveals never expose the opponent's
same-window pick, and the testable edge is **score-state variance management**:
gamble when trailing, deny when leading. Paired A/B (same rosters, home runs the
policy vs home honest, away fixed honest), weeks 1–14 × 120, seed 909.

| policy | fired | fired-cohort WR vs ctrl | behind-at-half WR vs ctrl |
|---|--:|---|---|
| gamble T=0 (trailing → all skill → `td`) | 66% | **6.3% vs 32.8%** (n=1105) | 6.3% vs 26.7% |
| gamble T=15 | 49% | 3.9% vs 22.2% | 13.7% vs 26.7% |
| gamble1 T=10 (only the WEAKEST player flips) | 53% | 8.6% vs 25.2% | 13.7% vs 26.7% |
| hail T=20 (MNF only, down 20+) | 21% | **0.0% vs 4.0%** (n=354) | 25.3% vs 26.7% |
| protect T=0 (leading → denial) | 67% | 58.5% vs 71.0% | 26.0% vs 26.7% |
| protect T=15 | 50% | 78.2% vs 81.7% | 28.0% vs 26.7% |

**Every variant loses, including the surgically minimal ones.** Trailing teams that
gamble convert a ~27% comeback rate into 6–14%; the desperate MNF hail mary converts
ZERO of an already-nearly-dead cohort; lead-protection denial costs more of your own
EV than it removes from the opponent's variance. Raising the trigger threshold only
converges back to control from below.

**Reading (design, not tooling):** the live-margin information is real, but the
metric menu offers **no fair variance/EV trade to spend it on** — `td` is not a
lottery ticket at a small EV discount, it's a ~60%-EV-loss ticket (§2), and denial
only partially bites. This sharpens §4's priority: the drip monoculture doesn't just
homogenize blind play — it **forecloses the adaptive layer** that per-window locks
created. Retuning NUKE/denial so variance is purchasable near fair EV is what makes
late-swap decisions live; re-run this module after any such retune (expect the
gamble cohort to approach — not exceed — control, with the gap as the price of
variance).

**Limitations:** metric flips only — late swap also allows PLAYER changes in later
windows, unmeasured because the projection model is mean-only (no per-player
variance); partial margins resolve window subsets, so cross-window couplings
(suppress/banker/backups spanning locked+unlocked windows) are approximated; the
opponent never adapts (a human meta could punish known policies).

## 11. Mechanics retune #2 — price variance & denial fairly; Combo Drip single-use (shipped)
§10 showed late swap's information had nothing profitable to buy. Three changes
(v0.97.0), each measured with the same seeds as the pre-tune baselines:

1. **NUKE spike profile** — the `td` metric now scores scrimmage yards at 0.04/yd
   plus a bigger boom (10/TD RB+WR, 12/TD TE), keeps the wipe+blackout, **and
   steals a quarter of the bank it wipes** (insurance-softened wipes steal from
   the removed half; the carry-wipe buff is excluded — it pays its own bounty).
2. **Denial steals** — erase / rate-reset(cut) / compression credit the denier
   25% of the points removed; WR Targets 0.5 → 1.0/target.
3. **Combo Drip single-use** — one combodrip slot per lineup, enforced in the
   engine (extras downgrade to the standard drip), the AI (best dual-threat
   only), a sealed_pick trigger + apply_targeted (migration 0061).

| reading | before | after |
|---|--:|--:|
| rb-nuke-1 (top RB flip, blind) | ~35% | **45.8%** |
| wr-nuke-1 (top WR flip — worst-case single) | ~26-30% | 41.1% |
| te-nuke-1 / te-nuke-all | 50.4% | 51.9% (no runaway) |
| wr-erase-all / wr-stop-all (blind torture tests) | 33.7% / 26.4% | 36.0% / 33.4% |
| lateswap gamble1 fired-cohort | 8.6% vs 25.2% | **16.2% vs 25.2%** |
| lateswap behind-at-half (gamble1) | 13.7% vs 26.7% | 20.0% vs 26.7% |
| lateswap protect T=15 fired-cohort | 78.2% vs 81.7% | **81.1% vs 81.7% (parity)** |

**Reading:** single-flip nukes are now a fair-ish discount (RB in the 44-48
target band; the WR number is the worst-case top-starter flip), lead-protection
denial reaches statistical parity, and the trailing gamble roughly doubled its
conversion — still below stand-pat, which is arguably correct (a gamble should
cost EV; the crude test policy fires in bad spots too). Blind -all overrides
remain traps, as they should.

**Regression:** invariants all hold (mirror 0, honest WR 51.0%; the nuke-suppress
invariant tightened 8.2 → 4.7 — the spike victim rebuilds less). Season economy:
wallet bounded, cancellation r=0.96, wins-vs-roster r=0.74, and the opt-out probe
moved 2.9 → **5.0 pts** — power-ups now carry real (but not oppressive) weight,
which was the design review's ask. Hindsight adversary: exploit LINES diversified
(nukes/denial/drip mix; the multi-combodrip stack is gone — single-use holds) but
the hindsight ceiling ROSE (FREE +35 on a weeks-1-4 spot check) — expected, per
§6: perfect TD foresight makes spike-nukes precision weapons; blind EV (the thing
real players face) is the guard.

**Next iteration candidates:** a spot-smart gamble policy (flip only vs
drip-heavy opponent windows where the steal pays) to see if informed gambling can
reach parity; RATE RESET still has nothing to steal vs a drip (rate isn't
points) — consider a small erase component or fold the metric; wr-stop/erase
remain blind traps (correct for counters, but the trap labeling from the design
review still applies).


## 12. Post-retune full battery (v0.97.1, merged @ 42c8c46)
Full sweep after the spike-nuke/steal retune + one-per-purchase Combo Drip.
- **Invariants:** all hold (mirror 0; honest WR 51.0%).
- **Harness (14 wk x 150):** honest home WR 50.5%; score mean 115.1 (up from
  ~97 pre-retune — steals + nuke yardage add real points; watch inflation).
- **Aggregate:** the offensive trio still tops the board (garbage 60.8% /
  overtime 60.4% / momentum 59.4%) — homogenization unchanged, the economy
  pass's target. te-nuke now +2.0 (51.9%), rb-nuke-1 45.8% (band), def-suppress
  neutral; the -all overrides remain traps by design. ot-shield crept to 52.8%
  (+2.4) — minor watch.
- **Double Combo (new probe):** a 2nd Combo Drip lifts margin +3.2 for ◎65
  (≈0.5 pts/◎10 vs the buffs' ~2.0-2.5) and only 41% of rosters even have a
  2nd candidate — legal but rarely correct. The one-per-purchase rule needs no
  further cap; the price does the work.
- **Season (12 x 14 x 30):** wallet bounded (96-107), cancellation r=0.96,
  roster r=0.65, home 49.0%. **Opt-out probe Δ 11.2 pts** (2.9 pre-retune, 5.0
  at 10 seasons) — power-ups are now genuinely mandatory. Defensible for a
  coin-economy game (autopilot buys for AFK managers), but it sharpens the
  homogenization problem: everyone MUST buy the same trio. The amplifier
  stacking surcharge (economy pass) now has two reasons to exist.
- **Adversary (14 wk x 20, ◎200):** FREE +35.0 / PAID +81.7 — ceiling up from
  +17.4/+72 pre-retune, as §11 predicted (perfect TD foresight makes spike-
  nukes precision weapons; blind EV is the guard). Lines are diversified
  (nuke/denial/drip mixes) and NO line stacks a second combodrip on one unlock
  — one-per-purchase holds under adversarial search.

## 13. Amplifier capacity — Second/Third Amp unlocks (v0.98.0, migration 0063)
Design change replacing the stacking-surcharge idea from §11/§12: amplifiers
(Momentum / Overtime / Garbage Time) are capped at ONE armed per week; the
"Second Amp" (◎40) and "Third Amp" (◎60, requires Second) power-ups raise the
cap to 2 and 3. The engine (`capAmplifiers`) enforces the cap at resolve on
every surface; `arm_buff`/`disarm_buff` reject over-cap arms and in-use
capacity removal so a paid buff is never silently dropped. Full battery after:
- **Invariants:** all hold (mirror 0, honest WR 51.0%). Engine probe: 10/10
  capacity/priority cases; the demo AI never loses a drawn amp (capacity is
  granted free to its walletless draws).
- **Aggregate:** SINGLE amps unchanged (garbage 60.8% / overtime 60.4% /
  momentum 59.4%) — capacity intentionally does not touch the first amp.
- **Season (12×14×30):** buy mix is IDENTICAL to v0.97.1 (overtime 70 /
  momentum 59.5 / garbage 53.8 buys per season ≈ 1.09 amps per team-week) —
  at the ◎100 seed and ~◎74/week income a second amp (+◎40 capacity) was
  never affordable, so the cap does not bind for the budget AI. Wallet
  bounded (96–107), cancellation r=0.97, home 49.7%. **Opt-out Δ 10.0 pts**
  (11.2 in §12 — statistically unchanged): the tax comes from the FIRST amp,
  which capacity deliberately leaves alone; if the tax itself needs shrinking,
  that is a single-amp pricing lever, not a capacity lever.
- **Adversary (◎200, where capacity binds): PAID ceiling +81.7 → +60.2**
  (−26%), FREE unchanged (+35.0). Amps nearly vanish from exploit lines
  (garbage-time 11.1%, momentum 7.5%, overtime 0% adopted vs the old
  every-line-stacks meta) — the rich-manager amp stack is priced out, and the
  search shifts to metric-override lines (passbig/td/tgt) plus ot-shield
  (76.1% — cheap insurance against the mirror). Rich-vs-poor amp inequality
  was the whole point: capacity converts it from a hidden stack into two
  visible ◎-priced purchases.
- **Cost of the full stack:** ◎205 → ◎305 (amps + ◎100 capacity) — >4 weeks
  of income; effectively a deliberate splurge, not a default.
- Open thread: an `amp-pair`/`amp-trio` aggregate lever (arming 2–3 amps WITH
  capacity priced in) would put a blind-EV number on the bundles; today only
  the adversary measures them.

## 14. Saver probe + amp-bundle EV — capacity pricing validated (v0.98.0 tools)
§13's open thread, run: does hoarding coin for a capacity stack beat the
steady one-amp-a-week meta? Three new instruments (this change touches only
the playtester; no engine/app code):
- **`aggregate.mjs` amp-pair / amp-trio levers** (bundles WITH capacity priced
  in): pair (◎185) 69.8% WR / +33.9 margin, trio (◎305) 81.7% WR / **+68.8
  margin — SUPERLINEAR** (singles sum to +46.3; the amps compound: momentum
  raises the drip that garbage-time doubles inside the overtime the third amp
  keeps alive). Per-coin the trio (2.26 pts/◎10) matches the singles
  (2.0-2.5) — capacity gates the stack by WALLET SIZE, not by efficiency
  decay. That makes the saver question the real test:
- **`season.mjs` saver probe** (team 0 hoards until the bundle fits, splurges,
  repeats; others steady): **steady 50.2% > saver-pair 46.7% (5.3 splurges/
  season) > saver-trio 45.7% (3.1) > opt-out 41.0%.** Hoarding LOSES — the
  naked weeks bleed more than the splurge weeks return, because a week''s win
  is binary: the trio''s +69 margin in one week buys the same 1 win a single
  amp''s +16 usually buys, while a naked week is a coin-flip forfeited at -9.
  Superlinear points, sublinear WINS. The economy is closed; capacity prices
  need no adjustment.
- **`adversary.mjs` capacity-aware search** (greedy step now bundles amp-2/
  amp-3 into an over-cap trial and prices them): ◎200 ceiling +66.4 (was
  +60.2 blind to bundles, +81.7 pre-capacity — net −19%). +amp-2 appears in
  51% of hindsight lines: the PAIR is a legitimate rich-manager play; the
  trio stays priced out of a ◎200 budget. FREE ceiling unchanged (+35.0).
- **Correction to §13''s season numbers**: `seasonBudget` (the season sim''s
  own budget mirror) had missed the 0063 capacity rule, so carried-over
  wallets occasionally bought a second amp the engine then silently dropped
  (wasted coin, ~9% of amp buys). Fixed to mirror lock.js. Corrected meta:
  amp buys 183 → 167/season and the freed coin diversifies — combo-drip 1.6
  → 10.0 buys/season, extra-slot 0 → 4.9, occasional legit amp-2 pair (1.0).
  Opt-out Δ 9.3 pts (was 10.0 measured with the waste; same conclusion).
  Wallet still bounded (101-111), cancellation r=0.96, home 49.3%.

## 15. First-buy variety probe (`firstbuy.mjs`) — the amp default is REAL dominance
The last open homogenization question: everyone''s first purchase is an
amplifier — is that dominance, or herd behavior a roster-aware manager could
beat? New probe: ONE purchase allowed, per-matchup lift measured exactly
(deterministic resolver) on paired draws; blind rules vs a hindsight oracle.
14 wk × 100, vs stripped-honest field:
- **Blind rules:** always-momentum +16.6 (WR 60.7%) tops the board;
  combo-if-elite-dual-threat +15.8 (WR 61.2%) statistically TIES it; every
  other conditioning attempt (air-raid with a top-8 QB, combined
  roster-aware) lands at +14.0 or below. **No observable-feature rule beats
  just buying an amp.** The choice AMONG the three amps barely matters
  blind (+14.6-16.6, WR ≈ 61% for all three).
- **Oracle (hindsight argmax):** +25.1, WR 67.2% — and only 64.7% of its
  picks are amps (air-raid 16.0%, extra-slot 11.2%, combo-drip 8.0%). So
  variety EXISTS per-matchup, but the 8.5-pt gap between oracle and best
  blind rule is driven by unobservable outcomes (which QB actually spikes,
  which bench player blows up) — luck, not surfaceable skill. Roster
  projections don''t reach it; my rules tried.
- **Per-buy readings:** unconditional combo +12.5 (fair for the right
  roster — the AI''s conditional buy is correct); always-air-raid +7.0 at
  ◎60 (per-coin 1.17 vs momentum''s 2.37 — would need ~◎35 to compete);
  extra-slot +4.3 solo (structurally weak as a lone buy; its §12 value was
  in stacks).
- **Design read:** first-buy homogenization is honest dominance, not a
  bug a smarter UI could fix. If more first-buy variety is wanted, the
  lever is PRICE (air-raid ~◎35-40, or amp price nudges up), not
  conditioning hints. Otherwise: the amp default is a fine casual
  auto-pilot, and the skill expression lives where §10-§14 put it —
  metric picks, targeted plays, and knowing when NOT to spend.

## 16. Air Raid reprice ◎60 → ◎40 (v0.99.2, migration 0065) — a real second buy
§15 said first-buy variety needs a PRICE lever; this ships one. Air Raid''s
scoring is untouched — only the price moves.
- **As a lone first buy (firstbuy re-run):** unchanged by design — lifts are
  price-independent (+7.0 solo; conditioning on an elite QB still loses to
  always-amp). The amp stays the correct FIRST buy; the reprice was never
  going to change that.
- **As a SECOND buy (new season probes, team 0 deviates, 30 seasons):**
  steady amp-only 50.2% → amp-then-raid 51.2% (5.1 raid weeks/season) →
  **raid-then-amp 52.9% (14/14 raid weeks) — best measured steady policy,
  +2.7 pts over amp-only.** At ◎40 the unlock fits ALONGSIDE an amp inside
  the weekly income (~◎74), so it stacks instead of competing — the amp
  multiplies drip while passbig floors the QB slot. At ◎60 the pair
  (◎120-135/wk) never fit; the reprice is what unlocked the pairing.
- **Magnitude check:** +2.7 is a real but modest edge — a third of the
  opt-out penalty (9.3), and it''s a DEVIANT''s edge vs an amp-only field;
  symmetric adoption cancels (r≈0.96). This is the "buying power-ups to
  win is a strategy, but never certain" target, not a new must-buy.
- **Aggregate re-run:** air-raid 1.65 pts/◎10 at ◎40 (was 1.17) — now
  flagged CHEAP-EDGE but still below the amps'' 2.0-2.5 solo. WATCH: if a
  future battery shows raid-then-amp creeping past ~54%, dial to ◎45-50.
- Shipped: powerups.ts price 40, migration 0065 (powerup_price v4),
  rulebook regen, price-parity checker green. The AI mirrors do NOT buy
  Air Raid (aiLiveBuffs is amps-only) — the probes drive it via the season
  policy hook; teaching the shipping AI a QB-conditional raid buy is a
  separate call (it would also need an aiMetric passbig hook).

## 17. Battle-layer battery + AI retrain (v0.124.0) — every new mechanic measured
The battle layer (window battles, underdog/marshal metrics, and the 13 new
targeted/live power-ups through Ghost Player) shipped without playtester
coverage. This round teaches the sim ALL of them and retrains the AI on the
measurements. Substrate: `resolve()` now takes per-side `LiveExtras`;
`aggregate.mjs` grew a post-build `extras` hook so levers can target
`win|slot` off the BUILT lineups (blind, projection-based); `season.mjs`
loads carry an `extrasFor` hook so symmetric policies can arm battle plays.

**Lever sweep (weeks 1-14 × 200 pairs/lever, seed 4242), the new entries:**

| lever | cost | homeWR | marginLift | pts/◎10 | verdict |
|---|---|---|---|---|---|
| bye-steal | 55 | **66.3%** | +24.5 | **4.45** | DOMINANT — see watch below |
| rivalry | 70 | **64.1%** | +19.6 | **2.80** | DOMINANT — beats momentum per coin |
| ghost | 75 | 58.5% | +11.3 | 1.51 | strong-but-fair; conditional on an open slot |
| red-herring (decoy) | 90 | 57.0% | +8.9 | 0.99 | fair |
| double-or-nothing | 80 | 56.4% | +13.7 | 1.72 | fair (top-slot stake wins >50%) |
| emp | 65 | 54.6% | +5.5 | 0.84 | fair live play |
| cold-snap | 60 | 54.1% | +4.7 | 0.78 | fair (scout-informed UPPER bound) |
| surge | 55 | 53.7% | +4.5 | 0.82 | fair |
| jinx | 55 | 53.0% | +3.7 | 0.68 | fair (upper bound) |
| grudge / lead-change / napalm / bunker | 45-65 | 50.7-51.7% | +0-1.5 | ≤0.26 | DEAD vs honest blind field — situational human plays |
| def-marshal (free) | 0 | 49.9% | −1.4 | — | fair option (nobody nukes blind) |
| wr/rb-underdog-1 (free) | 0 | 39-42% | −12 to −16 | — | TRAP as a default — confirmed right to exclude from AI auto-pick |

**AI retrain (shipped, all three mirrors in lockstep — `src/data/aiLineup.ts`
`aiTargetedPlays`, `tools/playtester/lib.mjs` `aiLoadout`, `server/src/lock.js`
`aiBudgetPass`, `season.mjs` `seasonBudget`):**
- Buy order by measured lift-per-coin: **first amp → RIVALRY on its densest
  window (blind mirror-probability read) → remaining amps → GHOST when the
  lineup leaves a base slot open → combo-drip → extra slots.**
- Demo AI (`src/engine/matchup.ts` AI_BUFF_POOL) drops the dead defensive
  buffs (floodgates/ot-shield, 0 to +3 lift) for the measured amp trio.
- Server wiring: `resolve.js toExtras` now maps ALL battle plays (rivalry /
  ghost / lead-change / grudge / jinx / red-herring / surge / cold-snap /
  napalm / bunker) from `applied_state.targeted`; `aiSide` passes the AI's
  targeted payload through. The AI writes its plays directly to
  `applied_state`; the HUMAN `apply_targeted` RPC still whitelists the old
  ids — extending it (migration) is the open item for human live parity.

**Validation (season.mjs, 12 teams × 14 weeks × 40 seasons):** economy stays
bounded (wallet ~◎120 flat) with rivalry at 44.7 buys/season; cancellation
holds (full-vs-no-budget standings r=0.92); the retrained order beats a
legacy amps-only deviant by **+2.0 win-rate pts** over 560 games. Ghost never
fires on deep 17-man sim rosters (0 buys — no open slots); it exists for real
rosters with bye/slate gaps. Invariants extended (ghost flat-14, jinx
never-raises, extras-path plumbing) — all green.

**Balance watches:**
- **bye-steal 4.45 pts/◎10 at ◎55** — the model fills an open slot with the
  top BENCH projection (clamped 25), a stand-in for a real bye stud. The real
  play needs a bye player + an open slot, so availability is narrower than the
  96% the harness sees — but when it's live it's the best coin in the game.
  WATCH: if live usage confirms, reprice toward ◎70-75 (ghost's neighborhood)
  or clamp the flat score to ~18.
- **rivalry 2.80 pts/◎10, 64.1% blind** — the honest field mirrors positions
  heavily, so the "risk" rarely whiffs. Both sides buying it cancels (season
  r=0.92), and it gives the AI a real battle-layer presence, so it ships as
  the AI's second buy. WATCH: human-vs-AI asymmetry once the RPC opens it up;
  the dial is siphon 50% → 33%, not price.
- **underdog** at −12 to −26 margin is priced for drama, not EV — fine as a
  human comeback gamble, but a trap. If it should be a real decision, the
  ×1.5 trailing boost needs to be ~×2 or the base rate un-discounted.

**Still unmodeled:** turnover-boost (no per-player turnover feed), spy
(information value), clutch plays (conditional live offers — no LiveExtras
surface), swaps/mulligan as POLICIES (lateswap §10 covers the mechanism).

## 18. Conditional STACKS — roster-aware add-on buys, measured then adopted (v0.125.0)
§17 gave the AI a fixed greedy order. This round asks: when the wallet allows
AND the possible starters create the situation, which power-up STACKS earn
their coin? Machinery: `aiBattlePlan` (aiLineup.ts) reads the AI's own built
lineup blind — top-projected slot (a DoN stake), cheapest genuine WR decoy
(Red Herring), open base slot (ghost), FG deployment (Air Raid waste-guard),
twin-QB windows (fg-stack) — and `AI_STACKS` switches gate each candidate in
every budget mirror. `season.mjs` probes each stack as a team-0 deviant vs the
steady retrained field (12×14×60 seasons — 840 games/arm).

**Verdicts:**
| stack | Δ win-rate | fires/season | verdict |
|---|---|---|---|
| raid-FIRST (Air Raid ◎40 before the amp, only when no FG deploys; QB → passbig) | **+1.4 pts** | 10.1 | **ADOPTED** |
| raid after amps | +0.8 | 4.4 | dominated by raid-first |
| don (surplus → DoN on top slot) | 0.0 | **0.0** | never fires — no ◎80 surplus exists after amp+rivalry |
| herring (surplus → cheap WR decoy) | 0.0 | **0.0** | never fires (◎90) |
| extra-slot → rivalry window | 0.0 | **0.0** | extra slots are never bought at all in the retrained economy |
| twin-FG (fg-stack when 2 QBs share a window) | 0.0 | **0.0** | the situation ~never exists: windows hold 1-3 slots, so a second QB crowds out the ≥2 drip teammates FG needs |

**Adopted policy (AI_STACKS.raid + raidFirst, all mirrors in lockstep):**
when the deterministic lineup deploys NO Field General, buy Air Raid ◎40
BEFORE the first amp — it fits alongside the amp inside weekly income
(~◎90) instead of competing with it — and `aiMetric` flips the QB onto
`passbig` (strictly dominant over `pass` for the holder: same 0.04/yd,
10 vs 4 per passing TD). The FG guard exists because `applyFieldGeneral`
would overwrite a passbig QB — buying the unlock there is pure waste.

**The real §18 lesson:** "stack when you have budget" is mostly answered by
the ECONOMY, not the policy — after the core amp+rivalry buys (~◎130-145/wk
desired vs ~◎90/wk income) there is never an ◎80+ surplus, so the surplus
stacks are structurally dead. The switches + probes stay in the battery: if
coin income rises or prices drop, the next run will light them up.

**Wallet-awareness for free:** live wallets CARRY OVER (winners accumulate),
and the budget pass is greedy through the desired list — so a fat wallet
automatically buys deeper into the stack order with zero extra policy code.

Also shipped: `applyFieldGeneral(picks, owned)` supports Twin Generals (both
QBs flip to fg when `fg-stack` is owned and the window qualifies) — inert for
the AI (never buys it), but the machinery is measured and ready.

**Post-adoption re-battery (field-wide raid-first, 12×14×40):** economy still
bounded (~◎117 wallet), cancellation r=0.92, honest home WR 49.8%. The buy mix
shifts hard: `unlock-pass-td10` 115.8 buys/season while RIVALRY falls 44 → 15
(◎70 rarely fits after amp+raid inside ~◎90/wk income) — that crowding IS the
measured trade, and the probes vs the new field read ≈0 (the steady field now
sits at the adopted optimum). Full retrained+stacked policy vs the legacy
amps-only buyer: **+2.5 win-rate pts**. WATCH: if a future Air Raid or rivalry
reprice shifts the ratio, re-run the battery — the arms are standing.

## 19. Balance retunes from the §17 watches + the live-fire timing school (v0.126.0)
Three watches closed with parameter sweeps, one metric exonerated, and a new
driver (`livefire.mjs`) that teaches WHEN to fire the live tacticals.

**Underdog — exonerated, kept at ×1.5.** The §17 lever staked the TOP player
(−12 to −16 margin), but that's the wrong test: a bigger multiplier barely
rescues it (×3.0 → still 42%) because the cost is trading the stud's drip
away. On the roster's WEAKEST WR — the player who actually expects to trail,
i.e. the intended use — it measures **49.2% at ×1.5**: already fair. The gap
between uses is skill expression, not imbalance. Shipped: metric copy now
says "best on a player you EXPECT to trail"; new `wr-underdog-low` lever
keeps the honest reading in the battery.

**Bye Steal — cap 25 → 16 (BYE_STEAL_CAP, one constant, both engines).**
Sweep: cap 25 = 66.3% / 4.45 pts per ◎10 (best coin in the game); 18 = 2.95;
**16 = 60.0% / 2.49** — the amp neighborhood, still ahead of Ghost (◎55 vs
◎75; you earned the edge by rostering the bye stud). Also fixed a real
parity gap: the DEMO path banked the raw projection unclamped while live
clamped at 25 — both now clamp at the shared constant, and the client +
worker re-clamps match.

**Rivalry — siphon 50% → 30% (RIVALRY_SIPHON, one constant, both engines).**
Sweep: 50% = 64.1% / 2.80 per ◎10; 35% = 60.8% (still flagged); 25% = 57.5%;
**30% = 59.0% / 1.70** — a spicy-but-fair bet in Double-or-Nothing territory.
Position mirrors are common enough that the whiff "risk" needed the dial,
not the price. All copy synced (blurb, handbook, store notes, rulebook).

**Live-fire timing school (`livefire.mjs`, 1,400 pairs/cell):** for surge /
cold-snap / napalm, LATE beats EARLY blind (fixed-30:00 ≈ +6.6 vs +2.6 at
10:00), the hot-streak trigger is the real signal, and the shipping-grade
manager rule is **hot-else-late**: fire the moment the target goes HOT, else
at ~30:00 — the best honest policy for all three (surge +6.8 / 1.24 per ◎10;
cold-snap +6.9 / 1.16; napalm +6.5 / 1.09). The hindsight ORACLE reaches
1.8-2.1 per ◎10 — amp-grade — so timing skill is worth roughly +60-90% on
top of the honest rule, and napalm has the widest skill gap of any play in
the game (blind-early 0.26 → oracle 2.09, 8×). Handbook "when to fire"
guidance updated to match. The AI does NOT fire live plays (the worker has
no mid-game targeted writes) — this is human guidance + the bar any future
live-AI must clear.

**Post-retune validation:** full lever battery + season battery re-run at
the tuned values — see the §19 numbers above and the buy-mix note below.

**Post-retune battery (weeks 1-14 × 200):** NO battle play carries the
DOMINANT flag anymore — bye-steal 60.0% / 2.49 per ◎10, rivalry 59.0% / 1.70,
ghost 58.5% / 1.51, don 56.4% / 1.72; the amps remain the deliberate core.
The AI buy order survives the retune unchanged: rivalry at 1.70 per ◎10 still
beats a SECOND amp once the capacity-unlock tax is counted (garbage-time ◎75 +
Second Amp ◎40 = ◎115 for +17.6 → 1.53 per ◎10 bundled). Season battery at
the tuned values: economy bounded (~◎117), cancellation r=0.92, retrained
policy still +2.0 pts over legacy. h2h-verify's rivalry assertion now reads
the shared RIVALRY_SIPHON constant instead of a hardcoded 50%.
