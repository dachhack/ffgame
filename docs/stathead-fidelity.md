# What StatHead can fill in — an audit of v0.437.0 … v0.446.0

Founder, after ten versions of gap-list work: *"We want to review the work
for anything we can fill in with fidelity from StatHead instead. We can use
the StatHead MCP or python library or we can ask their dev team for an API if
we need it."*

This is that review. One line up front, because it changes the shape of every
answer below:

> **We do not need to ask anyone for an API.** StatHead's model outputs are
> published as plain JSON and gzipped CSV in a public repo, rebuilt about
> every two hours by its own workflow. The `stathead` Python package on PyPI
> is a thin cache-and-DataFrame wrapper over those same files
> (`_fetch.fetch_json` → `raw.githubusercontent.com/dachhack/stathead/<ref>/
> public/data/…`). Anything the MCP can answer, the worker can fetch over
> ordinary HTTPS with no key, no SDK and no vendor dependency — which is
> exactly what v0.447.0 now does.

So the three distribution options are really one decision per consumer:

| Consumer | Use | Why |
| --- | --- | --- |
| **Bakes** (`proj2026`, `adp2026`, `dyn2026`, `pickValues2026`) | the **MCP**, at author time | It is interactive, it applies the presets and re-scoring server-side, and the output is pasted into a generated file that is reviewed in a diff. |
| **The worker** (live, every sweep) | the **public JSON**, over HTTPS | No key, no Python in a Node service, no rate limit to respect, and a pinnable git ref for a reproducible run. |
| **Analysis scripts** | the **Python client**, if ever | Nothing in this repo needs a DataFrame today. |
| **Their dev team** | only for **news** | It is the one feed in this audit that StatHead does not publish and ESPN does. There is nothing to ask for. |

---

## The findings, in the order they matter

### 1. The weekly projection was ESPN's, in ESPN's scoring — FIXED in v0.447.0

**What we built (v0.445.0 / migration 0329).** `nfl_week_proj`, filled from
ESPN's `kona_player_info`: `appliedTotal` plus a decoded stat line.

**What was wrong with it.** `appliedTotal` is a scalar priced under ESPN's
catalog. A Drip league paying 6 for a passing touchdown, or 1.5 per TE
reception, read somebody else's rules — which is the exact bug v0.308.0 spent
a version killing on the season projection. We stored the raw line to make
re-scoring possible "later"; the better answer turned out not to need the
line at all.

**What StatHead has.** `get_weekly_projections` / `public/data/weekly-
projections-2026.json`: the same season model this app already ranks, drafts
and grades with, split across the schedule. Weekly points = season PPG ×
opponent defence-vs-position × home/away, or an implied team total blended
60% over that where a market line is posted, normalized so the 17 weeks sum
back to the season line. It covers K, team DST and the three IDP buckets —
all positions whose ESPN weekly number we could only ever take as an
undecodable total.

**Why the fix is exact rather than close.** That split scales a player's
*whole* line by one multiplier (the feed is explicit that receptions scale
with it: `rec_w = recPG × pts_w / ppg`). Scoring is linear in the line, so
`this league's season rate × mult` **is** the re-scored weekly projection,
not an approximation of one.

**Verified, not assumed** (`npm run validate:weekmult`, against the live
file): the weeks average back to the season line to within 0.14%, and the
ratio is shared by every player on a team at a position to within 0.0025 —
i.e. it is a matchup term, not a per-player opinion.

**Shipped.** Migration 0330, `server/src/poll/projections.js`,
`packages/core/src/data/weekProj.ts`. ESPN stays as a per-player fallback for
men StatHead has no line for.

### 2. The trade grade's pick curve was invented — FIXED in v0.448.0

**What we built (v0.444.0).** `PICK_SHARE = [0, 0.85, 0.45, 0.22, 0.1, 0.05]`
— a pick as a fraction of a replacement starter, with a comment admitting it
was blunt. The one number in the grade that came from nowhere.

**What StatHead has.** `get_dynasty_values` with `position: 'RDP'` returns
the rookie-pick rows `dyn2026` deliberately drops: 2026's exact slots (1.01 …
4.12) and Early/Mid/Late tiers for 2026-2028, in 1QB and superflex, on the
same scale as the player values.

**Shipped.** `pickValues2026.ts` bakes that board;
`tradeGrade.ts` prices a **rookie** pick by reading its market value off the
pool's own value↔points curve, and a **startup** slot by the player who will
still be on the board when it comes round — which needs no market at all.

### 3. The public API exposed one id where StatHead has nine — FIXED in v0.449.0

**What we built (v0.442.0 / migration 0326).** `api_players` returns
`espn_id` and nothing else identifying.

