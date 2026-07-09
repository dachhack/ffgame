# Drip League FF — Session Handoff

_Last updated: 2026-07-09 · Build `v0.116.0`_

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
  `marshal` banks its normal flat points AND builds a live, window-wide SHIELD on
  its own side: cumulative splash production (sk1/int3/fr2/def-TD6/safety2) ramps a
  damage-reduction fraction (`SHIELD_RATE` 0.04/pt, cap `SHIELD_CAP` 0.5) that
  BLUNTS every opposing nuke and erase against all its window's slots. Built by
  `windowShield()` (mirrors `windowFgMult`'s shape), wired at both resolve sites via
  `resolveSlot` opts `youShield`/`theirShield`; the wipe/erase keep a shielded
  fraction of the bank (log shows "🛡 SHIELD kept …" / "🛡 N% blunted").
- **RIVALRY (WR/RB metric `duel`) — a same-slot grudge match.** Flat yardage base
  (0.1/yd + 6/TD); at the top of each quarter the side LEADING siphons a quarter
  (`DUEL_SIPHON` 0.25) of the trailing side's gains for that whole quarter — but
  only the side that FIELDED the duel siphons, so it snowballs a lead and does
  nothing when behind (pick it when you back the slot). Own family in
  `familyOf`; siphon hooks both per-play scoring and drip accrual. EXCLUDED from
  `bestMetric`/`bestVsThreats` (human-only, like `fg`), so default/AI lineups
  never auto-field it and the tuned wheel is preserved. Measured: middling
  win-rates, beats denial metrics, loses to high-ceiling drips — a real
  specialist, not dominant.
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
