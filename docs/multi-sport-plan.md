# Multi-sport plan — NBA · WNBA · NHL · MLB as native classic leagues

> _Assessed 2026-09-30. Founder: "What would it take for us to do hockey, NBA,
> MLB, WNBA fantasy … let's assume native leagues for all of these and no drip
> format." This is the assessment and the phased plan; v0.616.0 ships phase 1._

## 0. The verdict in one paragraph

The repo is two products glued together. The **league platform** (native
leagues, drafts, waivers, FAAB, trades, keepers, playoffs, guillotine, chat,
commissioner tools, coin) never reads a position or a stat and carries over
nearly intact. The **data spine** (positions, play vocabulary, windows,
week-keyed tables, the ESPN text parser) is football all the way down. With
native leagues only and no Drip, the work is: a one-time sport spine, a
box-score poller per sport, a scoring catalog per sport, daily lineup locks,
and one categories/roto engine. Data exists free for all four sports on
official or semi-official feeds, with the same non-commercial licensing
posture as ESPN today.

## 1. What reuses as-is

- Draft (snake, linear, auction, slow, lottery), waivers/FAAB with the daily
  4am run (0392), trades, keepers, taxi/IR, commissioner tools, chat, push,
  invites, coin.
- `native_generate_schedule(league, p_weeks)` (0064) already takes a week
  count; playoff start is a setting. NBA/NHL are 24–27 scoring weeks, MLB 26,
  WNBA ~20 with a two-week FIBA gap that behaves like a bye.
- Classic mode's shape: slot types as data, counts per type frozen at draft,
  per-position scoring overrides, weekly transaction limits, best ball, golf.
- Per-window locks. Classic seals one pseudo-window at the week's first
  game; a daily lineup is one pseudo-window per game day, and the trigger
  that rejects writes into a started window (0058) already exists.
- Everything downstream of a stat row: resolve, matchup state, realtime,
  boards, week reports, playoffs.

## 2. What changes

**The stat spine (phase 1, shipped v0.616.0)**

- No play-by-play. A classic league needs each player's line per game, and
  every other league's official feed publishes exactly that, live, as a box
  score. Non-NFL games are stored as cumulative per-game **stat lines**
  (`game_stat_line`, 0424): idempotent upserts, trivial true-up, no text
  parsing, no possession model.
- One **SportDef** per sport (`packages/core/src/sports/`): eligibility
  codes, feed-position map, slot types, default lineup, stat vocabulary,
  derived stats, default points table, categories, injury statuses, season
  shape. The NFL is in the registry for shape only; it keeps scoring through
  `engine/classic.ts`.
