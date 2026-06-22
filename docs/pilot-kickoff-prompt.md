# New-session kickoff prompt — 2026 near-live H2H pilot

Paste the block below into a fresh session to start building. (Saved here so it's
versioned; edit before pasting if the decisions in §"Confirm first" have moved.)

---

You are picking up **Drip League FF** (repo `dachhack/ffgame`) to build a
**2026-season pilot**: **near-live, head-to-head PvP** so we can test whether the
real-time feel of the game is viable with a few real users. If the pilot goes
well we launch in 2027 on a **paid play-by-play feed**; for the pilot we use
**ESPN's free/unofficial API**.

**Before writing any code, read these in order** and confirm you understand the
current state:
- `docs/handoff.md` — current project state, deploy/branch model, conventions.
- `docs/espn-pbp-handoff.md` — the ESPN→data-contract plan (this is the data spine).
- `docs/commercialization-handoff.md` — §11 target architecture + cost model.
- `HANDOFF.md` (root) — the baked-PBP data pipeline + the `RealPlay`/`wN.json` contract.
- `README.md` — game design.

**What exists today:** a static Vite/React/TS SPA, no backend, deterministic
client-side replay of baked 2025 nflverse play-by-play; any Sleeper user can
import their league for a **vs-AI** sim. State is in `localStorage`. The scoring
engine (`src/engine/sim.ts`, `matchup.ts`) is **pure, deterministic TypeScript**
that consumes per-player `RealPlay[]` timelines — this is reusable server-side.

**What the pilot requires (the gap):** near-live + true H2H forces a
**server-authoritative backend**. Specifically:
1. **Accounts/auth** (lightweight — these are a handful of known testers).
2. **Server-held sealed picks** — each window's lineup+metrics are hidden until
   that window locks at kickoff, then revealed and resolved live. Picks must
   never be readable by the opponent before lock (the current client-only model
   can't guarantee this).
3. **Live ESPN ingestion** — poll the ESPN plays endpoint during games (~20–30s),
   normalize each play to the existing `RealPlay` shape via an ESPN→RealPlay
   **adapter** (see `docs/espn-pbp-handoff.md` §1–3), and persist it.
4. **Server-side resolution** — reuse `src/engine/sim.ts`/`matchup.ts` on the
   server to resolve each H2H matchup as plays arrive (authoritative scores).
5. **Realtime push** — stream live score/event updates to both players (WebSocket
   or SSE). Size for **NFL-Sunday peak concurrency**, not average (see
   commercialization §11.3).

**Design boundary to preserve:** keep the **`RealPlay`/`wN.json` data contract**
stable so the same engine serves baked-historical, ESPN-live, and (2027) paid
feeds by swapping only the adapter. Validate the ESPN adapter by re-deriving a
2025 week and diffing against the committed `public/pbp/*.json` (this is the
cheap correctness gate — do it before trusting live data).

**Recommended approach (propose a plan before building):**
- Lean stack for a few users: one backend service + Postgres + a realtime channel
  + auth. Supabase (Postgres+Auth+Realtime) or a small Node/Fastify service on
  Fly/Render are both fine — recommend one with reasons and rough cost.
- Reuse the existing React client; add an authenticated "live H2H" mode alongside
  the existing static vs-AI demo (don't break the demo — it's the shop window).
- Share the engine TS between client (optimistic display) and server
  (authoritative resolution).
- Build order: (A) ESPN→RealPlay adapter + 2025 diff validation → (B) backend +
  auth + data model (users/leagues/matchups/sealed-picks/plays) → (C) sealed-pick
  H2H flow with server lock/reveal → (D) live ESPN poller → server resolution →
  (E) realtime push to clients → (F) closed pilot with the playtesters.

**Confirm with the founder first (don't assume):**
- Stack/hosting choice and budget for the pilot.
- How pilot leagues/matchups are seeded — one manually-created tester league, or
  Sleeper import? How are the H2H pairings set each week?
- Account model (magic-link email vs Sleeper handle + email).
- Anti-cheat depth for a trusted pilot (can be light now; server-authoritative
  picks are the non-negotiable part).
- No real money in the pilot (cosmetic/economy stays local for now) — confirm.

**Constraints (persist):**
- Work/deploy branch model in `docs/handoff.md` — the static site deploys to
  GitHub Pages from a specific branch; do not break that pipeline. New backend
  code likely lives in a new service/dir and deploys separately — propose where.
- Commit trailers required (`Co-Authored-By: Claude Opus 4.8 …` + `Claude-Session:`);
  the model id never appears in committed artifacts. No PRs unless asked.
- GitHub MCP scope is `dachhack/ffgame` only.

**First deliverables:** (1) a short plan + stack recommendation + the open
questions answered; (2) the ESPN→RealPlay adapter with a 2025 validation diff;
(3) a data-model sketch for users/leagues/matchups/sealed-picks/live-plays. Then
build incrementally, smallest shippable slices first.
