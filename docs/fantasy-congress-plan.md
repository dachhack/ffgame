# Fantasy Congress — what it would take

> _Assessed 2026-10-05. Founder: "Let's evaluate what it would take to have
> fantasy congress." This is the assessment and a phased plan; nothing ships
> with it. It sits beside `multi-sport-plan.md`, which answered the same
> question for hockey, basketball and baseball and whose spine this rides._

## 0. The verdict in one paragraph

Congress is an eighth "sport" on the spine the daily sports built
(`packages/core/src/sports/`, `server/src/sports/`, `sportLeague.js`), with
one twist: there are no games. Everything downstream of a stat line — locks,
resolve, points / categories / roto / season formats, best ball, scoped
spots, drafts, waivers, FAAB, trades, chat, coin, replay — carries over
unchanged if a **legislative day in session** is modelled as the day's
"game" for its chamber and a member's **actions and votes that day** are the
box-score line. The data is free, public domain, and reachable from this
container (Congress.gov API, the House Clerk's and the Senate's roll-call
XML, the `unitedstates/congress-legislators` crosswalk, GovTrack). The new
work is one SportDef, one migration, one adapter that *assembles* a line
from events rather than reading a box score, an event ledger for it to read,
and a late-data true-up. Roughly four to six sessions to a playable replay
league of the 2025 session; live play from the lame-duck session or the
120th Congress (3 January 2027).

## 1. What reuses as-is

- **The platform**: drafts (snake, linear, auction, slow), waivers with the
  4am run, FAAB, trades, keepers, IR, commissioner tools, chat, push,
  invites, coin, premium. None of it reads a position or a stat.
- **The spine** (v0.616.0 → v0.634.0): `league.sport`, `sport_game`,
  `game_stat_line`, `sport_player`, `league_pool.eligible` as a list, periods
  from week 301, `sport_slot_lock` and the two lock triggers, the worker's
  lock / score / final loop, `set_sport_lineup`, `set_sport_settings`, the
  SCORING page, `SportLineup`, `SportWeekPanel`, the sport player card, the
  mobile create flow and chips.
- **Formats**: points H2H, H2H categories, roto, season points — all four
  read a `StatLine`; a congress table and category list drop straight in.
- **Scoped spots** (0436): `bb` best ball, `teams`, `min_exp`/`max_exp`.
  With tenure from the legislators' terms, a ROOKIES spot is "freshmen
  only" and a `5+ YRS` spot is the old bulls, for free.
- **Replay** (0434): a past session on a shifted clock. Every action and
  vote of the 118th and 119th Congresses is in the API, so a replay league
  of 2025 is the playtest path — important because Congress is in recess
  for the election right now and a live league started today scores
  nothing until the lame-duck session.
- **The provider switch** (v0.634.0): Congress is its own provider; the
  Stathead shadow read and the public adapters are untouched.

Drip (plays, windows, power-ups on plays) is NFL-only, as it is for every
other sport — 0433 keeps those controls off a sport league already.

## 2. The model — a session day is a game

The spine locks a player when a `sport_game` row for his `team` starts
(`sport_slug_started`, 0434) and scores a slot-day from the cumulative
`game_stat_line` for that game. So:

| Spine concept | Congress |
|---|---|
| sport id | `congress` (one id, both chambers in one pool — that is the point) |
| season | the session year (`2025`, `2026`); a Congress is two seasons |
| team | the chamber, `HSE` or `SEN` (see §6 for state) |
| game | one per chamber per day it convenes: `game_id` `119-2025-01-09-SEN`, `home` the chamber, `away` `''`, `start_utc` the scheduled convening time (default 12:00 ET House, 10:00 ET Senate) |
| game status | `pre` before the gavel · `live` while the chamber sits · `final` at adjournment or midnight ET |
| stat line | the member's actions and votes dated that day, cumulative through the day |
| period | the Mon–Sun week, as every daily sport; weeks not in session are byes |
| positions | `SEN`, `REP` (eligibility also carries the party: `D`, `R`, `I`, so a spot's `pos` may be `['D']`) |
| slot types | SEN, REP, FLEX (either), plus D / R / I party spots |
| default lineup | 2 SEN · 4 REP · 1 FLEX · 1 D · 1 R, 4 BN, 1 IR (a proposal; the commissioner's builder overrides) |
| player key | `cg-<govtrack id>` — keys must be numeric (`playerKey`), bioguide ids (`P000197`) are not; the crosswalk carries both, bioguide goes in `ext_id` |
| tenure | years from the legislators' `terms`, so `exp` and ROOKIES spots work |
| vocab | start "gavel", starts "gavels in", started "gaveled in", slate "FLOOR SCHEDULE", noGame "not in session" |

Why per day and not per week: a `live` game freezes its players' roster
moves (`enforce_sport_roster_lock`), so a week-long pseudo-game would stop
every add and drop from Monday to Sunday. Per day, the week's waivers,
best-ball fills, lineup edits between days and the "no game today" row all
behave exactly as they do for hockey, and no third `PeriodModel` is needed.

What that costs: a day's line is only partly live. Roll-call votes post
within minutes (Clerk and Senate XML); bill actions reach Congress.gov
overnight to a day or two later. So the live read during the day is votes,
and the bills land on the next poll — which is why §4's true-up exists.

## 3. The stat vocabulary and the table

Every stat is an **event dated to a day and attributed to a member**, which
is exactly what `game_stat_line` wants. Proposed `StatDef`s (ids are the
short keys the engine, the knobs and the categories share):

| id | event | attributed to |
|---|---|---|
| `bi` | bill or joint resolution introduced | sponsor |
| `ri` | simple or concurrent resolution introduced | sponsor |
| `cos` | cosponsorship added | the cosponsor |
| `cm` | sponsored bill reported by committee | sponsor |
| `pc` | sponsored bill passed its chamber | sponsor |
| `po` | sponsored bill passed the other chamber | sponsor |
| `law` | sponsored bill became public law | sponsor |
| `coslaw` | cosponsored bill became public law | each cosponsor |
| `veto` | sponsored bill vetoed | sponsor |
| `am` | amendment offered | sponsor |
| `ama` | amendment agreed to | sponsor |
| `vc` | roll-call vote cast (yea, nay, present) | the member |
| `vm` | roll-call vote missed | the member |
| `vw` | vote on the winning side | the member |
| `mav` | vote against the member's party majority | the member |
| `spk` | floor speech (Congressional Record) — phase 4 | the member |

Derived (per `derive`): `att` attendance ratio as a category (`vc` over
`vc + vm`), `mavpct`. Groups: `all`, with `house` / `senate` only where a
knob differs by chamber.

A default points table, modelled on the stage ladder the original Fantasy
Congress game (2006–08) used, where a bill earns more the further it goes:
`bi` 5 · `ri` 1 · `cos` 1 · `cm` 10 · `pc` 20 · `po` 20 · `law` 50 ·
`coslaw` 5 · `veto` 10 · `am` 2 · `ama` 10 · `vc` 1 · `vm` −2 · `mav` 3.
Resolutions and commemorative bills (post-office namings) are the known
junk-stat problem of any congress game; the table above pays them little,
and a `commemorative` flag off the bill's policy area / title can zero them
if the playtest wants it. Categories for a cats league: bills introduced,
cosponsorships, bills advanced (`cm + pc + po`), laws, amendments agreed,
votes cast, attendance (ratio), maverick votes.

## 4. What is new

**The SportDef** — `packages/core/src/sports/congress.ts`, the shape of
`wnba.ts` with §3's tables and `derive`. The registry, `KEY_RE`,
`SPORT_IDS`, `card.ts` (what the card leads with: bills, laws, attendance),
`check-sports.mjs`. Half a day.

**The migration** — 0437's pattern: the five check lists, `sport_positions`,
`create_native_league`'s allow list. Plus one new table, the ledger below.

**The event ledger** — `congress_event (congress, chamber, date, member_key,
kind, bill_id, vote_id, …)`, unique on the event. Every other sport's
adapter is handed a box score per game; Congress.gov is queried *by bill*
(bills updated since a time, then each bill's actions and cosponsors) and
votes come *by roll call*, so the adapter needs somewhere to put events
before it can answer `game(gameId)` with a per-member, per-day line. The
poller upserts events; `game()` is a `group by member` over the ledger for
that chamber and date. Idempotent, like every line write on the spine.

**The adapter** — `server/src/sports/congress.js`, the three questions:
- `schedule(date)`: the session calendar. Sources: the House and Senate
  published calendars loaded into `sport_calendar` (the table the ESPN
  calendar feeds for the pro sports), refreshed weekly; a day with no
  calendar entry but a Congressional Record issue (govinfo `CREC`) is in
  session too. Convening time from the calendar when it has one.
- `game(gameId)`: the ledger read above.
- `directory(season)`: `legislators-current.json` (the YAML's JSON mirror —
  no new dependency) → name, chamber, party, state, district, govtrack and
  bioguide ids, tenure from `terms`, headshot from `unitedstates/images`
  (public domain) or Congress.gov's `depiction` (attribution required).
  Rank from the prior session's events under the default table, the way
  `sportDirectory.js` ranks every other sport with no ADP.

**The poller** — `poll/congress.js`: bills updated since the last poll
(`/bill?fromDateTime=`), each one's actions and cosponsors since then,
dated and attributed; roll calls for the day from `clerk.house.gov/evs/` and
`senate.gov/legislative/LIS/roll_call_votes/`, with each member's position
and the party majorities computed for `mav` and `vw`. Congress.gov wants a
free API key (`CONGRESS_API_KEY`), 5,000 requests an hour; the shared
`DEMO_KEY` hit its ceiling on the second call from here. A session's volume
is a few hundred updated bills a day, well inside that.

**The true-up** — the one mechanism the spine lacks. A bill action dated
Tuesday can arrive Thursday, after Tuesday's game is `final` and, across a
week boundary, after the matchup is. The NFL has `trueup.js` and
`rescore.js`; the sport loop has `force` repolls. For Congress: repoll the
last seven session days with `force` nightly, and let the resolve pass
re-stamp finals for the previous period as well as the live one (today it
stamps a period once `periodDone`). About a hundred lines in
`sportLeague.js` and `index.js`, and a test that a late `law` moves a
settled week.

**Words and boards** — `slate.ts` prints "in session" where it would print
an opponent; the fields widget skips Congress (it lists games); "SPORT"
and "tip-off" copy in a handful of screens reads through `vocab`. The
sport market's projections (last season's rate × days ahead) work unchanged
because `week_games` is keyed by team, and the chamber's session days are
exactly that.

## 5. Phases

1. **The spine entry** — `congress.ts`, the migration, vocab, the directory
   from the crosswalk, the check script; a league can be created and
   drafted. One session.
2. **The ledger and the adapter** — `congress_event`, the poller over
   Congress.gov and the two vote feeds, fixtures captured from the live
   sources, `sports-adapters.mjs` coverage, `sport-poll congress <date>`
   on the CLI; a replay league of the 2025 session scores. Two sessions.
3. **The true-up and the words** — late actions re-stamp finals, the slate
   row, the widget gate, the card. One session.
4. **The product layer** — state-scoped spots (§6), vacancies and absences
   as the "injury" vocabulary (`VAC`, `LOA`, resigned, deceased), floor
   speeches from govinfo, a commemorative-bill flag, the mobile card and
   settings pages. One to two sessions.

Phases 1–3 are the playable game. The daily-sport feature flag
(`has_sports()`, `SPORTS=congress`) gates it exactly as it gated hockey.

## 6. Decisions to make

- **Team = chamber, or team = state?** Chamber (above) makes the lock and
  the board trivial. State would make a "your delegation" spot free through
  the existing `teams` scope, at the price of 56 pseudo-games a day and an
  opponent column full of state codes. Recommendation: chamber now; add a
  `state` column and a `states` key on the spot in phase 4, mirroring
  `teams`.
- **Who scores a cosponsored law?** Every cosponsor at `coslaw` 5, or only
  original cosponsors. The ledger carries the sponsorship date either way.
- **Resolutions.** Pay them (at 1) or zero them. Playtest.
- **Votes as the live stat.** They are the only thing that moves during the
  day; the rest lands overnight. Fine for a weekly H2H; a commissioner who
  wants a nightly scoreboard should know.
- **Season shape.** ~40 periods from the first week of January; recess weeks
  are 0–0 ties in H2H, which argues for the `season` or roto format as the
  default and H2H as the option. The 2026 lame-duck session (mid-November to
  December) is a short live season to test on before the 120th Congress.

## 7. Data, measured 2026-10-05 from the build container

| Source | What | Reach | Terms |
|---|---|---|---|
| `api.congress.gov/v3` | members, bills, actions, cosponsors, amendments, House votes (beta) | 200; `DEMO_KEY` 429 on the second call — a free key is needed | public domain; key required |
| `clerk.house.gov/evs/<year>/roll<NNN>.xml` | House roll calls, every member's position | 200, 96 KB, 0.25 s | public domain |
| `senate.gov/legislative/LIS/roll_call_votes/vote<congress><session>/vote_*.xml` | Senate roll calls | 200, 29 KB, 0.3 s | public domain |
| `unitedstates/congress-legislators` (`legislators-current.json`) | the directory and the id crosswalk (bioguide, govtrack, fec, wikidata…), terms, party, state | 200, 1 MB | CC0 |
| `govtrack.us/api/v2` | roles, bulk history | 200 | CC0 data |
| `api.govinfo.gov` | Congressional Record (speeches), bill text | 429 on `DEMO_KEY`; same key programme as Congress.gov | public domain |

Nothing here carries the non-commercial posture the ESPN and league feeds
do; the only attribution duty is on Congress.gov's member photos.