- **`league.sport`** (0424), default `'nfl'`. `sport_game` is the daily
  slate keyed `(sport, season, game_id)` — the bare `week` keys that
  `live_play`, `game_feed` and `nfl_slate` share are not extended to other
  sports (the college work's +200 week offset is the cautionary tale).
- **Player keys** are `<sport>-<feed id>` (`nba-1627759`), numeric ids only,
  the rule college's `c-<espn_id>` set, so they never collide with an NFL
  name slug.
- **Scoring** (`sports/score.ts`): points (Σ knob × stat, derived per game so
  a double-double counts per night), H2H categories (team FG% from summed
  makes and attempts; a ratio nobody registered is a tie), roto (best of N
  takes N, ties split places).
- **Adapters** (`server/src/sports/`), pure over the feed payloads, tested
  on real captures (`server/test/sports-adapters.mjs`); **poller**
  (`server/src/poll/sportGames.js`) gated on `SPORTS=nhl,mlb` so the NFL
  worker is unchanged when unset; CLI `sport-poll <sport> [date] [--force]`.

**v0.625.0 → v0.627.0 (after the first playtest)**: the board reads the
sport's own slate with the sport's words; 0433 keeps the NFL's controls
(Drip, golf, guillotine, contracts, the NFL builder, the bracket, the
after-games waiver hold) off a sport league and opens dynasty to it; the app
gets `ui/SportLineup`; delete returns to My Leagues; REPLAY leagues (0434)
play a past season on a shifted clock; the market (0435): FantasyPros ADP,
ESPN's season calendar, projections from last season's rate × games ahead.

**v0.622.0**: the lineup builder (0431 `set_sport_lineup`) and the sport player card.

**v0.621.0**: ten fixes from a code review (see STATUS.md).

**v0.620.0**: the NBA/WNBA schedule by date, sport leagues kept out of
auto-playoffs (0429), the mobile wire chips, `docs/multi-sport-review.md`.

**v0.619.0**: `set_sport_settings` + the SCORING page for a sport league;
injuries on the boards through `injury_status`.

**Phase 4 and the app (shipped v0.618.0)**: roto (`sport_roto`, the
worker's season table), slot eligibility enforced at the lock, names for
sport keys on both boards, the mobile create flow, draft chips and week
panel. Still open: MLB games-played and innings caps, period-aware playoffs, the
mobile commissioner's sport scoring and lineup pages, the mobile sport
player card.

**Phases 2–3 (shipped v0.617.0)**: the directory and rank (`sport_player`,
`seed_sport_pool`, `league_pool.eligible`), creation with a sport,
periods from 301, per-game locks (`sport_slot_lock` + the two triggers),
the worker's lock/score/final loop, the web create form, draft/wire chips
and `SportWeekPanel`. Roto, MLB caps, injuries beyond the directory, the
NBA/WNBA schedule by date, and the mobile screens are still open.

**Still to build (phases 2–4)**

- **Directory + pool seeding per sport**: `league_pool` rows from the feed's
  roster/directory, with eligibility as a LIST (SG/SF, LW/RW, 1B/OF — the
  NFL has one position per player and the schema assumes it). Rank from
  prior-season stats under the league's own scoring (no free licensed ADP
  exists for these sports), with a commissioner override for rookies.
- **Daily lineups**: one lock per game day; edit window between games;
  projections = season averages × games that week (the core lineup skill in
  NBA/NHL).
- **Classic per sport**: `create_native_league` takes a sport; slot types
  and scoring defaults from the SportDef; injury vocabulary per sport; stat
  labels and position pills across Matchup / NativeLeague / ClassicBoard and
  mobile; a resolver that reads `sport_lines_for` instead of `live_play`.
- **Categories/roto leagues**: a matchup verdict of "6-3-0" rather than a
  score; roto standings across the league; MLB positional games-played caps
  and innings minimums/maximums; probable-pitcher awareness for two-start
  weeks.
- **Injuries** per sport (NBA official report is a PDF; ESPN's hidden
  endpoint for NBA/NHL/WNBA; MLB's IL transactions are official).
- **NBA/WNBA schedule by date** (the live CDN only knows today; the season
  schedule file is the source) and headshots (mark-free badges exist).

## 3. Data by sport (measured 2026-09-30 from the build container)

| Sport | Directory + schedule | Live and final box scores | Injuries | Prior-season stats | Reachable here |
|---|---|---|---|---|---|
| **MLB** | statsapi.mlb.com, official, no key | statsapi live feed (`/feed/live`, diffPatch for increments) | Official IL transactions | statsapi people stats | ✅ 200 |
| **NHL** | api-web.nhle.com rosters and `/schedule/{date}` | `/gamecenter/{id}/boxscore` (TOI, goalie lines); PPA/SHA/GWG from `/landing` | No official feed; ESPN hidden endpoint | api-web player landing / stats REST | ✅ 200 (follow the 307) |
| **NBA** | cdn.nba.com static schedule; rosters via ESPN or Sleeper `/players/nba` | cdn.nba.com liveData boxscore — browser headers required | Official report is a PDF; ESPN hidden endpoint | stats.nba.com blocks cloud hosts — bake once from a residential machine, or balldontlie | ❌ 403 (Akamai) |
| **WNBA** | ESPN hidden rosters/scoreboard | cdn.wnba.com liveData (same shape as NBA) or ESPN summary | ESPN hidden endpoint | stats.wnba.com, same cloud block | ❌ HTML error page |

Every official feed is non-commercial by its terms — the same posture as
ESPN today (`data-feed-options.md`). SportsDataIO covers all four if the
project monetizes; balldontlie's paid tier covers NBA/WNBA/MLB/NHL box
scores; Goalserve bundles NBA/MLB/NHL.

The NBA/WNBA adapter is written against the documented liveData shape
(nba_api's boxscore reference) and tested on its sample; it needs a capture
from a host the CDN admits before it is trusted live.

## 4. Formats worth shipping

| Sport | Formats | Default lineup (Yahoo/ESPN standard) | Lineups |
|---|---|---|---|
| NBA | H2H points, H2H 9-cat | PG SG G SF PF F C C UTIL UTIL · 3 BN · 3 IL | Daily |
| NHL | H2H points, H2H categories | 2C 2LW 2RW 4D 2G · 4 BN · 2 IR | Daily, goalie starts matter |
| MLB | Roto 5x5, H2H categories, H2H points | C 1B 2B 3B SS 3 OF 2 UTIL · 2 SP 2 RP 4 P · 5 BN · 4 IL | Daily, GP and IP caps |
| WNBA | H2H points (ESPN's only format) | 2 G · 3 F/C · UTIL · 3 BN · 1 IR | Weekly or daily |

Default points tables (in each SportDef): NBA = Yahoo (PTS 1, REB 1.2, AST
1.5, STL 3, BLK 3, TO −1); WNBA = ESPN (PTS 1, REB 1, AST 1, STL 2, BLK 2,
3PM 1); NHL = Yahoo (G 6, A 4, +/- 2, PPP 2, SOG 0.9, BLK 1; W 5, GA −3, SV
0.6, SHO 5); MLB = DraftKings-style (1B 3, 2B 5, 3B 8, HR 10, R 2, RBI 2, BB
2, HBP 2, SB 5; 0.75/out, K 2, W 4, ER −2, H/BB/HBP −0.6, CG/SHO 2.5, NH 5)
plus SV 5, HLD 2.

## 5. Order and calendar

| Step | Size |
|---|---|
| Sport spine (this) | Largest — comparable to the native-leagues build; phase 1 is the data half |
| Box-score poller per sport | Small–medium each (far smaller than the ESPN play parser) |
| Pool seeding + classic per sport | Medium each |
| Daily locks + categories/roto engine + MLB caps | Medium–large, once |
| WNBA on top of NBA | Small increment |

The draft calendar matters more than the market ranking. NBA tips Oct 20
and the NHL started Sep 29, so full-season native leagues for both target
October 2027. The next real draft windows are **MLB in March 2027** and
**WNBA in May 2027**. Sequence: spine now (done), pollers for NHL/MLB
running against the live seasons to harden the data path, an NBA
second-half pilot league in January 2027 to shake out daily locks, MLB with
the categories engine for March 2027 drafts, WNBA in May, then NHL and NBA
full seasons in the fall. The one external risk on that path is the MLB CBA
expiring December 1, 2026, with a lockout widely expected.

## 6. Running it

```bash
# worker: carry NHL and MLB alongside the NFL
SPORTS=nhl,mlb npm start          # server/, plus the usual Supabase env
# one day, by hand
node src/cli.js sport-poll nhl 2026-09-29
node src/cli.js sport-poll mlb              # today (ET)
# checks
npm run check:sports              # core defs + scorer, adapters on fixtures, poller
```
