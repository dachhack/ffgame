# Fantasy Weather — what it would take

> _Assessed 2026-10-05. Founder: "Just fantasy weather. Maybe you pick a
> locale and a metric like high, precipitation, snowfall, max sustained
> wind, etc. then score on that metric. Draft locales." Assessment and a
> phased plan; nothing ships with it._

## 0. The game

Draft locales. Each lineup spot is a **metric**: HIGH, LOW, PRECIP, SNOW,
WIND, GUST, RANGE. Put a locale in a spot and it scores that metric's
value, every day, for as long as it sits there. Phoenix in HIGH, Fairbanks
in LOW, Hilo in PRECIP, Buffalo in SNOW, Mount Washington in WIND. The
draft is about covering the spots; the week is about reading the forecast
and moving locales between them. No climate classes, no regions, no
normals, no "departure" — the metric is the score.

## 1. The verdict in one paragraph

This is the daily-sport spine with the **slot as the position**: a locale
is a player eligible for every spot, a day is the game, the day's
observations are the line, and the spot decides which stat on the line
counts. Everything the spine has — drafts, waivers, trades, weekly
matchups, points / roto / season formats, best ball, replay, the SCORING
page, the lineup builder — reuses as is. One engine change is new: the
sport scorer applies one flat table to a line, and this game needs the
table chosen by the spot. The NFL classic engine already scores by
position (v0.532.0), so it is a copy, not an invention. Data is NOAA's,
public domain, live hourly, and every feed answered from this container.
Two to three sessions to a playable league on a replayed week; a fourth
puts the forecast on the lineup row.

## 2. The model

| Spine concept | Weather |
|---|---|
| sport id | `wx` |
| player | a locale: a reporting station (Boston Logan, Phoenix Sky Harbor…), ~300 US to start, more by request |
| player key | `wx-<WBAN>` — the five-digit WBAN number in the GHCN id (`USW000`**`14739`**), numeric as `playerKey` requires; ICAO (`KBOS`) in `ext_id` |
| eligibility | every locale is eligible for every spot: `positions` is `['LOC']`, every slot type's `pos` is `['LOC']` |
| slot types | `HIGH` `LOW` `PRECIP` `SNOW` `WIND` `GUST` `RANGE`, and `ANY` (best ball picks the metric) |
| default lineup | HIGH · LOW · PRECIP · SNOW · WIND · ANY, 3 BN, 1 IR — a proposal; the builder sets any mix, including two HIGH spots |
| team | `US` for every locale (the lock needs a non-empty team); no team scoping |
| game | one row per day: `game_id` `2026-10-05`, `home` `US`, `start_utc` midnight Eastern — the day's lineup closes at midnight the night before |
| game status | `live` through the day · `final` an hour after midnight Hawaii |
| stat line | the locale's day, cumulative: `tmax` `tmin` `prcp` `snow` `wind` (max sustained, mph) `gust` (peak, mph); derived `range` = `tmax − tmin` |
| period | the Mon–Sun week as every daily sport; a spot's week is the sum of its days |
| season | the commissioner's `period_start` and `weeks`; nothing in the calendar is off |
| injury | a station that stops reporting is `OUT`; it scores 0 like a scratch |
| vocab | start "midnight", starts "turns midnight", started "turned midnight", slate "TODAY", noGame "no report today" |

## 3. Scoring — the spot picks the stat

Each slot type carries its own table; a line in a spot scores under that
spot's table only:

| spot | scores | default |
|---|---|---|
| HIGH | `tmax` | 1 per °F |
| LOW | `tmin` below a baseline | 1 per °F under 50 (`low_base` knob) |
| PRECIP | `prcp` | 10 per inch |
| SNOW | `snow` | 5 per inch |
| WIND | `wind` (max sustained) | 1 per mph |
| GUST | `gust` | 0.5 per mph |
| RANGE | `range` | 1 per °F |
| ANY | the best of the above for that day | best ball by metric |

The multipliers are the SCORING page's knobs, per spot; the LOW baseline
is one more. Raw values, as asked. A commissioner who wants a cold-weather
league puts three LOW spots in the lineup; one who wants chaos plays
GUST × 3.

**The engine change.** `sideScore` (`server/src/sportLeague.js`) and the
client mirror call `linePoints(def, line, scoring)` with one table per
league. For `wx`, `scoring` becomes a table per slot type
(`{ HIGH: { tmax: 1 }, LOW: { tmin_under: 1 }, … }`) and `sideScore` picks
by `r.roster_slot`'s type (`sportSlotTypeOf` already maps a spot to its
type). `normalizeScoring` learns the nested shape; `set_sport_settings`
stores it; the SCORING page draws a column per spot. ANY is best ball's
`assignByValue` with "value" being the max over the metric tables — the
nightly fill already runs per spot. About 150 lines across engine, RPC
and page, with a parity test (the NFL has `check:engineparity`).

