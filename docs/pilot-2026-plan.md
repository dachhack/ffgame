# 2026 near-live H2H pilot — plan, stack, data model

_Working branch: `claude/admiring-brown-x5limu`. This is the planning + first-slice
deliverable for the near-live, head-to-head PvP pilot. Read alongside `HANDOFF.md`
(the `RealPlay`/`wN.json` data contract) and `docs/handoff.md` (deploy model)._

## 0. State of the repo vs. the kickoff brief (read this first)

The kickoff prompt told me to read `docs/espn-pbp-handoff.md` and
`docs/commercialization-handoff.md`. **Neither exists in the repo** — only
`docs/handoff.md` and `docs/mcp-requests.md` are present. I proceeded from the
actual code (`src/data/realPbp.ts`, `src/engine/sim.ts`, `scripts/pbp/genRealPbp.mjs`)
which fully defines the data contract, so nothing was blocked — but if those docs
exist elsewhere, hand them over and I'll reconcile.

Also: `docs/handoff.md` names `claude/youthful-albattani-s9kprl` as the Pages
deploy branch; this session's working branch is `claude/admiring-brown-x5limu`. I
have **not** touched the deploy pipeline. New backend code lives in new dirs
(`server/`, `supabase/`, `scripts/espn/`) that don't deploy to Pages, so the
static demo "shop window" is untouched.

## 1. Two findings that shape the build

**(a) ESPN network egress is restricted.** Only `site.api.espn.com` is
allowlisted in this environment. `sports.core.api.espn.com` — which carries the
structured per-play `participants` (athlete ids per role: passer/rusher/receiver)
— returns `403 Host not in allowlist`. So the live adapter must attribute plays
from the `summary` endpoint's **play text** ("D.Prescott pass short right to
G.Pickens … for 6 yards") plus the **boxscore roster** (full names + ESPN athlete
ids + team). If we allowlist `sports.core.api.espn.com` later, the adapter can
swap text-parsing for structured participants with no contract change. **Decision
needed:** allowlist core.api, or stay on text-parsing (it validates well — see §4).

**(b) ESPN play-id ⊃ nflverse play_id.** The committed baked data carries `pid`
(nflverse `play_id`). ESPN's play `id` is `<eventId><play_id>` — e.g. baked
`dak-prescott` play `pid:141` ↔ ESPN play `401772510141`. So
`pid = Number(espnPlayId.slice(eventId.length))` gives a near-exact join between
ESPN and baked data. This is the cheap correctness gate (and the future
live-feed gate the `pid` field was baked for).

## 2. Recommended stack (CONFIRM)

**Supabase (managed Postgres + Auth + Realtime + Row-Level Security) + one small
Node worker for the ESPN poller/resolver (Fly.io).**

Why:
- **Sealed picks need RLS, not app-layer checks.** With Postgres RLS, a pick row
  is literally unreadable by the opponent's JWT until the server flips it to
  `locked` — the non-negotiable anti-cheat property, enforced by the database, not
  hopeful client code. This is the single strongest reason to pick Supabase.
- **Realtime is built in.** Postgres change → WebSocket fan-out to both players,
  scoped by RLS. No bespoke socket server to size for Sunday peak.
- **Auth is built in** (email magic-link; Sleeper has no OAuth, so we link a
  Sleeper user-id to an email account — see §3).
- The **ESPN poll loop + server-side engine resolution** wants a long-lived
  process, which Supabase Edge Functions (Deno, time-boxed) are a poor fit for —
  so a **tiny always-on Node worker** (Fly.io machine) polls ESPN, writes
  normalized plays to Postgres, runs `buildMatchup`/`resolveSlot`, and writes
  results; Realtime does the push.

**Rough pilot cost:** Supabase Pro ~$25/mo (free tier likely fine for a handful
of testers) + Fly tiny shared-cpu machine ~$2–5/mo ≈ **$25–30/mo**.

**Alternative considered:** all-in-one Node/Fastify + Postgres + `ws` on
Render/Fly. Fewer vendors, but we'd hand-build auth, realtime fan-out, and
RLS-equivalent row guards — more code and more ways to leak a sealed pick. Not
worth it for a trusted pilot. Recommend Supabase.

## 3. Open questions — my recommendations (CONFIRM)

