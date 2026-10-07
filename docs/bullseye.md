# Bullseye — aim your lineup at a number

> **Status: v1 BUILT — a classic-league setting, off by default.** Spec written
> 2026-10-07 from the founder's brief ("have your players try to get as close
> as possible to a final total and/or totals for each spot are assigned (even
> numbers 5, 10, 15, 20) randomly by the CPU. Could do head to head and weekly
> ranked battles"), then "for classic mode", then "write it up as a spec in
> docs and get it going". Built the same day in migration
> `0446_bullseye.sql` + `packages/core/src/engine/bullseye.ts`; the open
> list worked the same day ("let's keep working on the open list") in
> `0447_bullseye_across_leagues.sql`, and the rest of it ("keep cooking") in
> `0448_bullseye_knobs.sql`. See §12 for exactly what shipped and §11 for
> what is still open. Founder's standing rules: **no power-ups in this
> mode**, and **any zero counts for the did-not-play rule**.
>
> Pairs with `docs/rulebook.md` (the game it sits beside) and the golf notes
> in migration `0200_golf_mode.sql` (the setting it is modelled on). §6's
> scenarios are the acceptance criteria and are asserted one-for-one in
> `scripts/check-bullseye.mjs` (engine) and `scripts/db/bullseye-probes.sql`
> (database).

## 1. The idea

Every other fantasy format asks one question: *how many points can you
score?* Bullseye asks a different one: **can you land on the number?**

Each week the CPU deals the league a **card** — a target for every starting
spot (round numbers: 5, 10, 15, 20 …). You fill the spot with the player from
your roster you think will finish *closest* to that number. Over is as bad as
under. A dart that lands within half a point is a **bullseye** and pays
double.

Why this belongs in a **classic** league specifically — three things the code
already does for classic, and nothing else does:

1. **Each starter locks at his own kickoff** (0178). A Thursday starter is
   final Thursday; your 1pm, 4pm, SNF and MNF starters each stay open until
   their own game. In the ONE TOTAL variant (§3) that is a live correction
   game: you watch the real number come in and re-aim what is still open,
   four or five times across a weekend. Nobody else can offer it.
2. **You aim with your own roster.** A drafted league means every dart comes
   from your bench. Depth becomes the resource, and a bench of boring 8-point
   bodies is suddenly a quiver. Bench players, waivers and FAAB get a purpose
   they never have in normal fantasy, where bench points are dead points.
3. **Lineups are public and the card is public.** Classic hides nothing
   (0178), so neither does bullseye: everyone sees the same card and
   everyone's lineup. No sealed-card variant here — that is drip's game.

And one thing it changes about what a player is *worth*: **floor beats
ceiling**. A kicker is a precision tool for a 5. A dull RB2 who always posts 8
is a star. That is a fresh skill axis — reading variance rather than chasing
a ceiling — and it is friendly to a new manager because the question each
week is small and concrete.

### Design goals
1. **A setting, not a mode.** Bullseye lives beside golf and best ball on a
   classic league: the roster builder, the scoring catalog, the draft, the
   waiver wire, the standings and the playoffs are all untouched. Only what a
   starter's points *mean* changes.
2. **One rule, everywhere.** The resolver, the auto-slot, the AI seats, the
   best-ball fill and both boards read the same card through the same engine
   module, so a board can never show a lead the resolver will score as a loss.
3. **Auditable.** The card is dealt from a seed (league, week), published to a
   table the whole league can read, and re-dealable to the same numbers.
4. **Nothing changes under a drafted roster.** Frozen at the draft like golf
   and the game mode (0157, 0200): you draft a bullseye league for floor, not
   ceiling, so flipping it mid-season would be a different league played with
   the wrong rosters.

