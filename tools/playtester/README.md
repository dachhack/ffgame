# Automated playtester

A headless, deterministic harness over the **pure** Drip engine
(`resolveLiveMatchup`). It runs many seeded matchups per baked week to (1) surface
gameplay balance breakers and (2) serve as the fitness function for the AI rule set
(`src/data/aiLineup.ts` + `server/src/lock.js`). No Supabase, no Sleeper, no network —
everything seeds off `(slug, week)` + hashes, so a given `(rosters, week, seed)` always
resolves identically. See `docs/playtester-handoff.md` for the design context and
`docs/playtester-findings.md` for the first round of results.

Run everything under `tsx` (resolves the `.ts` engine imports), from the repo root.

## `lib.mjs` — substrate
Baked-week loader + player pool, seeded RNG, projection-weighted roster draw, the
`AiPick → LivePick` adapter, a pure mirror of the AI's coin budget pass
(`aiLoadout`, matching `server/src/lock.js:aiBudgetPass`, season seed **100**), and
`resolve()` which annotates a `LiveResult` with margin / winner / biggest-slot swing.
`buildMatchup()` builds both lineups together so **Extra Slot is symmetric** — a bought
slot is contested (both sides field a bench player there), not a free unopposed slot.

## `season.mjs` — full-season AI-vs-AI economy (primary balance lens)
A league of full-logic blind AI teams over a whole season with a **persistent,
carried-over** wallet (start 100). Answers what single-week runs can't: does coin run
away, do symmetric power-ups cancel out, are they a mandatory tax? Reports the wallet
trajectory, buy mix, a standings-correlation cancellation test, and a one-team opt-out
mandatory-tax probe.

```
npx tsx tools/playtester/season.mjs --teams=12 --weeks=14 --seasons=40
```

## `harness.mjs` — step 1: honest-field meta
Both sides field the shipping AI's real loadout (no hindsight). Reports score /
margin / coin distributions, home win-rate (a fairness sanity ~50%), and blowups.

```
npx tsx tools/playtester/harness.mjs --week=1 --n=200          # one week
npx tsx tools/playtester/harness.mjs --week=1-14 --n=300       # full sweep
npx tsx tools/playtester/harness.mjs --week=1 --n=20 --list    # per-matchup lines
```

## `aggregate.mjs` — step 2: lever A/B
Paired A/B: each seeded matchup is resolved twice over the **same two rosters** — a
control (both sides stripped honest) and a treatment (home arms exactly one lever).
Pairing cancels roster luck, so the win-rate / margin delta is the lever's own effect.
Reports per lever: win-rate, margin lift, avg coin, biggest slot swing, coin cost,
lift-per-coin — and flags outliers vs cost-peers.

```
npx tsx tools/playtester/aggregate.mjs --week=1-14 --n=120
npx tsx tools/playtester/aggregate.mjs --week=1 --n=300 --only=te-nuke-all,momentum
```

## `adversary.mjs` — step 3: hindsight exploit oracle
A search *tool* (not what ships). Plays a MIRROR roster against a fixed honest opponent
(baseline margin exactly 0) and searches its own loadout WITH hindsight of the baked week
— coordinate ascent on per-slot metric + greedy buff add + priced metric-unlocks — to find
the strongest line. Any margin is a pure loadout exploit on identical material. Reports a
FREE (0-coin, metrics only) and PAID (≤budget) reading, the recurring exploit levers, and
the top exploit lines.

```
npx tsx tools/playtester/adversary.mjs --week=1-14 --n=40 --budget=200
```

## `iterate.mjs` — step 4: AI policy A/B
Pits a candidate AI policy against the current shipping one on a MIRROR roster (both blind,
same players → the margin is the pure policy edge). Sweeps combodrip thresholds and buy
order to choose a change *before* touching `src/data/aiLineup.ts`. The first shipped win:
buy the EV offensive buffs (momentum/overtime/garbage-time) instead of the old random draw.

```
npx tsx tools/playtester/iterate.mjs --week=1-14 --n=120
```

## `window.mjs` / `counter.mjs` — within-window optimization
`window.mjs` A/Bs Field General rules (the main in-window synergy) vs the shipping "≥2
drips" rule; `counter.mjs` tests opponent-roster-aware NUKE counters. Both find the
current AI is at its blind ceiling — no rule beats `count≥2`, and counters hurt (findings
§8). Useful as the evidence that within-window metric optimization has no free win blind.