| Question | Recommendation |
|---|---|
| **Account model** | Email magic-link (Supabase Auth) + link a Sleeper user-id (enter username → resolve via Sleeper API → store). No separate password identity; Sleeper has no OAuth. |
| **Anti-cheat depth** | Light. The only hard requirement: server-held sealed picks (RLS-gated, locked at kickoff) + the engine's existing **real-wall-clock (`t`) gating** so a delayed feed can't scoop a play. No device attestation etc. for a trusted pilot. |
| **Pilot scope** | A **3–4 week** window of **one** Sleeper league, with all testers enrolled (so we exercise true two-sealed-picks H2H), rather than a full season. Faster feedback, less exposure to ESPN-feed flakiness. |
| **ESPN core.api** | Stay on text-parsing for now (validates at 99% attribution, §4); allowlist `sports.core.api.espn.com` only if we want structured participants to kill the last edge cases. |

## 4. ESPN→RealPlay adapter + 2025 validation (DELIVERED)

`scripts/espn/espnAdapter.mjs` — pure normalizer: `gameToRealPlays(summary,
resolveSlug)` → `{ [slug]: RealPlay[] }`, the exact contract the engine consumes.
Maps ESPN play `type`+`text` → `RealPlayKind`, `period`+`clock` → `c`,
`wallclock` → `t`, play-id suffix → `pid`, `statYardage`/`yardsAfterCatch` →
yards/completion, `scoringPlay`+text → `td`. Players are resolved by anchoring to
the game's boxscore roster (a regex of real "F.Last" abbreviations — never grabs a
verb), with an injectable `resolveSlug` (production: ESPN athlete-id → Sleeper
`espn_id` → slug; validation: crosswalk by normalized name).

**Full kind set emitted** in one pass: `pass · rush · rec · incomplete · sack ·
int · fumrec · dst_td · safety · fg · fgmiss · xp · xpmiss · return`. Covers
made/missed/blocked FGs, interception returns (incl. pick-sixes), fumble/punt/
kick return TDs, and KR/PR return yards (the `return` kind for the retyd metric).

`scripts/espn/validate.mjs` — fetches a real 2025 week from ESPN, normalizes, and
diffs against the committed `public/pbp/wN.json` on `(slug, pid)`, plus a returns
cross-check against `src/data/returns.ts`.

**Results (weeks 1–3, 16 games each — consistent, not overfit):**
- **~95%** of baked plays reproduced from ESPN (95.1 / 95.4 / 95.2%).
- **99.4–99.7%** of matched plays attribution-exact (kind + yards + TD); **0–3**
  kind mismatches per week.
- Returns: **86–95%** yard-exact on plays joinable to `returns.ts`.
- Per-player points (wk1): **348 exact / 25 within 1.0 / 49 off** of 422.

Remaining deltas are understood, not mysterious — and the off-by-points are
dominated by the **validation resolver**, not adapter logic:
- **Initials collisions** — e.g. JAX `T.Etienne` (Travis vs Trevor Etienne,
  brothers on one team) — unsolvable from initials-only text; the production
  **athlete-id join eliminates it**. (~all of the skill-position point misses.)
- **Nickname slugs** ("Joshua Palmer" vs nflverse `josh-palmer`) — also gone with
  the id join.
- **XP pid-join artifact** — ESPN bundles the extra point into the TD play (one
  id); nflverse gives the XP its own `play_id`, so XPs don't pid-match. The XP is
  still emitted and scored correctly — it's a join artifact, not a miss.
- **`statYardage` vs nflverse** — a handful of plays/week differ slightly.

**Parser lessons worth keeping** (each was a real bug found against the baked
truth): trust the play **type**, not the text, for interceptions (reversed-on-
replay and 2-pt-conversion picks still say "INTERCEPTED"); attribute kickers by
the **kicker's name → team**, not the play's offense id (some scoring plays omit
team ids); anchor name matching to the **boxscore roster** (a generic "F.Last"
token grabs verbs).

Run it: `node scripts/espn/validate.mjs 1` (any week 1–14).

## 5. Data-model sketch (Postgres / Supabase)

