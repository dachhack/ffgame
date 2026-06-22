# Stathead (MCP) data requests

Stathead is the data backbone for this app — full play-by-play (`play_id` +
`time_of_day`), season/weekly stats, injuries, rosters, and the id crosswalk all
come from it. This file tracks the fields/ergonomics we still work *around*, each
of which leaves a wired-but-dormant or hand-stitched path in the pipeline that
gets simpler once Stathead serves it natively.

Status legend: ✅ done · 🟡 works via a workaround we'd like to drop · 🔴 missing.

---

## Message to the MCP team

> **Subject: NFL data requests from the Drip League FF build**
>
> Stathead MCP is doing the heavy lifting for our app — PBP with `play_id` +
> `time_of_day`, season/weekly stats, injuries, rosters, and the player
> crosswalk. Thank you; the `time_of_day`/`play_id` and turnover additions
> directly unlocked features for us. A few requests, roughly in priority order:
>
> 1. **Complete `espn_id` in `get_player_crosswalk`, including in-season
>    rookies.** Today it returns empty `espn_id` for fresh 2025 rookies (we hit
>    blanks on e.g. `00-0038502` and Caden Prieskorn), which forces us to fall
>    back to nflverse roster files for headshots. Fresh/complete `espn_id` (and,
>    if easy, the canonical ESPN headshot URL) would let us source headshots from
>    Stathead alone. `sleeper_id` coverage there is great — keep it complete.
> 2. **First-class return fields in `get_play_by_play`:** `return_yards`,
>    `kick_returner_player_id` / `punt_returner_player_id`, and a `fair_catch`
>    flag. We currently filter `play_type=kickoff|punt` + `player_ids` and infer
>    yardage/returner from there.
> 3. **Exact fumble attribution:** `fumbled_1_player_id` +
>    `fumble_recovery_1_player_id` (and forced-by). We attribute by play role
>    today, which can't resolve multi-player fumbles.
> 4. **Schedule with kickoff datetime + byes** via `get_games`: per-game
>    scheduled kickoff (ET) and clean home/away/week so we can derive the
>    day/time windows and bye weeks from Stathead instead of nflverse.
> 5. **Large-payload ergonomics for week-level PBP:** a cursor/pagination, a
>    single-`game_id` filter, a slimmer default field projection, or gzip. A full
>    week overflows the tool cap, auto-saves to a file, and we split it per game
>    by hand.
> 6. **(Nice-to-have) a small hosted runtime crosswalk JSON**
>    (`sleeper ↔ gsis ↔ espn ↔ name/pos/team/headshot`). We download Sleeper's
>    full ~5 MB player directory client-side just to map ids at runtime; a slim
>    hosted file would replace that.
>
> Happy to share exact request payloads / sample responses for any of these.

---

## Message to the MCP team — IDP (individual defensive players)

> **Subject: Per-defender play-by-play fields for IDP support**
>
> We're adding IDP (individual defensive player) league support, and the one
> thing blocking real scoring is **per-defender attribution in
> `get_play_by_play`**. Today defensive events only come through aggregated by
> `defteam`, so we can build team DST but not individual defenders. These are all
> standard nflverse PBP columns, so it should be a quick add:
>
> - **Tackles:** `solo_tackle_1_player_id`, `solo_tackle_2_player_id`,
>   `assist_tackle_1_player_id` … `assist_tackle_4_player_id` (tackles are the
>   bulk of IDP scoring — the most important and the messiest, multiple per play).
> - **Tackles for loss:** `tackle_for_loss_1_player_id`,
>   `tackle_for_loss_2_player_id`.
> - **Pressure:** `sack_player_id`, `half_sack_1_player_id`,
>   `half_sack_2_player_id`, `qb_hit_1_player_id`, `qb_hit_2_player_id`.
> - **Coverage / takeaways:** `interception_player_id`,
>   `pass_defense_1_player_id`, `pass_defense_2_player_id`,
>   `forced_fumble_player_1_player_id`, `forced_fumble_player_2_player_id`,
>   `fumble_recovery_1_player_id`.
> - **Scores:** `td_player_id` (so we can credit a defensive/ST TD to the
>   defender, not just the team) and the safety credit if available.
>
> With these per-play defender ids (each resolvable via the existing
> `get_player_crosswalk`), we can bake real defenders exactly the way we bake
> offense today — on the real clock, attributed per player. Until then we can
> only synthesize IDP texture from weekly point totals.
>
> Also: please extend `get_player_crosswalk` (and `espn_id` coverage) to
> **defensive positions** (DL/LB/DB and their sub-positions) — today we filter
> the crosswalk to skill players, and the IDP universe roughly triples the player
> count.

---

## Request list

### 1. Per-player turnovers (INT thrown / fumble lost) — ✅ DONE
`get_play_by_play` exposes `interception` and `fumble_lost` per play. The baker
(`scripts/pbp/genRealPbp.mjs`) attributes them by play role — INT → passer;
fumble lost → rusher (run) / receiver (catch) / passer (sack) — and writes a
`to: 1` flag in `public/pbp/wN.json`. `turnoversCommitted()` (`src/engine/sim.ts`)
counts them; the turnover line in `weekEarnings` is live.