### Hard guardrails
- **Any zero scores nothing** (founder: "we want any zero to count for the
  did not play rule"). A spot whose player posts 0.0 is a MISS no matter
  what the target was and no matter why — inactive, a healthy scratch, a
  receiver who drew no targets — or the 5 target is solved by starting an
  injured player. (Same philosophy as golf: a zero is an absence, not a low
  score.) An unfilled spot is a miss. A spot carrying the **zero-fill rule**
  (0200) banks its fill first, and the dart is thrown with the fill — that
  rule is the commissioner's own and says a blank is worth those points.
- **Golf and bullseye are mutually exclusive.** Lowest ring score winning
  would reward the worst aim; each setter refuses while the other is on.
- **Drip is untouched.** Nothing in this feature can reach a league whose
  `game_mode` isn't `classic`.

## 2. Definitions

| Term | Meaning |
|---|---|
| **Card** | The week's targets: one per starting spot (SLOTS variant) or one number for the lineup (TOTAL variant). Same card for every team in the league. |
| **Target** | A round number a spot is aiming at. Drawn from a per-spot-type set (§4). |
| **Distance** | `|points − target|`, in the league's own scoring. |
| **Radius** | How far a dart can land and still score (default **10** for a spot). At or beyond it a spot scores 0. |
| **Ring score** | What a spot banks. **Smooth** (default): `max(0, radius − distance)`, plus a **bullseye bonus** of `radius` when distance ≤ `radius / 20` (half a point at radius 10) — up to `2 × radius`, exactly double on the number, 19.5 at the edge of the band. **Fixed** (`bullseye_rings = 'fixed'`, v0.645.0): the darts-board reading — bullseye `2 × radius`, inner (≤ radius/5) `radius`, outer (≤ radius/2) `radius / 2`, nothing beyond. |
| **Bullseye / Inner / Outer / Edge / Miss** | The labels the boards print on a dart: distance ≤ radius/20 (0.5) / ≤ radius/5 (2) / ≤ radius/2 (5) / inside the radius / at or beyond it. Labels only — the score is the continuous formula above. |
| **Weekly total** | The sum of the lineup's ring scores. This is the matchup score: what `matchup.home_final` holds, what the standings sum, what the playoffs compare. Higher wins, as always. |

### Why a continuous score rather than fixed ring points
Fixed rings (50 / 25 / 10 / 0) read beautifully but tie constantly — a nine-
spot lineup with three outer rings is 30, and so is the other guy's. A
continuous `radius − distance` keeps every tenth of a point alive, makes
"closer" always better, and the cap at `radius` stops one 40-point explosion
aimed at a 10 from sinking the whole week any harder than a 20 would. The
bullseye bonus keeps the darts moment: landing inside half a point is an event,
and it doubles the spot.

## 3. The variants

**SLOTS** (`bullseye = 'slots'`, the default when turned on). Every starting
spot carries its own target. Independent darts; the week is the sum.

**HYBRID** (`bullseye = 'hybrid'`, v0.645.0). The SLOTS darts, plus the
lineup's raw sum thrown as one more dart at the card's total on the TOTAL
scale and divided by the spot count — so the tenth dart is worth exactly what
one spot is worth (up to `2 × radius`). A lineup that lands its parts *and*
its whole banks the most.

**TOTAL** (`bullseye = 'total'`). The card is dealt exactly the same way, but
only its **sum** is published: one number for the whole lineup. The lineup's
raw points are compared to it as a single dart with a wider radius
(`radius × starters`, so 90 for nine spots), scored by the same formula
(bullseye band = `radius × starters / 20`, i.e. 4.5 points). The SLOTS card is
still dealt underneath so the two variants aim at reachable numbers and a
league can flip between them pre-draft without the card changing shape.

Per-player locks make TOTAL the most skill-heavy version: after Thursday you
know you are 7 over, so you cool Sunday; after the 1pm games you re-tune 4pm,
SNF and MNF. The MNF starter is the last throw.

## 4. The deal — how a card is made

The card is **deterministic**: seeded by `(league_id, week)` through the same
mulberry32-over-FNV hash the pods use, so the worker, a board that has not yet
seen the published rows, a re-run and a probe all deal the same numbers.

Targets are drawn **per spot type** from the commissioner's own lineup
(`leagueSlotDefs` — the roster builder spec, else the 0161 counts, else the
default nine), each spot from the set for its type, weighted toward the middle
so a card is rarely all 20s or all 5s:

| Spot type | Targets (weight) |
|---|---|
| QB | 15 (2) · 20 (3) · 25 (3) · 30 (1) |
| SUPERFLEX | 10 (2) · 15 (3) · 20 (3) · 25 (1) |
| RB, WR, FLEX, REC FLEX | 5 (2) · 10 (3) · 15 (3) · 20 (1) |
| TE | 5 (3) · 10 (3) · 15 (1) |
| K | 5 (2) · 10 (3) · 15 (1) |
| D/ST | 5 (3) · 10 (3) · 15 (1) |
| DL, LB, DB, IDP FLEX | 5 (3) · 10 (3) · 15 (1) |
| RET | 5 (3) · 10 (1) |
| anything else | 5 · 10 · 15 (equal) |

Every target is a multiple of 5 and **never 0**: a zero target would ask for
a player who does nothing, which is the one thing the guardrail refuses to
reward.

**Shared or per team** (`bullseye_deal`, v0.645.0). SHARED (default): one
card for the league, every lineup aims at the same numbers. TEAM: every
roster is dealt its own card from its own seed (league, week, roster), so
two lineups in a matchup aim at different numbers — more varied, less fair.
The shared card is still dealt and published (the wire and a seat with no
roster read it), but no lineup is scored against it under a per-team deal.
The board prints both targets on a spot when they differ ("🎯 10 | 15"). The
engine keeps a *roster in focus* so a fill that asks for "the target of spot
S" with no roster in hand gets the right card: the resolver sets it before
each side, the auto-slot before each seat, a board before each side's
best-ball fill.

**When.** The worker publishes the card for the board week on every tick
(`bullseye_card`, keyed `(league_id, week, slot)`, upsert — idempotent). In
practice that is Tuesday morning, when Sleeper rolls the week, which puts the
card in front of the league **before Wednesday's waivers run**: "I need a
5-point TE" is a real claim. The TOTAL row is published as slot `TOTAL`.

**Anchored to the league's own scoring (v0.644.0).** The sets above are
tuned for full PPR and the stock catalog, so each is **scaled** by what the
league's catalog pays a *typical* season at that position against the stock
catalog — a canonical mid-tier stat line per position (QB, RB, WR, TE, a K
line, a DST line), scored under both, the ratio applied to every target and
rounded back to a multiple of 5 (never below 5; targets that round together
pool their weights). FLEX and REC FLEX price as WR, SUPERFLEX as QB; IDP,
RET and a custom mix stay stock. Derived from the catalog alone, never from
live data, so the deal stays reproducible from settings: a standard-scoring
league deals a lower card than a full-PPR one from the same seed, and a
six-point-passing-TD league asks more of its QB spot.

## 5. How a week scores

For each starting spot, in the lineup the resolver already fields
(`classicLineup`: manual picks, the unmanaged-seat fill, best-ball fills):

1. The spot's points, exactly as classic scores them today (`classicPoints`,
   flags, scoped rules, adjustments, the zero-fill rule) — this is the number
   the row shows, and it never changes.
