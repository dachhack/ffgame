# Multi-sport — the morning review

> _Written 2026-09-30 overnight, on branch `ccr-e05744f1-ro7jlw`; renumbered
> onto main 2026-10-04 (v0.624.0). Main had taken the same numbers while the
> branch was cut, so the branch's migrations are 0424 → 0432 (0396 → 0404
> below in the commit history) and its versions v0.616.0 → v0.623.2._

## What is on the branch

Five commits, one per version, each with a STATUS.md entry:

| Version | What |
|---|---|
| v0.616.0 | The sport spine: SportDefs, the stat-line scorer, 0424 (`league.sport`, `sport_game`, `game_stat_line`), NHL / MLB / NBA-WNBA box-score adapters, the poller |
| v0.617.0 | The directory and rank (0425 `sport_player`, `league_pool.eligible`), creation with a sport, periods from week 301, per-game locks (0426), the worker's lock → score → final loop, the web create form, draft chips, `SportWeekPanel` |
| v0.618.0 | Roto (0427), eligibility enforced at the lock, names for sport keys on both boards, the mobile create flow, draft chips and week panel |
| v0.619.0 | The commissioner's sport scoring page (0428 `set_sport_settings`), injuries on the boards |
| v0.620.0 | NBA/WNBA schedule by date, sport leagues kept out of auto-playoffs, the mobile wire chips, this note |
| v0.621.0 | Ten fixes from a code review of the branch (the sweep's retirement pass, pools following trades, WNBA team codes, postponements, mid-draft leagues, doubleheaders, stuck games, cadence, reads per tick, pills) |
| v0.622.0 | The lineup builder for sport leagues (0431), the sport player card |
| v0.622.1 | Ten fixes from a second review pass (the card's season numbers and ratios, DNP, the headshot, last-ten ordering, the builder's rounds and frozen state) |
| v0.623.0 | The `sports` feature flag (0432): sport leagues for flag holders and admins only |

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
   points per stat) instead of the football catalog; LINEUP is
   `SportLineup`, counts per slot type plus bench and IR, until the draft.
5. Click any sport player: `sportCard.tsx` — eligibility pills, season
   per-game numbers, the last ten games scored under the league's table.

**Mobile** (`apps/mobile`, `npm run typecheck` is clean): the same create
flow in Recruit (WHICH SPORT, scoring, first week ± a week), the draft's
chips, and `ui/SportWeekPanel` on the classic board. Not done on mobile:
the commissioner's sport scoring page.

## What it takes to run

1. **Migrations 0424 → 0432**, in order — `DATABASE_URL=... scripts/apply-sport-migrations.sh` does it, and a merge to main runs them through `migrate.yml` (added files only, sorted) without a click. All of them applied cleanly on a
   local Postgres 16 with Supabase shims (`auth.uid()` etc.), alongside
   every earlier migration. 0426 **drops and recreates
   `create_native_league`** with two trailing defaulted arguments; every
   existing caller keeps working (the blueprint check pins this).
2. **The worker** with `SPORTS=nhl,mlb` (or `nba`, `wnba`) in its env — `fly.toml` carries `nhl,mlb`, and a merge to main redeploys it through `deploy-worker.yml`.
   Unset, it is byte-for-byte the NFL worker. With it: a directory sweep at
   boot and daily (`sport_player` + injuries), and a self-paced game loop
   (a minute while a game is live, ten when none, waking for the next
   tip-off) that fills `sport_game` / `game_stat_line`, locks starters at
   tip-off, scores live matchups and stamps finals the day after a period.
   CLI: `sport-dir <sport>`, `sport-poll <sport> [date]`, `sport-leagues
   <sport>`.
3. A sport league needs its directory swept first — creation refuses with
   "no NBA players in the directory yet" otherwise.
4. **The flag.** Sport leagues are behind `has_sports()`: admins pass, and
   anyone else needs `select admin_set_feature('email', 'sports', true)`.
   Nobody without it sees the WHICH SPORT chips or can create one, so the
   branch can merge and deploy with the NFL product unchanged for everyone
   else.

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
  leagues (v0.620.0) — period-aware playoffs are not built.
- **Lineup UI honours the primary position only**; the worker's lock
  honours the full eligibility list. A player the UI let into a slot he
  may not fill never locks (logged), so he scores 0 there.
- **MLB games-played and innings caps** are not modelled.
- **Basketball ids** crosswalk by name + team between Sleeper/ESPN
  directories and nba.com box scores; a trade is picked up by the next
  daily sweep, which also moves the player's team in every league pool.

## Suggested next steps

1. Apply the migrations to a staging project; run the worker with
   `SPORTS=nhl,mlb` for a day and read `sport_game` / `game_stat_line`.
2. Create an NHL test league (the season is live now) with a Monday start
   this week, draft it with two humans, and watch a night: locks at puck
   drop, the panel's lines, the morning's final.
3. Then decide the order of the open items above.
