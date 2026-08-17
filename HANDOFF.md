# Drip League FF — Session Handoff

_Last updated: 2026-08-17 · Build `v0.262.0`_

> v0.262.0 (migration 0184) added DYNASTY AT CREATION + THE BADGE after the
> sections below were written: `create_native_league(p_dynasty)` presets
> keeper_count = roster − 3 and rookie_rounds = 3, stamps
> `settings_json.dynasty`, and deals the first pick assets at creation;
> `league_is_dynasty()` (stamp OR either live setting) is the one badge
> predicate, carried by `my_teams` + `keeper_state`; 🏰 chips on both hosts'
> league cards, create forms and dynasty panels. Dynasty remains a SETTINGS
> identity — the toggle is sugar, the 🔁 NEXT SEASON panel stays the truth.

## NEXT SESSION — read this first

The ENTIRE dynasty arc shipped this session: v0.260.0 (rollover + keepers +
the rookie draft, migration 0182) and v0.261.0 (tradeable pick assets,
migration 0183 — the founder's "dynasty needs rookie draft rounds and
assigned rookie draft picks per team. These are tradeable picks."). The two
sections below carry the design decisions. What's next:

1. **Live-fire the dynasty loop** on a real league before relying on it:
   set a keeper count + rookie rounds, declare keepers on one seat, trade a
   pick, roll, open the new league on both hosts, and run the draft —
   confirming the traded slot lands on the acquirer's clock. The probe
   suites cover the SQL end to end but no production league has rolled yet.
2. **Verify the seat agents in production** (carried from v0.259.0) — run
   `scripts/db/classic-autoslot-diag.sql` via Actions → Run a database
   query: unclaimed seats should read `has_agent = t` with `wk_rows` filled.
3. **Refresh `proj2026.ts` + `adp2026.ts` before Sep 9** (PROJ_AS_OF is
   2026-07-28). The auto-slot, the seat agents, the previews — and now the
   keeper top-N default via pool rank at the NEXT reseed — all rank by it.
4. **The live web drip surface never installs pool `slugMeta` overrides**
   (carried): audit `Matchup.tsx`/`cardTable` consumers; install
   `setSlugMetaOverrides(pool)` where the live league's pool is loaded.
5. **Audit server-side `injuryFor` callers** (carried): with no live install
   and no season set it serves the BAKED 2025 report.
6. Dynasty polish when it earns a session: multi-year futures (assets one
   season out only today), draft-day pick trades (propose_trade still gates
   on draft complete), and resizing a ROLLED league's pending rookie draft
   (set_rookie_rounds only provisions season+1 futures).

---

## Where this session left off, part 2 (v0.261.0, 2026-08-17)

**Dynasty phase 3 (migration 0183): pick assets.** `pick_asset` is
(league, SEASON, round, original seat) → owner. The SEASON tag is the design:
on league L (season S) the S+1 rows are the tradeable futures; rollover
copies them to the new league, where the tag equals the league's OWN season —
which is exactly the rule `_start_draft_now` uses to find "the assets for
THIS draft" — then re-provisions S+2 futures from the carried
`rookie_rounds`, so dynasty continuity needs nobody to re-enable anything.

- **`set_rookie_rounds` (commish, 0–10)** deals one asset per seat per round
  (owner = original). Grow adds; shrink refuses if a removed round holds a
  traded pick — a settings change cannot delete someone's acquired property.
- **Trades**: `trade_proposal.give_picks/get_picks`; `propose_trade` (old
  6-arg signature DROPPED — the overload trap 0175 documented) validates
  ownership both ways; `execute_trade` RE-validates and flips owners — two
  pending deals offering the same pick: the first to execute kills the
  second at its own execute, which stays pending with "picks moved". Picks
  occupy no roster spot, so `trade_cap_error` still refuses lopsided PLAYER
  counts unchanged (a probe fixture tripped exactly this and was corrected,
  not worked around).
- **The draft honors ownership** via `draft.pick_owners`, built at START
  (when the base order is fixed): LINEAR rounds in base order — a pick asset
  is "round R, seat X's slot", which snaking would relabel every other
  round — with `draft_on_clock` returning `pick_owners[overall-1]`.
  Completion keys on the asset count, NOT (rounds − keepers) × teams. A team
  holding extra picks drafts past its cap into the existing over-limit
  lockout (0179) — deliberate, that's how real dynasty works. NO assets ⇒
  byte-identical snake behavior (dynasty suite re-passes untouched).
- UI: ⛏ DRAFT PICKS checklists in both hosts' trade composers, pick lines
  in trade rows, ROOKIE DRAFT PICKS (rounds + per-team ownership map) in
  both dynasty panels. `pick-asset-probes.sql` is the 35th suite.

---

## Where this session left off (v0.260.0, 2026-08-17)

**Dynasty phases 1+2 in one migration (0182): season rollover, keepers, and
the rookie draft.** Built on the three facts the previous handoff checked:
draft.league_id is the PK, league is unique(sleeper_league_id, season), and
the 0171 pool filter already does rookies-only. A new season is a NEW league
row at season+1 — `rollover_league` clones settings_json wholesale (mode,
scoring, spec, pos caps, keeper policy), the commissioner, and every seat
with its manager and team name; carries keepers onto `native_roster` as
`acquired='keeper'`; copies the pool (waiver clocks cleared); inserts a fresh
pending draft; generates the schedule. The response NAMES the game mode
(v0.251.0 rule) and both hosts' confirms say ◈ DRIP / 🏈 NORMAL out loud.

### The design decisions worth not re-deriving

- **`draft.rounds` still means ROSTER SIZE, and that is the whole trick.**
  Keepers split "picks each team makes" from "roster cap", and the cap
  meaning won: every cap consumer (add_free_agent, submit_waiver_claim,
  process_waivers, the trade validator, auction_spots_left/max-bid,
  native_team_state, _sync_classic_rounds, set_league_roster_shape) is
  UNTOUCHED and still correct. New `draft.keeper_slots` teaches only the
  pick-count logic: `native_exec_pick` completes the snake at
  (rounds − keeper_slots) × teams, `_start_draft_now` counts FREE pool
  players (not pool rows — keepers sit in the pool AND on rosters) against
  the picks actually made and refuses keepers that fill the whole roster,
  `draft_state` reports 'rounds' as the rounds actually DRAFTED plus
  keeper_slots/roster_size. Auctions needed NOTHING — they complete off
  spots_left = rounds − roster count, which counts keepers by itself.
- **`seed_league_pool`'s delete-all used to eat keepers.** native_roster's
  FK into league_pool is ON DELETE CASCADE, so the reseed's
  `delete from league_pool` silently dropped every rostered player. Before
  0182 that state was unreachable (rosters were only ever nonempty
  post-draft, and seeding refuses post-draft); a rolled league is pre-draft
  WITH rosters. The reseed now preserves rostered slugs — probed by
  reseeding a rolled league with a disjoint player set and counting the
  roster after.
- **One resolver serves the preview and the carry.** `_keeper_resolve`
  (declared first, then top-up by pool rank — the pool is seeded ranked by
  projection, so "top-N by projection" is the same statement server-side)
  is called by both `keeper_state` and `rollover_league`. What the screen
  shows is what the rollover does, structurally.
- **Declarations self-retract.** `keeper_pick` carries an FK into
  native_roster ON DELETE CASCADE — drop or trade a declared player and the
  declaration disappears with him. And everything freezes once the season
  rolls: `_rollover_target()` (same sleeper_league_id at season+1) gates
  set_keeper_count, set_keepers, and a second rollover.
- **Wallets: fresh season seed, by doing nothing.** team_wallet/coin_ledger
  key on the league row, so the new season starts at ◎0 and the copied
  `weekly_budget` funds it from week 1. FAAB balances and waiver_priority
  reset the same way (not copied); taxi/IR come back 'active'. Seat agents
  are NOT copied — seat_agent is unique(agent_user_id) so an old agent
  can't serve the new row anyway; agent seats arrive open and the worker
  re-provisions (0180 is season-agnostic).
- **The rookie draft is a pool decision, not draft machinery** (the 0171
  rule: league_pool IS the gate). `p_rookie_only` carries ONLY the kept
  players into the new pool and pins settings_json.pool_filter to
  {max_exp: 0}; the draft REFUSES to start (no free players) until the
  commissioner reseeds from the draft room, where buildDraftPool applies
  the filter — so the pool becomes keepers + rookies and autopick can only
  take rookies. Consequence to say out loud when it comes up: in a
  rookie-only rollover, unkept veterans are OUT of that league's universe
  (not FAs) — that is the 0171 gate's semantics, accepted deliberately.

### What landed where

- `supabase/migrations/0182_dynasty_rollover.sql` — keeper_pick,
  draft.keeper_slots, 'keeper' acquisition kind, set_keeper_count /
  set_keepers / keeper_state / _keeper_resolve / _rollover_target /
  rollover_league, and patched LIVE bodies (0071 native_exec_pick, 0177
  _start_draft_now + draft_state, 0172 seed_league_pool — copied checked,
  not remembered).
- `liveApi`: setKeeperCount / setKeepers / keeperState / rolloverLeague;
  DraftState gains keeper_slots + roster_size.
- Web: 🔁 NEXT SEASON panel in the league console (AdminPage `DynastyPanel`),
  ★ KEEPERS card on TeamManage (NativeLeague). App: `DynastyCard` in
  CommishTools, `KeepersCard` in Team. Both draft rooms note "+N keepers
  already on rosters".
- `scripts/db/dynasty-probes.sql` — the 34th suite, 22 assertions,
  including declared-beats-rank, the preview==carry equivalence, the
  cap-vs-picks split, and the keeper-surviving reseed.

---

## Where this session left off (v0.259.0, 2026-08-17)

**Sixteen versions in one sitting, v0.245.0 → v0.259.0.** Classic (normie)
mode went from "board exists" to launch-shaped, the acquisition surfaces
caught up, and every item on the previous session's NEXT list shipped. The
section below this one describes v0.234.0 — treat it as history.

### The classic arc, in dependency order

- **v0.245–v0.246 — who IS this player.** `slugMeta` gained the DIRECTORY bake
  as its second source (the PBP bake structurally cannot know a rookie), and
  `isBye` now demands proof — a known team AND a loaded slate.
- **v0.247 — every team starts the week with a lineup.** `optimalLineup` in
  `engine/classic.ts`: max-weight assignment via matroid greedy over Kuhn's
  matching. The safety rule everything since rests on: a spot with NO stored
  row was never decided; a row holding NULL is a manager's decision. The
  worker auto-slots each week; boards fill on open.
- **v0.248–v0.249 — the seat nobody manages.** `sealed_pick.app_user_id` is
  NOT NULL, so an unclaimed seat (7 of 8 in the founder's leagues — read the
  diag, not the assumption) had nowhere to store a lineup. `classicLineup`
  computes an unmanaged side's best projected lineup at scoring time; both
  benches render on the matchup screen.
- **v0.250 — the best-ball fill is exact.** `assignByValue` (successive
  most-profitable augmenting paths) replaced the most-specific-first greedy,
  whose optimality argument died at 0172. Shipped pre-season ON PURPOSE:
  changing scores is only free while nothing has resolved.
- **v0.252 — fills learn the calendar.** `slateAwareProj`: projections zeroed
  on EVIDENCE (proven bye, injury O/IR via the caller's own predicate — never
  `injuryFor` by default, whose baked-2025 fallback is the server's resting
  state). Teams normalize both sides (LAR vs LA — the phantom-bye trap).
- **v0.254 — the seat agent (migration 0180).** The durable answer: one
  synthetic user per unclaimed classic seat (`seat_agent`, worker-provisioned
  via the admin API), rows written AS the agent, re-planned each tick while
  unlocked (a diligent manager, not a Tuesday snapshot), frozen by the
  per-player seal. The claim trigger hands rows to whoever takes the seat.
  Membership stays NULL — every open-seat query is untouched.

### Everything else that shipped

- **v0.251** create form has NO default game; the button names what it creates.
- **v0.253** `myRoster()` refuses when ambiguous instead of guessing.
- **v0.255** the web LEAGUE BOARD (`src/screens/LeagueBoard.tsx`, LiveOnboard
  view 'board') — browse/preview/claim/post, same RPCs as the app's Recruit.
- **v0.256** mode chip on `Matchup.tsx` + the app's WeekNav; **web
  `LivePicks.tsx` deleted** (unmounted since Matchup took over at v0.234.0 —
  both hosts compile without it).
- **v0.257** the spec SHRINK HATCH (migration 0181): post-draft, the only
  legal edit is a strict prefix of the stored spec, compared in cleaned form.
- **v0.258** team units pass tenure bands — `tenureMatches` mirrors
  `slotAllows`' K/DEF/HC/P exemption.
- **v0.259** the commish tools get a MAP: narrow web swaps the 17-option
  `<select>` for a `NavHub` tile grid (whole map, one tap in, "⊞ ALL
  SETTINGS" back), the narrow panel body is overflow-safe, the app's
  MODE & SCORING mega-scroll split into MODE / ROSTER / SCORING via a `view`
  prop, and web MEMBERS renamed 👥 SEATS to match the app.

### Lessons this session paid for (do not relearn)

- **The probe PRNG was fake.** The old LCG's low bits cycle with period n, so
  two "400 random cases" brute-force suites each ran ONE case 400 times.
  xorshift32 now, and every random block asserts its cases differ AND that a
  strawman fails some of them — a check nothing can fail is decoration.
- **`modeOfSettings` is the only door.** `settings_json` stores the builder
  spec as `roster_slots`; `leagueSlotDefs` reads `slots`. Raw settings passed
  through silently yields the DEFAULT NINE SPOTS. Exported from `resolve.js`.
- **Copy trigger/function bodies from the LIVE migration, checked not
  remembered** — 0178's near-miss (stale 0058 copy) almost repeated at 0181.
- **`sealed_pick` rows with null `player_slug` never reach the resolver**
  (every path filters them), so "manager emptied every spot" and "no lineup"
  are indistinguishable there — classic asks the DB its own question.

### NEXT, in priority order

1. **Verify the seat agents in production** — run
   `scripts/db/classic-autoslot-diag.sql` (Actions → Run a database query):
   the unclaimed seats should read `has_agent = t` with `wk_rows` filled.
   Deploy + migration went green 2026-08-17 ~15:12Z; the provisioning line
   lands after the log capture window, so the diag is the confirmation.
2. **Refresh `proj2026.ts` + `adp2026.ts` before Sep 9** (PROJ_AS_OF is
   2026-07-28). The auto-slot, the agents and the previews all rank by it.
   Note: a mid-week re-bake shifts computed (v0.248-fallback) lineups; agent
   ROWS are frozen — another reason rows won.
3. **The live web drip surface never installs pool `slugMeta` overrides.**
   v0.253 fixed the dead LivePicks copy; `Matchup.tsx`/`cardTable` (the real
   web drip host) still resolves rookies through the bake alone in whatever
   consumers read `slugMeta`. Audit those consumers; install
   `setSlugMetaOverrides(pool)` where the live league's pool is loaded.
4. **Audit server-side `injuryFor` callers** — the engine's `healthy()` path.
   With no live install and no season set, it serves the BAKED 2025 report;
   v0.252 designed around it for the fills, but any other server-side caller
   may be eating last year's injuries. Verify or make it structural.
5. **Solo / pods / weekly / DFS in the app** — the big absent surface, and
   the stated phase goal (solo onboarding). A project, not a sitting.
6. Sleeper/ESPN import + platform-league join, app-side. Targeted power-ups,
   app-side. The window pot, app-side. Standings drift risk
   (`leagueStandings` vs `playoffState.standings`).

### Diagnostics you now have (this session's additions)

- `scripts/db/classic-autoslot-diag.sql` — per seat of every scheduled classic
  matchup: `has_user`, `has_agent` (0180), `roster_n`, `wk_rows`, `wk_filled`.
  Separates "skipped by design" from "worker never reached it" at a glance.
- `scripts/db/seat-agent-probes.sql` — the claim transfer, in the scratch suite.
- `scripts/check-draft-spots.mjs` — 110 assertions: assignment, exact fills,
  slate-aware values, tenure bands. In `check:parity`.

---

## Where this session left off (v0.234.0, 2026-08-16)

**THE CARD-BOARD BUG WAS `Matchup.tsx` ALL ALONG — fixed in v0.234.0.**
Read this before anything else in this section: the chase recorded below spent
four rounds in `LivePicks.tsx`, which was never the file being rendered.
`src/screens/Matchup.tsx` serves the `matchup` route — the one that
"my leagues → a league → the matchup" actually lands on — and it had NO
game-mode branch at all. I flagged that twice as a separate defect and never
connected it to the report. The founder's screenshot showing the drip board at
`v0.233.0`, with the mode chip I had added to LivePicks' week strip absent from
the header, is what finally gave it away: the chip was missing because the
screen rendering it was a different file.

Lesson worth more than the fix: **when a UI bug survives several correct-looking
fixes, confirm WHICH COMPONENT is on screen before touching another line.** One
`grep` for a string in the screenshot ("Set Your Windows") would have settled it
in round one.

**Read this first if you are picking the matchup board back up.**

### What shipped, v0.219.0 → v0.233.0

App parity, then the normie matchup board, then a bug chase.

- **v0.219.0–v0.226.0 — the app caught up with the site.** Grouped phone nav
  (native `<select>` on web under 900px, wrapped chip row in the app because
  ~7 destinations all fit and a picker would HIDE what a strip can show);
  FAAB wallets + coin-by-team; draft-room commish controls; rosters/waiver
  wire; K/DST fill; **join by invite code**; **league creation**.
  The invite-code gap was the one worth finding: the app SHARED codes it
  could not ACCEPT, so anyone installing with a friend's code had to go to
  the website. It was found by measuring — diffing every exported `liveApi`
  call the web uses against the app — not by working from a list.
- **v0.227.0 — the matchup board ENGINE** (`packages/core/src/engine/matchupBoard.ts`).
  Pure, no fetching. 26 assertions in `scripts/check-matchup-board.mjs`, wired
  into `check:parity`. The four cases where the obvious implementation is
  wrong are documented in the file and each has a test.
- **v0.228.0 / v0.229.0 — the renderers**, site then app, both consuming the
  same `buildMatchupBoard` output so the hosts cannot disagree about a figure.
- **v0.230.0–v0.233.0 — the bug chase** (see below).

### The bug chase, and what it actually was

The founder reported "matchup screen in normie mode is still the card board".
I got this wrong twice before getting it right; the wrong turns are recorded
because each one is a trap the next person can fall into.

1. First I said the league was set to drip and pointed at the 0158 admin gate.
   **Wrong** — their commish UI showed CLASSIC, and that toggle only flips
   local state on success (`if (r.ok) setMode(m)`), so it was persisted.
2. Then I said `myRoster()` had opened a different league. **Plausible but
   over-claimed** — `myRoster` really is `LIMIT 1` with no `ORDER BY` (still
   unfixed, see below), but it was probably not the cause here.
3. **The real cause**, from the founder's third report ("goes to the right
   board, then immediately to the cards"): two defects in the web loader,
   fixed in v0.232.0.
   - No stale-run guard. The effect re-runs on the week stepper and on retry;
     the classic path returns EARLY after one RPC while the drip path awaits
     several more, so an older drip run finished AFTER a newer classic run and
     overwrote the mode. The app's copy always had an `alive` flag; the web's
     never did.
   - `leagueGameMode(...).catch(() => null)` then fell through to
     `setGameMode('drip')` — **a failed read was treated as "not classic"** on
     BOTH hosts. A blip dropped a normie league onto the card board and left
     it there.

   Lesson worth keeping: "renders right, then flips" is almost always an
   unguarded async effect, not a rendering bug. Look at the loader, not the JSX.

4. Also fixed while chasing it: **`admin_set_week_lock(week, true)` does NOT
   mean "lock now"** — it releases the unlock HOLD and clears the `2099-01-01`
   sentinel back to null so the worker re-derives the real kickoff. A NULL
   `lock_at` means "no lock time assigned yet"; `server/src/lock.js:173` seals
   only `.not('lock_at','is',null)`. I nearly "fixed" the boards to treat null
   as locked, which would have sealed lineups across every league with an
   unbackfilled `lock_at`. **Do not make that change.**

### NEXT, in priority order (v0.234.0 — ALL SIX SHIPPED, see the v0.258.0 section above)

1. **Draft TEAMS panel by roster spot** — the founder's open ask, and the
   largest remaining piece. Today the draft room lists picks as R1..R12; it
   should show them against the roster SPOTS they will fill, labels included.
   This is an ASSIGNMENT problem, not a relabel: with per-spot filters (0172)
   and custom labels (0174) a player can be legal for several spots, so the
   mapping belongs in core beside `bestballFill` in `engine/classic.ts` (reuse
   `slotAllows` for eligibility) with its own probes. A first-fit that
   disagrees with the engine's own fill would show a lineup that then changes,
   which is worse than R1..R12. Leftovers render as bench.
2. **The create form defaults to DRIP with no confirmation.** `useState<'drip'
   | 'classic'>('drip')` on both hosts, so a commissioner who does not click
   🏈 NORMAL gets a drip league with a normie name — which is how "Normie Test"
   happened. Fix: no default (the form cannot submit until a game is chosen),
   and name the game in the created-league confirmation.
3. **`myRoster()` picks arbitrarily** — `.eq(...).eq(...).limit(1)` with no
   ORDER BY (`liveApi.ts` ~631). An ORDER BY makes it stable but still guesses;
   the better answer is probably that a board with no league should refuse to
   guess and say so. Behaviour change — make it on purpose.
4. **Mode chip is web-only and LivePicks-only** — `◈ DRIP` / `🏈 NORMAL` on the
   week strip. Port to the app, and consider putting it on `Matchup.tsx` too
   now that it branches (v0.234.0).
5. **The web has no public LEAGUE BOARD** — browse/post/join is app-only. The
   mirror of the invite-code gap, and it costs signups on the marketing
   surface. Small next to solo/DFS.
6. **A spec frozen post-draft cannot be shrunk.** `set_league_classic_slots`
   refuses once the draft leaves pending (0174:38), which is right in general
   but leaves a league with more starting spots than draft rounds permanently
   unplayable. v0.233.0 warns BEFORE the draft; consider a narrow escape hatch
   that only ever shrinks a spec toward legality.

### Known-open, not blocking

- Solo / pods / weekly / DFS: entirely absent from the app.
- Sleeper/ESPN league import + platform-league join: app joins native only.
- Targeted power-ups (spy, disarm, targeted applies): web-only. The app HAS
  power-ups, buffs and hero sets — only the targeted subset is missing.
- The window pot: web-only. Mock drafts: web-only.
- Standings read two ways (`leagueStandings` in the app,
  `playoffState.standings` on web). Not a gap; a drift risk.

### Diagnostics you now have

- `scripts/db/normie-league-diag.sql` — run through the **Run a database
  query** workflow (read-only default). Answers: is the league really classic,
  is the draft done, do week-1 matchups have a `lock_at` (with a plain-English
  verdict per row), and which seats actually have lineups in. Written because
  four wrong turns above would each have been settled by one query.
- `scripts/check-matchup-board.mjs` — the board arithmetic, in `check:parity`.

### The founder's leagues, as of this session

`normie try2` — the fresh one. Created after the fixes; open it and it should
land on the classic board (pre-lock: the lineup setter; head-to-head at first
kickoff). If it still shows the card board, check its `game_mode` first with
the diagnostic — the create form's DRIP default (NEXT #2) is the likely cause.



`Normie Test` (the first one, confirmed by the diagnostic): classic ✓,
drafted, 1/8 enrolled, `lock_at` healthy on all 56 matchups (week 1 locks
2026-09-10) — but **13 starting spots
against a 12-round draft**, so no team can field a legal lineup. v0.233.0 warns
about this in the builder; the league itself still needs a spot removed or a
longer draft. The seven unclaimed seats drafted rosters but nobody set their
lineups, so the opponent column will read `Empty` — that is honest, and the
engine deliberately excludes those spots from "yet to play".

## The week lock switch (v0.169.0, 0134→0136, 2026-08-13 evening)

Born as a live-fire emergency and grown into a control, in three migrations the
same evening — the sequence is worth keeping because each step exposed the next:

1. **0134** — mid-slate, the founder needed every week-102 pick reopened NOW and
   held open until manually relocked. Two locking mechanisms had to stand down:
   the worker (matchups → 'scheduled', `lock_at` 2099 — its sweeps select on
   `lock_at` and only touch live/final) and `enforce_window_lock`, which is
   slate-driven and would have re-engaged at kickoff−1h on its own; it learned
   to honor a `lock_hold` row. The reopen rode IN the migration because
   migrate.yml on main was the session's only prod write path. Receipt from the
   run log: 12 matchups reopened, 0 picks unsealed — the lockout had been
   status-level only, so nobody's picks were ever exposed.
2. **0135, within the hour** — the founder sent a screenshot still showing 🔒.
   The web board derives every window's locked/live state FROM THE WALL CLOCK
   against slate kickoffs (Matchup.tsx `liveWinState`), on its own authority. A
   client can't honor a hold it can't see: `lock_holds()` is the peephole into
   the RLS-dark table, and the board polls it every 30s while a league is open.
   The app never had the bug — it gates on matchup `status`/`lock_at`.
3. **0136** — the founder asked for the real thing: per-league unlock/lock
   buttons. `week_lock_hold (league_id, week)` replaces the global table (the
   active 102 hold was CONVERTED, not dropped — leagues mid-hold saw nothing
   change), the trigger and peephole are league-scoped, and
   `admin_set_week_lock(league, week, locked)` — `is_admin()` only — is wired
   to **AdminPage → league → 🔓 unlock wk / 🔒 lock wk** with held weeks shown
   as relock chips.

**The LOCK semantics are the design decision worth not re-deriving.** Lock does
NOT mean "lock now" — it deletes the hold and NULLs `lock_at`, and the worker's
`backfillLockAt` (which only fills NULLs) restores the week's NATURAL lock time,
first kickoff − 1h. Relock early and the week locks when it always would have;
relock mid-slate and the natural time has passed, so the next tick seals it,
window locks and AI auto-lineups included. Manual lock restores nature rather
than inventing a second rule.

UNLOCK's blast radius, probed: scheduled+live matchups of that (league, week)
only — `final` is never reanimated, other weeks and other leagues untouched;
picks are unsealed AND unrevealed. `scripts/db/lock-hold-probes.sql` is the
ninth suite. `relock-102.sql` remains as a bulk dbquery fallback for the
emergency's leftovers.

**Ops note from the same evening:** the APK ritual's `/opt/android-sdk` does
not exist in this remote environment — JDK 17 + Android cmdline-tools were
installed ad hoc to build APK 16800. Bake them into the environment (or a
SessionStart hook) before the next APK ask, or the ritual fails at gradle.

## Members sync themselves — the claim flow self-heals (v0.168.0, 2026-08-13)

**The failure, verbatim from a league chat: "it says im not in the league when I
try to claim team."** Joins happen on Sleeper; Drip's copy of the member list
refreshed only when the commissioner pressed **⟳ refresh members** (0105). So
everyone who joined the Sleeper league after the last press bounced off
`redeem_invite`'s membership lookup, and during a join rush — the hour before a
draft, exactly when it matters — the founder was a human cron job, pressing the
button and apologizing in chat. Migration **0134 is next**.

Same shape as 0132's self-granting allowance: **the button stays, the system
stops needing it.** Three pieces (0133):

- **`_upsert_membership_rows` is now the ONE membership write.** 0105's
  semantics verbatim — `app_user_id` keeps any existing link, `enrolled` only
  ever goes false→true — so no path through it can unseat anybody.
  `admin_upsert_memberships` (the button) is a permission-checking shell over
  it. **This also fixed a live foot-gun:** the worker's `importLeague`
  (`server/src/sync.js`) was raw-upserting recomputed `app_user_id`/`enrolled`
  values, so a RE-import could silently unlink an enrolled manager. It calls
  the chokepoint now.
- **The worker sweeps members** (`server/src/poll/members.js`, every ~25s
  tick): leagues poked by a bouncing claimant on the next tick, every
  current-season sleeper league on a slow cadence (`MEMBER_SYNC_STALE_MIN`,
  default 10). `member_sync_due()` is season-scoped so dead seasons never age
  back into the sweep, and a league whose Sleeper fetch fails gets its clock
  stamped anyway (`member_sync_touch`) so a deleted upstream league backs off
  to the slow cadence instead of retrying-with-retries every tick.
- **The claim flow heals itself** (`RedeemForm.check()` in `LiveOnboard.tsx`).
  On exactly the "not a manager in this league" bounce it calls
  `request_member_sync(code)` — any signed-in invite-code holder may poke;
  rate-limited server-side to one standing request per 20s per league so a
  stampede of joiners collapses into one Sleeper fetch — then re-runs the
  preview every 6s for up to 60s with honest copy on screen ("Checking with
  Sleeper — if you just joined the league there, this takes about a minute…").
  Typical heal is one worker tick, well under the minute. 60s rather than
  longer because a **mistyped username lands in the same branch** and deserves
  its error promptly; the timeout copy covers both cases.

**The poke deliberately does NOT accept member rows.** An invite code is a weak
credential; accepting a caller-supplied roster→owner mapping on it would let any
code holder seat themselves anywhere. The code only asks — the worker fetches
from Sleeper itself. (This is why the fix needed the worker at all.)

Probes: `scripts/db/member-sync-probes.sql`, the suite runner's **eighth**
suite — grants (chokepoint + worker helpers refused to `authenticated`), the
never-unseat guards under a re-pull that fails to resolve a linked owner, the
poke's rate limit, due/consume/back-off plumbing, and the end-to-end bounce →
sync → successful redeem. One probe artifact worth remembering: `now()` is
frozen per transaction, so ordering assertions between two stamps written in
one DO block need an explicit backdate — in production they're separate
transactions and strictly ordered.

**Deploy note:** needs BOTH the migration (auto on merge) and a `fly deploy` of
the worker — until the worker ships, pokes stamp the flag but nothing consumes
it, and the claim flow's retry loop times out exactly as before. The web half
is harmless to ship first (it degrades to the old error after 60s).

## Injury badges, on the live feed at last (v0.167.0, 2026-08-13)

**The data had been there since 0001; nothing ever read it.** `server/src/poll/
injuries.js` has polled ESPN into the `injury_status` table daily (hourly on game
days) for the entire life of the project. Grepping the tree for `injury_status`
outside the worker returned zero consumers — no client, no RPC. The table was
write-only in practice.

Meanwhile the only injury UI in the product, `InjuryBadge` in `src/app/ui.tsx`,
read `packages/core/src/data/injuries.ts` — a **hardcoded 2025 file** that
disables itself on any other season. So on the 2026 board that locks Sep 9, all
twelve badge call sites across `Matchup.tsx` and `boardParts.tsx` rendered
nothing, and the app had no injury UI at all. This wires the feed to the badges.

**It also fixes a quieter one.** `defaultLineup` and `aiLineup`
(`engine/matchup.ts`) gate auto-fielding on `healthy()`, which calls the same
`injuryFor()`. On a 2026 board that meant the engine believed **every player in
the league was available** — auto-lineups and AI seats would happily field a
player ruled Out. Both read through the one function, so the fix reaches them
without touching the engine. **This is a behavior change the founder signed off
on**: from v0.167.0 an auto-set lineup benches Out/IR players. Questionable and
Doubtful stay startable — they are legitimate starts and always were.

### The three decisions worth not re-deriving

**The cache is synchronous, and it has to be.** `injuryFor(week, slug)` is called
from the render path and from deep inside the engine's lineup builders, none of
which can await. So the live report loads into a module cache behind the existing
synchronous getter — the same shape as the live-play and game-feed overlays
(`setLivePlays` / `clearLivePlays`), loaded on league open, cleared on exit. The
signature never changed, which is why all twelve web call sites needed no edit.

**The consequence: nothing re-renders on its own.** A module write is invisible to
React, so both hosts bump a counter when a report lands — `injuryVer` in the web
store (threaded through the context value), a discarded-value `useState` in
`LivePicks`. Nothing reads either value; they exist purely for the re-render.

**One week only, and that is not a shortcut.** The ESPN feed is a snapshot of the
designations standing *right now* — it carries no week and keeps no history. So
the report answers for the week it was polled for and returns null for any other,
rather than tagging a past week with today's injuries. For a week it does cover
it **outranks** the baked 2025 file, so the two can never blend into one board.

**Slug matching was the integration risk and it is fine.** The worker resolves
ESPN names through `playerIndex.slugForName` → `slugOf` (`normName`, hyphenated);
core builds player ids the same way in `buildLeague.ts`. Same slug space by
design — "derive it one way only", per playerIndex's own header.

### What landed

- **`packages/core/src/data/injuries.ts`** — `setLiveInjuries` /
  `clearLiveInjuries` / `hasLiveInjuries` / `injuryRowFor`, and `injuryFor`
  rewired to prefer the live report. `InjuryRow` carries the return date,
  comment and freshness the table already stores, for a detail view later.
- **`liveApi.loadLiveInjuries(week)`** — a direct select; `injury_status` has
  carried an authenticated-read policy since 0001, so **this needed no
  migration**. It never throws: a missing report degrades to "no badges",
  exactly as before, rather than taking down the league open that called it.
- **Web** (`src/app/store.tsx`) — loads on pilot-board open only (the demo
  replays 2025 and is served by the baked report), refreshing every 5 minutes
  and on tab focus. It re-polls because designations MOVE when it matters most:
  Friday practice reports, then inactives ~90 minutes before kickoff — inside
  the hour when a manager is still setting a lineup that locks at kickoff-1h.
- **App** — `InjuryBadge` in `ui/rosterGroup.tsx`, on both the roster panel and
  the **player picker**, which is the one that earns its keep: the last thing a
  manager sees before committing a player to a slot. Note the picker uses a
  card-local darkened palette, like the group tag beside it — that card is cream
  stock in both themes and the shared Questionable yellow washes out on it.
- **`scripts/check-injuries.mjs`** (`npm run check:injuries`, folded into
  `check:parity`) — 23 assertions over the precedence rules and the engine's
  `healthy()` gate. Worth having because a wrong answer here **looks exactly like
  a healthy league**: nothing errors, badges just quietly don't appear. That is
  precisely how this went unnoticed for the life of the project.

**Careful with the two "IR"s in the app.** `GroupBadge` says where a player SITS
(Sleeper's IR roster slot); `InjuryBadge` says what the injury report SAYS. A
player can be an ordinary starter and Out, or parked on the IR slot and off the
report entirely. They stack deliberately.

**Not done:** the badge doesn't open into the detail the table already holds
(return date, comment) — `injuryRowFor` exists and is unused, waiting on the
player-stats-card work it belongs to. No badge on the draft or trade surfaces
yet. And this has **not had a real-device pass**.

## The site is an installable app now (v0.141.0, 2026-08-10)

Home-screen icon, standalone launch, works offline. No hosting change — same
GitHub Pages deploy, same `dist/`. **The plan this is step one of lives in
`docs/mobile-app-plan.md`**: PWA now, Capacitor shells built during the season,
store submission for 2027. That doc also supersedes README "Phase 3" and explains
why the React Native port it proposed is the wrong trade (the engine ports; the
screens — `FieldView`, the card table, the pixel sprites, `@keyframes nukeburst` —
are DOM and CSS to their bones).

**The manifest uses relative URLs on purpose.** `public/manifest.webmanifest` says
`./` and `./icons/...`, never `/…`, so one file serves all three bases we build
at: dripfantasy.com (`/`), the `/ffgame/` Pages preview, `/ffgame-staging/`. Vite
rewrites the `<link rel=manifest>` href per base and everything inside resolves
against wherever the manifest landed. Icons are in `public/icons/pwa/`, baked from
the Instagram profile art by `scripts/gen-pwa-icons.py` — mascot only, cropped
above the wordmark (unreadable at 192px) and opaque (iOS composites alpha onto
black). Outputs are committed; the script needs Pillow and only runs when the
brand mark changes.

**Every caching rule in `public/sw.js` follows from one fear** — a cache pinning
somebody to an old build on a Sunday while we hotfix:
- **Navigations are network-first.** A reload always gets the freshly deployed
  `index.html`. A stale build cannot outlive one reload.
- **`/assets/` is cache-first**, safe only because Vite content-hashes those
  names. Matched by *directory*, not by the running worker's precache list, so a
  tab can always find the chunks of the build it actually loaded.
- **Two shell generations retained.** This fixes a bug that predates the PWA:
  Pages drops the previous deploy's files, so deploying mid-session broke
  `React.lazy()` chunk loads in open tabs — a blank screen on any screen the user
  hadn't opened yet. Verified: a tab open across a deploy now keeps working.
- **No `skipWaiting()`.** A new worker waits for old tabs to close. Costs one
  session of lag before a new build is precached; buys the guarantee that assets
  never swap under a live board. Given nine fixes shipped during one live-fire
  night, that's the right side of the trade.
- **Nothing dynamic cached.** Same-origin GET only → Supabase and PostHog fall
  through untouched. `/pbp/` and `/gamefeed/` excluded by name (megabytes of JSON
  the HTTP cache already handles).

**If it ever misbehaves: `KILL = true` at the top of `public/sw.js`, deploy.**
Clients drop every cache and unregister on next load, reverting to a plain
website. Registered with `updateViaCache:'none'` so the kill lands on the next
navigation, not ten minutes later. Tested — it works.

**The precache list is injected at build time** by `pwaServiceWorker()` in
`vite.config.ts` (replaces `"__PRECACHE__"` and `__VERSION__` in the copied
`dist/sw.js`). The cache name is `APP_VERSION` + a digest of the asset list, so a
forgotten version bump can't leave two builds sharing one cache. No Workbox, no
vite-plugin-pwa — the dependency tree stays at four.

**The banner** (`src/app/InstallPrompt.tsx`, state in `src/app/pwa.ts`) waits 60s
on a first visit, immediately for a returning or signed-in visitor; snoozes 45
days on dismiss; never returns after an install; hidden on `matchup`/`final` so it
can't cover a live playout, and lifted above the request-a-code FAB's lane on the
screens that show one. Chromium gets the real install dialog, iOS Safari gets the
Share → Add to Home Screen instructions (there is no API). New events:
`pwa_install_shown/_accepted/_declined/_dismissed`, `pwa_installed`, and
`app_open` now carries `standalone` so installs read as a retention cohort.

**Testing note for whoever touches this next:** `vite preview` is useless for
service-worker work — it keeps serving files it has already deleted, so rebuilding
`dist/` does not simulate a deploy and you will chase ghosts. Use a static server
that reads from disk per request.

**Deliberately not done:** push (the server half is the same work for web and
native, so it's scheduled once, with the shells), iOS `apple-touch-startup-image`
launch frames, manifest `screenshots`, and an orientation lock — see
`docs/mobile-app-plan.md` §1.

## Window Pot v1 — an OPT-IN wager ladder, flagged OFF (v0.140.0, 2026-08-08)

Two managers, one game window, one pool of drip-coin — and **nothing is
automatic**. One puts ◎10 up on a window; the other matches it or ignores it. If
it's matched they trade check / wager / call / raise, strictly alternating, until
that window's **picks lock**. Winner of the window takes the pot.

**This is a redesign of what was built earlier the same day.** The first pass
followed the original spec: every window auto-anted ◎5 at matchup lock, betting
ran from lock to kickoff, and a hidden standing auto-call policy plus
quiet-hours response clocks kept it moving async. The founder inverted it —
opt-in, ◎10, pre-lock, explicit turns — which is a better mechanic and a simpler
one: with a real turn and a hard deadline at picks lock there is nothing left to
answer on anyone's behalf, so the policy, the clocks, the `awake_deadline`
arithmetic and the last-raise cutoff all came out. The migration was **rewritten
in place** across that redesign rather than patched by a follow-up, because it
had never merged and so had never applied anywhere; a second migration undoing
half of an unreleased one would be permanent noise in the history for no
benefit. Now that it HAS merged, that reasoning has expired — patch forward.

**It is `0117_window_pot.sql`, not 0106.** It was written as 0106 and renumbered
when merging `main`, which had taken 0106–0116 in the meantime (the practice /
view-as / week-context work). Nothing but the filename changed. Worth knowing if
you go looking for it by the number in an older commit message.

**It ships OFF, per league, behind a switch you own.** `league.pot_ante` defaults
to **0**, which disables the feature end to end: the RPCs refuse, `pot_state`
returns `{off:true}` with no windows, and the client renders nothing. The switch
is in the app — **AdminPage → LEAGUES → a league → ADMIN MODES → `🪙 window
pot`**, beside the preseason / live-test / card-theme toggles — with a `tune`
affordance for the ante and the pot cap (validated so the cap always covers both
antes). There is nothing to wait for: pots are created by managers tapping, not
by a scheduled pass, so it's live the moment you flip it.

**Turning it off never strands coin, by design.** `pot_sweep` doesn't consult
the flag, so pots already under way still void / freeze / settle on their own
schedule and every committed chip finds its way home or to a winner. The toggle
tells you how many are still in flight, and `pot_state` keeps reporting them
(read-only, every control locked) so their managers watch them finish instead of
seeing coin vanish from their bank. Once they've all closed, the state comes back
empty and the feature is invisible again. To unwind a league on the spot instead
— a test league that needs resetting, or killing the feature mid-week without
leaving bets hanging over a slate — the **`⟲ void N open`** button (only present
when there are open pots) voids every one and refunds every chip: nobody wins,
nobody loses. SQL equivalents are `admin_set_pot(league, on, ante, cap)` and
`admin_close_pots(league)`; both are `is_admin()`-gated.

### The four things worth knowing

**The deadline isn't a copy of the pick-lock rule, it IS the pick-lock rule.**
`pot_lock_at()` is literally `window_kickoff(week, win) - interval '1 hour'` —
the same expression `enforce_window_lock` (0102) enforces. Move the lock lead
and both move together; there is no second place to remember. It also means the
entire ladder is played blind, before a single pick is revealed, which is the
whole reason the mechanic belongs in this product.

**Backing out costs exactly the ante — the founder's explicit call.** A fold
hands over your ◎10 and returns every wagered chip to whoever bet it, however
deep the ladder went. The consequence, raised before building and chosen anyway:
a call is *reversible* until picks lock, so the ladder is a commitment ratchet
rather than a bluff-caller — the live question is "will you still be here at
lock?" rather than "are you bluffing?". If playtesting shows managers calling
everything and bailing, the fix is confined to `pot_close`'s `'fold'` branch
(forfeit what you'd matched instead). That's why the ante is stored apart from
the wagers (`home_ante` / `home_bet`): the fold payout is arithmetic, not
reconstruction.

**Silence is never punished.** No clocks, no auto-anything. An offer nobody
matches VOIDS at picks lock and the ◎10 goes home; a wager nobody answers is
returned at the close and the antes ride on. The only way to lose coin without
choosing to is to lose the window.

**Every move is turn-gated**, which is also the concurrency answer: the
per-matchup advisory lock serializes two managers tapping at once and the second
finds the turn already passed. No corrupted pots, no double-counts, no
reconciliation UI.

### What landed

- **`supabase/migrations/0117_window_pot.sql`** — `window_pot` (leader, turn,
  owed, ante/bet split, state machine), `pot_action`, `league.pot_ante` /
  `pot_cap`; RPCs `pot_ante`, `pot_act`, `pot_state`, `pot_sweep`. Advisory
  xact lock on every mutation, RLS member-read + RPC-only writes, wallet moves
  only through `spend_from_wallet` / `credit_wallet` with idem keys. Debits key
  off the action seq; the three payout causes (`void` / `fold` / `settle`) key
  off the CAUSE with no seq — each fires at most once per pot, and a seq-bearing
  key would double-pay if a replay allocated a fresh seq.
- **Worker (`server/src/pot.js`)** — just `sweepPots`, on the tick after the
  resolve loop: void unmatched offers and freeze live ladders at picks lock,
  settle finished windows out of the `matchup_state` rows resolve just published
  (the same scores the +5 bonus is paid off). The ante-at-lock hook is gone
  entirely — there is no automatic ante any more. Every supabase-js result is
  checked and thrown; it returns errors, it does not throw.
- **Client (`src/screens/WindowPot.tsx`)** — the pot chip moved OFF the battle
  bar and onto the window section, because the ladder is played during setup and
  the battle bar doesn't exist until something has kicked off. Untouched windows
  read `WINDOW POT · PUT ◎10 ON THIS WINDOW →`; a live one pulses `YOUR MOVE →`.
  The sheet carries the whole ladder (ante / match / check / wager / call /
  raise / back out), the wager slider capped at the effective stack with "table
  stakes" as the entire explanation, the countdown to picks lock, and the action
  log. Backing out asks for confirmation and states the cost. One shared poll for
  every window; it calls `pot_sweep` first (any-member-advances, like
  `draft_tick`). Demo/sim boards (`liveCtx == null`) never mount it.
- **Admin levers** — `admin_set_pot` / `admin_close_pots` (both `is_admin()`
  gated), and `admin_overview` now carries `pot_ante` / `pot_cap` / `pot_open`
  so the toggle renders from the league list the admin page already loads
  instead of a per-league fetch. `WindowPotToggle` in `src/screens/AdminPage.tsx`.
- **Probes (`scripts/db/window-pot-probes.sql`)** — every §6 scenario against the
  real RPCs and wallets: opt-in (no taps ⇒ no rows, no coin), the void, the
  handshake and leader-acts-first, out-of-turn refusal, the full ladder to the
  ◎120 cap, backing out costing exactly ◎10 both deep and shallow, table stakes
  + all-in, the deadline being the pick-lock instant, the unanswered wager going
  home, settlement, the dead-even split, the empty chair, replay idempotency,
  the ledger invariant, and the zero-sum check — plus the admin flag itself: only
  a super admin can flip it, the numbers are range-guarded, flipping it ON lets a
  manager open a pot immediately, flipping it OFF blocks new play while the
  in-flight pot stays visible AND the sweep still unwinds it, and
  `admin_close_pots` refunds every chip and is a no-op on the second run. Each
  fixture gets its own WEEK, not just its own season — `window_kickoff` resolves
  the newest season carrying a week number, so fixtures sharing a week would
  resolve each other's kickoffs.

**Harness repairs made on the way** (`run-scratch-probes.sh` was red before this
session): it now stubs `pg_net` the way it already stubbed `http`, so 0091
applies locally; and two `native-league-probes.sql` assertions still expected the
pre-0095 "closed testing" gate message. All migrations apply and both suites
pass.

**Deploy state:** the migration auto-applies on merge (`migrate.yml`). **The
worker sweep needs a `fly deploy`** — batch it with the still-pending #262 `ret`
emission before the Aug 13 preseason slate. Without it pots still work for
anyone with the board open (the client poll sweeps its own matchup); what's lost
is the safety net for matchups nobody is watching at the deadline, which at a
3am lock is most of them.

**Live-fire plan (Aug 13):** flip the league on from the admin page, then from
account A put ◎10 on a window and watch B's board offer the match;
match it, confirm A gets first action, run a wager/call/raise ladder to the cap,
back out of one window and see it settle for exactly ◎10, leave a wager
unanswered on another and confirm it returns at picks lock, leave a third offer
unmatched and confirm it voids, then let a window finish and re-resolve twice to
prove the pot pays once. Preseason week 102 is a six-window slate, so there is
plenty of room to run all five outcomes in one night.

## The worker runs WEEK CONTEXTS, not a season mode

The scheduler held exactly ONE current week, with preseason bolted on as a
process-wide MODE of it (`PILOT_SEASON_TYPE=1` → `weekOffset=100`, every DB
read/write shifted). That made the two seasons mutually exclusive, and the
collateral wasn't preseason's fault — it was the single-week tick's:

- `syncTick` returned early in preseason, so a league that DRAFTED during
  preseason never got its rosters until someone pressed "sync season" by hand.
- `podTick` returned early, so pods and showdowns simply stopped being dealt.
- Worst: leaving the flag set past the opener would have stopped Week 1 ever
  locking or resolving, with the logs looking perfectly healthy the whole time —
  the same silent shape as the halftime `live_play` freeze from the live-fire.

A CONTEXT is `{ seasonType, offset, espnWeek }`: which ESPN scoreboard to ask
for, and what to add to its week to get the BOARD week. `tickContext` runs the
whole lock → poll → resolve → finalize pass for one of them; `tick` fans out over
every active context and then does the week-agnostic work (injuries, native
sweep) ONCE. Preseason keeps its +100 namespace, so the two can never collide.

Which contexts are active is a pure function — `contextsFor(forced, regWeek,
preWeek)`, exported and tested (`server/test/week-contexts.mjs`) because ESPN is
unreachable from CI. The regular season is ALWAYS present (it needs `lock_at`
backfill and pod pairing long before its first kickoff); preseason joins while
ESPN reports a preseason week in range, and a context whose games are all
complete quietly does no work — so the set narrows by itself as August ends.
Nothing to switch off, no deadline to remember.

`PILOT_SEASON_TYPE` survives as `config.forcedSeasonType`: unset in normal
operation (fly.toml says so), set only to pin the worker to one season type for a
debug. Two related fixes fell out: `lockDueMatchups` takes a `week` (unscoped, a
preseason tick would have sealed regular-season windows against preseason
kickoffs), and `syncWeek`/`pods` now say `REGULAR_SEASON` explicitly instead of
reading the global — previously harmless only because they were skipped whenever
it differed. Importing `index.js` no longer starts a scheduler, so the test can
load it.

## Preseason practice — throwaway weeks + the commish one-click (0110)

Preseason play existed since 0054/0101 (board weeks 101-103, deep pool) and was
proven on the CAR@ARI live-fire below — but it was **super-admin only** and
**not actually throwaway**. Everything the practice games produced landed in the
real season. Migration `0110_preseason_practice.sql` closes both gaps.

**The rule now enforced server-side: a practice week never moves real coin, real
inventory, or a real record.** Practice = board week > 100 (`is_practice_week` /
`matchup_is_practice`, mirroring `PRESEASON_BASE`), and every guard routes
through those two so the definition lives in one place.

Four leaks, all sealed:

1. **Standings + playoff seeding** — `league_standings` (0073) counted every
   final non-playoff matchup, so practice W/L and PF sat in the standings *and*
   in the bracket seeded from them. Week filter added to both halves of the
   union; `LeagueResults` (LiveOnboard) applies the same rule client-side and
   now labels those sections `PRESEASON WK N · PRACTICE, DOESN'T COUNT`.
2. **Coin** — resolve banked each side's weekly drip-coin regardless of week, so
   three weeks of rehearsal funded real Week-1 power-ups. Guarded at
   `adjust_wallet` (the single choke point every credit/debit runs through) and
   again in `credit_wallet`; the worker skips the call outright
   (`resolve.js`). The engine's coin is still written to the matchup row — it's
   the "what you'd have earned" readout, it just never reaches a wallet.
3. **Power-ups** — spending is now **free in practice**, short-circuited in
   `spend_from_wallet` *before* the balance guard, so a broke team can still
   exercise the whole board. `team_inventory` is keyed (league, roster) with no
   week, so `wallet_buy_powerup` / `consume_inventory` / `refund_inventory` skip
   it entirely in practice: a free buy can't mint a real item, and arming one
   can't burn something bought for the season. The client mirrors inventory
   optimistically, so the board still behaves normally mid-session.
4. **Weekly budget** — `commish_grant_weekly_budget` refuses a practice week out
   loud instead of reporting the silent "0 credited" `adjust_wallet` would give.

**The one-click.** `set_preseason_practice` and `seed_preseason_pool` are
commish-or-admin twins of the 0054/0101 admin RPCs, and `enablePreseasonPractice`
(liveApi) drives both as one action — turn on, then seed all three weeks' deep
pools. That ordering used to be two admin buttons pressed in sequence, with the
pool needing a re-press after *every* re-toggle (the toggle wipes lineups with
its clones); miss it and seats field Week-1 starters who don't take preseason
snaps. One `PRESEASON PRACTICE` panel in `LeagueRow` replaces both buttons for
commissioners and admins alike; `commish_overview` now carries `preseason_at` /
`test_live_at` so the commish card can show the 🏈 chip and read its own state.
Opening practice on an unsynced league now says *"sync the season first"*
instead of cloning nothing.

**The one-click is gated on the preseason window** (`preseasonWindow` in liveApi
→ the `nfl_slate` rows at weeks 101-103, open until the last kickoff + 4h).
Reason: the worker picks what it polls from PROCESS-WIDE config
(`PILOT_SEASON_TYPE=1` → seasonType 1 + weekOffset 100), not per league — so
without the gate a commissioner could open practice in September and get three
weeks of matchups nothing will ever feed, with no way to know why. Outside the
window the panel explains instead of offering the button. Admins still see it
(off-window testing) with a ⚠ saying nothing will feed those weeks, and a league
already in practice always keeps its controls, so closing the window can never
strand someone with weeks they can't turn off. The real fix — a tick that loops
over active week contexts instead of computing a single current week, letting
preseason, the regular season and pods coexist in one process — is deferred;
the tick body is mostly week-parameterised already, but `espnWeekCache` is a
single cache and the injury poll would need hoisting out of the loop.

**Preseason slot rule + the grant taken back (0116).** Preseason windows are
allocated more generously than the regular season's `min(3, ceil(games/3))`:
**2 slots at 3+ games, 3 at 5+** (`nflSlate` deriveWeek), because preseason games
bunch into a few dense Thu/Fri/Sat clusters rather than spreading over a Sunday.
The loaded 2026 preseason now derives **PRE 2: 6 windows / 10 slots · PRE 3: 9 /
11 · PRE 4: 7 / 11**. That is deliberately MORE than the 8 a manager can fill:
choosing which windows to contest — and whether to spend 80 of the 120-coin
practice budget on a ninth slot — IS the practice-week exercise. So 0111's free
grant is gone and `enforce_slot_cap` is 0027's rule verbatim, base + purchased,
identical in practice and in the season. (Superseded reasoning below.)

**Practice grants the extra slots (0111, SUPERSEDED by 0116).** The lineup cap is a hard
`base_slot_count() = 8`, mirroring the REGULAR season's fixed five-window board.
Preseason boards are derived from the real slate instead, and are shaped nothing
like it — the loaded 2026 preseason derives `wk 101: 1 window / 1 slot`,
`wk 102: 6 windows / 7 slots`, `wk 103: 9 windows / 10 slots`. So at preseason
week 3 the board renders ten slots and the trigger refused the ninth; worse,
NINE windows against eight slots meant a player couldn't field one player per
window, handing the opponent an unopposed +5 window-win bonus. Practice weeks
now grant `extra_slot_cap()` outright in `enforce_slot_cap` — the same ceiling a
paying team could reach in the regular season, free, nothing to buy or place.
Additive to purchases (still free in practice), and bounded, since
`buy_extra_slot` caps purchases at the same number → practice ceiling is
base + 2 + 2. NOT derived from the week's real window count: SQL can't read the
TS derivation, and 0100 exists precisely because a second drifting copy of it
caused a live bug. No client change — the board already renders the derived
slots; only the cap was in the way. `my_extra()` still reports what was actually
bought (it drives the shop count and `buy_extra_slot`'s own cap check; folding
the grant in would read as "you already own 2" and block placing any).

**The 2026 preseason has FOUR ESPN weeks, not three (0112).** 0056/0100 loaded
board weeks 101-103 and the range was then hardcoded in four places (the clone's
literal array, the off-switch's `week in (…)`, the pool seeder's `p_week > 103`,
and `PRESEASON_WEEKS = 3`). ESPN's actual 2026 preseason: week 1 = the Hall of
Fame game (1), weeks 2-4 = 16 each — 49 games, of which weeks 2-4's 48 are
32 teams × 3 ÷ 2. Every team's THIRD outing lived at board week 104, which
nothing knew about. The worker needed no change (it already computes
`espnWeek + 100`); it simply had no slate, pairings or pool there. Week 104
(Aug 27-29) derives 7 windows / 8 slots / 16 games — the same slot count as the
regular season and the closest of the four to its shape. Slate rows generated
through the SHARED derivation (`slateFromGames` → `windowIdsFromKickoffs`) over
ESPN's real scoreboard, the same path 0100 used; regenerating 101-103 the same
way reproduced 0100's rows exactly, so no drift. The range now lives in ONE
place per side: `preseason_week_count()` / `preseason_board_weeks()` in SQL,
`PRESEASON_WEEKS` in TS (mirror convention, bump together), and the probes
assert off the helper so extending it can't silently under-assert.

**Random pairings, no schedule required (0114).** Practice built its weeks by
CLONING the league's regular-season schedule — Week 1 four times (0054), then
week i per board week (0113) — which carried a hard dependency on the league
already HAVING a schedule. Turf Warriors hit it head-on: mid-draft, no matchups
at all, so opening practice failed with *"no Week-1 matchups to clone — sync the
season first"*. Backwards for what practice is for; the moment it's most wanted
is exactly when a league hasn't drafted. And the real schedule was never
meaningful here anyway — a practice game against your true Week-3 opponent isn't
that matchup, it's a scrimmage that counts for nothing. Practice now pairs seats
itself: a deterministic shuffle per (league, board week) — `md5(league|week|
roster)`, the same trick as pods' `pairPodSeats`, needing no `setseed()` session
state — with adjacent seats paired off. Different opponent each week, works with
zero schedule, and the same league+week always redraws identically so a rebuild
is idempotent rather than reshuffling under people. Odd seat count → one seat
sits, and which one moves with the shuffle. The only precondition left is TWO
SEATS. Regular-season lineups are still copied when they exist, purely as a
fallback the deep-pool seed overwrites moments later.

**Distinct pairings + skipping played weeks (0113, superseded by 0114's random
draw for the pairing half).** 0054's clone copied WEEK 1
into every preseason board week, so a playtester faced the same opponent three
(then four) times running — fine for the one-night live-fire it was built for,
poor for a month of practice. Board week 100+i now clones regular-season week i,
falling back to Week 1 for any week the league hasn't scheduled. It also cloned
regardless of the calendar: turning practice on today seeded week 101, the Hall
of Fame game played back on Aug 6, as a live-looking matchup that will never
receive another snap. Weeks whose last kickoff is >4h past are skipped (the same
allowance `defaultOpenWeek`/`join_weekly` use), the clone reports which weeks it
seeded and which it skipped, and `enablePreseasonPractice` seeds deep pools for
exactly the seeded ones. If EVERY preseason week is past, the on-switch refuses
and un-stamps rather than handing back a league with nothing playable.

**Practice has its own weekly budget: 120 coin (0115).** 0110 made practice
spending FREE, which protected the real wallet but taught the wrong game — with
everything free the right move is always "arm everything", the exact habit that
bankrupts a manager in Week 1. The economy is the thing the pilot most needs
playtested, and free practice skipped it. So practice now runs a parallel,
throwaway economy: `practice_wallet`, keyed (league, roster, BOARD WEEK), seeded
at `practice_budget()` = 120 on first touch, spent at REAL prices, and dropped
with the practice weeks (both the rebuild and the off-switch delete it). The
0110 invariant is untouched — a practice week still never moves `team_wallet` —
the two economies simply don't meet. Per WEEK, not per league: each practice week
starts fresh, so overspending PRE 2 doesn't cripple PRE 3 and nothing accumulates
into a stockpile the real season never grants. Practice EARNINGS stay unbanked
(they'd land after the week they could be spent in); only refunds return to the
purse, capped at the budget so a refund can't mint coin. `my_wallet`/
`ensure_wallet` return the purse on a practice matchup, so the header chip and
shop show 120 with no client plumbing.

**The shop is practice-aware (`ShopModal`).** 0110 makes power-ups free on a
practice week server-side, but the shop's affordability gate is CLIENT-side
(`afford = bal >= p.price`), so a low-balance team simply couldn't press BUY and
the server's deliberate "free even at zero balance" was unreachable through the
UI. `ShopModal` takes `practice`, which since 0115 changes only what the HEADER says
— *"N PRACTICE COIN · 🏈 this week's practice budget — your season wallet is
untouched"*. Prices, affordability and the running balance all behave exactly as
they will in Week 1, because they're now the same mechanics on a different purse.
Passed from the board as `!!liveCtx && preseason`.

**Pool filters (`boardParts.tsx`).** A normal fantasy roster is 8-20 players, so
both pool views rendered whole and unfiltered. Deep practice pools are ~1,000
players a week — and up to ~400 inside ONE window (wk104 `fri2`: 12 teams across
6 games, 2 slots) — in a 440px scroll with a headshot and injury badge per row.
Above the threshold a filter bar appears: name search (matches short OR full
name), position chips, and game / team selects, where choosing a game narrows the
team list to that game's two sides so the selects compose. `RosterAside` adds a
WINDOW select, since the rail is the all-windows view; `PlayerPicker` doesn't
need one (it belongs to a single slot, so its window is already fixed). Filters
are pure view state and never change what's pickable.

TWO thresholds, because the surfaces count different things — found by actually
looking at the demo board in a browser, where a single shared 25 put a filter bar
on the LANDING page's 28-player roster rail while leaving the 21-player opponent
rail bare. `FILTER_AT = 25` gates the picker (one window: regular season ≈ 5-8,
smallest practice window is 32 — a wide gap); `RAIL_FILTER_AT = 60` gates the
rail (whole roster: a deep dynasty roster reaches ~40, a practice pool is
~1,000). Verified in Chromium: the landing board renders exactly as before, and
the picker's search/chips/count/clear work on a filtered pool.

**Hardening found on the way:** `_clone_preseason_weeks` (0054) is SECURITY
DEFINER and was EXECUTE-to-PUBLIC by default — any signed-in user could clone or
wipe weeks 101-103 of any league. Revoked, along with the new `_set_preseason`.

**Verification:** `scripts/db/preseason-practice-probes.sql` — 10 probe groups
(predicate, commish auth, pool seeding, revoked internals, wallet, budget,
standings, inventory, off-wipes-everything, unsynced league) green on a clean
scratch DB, wired into `run-scratch-probes.sh`. Two pre-existing snags fixed to
get there: the runner died at 0091 for want of `pg_net` (now stubbed like
`http`, so nothing after it was ever checked), and two native probes still
asserted the pre-0095 "closed testing" wording.

**Still true and worth remembering:** the worker's preseason mode is a GLOBAL
env switch (`PILOT_SEASON_TYPE=1` → `weekOffset=100`), not per-league — while
it's on, the Sleeper weekly sync and the pod/showdown tick are both skipped
(`index.js`). Practice pairings are the Week-1 clone, so it's the same opponent
all three weeks.

## First live-fire — preseason CAR@ARI (v0.139.0, 2026-08-06/07)

The system's first night on a real NFL feed: the full loop (seal → 1h-lead
lock → per-window reveal → live resolve → effects → window bonus → payout)
ran end to end on the Hall-of-Fame game, watched live and debugged live.
**Nine real defects found and fixed the same night** — nearly all at the seam
between replay assumptions (full game always present; playback clock = truth)
and live reality (feeds pause, data arrives incrementally, bookkeeping isn't
gameplay). PRs #254–#263, in found order:

1. **Lock-lead mismatch** — client promises "locks 1h before kickoff", worker
   locked AT kickoff. Worker now writes `lock_at = first kickoff −
   config.lockLeadMs` (tick backfill / sync / pods) and migration `0102` moves
   the `enforce_window_lock` edit gate to kickoff−1h per window. Reveal
   unchanged (still at each window's own kickoff).
2. **Hub card showed the wrong matchup** — week-less `myMatchup` returns the
   LOWEST week, so the card said "PICKS OPEN · WK 1" while week-101 was live.
   Card now resolves `defaultOpenWeek` first; CTA reads GO TO MATCHUP when
   live/final.
3. **Pick-cache clobber (the bad one)** — the board seeded picks from the
   per-browser store cache and only used server picks when the cache was
   empty; a stale/cross-account cache could shadow sealed picks AND get
   auto-saved back over unlocked windows (it ate the founder's lineup;
   restored by SQL surgery — service role bypasses the lock trigger since
   `auth.uid()` is null). **Server picks now always win on hydration**
   (Matchup.tsx). Related trap hit during repair: `enforce_slot_cap` counts
   10 rows/lineup, and the clobbered save had strewn rows across
   nonexistent-in-preseason windows (early/late/snf/mnf), eating the cap.
4. **Live window clock anchored to slotted players' plays** — a benched
   lineup produced `winMax=0 → GAME_SECONDS`, reading Q1 as "Q4 5:00" with
   empty logs. Then the inverse: slot BOOKKEEPING events stamp past
   regulation, overshooting the clock (Q4 read "OT 5:00", and the battle bar
   aggregated end-of-window accounting into live totals — 18.0 shown vs true
   15.0). Final form: **the live window clock is the game feed's max play
   clock, only** (slot events are the pre-feed fallback, capped at
   regulation); chips/field strip format the last real play's clock.
5. **FINAL at halftime** — field + slot chips inferred game-over from "shown
   play has no successor", true whenever a live feed pauses. Migration `0103`
   adds `game_feed.state` (ESPN `pre|in|post`, written each poll); clients
   trust it, falling back to a late-Q4 heuristic (`c ≥ 3300`) for baked/old
   rows.
6. **Silent live_play freeze at halftime (the best find)** — ESPN
   restructured drives at the half and listed 5 plays under TWO drives each;
   duplicate conflict keys make Postgres reject the WHOLE upsert ("cannot
   affect row a second time") and supabase-js returns errors without
   throwing, so ingestion froze while game_feed (whole-doc upsert) kept
   landing and worker logs looked healthy. `pollGame` now **de-dupes on the
   conflict key** (keeps the last/revised copy) and **checks every write
   result** (throws → tick logs the real error). Mid-game `fly deploy`
   backfilled the whole missing half in one tick.
7. **"0yd pass" log rows** — a QB incompletion lands as a 0-yard `pass` event
   (adapter row shape); a yardless pass now reads "incomplete pass".
8. **GAME LOG (window-level)** — new `WindowGameLog`: every ingested play
   across the window's games from game_feed (already polled 15s for the
   field), newest first, scoring plays flagged with the running score.
9. **Window-win bonus confusion** — "40 up top, 35 below" is the +5 bonus;
   a won window now spells it out under the battle bar:
   `★ window 35.0 + win bonus 5 = 40.0 toward your week total`.

**Field-visual suite (same night, #256/#257/#260/#262):** team-colored end
zones + brand text (`src/data/teamColors.ts`, 32 teams + feed-abbr aliases;
colors stay in mark-free mode, logos don't); score strip logos + 🏈 possession
marker; bigger team-ringed ball badge, possession-colored LOS + drive arrow;
per-game **↔ TV-flip** (localStorage, mirrors everything); play-line grammar —
**offense logo at the snap, arc = ball in the air, flat line = carried, 🏈 at
the end, red ✕ for incompletions**; completed passes split at the catch via
ESPN's `yardsAfterCatch` (`GamePlay.yac`), kicks/punts split at the catch via
the return clause (`GamePlay.ret`, same "for N yards" parse as the retyd
metric). Week-2 baked feed re-baked with both (`genGameFeed.mjs 2`); other
baked weeks fall back to plain arcs until re-baked (`1-14`).

**Yahoo:** developer application APPROVED. `yahoo-oauth` function deployed
(after a 401 hunt: the CLI needs a personal access token `sbp_…` from
supabase.com/dashboard/account/tokens — project keys 401; a wrong paste also
overwrote the `SUPABASE_SERVICE_ROLE_KEY` repo secret, since restored).
Remaining: `VITE_YAHOO_CLIENT_ID` repo VARIABLE + site rebuild activates the
connect screen; Yahoo console redirect URI must be exactly
`https://dripfantasy.com/` (+ www variant) — was still the httpbin
placeholder at last check. First real league connect will shake out the
never-seen-live-data JSON mapping (`src/data/yahoo.ts`).

**Deploy state:** worker deployed mid-game with #254–#259 (lock lead, yac,
state column, dedupe). **#262's `ret` emission needs the next `fly deploy`**
— do it before the Aug 13 preseason slate, which is the validation run for
everything above.

**Next build: the Window Pot** — ante/raise/call betting on windows, spec'd
with 15 played-out scenarios in `docs/window-pot.md`; kickoff prompt in
`docs/window-pot-kickoff-prompt.md`. v1 ships feature-flagged OFF
(`league.pot_ante = 0`).

## Floating strip cards (v0.133.0, owner round 3)
The mini-card ROWS still read airy on wide screens, so the live layout went
back to the ORIGINAL dense full-width ScoreCard strips (mx-scorecard leather
stock on the felt) with one change: the physical mini card (`MiniCard`, new
export — headshot art, position suit, name, team, bank fill, HOT/NUKE/frost
overlays) FLOATS over each strip where the round headshot used to sit
(`.ct-float`: 72px, −12px vertical overhang; ≤600px: 58px, −11px vertical +
a −16px outer-side poke onto the felt, per the owner's sketch — the window
frame's padding absorbs it, no horizontal scroll. A taller/narrower card
shape was tried and rejected). The strip's
name row drops the name/team text (they're on the card) and keeps its chips;
injury badge rides the card. Mobile card mode gets its own strip layout — the
card spans the strip height with ONE text column beside it (compact
`AWY@HOM · Qx clock` line, metric, score+coin, statline) so the floating card
never overlaps the strip's own text. The kicked window's slot stack widens its
row gap (20px + 10px top pad) so overhanging cards never collide. LiveCard
still renders the pre-kick sealed pairs + DemoBoard's demo rows, now composing
MiniCard.

## Per-theme card-strip grounds in light mode (owner picks)
Card-mode strips (mx-sc-cards) under the floating MiniCards take a per-theme
ground in the light app themes so the cream card pops: BAIZE GREEN on Feeling
Lucky (daylight), PAPER GRAY on Arctic Journey (arctic). Wired via a new
`data-app-theme` attribute App.tsx stamps on <html> (alongside data-card-light
etc.) — the arctic override sits after the daylight-default rule in the sheet.
Tan variants were tried and rejected ("dingy"); slate-blue and clay mockups
lost the vote. Dark themes keep the dark leather stock.

## Mini live cards + sealed-until-kickoff (v0.133.0)
Owner feedback on v0.132: the tall live cards ate too much vertical space, and
the opponent's cards flipped face-up before their window went live. LiveCard is
now a compact ROW: a 78px mini physical card (headshot, position, name, team —
still carrying the liquid bank fill, HOT glow, NUKE scorch, wobble) with all
the changing text BESIDE it on the felt (real game clock, metric chip,
statline, accumulated points, coin/FG chips, power-up + final-state notes).
A live duel row measures ~95px vs ~250 before. New `sealed` variant renders
the deck's face-down back + a 🔒 SEALED PICK chip. Wide-screen polish (owner
round 2): the points live in their own column (`.ct-lscol`) pinned to each
half's INNER edge, so the two big scores face each other scoreboard-style in
the middle of the duel — no hollow center on desktop; ≤600px wraps the score
to its own line under the text (the stacked mobile look).
- Seal timing: WindowSectionInner computes per-window `kicked` (live board:
  realtime live/final; sim playback: this window's own clock > 0 or done) →
  ScoreRow. Pre-kick in card mode: your card face-up with metric but NO score,
  the opponent's card face-down — another window kicking off no longer flips
  this one's seal (the old leak: global preKick ended when ANY window started).
  DemoBoard's upcoming windows now deal the same sealed pair instead of the
  classic strip; its kickoff PICKS-REVEALED flip moment is unchanged.
- CSS gotcha (bit twice): `.ct-lcard>*` position reset + generic child rules
  lose to/beat same-specificity rules by SHEET ORDER — overlays re-assert
  `position:absolute` after the reset, and the PTS label needed its own class
  (`.ct-llab`) because `.ct-lscore>span` out-specified `.ct-lpts` and shrank
  the score to 7px.
- Verified (Playwright, theme RPC forced): kicking ONE window face-ups exactly
  its 6 cards while the other 5 slots stay sealed backs; FINAL reveals all;
  landing shows 7 sealed backs during TNF; HOT chip + glow; row tap opens the
  log; `.ct-lpts` computed 21px.

## Staging QC deploys (deploy-staging.yml — needs one-time admin setup)
GitHub Pages IS production here: deploy.yml publishes every merge to main as
dripfantasy.com (public/CNAME + VITE_BASE=/), so there was no way to QC a
branch on Pages without shipping it. `deploy-staging.yml` publishes any branch
to a SECOND Pages site (dachhack.github.io/ffgame-staging): push a branch to
`staging` (`git push -f origin <branch>:staging`) or run it via
workflow_dispatch. Build uses VITE_BASE=/ffgame-staging/, strips dist/CNAME
(so staging can't claim the prod domain), injects `noindex`, and leaves
VITE_POSTHOG_KEY unset (no analytics pollution). Inert until the admin does
the one-time setup in the workflow's header comment (create dachhack/
ffgame-staging, add the STAGING_DEPLOY_TOKEN fine-grained PAT, set that repo's
Pages source to gh-pages). Staging hits the production Supabase, so flags/
data are live; auth redirects need the staging origin whitelisted in Supabase.

## Card retention — the cards stay on the felt after kickoff (v0.132.0)
The ask: "keep the cards on the board longer — they drop off after kick off."
In the card theme the portrait cards only lived in SETUP/LOCKED (SetupRow); at
kickoff both boards swapped to compact score strips, so the theme vanished
right when the game got exciting. Now a kicked-off slot stays a face-up card
through LIVE and FINAL.
- **`LiveCard` (cardTable.tsx).** The setup card's cream stock at the same
  footprint (172×250), carrying the live state: the drip bank as a rising
  liquid fill (`ct-fill`, bank×3.2 capped 92%), 🔥 HOT glow + chip, ☠ NUKE
  scorch, real game clock line (`AWY@HOM · Q3 4:12` / FINAL), running
  statline, coin, ⚡ Field General ×N, and the final-state outcomes (K-negation
  strike, ÷2 suppress-halving, suppress spend, `⤴ backup scoring`). Tap = open
  the log, same as the strip. Gotcha: `.ct-live>*` resets children to
  `position:relative` (fill stacking), so the fill/scorch/hotchip re-assert
  `position:absolute` right after — equal specificity, later rule wins.
- **`liveCardFlags(events, side, clock)` (cardTable.tsx).** HOT/NUKED at a
  playback clock from the slot's own PBP — the sim mirror of the worker's
  `flagsFor` (liveResolve.ts). hot follows the side's LATEST drip/streak badge
  (HOT / STREAK 2× on, plain DRIP ↑ or an opponent's STREAK COLD off, a nuke
  kills it); nuked latches on a landed nuke (sig = attacker-side event, else
  victim-side TE-TD). Giveaway events are typed 'nuke' for the log's red ✕ but
  wipe nothing — TURNOVER text is excluded so a pick thrower isn't scorched.
- **Matchup.tsx.** `cards` (from the existing `cardHand` league flag) threads
  WindowSection → ScoreRow → ScoreCard; ScoreCard in card mode renders the
  SAME computed data as a LiveCard (no info loss — statline, game clock, coin,
  chips, sub/negation states all ride along). Unopposed rows keep their
  explanatory strip; their blank side becomes a dashed card footprint on the
  felt. The guided demo (`demo` prop) stays classic — it has no felt.
- **DemoBoard.tsx (landing).** Watch-phase head-to-head slots deal LiveCards
  (metric chip, bank, hot/nuked, EMP ❄ frost on the featured opponent, armedPu
  note); one-sided backup rows keep the strip. The kickoff reveal flip is
  untouched — cards now persist after it instead of dropping to strips.
- Verified end-to-end (Playwright, card-theme RPC forced on): 16 live cards on
  the full board through LIVE and FINAL, tap-opens-log, HOT chip + glow on a
  hot drip, liquid fill measured bottom-anchored (bank 6.2 → 50px/252px card).

## Napalm — a live power-up that punishes a hot drip (v0.120.0)
`napalm` (◎60, live, slot-opp). Fire on a live opponent slot: for 10 game-minutes,
any minute their drip is HOT the accrual INVERTS — `minuteGain` returns `-add`, so
the hot drip bleeds their bank (floored at 0) instead of doubling it. Does nothing
while they stay cool (it only bites HOT drips), so it's a punish/counter to a rival
running too hot. Burn ticks surface as their own drip events ("🔥 NAPALM burn",
negative delta). Wired like Cold Snap: `resolveSlot` `opts.{you,their}Napalm:[c,c+600]`,
`extras.napalm` in buildMatchup + `LiveExtras.napalm` in resolveLiveMatchup,
`AppliedWeek.napalm` via the shared `applyLiveSlotPu`, the live tap-a-spot flow +
active-effect chip. Price in `0083_napalm_price.sql`. Verified: a permanently-hot
drip (54.9 vs empty) napalmed to 0 over the whole game (37 burn ticks, floored ≥0);
24/24 in h2h-verify.


## Clutch plays: conditional, transient-availability power-ups (v0.119.0)
A NEW class — power-ups that only UNLOCK from a live game-state trigger on a slot
and are arm-able only for a limited game-clock window. `clutchOffers(slot, week)`
(matchup.ts) detects them from the slot's own resolved timeline so the live board
can surface an offer chip while `armFrom ≤ clock < armUntil` (and you own it, and
it's not already armed). Priced in `0082_clutch_prices.sql`. 21/21 in h2h-verify.
- **Halftime Gamble (`clutch-don`, ◎50).** Unlocks when a slot leads by 10+ at
  halftime (game clock 1800), open for 5 game-min. Arms a Double-or-Nothing on
  that slot (×2 win / 0 lose) — resolved via `extras.clutchDon` like DoN.
- **Encore (`clutch-encore`, ◎45).** Unlocks when your player scored a first-half
  TD; open until late game. His next TD banks +`DOUBLE_TD_BONUS` (12) via
  `resolveSlot` `opts.youDoubleTd` (arm clock) → first post-arm TD gets +12.
- **Counter-Wipe (`clutch-counter`, ◎55).** Unlocks right after an opponent nuke
  wipes the slot, open for 5 game-min from the wipe. `opts.youCounterWipe` (the
  wipe clock) → that nuke is negated in `nukeWipe` (bank + drip preserved, Bunker-style).
- Wiring: `AppliedWeek.{clutchDon,clutchEncore,clutchCounter}` + `armClutch`; the
  offer chip renders per-slot in the live window (WindowSectionInner, `onArmClutch`);
  buildMatchup resolves; display flags `youClutchStake`/`youEncore`/`youCounterWiped`
  → MatchupFinal fx + active-effect chips. resolveLiveMatchup parity for the clutch
  opts is still open (like the other targeted plays — demo path is complete).
- Offer availability uses game-clock windows (the demo plays back on game clock);
  a real-clock "5 real minutes" refinement is a later polish.


## Live tactical power-ups: Surge / Cold Snap / Bunker (v0.118.0)
Three reactive `timing:'live'` power-ups fired mid-window (the live layer was just
swaps + EMP). Time-windowed opts on `resolveSlot`, mirroring the EMP pattern; the
fire game-clock is captured via `effWinClock` and stored per slot. Priced in
`0081_live_tactical_prices.sql`. Verified in `h2h-verify.mjs` (18/18 green).
- **SURGE (`surge`, ◎55, slot-you).** Your slot scores ×`SURGE_MULT` (2) for 10
  game-minutes from the fire clock — plays AND drip (`opts.youSurge:[c,c+600]`).
- **COLD SNAP (`cold-snap`, ◎60, slot-opp).** Freezes ALL of an opponent slot's
  scoring (points + drip) for 10 min (`opts.theirFreeze`). Harder than EMP, which
  only freezes drips and only window-wide.
- **BUNKER (`bunker`, ◎65, slot-you).** Your slot goes nuke/erase-immune from the
  fire clock onward (`opts.youBunkerFrom` → `victimShield = 1`; nukeWipe early-returns
  so the bank AND drip survive). Lock in a lead before they can wipe it.
- Wiring: `AppliedWeek.{surge,coldSnap,bunker}` (slotKey→fire clock) + generic
  `applyLiveSlotPu`; the live apply panel surfaces them via `SPOT_APPLY` when a
  window is live; `spotEligible` gates your-slot (surge/bunker) vs opponent-slot
  (cold-snap); active-effect chips. buildMatchup + resolveLiveMatchup both wired.


## Four "battle" power-ups: Lead Change / Grudge / Jinx / Red Herring (v0.117.0)
All slot-targeted, armed pre-kickoff, priced in `0080_battle_powerups_price.sql`
(parity-checked). Engine in buildMatchup (demo) + resolveLiveMatchup (parity);
store via `AppliedWeek.{leadChange,grudge,jinx,redHerring}` + generic
`applySlotListPu`/`removeSlotListPu`; UI reuses the tap-a-spot apply-mode flow
(SetupRow eligibility, active-effect chips, MatchupFinal fx lines). All verified
end-to-end in `server/test/h2h-verify.mjs` (15/15 green).
- **LEAD CHANGE (`lead-change`, ◎45, slot-you).** +`LEAD_CHANGE_BONUS` (2) every
  time you SEIZE the lead in that slot (overtake after trailing). Post-hoc scan of
  the slot's event `youBank`/`theirBank` timeline; a blowout you never trailed in
  pays nothing. Rewards a dogfight.
- **GRUDGE MATCH (`grudge`, ◎60, slot-you).** Stake a slot: win its H2H by
  `GRUDGE_MARGIN` (10)+ → +`GRUDGE_SWING` (25); lose it → −25; win by <10 / tie →
  0. Double-or-Nothing with real downside; applied as a bonus delta like DoN.
- **JINX (`jinx`, ◎55, slot-opp, blind).** The opponent's FIRST TD in that slot is
  negated — no points, no nuke. In `resolveSlot` via `opts.theirJinx`/`youJinx`
  (skips the TD play entirely, emits a 🧿 JINXED event). Whiffs if they don't TD.
- **RED HERRING (`red-herring`, ◎90, slot-you).** A decoy: every OPPOSING player of
  the same position anywhere in the decoy's window is CAPPED to the decoy's total
  (`min`, never raised). Field a low decoy to cap their studs at that position;
  whiffs if they field nobody there, and you waste the slot (the risk). Sets
  `ResolvedSlot.theirRedHerringFrom` on capped slots.
- Design note: these answer the "rich-get-richer" critique — Lead Change &
  Underdog reward comebacks, Grudge/Jinx/Red Herring/Rivalry are blind bets with
  whiff risk. (Underdog metric replaced the old duel metric; Rivalry is a power-up.)
  Live-worker applied_state→extras wiring for all targeted plays remains the open
  live-pilot task (demo + forceResolve/preview paths work).

## Head-to-head battle mechanics — cross-slot & within-window (v0.116.0)
The ask: "more head-to-head across slot and within window mechanics like Field
General — each window/slot should feel like a battle." Four additions, all
opt-in like Field General so the measured per-slot meta is untouched
(`cd server && npm run study` still prints the exact documented shares).
Everything lands in the SHARED engine (`src/engine/sim.ts` + `matchup.ts` +
`liveResolve.ts`), so the demo (`buildMatchup`) AND the live pilot
(`resolveLiveMatchup`, which the Fly worker runs via tsx) both get it.

- **WINDOW BATTLE (new scoring layer).** Each of the ~5 windows is now its own
  head-to-head: the side with the higher window total WINS the window and banks
  a flat `WINDOW_WIN_BONUS` (+5), on top of the raw point total. Surfaced live as
  a **battle meter** under each window header (who's leading, "win for +5") and at
  FINAL as WON/LOST + the bonus + slots-won. `ResolvedWindow.battle`
  (`computeWindowBattle`) carries it; `ResolvedMatchup.youWindowsWon/theirWindowsWon`
  tally it. `resolveLiveMatchup` bakes the bonus into the winning window's state so
  per-window states still sum to the grand total. MatchupFinal's window strip +
  hero show `⚔ WINDOW BATTLES 3–2`.
- **WINDOW MVP (drip-coin only, no points — per the founder's call).** The single
  highest-scoring slot in a window earns its side `WINDOW_MVP_COIN_PER_SLOT` (◈5)
  × the window's slot count — so a 3-slot Sunday-early MVP = ◈15, a lone TNF MVP =
  ◈5. Threaded through `weekEarnings` (new `mvp` line in the earnings sheet) and
  `battle.mvp`; the live resolver adds it to `coin`.
- **FIELD MARSHAL (DEF metric `marshal`) — the defensive Field General.** A DST on
  `marshal` banks flat splash points (NO drip) AND builds a live, window-wide SHIELD
  on its own side: cumulative splash production (sk1/int3/fr2/def-TD6/safety2) ramps a
  damage-reduction fraction (`SHIELD_RATE` 0.04/pt, cap `SHIELD_CAP` 0.5) that
  BLUNTS every opposing nuke and erase against all its window's slots. Built by
  `windowShield()` (mirrors `windowFgMult`'s shape), wired at both resolve sites via
  `resolveSlot` opts `youShield`/`theirShield`; the wipe/erase keep a shielded
  fraction of the bank (log shows "🛡 SHIELD kept …" / "🛡 N% blunted").
- **DEF EARN gains a DRIP (fixes Marshal dominating Earn).** Marshal was Earn + a
  free shield → Earn was strictly dominated. Now the three DST metrics are distinct:
  **Earn** = flat splash points + a DEFENSE DRIP (each splash raises a rate,
  `DST_DRIP_RATE` 0.02 × splash weight, accruing over the whole game so an early
  sack/pick snowballs) → the scoring ceiling; **Marshal** = flat points + shield, no
  drip → the protector; **Suppress** = banks 0, field-wide halving → the denier. The
  DST drip isn't pausable/erasable (never an `oppIsDrip` victim), never goes HOT, isn't
  FG-boosted, and only shows in real resolution (projected DSTs have no splash plays,
  so the AI still plans Earn as flat). Measured: den-dst earn 13.9 vs marshal 10 on
  Week 1.
- **SUPPRESS drips into a bigger kill-bar (still banks 0).** Suppress now drips like
  Earn, but converts it into suppression power instead of points: the halving
  threshold is `defSuppressScore` = flat splash score + `dstDripTotal` (the same
  weight×0.02 ramp, integrated over the game), so an early sack/pick raises the bar
  and halves more/higher opposing slots. It still banks 0 (the whole production is
  spent as the bar); `suppressSpent` display + the kill-bar both use the drip-inclusive
  score. Measured: den-dst bar 10 → 13.9 (= Earn's full production, so the trio shares
  one production model: Earn banks it, Marshal trades it for a shield, Suppress spends
  it as the bar). `DST_DRIP_RATE` is now module-level in sim.ts (one knob for all three).
- **UNDERDOG (WR/RB metric `underdog`) — the anti-snowball comeback pick.**
  (Replaced the earlier `duel` metric, which was rich-get-richer: a lead just
  siphoned more.) Flat yardage base (0.1/yd + 6/TD), but while the slot is
  TRAILING every score banks ×`UNDERDOG_MULT` (1.5); pull ahead and the boost
  switches off (no running up the score). Own family in `familyOf`; the boost
  hooks per-play scoring only (`mine.bank < opp.bank` gate). EXCLUDED from
  `bestMetric`/`bestVsThreats` (human-only, like `fg`) so the tuned wheel is
  preserved (scores flat solo — no trailing boost vs empty — so the study shares
  are unchanged). The head-to-head "Rivalry" idea moved to a power-up (below).
- **RIVALRY power-up (`rivalry`, ◎70, window-targeted, blind).** Arm it on a window
  pre-kickoff: for every slot where the opponent fields the SAME position as you,
  siphon 50% of that opponent's slot score to you at window-end — whiffs entirely
  if they don't mirror your position (that's the risk; a wary opponent can dodge by
  playing a different position there). Engine: `extras.rivalry: WindowId[]` in
  buildMatchup (applied after backups+suppress, before the window battle, sets
  `ResolvedSlot.youRivalry`); mirrored in `resolveLiveMatchup` (`LiveExtras.rivalry`,
  both sides). Store: `AppliedWeek.rivalry` + `applyRivalry`/`removeRivalry`. UI:
  a per-window "⚔️ RIVALRY" arm/remove button in the setup header (mirrors Extra
  Slot), an active-effects chip, and a MatchupFinal fx line. Price seeded in
  `0079_rivalry_price.sql` (parity-checked). Verified: WR-vs-WR mirror siphons
  18.4→9.2; WR-vs-RB non-mirror whiffs (26.1→26.1). NOTE: the live worker's
  applied_state→extras wiring for rivalry is not yet plumbed server-side (demo +
  forceResolve/preview path works); that's the remaining live-pilot task.
- No DB migration needed: `metric_id` has no allowlist constraint (only the
  locked-metric trigger, which `duel`/`marshal` pass since they aren't locked).
- Verify: `cd server && npx tsx test/h2h-verify.mjs` exercises all four on real
  Week-1 PBP (siphon fires, shield blunts a landing nuke 4.2→6.9, window bonus +5
  baked in, MVP coin present). `npm run build`, engine smoke, parity all green.


## Metric balance: measured, tuned, and a tool to keep it honest (v0.107.1)
- **`server/scripts/metric-study.mjs`** (`cd server && npm run study`): runs
  the REAL engine over baked 2025 weeks — same-position duels across every
  metric pairing for the top players per position (WEEKS/POOL env to resize).
  Prints unopposed value, the win-rate matrix, best-response mix, best-pick
  share, and a health verdict per menu (⚠ near-dead <5% best share, ⚠
  dominant ≥60% win vs every rival).
- **Measured (pre-tune)**: WR was a real rock-paper-scissors wheel; RB
  `carries` was DEAD (0% best-pick share); TE `tgt` won 97% of TE mirrors
  and the TE drip sat at 2% — partly a BUG: the engine's TE-drip immunity
  gate only covered WR/RB attackers while the catalog promises "only a TD
  (or K shutdown) stops it". QB pass-vs-rush is ~deterministic (pass 92%) —
  fine, since Field General (cross-slot multiplier) is the real QB decision.
- **Tuned (sim.ts + catalog text in lockstep)**: RB carries 0.5 → 0.85/carry
  and compression trim 25% → 35%; TE drip immunity now covers ALL erasers
  (the catalog's rule), TE tgt wide-erase window 15 → 10 min, TE drip rate
  0.005 → 0.0065/yd (0.0075 overshot and dominated).
- **Post-tune shares** — RB: rush 42 / td 41 / rec 11 / carries 6 ✓; TE:
  recyd 41 / td 35 / rec 13 / tgt 11 ✓; WR untouched (38/30/20/11 — its
  `rec` erase wins often but small; margin-vs-consistency texture kept).
  Engine smoke, typecheck, parity, build all green.
- **`server/scripts/fg-study.mjs`** (`npm run study:fg`): the cross-slot
  question the duel tool can't see — QB Field General vs flat passing, A/B'd
  as FULL WINDOWS (resolveLiveMatchup) over cast sizes × opponent styles.
  Measured: FG beats pass 59/88/100% with 1/2/3 healthy drip teammates vs
  passive opponents (+29 avg pts at 3), but collapses to 3-22% vs
  erasers/resets. A real pre-game read — no tuning needed.

## Playoffs — the endgame (v0.107.0)
`0073_playoffs.sql` + a 🏆 PLAYOFFS dashboard tab. Playoff matchups are
ORDINARY matchup rows (same lock→live→final pipeline, same board, same
materialized lineups) tagged `is_playoff`/`playoff_round`/`bracket_pos`/
`playoff_label` — nothing downstream changes.
- **Settings** (`settings_json.playoff_teams` ∈ {2,4,6,8}, default 4;
  `playoff_start_week`, default 15) via `set_playoff_rules` — editable until
  any playoff game starts. Guard: no regular-season games may exist at the
  start week or later.
- **Seeding** = `league_standings` (final non-playoff games; wins → PF →
  seat; 0-0 teams sort by seat, never null).
- **`generate_playoffs(league, seeds?)`** builds round 1 from live standings
  — or from an EXPLICIT commish seed order (override: exactly N distinct
  member seats; the panel's ↑↓ arrows edit it, CUSTOM ORDER badge + reset).
  Fixed brackets, higher seed hosts: 2 = title game; 4 = semis 1v4/2v3; 6 =
  3v6 + 4v5 with top-2 byes; 8 = 1v8/4v5/3v6/2v7. Stamps the plan into
  `settings_json.playoff_bracket` (seeds locked at generation); re-runnable
  while everything is still scheduled.
- **CONSOLATION LADDER** (`matchup.is_consolation`): everyone below the cut
  starts on a ladder in standings order and PLAYS every playoff week —
  adjacent rungs pair off (odd team out: bottom rung sits), winners climb a
  rung, losers drop, ties hold (`reorder_ladder`/`make_consolation_round`).
  Playoff losers join at the TOP of the ladder as they're eliminated
  (ordered by seed) — which makes the semifinal losers' championship-week
  pairing the **3rd Place Game**. Consolation games never block bracket
  advancement; the live ladder lives in `playoff_bracket.consolation` and
  settles into the final below-the-cut order when the title game ends.
- **`advance_playoffs`** — IDEMPOTENT + member-callable (the panel calls it
  on every load, `process_waivers`-style): when a round is fully final it
  creates the next round one week later (6-team semis: seed 1 hosts W(4v5),
  seed 2 hosts W(3v6); ties advance the better seed via `better_seed`), and
  when the championship is final it crowns `settings_json.playoff_champion`.
- **`playoff_state`** — one-shot poll: settings, generated/underway,
  seeds, all bracket matchups (+computed winners), champion, standings.
- **Client**: dashboard `LeagueRow` gains a 🏆 PLAYOFFS tab (native):
  champion banner, settings (team-count chips + start-week stepper, locked
  once underway), generate/regenerate, bracket columns per round with score
  cards + winner highlights + seed numbers, and a standings table with the
  playoff line marked.
- Probes → **446 assertions** (27: settings gates + league-size fit,
  deterministic standings from fabricated finals, commish-only generate,
  1v4/2v3 semis at the start week, regenerate-while-scheduled, no-op early
  advance, TIE advances the better seed, settings/bracket lock underway,
  champion crowned + idempotent re-advance, full state payload incl. the
  semi losers' 3rd-place game, and a 2-team league going straight to a
  title game; 28: a 6-team league end-to-end — custom-seed validation
  gates, an override field that skips the standings leader, the below-cut
  pair playing week 1, a ladder upset reordering rungs, semifinal losers
  dropping into the 3rd Place Game, a consolation TIE holding rungs, and
  the settled final ladder).

## Transactions: commish roster tools, FAAB, trades (v0.106.0)
`0072_transactions.sql` + dashboard/team-management UI.
- **COMMISH ROSTER TOOLS**: `commish_move_player` (any pool player onto any
  roster — clears waiver holds; MAY overfill/bust limits on purpose) and
  `commish_remove_player` (off the roster → scheduled waivers or straight to
  FA). Dashboard gains a **ROSTERS tab** (native): searchable pool with
  current-team labels, move-to select, WAIVE/CUT — plus the trade-ruling
  queue.
- **ILLEGAL-ROSTER LOCKOUT (deliberate design)**: a roster over its size or
  position limits (commish lowered a limit, or overfilled via the override)
  is LOCKED OUT — no FA adds, no waiver claims (submit AND resolution), and
  no weekly lineup picks (`enforce_legal_roster` trigger on sealed_pick;
  service-role/admin writers exempt so game ops never jam) — until the
  manager drops back to legal. Drops always work; a trade that lands the
  roster fully legal works too (trade validation demands full legality on
  both sides). `roster_illegal_reason` is the predicate;
  `native_team_state.roster_issue` surfaces it and TeamManage shows a red
  lockout banner + disables ADD/CLAIM.
- **WAIVER TIMING + FA PERIODS (commish-set)**: `waiver_clear_min` +
  `waiver_hold_days` — waiver holds end at a fixed daily ET time (Nth next
  occurrence) instead of rolling 24h; every waiver-hold writer
  (drop/FA-drop/claim-drop/commish remove) goes through `waiver_hold_until`.
  `fa_start_min`/`fa_end_min` — free agency open only inside a daily ET
  window (wrap-around ok; claims submit around the clock; `fa_window_open`).
  Configured in the SETUP → WAIVERS & TRADES editor (24H-after-drop vs daily
  clear time + hold days; always-open vs daily FA window); TeamManage shows
  “FA opens 10 AM ET” and the clear schedule in the waiver card.
- **FAAB WAIVERS**: `settings_json.waiver_mode` 'rolling' (default) | 'faab'
  with `faab_budget` (default $100). Claims carry blind bids
  (`waiver_claim.bid`, `submit_waiver_claim` v3 validates against the seat's
  balance); `process_waivers` v3 resolves highest-bid-first (priority breaks
  ties; winner pays, rotates to the back; losers keep their money; balance
  re-checked at resolution → 'insufficient FAAB'; losses noted 'outbid').
  Balance storage: `league_membership.faab_budget` where NULL = the league
  default — so changing mode/budget resets balances by nulling, and
  late-joining seats are auto-funded. TeamManage shows the balance in the
  pool header + per-team in the waiver-order card, collects bids in a modal
  (with the same drop-picker flow), and shows bids on pending claims.
- **TRADES** (`trade_proposal` give/get slug lists): propose (own seat) →
  counterparty accepts/rejects → executes immediately UNLESS
  `settings_json.trade_review` = 'commish' (accepted trades park for
  `commish_rule_trade` approve/veto; a veto can also kill a pending offer;
  proposer can withdraw). Execution re-validates at swap time — pieces still
  in place, both rosters legal after (size + position limits net of what
  leaves); failures surface loudly and leave the offer up. TeamManage gains a
  TRADE CENTER card (league trade log + accept/decline/withdraw + a propose
  modal with partner chips and two checkbox roster lists).
- **Rules editor**: SETUP gains WAIVERS & TRADES (mode/budget/review chips —
  saves send only CHANGED fields since mode/budget changes reset balances);
  `set_transaction_rules` + `roster_rules` v2 carry the config;
  `native_team_state` v4 surfaces waiver_mode/trade_review/my_faab/per-team
  faab/claim bids. `native_roster.acquired` gains 'trade'.
- Probes → **401 assertions** (22: move/remove permissions, deliberate
  overfill + illegality reporting, FA vs waiver holds, hold-clearing moves;
  23: FAAB gates, blind-bid resolution, winner-pays/loser-keeps, 'outbid'
  notes; 24: trade lifecycle — wrong-seat/foreign-piece/dup gates,
  auto-execute, commish park→approve, veto, 2-for-1 overfill rejection with
  the offer surviving, trade log; 25: lockout — claims/FA blocked while
  illegal, drops allowed, weekly sealed_pick rejected then accepted once
  legal; 26: daily clear time ~48h hold math, rolling restore, FA window
  gates instant adds but not claims).

## Create → commish dashboard, with the draft as a dashboard tab (v0.105.2)
- Creating a REAL league no longer shows the interstitial "League created"
  card → it lands directly on that league's commissioner dashboard
  (CommishDash focused on the new league), opened to a new **⛏ DRAFT tab**.
  The invite link stays one click away in the dashboard header. Mock flow
  unchanged (straight into the room).
- `LeagueRow` (AdminPage/CommishDash) gains the DRAFT tab for native
  leagues — it embeds the real `DraftRoom` (`embedded` prop: no back link,
  no cross-view MANAGE MY TEAM CTA; the dashboard provides the chrome).
  Commish gets start/seed/pause/force/undo + the live board without leaving
  management.
- Wiring: `NativeCreate` gains `onLeague(leagueId)`; `CommishDash` gains
  `defaultTab`; LiveOnboard tracks `manageTab` ('draft' after creation,
  reset on normal "manage" entry).

## Desktop widths for in-league screens (v0.105.1)
The player screens were locked to the 440px mobile column on any display.
- `LiveOnboard` page shell now sizes per view: draft 1160 · team 940 ·
  results 760 · create 620 · home 960 · admin/commish 1080 · auth/join 440.
- `DraftRoom` becomes two columns on desktop — board left (`flex 1.3 1
  460px`, maxHeight 560), PLAYERS/TEAMS/QUEUE panel right (`flex 1 1
  400px`) — collapsing to the stacked mobile layout under ~900px (flex-wrap,
  no media queries). `TeamManage` likewise: my roster + claims left, player
  pool + waiver order right.
- Verified with headless-Chromium screenshots at 1440px (snake, auction,
  team) and 420px (stacked) via the throwaway stub harness.

## Draft room v3 — Sleeper-style board-first layout (v0.105.0)
Pure client restyle of `DraftRoom` (`src/screens/NativeLeague.tsx`); no SQL.
- **THE BOARD IS ALWAYS ON SCREEN** (was a tab): a scrollable rounds × teams
  grid right under the pick/nomination banner. Sticky team header (avatar +
  name; auction adds remaining budget), cells fully colored by position
  (`--pos-*-bg/fg`), POS top-left + pick number top-right (`3.4`, auction
  `$23`, 🤖 for autopicks), first/last name stacked. Open cells show their
  slot number + snake-direction arrow (→/←); the on-clock cell glows and the
  container auto-scrolls to it on every pick (`scrollIntoView` keyed on
  `current_overall`).
- **Tabs** shrink to PLAYERS / TEAMS / QUEUE (board tab gone — it's the room).
- **Position filter chips double as a roster-fill meter**: `ALL 3/12 · QB 0/3
  · RB 1/∞ …` — my counts (auction includes lots I hold) against the 0071
  pos_caps.
- **Player rows, Sleeper-ordered**: DRAFT/NOM $1 button on the LEFT (LIMIT
  when at cap), then headshot + bold name over a POS pill · team · pool-rank
  sub-line, ADP/PROJ columns, queue star on the right.
- Verified visually via a throwaway Vite harness (real `DraftRoom` + stubbed
  `liveApi`, headless Chromium screenshots of snake AND auction mid-draft) —
  harness deleted after; probes/typecheck/build green.

## Roster rules + league crests (v0.104.0)
Configurable per-position roster limits (now binding HUMANS, not just the AI),
and league avatars everywhere: random at creation, platform crest on import.
- **THE MODEL (`0071_roster_rules_avatars.sql`)**: Drip has no positional
  starting lineup — the weekly board fields 8 kickoff-window slots and any
  position fills any slot — so the real roster levers are total size
  (`draft.rounds`, existing) and PER-POSITION LIMITS, now stored in
  `league.settings_json->'pos_caps'` ({"QB":3,…}; null value = uncapped;
  absent blob = the legacy defaults QB 3 / TE 3 / K 1 / D-ST 1, so old
  leagues are unchanged). `league_pos_cap`/`league_pos_caps`/`pos_cap_error`
  are the primitives; `validate_pos_caps` keeps rosters fillable (Σ caps ≥
  rounds); cap 0 bans a position (and lifts the K/D-ST endgame requirement,
  which otherwise stays).
- **ENFORCEMENT** — before 0071 the caps bound only AI; a human could draft
  12 kickers. Now every human acquisition path is checked: snake picks
  (`native_exec_pick` v3 — chosen picks only; autopick is trusted and its
  tiny-pool fallback deliberately stays uncapped rather than freeze a draft),
  auction `nominate`/`place_bid`/`set_lot_proxy` (counting lots the seat
  already holds — parallel lots can't sneak a 2nd QB past a 1-QB cap; and
  `resolve_lot_proxies` v3 zeroes at-cap challengers so a stale hidden max
  can't win illegally), `add_free_agent`/`submit_waiver_claim` (net of the
  same-move drop, so QB-for-QB swaps stay legal) and `process_waivers`
  (re-checked at resolution → note 'position limit'). The AI reads the same
  config (`native_autopick_slug` v4, `ai_lot_willingness` v4). Lowering a cap
  under a roster's current count grandfathers the roster — it only blocks
  new adds.
- **EDITOR**: `set_roster_rules(league, rounds?, pos_caps?)` — commish/admin;
  caps any time (immediate), roster size only while the draft is pending
  (auction budget re-validated). `roster_rules(league)` reads them back.
  Client: the create wizard (league AND mock) gets a ROSTER LIMITS row of six
  steppers (∞ past 10 → null) + a "8 weekly starters / N bench" explainer;
  CommishDash/AdminPage `LeagueRow` SETUP tab gets a ROSTER RULES editor for
  native leagues (the provider-sync SCHEDULE section now hides for native);
  TeamManage shows per-position usage vs limits; the draft room greys picks
  to LIMIT at cap (server still enforces). `native_team_state` v3 and
  `draft_state` v8 surface `pos_caps`.
- **LEAGUE CRESTS**: `random_drip_avatar()` (the 72 first-party tiles,
  embedded in SQL — mirror of `src/data/dripAvatars.ts`).
  `create_native_league` v5 stamps one at creation (mocks inherit);
  existing crest-less native leagues backfilled. Imports:
  `admin_upsert_league` v2 gains `p_avatar` and fills the crest ONLY while
  null (platform URL → else random tile; invalid URLs fall back) — so a
  commissioner's pick survives every re-sync. Client Sleeper importer passes
  `sleeperAvatarUrl(league.avatar)`; ESPN/Yahoo/MFL/Fleaflicker send null
  (their adapters have no avatar) → random tile. Worker `importLeague`
  (`server/src/sync.js`) does the same fill-if-null after its upsert.
- Probes → **322 assertions** (20: cap validation gates, resize while
  pending + commish-only + locked-once-live, human draft enforcement, capped
  autopick run-out (≤1 QB, ≤2 RB, 0 K, =1 D-ST per roster), FA/waiver caps
  net-of-drop, live cap edits; 21: auction nominate/bid/proxy cap checks with
  lots-held counting, creation + mock crests, platform crest stored,
  re-sync never clobbers, null/invalid → site art).

## Mock drafts vs the AI + frozen-auction fix (v0.103.0)
Practice rooms for every draft shape (snake/auction × live/slow), and the bug
that froze multi-lot auctions.
- **MOCK DRAFTS (`0070_mock_drafts.sql`)**: a mock is a normal native league
  with `league.is_mock = true` and seats 2..N handed to named bots
  (`controller = 'ai'` — Otto Pick, Max Bid, Al Gorithm, …). One flag buys the
  feature because the machinery already existed: `draft_tick` autopicks /
  auto-nominates any non-live-human seat, and the 0068/0069 auction AI values
  players and counter-bids second-price. `create_mock_draft(teams, rounds,
  pick_seconds, mode, budget, lot_seconds, max_lots)` wraps
  `create_native_league` (same validation + closed-testing gate). A mock gets
  NO schedule (client skips `native_generate_schedule`, so
  `native_materialize` no-ops — nothing leaks into the season pipeline), NO
  joiners (`native_join` refuses is_mock), and NO permanence
  (`delete_mock_draft`, commish/admin, refuses real leagues; cascade wipes the
  tree). `draft_state` v7 adds `is_mock`.
- **FROZEN-AUCTION FIX (found by the new probes — this was the live "stuck at
  0:00, 0/N lots open" screenshot)**: with parallel lots, one `draft_tick` can
  auto-nominate for several AI/vacant seats back-to-back, but
  `native_autopick_slug`/`native_queue_pick` only excluded ROSTERED players —
  not players already on the block. The second seat re-nominated the same
  best-ranked player, hit `auction_lot`'s (league_id, slug) unique constraint,
  and aborted the whole tick — every tick, forever. Both helpers now skip
  on-the-block slugs (queue entries are skipped, not pruned — the seat may
  still win that lot). Regression pinned in probe 19d2. Relatedly the room no
  longer swallows `draft_tick` errors — a failing tick shows in the banner.
- **Client**: the create wizard opens with REAL LEAGUE / 🤖 MOCK DRAFT. Mock
  path: no name (server stamps "Mock <date>"), no overnight-pause controls,
  create → seed pool → auto-`start_draft` → straight into the room. The room
  shows a 🤖 MOCK chip, commish controls gain 🗑 DELETE MOCK, and the
  completion card becomes review-and-delete (no team-manage CTA). My-leagues
  home renders mocks as their own card (enter the draft room / delete) instead
  of a lineup card.
- Probes → **276 assertions** (18: mock snake — gate, bot seats, join refusal,
  is_mock in state, AI picks instantly then waits on the human, manual human
  pick mid-clock, full run-out with 1 K + 1 DEF per roster, no
  sleeper_lineup/matchup rows, delete permissions; 19: mock auction — both
  lots auto-filled by AI with distinct top-ranked players, counter-bids
  landed, human outbids live, full run-out, budgets non-negative, cleanup).

## Overnight quiet hours + parallel auction lots (v0.102.0)
Both draft types can now sleep, and auctions can run several lots at once.
- **OVERNIGHT (`0069_night_multilot.sql`) — night-aware clocks, not frozen
  state**: every deadline the engine sets (pick clock, nomination window, bid
  bell) goes through `awake_deadline(from, secs, night_start_min,
  night_end_min)` which counts only awake ET time (America/New_York → DST
  safe; wrap-around windows like 22:00→10:00 supported). Consequences: NO
  deadline can ever expire overnight (no 3am autopicks, no 10:00:01 avalanche
  — remaining clock always burns in daylight); manual picks/bids stay legal at
  night (a night bid gives rivals until morning + the full window). Config per
  league at creation (`draft.night_start_min/night_end_min`, both-or-neither);
  wizard gets 🌙 OVERNIGHT PAUSE (ET) + FROM/UNTIL hour steppers; the room
  header shows the quiet-hours chip (highlighted while night). Pure-function
  probes pin exact answers incl. a 36h clock spanning two nights.
- **PARALLEL LOTS**: the lot moved off the draft row into `auction_lot`
  (member-readable; `lot_proxy` now keyed per lot, still no read policy).
  `draft.max_lots` 1–4; the nomination turn advances on NOMINATION (not
  award), so the room fills to capacity; `deadline_at` is the next nominator's
  window only while capacity exists. THE MONEY RULES that make simultaneous
  bidding safe (`auction_lot_max`): committed = Σ bids on lots you hold;
  capacity = spots left − lots held; max on another lot = budget − committed −
  $1×(capacity−1); no capacity ⇒ can't bid or nominate. A seat can never win
  into a negative budget or an overfull roster (probed: 17l–17n exact math).
  Awards are per-lot at each lot's own quiet-window bell; `draft_state` v6
  returns `lots[]` (each with the caller's own `my_proxy` + per-lot `my_max`)
  and budgets gain `committed`. `place_bid`/`set_lot_proxy` take an optional
  lot id (default = oldest open lot, so single-lot flows are unchanged).
- **Client**: stacked lot panels (per-lot bell, quick bids gated by per-lot
  max, per-lot 🕶 MAX input), nomination banner shows only when the room has
  capacity, budget strip shows committed + lots open; wizard gains LOTS AT
  ONCE (auction). `ai_lot_willingness` v2 returns the UNCAPPED model value —
  the per-lot cap now lives in the resolver (old `auction_max_bid` dropped).
- Probes → **239 assertions** (16: exact awake_deadline arithmetic ×6 + config
  gates + state surface; 17: parallel lots — turn advances on nomination,
  capacity gate at max_lots, committed-money max enforced to the dollar, lot
  independence, bell frees capacity + reopens the nomination clock, full
  run-out clean). Sections 13–15 ported to the lot-table model.

## AI counter-bidding + slow drafts with fair auction turns (v0.101.0)
Closes the two v0.100.0 auction gaps and adds days-long draft pacing.
- **AI bidding = value model + second-price proxies (`0068_slow_auction_ai.sql`)**:
  `ai_player_value` (budget × 0.34 × e^(−rank/45), floor $1),
  `ai_lot_willingness` (±15% deterministic per-seat jitter; 0 when positional
  caps / forced-K-DEF endgame make the player useless; capped at
  auction_max_bid), `resolve_lot_proxies` — ONE closed-form second-price step
  over ALL seats (AI willingness + human hidden maxes, holder included):
  highest max wins at second-highest+1 capped at its own max, ties keep the
  holder. Stable in one call (traced: no +1 ping-pong, no runaway extensions).
  Runs inside draft_tick (before the bell — a change restarts the window),
  after place_bid (proxies answer a manual bid instantly, response carries
  `outbid`), after nominate, and after set_lot_proxy.
- **SLOW-MODE FAIRNESS (the design decision)**: (1) any price/holder change
  resets the bell to the FULL lot_seconds window → sniping is impossible, the
  lot closes only after a fully quiet window; (2) humans get HIDDEN MAX BIDS
  (`lot_proxy`, no select policy — readable only as `draft_state.my_proxy` for
  your own seat) — the same mechanism AI uses, so being offline costs nothing;
  (3) a missed nomination window auto-nominates from the seat's own QUEUE at
  $1 (0067) — turns never stall and land on players the manager chose.
  Proxies are per-lot (cleared on nominate + award).
- **Slow clocks**: `create_native_league` v3 (+p_lot_seconds; 8-arg, 7-arg
  dropped) — pick/nomination window up to 48h, bell 10s–48h. NativeCreate
  gains ⚡LIVE / 🐢SLOW pace chips (seconds vs hours steppers + a fairness
  blurb); countdowns render "2d 4h" / "7h 12m" / "3:07" (`fmtCountdown`).
  Slow SNAKE needed no new mechanics (queue + autodraft + worker sweep).
- **Client**: lot panel gains the 🕶 HIDDEN MAX row (set/clear, shows only
  your own; "bids for you while you're away — nobody sees it").
- Probes → **205 assertions** (14: AI counters a $1 nomination on a vacant-seat
  league, price sane vs max-bid, full-window reset, human-over-AI-valuation
  wins, missed-turn auto-nomination, full slow-auction run-out with no
  negative budgets and every award priced — note the AI correctly STOPS
  bidding late-draft to reserve K/DEF budget; 15: deterministic human proxy
  duel — proxy takes lot at holder+1 not its ceiling, privacy both in
  draft_state and pg_policies, instant defense at second+1 with `outbid`
  feedback, bigger proxy beats smaller at second+1, budget-floor gate, award
  at proxy price + proxies cleared).
- Deferred: per-lot proxy pre-set before nomination (watchlist maxes),
  overnight clock pauses for slow drafts, on-the-clock notifications (no
  email/push infra for managers yet).

## Draft room v2: queue/autodraft/board/cards, commish controls, AUCTION (v0.100.0)
The full draft feature set, plus uniform avatar tiles.
- **DB (`0067_draft_features.sql`)**: `draft_queue` (private per-seat wishlist,
  RLS owner-read; `set_draft_queue` replaces whole list; EVERY autopick takes
  queue → best-available), `league_membership.autodraft` (+`set_autodraft` —
  seat picks instantly), commish controls (`commish_pause_draft`/`resume` —
  clock/lot freezes and restores via `pause_remaining`; `commish_force_pick`
  slug-or-auto; `commish_undo_pick` unwinds the last pick, reopens a completed
  draft), and **auction mode**: `draft.mode/budget/lot_*/nom_idx/lot_seconds`,
  `draft_pick.price`, `league_membership.draft_budget`; `nominate` + `place_bid`
  (max bid always reserves $1 per unfilled spot — `auction_max_bid`); awards +
  auto-nominations run inside `draft_tick` (same poll/worker path as snake;
  vacant/AI/autodraft seats auto-nominate queue-first at $1 and don't bid — AI
  teams fill at $1, a known v1 imbalance). `draft_state` v3: mode/paused/lot/
  budgets/my_autodraft; `create_native_league` gains p_mode/p_budget (7-arg;
  5-arg dropped). Probes → **167 assertions** (12: queue autopick, autodraft,
  pause gates+frozen tick, force+undo roundtrip; 13: full auction lifecycle:
  budgets, nomination/bid gates, max-bid floor, pause-lot, award+price,
  auto-nominate, completion, no negative budgets).
- **Data**: `src/data/proj2026.ts` (GENERATED — StatHead 2026 projections, 300
  players incl. rookie model; refresh alongside adp2026.ts).
- **Client (`NativeLeague.tsx` DraftRoom rewritten)**: tabs — PLAYERS (ADP +
  PROJ columns, ☆ queue toggle, row → **PlayerCard** modal: headshot, ADP,
  projected PPG, real 2025 season line via statsForSlug, draft/nominate/queue
  actions), BOARD (rounds×teams grid, pos-colored cells, $price + 🤖 tags,
  on-clock glow), TEAMS (per-roster picks + auction budgets on chips), QUEUE
  (reorder/remove, TAKEN strikethrough, 🤖 AUTODRAFT toggle). Commish bar on
  the live card (⏸/▶/⏭ FORCE/↩ UNDO). Auction lot panel: player, current
  bid + high bidder, bell countdown, BID +1/+5/+10 quick bids gated by
  max-bid, budget chip; nomination banner. NativeCreate gains SNAKE/AUCTION +
  budget. 3s poll; tick fires on overdue clock OR auto seat OR expired lot.
- **Avatars**: all 72 tiles recut to uniform 192² framing — short source bands
  (gear footballs) get blur-extend letterbox fill instead of zoomed crops.
- **Worker**: sweepNative counts lots_awarded too (draft_tick handles both
  modes — no new sweep).
- Known v1 gaps: no auction undo; AI seats never counter-bid; queue is
  replace-on-write (no realtime sync between a manager's two open tabs).

## First-party Drip avatar gallery (v0.99.5)
The owner supplied three 8×3 avatar sheets (helmet-bust player set, action-pose
set, fields/helmets/footballs gear set); they're cut into **72 first-party
192×192 webp tiles** under `public/avatars/` (~750KB) and are now THE avatar
gallery — DiceBear is GONE (it was unverifiable from the sandbox anyway); NFL
team logos remain as extra options. No DB change (`set_team_avatar` /
`set_league_avatar` store URLs).
- `src/data/dripAvatars.ts` (generated): ordered file list + `dripAvatarUrl()`
  — URLs are absolute on `AVATAR_ORIGIN = https://dripfantasy.com`, so a stored
  pick renders on any surface and passes the RPC https gate even when picked
  from a dev origin (the tradeoff: dev picks point at prod assets — fine).
- Slicing pipeline (for future sheets): the sheets were AI-generated with
  NON-uniform per-sheet grids — tiles ≈162px wide at centers `169 + 245k`,
  rows measured per sheet (01: 180-365/406-562/660-788 — row 2+3 label chips
  OVERLAP tile bottoms and are cropped out; 03/04: 166-338/388-560/612-786).
  Method: overlay candidate boxes + zoomed coordinate rulers on the sheet,
  eyeball, iterate, then contact-sheet the crops for a final visual check.
  Center-square crop → 192², webp q85. Raw sheets are NOT committed (repo
  hygiene); tiles are the artifact.
- Tile naming: `hero-*` (24 busts — listed first in the picker), `action-*`
  (24 poses), `gear-*` (24 fields/helmets/balls). Two sheets had duplicate
  labels → `-2` suffixes (action-phase-shift-2 etc.).

## Native-league media: headshots, logos, team + league avatars (v0.99.4)
Player pictures + NFL team logos across the draft room / team screens, and
self-serve avatars for teams and the league.
- **DB (`0066_native_media.sql`)**: `league_pool.espn_id` (seeded from the
  Sleeper directory → rookies get headshots; the baked HEADSHOTS map only
  covers ~600 2025 vets by slug) via `seed_league_pool` v2; `league.avatar_url`;
  `set_team_avatar` (manager/commish/admin, https-only ≤300 chars, null clears)
  + `set_league_avatar` (commish); `native_team_state` v2 adds
  my_team/my_avatar/league_avatar/is_commish + avatar per waiver_order row.
  Probes → 112 assertions (espn_id storage, avatar permission/scheme gates,
  clear/reset, identity fields). ⚠ apply 0066 (and 0065 if still pending) on
  merge.
- **Client**: `PlayerImg` gains an `espnId` prop (`headshot(slug) ??
  espnHeadshot(espnId)` → team logo → pos pill, all behind the mark-free
  switch); pool pipeline carries espnId end-to-end (DraftPoolEntry →
  seedLeaguePool → league_pool → LeaguePoolPlayer). Draft board / my-picks /
  roster / free-agent / drop-picker rows all render PlayerImg 24px; the
  on-clock banner + waiver order show team Avatars.
- **Avatars**: `AvatarPicker` preset gallery — 32 DiceBear generated crests
  (bottts-neutral/fun-emoji/shapes/rings, deterministic seeds) + 32 NFL team
  logos. TeamManage gets a team-identity card (avatar + ✎ rename via the
  previously-unexposed `set_team_name`; shown PRE-draft too so the draft board
  has identities) and a commish-only LEAGUE ⚑ crest picker. League crest shows
  on league cards (myEnrollments league join + LeagueCard). Team avatars flow
  everywhere `league_membership.avatar_url` already rendered (cards, boards).
- ⚠ NOT verified from this sandbox: api.dicebear.com (egress proxy 403 — the
  ESPN CDN checked out fine). Picker tiles fall back to a dashed placeholder
  and saved avatars fall back to initials, so a CDN outage degrades softly —
  but eyeball the DiceBear tiles render on the deployed picker.

## 2026 draft pool: rookies + consensus ADP (v0.99.3)
The native-league draft pool is now built for the CURRENT season, rookies
included, instead of the 2025 baked-PBP set (which was the right guarantee for
the replay demo but a 2025-ism for a real draft — the worker's live-scoring
index is directory-driven, so any Sleeper-directory player scores live in 2026).
- **Data**: `src/data/adp2026.ts` — GENERATED 2026 consensus ADP (200 rows,
  Stathead MCP `get_adp` season 2026: FantasyPros + Sleeper + FFC blend,
  as-of 2026-07-07, rookies priced — Jeremiyah Love RB ADP 26.5). Refresh
  instructions in the file header; REBAKE WEEKLY through August (ADP moves).
- **Pool** (`nativeLeague.ts buildDraftPool()`, now async): full Sleeper
  directory (has all 221 skill-position 2026 rookies with post-draft teams) in
  four tiers — consensus ADP → team K/DST at late-round cost → post-ADP vets by
  2025 ppr → deep bench by Sleeper `search_rank` (new optional `PlayerMeta.rank`,
  parsed in sleeperPlayers.ts). Unsigned-but-priced FAs (Tyreek, Diggs) kept as
  team 'FA'. Cap 1200; directory-fetch failure falls back to the 2025 baked
  pool so creation never hard-fails. Verified live via tsx: 1034 players, 0
  dupes, Love #24 @ARI, first DEF #168 / first K #208.
- **Client**: NativeCreate awaits the directory build (progress notes); the
  DraftRoom pending card gains "↻ REFRESH PLAYER POOL (2026 ADP)" — commish
  re-seed via the existing `seed_league_pool` (pre-draft only), picking up ADP
  moves + FA signings since creation. No DB changes.
- Rookies show as genuine DNPs on baked-2025 replay boards; `projectedPoints`
  gives them position-default baselines until 2026 games accumulate (auto-
  lineup ranking only — could later carry Stathead 2026 projections in the same
  baked file).

## Air Raid reprice ◎60 → ◎40 (v0.99.2, migration 0065 — NOT yet applied)
Findings §16. Price-only change (scoring untouched): powerups.ts + 0065
powerup_price v4, rulebook regen, parity checker green. Measured: as a lone
buy nothing changes (amp still the right first buy); as a SECOND buy the ◎40
raid now fits alongside an amp inside weekly income — raid-then-amp is the
best measured steady policy at 52.9% (+2.7 over amp-only, 30 seasons). Real
but modest; symmetric adoption cancels. WATCH: dial to ◎45-50 if it creeps
past ~54%. Season.mjs gained makeRaid() team-0 policies. The shipping AI
still doesn't buy Air Raid (aiLiveBuffs is amps-only; would also need an
aiMetric passbig hook) — separate design call. ⚠ 0065 must be applied via
the migrate-workflow dance when this merges. (Renumbered from 0064: the
native-leagues merge claimed 0064 first.)

## Native leagues gated to super admin for closed testing (v0.99.1)
Owner call: test before opening up. `create_native_league` now requires
`is_admin()` ('native leagues are in closed testing'); the RoleChooser "Start a
fresh league →" option renders only for admins (both mounts — the add-league
view and the fresh-sign-in fork). Creation is the single choke point — every
other native RPC needs an existing native league — so un-gating later is
deleting one check + one prop condition. `native_join` stays open: the admin
can invite non-admin test accounts. Probes updated (93 assertions): non-admin
create is refused; probe identity switching got a `probe_as()` helper that sets
BOTH uid and email claims (is_admin() reads the email — the old uid-only
switches would have leaked A's admin bit into B's probes).

## Native leagues: in-app draft, waivers, team management (v0.99.0)
Kills the game's biggest structural liability — needing a league that already
exists in another product. A league can now be BORN in Drip: create → invite →
snake draft → waivers/free agency → the existing live H2H pipeline, unchanged.
Full design + decisions in `docs/native-league-plan.md`.
- **Why it was cheap**: lock/resolve/live-board only ever read four row-sets
  (league / league_membership / matchup / sleeper_lineup starters_json) keyed by
  opaque ids + slugs — the ESPN `provider` pattern (0041) extends to
  `provider='native'` with key `native-<uuid>`. Live scoring is the ESPN feed for
  every league anyway.
- **DB (`0064_native_leagues.sql`)**: `league_pool` (ranked draftable universe,
  `waived_until`), `native_roster` (first persistent rosters in the codebase,
  one owner per player), `draft` + `draft_pick` (snake, pick clock,
  `draft_order`), `waiver_claim`, `league_membership.waiver_priority` (rolling).
  RPCs: `create_native_league` (creator = commish + seat 1), `native_join`
  (invite code claims lowest open seat — no identity matching),
  `seed_league_pool`, `native_generate_schedule` (round-robin, `lock_at` from
  the 0051 nfl_slate), `start_draft`, `make_draft_pick` (turn-gated; commish may
  proxy), `draft_tick` (autopicks overdue/vacant/AI seats — ANY member's poll
  advances the draft; per-league advisory locks serialize races),
  `draft_state` (+`on_clock_auto`, `server_now`), `drop_player` (24h waivers),
  `add_free_agent`, `submit_waiver_claim`/`cancel_waiver_claim`,
  `process_waivers` (priority order, winner rotates to back, idempotent),
  `native_team_state`, `native_materialize` (rewrites sleeper_lineup for
  all-scheduled weeks only — locked weeks frozen; called by every roster
  mutation, so no sweep needed). `league_by_invite` now returns `provider`.
- **Autopick**: best-rank free player under caps (QB≤3, TE≤3, K≤1, DEF≤1),
  forced K/DEF once remaining picks require them.
- **Client**: `src/data/nativeLeague.ts buildDraftPool()` — the pool is the
  BAKED-PBP set (~440 skill + 32 K + 32 DST) ranked by real 2025 ppr, so every
  draftable player actually scores. `src/screens/NativeLeague.tsx` — NativeCreate
  wizard / DraftRoom (4s poll, skew-corrected clock, search + pos filters) /
  TeamManage (drops, ADD vs CLAIM with waiver countdowns, roster-full drop
  picker, claims, waiver order; runs `process_waivers` on refresh so it works
  worker-less). LiveOnboard: RoleChooser "Start a fresh league →", native cards
  get `⛏ draft`/`⇄ team`, RedeemForm routes native codes to claim-a-seat.
- **Worker**: `server/src/native.js sweepNative()` on each tick — safety net for
  unattended leagues (drafts + waiver clears); not required for correctness.
- **Testing — NEW committed harness**: `scripts/db/run-scratch-probes.sh` spins
  a throwaway PG16, applies the Supabase shim + all 64 migrations, runs
  `scripts/db/native-league-probes.sql` (92 assertions: gates, snake order,
  autopick caps/forced K-DEF, completion+materialization, waiver
  priority/rotation, locked-week freeze, RLS leaks). All pass; `npm run build`
  green. Deferred (documented): trades, FAAB, realtime draft push, keepers.

## First-buy variety probe — amp default is real dominance (tools only)
Findings §15, new tools/playtester/firstbuy.mjs: one-purchase A/B with blind
roster-aware rules vs a hindsight oracle. No observable rule beats
always-buy-an-amp (+16.6; combo-if-elite-dual ties at +15.8); the oracle''s
35% non-amp picks are luck-driven, not surfaceable. If first-buy variety is
wanted the lever is PRICE (air-raid ~◎35-40 vs current ◎60; extra-slot is
structurally weak solo) — a design call for the owner, not a code fix.

## Saver probe + amp-bundle instruments — capacity pricing validated (tools only)
Findings §14. Playtester-only change (no engine/app code): aggregate.mjs
gets amp-pair/amp-trio levers (trio is SUPERLINEAR: +68.8 margin vs +46.3
summed singles, same pts/◎10 as singles); season.mjs gets a saver probe
(team 0 hoards for the bundle → steady 50.2% beats saver-pair 46.7% and
saver-trio 45.7% — hoarding loses, economy closed, no price change needed);
adversary.mjs greedy step is now capacity-aware (bundles+prices amp-2/amp-3
into over-cap trials → honest ◎200 ceiling +66.4, still −19% vs pre-capacity;
+amp-2 in 51% of hindsight lines = the pair is the legit rich play). Also
FIXED: season.mjs `seasonBudget` had missed the 0063 capacity rule (wasted
~9% of amp buys on engine-dropped second amps); corrected meta diversifies —
combo-drip 1.6→10 buys/season, extra-slot 0→4.9, opt-out Δ 9.3.
NOTE for future sims: THREE AI budget mirrors must stay in lockstep now —
server/src/lock.js aiBudgetPass, tools/playtester/lib.mjs aiLoadout, and
tools/playtester/season.mjs seasonBudget.

## Amplifier capacity — Second Amp / Third Amp unlocks (v0.98.0)
Design call (replaces the amplifier-surcharge idea): the drip amplifiers
(Momentum · Overtime · Garbage Time) are limited to ONE armed per week by
default. Two new pre-kickoff power-ups raise the cap as a purchasable product
instead of a hidden tax: **Second Amp** (`amp-2`, ◎40) → cap 2, **Third Amp**
(`amp-3`, ◎60, requires Second) → cap 3. Full stack now ◎305 vs the old ◎205.
Prices are drip coin — NOT real money — per the "premium is never
pay-to-win" promise; flag to the owner if real-$ was actually intended.
- **Engine (`src/data/powerups.ts`)**: `AMPLIFIERS`/`isAmplifier`/
  `ampCapacity`/`capAmplifiers` — the cap is enforced authoritatively at
  resolve in BOTH engines (`resolveLiveMatchup` + `buildMatchup` wrap the
  buff sets), dropping excess amps in fixed priority (momentum >
  garbage-time > overtime) so arm order never changes scoring.
- **DB (`0063_amplifier_capacity.sql`)**: `is_live_buff` v2 (+amp-2/amp-3),
  `is_amplifier()`, `powerup_price` v3 (amp-2 40 / amp-3 60), `arm_buff` v3
  rejects `'amp order'` (Third before Second) and `'amp limit'` (arming an
  amp beyond cap, with a detail message), `disarm_buff` v2 rejects removing
  capacity still in use (`'amps in use'`) — a paid buff can never be
  silently dropped at resolve. 16 scratch-DB probes pass (arm/disarm gates,
  dup, prices, spend/refund symmetry).
- **Client**: LivePicks renders the new chips (LIVE_BUFFS + `detail` shown on
  arm errors); demo `store.armBuff` mirrors the gates and `disarmBuff`
  CASCADES (removing Second Amp also disarms Third + now-excess amps, all
  refunded); ApplyPowerupsModal disables ARM with an inline reason.
- **AI (server/src/lock.js `aiBudgetPass` + tools/playtester/lib.mjs
  `aiLoadout` — keep in lockstep)**: buys capacity before an over-cap amp,
  and only when BOTH the unlock and the amp fit the balance. The demo AI
  (`aiBuffs`) gets its needed capacity free (it has no wallet).
- Motivation: findings §12 — power-ups had become mandatory (opt-out tax
  11.2 pts) because stacking all three amps was strictly correct. See the
  new findings § for the measured effect.

## Combo Drip: one slot PER PURCHASE, buyable multiple times (v0.97.1)
0061 read "single-use" as a hard cap of one combodrip slot per lineup; the
intended rule (design call) is ONE-FOR-ONE — each ◎65 unlock purchase permits
one combodrip slot, and you may buy several if you can afford them (the tight
coin economy is the stack limiter: 3 slots = ◎195 ≈ 3 weeks of income).
- **DB (`0062_combodrip_qty.sql`)**: `applied_state.payload_json.unlockQty
  ['unlock-combo-drip']` counts purchases (legacy set-flag-without-qty reads
  as 1); `arm_unlock` on combo always buys ONE MORE (new charge, qty+1);
  `disarm_unlock` refunds one and trims now-excess picks (highest slots
  first); the sealed_pick trigger + `apply_targeted` enforce picks ≤ qty
  ('Combo Drip is one per unlock — you own N…').
- **Engine**: `resolveLiveMatchup` caps by `homeComboQty`/`awayComboQty`
  (default 1 — the single-unlock loadout legacy callers represent with a
  set); resolve.js passes the real qty from applied_state. buildMatchup's
  0061 cap is REMOVED — the demo already enforces one-per-purchase at pick
  time (useConsumable eats an unlock per locked-metric seal). AI unchanged
  (buys ≤1 unlock → fields ≤1).
- **Client (`LivePicks`)**: the Combo Drip chip is a counter — shows ✓×N,
  tapping buys another (◆65 each), a ➖ chip removes one (refund; server may
  trim the excess pick → full reload to mirror).
- Verified: 5 scratch-DB probes (arm×2→qty2, two picks ok / third rejected,
  disarm-one trims highest slot, disarm-last clears flag, legacy flag reads
  qty 1) + engine qty check (qty 1 vs 2 resolve differently) + invariants.
- NOTE: the playtester passes owned-set loadouts (engine default qty 1), so
  multi-combo economics aren't measured yet — pair with the amplifier-
  surcharge/saver season probe when tuning the economy pass.

## Mechanics retune #2 — fair-priced variance & denial, single-use Combo Drip (v0.97.0)
Driven by findings §10 (late swap had nothing profitable to buy) — see §11 for
the full before/after table.
- **NUKE spike profile** (`sim.ts scorePlay`): `td` = 0.04/yd scrimmage +
  10/TD (RB+WR) · 12/TD (TE), wipe+blackout unchanged, PLUS the nuke steals a
  quarter of the bank it wipes (`nukeWipe(stealPct)`; carry-wipe passes 0).
- **Denial steals** (`stealCut` in resolveSlot): erase/reset-cut/compression
  credit the denier 25% of points removed; WR Targets 1.0/target.
- **Combo Drip SINGLE-USE** (user directive): one combodrip slot per lineup —
  engine caps in resolveLiveMatchup + buildMatchup (extras downgrade to the
  standard drip; swaps into combodrip dropped when another slot runs it), the
  AI keeps its best dual-threat only (`aiLineup`), and migration
  **0061** adds a sealed_pick trigger + the apply_targeted combodrip check.
- Measured: rb-nuke-1 45.8% (target band), protect-at-parity in lateswap,
  gamble conversion ~doubled; invariants/season all hold; power-up opt-out cost
  rose 2.9 → 5.0 pts (they matter now). Metric catalog + rulebook regenerated.
- Client note: a second combodrip pick now fails at SEAL with the trigger's
  message ('Combo Drip is single-use — one slot per lineup'); SetupRow doesn't
  yet grey the option client-side — cosmetic follow-up.

## Targeted power-ups score in LIVE leagues (v0.96.0)
0059 made everything buyable; this makes the targeted/reactive set actually
WORK in live H2H — previously the client applied them locally and the worker
never scored them (pay-for-nothing).
- **Engine** (`liveResolve.ts`): `resolveLiveMatchup` gains per-side
  `extras` — Double or Nothing (post-suppress ×2/0, baked into the slot so
  window sums still equal totals), Bye Steal (flat score, clamped ≤25;
  unopposed target follows the normal backup rule), EMP (10-min opponent drip
  freeze per window), real-time Metric/Player Swaps + Mulligan (buildMatchup's
  pre/post-cut split, per side), and the Trick Play / Pick Six / Hail Mary
  flat awards (credited to the triggering slot). Backward compatible — the
  playtester/forceResolve callers are untouched.
- **DB** (`0060_targeted_powerups.sql`): `apply_targeted` / `clear_targeted` /
  `use_spy` write `applied_state.payload_json.targeted`. UNCHARGED state-
  setters (the shop flow already charges + consumes inventory — same pattern
  as hero_set_buffs); their value is validation: pre-vs-live timing gates via
  matchup status + `window_kickoff()` (0058), roster-membership checks on
  player targets (`caller_pool_has`), one-swap-per-slot / one-EMP-per-window,
  locked-metric unlock enforcement, clamps. `use_spy` consumes a purchased Spy
  from team_inventory itself and returns the opponent's REAL current pick
  (player or metric) pre-kickoff; a bought peek re-reads free (late swap means
  the pick can change — that's the gamble; blurb updated + rulebook regen).
- **Worker** (`resolve.js` / `premium.js`): `sideLineup` carries the targeted
  payload; premium gating strips premium targeted items in non-premium
  matchups (`gateTargeted`, alongside gateSide); payloads convert to engine
  extras with defensive re-clamps.
- **Client** (`Matchup.tsx` / `store.tsx` / `liveApi.ts`): every targeted
  apply/clear on the liveCtx board write-throughs to the RPCs; Spy in live
  goes through `use_spy` (real reveal shown in the SPY INTEL panel via
  `spy.value`; no undo — the item is consumed); store hydration merges the
  server's targeted record over the hero blob so live-phase applies (EMP,
  swaps) survive reload.
- **Verified**: 19-check engine harness on baked week 1 (DoN win math exact,
  EMP cuts only the opponent, swap@0 ≈ full new config / swap@end ≈ original,
  bye-steal clamp + backup rule, Hail Mary +15, window-sums invariant
  everywhere) + 17 RPC gating probes on a scratch Postgres (timing gates,
  pool membership, dup rejection, spy consume/re-read-free/qty-0).
- **Still unmodeled**: Ball Hawk (turnover feed dormant everywhere), manual
  backup assignment in live (auto-only), K-neg/suppress edge parity between
  buildMatchup and liveResolve unchanged.

## All 24 power-ups priced server-side + late-swap copy/ops (v0.95.1)
- **`0059_powerup_prices.sql`**: `powerup_price()` now lists every catalog item.
  Twelve (metric-swap, player-swap, mulligan, emp, spy, double-or-nothing,
  bye-steal, trick-play, pick-six, hail-mary, turnover-boost,
  unlock-carries-wipe) previously fell to the `else 9999` default, so
  `wallet_buy_powerup` rejected them as `'unknown powerup'` while the shop
  showed a price — the reactive/live toolkit was unbuyable in live leagues.
- **`scripts/check-powerup-prices.mjs`** now (a) parses the LATEST
  `powerup_price()` definition across migrations (create-or-replace semantics),
  and (b) fails on OMISSIONS in both directions — the class of bug above can't
  recur silently. All 24 in lockstep.
- **Late-swap copy**: rulebook §1 + intro and the FAQ now advertise per-window
  locks ("Sunday can answer what Thursday revealed"); rulebook HTML regenerated.
- **Ops**: sunday-ops-runbook's lock section documents the two-stage lock
  (`locked N matchups` at first kickoff, then `sealed N window picks` per
  window) and adds a per-window dress-rehearsal checklist — the simulator
  bulk-locks by design and never exercises the staged path.
- NOTE: several newly-buyable power-ups remain unmodeled by the live resolver
  (playtester findings §2 limitations) — buying works; effect coverage is the
  open thread.

## Per-window pick locks — "late swap" (v0.95.0)
Picks now seal **per window at that window's own first kickoff**, not all at
the week's first kickoff — the rulebook's "sealed until the window locks at
kickoff" is finally literal. A MNF pick stays editable (and hidden) through
Sunday; each window's reveal keeps riding the same `sealed_pick.locked` flag,
so the opponent reads a window exactly when it kicks off.
- **DB** (`0058_window_locks.sql`): `window_kickoff(week, win)` (min slate
  kickoff, scoped to the newest season carrying that week) + an
  `enforce_window_lock` trigger that rejects client pick writes into a
  kicked-off window — the worker sweep's tick cadence is never an integrity
  hole (no kickoff sniping). Service-role writes bypass (`auth.uid() is null`).
- **Worker** (`lock.js`/`index.js`): `lockDueMatchups` still flips status →
  live at `lock_at` but seals only due windows; new `lockDueWindows(week,
  winKicks)` sweeps each later window at its kickoff (winKicks derived from the
  tick's ESPN slate; unknown slate ⇒ seal-everything fallback).
  `materializeAutoLineups` writes future-window rows UNLOCKED so an AI/missed
  manager's later picks don't leak early (and a missed manager can still edit
  them).
- **Resolver** (`resolve.js`): `enrolledPicks` now distinguishes "has picks,
  none sealed yet" (⇒ `[]`, fields nothing until the window locks) from "no
  picks at all" (⇒ auto-lineup fallback) — without it, a real-but-unsealed
  week resolved as a phantom AI lineup between Thursday and the manager's
  first locked window. `prefetchTick` carries `hasPicks` alongside `picks`.
- **Client** (`LivePicks.tsx`/`liveApi.ts`): per-window lock gating
  (`winLocked` from server-sealed rows + slate kickoffs, 30s re-check; unknown
  kickoff after week start fails safe to locked), per-window 🔒/locks-at chips,
  SEAL visible until every window kicks off and filtering locked windows out
  of the upsert, extra-slot rows follow their chosen window's lock. `myPicks`
  returns `locked`; `liveSlate` season-scopes unscoped reads (a stale prior
  season's past kickoffs must never lock a current week).
- **Why**: this converts the week from one blind simultaneous move into a
  multi-street game — Sunday/MNF picks can react to revealed TNF/early
  results — the top recommendation of the design review (see session notes).
  Pre-match power-ups/extra slots still arm only before the week's first
  kickoff (status `scheduled` gate, unchanged). The sim harness
  (`simulate.js`) still bulk-locks — it dress-rehearses a whole live week.

## Add-a-league request path + Splash retired (v0.94.2)
- **"＋ add a league" now has a no-code path**: `RoleChooser` takes an
  optional `onRequest` third choice ("My league isn't in the pilot yet →")
  opening `RequestCodeModal`. Wired in BOTH RoleChooser mounts — the
  My-Leagues `add` view and the fresh-sign-in no-enrollments fork.
- **`Splash.tsx` is DELETED** — the `splash` route now renders `DemoBoard`
  (route id kept for history/deep-link compat), so every legacy
  `navigate({name:'splash'})` call site lands on the demo landing.
- **Sign-out lands on the demo landing** (both paths: the LiveOnboard header
  button and the SiteSettings gear — the gear now also clears `dripLive`,
  which it previously left set). Both call `markBootSessionChecked()` (new
  DemoBoard export) before navigating so the demo's one-shot boot session
  check can't race the async `signOut()` and bounce the user back to `live`.

## Demo UX fixes (v0.94.1)
- **End-card "More demo" is a real input now** — the focus-the-bottom-bar
  button (invisible feedback) is replaced by an inline Sleeper-username field
  + GO in the end card itself, sharing state with the persistent bottom bar.
- **↺ BACK TO START** header chip after FINAL (plus an end-card link) —
  full reset to a pristine step-① board (`backToStart`), unlike
  "change my lineup" which keeps the picks.
- **Signed-in players land on their leagues**: `DemoBoard` checks
  `getSession()` ONCE per app load (`bootSessionChecked` module flag) and
  navigates to `live` — covers the first OAuth redirect / magic-link-in-new-tab
  cases that beat the `dripLive` boot flag. The once-only guard keeps the
  back button from being hijacked on later demo visits.
- Dropped the CLEAN/REAL BOARD `DemoViewToggle` from the demo header
  (the toggle still exists on the board-demo surface for signed-in flows).

## Demo watch phase: expandable LOG & FIELD per duel (v0.94.0)
Every duel row on the demo board expands once its window kicks off: a
centered `▾ LOG & FIELD` chip under the row opens `DuelLog` (the GuidedDemo
two-sided play log — scoring plays, effects, 🗑️×2 buff notes, ◇ coin —
revealed to the window clock, auto-scrolling while live) plus
`SlotFieldViews` (the real board's drive charts, both players' games, own
⬢ FIELD collapse). Live windows sample at `wClock`, final windows at that
window's max clock, so logs/fields stay browsable after FINAL. The featured
(first-placed) duel's panel auto-opens at RUN (`openSlots` seeded in `run()`).
Sealed windows don't expand. Ops note: the v0.93.0 Pages deploy failed with a
transient GitHub "Deployment failed, try again later" AFTER a green build —
the token can't rerun Actions jobs (403), so the fix is the repo's usual
fresh-SHA-to-main re-trigger (v0.93.1 was exactly that).

## Demo landing sets up like the hero board (v0.93.0)
The demo landing's "pick your star" wizard is gone — setup is now the REAL
hero-board interaction, reusing the actual components (`SetupRow`,
`PlayerPicker`, `RosterAside`, `ScoutModal` — the latter two newly exported
from `Matchup.tsx`):
- **Both full rosters on display**: desktop shows the two roster rails
  (yours draggable, theirs sealed-pool view) flanking the board; narrow
  screens get the same rails as fluid toggle panels (opponent starts
  collapsed). Assigned players strike through, exactly like the hero board.
- **Drag or tap to field a player** (`assignFromRoster`/`assignToSlot` with
  top-down `compact`, mirroring Matchup's semantics), then **seal the hidden
  metric inline on the spot** (SetupRow's own "② PICK A METRIC ↓" list with
  ⓘ info cards). 🔍 SCOUT on sealed opponent boxes opens the real scout modal.
- **Guided prompt is state-derived, not a modal wizard**: ① build lineup →
  ② seal metric → ③ arm power-up (Garbage Time / EMP / Momentum) & RUN.
  `✦ AUTO-FILL` fills remaining spots from `defaultLineup` (dedup-aware);
  RUN requires ≥1 fully-sealed pick and auto-fills the rest. EMP targets the
  viewer's FIRST-placed player's window at a fixed halftime clock (1800s).
  "↩ change my lineup" on the end card hands the auto-filled board back as
  editable picks. Playout/watch phase unchanged from v0.92.0.
- Verified headlessly both ways: mobile tap flow (place → metric → scout →
  picker → auto-fill → run → FINAL → back to setup) and desktop HTML5
  drag-and-drop from the rail onto a spot.

## The demo IS the landing page (v0.92.0)
Logged-out onboarding collapsed to one screen: `src/screens/DemoBoard.tsx`
replaces `GuidedDemo.tsx` as the `demo` route's clean view AND becomes the boot
route for logged-out visitors (`store.tsx` initial route: dripLive → `live`,
remembered Sleeper user → `leagues`, else → `demo`; popstate fallback → `demo`).
- **One playable board, zero gate**: the Drip Test League **Week 2** matchup
  (`DEMO_WEEK = 2` in `config.ts` — Taco Time Titans vs Beach Day Ballers), a
  tight version of the hero board: all 5 windows with real slate times + game
  counts, both lineups (opponent picks render 🔒 SEALED until their window
  kicks off), metric chips, unopposed-backup teaching text.
- **Three guided decisions, everything else defaulted**: pick a star (best
  contested duel per position, top 3) → seal his hidden metric → arm a power-up
  (Garbage Time / EMP / Momentum) → `▶ RUN WEEK 2`. Playout is
  window-SEQUENCED (TNF → … → MNF, ~50s at 1×), narrated by `demoNarration`
  beats per live window, with `SlotFieldViews` under the featured duel and a
  score header that ticks live. Backup (unopposed) slots bank 0 during
  playout so the total never visibly drops when the engine zeroes them at
  FINAL. End card = result + bonuses + the two conversion CTAs.
- **Persistent CTAs per the onboarding spec**: a fixed bottom "MORE DEMO?"
  bar (Sleeper username → `leagues` flow, same logic as Splash), a standing
  "Request a code for your league" card (→ `RequestCodeModal`; the global
  `RequestCodeFab` is hidden on this screen), and small `sign in · FAQ` in the
  header + footer. `Splash.tsx` still exists (reachable) but is no longer the
  landing. New analytics: `demo_step` / `demo_run` (see analytics-plan.md).
- FAQ copy updated (demo opens Week 2, not Week 4). Verified end-to-end
  headlessly (vite preview + Chromium): land → 3 steps → run → FINAL
  100.8–36.3 → CTAs all functional.

## Field visuals in the demo flow + lean live board (v0.89.0)
- **Guided demo** (`GuidedDemo.tsx` watch step): `SlotFieldViews` renders the
  duel's live field(s) under the duel card, driven by the demo clock — both
  players' games, takeover/red-zone included. Intro narration points at it.
- **Lean pilot board** (`LiveBoard.tsx`): new "⬢ AROUND THE LEAGUE" collapsible
  card — every game the worker has plays for this week as a `FieldView` grid
  (clock = MAX → always the latest play). `weekGameFeeds` is fetched in the
  same refresh as scores/picks and installed via `setLiveGameFeed` (exclusive
  overlay, never baked data on a live board).
- Where visuals live on the live 2026 surfaces: the FULL matchup board
  (Matchup.tsx with liveCtx) has per-slot fields under LOG + the ▦ FIELDS
  all-games overlay with outcome tinting; the lean LiveBoard summary now has
  the around-the-league grid (no tinting — it has no engine events).

## Field visuals polish: outcome tinting, takeover, red zone (v0.88.0)
- **Outcome-based tinting** replaces participation tinting on the ▦ FIELDS
  board: `FieldBoardEntry.pids` now carries the plays a side actually BANKED on
  — built in `Matchup.tsx` from the slot event logs (`delta > 0` or an effect;
  denial effects nuke/erase/stop/reset/compression/cold log on the VICTIM's
  side, so their benefit flips to the opponent, whose player's play at that
  clock supplies the pid). Legend reads SCORED FOR YOU / FOR OPPONENT / BOTH.
- **Scoring takeover** (`Field`): big TOUCHDOWN/FIELD GOAL/SAFETY pop over the
  field (pure CSS `fvtakeover`, 2.8s, self-fading). Trigger is the most recent
  scoring play within the last 3 plays — the TD's XP + ensuing kickoff share
  its game-clock second, so requiring "latest play" would never fire. The
  scorer line derives the team from the SCORE DELTA, not `tm` (offense at
  snap), so pick-sixes/return TDs credit the right side.
- **Red-zone glow**: the attacked end zone pulses (`bpulse`) whenever the
  upcoming snap is inside the 20 (derived from the feed spot, no extra data).
- **Preseason**: verified end-to-end — the worker polls preseason as board
  weeks 101-103 into `game_feed`, the client live overlay is week-agnostic,
  and the board header reads "PRESEASON WK N" (`isPreseasonWeek`). Live-test
  the visuals in August before the regular season.

## Live game feeds — field visuals Phase B (v0.87.0)
The drive charts now light up on the LIVE pilot board, not just baked replays:
- **Adapter**: `gameToFeed(summary)` moved into `scripts/espn/espnAdapter.mjs`
  (shared by the baker and the worker; baker rebake byte-identical).
- **DB**: `game_feed` table (`0057_game_feed.sql`) — one row per game per week,
  `plays` jsonb = the GamePlay[] contract, whole-doc upsert per poll so ESPN
  mid-game revisions reconcile by replacement. Authed-read RLS like live_play.
  **Apply the migration before the worker ships.**
- **Worker**: `pollGame` also upserts the game's feed from the same summary
  (zero extra ESPN calls). The **simulator** time-releases baked
  `public/gamefeed/` docs as `game_id 'SIM:<key>'` on the same clock as the
  play feed (cleared on start + reset), so the dress rehearsal exercises the
  visuals end-to-end.
- **Client**: `gameFeed.ts` live overlay (`setLiveGameFeed`/`feedRowsToWeek`,
  exclusive per week like realPbp so 2026 week N never falls back to baked
  2025 week N — the board claims the slot with an empty overlay before the
  first fetch). The 15s liveCtx poll in `Matchup.tsx` installs plays + feeds
  together; ▦ FIELDS gates on `hasGameFeed(week)`.

## Field board + collapsible fields (v0.86.0)
- **Slot fields are collapsible**: `FieldCollapse` wraps `SlotFieldViews` and
  the backup `FieldView collapsible` mount — a centered `⬢ FIELD ▾/▴` chip
  (default open, per-slot state).
- **▦ FIELDS — the all-games board** (`FieldBoard`, `src/app/FieldView.tsx`):
  a full-screen overlay (live-phase header button, gated on `REAL_WEEKS`) with
  NOTHING but drive charts — every NFL game holding a slotted player, one
  `Field` each in a responsive grid, ESC/✕ to close. Entries are built in
  `Matchup.tsx` mirroring the slot rows' clock math (`effWinClock` +
  `clockAtRealTime` in wall modes), so the board matches the board rows.
- **You/opponent play tinting**: per game, pid→side sets are built from each
  slotted player's `realPbpFor` plays (pids are per-game, grouped per-game so
  no cross-game collisions). The shown play tints arc, marker ring, situation
  chip, text dot and card border — `--you` for your roster, `--opp` for the
  opponent's, `--warn` when both touch the same play (turnovers, K/DST).

## Play-by-play field visuals (v0.83.0)
Sleeper-style drive chart per NFL game on the live board (see
`docs/pbp-visuals-research.md` for the research + design):
- **Data**: `scripts/pbp/genGameFeed.mjs` bakes `public/gamefeed/wN.json` from
  ESPN summaries (cached in gitignored `scripts/pbp/espn-cache/`) — every
  scrimmage play with down/distance/start-end yards-to-endzone/possession/text/
  score (`GamePlay`, `src/data/gameFeed.ts`, lazy per-week loader). ESPN's
  numeric `yardsToEndzone` is FLIPPED on ~2.6% of plays (mostly punts); the
  baker derives it from `possessionText` instead (residual drive-continuity
  mismatches: 0.03%, all ESPN sequence oddities like overturned plays).
- **UI**: `src/app/FieldView.tsx` — SVG field (perspective tilt, yard lines,
  end zones, first-down line, ball marker w/ team logo + abbr fallback, play
  arc, situation chip, play text), driven by the same feed clock as the log
  (`plays.filter(c <= clock)`, marker/banner from the NEXT play's start spot —
  authoritative across penalties). `SlotFieldViews` renders ONE field when both
  slot players share an NFL game, else two (side-by-side desktop / stacked
  mobile). Mounted in `Matchup.tsx` above `TwoColLog` in both the H2H and
  backup/unopposed open blocks, gated on `slot.real`.
- Away team always attacks right (`x = away ? 100-yl : yl`) so the ball is
  continuous across possession changes. `fvdraw` keyframes in `styles.css`.
- Phase B (live): the poller's summary already carries `drives` — emit
  `gameToFeed` rows into a `game_feed` table and install like `setLivePlays`.

## Zero synthetic player data (v0.9.8.0)
All player production is now real 2025 nflverse PBP — the synthetic simulation
was removed from `src/engine/sim.ts`:
- Deleted `rng`, `sampleCount`, `spreadClocks`, `weekLine`, `WeekLine`, and
  `buildPlays` (the procedural per-game generator). `playsForPlayer` and the
  `teTdNukeClocks`/`defEarnScore`/`windowFgMult` call sites now use
  `realRawPlays(...) ?? []` — a real week with no baked entry for a player is a
  genuine DNP (zero), never fabricated. `real` flag = `REAL_WEEKS.has(week) ||
  !!r`, so the REAL PBP badge lights up.
- `projectedPoints` now returns a deterministic per-game projection from the
  player's REAL season totals (`p.stats`, from `statsRaw.ts` nflverse CSVs) — no
  RNG. Used only for default-lineup ranking + bye-steal flat score.
- Coverage check: of 184 rostered skill players, only `brandon-aiyuk`,
  `philip-rivers`, `deshaun-watson` never appear in any week (all genuinely did
  not play in 2025 → correctly zero). K & DST fully covered (31 each/week).
- The old hardcoded `47:12:00` "LOCKS IN" countdown is replaced by a real
  datetime: `weekLockLabel(week)` in `nflSlate.ts` returns the actual date + time
  one hour before the week's first game kicks off (e.g. "Thu, Sep 4 · 7:15 PM
  ET"), used in `Matchup`/`LeagueHub`/`LeagueOverview`. First game = earliest
  window with games (TNF); kickoff parsed from the window's `time` label.

## Real PBP enabled (v0.9.7.6) — was silently synthetic
`src/data/realWeeks.ts` had `REAL_WEEKS = new Set([])` even though
`public/pbp/w1–w14.json` (real 2025 nflverse play-by-play, with real game clock
`c`, real wall-clock `t`, and `play_id`) were committed. With the set empty the
loader never fetched them and the whole engine ran on `buildPlays` (synthetic).
Set to `{1..14}` so `realRawPlays` actually returns real plays (player ids are
`normName(name)`-slugs, matching the pbp keys). The re-bake generator
(`scripts/pbp/genRealPbp.mjs`) should populate this; it did not, so it's set by
hand for now. The log now prints **both** the game clock and the real wall-clock
time per event (`TwoColLog` `realOf`/`realOrder`).

## Live board layout (v0.9.7.2)
- **Window header clock**: shows the **wall-clock time of day** (ET), e.g.
  "1:14 PM", instead of the old `game / 60:00`. `WindowSection` takes a
  `wallSeconds` prop (real seconds elapsed at the current feed position —
  `winClocks` directly in real modes, or game-position scaled into the window's
  real span in game mode). Base time-of-day is parsed from `w.time`
  (`kickoffSecOfDay` / `fmtTimeOfDay` helpers in Matchup.tsx). Progress bar +
  ▶/❚❚ + FINAL chip are unchanged.
- **Per-slot game line**: the `GameLine` component (`TEAM vs TEAM` + each game's
  current game clock) renders as the header of a slot's expandable log — in both
  the head-to-head and unopposed/backup `open` blocks. Each side shows its own
  team logo + `fmtClock(youClock/theirClock)` (clocks differ per game in real
  modes).
- **Real-time power-ups folded into ✦ APPLY**: the per-slot `⚡ USE` chip is
  gone. `metric-swap` / `player-swap` are now in `SPOT_APPLY`, so they list in
  the Apply card with an APPLY button → `pendingApply` → tap a live spot
  (`spotEligible` = `s.you && !done`) → opens the existing `SwapMenu` via
  `applyToSpot`. `ScoreRow`/`WindowSection` no longer take `canSwap`/`onPowerup`.

## What this is
Drip League FF (formerly "Gridiron Clash") — a Vite + React 18 + TypeScript
fantasy-football web game. Real 2025 NFL play-by-play drives a per-window,
per-clock matchup sim with hidden scoring metrics and a drip-coin power-up
economy. No backend — everything is deterministic from `(playerId, week)` plus
baked real play-by-play.

## Branches & shipping
- **Develop on:** a working branch, then open a PR to `main`.
- **Deploy:** merging to `main` publishes to GitHub Pages automatically
  (`.github/workflows/deploy.yml` triggers on every push to `main`).
  ```
  git push -u origin <your-branch>
  # open a PR and merge to main → Pages deploys automatically
  ```
- **Bump `src/app/version.ts` (`APP_VERSION`) on every change.** Versioning is
  4-segment now (`v0.9.5.N`) to leave headroom before a real 1.0. The version
  chip renders in the header — use it to confirm a deploy went live (hard-refresh).
- **Build gate:** `npm run build` (`tsc -b && vite build`). `noUnusedLocals` /
  `noUnusedParameters` are ON — remove dead vars/props or the build fails.

## Key files
- `src/screens/Matchup.tsx` — the big one. Setup + live board, all power-up UI,
  `ScoreCard` / `ScoreRow` / `SetupRow` / `WindowSection`, all modals.
- `src/screens/MatchupFinal.tsx` — the week-result screen.
- `src/engine/sim.ts` — the simulation: `weekLine`, `buildPlays` (synthetic
  fallback), `playsForPlayer`, `resolveSlot` (merged timeline + all metric
  mechanics), `scorePlay`, `statlineAt`, `returnPlays`.
- `src/engine/matchup.ts` — `buildMatchup`, coin helpers (`metricCoin`,
  `slotCoin`, `weekEarnings`), window pools.
- `src/data/metrics.ts` — `METRICS` catalog per position (id, name, tag, fx, lock).
- `src/data/powerups.ts` — `POWERUPS` catalog (timing `pre`/`live`, target, kind).
- `src/data/returns.ts` — **generated** real KR/PR return plays (see below).
- `src/data/realPbp.ts` — per-week real play-by-play loader; `RealPlayKind`.
- `src/app/store.tsx` — drip-coin wallet, inventory, `applied[week]`
  (extraSlots/swaps/backups/buffs/doubleOrNothing/spy/byeSteal/emp), all the
  apply/clear/refund actions, `resetDripCoin`.
- `src/theme.ts` / `src/app/ui.tsx` — themes, `useIsMobile()`, header, chips.

## Power-up model (current state)
Two kinds of power-up surface, both reached from two header chips
(`◈ ACTIVE` / `✦ APPLY`, kept side-by-side on one row):

- **Whole-field buffs** (`TEAM_BUFFS`, no `target`): **ARM** from the Apply
  card. Armed buffs show as pills on the spot cards they affect
  (`buffAppliesToSpot`) and are listed in the Active card.
- **Targeted power-ups**: **APPLY** in the Apply card → enters apply-mode
  (`pendingApply`) → tap the target. All five go through the same flow:
  - `double-or-nothing` → tap a filled YOUR spot.
  - `bye-steal` → tap an empty box → bye-player picker.
  - `spy` (after lock, pre-kick) → tap any slot → reveal player OR metric.
  - `mulligan` (live) → tap a live YOUR spot → metric picker.
  - `emp` (live) → tap a live window header.
  Apply-mode highlighting lives in `SetupRow` (setup) and is wrapped around
  `ScoreRow` (live) in `WindowSection`; EMP highlights the window header.
- **Extra Slot** still uses the window header ADD/REMOVE buttons.
- **Active card** (`ActivePowerupsModal`) lists everything in effect with a
  back-out where still legal (disarm / clear / remove / refund). The standalone
  live "BuffStrip" list was removed — the Active card is the single source.
- Apply card (`ApplyPowerupsModal`) only shows power-ups usable right now,
  scoped to open windows, each tagged with its deadline.
- **Back-out / refund** exists for every power-up pre-lock (store `clear*` /
  `disarm*` / `removeExtraSlot` / `refundUnlock`).

## This session's work (newest first)
- `v0.9.5.10` Active/Apply chips forced side-by-side (equal-width, nowrap;
  labels shortened to ACTIVE / APPLY).
- `v0.9.5.9` **Scout**: tapping a sealed opponent spot in setup opens a card
  listing every opponent player whose game is in that window (the candidate
  pool). Shows the FULL pool — slotted players are NOT removed — so the actual
  pick never leaks by commission or omission. Pre-lock counterpart to Spy.
- `v0.9.5.8` Removed the live-header buff list (dup of Active card); restored
  per-spot power-up pills; edge-aligned the metric chip / total / drip coin to
  the inner (center-facing) edge of each `ScoreCard` (far-right your side,
  far-left opponent), identity/statline on the outer edge.
- `v0.9.5.5–.7` **Return Yards metric wired up for real** (see below).
- `v0.9.5.3–.4` Active/Apply chip split; Spy/Mulligan/EMP migrated into the
  tap-to-target apply flow; `TargetPanel` reduced to a Spy-intel readout.
- `v0.9.5–.2` Fixed power-up arming bug (`consumeAndApply` was dropping prior
  applied state); Double or Nothing / Bye Steal pills on spot cards.

## Return Yards — important data note
The `unlock-return` power-up's Return Yards metric is now real and fully wired:
- `src/data/metrics.ts`: `retyd` on WR + RB, a **drip** — return yards feed a
  `0.01/yd` rate that accrues over possession (3 returns of 10+ yds → hot, a
  short return cools). Wired through `dripKindOf(['return'])` in `sim.ts`.
- Real 2025 KR + PR pulled from the **Stathead MCP** (`get_play_by_play`,
  `play_type=kickoff|punt` + `player_ids`), with exact `qtr+time` clocks.
- Raw dumps live at `scripts/pbp/_ret_kr.jsonl` / `_ret_pr.jsonl`;
  `scripts/pbp/genReturns.mjs` aggregates them (weeks 1-14, via
  `crosswalk.json`) into `src/data/returns.ts` as exact-timed plays
  `slug -> { week: [[clock, yards] | [clock, yards, 1]] }`.
  Regenerate with: `node scripts/pbp/genReturns.mjs`.
- Engine emits return plays at their **exact game-elapsed second** (no
  synthesized timing), and folds them into the timeline **only when the slot's
  metric is `retyd`** (so a return TD never leaks into another metric's nuke /
  streak logic). `statlineAt` / `ScoreCard` take `metricId` for the same reason.

### Timing fidelity (a stated hard requirement)
For all 14 real weeks every metric resolves on the **real PBP clock** — base
plays were always baked from `qtr+time` (`scripts/pbp/genRealPbp.mjs`), and
returns now match. The only synthesized timing left is `buildPlays`, which only
fires for weeks/players with **no** real data (beyond week 14). If asked to make
the app *only ever* use real data, gate weeks 15+ out of selection rather than
touching real-week paths.

## Real play time — real-time power-up gating (v0.9.6.0)
Real-time power-ups (Metric Swap / Player Swap / Mulligan) are now gated on the
**real wall-clock time** a play happened, not the game clock the feed shows — so
a delayed feed can't be used to scoop a TD you already saw on TV. Wiring:
- `RealPlay.t?` (in `src/data/realPbp.ts`) and `RawPlay.t?` (in `sim.ts`) carry
  real seconds since the game's first snap. `sim.ts` exposes `realTimeAt()` /
  `clockAtRealTime()` to convert between a player's game-clock and real-time
  positions (linear interp between plays).
- `SlotSwap.atRt` (in `matchup.ts`) stamps activation with real time; the
  swap-split in `buildMatchup` maps `atRt` back to a cut-over game clock via the
  pre-swap player's timeline. Store actions (`applyMetricSwap` /
  `applyPlayerSwap` / `applyMulligan`) and the `Matchup.tsx` call sites pass it.
- **Graceful fallback:** when `t` is absent (data baked before this, return
  plays, synthesized weeks) `t` falls back to the game clock, so `realTimeAt` /
  `clockAtRealTime` are the identity and scoring is byte-identical to before.
  The real-time axis only changes outcomes once a delayed feed exists.

### Baking real `t` + `pid` — canonical pipeline (v0.9.6.2)
Every baked play (`public/pbp/wN.json`) and return (`src/data/returns.ts`)
carries `t` (real seconds since its game's first snap, from nflverse
`time_of_day`) and `pid` (nflverse `play_id`, a stable per-game key for future
live-feed gating). Both are baked **natively from a full re-pull** — each play
gets its OWN exact `time_of_day` (no interpolation, no same-second approximation).
- **Pull** (Stathead MCP `get_play_by_play` now returns a full week per call;
  over-cap results auto-save to `tool-results/*.txt`): for each week 1-14,
  `season=2025 week=W output_format=jsonl limit=4000` with the full field set
  incl. `play_id` + `time_of_day`. Split the saved results into per-game
  `scripts/pbp/raw/<game_id>.jsonl` (one game per file).
- **Generate:** `node scripts/pbp/genRealPbp.mjs` → `public/pbp/wN.json`
  (+ `realWeeks.ts`, `kdst_registry.json`); `node scripts/pbp/genReturns.mjs` →
  `returns.ts`. Both read `raw/` and bake `t`+`pid`. `raw/` and `expected.txt`
  are gitignored/regenerable; the shipped output is the committed artifact.
- **Verified:** re-attribution reproduces the prior validated scoring exactly
  (0/2878 player-weeks changed); returns match except 2 legit returns the old
  `_ret` dumps had missed. 100% `t`+`pid` coverage on all 32,728 plays + 388
  returns.
- The engine still falls back to the game clock wherever `t` is absent
  (`realTimeAt`/`clockAtRealTime` become the identity), so older/synthetic data
  keeps working.

## Playback clock modes (v0.9.7.5)
The live board's `⏱` button (by `RUN ALL`) cycles three playback clock modes,
held in `clockMode: 'game' | 'feed' | 'real'` on `Matchup`. Two axes are in
play: the **reveal** (which plays are visible now) and the **resolve/order**
(how the log orders+interleaves and how effects resolve):
- **GAME CLOCK** (`game`): lockstep game-clock reveal; log + effects on the game
  clock — the original behavior.
- **REAL FEED** (`feed`): real wall-clock **reveal** (each game runs at its own
  real pace via each play's baked `t`, so games desync), but the log still
  **orders/interleaves on the game clock** (game-clock stamps) and effects
  resolve on the game clock.
- **REAL CLOCK** (`real`): real reveal AND the log **orders/interleaves on the
  real clock** (wall-clock stamps via `fmtTimeShort`) and effects resolve in
  real-time order.

Wiring:
- `wallClock = clockMode !== 'game'` drives the real-time **reveal**:
  `winTarget = wallClock ? winRealMax : winMax` (ticker/seed/done/winLife);
  `winClocks[win]` is the window position (game secs, or real secs since kickoff).
  Per side, `clockAtRealTime(player, week, pos)` maps the window's real position
  back to that player's game clock; `ScoreRow` takes `youClock`/`theirClock`
  (banks, statline, log filter, coin all per-side). Totals sum each side at its
  own clock. Changing modes re-seeds positions to 0.
- `realClock = realResolve = clockMode === 'real'` drives **order + resolve**:
  passed to `ScoreRow.buildLog`, which (only in `real`) sorts each slot's log by
  per-event real time (`realTimeAt(sidePlayer, …)`) and stamps wall-clock time;
  `feed`/`game` keep the natural game-clock order. Same flag → `buildMatchup`:
  the only
  genuinely cross-game scoring effect is the **TE-TD drip nuke**
  (`teTdNukeClocks` now returns `{c, rt}` per nuke). Game-resolve fires it at its
  own game clock; real-resolve lands it on the RECEIVING player's game clock at
  the nuke's real time (`clockAtRealTime(recv, rt)`), so a nuke from a real-time
  desynced game hits at the right wall-clock moment. Per-play points and per-game
  mechanics (drip rate, garbage-time, FG mult, OT) are unchanged — no rebalance;
  only nuke-affected slots can differ between `feed` and `real`. `MatchupFinal`
  always uses game-resolve (canonical).

## Suggested next steps / open threads
- Decide whether **Scout** should cost something (a power-up / drip coin) or
  stay free intel — asked, not yet answered.
- Consider showing the candidate count on the sealed box itself.
- PBP source dumps (`raw/`, `rtdump/`, `expected.txt`) are gitignored/
  regenerable; only the baked `public/pbp/*.json` + `returns.ts` are committed.
  The old per-team/`_ret_*` dumps and `genRealtime.mjs` enrichment pass were
  removed once the canonical full-pull pipeline landed.
- Mobile passes are ongoing; keep testing `ScoreCard` at narrow widths.

## Gotchas
- The deploy can lag; confirm via the version chip + hard-refresh before
  trusting a screenshot. Old screenshots have caused false "still broken" reports.
- `applied[week]` is the source of truth for everything in-flight; the
  `consumeAndApply` helper must spread the existing week (regression fixed in
  v0.9.5 — don't reintroduce a partial rebuild).
- GitHub MCP tools (`mcp__github__*`) and Stathead MCP (`mcp__stathead__*`) are
  available via ToolSearch; scope is the `dachhack/ffgame` repo.