2. If the points are **0**, or the spot has no target (a card that has not
   been dealt), the spot's ring score is **0**.
3. Otherwise `distance = |points − target|` and
   `ring = max(0, radius − distance) + (distance ≤ radius/20 ? radius : 0)`,
   rounded to a tenth.
4. The side's total is the sum of its ring scores. That total is what
   `matchup_state.home_score` / `away_score` carry live and what
   `matchup.home_final` / `away_final` stamp at the end.

Each slot row in `matchup_state.slot_scores` keeps its **raw** `score` and
gains an `aim` object: `{ target, dist, ring }`. The per-player number is
always the player's real fantasy points; the aim is beside it.

**Live.** Nothing scores before kickoff (a player at 0 is a miss until he
produces, which keeps the live total honest). A dart can get worse as the game
goes on — a garbage-time touchdown that blows a bullseye is the feature's
signature drama beat, and the boards should say so.

**Standings, playoffs, tiebreaks.** Untouched. Higher weekly total wins;
points-for is the sum of ring scores; nothing inverts.

## 6. Scenarios, played out

Each of these is a named case in `scripts/check-bullseye.mjs` (engine) and,
where the database is involved, `scripts/db/bullseye-probes.sql`.

1. **The deal is deterministic.** Dealing (league L, week 3) twice gives the
   same card; week 4 gives a different one; every target is a positive
   multiple of 5 from its spot type's set; the TOTAL is the sum.
2. **A dart scores by distance.** Target 10: 10.0 → 20 (bullseye); 10.4 →
   19.6 (bullseye); 10.6 → 9.4; 12 → 8; 15 → 5; 20 → 0; 50 → 0; 2 → 2.
