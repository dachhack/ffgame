# Sport fixtures — the days Stathead's shadow read should serve

Every fixture here was captured from a public feed while the daily-sport
adapters were built (v0.616.0 → v0.629.1). For the shadow-read week, Stathead
serves the same days through `/v1/{sport}/games?date=` and
`/v1/{sport}/games/{game_id}/lines`; `npm run check:sports` then asserts the
two agree (`docs/stathead-shadow-read.md`). `days.json` is the same list for a
script.

| Sport | Day (US Eastern) | Game | Fixture | What it stands for |
|---|---|---|---|---|
| NHL | 2026-09-29 | the slate (5 games) | `nhl-schedule-2026-09-29.json` | `api-web.nhle.com/v1/schedule/2026-09-29` |
| NHL | 2026-09-29 | 2026020002 MTL @ TOR, final | `nhl-box-final-2026020002.json`, `nhl-landing-final-2026020002.json` | box score + landing (PPA/SHA/GWG off the scoring summary) |
| NHL | 2026-09-29 | 2026020003 NYR @ BOS, live snapshot | `nhl-box-live-2026020003.json` | an in-progress box score (TOI, goalie lines) |
| NHL | 2025-26 season | — | `nhl-skaters-20252026-sample.json`, `nhl-goalies-20252026-sample.json`, `nhl-realtime-20252026-sample.json` | stats REST season reports, sampled rows |
| NHL | all seasons | — | `nhl-bios-skaters-sample.json`, `nhl-bios-goalies-sample.json` | bios (first season → tenure), the Bruins' rows |
| NHL | 2026-09-30 | — | `nhl-roster-bos.json`, `nhl-standings-sample.json` | a roster and the 32-team standings |
| MLB | 2026-09-29 | the slate (4 games) | `mlb-schedule-2026-09-29.json` | `statsapi.mlb.com/api/v1/schedule?date=2026-09-29` |
| MLB | 2026-09-29 | 849845 PHI @ ATL, final | `mlb-box-final-849845.json` | box score (hitting + pitching lines) |
| MLB | 2026-09-29 | 849851 BOS @ NYY, live snapshot | `mlb-live-849851.json` | the live feed mid-game |
| MLB | 2026 season | — | `mlb-hitting-2026-sample.json`, `mlb-pitching-2026-sample.json`, `mlb-fielding-2026-sample.json` | season leaderboards (fielding → position eligibility) |
| MLB | 2026 | — | `mlb-players-2026-sample.json`, `mlb-players-sample.json`, `mlb-teams-2026.json`, `mlb-roster-40man-147.json` | the players list, teams, the Yankees' 40-man (IL codes) |
| NBA | 2021-01-15 | 0022000180 ORL @ BOS, final | `nba-box-doc-0022000180.json` | the league CDN's box score shape (a documented sample game) |
| NBA | 2025-26 season | — | `sleeper-nba-sample.json`, `sleeper-nba-stats-2025-sample.json` | Sleeper's directory (ids, years_exp) and season stats |
| NBA, NHL, MLB | 2026-10-04 | — | `fp-adp-{nba,nhl,mlb}.html` | FantasyPros ADP pages, as parsed |
| NBA, NHL, MLB | 2026-27 / 2026 | — | `espn-schedule-{fba,fhl,flb}.json` | ESPN fantasy season calendars |

Not in this folder but exercised while building: MLB 2025 replay days (the
replay dry run read 2025-09-28's slate and finals through the live feed), the
local Postgres' NBA 2026-09-29 DEN @ LAL preseason game, and the full NHL
bios (3,145 players) and 32 current rosters probed for tenure coverage.

For soccer there are no fixtures yet: the Premier League and MLS joined the
spine (v0.630.0) ahead of any data. The first Stathead days we read for them
become the fixtures.
