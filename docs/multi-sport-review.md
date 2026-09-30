# Multi-sport — the morning review

> _Written 2026-09-30 overnight, on branch `ccr-e05744f1-ro7jlw` (v0.564.0 →
> v0.568.0). Nothing is merged; the web and the app are yours to review._

## What is on the branch

Five commits, one per version, each with a STATUS.md entry:

| Version | What |
|---|---|
| v0.564.0 | The sport spine: SportDefs, the stat-line scorer, 0396 (`league.sport`, `sport_game`, `game_stat_line`), NHL / MLB / NBA-WNBA box-score adapters, the poller |
| v0.565.0 | The directory and rank (0397 `sport_player`, `league_pool.eligible`), creation with a sport, periods from week 301, per-game locks (0398), the worker's lock → score → final loop, the web create form, draft chips, `SportWeekPanel` |
| v0.566.0 | Roto (0399), eligibility enforced at the lock, names for sport keys on both boards, the mobile create flow, draft chips and week panel |
| v0.567.0 | The commissioner's sport scoring page (0400 `set_sport_settings`), injuries on the boards |
| v0.568.0 | NBA/WNBA schedule by date, sport leagues kept out of auto-playoffs, the mobile wire chips, this note |

The plan and the assessment behind it: `docs/multi-sport-plan.md`.

## What to look at first

**Web** (`npm run dev`):
1. `Start a fresh league` → WHICH SPORT is the first question. Pick NBA:
   the game question disappears (a daily sport is CLASSIC), SCORING offers
   POINTS / CATEGORIES / ROTO, and the first week's Monday and the week
   count appear. Dynasty, contracts, guillotine and vampire are hidden for
   a sport league. The roster note describes the sport's standard lineup.
2. The draft room and the wire: position chips are the sport's (PG SG SF PF
   C), the pool is ranked by last season's production.
3. The classic board of a sport league: `SportWeekPanel` above the lineup —
   the period's dates, both seats' locked slot-days with points, the
   category grid or the roto table, today's slate. Position pills borrow a
   football colour family per code (`src/app/ui.tsx` POS_FAMILY).
4. COMMISH → SCORING on a sport league: `SportSettings` (format, categories,
   points per stat) instead of the football catalog; LINEUP explains the
   standard shape (no builder yet).

**Mobile** (`apps/mobile`, `npm run typecheck` is clean): the same create
flow in Recruit (WHICH SPORT, scoring, first week ± a week), the draft's
chips, and `ui/SportWeekPanel` on the classic board. Not done on mobile:
the commissioner's sport scoring page.

## What it takes to run

1. **Migrations 0396 → 0401**, in order. All of them applied cleanly on a
   local Postgres 16 with Supabase shims (`auth.uid()` etc.), alongside
   every earlier migration. 0398 **drops and recreates
   `create_native_league`** with two trailing defaulted arguments; every
   existing caller keeps working (the blueprint check pins this).
2. **The worker** with `SPORTS=nhl,mlb` (or `nba`, `wnba`) in its env.
   Unset, it is byte-for-byte the NFL worker. With it: a directory sweep at
   boot and daily (`sport_player` + injuries), and a self-paced game loop
   (a minute while a game is live, ten when none, waking for the next
   tip-off) that fills `sport_game` / `game_stat_line`, locks starters at
   tip-off, scores live matchups and stamps finals the day after a period.
   CLI: `sport-dir <sport>`, `sport-poll <sport> [date]`, `sport-leagues
   <sport>`.
3. A sport league needs its directory swept first — creation refuses with
   "no NBA players in the directory yet" otherwise.

## What was verified, and how

- `npm run check:sports` (in `check:parity`, which is green): the
  definitions and scorer, the adapters on real captures (NHL opening night
  2026-09-29 and the MLB postseason) and the documented NBA sample, the
  poller's date and re-read rules, the directories (NHL stats REST, MLB
  leaderboards + 40-man rosters, Sleeper NBA + its season stats, ESPN WNBA
  roster shape), the rank, the basketball crosswalk, the lock / score /
  final pure functions, the roto table, and a chainable fake Supabase
  running lock → score → final end to end.
- A live dry run of the poller against the real NHL and MLB feeds wrote 9
  games and ~250 lines, four of them in progress.
- A SQL scenario on the local Postgres: created an NBA league from fixture
  players (28-player pool, 18 with multiple eligibilities), generated a
  301+ schedule, set both lineups, saw the tip-off lock refuse a started
  player's swap and drop while an idle one moved, read lines for both
  seats, counted the final in standings, and exercised
  `set_sport_settings` (junk dropped, format locked once live, the date
  normalised to its Monday).
- `npm run typecheck`, `npm run build` and the app's `tsc --noEmit` are
  clean.

## Known gaps and risks

- **NBA / WNBA feeds are unverified live.** cdn.nba.com and cdn.wnba.com
  refuse this build container (Akamai), so the box-score and schedule
  parsers run on the documented shape only. First thing to try from a
  host they admit: `node src/cli.js sport-poll nba`.
- **Licensing.** Every official feed is non-commercial by its terms — the
  same posture as ESPN today (`docs/data-feed-options.md`).
- **The NFL worker's week-keyed loops** never see weeks 301+, by design;
  `lockDueMatchups` with a null week selects by `lock_at`, and a sport
  matchup has none until it is already live. Auto-playoffs skip sport
  leagues (v0.568.0) — period-aware playoffs are not built.
- **Lineup UI honours the primary position only**; the worker's lock
  honours the full eligibility list. A player the UI let into a slot he
  may not fill never locks (logged), so he scores 0 there.
- **No lineup builder for daily sports**; the standard shape is fixed at
  creation. `set_league_classic_slots` whitelists NFL positions.
- **MLB games-played and innings caps** are not modelled.
- **The player card** shows NFL stats; a sport player's card is empty.
- **Basketball ids** crosswalk by name + team between Sleeper/ESPN
  directories and nba.com box scores; a fresh trade before the next
  sweep misses until the sweep moves the team.

## Suggested next steps

1. Apply the migrations to a staging project; run the worker with
   `SPORTS=nhl,mlb` for a day and read `sport_game` / `game_stat_line`.
2. Create an NHL test league (the season is live now) with a Monday start
   this week, draft it with two humans, and watch a night: locks at puck
   drop, the panel's lines, the morning's final.
3. Then decide the order of the open items above.