```
npx tsx tools/playtester/window.mjs  --week=1-14 --n=200
npx tsx tools/playtester/counter.mjs --week=1-14 --n=300
```

## `form.mjs` — does recent form beat season projection?
Tests whether trailing weekly stats (the baked PBP *is* per-week 2025 data) improve AI
player selection, before wiring live weekly stats. Mirror roster, both blind, recent-form
vs season-to-date selection. Result: form has predictive signal (~70%) but recency loses
to the fuller prior sample, and selection rarely binds — so wire weekly stats only as a
season-to-date *freshness* upgrade, not a hot-hand selector (findings §7).

```
npx tsx tools/playtester/form.mjs --from=4 --to=14 --n=200 --lookback=3
```

## `invariants.mjs` — regression guard (run me after engine/AI edits)
Asserts the structural + balance properties the harness and the shipped changes rely on —
mirror baseline is exactly 0, Field General windows are all-drip, best players are fielded
on overflow, honest home win-rate ≈50%, a TD nuke suppresses the matched drip, and insurance
keeps a nuked drip alive. Exits non-zero on any failure (CI-friendly).

```
npx tsx tools/playtester/invariants.mjs
```

## `defense.mjs` — defensive buffs vs a nuker
Measures counter-nuke / insurance / floodgates / ot-shield against a nuking opponent (the
threat they counter), to price them. Found they're situational counters, not mis-priced
(findings §9).

```
npx tsx tools/playtester/defense.mjs --week=1-14 --n=200
```

## `scenario.mjs` — targeted suspect probes
Hand-built best-case lines for the handoff's "prime suspects" (TE-TD nuke trigger
rate + cascade, Twin Generals fg-stack multiplier, unilateral extra-slot coin farm) —
separates "the mechanic is weak" from "the random field never triggered it".

```
npx tsx tools/playtester/scenario.mjs --week=1-14 --n=200
```

## `livefire.mjs` — live-fire timing school (v0.126.0)
For the live tacticals (surge / cold-snap / napalm): WHEN should you fire?
Paired policies per play — blind fixed clocks, `on-hot` (fire at the target's
first hot streak, hold the coin otherwise), `hot-else-1800` (the shipping
manager rule), and a hindsight ORACLE grid that bounds timing skill. Findings
§19: late beats early, hot-else-late is the best honest policy for all three,
and the oracle reaches amp-grade value (napalm's timing gap is 8×).

```
npx tsx tools/playtester/livefire.mjs --week=1-14 --n=100
```

## `lateswap.mjs` — score-aware late swap (per-window locks, v0.95.0)
Windows seal one at a time, so a manager picks each later window knowing the real
margin of the windows already played. Both sides still lock a window at the same
kickoff (and slate-gating partitions rosters by window), so the measurable edge is
score-state VARIANCE management, not counter-picking. Policies: `gamble` (trailing →
skill players to the TD nuke), `gamble1` (only the weakest), `hail` (MNF-only, down
big), `protect` (leading → denial). Paired A/B vs blind honest; fired-cohort and
behind-at-half columns are the signal. See findings §10 — every variant measured
NEGATIVE: the metric menu prices variance at a ruinous EV discount, so there is
nothing profitable to spend the live-margin information on until NUKE/denial are
retuned.

```
npx tsx tools/playtester/lateswap.mjs --week=1-14 --n=120
```

## Battle-layer coverage (v0.124.0)
`resolve()` passes per-side `LiveExtras`, and `aggregate.mjs` levers can target
`win|slot` off the built lineups — so every targeted/live battle play is now
measured: `rivalry`, `jinx`, `grudge`, `lead-change`, `red-herring`,
`double-or-nothing`, `ghost`, `bye-steal`, `surge`, `cold-snap`, `napalm`,
`bunker`, `emp`, plus the `underdog`/`marshal` metric levers. The honest field
(`honestMatch` / `season.mjs`) arms the AI's RETRAINED battle plays (rivalry on
its densest window; ghost on an open slot) — findings §17.

## Not yet modeled
`turnover-boost` (no per-player turnover feed), `spy` (pure information; needs an
information-value driver), and the CLUTCH plays (conditional live offers — no
LiveExtras surface). Swaps/mulligan are measured as POLICIES in `lateswap.mjs`.