**What StatHead has.** `get_player_crosswalk` /
`public/data/player-crosswalk.json`: `gsis_id` (the nflverse key, and the one
in play-by-play), `pfr_id`, `sleeper_id`, `espn_id`, `yahoo_id`, `pff_id`,
`sportradar_id`, `rotowire_id`, `fantasy_data_id`, `esb_id`, plus headshot
URLs with a roster fallback for rookies ESPN has not indexed.

**Why it is worth doing.** The public API's whole promise is "readable by
anything". A third party joining our league data to nflverse, Sleeper or
their own board currently has to name-match — the failure mode this repo has
already been bitten by twice (`Kenneth/Kenny Gainwell`, `Chig Okonkwo`). A
`crosswalk` table filled by the worker from that one file, and `gsis_id` +
`sleeper_id` added to `api_players`, removes the whole bug class for every
consumer at once. It is additive and exposes nothing private — these are
public sports ids.

**Shipped.** Migration 0331 (`player_xref`, `_xref_for`, a re-emitted
`api_players`, and `league_player_ids` for signed-in clients),
`server/src/poll/xref.js` (daily, ~3,000 joinable rows out of the file's
12,264), `scripts/db/xref-probes.sql`. `check:publicapi` now scans every
migration from 0326 on, so a re-emission cannot quietly reintroduce the leak
its never-list exists to stop.

**Still open, second-order.** The same file makes `headshots.ts` refreshable
with a roster fallback for the rookie ESPN has not photographed yet. Not done
— it is a bake refresh, not a feature.

### 4. Injuries — KEEP ESPN

`get_injuries` is the nflverse weekly report (2009+), which is excellent
history and the wrong latency: it is the *filed* report, and our poller reads
ESPN's live one, which moves during the week and carries the comment and the
return date. StatHead is the better **backfill** if we ever want injury
history on the player card; it is not a replacement for the live feed.

The weekly projection feed also carries its own injury strip (`inj`) with an
explicit warning not to apply a prior week's designation to a later week. We
do not use it: our own ESPN designations are fresher and already drive the
lineup warnings.

### 5. News — KEEP ESPN, and it is the only real gap

StatHead publishes no headline feed. The player-tagged ESPN articles behind
`player_news` (v0.445.0) stay exactly as they are. If we ever wanted to ask
their dev team for something, this is the only item on the list — and it is
not obviously theirs to build.

### 6. Everything else this session is league-internal — NOTHING TO FILL IN

Trades (v0.437.0, v0.438.0, v0.444.0's undo), conditional waiver claims
(v0.439.0), league history (v0.440.0), awards and badges (v0.441.0), the
public API's league endpoints (v0.442.0, v0.443.0) and the store preparation
(v0.446.0) are all built out of *this league's own record* — who owns whom,
who bid what, who scored what. There is no external source of higher
fidelity, because there is no external source at all. The audit confirms it
rather than assuming it.

One near-miss worth naming: the **league history** surface computes records
from our stored weekly scores. That is correct and should stay correct — a
league's own history is definitionally its own data, and importing anybody
else's numbers into it would be a bug, not an upgrade.

### 7. Already StatHead, and left alone

`proj2026` (season projections), `projStats2026` / `projKdst2026` /
`projReturns2026` / `projIdp2026` / `projFb2026` / `projTeamRoles2026` (the
component lines the league-aware re-scoring divides by), `adp2026`, and
`dyn2026` (dynasty values). The audit's job here was to check the bakes were
still the best available shape, and they are — with one refresh note: every
one of these files carries an as-of line from August, and the underlying
files are rebuilt every two hours. **A rebake before the trade deadline is
worth a version on its own.**

---

## What is deliberately still open

* **A pre-deadline rebake** of the season/ADP/dynasty files (finding 7), and
  a headshot rebake off the crosswalk while it is open (finding 3).
* **Dues and payouts** — excluded by instruction, unrelated to this audit.
* **Trade auctions with anti-snipe** — still on the gap list, unrelated to
  this audit.

## How to refresh what this audit shipped

```
# the weekly feed the worker reads — no key, pinnable
curl -s https://raw.githubusercontent.com/dachhack/stathead/<ref>/public/data/weekly-projections-2026.json
npm run validate:weekmult        # proves the split still sums to the season line

# the pick board (MCP, author time)
get_dynasty_values { position: 'RDP', limit: 200, output_format: 'csv',
                     fields: 'player_name,value,superflexValue' }
# → paste into packages/core/src/data/pickValues2026.ts, update PICK_AS_OF
```

The worker's ref and host are `STATHEAD_REF` and `STATHEAD_RAW`; the feed is
cached for `STATHEAD_TTL_MS` (30 minutes by default) so one sweep fetches it
once however many weeks it is filling.
