# Where two sources answer the same question — and what they say

Founder: *"Can we check where we have the same data from sources and do an
audit of differences."*

`npm run audit:sources` is the repeatable version of this document; the
numbers below are its output on **2026-09-21**, season 2026, week 3.

Eight facts in this app come from more than one place. The audit joins them
on ids — never on names — and sorts what it finds into two piles:

* a **model difference** (two projections disagree) is expected and useful;
* a **fact difference** (two sources name different players, teams, or say
  one of them is not playing) is a bug in one of them, and ours to resolve.

It found four fact differences and three of our own bugs.

---

## The bugs the audit found

### 1. ESPN's weekly projection poller had never written a row — FIXED

`server/src/poll/projections.js` asked ESPN with
`filterStatsForTopScoringPeriodIds`. That filter returns each player's
**actual** weekly lines plus one **projected season** row, and strips every
projected **weekly** row — which is the only row `weekLineFor` looks for. The
measurement: **0 of 200** players carry a week-3 projection with the filter,
**200 of 200** without it.

It survived a green validator for six versions because `validate:proj` built
its own request, correctly, and proved the decode rather than the poll.
`check-proj-map` now also asserts the **poller's own request** comes back with
projected player-weeks.

### 2. Nothing could be written anyway — FIXED

Migration 0330's `upsert_week_projections` names twelve columns and selects
eleven values: `updated_at` was in the column list and not in the select, so
every call raised `INSERT has more target columns than expressions`. Both
sources. Every week. The worker logs an upsert failure and carries on, which
is right for a stale projection and wrong for a broken one.

The probe suite covering it reported **PASS** throughout, because a psql
script without `ON_ERROR_STOP` keeps going after a failed statement and the
file's closing `select 'ALL … PROBES PASS'` printed anyway — the same trap
v0.450.0 documented one version earlier. Fixed in both places: the column
list, and `\set ON_ERROR_STOP on` at the top of **all 117 probe suites**.

### 3. The weekly number did not know who was out — FIXED

500 players are projected by both sources for week 3. **73 of them are zero
on one side and not the other**, and the names say what it is:

| | ESPN | StatHead |
| --- | --- | --- |
| Joe Burrow (QB CIN) | 0.0 | 16.6 |
| Brock Purdy (QB SF) | 0.0 | 16.7 |
| Rashee Rice (WR KC) | 0.0 | 17.0 |
| George Kittle (TE SF) | 0.0 | 13.2 |
| Jayden Daniels (QB WAS) | 0.0 | 14.3 |

ESPN prices this week's injury report. StatHead's weekly strip zeroes only
**roster** status (IR, practice squad, released) and says in its own notes
that a consumer should apply the week's designations itself. v0.447.0 made
StatHead primary, so that became our problem the moment it shipped.

We already poll ESPN's live report into `injury_status`. Migration 0333
applies it — **Out/IR → 0, Doubtful → ×0.25, Questionable → a flag** — to the
points *and* the multiplier together, and **only for the week being played**,
because today's designation says nothing about week 9. The row carries `inj`
and `adjusted` so a screen can say why a number moved.

---

## The fact differences between sources

### Identity — three opinions about who a player is

Joined on Sleeper id, over the 846 players a league could actually roster:

| field | agree | disagree |
| --- | --- | --- |
| `sportradar_id` | 758/758 | — |
| `fantasy_data_id` | 756/756 | — |
| `yahoo_id` | 206/206 | — |
| `rotowire_id` | 766/768 | 2 |
| `espn_id` | 208/209 | 1 |
| `gsis_id` | 164/165 | 1 |
| FantasyCalc's `espnId` vs Sleeper | 93/93 | — |

**The one ESPN id that disagrees is wrong, and it is ours.** Sleeper gives
Tyler Conklin (TE DET) `espn_id` 3122920. The crosswalk says 3122920 is
**Ryan Izzo**, a different tight end from the same draft class, with his own
row and his own Sleeper id; Conklin is 3915486. Every ESPN-keyed thing we
showed for Conklin — his news, his weekly projection, his headshot — was
another man's.

0333 corrects an id **only** where the crosswalk positively identifies the one
we hold as belonging to a different player. A mismatch it cannot explain is
left alone, because "the other source disagrees" is not evidence about which
one is right.

> A caveat the audit itself needed: Sleeper stores some ids with a leading
> space (`" 00-0026300"`). Comparing raw reports 52 gsis "disagreements" that
> are one space. The id you join on is only as good as the trim around it.

### Identity — and the coverage nobody had counted

