# Drip League FF

A **real-time fantasy football game** of hidden picks and live effect resolution — and a working web demo, the **Drip Test League**, running on genuine 2025 NFL data.

Instead of accumulating raw points, you assign each roster player to a game-time **window slot** and pair them with a **hidden scoring metric** that carries a strategic *effect* (nuke, erase, hot streak, multiplier…). Your opponent does the same, sealed. When games kick off, picks reveal and effects fire live — banks tick up, nukes wipe scores to zero, streaks double drip rates, erasures cancel windows of accumulation.

👉 **Live demo:** https://dripfantasy.com

---

## What's in the demo

Four screens, fully navigable, in seven switchable themes (`tactical` / `neon` / `prime` / `daylight` / `arctic` / `slate` / `dusk`):

1. **League Hub** — your Sleeper dynasty portfolio.
2. **League Overview** — Drip Test League standings, your week matchup, full-season schedule, every team's roster, and the waiver wire (all real 2025 NFL data).
3. **Matchup** — the core loop, one screen with **SETUP → LIVE → FINAL** phases. Build a lineup across the 5 windows, seal a hidden metric per slot, then watch it resolve live with play-by-play.
4. **Matchup Final** — the whole-week result across all 5 windows.

### The game mechanics

- A week is split into **5 windows**: TNF (1 slot), SUN 1PM (3), SUN 4PM (2), SNF (1), MNF (1) = **8 slots**.
- Each slot pairs a **player** with a **hidden metric**. The metric sets how the player scores *and* an effect:
  - **NUKE** (TDs) — each TD wipes the opponent's banked score in that slot to zero.
  - **ERASE** (receptions) — each catch erases the opponent's drip from the last ~10 minutes.
  - **HOT STREAK** (rec yards) — 3 straight catches with no opponent score → drip doubles (2×).
  - **MULTIPLIER / FIELD GENERAL** (QB) — flavored drip in the demo (see simplifications).
  - **COMPRESSION / RATE RESET / CLOCK STOP** — secondary denial effects.
- A slot is **won** by whoever has the higher bank when its games end.

---

## Data provenance

The NFL stats, schedule and scores are **not** mock data — they come from the [Stathead MCP](https://www.stathead.com) (nflverse + Sleeper sources). The league wrapped around them, though, is **sanitized**: team names, manager handles, avatars and the league name are fabricated, so the demo never exposes a real person's private league (see the note at the top of `src/data/league.ts`).

- **League, rosters, standings, schedule** — the **Drip Test League**, a sanitized 10-team 2QB dynasty re-skin over a genuine 2025 season. "Taco Time Titans" (manager `tacotuesday`) is you, the 11-3 regular-season #1 seed.
- **Player box scores** — real 2025 season totals for ~250 skill players (`src/data/statsRaw.ts`), which seed every simulated game.

The live scoring is a **deterministic simulation**: each player's real season averages set a weekly baseline, seeded variance gives boom/bust texture, and the metric effects resolve over a generated play-by-play timeline. A given matchup always plays out identically — no backend required, which is what makes it a pure static site.

### Honest simplifications (documented in `src/engine/sim.ts`)

- **Field General** (QB multiplier) scores a light direct drip instead of a true cross-slot window multiplier, so each slot stays self-contained.
- **Rate Reset / Clock Stop / Compression** render as flavor badges plus a mild denial rather than full mechanical models.
- **NUKE, ERASE and HOT STREAK are modeled for real.**

---

## Tech

- **Vite + React + TypeScript**, no UI framework — design tokens applied as CSS custom properties (`src/theme.ts`).
- Zero runtime data fetching; the league + stats are bundled, so it deploys as static files.

```bash
npm install
npm run dev        # local dev server
npm run build      # type-check + production build to dist/
npm run preview    # preview the production build
```

### Project layout

```
src/
  theme.ts            design tokens (3 themes, position pills, effect colors)
  types.ts            shared types
  config.ts           DEMO_WEEK and demo constants
  data/
    statsRaw.ts       real 2025 box scores (CSV from Stathead)
    players.ts        stats parser + name matching + seeding hash
    metrics.ts        the 5 windows + per-position metric catalog
    league.ts         real teams, rosters, standings, 14-week schedule
  engine/
    sim.ts            per-week box lines + slot resolution (NUKE/ERASE/STREAK)
    matchup.ts        window assignment, default lineups, week resolution
  app/                store (theme + routing) + shared UI
  screens/            LeagueHub, LeagueOverview, Matchup, MatchupFinal
```

---

## Deploying to GitHub Pages

A workflow (`.github/workflows/deploy.yml`) builds and deploys to GitHub Pages on every push to `main` (the default branch, which is allowed to publish to the `github-pages` environment). Merging a PR into `main` deploys automatically. **One-time setup:** in the repo's **Settings → Pages**, set **Source = GitHub Actions**.

The site is served from the custom domain **dripfantasy.com** (`public/CNAME`), so the workflow builds with `VITE_BASE=/`. The Vite `base` otherwise defaults to `/ffgame/` (matching the repo name) for a plain GitHub Pages path — override it with `VITE_BASE`, as the deploy does to serve from the domain root.

---

## Roadmap

This demo is phase 1. The original ask runs further:

- **Phase 2 — the real website.** Replace the simulation with a live data layer: pull lineups from the Sleeper league API, and drive scoring from a real-time NFL play-by-play feed (websocket/poll) with banks computed server-side. Add auth and persisted picks/locks.
- **Phase 3 — native iOS & Android.** The data layer (`src/data`) and game engine (`src/engine`) are deliberately UI-agnostic and portable. Wrap them in **Expo / React Native** to ship the same SETUP/LIVE/FINAL loop to phones, sharing engine code with the web app.

---

*Gridiron Clash — built from the design handoff and real 2025 NFL data.*