Roto and season-points formats read the same slot-days, so a roto league
ranks HIGH total, LOW total, PRECIP total… as its categories with no extra
work: the categories are the slot types.

## 4. What is new

- **The SportDef** — `packages/core/src/sports/wx.ts`: seven stats, one
  derived, the slot types, vocab, card leads (today's high / low / rain /
  wind). Half a day.
- **The locales file** — `packages/core/src/data/wxStations.ts`: no feed
  lists "the stations a game wants". WBAN, ICAO, GHCN id, name, state,
  timezone, NWS office and zone. Built once from NOAA's station inventory
  and the daily-climate-report site list. The adapter's `directory()`
  returns it; rank is last year's points under the default lineup from the
  archive, the way every sport with no ADP ranks.
- **The migration** — 0437's pattern (check lists, positions,
  `create_native_league`), plus the nested scoring shape in
  `set_sport_settings`.
- **The adapter** — `server/src/sports/wx.js`:
  - `schedule(date)`: one row, no feed.
  - `game(date)`: every locale's running line from hourly observations
    (`api.weather.gov/stations/{ICAO}/observations`, one call per locale
    per poll; 300 an hour is fine with a User-Agent). Max sustained wind
    is the max of hourly `windSpeed`; gust the max of `windGust`; precip
    and snow from the hourly accumulations. At close, the NWS daily
    climate report (`CLI` product on the same API) is the official line
    and overwrites.
  - replay: Open-Meteo's archive by locale and date, same shape — any
    past week plays on the shifted clock with no other change.
- **The engine change** of §3.
- **The true-up** — the official report lands in the evening and NOAA's
  archival summary days later (empty for 1–5 Oct 2026 when probed), after
  the day is `final` and sometimes the week. Repoll the last seven days
  with `force` nightly and let resolve re-stamp the previous period. The
  Congress plan needs the identical mechanism.
- **Words** — the slate row reads "in play" where a sport prints an
  opponent; the fields widget skips `wx`; the card shows a station.

## 5. Phases

1. **Spine entry and scoring** — `wx.ts`, the locales file, the migration,
   the per-spot table in engine, RPC and SCORING page with its parity
   test; a league drafts and a hand-written line scores. One session.
2. **The adapter** — hourly lines, the climate report at close, replay
   from the archive, fixtures from captures, `sport-poll wx <date>`; a
   replay week scores end to end. One session.
3. **True-up and words** — the nightly force repoll and previous-period
   re-stamp, the slate row, the widget gate, the card. Half a session.
4. **The forecast on the row** — the 7-day forecast scored per spot as
   the projection ("HIGH · Phoenix · fcst 104"), a `wx_forecast` table
   read by the sport market in place of last-season rate. One session.
   Optional, but it is the start/sit screen.

Behind `has_sports()` and `SPORTS=wx`, as hockey was.

## 6. Decisions

- **Sum or peak for the week?** Sum of the days (above) rewards
  consistency and fits the cumulative line; the week's single best day
  rewards the storm chaser. Sum by default; "peak" is a format knob later
  if wanted.
- **LOW's baseline.** 50°F makes every locale score something most of the
  year; 32°F makes LOW a winter spot. Knob, default 50.
- **Lock time.** Midnight Eastern for everyone, one deadline. Per-locale
  local midnight would be nine deadlines a night.
- **Pool.** 300 US first-order stations is free on NWS; the world is
  Open-Meteo's commercial tier (CC BY for non-commercial only, and the
  app sells coin).

## 7. Data, measured 2026-10-05 from the build container

| Source | What | Reach | Terms |
|---|---|---|---|
| `api.weather.gov` stations/{id}/observations | hourly obs: temp, wind, gust, precip | 200, 0.4 s | public domain; User-Agent required |
| `api.weather.gov` products/types/CLI | the daily climate report: official high, low, precip, snow, max wind, gust | 200 | public domain |
| `api.weather.gov` gridpoints/…/forecast | 7-day forecast (phase 4) | 200 | public domain |
| NCEI `data/v1?dataset=daily-summaries` | GHCN daily, archival truth | 200 for 2025; empty for Oct 2026 (days of lag) | public domain |
| Open-Meteo forecast (`past_days`) and archive | any past day, worldwide, for replay and backfill | 200, 0.2–0.8 s | CC BY non-commercial; paid commercial |