Of those same 846 rosterable players, **Sleeper carries an `espn_id` for 213**
— and for only **84 of the top 300** by search rank. Jahmyr Gibbs, Ja'Marr
Chase and Bijan Robinson all come back `null`. The crosswalk has an id for
**613 more of them**.

`league_pool.espn_id` is filled from Sleeper, so everything keyed on it has
been reaching about a quarter of each roster and missing the best players in
it. A missing id degrades to "no row", which looks exactly like "nothing to
say about him", which is why it never looked like a bug. 0333's
`backfill_pool_ids()` fills the pool from the crosswalk in both directions
after every daily sweep.

### Team — one disagreement in 500

Michael Carter (RB): **Sleeper says TEN, StatHead says ARI.** Neither of
Sleeper's two Michael Carters carries an ESPN id, so there is no third source
to break the tie from the crosswalk. Open — the live team layer
(`playerTeam` + the worker's ESPN overrides) is what a screen actually reads,
so this one is cosmetic until it is not.

### Depth chart — 64% agreement, and that is correct

297 of 465 agree; 24 disagree about who is **#1**. These are built for
different purposes and both are right: Sleeper re-orders for **availability**
week to week (which is exactly why 0293 reads it), StatHead publishes the
nflverse **roster** depth. Josh Jacobs at Sleeper #1 and StatHead #4 is an
injury, not an error. No action.

### Injuries — a freshness gap, not a contradiction

12 of 73 agree where both carry a designation, with 148 rows where only one
says anything. ESPN's live report and Sleeper's directory update on different
clocks, and ESPN's is the one the worker stores. Worth watching, not worth
changing: the rows where they differ are mostly `Q` against `Out` a few hours
apart, and the ones where only Sleeper speaks are IR moves ESPN's report drops
once they are official.

### The schedule — no disagreement at all

**32/32 team-games agree** for week 3 between ESPN's slate (what the worker
stores in `nfl_slate`) and StatHead's `teamWeeks`, opponent and home side
both. This is the check that matters most and the one that is clean.

---

## Model differences — expected, and worth knowing the size of

### This week: ESPN vs StatHead

Over 500 players, mean difference **+1.47 pts** (StatHead − ESPN), mean
absolute **2.81**. Ranking agreement is what a lineup actually cares about:

| | overlap |
| --- | --- |
| top 12 | 5/12 |
| top 24 | 13/24 |
| top 48 | 33/48 |

Most of the top-12 gap is the injury effect above, now fixed.

**A trap for whoever wires this into a board:** 45 of those rows are StatHead
**backup** lines, which are a rate *conditional on playing* — Nick Mullens
comes back at 18.5 while ESPN, answering "what will he score", says 0. Two
answers to two different questions. `weekPointsFor` now returns
`conditional: true` on those rows; nothing may rank on them without it.

### This season: our August bake vs the live board

489 players, joined by Sleeper id. Mean drift **−0.05 pts/week**, mean
absolute **1.00**. The bake is a season rate frozen in August; the live board
blends what has actually happened since. The tails are the story:

| | baked | live |
| --- | --- | --- |
| Josh Jacobs (RB) | 16.3 | 0.9 |
| A.J. Brown (WR) | 13.7 | 0.7 |
| Deshaun Watson (QB) | 2.1 | 12.9 |
| Kenny Gainwell (RB) | 2.4 | 11.8 |
| Aaron Jones Sr. (RB) | 10.9 | 18.5 |

Those are injuries and job changes, and they are the argument for a rebake
before the trade deadline — the draft room, the trade grade and the pool sort
all read this file.

### The market: ADP

Mean absolute move **9.3 picks** since the 2026-08-26 bake over the 34 names
that join (the bake keys on slugs, so that join is a **name** join — the one
place in this audit that cannot be done by id). Josh Jacobs 35.9 → 109.4 is
the same injury as above.

---

## What is still open

* **Michael Carter's team** — one player, no tie-breaker available.
* **A rebake** of `proj2026` / `adp2026` / `dyn2026` before the deadline.
* **ADP joins by name.** The bake stores slugs and FFC stores display names.
  Baking the Sleeper id alongside the ADP would close the last name join in
  the data layer.
* **Three probe suites fail** (`classic-open-lineups`, `dropped-pick`,
  `draft-midseason`) exactly as they do on `main` — pre-existing, and now
  provably so under a harness that can no longer print a pass it did not earn.

## Running it

```
npm run audit:sources             # the whole thing, ~1 min, network
WEEK=5 npm run audit:sources      # a specific week
SEASON=2026 npm run audit:sources
```

It is deliberately not part of `check:parity`, which stays offline. A section
whose sources cannot be reached says so and the rest continues.