```
app_user            id (=auth uid) · email · sleeper_user_id · sleeper_username · display_name
league              id · sleeper_league_id · season · name · settings_json · synced_at
league_membership   league_id · sleeper_roster_id · sleeper_owner_id ·
                    app_user_id (nullable) · enrolled (bool) · team_name
                    -- app_user_id NULL ⇒ unenrolled opponent (Sleeper-lineup fallback)
matchup             id · league_id · week · sleeper_matchup_id ·
                    home_roster_id · away_roster_id ·
                    status (scheduled|locked|live|final) · lock_at · home_final · away_final
                    -- mirrors the Sleeper schedule pairing for that week
sealed_pick         id · matchup_id · app_user_id · window · roster_slot ·
                    player_slug · metric_id · locked (bool) · revealed_at
                    -- RLS: owner-only SELECT until locked; both participants after lock
applied_state       matchup_id · app_user_id · week · payload_json
                    -- server mirror of the client `applied[week]` (powerups/swaps/buffs)
sleeper_lineup      league_id · week · roster_id · starters_json
                    -- the real Sleeper starters; the unenrolled-opponent fallback + player pool
live_play           week · game_id · player_slug · c · t · pid · k · y · td · ca · tg · to
                    -- normalized RealPlay rows from the ESPN poller; UNIQUE(week,game_id,pid,player_slug,k)
matchup_state       matchup_id · window · home_score · away_score · events_json · updated_at
                    -- engine output; Realtime pushes this to both clients
```

**RLS, the load-bearing part:** `sealed_pick` SELECT policy = `app_user_id =
auth.uid() OR (locked AND auth.uid() ∈ matchup participants)`. So a pick is
unreadable by the opponent until the server locks the window. `matchup`,
`matchup_state`, `applied_state` are readable by the two participants.

## 6. Sleeper sync flow (B)

1. **Sign in** (magic-link) → enter Sleeper username → resolve `sleeper_user_id`
   (reuse `src/data/sleeper.ts:resolveUser`, lifted server-side).
2. **Pick league** — `get_sleeper_user_leagues` → choose league(s) → import:
   league settings, users, rosters → `league` + `league_membership`. Mark
   `enrolled=true` where a membership's `sleeper_owner_id` links to an `app_user`
   with a verified `sleeper_user_id`.
3. **Schedule** — per week, `get_sleeper_matchups(week)`, group by
   `matchup_id` to get pairings → upsert `matchup` rows that **mirror the Sleeper
   schedule**; set `lock_at` from the NFL slate (first kickoff of the week,
   `src/data/nflSlate.ts`).
4. **Lineups** — per week store `sleeper_lineup.starters` (the player pool, and
   the unenrolled-opponent fallback).
5. **Live** — Node worker polls ESPN (~20–30s) during windows →
   `gameToRealPlays` → upsert `live_play`. On new plays, for each live matchup:
   gather both sides' `RealPlay[]` (from `live_play` by `player_slug`) + revealed
   sealed picks (enrolled) or `sleeper_lineup` (fallback) → run
   `buildMatchup`/`resolveSlot` → write `matchup_state` → Realtime push.

## 7. Build order & status

- **(A) ESPN→RealPlay adapter + 2025 diff** — ✅ done (§4).
- **(B) Backend + auth + data model + Sleeper sync** — sketched (§5–6); blocked on
  the stack confirm (§2–3).
- **(C) Sealed-pick H2H flow** (server lock/reveal + unenrolled fallback) — after B.
- **(D) Live ESPN poller → server resolution** — adapter ready; needs the worker host.
- **(E) Realtime push** — Supabase Realtime once B lands.
- **(F) Closed pilot** with playtesters.

**Engine sharing:** `src/engine/{sim,matchup}.ts` are already pure/deterministic.
Extract them into a shared package consumed by both the Vite client (optimistic
display) and the Node worker (authoritative resolution), keeping the `RealPlay`
contract frozen. Do this when B starts so client and server can't drift.

## 8. Constraints carried forward
- Static demo deploys to Pages from the deploy branch in `docs/handoff.md` — do
  not break it. Backend lives in `server/` + `supabase/`, deployed separately.
- Commit trailers required (`Co-Authored-By` + `Claude-Session`); the model id
  never appears in committed artifacts. No PRs unless asked.
- GitHub MCP scope: `dachhack/ffgame` only.
