# Native Leagues — Draft · Waivers · Team Management

> **Question:** the game's biggest structural liability is that it requires a
> league that already exists in another product (Sleeper/ESPN/Yahoo/Fleaflicker/
> MFL). What if we built a draft, a waiver system, and team management into the
> app, so a league can be born — and live its whole season — inside Drip?
>
> **Short answer:** the machinery was already 90% provider-agnostic. The lock/
> resolve/live-board pipeline consumes opaque integer roster ids, a namespaced
> league key, and player *slugs* — nothing downstream ever calls Sleeper. What
> was genuinely missing is **roster construction**: a player pool, a draft, and
> add/drop. That's what migration `0064_native_leagues.sql` adds, and it's live
> in this branch end-to-end: create → invite → snake draft → waivers/FA →
> weekly lineups → the existing live H2H pipeline, unchanged.
>
> **Rollout gate (v0.99.1):** league *creation* is restricted to super admins
> (`is_admin()`) while the feature is in closed testing — enforced in
> `create_native_league` itself and mirrored in the UI (the "Start a fresh
> league" option only renders for admins). Creation is the single choke point
> (every other native RPC requires an existing native league), so opening the
> feature up later is deleting one check. *Joining* a native league by invite
> code stays open to everyone, so an admin can test with non-admin accounts.

---

## 1. Why this was cheap: the contract was already narrow

Findings from the codebase survey (see also `docs/multiplatform-live-plan.md`,
which established the pattern when ESPN was plugged in):

- **"Sleeper" is a naming convention, not a dependency.** `league.sleeper_league_id`
  is an opaque unique key (ESPN leagues already use `espn-<id>`);
  `league_membership.sleeper_roster_id` is just a stable per-league integer;
  `sleeper_lineup.starters_json` is the weekly player pool in `{slug, full, pos}`
  form, produced by whoever imports the league.
- **The whole pipeline reads exactly four row-sets:** `league`,
  `league_membership`, `matchup` (with `lock_at`), and `sleeper_lineup` per week.
  Provide those and lock (`server/src/lock.js`), resolve (`server/src/resolve.js`),
  sealed picks, the live board, wallets, power-ups, and premium all work
  untouched.
- **Live scoring never came from the league platform anyway** — the ESPN
  play-by-play feed drives `live_play` for every league. So a native league
  scores exactly like an imported one.
- **Slugs are the only hard requirement:** pool players must use engine slugs
  (`normName(full)` hyphenated; `<team>-k` / `<team>-dst`) or live scoring finds
  no plays. The native pool is therefore seeded **from the baked-PBP player set**
  (`BAKED_SLUGS`, ~440 skill players + 32 K + 32 DST), so *every draftable player
  actually scores in the engine* — a stronger guarantee than imported leagues
  give (they name-match ~87–90%).

What no external product is needed for anymore: league creation, membership,
identity (email/OAuth accounts already exist), schedule (round-robin generated
in-app), rosters (drafted in-app), weekly pools (materialized from rosters).

## 2. What 0064 adds

### Tables (all additive; RLS member-read, RPC-only writes)

| Table | Purpose |
|---|---|
| `league_pool` | Ranked draftable universe per league (slug, name, pos, team, rank, `waived_until`) |
| `native_roster` | Persistent team rosters — the first roster construction in the codebase; unique `(league_id, slug)` = one owner per player |
| `draft` | One row per native league: status pending/live/complete, rounds, pick clock, snake `draft_order`, `current_overall`, `deadline_at` |
| `draft_pick` | The pick log (overall, round, roster, slug, `auto` flag) |
| `waiver_claim` | Pending/won/lost/cancelled claims; pending rows visible only to claimant + commish |
| `league_membership.waiver_priority` | Rolling waiver order (initialized as reverse draft order; winner rotates to back) |

### RPCs

- **Creation/joining** — `create_native_league(name, season, teams, rounds,
  pick_seconds)`: caller becomes commissioner + takes seat 1, seats 2..N open,
  invite code shared as a link. `native_join(code, team_name?)`: claims the
  lowest open seat directly — native leagues need no commissioner mapping step,
  because there is no external identity to match. `set_team_name`. The existing
  `join_league` / `admin_assign_roster` / `commish_claim_roster` paths still work.
- **Pool + schedule** — `seed_league_pool(league, players[])` (commish,
  pre-draft; client sends the baked-PBP set ranked by real 2025 production —
  `src/data/nativeLeague.ts buildDraftPool()`). `native_generate_schedule(league,
  weeks)`: circle-method round-robin (odd team counts get byes), `lock_at` from
  `nfl_slate`'s first kickoff per week (the 2026 slate ships in 0051; the
  worker's `backfillLockAt` covers any gap).
- **Draft** — `start_draft(league, order?)` (random or explicit order; also
  initializes waiver priority), `make_draft_pick(league, slug)` (turn-validated;
  commissioner may proxy-pick any seat), `draft_tick(league)` (autopicks every
  overdue, vacant, or AI seat — **any member's poll advances the draft**, so it
  runs with zero server help; the worker sweep is the safety net),
  `draft_state(league)` (one-shot poll: board + on-clock + `on_clock_auto` +
  `server_now` for honest countdowns). Autopick = best-available by rank under
  positional caps (QB≤3, TE≤3, K≤1, DEF≤1) with forced K/DEF in the endgame.
  Every mutation takes a per-league advisory lock — two managers racing a pick
  serialize instead of corrupting the board.
- **Waivers + FA** — `drop_player` (24h waiver window on the dropped player),
  `add_free_agent` (immediate, optional same-move drop, roster capped at
  `draft.rounds`), `submit_waiver_claim` / `cancel_waiver_claim` (claims are for
  waived players only; free agents add directly), `process_waivers` (resolves
  due claims in rolling-priority order; winner rotates to the back; idempotent —
  clients call it on screen load, the worker calls it on tick),
  `native_team_state` (one-shot: my roster id, cap, waiver order, my claims).
- **Materialization** — `native_materialize(league)` rewrites `sleeper_lineup`
  from `native_roster` for every week whose matchups are **all still
  `scheduled`**; locked/live/final weeks are frozen (the resolver may be reading
  them mid-game). Called from every roster-mutating RPC, so lineups are never
  stale.

### Client

- `src/data/nativeLeague.ts` — `buildDraftPool()` (async, v0.99.2): the full
  Sleeper player directory — 2026 rookies included, with post-draft NFL teams —
  ranked in four tiers: baked 2026 consensus ADP (`src/data/adp2026.ts`, from
  the Stathead MCP `get_adp` blend; rebake weekly through August) → team K/DST
  at late-round cost → post-ADP veterans by 2025 ppr → deep bench by Sleeper
  `search_rank`. Any directory player scores live in 2026 (the worker's index
  is directory-driven); rookies are genuine DNPs on 2025 replay boards. Falls
  back to the 2025 baked-PBP pool if the directory fetch fails.
- `src/screens/NativeLeague.tsx` — three LiveOnboard views (no new global routes):
  - **NativeCreate** — name/teams/roster-size/pick-clock wizard → creates league,
    seeds pool, generates schedule → invite link card → draft room.
  - **DraftRoom** — pick clock (server-skew-corrected), on-clock banner, recent
    picks, my-picks panel, searchable position-filtered board; polls
    `draft_state` every 4s and calls `draft_tick` when the seat is overdue or
    flagged `on_clock_auto`. Commissioner sees the START button.
  - **TeamManage** — roster with drops, player pool with ADD/CLAIM (waiver
    countdown chips), roster-full drop picker, pending/recent claims,
    live waiver order. Calls `process_waivers` on refresh, so waivers clear
    even with no worker running.
- `LiveOnboard` wiring — RoleChooser gains **“Start a fresh league →”** (both
  mounts); native league cards get `⛏ draft` / `⇄ team` links; `RedeemForm`
  routes a native invite code to a **“claim my seat”** flow (team-name input)
  instead of the Sleeper-username match (`league_by_invite` now returns
  `provider`).

### Worker

- `server/src/native.js sweepNative()` — every tick: `draft_tick` each live
  draft, `process_waivers` each league with pending claims. Deliberately *not*
  materializing lineups on tick — the RPCs already do it on every change.

### Testing

- `scripts/db/run-scratch-probes.sh` — throwaway Postgres 16 cluster + Supabase
  shim (`supabase-shim.sql`: auth schema/uid()/jwt()/roles + stub `http`
  extension), applies **all 64 migrations in order**, then runs
  `native-league-probes.sql`: **92 assertions** covering creation gates, seat
  claiming, pool seeding, schedule shape (each roster exactly once per week,
  `lock_at` = the slate's first kickoff), turn/permission/dup gates, snake
  order, vacant-seat + expired-clock autopick, positional caps and forced
  K/DEF, draft completion + lineup materialization (starters_json shape), FA
  adds, drops → waivers, claim gates, priority-ordered processing + rotation,
  the locked-week materialization freeze, and RLS visibility (outsiders see
  nothing; pending claims don't leak). This makes the previously ad-hoc
  "scratch-DB probes" a committed, repeatable check.

## 3. Design decisions (and why)

- **Roster cap = draft rounds.** One number to explain; the draft fills the
  roster exactly, add/drop keeps it there.
- **Slot-agnostic rosters.** This game's lineup is window-based, not
  positional — so there's no starter/bench distinction to manage. The whole
  roster is the weekly pool; the existing picks UI already handles it.
- **Continuous waivers (24h per player) rather than a league-wide Wednesday
  clear.** Simpler to reason about, no cron dependency, and the claim's
  `clears_at` is user-visible. Rolling priority (winner to the back) matches
  what casual leagues expect.
- **Client-driven liveness with a worker safety net.** `draft_tick` and
  `process_waivers` are idempotent, advisory-locked, and callable by any
  member — a native league is fully playable through a July draft night with
  the worker offline.
- **No FAAB in v1.** The drip-coin wallet (`0025`/`0035`) is matchup-scoped
  game currency; conflating it with waiver budgets muddies the "premium is
  never pay-to-win" line. Rolling priority is fair and free. FAAB can layer on
  later as a `waiver_claim.bid` column + a budget on membership.
- **No trades in v1.** Needs two-sided consent UX + veto policy; waivers/FA
  cover the core "manage your team" loop. The `native_roster` model makes a
  trade a two-row swap inside one RPC when we want it.

### Media (v0.99.4)

- `league_pool.espn_id` (0066) — headshots for everyone incl. rookies via
  `PlayerImg`'s new `espnId` fallback (baked slug map → ESPN id → team logo →
  position pill, all behind the mark-free switch).
- Self-serve avatars: `set_team_avatar` (manager) + `set_league_avatar`
  (commissioner), https-only; `AvatarPicker` preset gallery = **72 first-party
  Drip tiles** (`public/avatars/`, cut from the owner's three avatar sheets —
  hero busts, action poses, gear; see the v0.99.5 HANDOFF entry for the
  slicing geometry) + NFL team logos. Team identity card (avatar + rename) on
  the team screen, rendered pre-draft too; league crest on league cards.

### Draft room v2 (v0.100.0 — migration 0067)

Queue (private, autopicks take it first), autodraft toggle, full draft board
grid, per-team draft views, ADP + StatHead projections columns, player cards
(ADP / projection / real 2025 line), commissioner controls (pause with frozen
clocks, force pick, undo — undo even reopens a completed draft), and **auction
mode** (rotating nomination, open lot with rolling bid clock, per-team budgets
with a $1-per-open-spot max-bid floor, prices on picks). All of it drives
through the same `draft_tick` poll/worker path as snake.

## 4. What's deliberately deferred

1. **Trades** (two-sided accept + commish veto, then `native_materialize`).
2. **FAAB bidding** (`bid` on claims; process orders by bid then priority).
3. **In-draft chat / pick trading.**
4. **Season rollover** (dynasty keepers: copy `native_roster` into next season's
   league; the schema already supports multi-season keys).
5. **Roster limits by position at draft time for humans** — the autopick honors
   caps, but a human may draft 7 QBs if they insist. Harmless (the game's slots
   are position-agnostic); revisit if playtests show confusion.
6. **Realtime draft push** — the room polls at 3s, which is fine at pilot
   scale; `supabase.channel` on `draft_pick` is a drop-in upgrade later.
7. ~~Auction v2 — AI counter-bidding, configurable lot clocks~~ **Landed in
   v0.101.0 (0068)**: AI seats bid a rank-based value model through a
   second-price proxy resolver; humans get hidden max bids (the same
   mechanism), any price change restarts the full bid window (no sniping),
   and missed nomination turns auto-nominate from the manager's queue — which
   together make **slow auctions fair**: being offline costs nothing. Slow
   pacing (hour-scale pick/bid windows up to 48h) ships in the create wizard.
   Still deferred: auction undo, pre-lot watchlist maxes, on-the-clock
   notifications.
8. ~~Overnight clock pauses~~ **Landed in v0.102.0 (0069)** — night-aware
   deadline arithmetic (`awake_deadline`, ET): clocks skip configured quiet
   hours, so nothing expires overnight and mornings start with the remaining
   clock intact. Same migration adds **parallel auction lots** (`max_lots`
   1–4) with committed-money budget rules so simultaneous bidding can't
   overdraw a budget or overfill a roster.

## 5. Deploy checklist

1. Merge → `.github/workflows/migrate.yml` applies `0064_native_leagues.sql`
   (added-file trigger, `psql -v ON_ERROR_STOP=1`).
2. No edge functions, no secrets, no worker env changes.
3. Worker redeploy picks up `sweepNative` (optional — the client alone is
   sufficient for drafts/waivers; the sweep covers unattended leagues).
4. Smoke: create a 2-team league with a second account, start the draft, let
   the empty-seat league autodraft, check the league card → SET YOUR LINEUP
   opens the hero board on the drafted roster.
