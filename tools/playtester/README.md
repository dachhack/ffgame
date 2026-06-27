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

## `scenario.mjs` — targeted suspect probes
Hand-built best-case lines for the handoff's "prime suspects" (TE-TD nuke trigger
rate + cascade, Twin Generals fg-stack multiplier, unilateral extra-slot coin farm) —
separates "the mechanic is weak" from "the random field never triggered it".

```
npx tsx tools/playtester/scenario.mjs --week=1-14 --n=200
```

## Not yet modeled
The pure resolver does not implement these power-ups, so the harness reports no
signal for them: `double-or-nothing`, `turnover-boost`, `spy`, `trick-play`,
`hail-mary`, `pick-six`, `bye-steal`, `metric-swap`, `player-swap`, `mulligan`,
`emp`. Measuring them needs either engine support or a separate driver.
