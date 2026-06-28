# Unit economics — can $10/league/season clear the licensing costs?

_Order-of-magnitude planning, not quotes. Get real numbers from providers before
committing — and note some licenses may not even be *available* to a small startup, which
is an availability risk on top of cost. Companion to `commercialization-handoff.md` §11._

## The reframe that changes everything
You said "I need to pay for the real data feed." **Technically, to launch, you don't.** The
worker already reproduces NFL play-by-play from **ESPN's free endpoints at 99.58% validated
accuracy** (`scripts/espn/espnAdapter.mjs`, `pilot-2026-plan.md` §4). So the live feed is a
*legitimacy/availability/ToS* upgrade, not a capability gap. The two genuinely external,
genuinely expensive items are:

1. **A commercially-licensed real-time data feed** (replacing the ToS-risky free ESPN feed).
2. **NFL marks (logos/team names) + NFLPA likeness (headshots/names).**

Both are **high FIXED costs largely independent of revenue** — which is exactly what a
$10/league *volume* model cannot absorb early, and can absorb easily at scale.

## Rough cost ranges (annualized, get quotes)
| Item | Low (startup tier / API) | High (official / enterprise) | Notes |
|---|---|---|---|
| Real-time NFL PBP feed | **~$6k/yr** (a commercial sports-data API, e.g. SportsDataIO-class, ~$500/mo) | **$60k–180k+/yr** (Genius/Sportradar *official* NFL data) | Official real-time NFL data is gated + premium; a commercial API may be "good enough" to replace ESPN's ToS risk far cheaper |
| NFL team marks | — | **$tens of k+/yr** + minimum guarantees | Often not granted to tiny startups at all |
| NFLPA player likeness | **rev-share ~5–15%** | **$10k–50k+/yr** minimum guarantees | Via OneTeam Partners; **negotiate rev-share, not fixed minimums** |
| Compliance | **~$0** | (only if real-money) | The cosmetic/content F2P model avoids gambling regulation entirely |
| Infra | ~$0.4k/yr (pilot) | ~$13k–130k/yr (10k–100k MAU) | Live feed is free today, so infra is the only baseline cost |

## Breakeven, in paying leagues
Net revenue per paying league/season ≈ **$10 − Stripe (~$0.59) ≈ $9.40**.

| Cost layer you take on | Added fixed $/yr | Paying leagues just to cover it |
|---|--:|--:|
| **Launch: mark-free + free ESPN feed** | infra only (~$0.4–13k) | **~50–1,400** |
| + commercial real-time feed (cheap API) | +$6k | +~640 |
| + official real-time feed | +$60–180k | +~6,400–19,000 |
| + NFL/NFLPA as **fixed minimums** | +$10–100k | +~1,100–10,600 |
| + NFL/NFLPA as **rev-share** | −~10% margin (no threshold) | (just lower margin: net ≈ $8.40) |

**Fully licensed (official feed + marks as minimums): roughly 8,000–30,000 paying leagues**
to cover fixed costs — at ~10% league→paid conversion and ~10 managers/league, that's on the
order of **800k–3M users**. A Series-A-scale business, not a launch state.

## The answer
**Yes, the $10/league model can clear these — but only if you SEQUENCE and don't pre-pay the
big fixed costs:**

1. **Launch mark-free on the free ESPN feed.** Fixed costs ≈ infra only → breakeven at a few
   hundred paying leagues. The volume model works here comfortably and it's bootstrap-able.
   _Shipped: **mark-free mode** (`src/data/markFree.ts`) — when on, the imagery resolvers in
   `media.ts` suppress NFL team logos + player headshots and the UI falls back to generic
   position pills / abbreviation badges / initials (team abbrs + player names are text/facts,
   kept). Default OFF; flip via `VITE_MARK_FREE=true` (ship), `?markfree=1` (demo), or
   `setMarkFree()`. This is the concrete switch that makes the "launch without licenses" path
   real._
2. **Buy a cheap commercial real-time API** (~$500/mo) the moment ToS/availability risk on the
   free feed actually bites — ~640 paying leagues covers it. This kills the legal/uptime risk
   *without* official-NFL pricing.
3. **License marks/likeness only at scale, and as REV-SHARE not minimums.** A ~10% rev-share
   just trims margin (net ~$8.40/league) and scales with you; fixed minimums would need
   thousands of leagues before they pay off. Take the license once your paying-league volume
   makes it cheap per unit — funded by revenue, not before it.

The model's whole viability rests on the fact that **the only truly-required external cost (a
live feed) is already free and validated.** That lets you reach revenue mark-free, and turn the
expensive licenses into a *scale unlock* you buy with profit — at which point $9.40/league ×
thousands of leagues clears them with room to spare.

## Watch-items
- **Availability, not just price:** confirm NFL/NFLPA will license a product your size *at all*
  before assuming a number. Mark-free is the fallback that's always available.
- **Renew per season:** the per-season charge + in-season "special events" are what make the
  recurring revenue (and thus the rev-share licenses) pencil out.
- **Conversion is the unknown:** every number above scales with league→paid conversion. That's
  exactly what the pilot instrumentation (`analytics-plan.md`, `gated_feature_attempted`) is
  there to measure before you sign anything.