3. **A zero is a miss.** Target 5, player posts 0.0 → 0, not 5.
4. **An unfilled spot is a miss.** No player, no zero-fill → 0, and no row.
5. **The zero-fill throws the dart.** Spot with `zero_pts: 10`, target 10,
   player posts 0 → the fill banks 10, the dart lands on 10 → 20.
6. **The lineup's raw points still show.** The slot row's `score` is the
   player's real points; `aim.ring` is the dart; the side total is the sum of
   rings, not of points.
7. **TOTAL is one dart.** Nine spots, card sum 110, radius 90: lineup posts
   110.0 → 180; 120 → 80; 200 → 0.
8. **Off means off.** A league with no bullseye setting resolves bit-for-bit
   as before — same totals, same rows, no `aim`.
9. **The fill aims.** Given a target of 10 and a roster with a 22-point WR
   and a 9-point WR, the unmanaged seat, the auto-slot and the best-ball fill
   all seat the 9. Across the whole lineup the fill is the assignment that
   maximises expected ring score, not projected points.
10. **The setter's rails** (probes): commissioner only; classic only;
    refused once the draft has started; refused while golf is on, and golf is
    refused while bullseye is on; `league_game_mode` reports it; the card
    reader returns the published rows to a member and nothing to a stranger.
11. **The week board** (probes): `bullseye_week_board(league, week)` ranks
    every team by its final ring total, highest first, with the raw points
    beside it.

## 7. Data model + RPCs

**`league.settings_json.bullseye`** — `'slots' | 'total' | 'hybrid'`, absent
when off. `bullseye_radius` — optional int 2..50, default 10.
`bullseye_rings` — `'continuous' | 'fixed'`, default continuous.
`bullseye_deal` — `'shared' | 'team'`, default shared. SQL stores the
sanitized values; the engine (`bullseyeConfigOf`) owns every default.

**`bullseye_card`**
```
league_id uuid  references league(id) on delete cascade
week      int
roster_id int     -- 0 = the shared card; a roster id under a per-team deal (0448)
slot      text   -- a starting spot's slot id (S1…, or QB/RB1… for 0161 leagues), or 'TOTAL'
target    numeric
dealt_at  timestamptz default now()
primary key (league_id, week, roster_id, slot)
```
RLS: members, commissioners and admins read; only the service role writes.

**RPCs**
- `set_league_bullseye(p_league_id, p_variant, p_radius, p_rings, p_deal)`
  — commissioner/admin; classic only; frozen at draft; refuses while golf is
  on; a null knob keeps its value; `null`/`'off'` on the variant clears every
  key. Returns `{ok, bullseye, radius, rings, deal}`.
- `set_league_golf` — one new rail: refused while bullseye is on.
- `league_game_mode` — carries `bullseye` and `bullseye_radius`.
- `bullseye_card(p_league_id, p_week)` — the published rows, members only.
- `bullseye_week_board(p_league_id, p_week)` — every team's final ring total
  for the week, ranked, with raw points beside it (the "weekly ranked" read).

**Engine** (`packages/core/src/engine/bullseye.ts`, pure, platform-free):
`bullseyeConfigOf(mode)`, `dealBullseyeCard(leagueId, week, slots, cfg)`,
`ringScore(points, target, radius)`, `applyBullseye(result, card, cfg)`,
`setLeagueBullseye / clearLeagueBullseye / leagueBullseye` (the per-league
install, same contract as `setLeagueGolf`), `aimFill(...)` (the per-pair
assignment every fill uses when the install is live).

**Worker** (`server/src/`): `modeOfSettings` carries `bullseye` +
`bullseye_radius`; the tick publishes the board week's card before auto-slot;
`resolve.js` installs the card beside golf before each classic resolve;
`lock.js` and the unmanaged-seat path aim through the install.

## 8. AI seats and the fill

Every automatic lineup — the Tuesday auto-slot for a human who hasn't opened
the app, the hourly re-plan of an AI seat, the unmanaged seat computed at
resolve, and a best-ball spot — asks the same question: **which player on this
roster is worth the most in this spot?** Under bullseye the honest answer is
the **expected ring score**, `radius − |projection − target|`, and it is a
per-pair number (a 9-point projection is gold in a 10 spot and nothing in a
25 spot). That is the assignment problem `assignByValue` already solves for
best ball, so under the install every fill routes through it with the aim as
the pair value. No new search.

A player on bye or ruled out projects 0, which is a miss, which is the lowest
value — so the fill benches him for a live body as it always has.

