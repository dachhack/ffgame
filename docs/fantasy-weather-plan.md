# Fantasy Weather — what it would take

> _Assessed 2026-10-05, the day after `fantasy-congress-plan.md`, to the same
> question: "What about fantasy weather?" Assessment and a phased plan;
> nothing ships with it._

## 0. The verdict in one paragraph

Two games hide behind the phrase. **Draft cities and score their weather**
fits the daily-sport spine better than any league sport does: a station's
day *is* a box-score line (high, low, rain, snow, gust), it updates hourly
from live observations, it is final at local midnight, there is a game
every single day, the whole history exists for replay, and — unique among
our sports — a real projection exists for free: the forecast. The data is
NOAA's, public domain, and every feed answered from this container. The
other game, **forecasting contests** (call tomorrow's high, score by error),
is a pick'em, not a roster game; it does not ride the spine and belongs, if
anywhere, on the matchup board's coin picks later. This plan is the first
game. Three to five sessions to a playable replay league; the design
decision that matters is scoring by *departure from normal* rather than raw
extremes, or the draft is Phoenix, Utqiaġvik, Hilo and done.

## 1. What reuses as-is

Everything the Congress plan lists in its §1: the platform, the spine, the
four formats, scoped and best-ball spots, replay, the provider switch. Two
things reuse *better* here than for any league sport:

- **Live scoring.** Hourly observations make the day's line move all day
  (running high, running rain total), and the day closes at a known time.
  The loop's tight-while-live cadence is exactly right.
- **Replay.** Open-Meteo's archive and NOAA's daily summaries carry every
  past day; a league can replay the 2024 hurricane season or the January
  2025 cold wave on the shifted clock with no adapter changes.

Nothing reuses worse except the fields widget, which lists games.

## 2. The model — a station's day is a game

| Spine concept | Weather |
|---|---|
| sport id | `wx` |
| season | the calendar year; weeks from the commissioner's `period_start`, ~26 by default (no off-days exist, so a season is whatever length the league wants) |
| player | a reporting station — Boston Logan, Phoenix Sky Harbor, Denver, Hilo… ~300 US first-order stations to start (the ones that issue a daily climate report), world later |
| player key | `wx-<WBAN>` — the five-digit WBAN number inside the GHCN id (`USW000`**`14739`**), numeric as `playerKey` requires; ICAO (`KBOS`) in `ext_id` |
| team | the region (`NE`, `SE`, `MW`, `SP`, `SW`, `NW`, `W`, `AK`, `HI`), so a `teams`-scoped spot is "West Coast only"; state as a `states` scope later (the Congress plan's phase 4) |
| positions | climate class from Köppen, the lineup's structure: `DES` desert · `TRP` tropical · `MAR` marine · `MED` mediterranean · `HUM` humid subtropical · `CON` continental · `ALP` alpine / polar |
| default lineup | 1 DES · 1 TRP · 1 MAR · 1 HUM · 2 CON · 2 FLEX, 4 BN, 1 IR — a proposal |
| game | one per region per day: `game_id` `2026-10-05-NE`, `home` the region, `away` `''`, `start_utc` midnight Eastern (lineups for the day close at midnight the night before, one rule for everyone) |
| game status | `live` through the day · `final` an hour after the last local midnight in the region |
| stat line | the station's day, cumulative, with the day's normals carried on the line (`ntmax`, `ntmin`) so `derive` can compute departures — the way a soccer line carries `posn` |
| period | the Mon–Sun week, as every daily sport; every week is a full week |
| tenure | none (`sportHasTenure` false); a "first year in the pool" rule is meaningless |
| injury | a station that stops reporting is `OUT` (sensor or comms outage); a scratch after the lock scores 0, as the spine already does |
| vocab | start "midnight", starts "turns midnight", started "turned midnight", slate "TODAY'S WEATHER", noGame "no report today" |

Why a game per region and not one per station: the lock and the slate
need a `sport_game` row per team per day; 300 rows a day is fine for the
database but turns every games-list screen into a wall. Regions give
nine rows a day and a sane opponent column ("NE · in play"). Why the lock
is midnight Eastern rather than each station's local midnight: one deadline
is explainable; per-station deadlines would have Hawaii's lineup open six
hours after Boston's day began.

## 3. The stat vocabulary and the table

Raw stats (the adapter's job): `tmax`, `tmin`, `prcp` (in), `snow` (in),
`snwd` depth, `gust` (mph), `wind` mean, `rhmin`, `ts` hours with thunder,
`fog`, `hail`, `ntmax` / `ntmin` normals, `rec_hi` / `rec_lo` (record set,
from the evening climate report), `warn` NWS warnings active over the
station's zone that day, `torw` tornado warnings, `watch` watches.

Derived (`derive`): `hot` = max(0, tmax − ntmax) · `cold` = max(0, ntmin −
tmin) · `swing` = tmax − tmin · `wet` = prcp ≥ 0.01 · `soak` = prcp ≥ 1 ·
`snow6` · `gale` = gust ≥ 40 · `heat100` = tmax ≥ 100 · `frz` = tmin ≤ 32 ·
`subz` = tmin ≤ 0.

A default table: `hot` 1/°F · `cold` 1/°F · `prcp` 10/in · `snow` 4/in ·
`gust` 0.25/mph over 30 (as `galeover`, derived) · `ts` 2/hour · `rec_hi`
and `rec_lo` 25 · `warn` 5 · `torw` 15 · `soak` 5 · `snow6` 10 · `heat100`
5 · `subz` 5. Categories for a cats league: hot departure, cold departure,
precipitation, snow, peak gust, thunder hours, records, warnings, swing.

**The design decision.** Raw extremes make the game a climate map: the
desert wins the heat, the Arctic the cold, Hilo the rain, every week.
Scoring heat and cold as *departure from normal* makes every station a
contender on its own terms and makes the forecast the thing to read.
Precipitation and wind stay raw because their normals are small and a
foot of snow should be worth a foot of snow. Playtest the mix.

## 4. What is new

**The SportDef** — `packages/core/src/sports/wx.ts`: the tables above,
`derive`, the Köppen position list, vocab, `card.ts` leads (high / low /
departure / rain). Half a day.

**The directory is a file, not a feed.** No API lists "the 300 stations a
fantasy league wants". `packages/core/src/data/wxStations.ts`: WBAN, ICAO,
GHCN id, name, state, region, timezone, lat/lon, Köppen class, NWS forecast
office and grid, NWS zone id. Built once from NOAA's station inventory and
the climate-report site list; the adapter's `directory()` returns it. Rank
from last year's summed daily lines under the default table (the archive,
one call per station), exactly how `sportDirectory.js` ranks every sport
with no ADP.

**Normals** — NCEI's `normals-daily` service (answered here, 2 rows in
0.3 s): 366 rows per station, loaded once a year into a `wx_normal` table
(one migration) and stamped onto each day's line by the adapter.

**The adapter** — `server/src/sports/wx.js`:
- `schedule(date)`: nine region rows, no feed.
- `game(gameId)`: for each station in the region, today's line from the
  hourly observations (`api.weather.gov/stations/{ICAO}/observations`,
  one request per station per poll, ~300 an hour — well inside NWS's
  tolerance with a User-Agent) plus active alerts for the zone (one
  request per state). At the end of the day, the NWS daily climate report
  (`CLI` product, also on the API) is the official line with records and
  normals; three to five days later NOAA's daily summaries are the
  archival truth (the service returned 2025 days and nothing yet for
  October 2026 — that lag is real).
- `directory(season)`: the file plus last year's lines.
Replay reads Open-Meteo's archive for the day, same shape. Open-Meteo is
CC BY for non-commercial use and paid for commercial; with coin and
premium in the app, NWS is the live source and Open-Meteo is replay and
backfill, or the ~€29/month plan.

**The forecast as the projection** — the one genuinely new product piece.
The sport market (`sports/market.ts`, `sport_league_market`) projects from
last season's rate × games ahead. For weather the projection is the
7-day forecast (NWS gridpoint forecast or Open-Meteo daily), scored under
the league's table: a `wx_forecast` row per station per day, refreshed
twice a day, read by the market in place of the rate. Lineup rows then
show "proj 31 · forecast high 94, normal 81, 60% rain", which is the
start/sit decision in one line. A day's work in core and the market RPC.

**The true-up** — the Congress plan's mechanism, needed here for the same
reason: the official climate report lands in the evening and NOAA's
summary days later, after the day is `final` and sometimes after the
week is. Repoll the last seven days with `force` nightly; let resolve
re-stamp the previous period. Shared with Congress if both are built.

**Words and boards** — the slate row says "in play" not an opponent; the
fields widget skips `wx`; the player card shows a station, not a jersey.

## 5. Phases

1. **The spine entry** — `wx.ts`, the stations file, the migration (check
   lists, positions, `wx_normal`), normals load, directory and rank; a
   league drafts. One session.
2. **The adapter** — live hourly lines, alerts, the climate report at
   close, replay from the archive, fixtures from captures, CLI
   `sport-poll wx <date>`; a replay league scores a past week. One to two
   sessions.
3. **The forecast market and the true-up** — `wx_forecast`, the market
   read, the projection on the lineup row and card; the nightly force
   repoll and previous-period re-stamp. One session.
4. **Polish** — NOAA summaries as archival truth, station outages as
   injuries, `states` scoping, international stations through Open-Meteo,
   the mobile card and settings pages. One session.

Behind `has_sports()` and `SPORTS=wx`, as hockey was.

## 6. Decisions to make

- **Departure or raw?** §3's recommendation is departure for temperature,
  raw for water and wind. The commissioner's table can flip it; the
  default decides what the game feels like.
- **Lock time.** Midnight Eastern for everyone (simple) versus each
  region's local midnight (fair to the West, nine deadlines).
- **Pool size.** 300 US first-order stations, or the ~900 with a climate
  report, or the world via Open-Meteo. More stations means more polling;
  NWS is free, Open-Meteo's commercial tier is not.
- **The forecasting contest.** A separate mode: a daily call on a
  station's high and low, scored by error, on the coin board. Not this
  plan; cheap once the forecast and the official line are both in the
  database.

## 7. Data, measured 2026-10-05 from the build container

| Source | What | Reach | Terms |
|---|---|---|---|
| `api.weather.gov` stations/{id}/observations | hourly obs, the live line | 200, 0.4 s | public domain; User-Agent required |
| `api.weather.gov` gridpoints/…/forecast | 7-day forecast, the projection | 200, 13 KB | public domain |
| `api.weather.gov` alerts/active?area= | warnings, watches by zone | 200 | public domain |
| `api.weather.gov` products/types/CLI | the daily climate report: official high/low, precip, records, normals | 200 | public domain |
| NCEI `data/v1?dataset=daily-summaries` | GHCN daily, the archival truth | 200 for 2025; empty for 1–5 Oct 2026 (days of lag) | public domain |
| NCEI `data/v1?dataset=normals-daily` | 1991–2020 normals per station per day | 200 | public domain |
| Open-Meteo forecast (`past_days`) and archive | same-day analysis and any past day, worldwide | 200, 0.2–0.8 s | CC BY non-commercial; paid commercial |

The one thing no feed gives is the station list a fantasy game wants; that
is a file we write.