### 2. ESPN `espn_id` for all current players (incl. rookies) — 🔴 MISSING
**Why:** slug → `espn_id` to render player headshots for every rostered player.

**Workaround:** `scripts/pbp/genHeadshots.mjs` joins `crosswalk.json` against
**nflverse** `players.csv` + `roster_2025.csv` for `gsis_id → espn_id`; at
runtime `src/data/buildLeague.ts` reads `espn_id` from Sleeper's ~5 MB directory.

**Evidence:** `get_player_crosswalk(fields=gsis_id,espn_id)` returns empty
`espn_id` for several 2025 rookies (e.g. `00-0038502`, `caden-prieskorn`) that
nflverse's weekly roster file already has.

**Ask:** complete + fresh `espn_id` in `get_player_crosswalk` (rookies included);
optionally return the canonical ESPN headshot URL too.

### 3. Return yards + returner ids + fair-catch — 🟡 WORKAROUND
**Why:** the **Return Yards** drip metric (returns feed a drip rate; a
short/fair-catch return now cools the HOT streak — see `src/engine/sim.ts`).

**What we have:** we pull `play_type=kickoff|punt` + `player_ids` and read
`yards`/`qtr`/`time`; `scripts/pbp/genReturns.mjs` aggregates into `returns.ts`.

**Ask:** first-class `return_yards`, `kick_returner_player_id` /
`punt_returner_player_id`, and a `fair_catch` (or 0-yard) flag, so we don't
filter by `play_type` and infer.

### 4. Exact fumble attribution — 🟡 WORKAROUND
**Why:** precise per-player fumble/recovery credit (multi-player fumbles).

**What we have:** play-role attribution (see item 1) because the dumps carry no
`fumbled_1_player_id`.

**Ask:** `fumbled_1_player_id`, `fumble_recovery_1_player_id` (and forced-by).

### 5. Schedule / slate — kickoff datetime + byes — 🟡 WORKAROUND
**Why:** bucket each game into the TNF / SUN-1 / SUN-4 / SNF / MNF windows and
know team bye weeks (`src/data/nflSlate.ts`).

**What we have:** nflverse schedule.

**Ask:** confirm/expose per-game scheduled kickoff datetime (ET) + clean
home/away/week in `get_games` so the slate can come from Stathead alone.

### 6. Week-level PBP payload ergonomics — 🟡 WORKAROUND
**Why:** baking a week of real PBP (`scripts/pbp/genRealPbp.mjs`).

**What we have:** a full-week `get_play_by_play` overflows the tool cap,
auto-saves to `tool-results/*.txt`, and we split it per `game_id` into
`scripts/pbp/raw/<game_id>.jsonl` by hand.

**Ask:** native cursor/pagination, a single-`game_id` filter, a slimmer default
field projection, and/or gzip — so a stable per-game fetch removes the manual
split.

### 7. Hosted runtime id/headshot crosswalk — 🔵 NICE-TO-HAVE
**Why:** at runtime the app maps Sleeper `player_id → {name, pos, team, espn_id}`
to build a live league and show headshots.

**What we have:** the app downloads Sleeper's full ~5 MB `players/nfl` directory
client-side (`src/data/sleeperPlayers.ts`).

**Ask:** a small hosted JSON (`sleeper ↔ gsis ↔ espn ↔ name/pos/team/headshot`)
we could fetch at runtime to replace the 5 MB download. (MCP is build-time, so
this is a "Stathead as a small data CDN" idea rather than an MCP tool.)

### 8. Per-defender PBP attribution (IDP) — 🔴 MISSING (gates real IDP)
**Why:** IDP league support — scoring individual defenders (DL/LB/DB) on
tackles, sacks, TFL, QB hits, INTs, passes defended, forced fumbles, recoveries,
and defensive/ST TDs.

**What we have:** `genRealPbp.mjs` attributes defense to the **team** only
(`{team}-dst`, keyed by `defteam`); no per-defender ids exist in the pipeline.

**Ask (standard nflverse PBP columns):**
- Tackles: `solo_tackle_1_player_id`, `solo_tackle_2_player_id`,
  `assist_tackle_1_player_id`…`assist_tackle_4_player_id`.
- `tackle_for_loss_1_player_id`, `tackle_for_loss_2_player_id`.
- `sack_player_id`, `half_sack_1_player_id`, `half_sack_2_player_id`,
  `qb_hit_1_player_id`, `qb_hit_2_player_id`.
- `interception_player_id`, `pass_defense_1_player_id`,
  `pass_defense_2_player_id`.
- `forced_fumble_player_1_player_id`, `forced_fumble_player_2_player_id`,
  `fumble_recovery_1_player_id`.
- `td_player_id` for defensive/ST TD scorer credit.
- Plus: extend `get_player_crosswalk` + `espn_id` to defensive positions
  (DL/LB/DB and sub-positions) — the IDP universe ~triples the player count.

**Interim:** until this lands, IDP players are scored by synthesizing texture
from their weekly Sleeper point totals (Phase 1), not real per-defender plays.