## 9. UI

**Commissioner (web `CommishDash` → League settings; app `CommishTools` →
Game mode card):** beside the HIGH / LOW golf pills, a 🎯 BULLSEYE row with
OFF / SLOTS / TOTAL. Disabled with the reason once the draft has started or
while golf is on.

**The lineup board (both hosts), when on:**
- a 🎯 BULLSEYE banner between the two totals, like golf's ⛳ LOW WINS;
- each spot shows its **target** ("🎯 10") and, once he has played, the
  distance and ring label ("−1.4 · INNER") beside his real points;
- TOTAL variant: the one target over the lineup, the running distance, and
  the spots still to play (the correction-loop readout).

**The week board:** a ranked list of every team's ring total for the week
(the `bullseye_week_board` read), reachable from the league's standings.

**The waiver wire (v0.644.0):** each free agent carries a FIT chip —
`🎯 10 · 1.2 off` — the spot he is eligible for whose target his projection
sits closest to, with the distance; bright inside a fifth of the radius,
hidden when he lands outside it. Published card first, dealt from the seed
until the worker has published. So the wire reads as "who lands on my 5".

**The darts board (v0.644.0):** under the league's standings on both hosts, a
🎯 panel for the open week: THIS LEAGUE (every team's final ring total,
ranked) or ALL LEAGUES (every team in every bullseye league that week). On
the cross-league view a stranger sees a team name and a number; a league's
name is said only to its own members, and roster ids never leave.

## 10. Rollout

1. Engine + checks (this PR). `check:bullseye` in the parity battery.
2. Migration 0446 + probes (this PR). Off everywhere; nothing changes for a
   league that never opens the setting.
3. Worker install + card publish (this PR).
4. Commissioner toggle + board readout on web and app (this PR, minimal).
5. Flip it on in a test league pre-draft; watch one full week: the card is
   published Tuesday, the auto-slot aims, the live board's total matches the
   worker's `matchup_state`, the finals stamp the ring totals.
6. Then the open questions.

## 11. Open questions (argue here)

Nothing open. The list as it was worked:

- **Projection-anchored draws** → anchored to the catalog (§4, v0.644.0).
- **Cross-league weekly ranked** → the darts board's ALL LEAGUES view (§9,
  v0.644.0), comparable by ring total rather than a shared card.
- **A per-team card** → `bullseye_deal = 'team'` (§4, v0.645.0).
- **Hybrid** → the third variant (§3, v0.645.0).
- **Rings as fixed points** → `bullseye_rings = 'fixed'` (§2, v0.645.0).
- **DNP vs zero** → settled by the founder: any zero counts (§1 guardrail).
- **Power-ups** → closed by the founder: none in this mode.

## 12. What v1 shipped (2026-10-07)

- `packages/core/src/engine/bullseye.ts` — the deal, the score, the install,
  the aim-aware fill. `resolveClassicMatchup` applies the installed card; the
  unmanaged-seat fill, `autoSlotPlan`'s callers and `bestballFillBy` aim
  through it.
- `supabase/migrations/0446_bullseye.sql` — the setting, the rails, the card
  table + reader, the week board, `league_game_mode`.
- Worker: `modeOfSettings`, the card publish in `tickContext`, the install in
  `resolve.js` and `lock.js`.
- `scripts/check-bullseye.mjs` (in `check:parity`) and
  `scripts/db/bullseye-probes.sql` (in the scratch runner).
- Web + app: the commissioner pills and the board's banner + per-spot aim.
- v0.644.0, the open list: the deal anchored to the league's catalog
  (`bullseyeScaleOf`, `scaledDraw`); the wire's FIT chip (`bullseyeFit`,
  both hosts); the darts board under the standings, this league or all
  leagues (`bullseye_global_board`, 0447; `HubDartsBoard` on web,
  `DartsBoard` in the app). Power-ups closed by the founder's rule.
- v0.645.0, the rest of the list: HYBRID; fixed rings; a card per team
  (`0448_bullseye_knobs.sql`; `setBullseyeRoster` / `bullseyeCardFor` in the
  engine; the worker publishes a card per enrolled seat and installs the two
  sides' cards; the boards install both sides' and print both targets; the
  wire aims at *your* card; SMOOTH / FIXED and SHARED / PER TEAM pills beside
  the variant on both hosts). The zero rule confirmed as "any zero".
