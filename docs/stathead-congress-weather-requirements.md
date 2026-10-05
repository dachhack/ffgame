# Stathead data requirements — Congress and Weather

> _Written 2026-10-05 for the stathead repo, as additions to
> `docs/daily-sport-service.md`. Two new sport ids on the same `/v1`
> service: `congress` and `wx`. The product designs are
> `fantasy-congress-plan.md` and `fantasy-weather-plan.md` in this repo;
> this document is only what the feed must serve, in the contract's own
> shapes, so the worker's Stathead adapter reads both with the same code it
> reads hockey with._

## 0. What stays the same

Both sports answer the three questions the poller asks every adapter, on
the routes the contract already has, behind the same bearer token:

| Route | Congress | Weather |
|---|---|---|
| `GET /v1/meta` | the `congress` entry: `current_season`, `seasons`, `as_of`, row counts | the `wx` entry, same |
| `GET /v1/{sport}/games?date=` | the chambers in session that day | one row, the day |
| `GET /v1/{sport}/games?season=` | the session calendar | every day of the year |
| `GET /v1/{sport}/games/{game_id}/lines` | one row per member, the day's events as a line | one row per station, the day's observations as a line |
| `GET /v1/{sport}/players?season=` | the directory: every member who served in the season | the station list |
| `GET /v1/{sport}/season-lines?season=` | each member's season totals, for rank | each station's season sums and day count, for rank |
| `GET /v1/{sport}/crosswalk` | bioguide ↔ govtrack ↔ our key | WBAN ↔ ICAO ↔ GHCN ↔ our key |
| `GET /v1/{sport}/teams` | the two chambers | the one team, `US` |
| `GET /v1/{sport}/adp` | not served (none exists); 404 or empty `rows` | same |

