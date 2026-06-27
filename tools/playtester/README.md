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
(`aiLoadout`, matching `server/src/lock.js:aiBudgetPass`), and `resolve()` which
annotates a `LiveResult` with margin / winner / biggest-slot swing.

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
