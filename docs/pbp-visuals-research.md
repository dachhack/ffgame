# Play-by-Play Field Visuals — Research & Feasibility

> **Ask:** Sleeper/ESPN-fantasy-style live game visuals — a field diagram per
> game with the ball marker, a play arc, the down-&-distance banner, and the
> live play text ("J. Garoppolo pass short right to G. Kittle; pushed ob at
> LAR 30 for 15 yards"), animating play by play while games run.
>
> **Verdict: very feasible, and cheaper than it looks.** ~80% of the plumbing
> already exists in this repo. The live poller already downloads the complete
> ESPN game summary — which contains every play's down, distance, yardline,
> possession, description, and score — and then *throws the spatial data away*
> after extracting fantasy stats. The feature is a data-contract extension plus
> a new SVG field component, not a new pipeline.
>
> _Researched 2026-07-03. ESPN payload shapes verified by fetching a real 2025
> game (ARI@CIN W17, event `401772954`)._

---

## 1. What we already have (and what's missing)

| Layer | Today | Gap for visuals |
|---|---|---|
| Live ingestion | Worker polls ESPN `summary?event={id}` every 25s (`server/src/poll/plays.js`), scoreboard every 60s | None — the summary response **already contains the full `drives` payload** with everything the visual needs. Zero extra API calls. |
| Adapter | `scripts/espn/espnAdapter.mjs` → `RealPlay {c,t,pid,k,y,td,ca,tg,to}` (fantasy stats only) | Emit a second, per-**game** feed keeping `start`/`end` situation, play text, score. Today those fields are parsed past and dropped. |
| Storage | `live_play` (per-player fantasy rows) + Supabase Realtime on `matchup_state` | New `live_game_play` table (or per-game JSONB doc) + add to the Realtime publication (mirror `0005_realtime.sql`). |
| Historical/replay | `public/pbp/wN.json` baked from nflverse — no down/yardline/text (columns were filtered out at bake time) | Re-bake a parallel `public/gamefeed/` set. Stathead MCP has `down`, `ydstogo`, `yardline_100` per play (verified); play *text* comes from ESPN's historical summaries, which `scripts/espn/validate.mjs` already fetches for 2025. |
| UI | Text feed + score board in `Matchup.tsx` (feed clock machinery: `game`/`feed`/`real` modes) and `LiveBoard.tsx`. No field diagram, no SVG/canvas beyond tiny icons, no animation lib | New `FieldView` SVG component. Plain SVG + CSS transitions suffice (Sleeper's arc is decorative, not tracked trajectory — see §2). Mounts on the existing per-slot `GameLine` expandable and/or `LiveBoard`. |

## 2. Data source research (verified)

### ESPN unofficial API — the recommended source (and the one we already use)

`site.api.espn.com/.../summary?event={id}` includes `drives.previous[]` (+
`drives.current` in-game), each with `plays[]`. Verified per-play fields:

```json
{
  "type": {"text": "Pass Reception"},
  "text": "(Shotgun) J.Burrow pass short left to S.Perine pushed ob at CIN 31 for 8 yards (D.Taylor-Demerson).",
  "period": {"number": 1}, "clock": {"displayValue": "7:06"},
  "awayScore": 0, "homeScore": 7,
  "scoringPlay": false, "isPenalty": false, "isTurnover": false,
  "statYardage": 8, "yardsAfterCatch": 13,
  "wallclock": "2025-12-28T18:20:46Z",
  "start": {"down": 2, "distance": 8, "yardLine": 23, "yardsToEndzone": 77,
            "downDistanceText": "2nd & 8 at CIN 23", "team": {"id": "4"}},
  "end":   {"down": 1, "distance": 10, "yardLine": 31, "yardsToEndzone": 69, "team": {"id": "4"}}
}
```

Drive objects carry `result` ("Touchdown"), `yards`, `timeElapsed`, `isScore`,
team logos — exactly a drive-chart's data model. The summary also has
`scoringPlays` (clean scorer attribution) and `winprobability` per play (a free
bonus stat for the UI). The scoreboard endpoint adds a per-game `situation`
object (`down`, `distance`, `possession`, `lastPlay`, `isRedZone`) — a cheap
single call covering all live games for a red-zone indicator.

- **Latency:** it's the Gamecast feed — plays land seconds after they end.
  Community practice is 5–15s polling; our 25s cadence is already polite.
- **No lateral (x) coordinates exist** in any consumer feed. Sleeper's pass
  arc is synthesized from start→end yardline + play type (`statYardage` /
  `yardsAfterCatch` even give the air/YAC split for receptions). 1-D field
  position is genuinely all these visuals use.
- **Risk:** unofficial, shapes can drift, ToS-gray for a monetized product —
  same posture as `docs/espn-pbp-handoff.md` §5 (fine for the pilot; the 2027
  paid-feed swap stays adapter-only).

### Alternatives (for the record)

| Source | Live PBP? | Cost | Notes |
|---|---|---|---|
| nflverse/nflfastR | No — raw JSON ~15 min post-game, clean data nightly | Free | Perfect for replay fixtures + offseason dev, useless in-game |
| Sleeper public API | No PBP (verified `/v1/plays/*` → 404); weekly stat lines only | Free | Sleeper's own visuals run on licensed Sportradar over a private websocket |
| NFL Shield API | Partner-only OAuth; old Gamecenter JSON is dead | — | Not viable 2026 |
| SportsData.io Discovery Lab | Yes, incl. yardlines | ~$99–149/mo hobby tier | The realistic paid fallback |
| MySportsFeeds | Yes | Free/cheap non-commercial | Legit-but-cheap fallback |
| Sportradar / Stats Perform | Yes, ~1–2s push, official | $10k+/mo, contracts | The 2027 "if it takes off" path |

## 3. Proposed design

### 3.1 New data contract — `GamePlay` (per game, all plays)

Unlike `RealPlay` (per *player*, fantasy plays only), the visual needs **every
play of a game** — punts, kneels, penalties, timeouts included — keyed by game:

```ts
// src/data/gameFeed.ts
interface GamePlay {
  pid: number;        // ESPN/nflverse play id (reconcile key, same as live_play)
  c: number;          // game-elapsed seconds (existing clockOf formula)
  t?: number;         // real seconds since first snap (wallclock)
  drv: number;        // drive ordinal
  team: string;       // possession, e.g. "SF"
  dn: number;         // down 0–4 (0 = kickoff/XP/no-down)
  dist: number;       // yards to go
  yl: number;         // start yardsToEndzone (100 → own goal line, 0 → score)
  yl2: number;        // end yardsToEndzone
  k: string;          // play type text/abbrev ("Pass Reception", "Punt", …)
  txt: string;        // full play description
  sc?: 1;             // scoring play
  pen?: 1; to?: 1;    // penalty / turnover flags
  hs: number; as: number; // score after the play
}
```

Size: ~250 bytes/play × ~170 plays/game × 16 games ≈ **~700 KB per week raw,
~150 KB gzipped** — trivial for both Supabase and `public/` static hosting
(the existing `pbp/` weeks are 240 KB each already).

### 3.2 Pipeline changes

1. **Adapter** — add `gameToFeed(summary): GamePlay[]` in `espnAdapter.mjs`.
   It reads the *same* `drives` payload `gameToRealPlays` already walks; the
   `start`/`end` objects need no name-resolution (the hard crosswalk problem
   doesn't exist here — team + text is all the visual shows).
2. **Poller** — in `pollGame` (`server/src/poll/plays.js`), also upsert the
   feed. Two options:
   - a `live_game_play` row table mirroring `live_play`'s reconcile logic
     (upsert by `(week, game_id, pid)`, delete stale) — plays get revised
     mid-game, so reuse the proven pattern; or
   - one JSONB doc per game (`game_feed(week, game_id, plays jsonb)`) —
     simpler, one Realtime event per poll instead of N row events. **Recommended.**
3. **Realtime** — add the table to the publication; client subscribes per
   visible game (mirror `subscribeMatchup` in `src/data/liveApi.ts`).
4. **Baker (replay/demo)** — `scripts/pbp/genGameFeed.mjs` emitting
   `public/gamefeed/wN.json` (`Record<gameId, GamePlay[]>`) for the 2025 weeks,
   sourced from ESPN historical summaries (the `validate.mjs` fetch path).
   This gives the demo/no-backend mode the same feature — and lets us build
   the whole UI **now, in the offseason**, against real drives.

### 3.3 The `FieldView` component

New `src/app/FieldView.tsx` (or `screens/`), pure SVG + CSS transitions:

- Perspective-skewed field (a `transform: perspective(...) rotateX(...)` on the
  SVG container reproduces Sleeper's trapezoid), yard ticks, end zones in team
  colors, first-down line at `yl - dist`.
- Ball marker at `yl2` with the possessing team's logo (we already have
  `teamAssets`/logos); animate marker position with a CSS transition on `cx`.
- Play arc: quadratic Bézier from `yl → yl2` for passes (`statYardage` split
  via `yardsAfterCatch` if we want the catch-point kink), flat slide for runs,
  dashed for punts/kicks. Fade in the `txt` banner + `downDistanceText` chip.
- Drive summary strip (Sleeper's "1ST & 10 @ LAR 30" bar) straight from `dn`,
  `dist`, `yl`.
- Driven by the **existing feed clock**: in live mode, plays where `t ≤ now`;
  in replay mode, `Matchup.tsx`'s `game`/`feed`/`real` clock machinery already
  produces the current feed position — `FieldView` just renders the latest
  play at-or-before it. No new animation dependency needed; if we ever want
  springier motion, framer-motion is the obvious add.

Mount points: the per-slot `GameLine` expandable in `Matchup.tsx` (tap a game
row → field opens above the log) and `LiveBoard.tsx`.

## 4. Phased build estimate

| Phase | Scope | Effort |
|---|---|---|
| **A — Replay visuals (no backend)** | `genGameFeed.mjs` bake for 2025 w1–w14 + `GamePlay` loader + `FieldView` + mount in `Matchup` replay | 2–3 sessions. Ships to the demo immediately; fully testable offseason |
| **B — Live wiring** | Adapter `gameToFeed` + `game_feed` table/migration + poller upsert + Realtime sub | ~1 session; dress-rehearse with the existing **Simulate live feed** action (`simulate.yml`), which replays baked weeks through the live path |
| **C — Polish** | Scoring-play takeover animation, red-zone glow (scoreboard `situation.isRedZone`), win-prob ticker, drive-chart history strip | as desired |

Phase A is the smart start: same renderer, real 2025 drives, zero new infra,
and it doubles as the visual layer for the demo's existing replay mode.

## 5. Risks & watch-items

- **ESPN shape drift / ToS** — unchanged from `espn-pbp-handoff.md` §5; the
  `GamePlay` contract is the swap boundary (SportsData.io/MySportsFeeds/
  Sportradar all provide equivalent yardline data).
- **Penalties, laterals, no-plays** — don't *derive* field position from
  yardage; always render ESPN's authoritative `end` situation. Overturned
  plays are handled by the existing reconcile-by-`pid` pattern.
- **`drives.current` quirk** — the in-progress drive lives in a separate key
  from `previous`; the adapter must walk both (live only).
- **Timeouts/end-period rows** have no situation change — filter to plays with
  a `start` object or render as banner-only events.
- **Perf** — one SVG with a handful of animated nodes per game; nothing to
  worry about, even with 6 fields open.

## 6. Bottom line

No new data vendor, no new API calls, no meaningful storage cost. The bytes
for Sleeper-style visuals are already flowing through `pollGame` every 25
seconds and being discarded. The work is: keep them (adapter + one table +
one baker script), and build one good SVG field component on the feed-clock
machinery the app already has.