Conventions carried over unchanged: dates are US Eastern calendar dates
(`YYYY-MM-DD`); `start_utc` is ISO; `status` is `pre` / `live` / `final`;
`stats` keys are **exactly our stat ids** (listed below), numbers, absent
meaning 0; `played` is false for a row listed but with nothing to score;
every `/lines` response carries `game`, `stored` and `revised_at`;
`player_id` is `<sport>-<id>` and the id after the dash is numeric (the
consumer's key rule).

**One addition both sports need, and the pro sports would benefit from
(§3): a revisions route**, because both lines change after the day is
final.

## 1. Congress

### 1.1 Seasons and games

- `season` is the **session year** (`2025`, `2026`). The Congress number
  is derived (`119` for both) and served on every game row as `congress`.
- A **game** is one chamber on one day it convened. `game_id` is
  `<season>-<MM-DD>-<HSE|SEN>` (`2025-01-09-SEN`). `home` is the chamber
  code, `away` is `""`, `game_type` is `regular` or `proforma` (a pro forma
  session is a game that will score nothing; we want to know, not guess).
- `start_utc` is the scheduled convening time when the published calendar
  has one; otherwise 12:00 ET for the House and 10:00 ET for the Senate.
  `status` is `pre` until then, `live` until adjournment, `final` from the
  first bundle after adjournment (the bill actions are not in yet — see
  §3).
- `games?season=` returns the **published session calendars** (the House
  Majority Leader's and the Senate's) for the year, every day marked, and
  is re-read by the worker weekly because they change mid-year. Past days
  reflect what actually happened (a day the chamber was scheduled but did
  not meet is dropped; an added day is added).

### 1.2 Lines — the stat vocabulary

One row per member of that chamber on that day, `played` true when any
event is attributed to them. `stats` keys:

| id | definition | attributed to |
|---|---|---|
| `bi` | bills and joint resolutions introduced (H.R., S., H.J.Res., S.J.Res.) | sponsor |
| `ri` | simple and concurrent resolutions introduced | sponsor |
| `cos` | cosponsorships added that day (any bill or resolution) | the cosponsor |
| `cm` | sponsored measures reported by committee (action codes for "Reported by…") | sponsor |
| `pc` | sponsored measures passed or agreed to in the sponsor's chamber | sponsor |
| `po` | sponsored measures passed or agreed to in the other chamber | sponsor |
| `law` | sponsored measures that became public law (signed, or enacted over a veto) | sponsor |
| `coslaw` | cosponsored measures that became public law | each cosponsor at enactment |
| `veto` | sponsored measures vetoed | sponsor |
| `am` | amendments offered | the amendment's sponsor |
| `ama` | amendments agreed to | the amendment's sponsor |
| `vc` | roll-call votes cast (yea, nay, present) | the member |
| `vm` | roll-call votes missed (not voting) | the member |
| `vw` | votes on the prevailing side | the member |
| `mav` | votes against the member's own party's majority on that roll call | the member |
| `spk` | floor speeches in that day's Congressional Record (phase 2; serve 0 until then) | the member |

Rules the feed owns, so every consumer scores alike:

- **Date of attribution** is the action's date in Congress.gov (or the roll
  call's), never the date the feed first saw it. A late-arriving action is
  a revision of that past day (§3).
- A measure that passes **both** chambers the same day scores `pc` and
  `po` on that day. A bill that becomes law scores `law` on the enactment
  date, not the signing announcement.
- `mav` and `vw` are computed from the roll call: the party majority is
  the party's yea/nay split on that vote, independents counted with the
  party they caucus with (the directory's `caucus`). A vote with no party
  majority (tie) is never `mav`.
- **Cosponsorship withdrawn** is not a negative stat; it is a revision
  that removes the `cos` from the day it was added.
- Delegates and the Resident Commissioner are in the House directory
  (`REP`, `delegate: true`) and score everything but `vc`/`vm`/`vw`/`mav`
  on floor votes they cannot cast.

### 1.3 Events — the box score detail (new route)

`GET /v1/congress/games/{game_id}/events?player_id=` (optional filter):
the rows the line was summed from, so the player card can say *why* a
member scored 50 ("S.1234 Rural Broadband Act — became law"):

```
{ rows: [ { player_id, kind: "law", measure: "S.1234", title, url, action_at, vote_id?, position? } ] }
```

`kind` is a stat id above. For `vc`/`vm`/`vw`/`mav` rows, `vote_id` is the
chamber's roll-call id and `position` is `yea` / `nay` / `present` /
`not voting`.

### 1.4 Players (the directory)

One row per member who served any day of the season (a member who
resigned in March is still there, `active: false` after). Fields:

```
player_id      "congress-<govtrack id>"       (numeric after the dash — the key)
bioguide_id    "P000197"
name           "Nancy Pelosi"
team           "HSE" | "SEN"
pos            "REP" | "SEN"
eligible       ["REP", "D"]                    (chamber code plus party code D | R | I)
party          "D" | "R" | "I"
caucus         "D" | "R"                       (whom an independent caucuses with)
state          "CA"
district       12 | null
delegate       true | false
leadership     "Speaker" | "Majority Leader" | … | null
exp            years in Congress at the season's start (terms, any chamber)   — tenure
active         true | false
injury         { code: "VAC" | "LOA" | "RES" | "DEC", note } | null    (vacant, extended absence, resigned, deceased)
headshot       URL (public-domain source preferred; attribution string if Congress.gov's)
```

Tenure is read from the terms, so `exp` 0 means a freshman (the ROOKIES
spot).

### 1.5 Season lines and crosswalk

- `season-lines?season=`: the sums of §1.2 over the session per member,
  with `gp` = session days the member's chamber met while they served.
  Also serve `season-lines?season=<prior>` for the previous session; the
  worker ranks from the prior one until the current has 20 days.
- `crosswalk`: `{ player_id, bioguide_id, govtrack_id, fec_ids[], wikidata }`.

### 1.6 Sources and cadence (what we expect, not a requirement on method)

Congress.gov API (bills, actions, cosponsors, amendments, members), the
House Clerk's roll-call XML (`clerk.house.gov/evs/`), the Senate's
(`senate.gov/legislative/LIS/roll_call_votes/`), the
`unitedstates/congress-legislators` crosswalk. All public domain. Roll
calls should land within 15 minutes (the live stat); bill actions on the
feed's next bundle after Congress.gov publishes them (typically next
morning, sometimes two days).

## 2. Weather (`wx`)

### 2.1 Seasons and games

- `season` is the calendar year.
- A **game** is a day: `game_id` `2026-10-05`, `home` `"US"`, `away` `""`,
  `start_utc` midnight Eastern of that date, `status` `live` through the
  day and `final` once the last station's local day has closed (an hour
  after midnight Hawaii) **and** the official climate reports are in.
- `games?season=` is every date of the year, so the worker's calendar
  reads find a game on every day.

### 2.2 Lines — the stat vocabulary

One row per station in the directory, `played` false when the station
reported nothing that day. `stats` keys, all for the station's **local
calendar day** (midnight to midnight local standard time, the climate
convention):

| id | definition | unit |
|---|---|---|
| `tmax` | maximum temperature | °F, one decimal |
| `tmin` | minimum temperature | °F |
| `prcp` | liquid-equivalent precipitation | inches, two decimals |
| `snow` | snowfall | inches, one decimal |
| `snwd` | snow depth at the observation | inches |
| `wind` | maximum **sustained** wind (2-minute) | mph |
| `gust` | peak gust | mph |
| `obs` | hourly observations that fed the line | count |

And on every row, outside `stats`:

```
source     "obs" | "cli" | "ghcn"      what the line is built from right now
```

- `obs`: the running line during the day, from hourly observations —
  `tmax` is the highest reading so far, `prcp` the accumulation so far.
- `cli`: the NWS daily climate report has replaced the running line (the
  official high, low, precip, snow, max wind, gust). Expected the evening
  of the day or the next morning.
- `ghcn`: NOAA's daily summary has replaced the climate report (the
  archival value; arrives days later and can differ by a tenth).

Each replacement is a revision (§3). The consumer never has to know which
source a number came from to score it; `source` is for the card and for
the shadow read.

### 2.3 Players (the station list)

The directory is the station list **we** choose and Stathead serves;
start from the ~300 US first-order stations that issue a daily climate
report. Fields:

```
player_id   "wx-<WBAN>"           (five digits, numeric — the key)
icao        "KBOS"
ghcn_id     "USW00014739"
name        "Boston, MA (Logan)"
team        "US"
pos         "LOC"
eligible    ["LOC"]
state       "MA"
tz          "America/New_York"
lat, lon
elev_ft
nws_office  "BOX"
nws_zone    "MAZ015"
active      true | false            (false when the station has not reported for 7 days)
injury      { code: "OUT", note: "no observations since …" } | null
```

### 2.4 Season lines, forecast, normals

- `season-lines?season=`: per station, the sums of `tmax`, `tmin`,
  `prcp`, `snow`, `wind`, `gust` over the year's days and `gp` = days with
  a line. Prior season too. (Sums of temperatures rank a HIGH station and a
  LOW station sensibly under the default tables; that is all the rank is
  for.)
- **`GET /v1/wx/forecast?date=`** (new route): one row per station per
  day for that date and the next six, from the NWS gridpoint forecast:
  `{ player_id, date, tmax, tmin, prcp, snow, wind, gust, pop, issued_at }`.
  This is the lineup row's projection; refreshed at least twice a day.
- **`GET /v1/wx/normals`** (new, optional, small): per station, 366 rows of
  `{ mmdd, tmax, tmin, prcp }` from NCEI's 1991–2020 normals. Not needed to
  score; wanted for the card ("high 94, normal 81").

### 2.5 Sources and cadence

`api.weather.gov` hourly observations per station (one call per station
per poll; a User-Agent is required), the `CLI` climate-report product by
site, the gridpoint forecast, NWS alerts if a later version scores them;
NCEI `daily-summaries` for the archival line. Open-Meteo's archive is
acceptable for **replay seasons** (any year back to 1940) and for
stations outside the US, under its commercial terms, with `source`
`"om"`. Live lines should refresh hourly; the climate report within an
hour of issue.

## 3. Revisions — the new route both need

Both sports' lines change after `final`: a bill action dated Tuesday lands
Thursday; a climate report replaces the running line in the evening and
NOAA's summary replaces that a week later. The consumer repolls and
re-stamps a settled day only if it knows which days moved, so:

```
GET /v1/{sport}/revisions?since=<ISO timestamp>
→ { as_of, rows: [ { game_id, game_date, revised_at, reason } ] }
```

- Every game whose `/lines` changed after `since`, oldest first, for the
  last 30 days at most.
- `reason` is free text (`"late action: S.1234 became law"`,
  `"cli replaced obs"`, `"ghcn replaced cli"`).
- `revised_at` on `/lines` must be the same timestamp.

The worker will call it nightly for both sports and `force`-repoll what it
names. The same route on the six pro sports would replace the shadow
read's blind repoll of finals; not required for this work.

## 4. Acceptance — what we check before a league plays

The shadow-read runbook (`stathead-shadow-read.md`) applies: a week of
reads against the public sources before the provider switch. The specific
checks:

**Congress**
1. For three session days of 2025 (one quiet, one heavy, one with a bill
   enacted), every member's `vc + vm` equals the chamber's roll calls that
   day, and `vw`/`mav` agree with a hand count on two roll calls.
2. `law` on the enactment dates of five named public laws of 2025, on the
   sponsor's row, and `coslaw` on every cosponsor's.
3. A late action: find one in the feed's own history (an action published
   two or more days after its date) and confirm `revisions` named the day.
4. The directory at `season=2025` has 541 House and Senate rows counting
   delegates, each with a numeric key, chamber, party, state and `exp`.

**Weather**
1. For 1–3 January 2025, `/lines` under `source: "ghcn"` equals NCEI's
   `daily-summaries` for 20 named stations (tenths of °F and hundredths of
   an inch).
2. For yesterday, the `cli` line equals the station's NWS climate report
   for the same 20 stations, and `revisions` lists yesterday once the
   `ghcn` value lands.
3. A live day: at 15:00 ET the `obs` line's `tmax` is no lower than any
   hourly reading on `api.weather.gov` for that station that day.
4. `forecast?date=today` has a row per active station for seven dates.

Fixtures the worker's tests will pin: the three Congress days and the
twenty stations' January days, captured from the feed once accepted, in
`server/test/fixtures/sports/`.

## 5. Open questions for Stathead

1. Can `games?date=` for Congress carry `clock` as the floor state
   ("in recess", "voting on H.R. 22") the way a live game carries a
   period and clock? Nice for the board; not required.
2. Floor speeches (`spk`) need the Congressional Record from govinfo
   (`CREC`); is that a phase-2 commitment or out of scope?
3. For weather, do you want the station list from us as a file in the
   stathead repo, or will you derive it from the climate-report site
   list? We have a preference for owning it.
4. Rate: 300 stations hourly is ~7,000 NWS calls a day; if that is a
   concern, Open-Meteo's `past_days` can be the running line for the
   non-first-order stations.
5. Does the `revisions` route make sense to you for the six pro sports
   too? If yes, we will switch the shadow read to it.
