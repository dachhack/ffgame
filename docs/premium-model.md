# Premium model — tiers, the spillover rule, and economics

_The monetization design of record (supersedes the simpler "$10 league unlock" sketch in
`analytics-plan.md`/`unit-economics.md`). Captures the rules, the entitlements model to
build, the events to measure it, and the break-even sensitivity._

## Tiers
| Product | Price | Grants |
|---|--:|---|
| **Personal premium** | **$5 / season** | Premium for **you**, in **every league** you're in (all your matchups). |
| **League premium** | **$30 / season** | Premium matchups for **everyone** in **one** league. |
| **Split-pay** | $30 ÷ members | Members each chip in $X toward a league's $30 unlock; flips on when the pool ≥ $30. |
| **Spillover** | free | If your opponent has premium for a matchup, **you get premium for that matchup too**. |

Commish can **disable premium matchups** for a league (purist/competitive preference).

Premium content = K/DST/IDP positions + the full power-up set + in-season special events.

## The resolution rule (one line, load-bearing)
A matchup resolves **premium** iff:

```
premium(match) = NOT commishDisabled(league)
                 AND ( leaguePremium(league)
                       OR userPremium(homeManager)
                       OR userPremium(awayManager) )
```

…and when premium, **BOTH sides get the full feature set.** A basic matchup is only
ever non-payer vs non-payer in a non-unlocked league.

## Why this is elegant: spillover = the no-pay-to-win guarantee
The spillover means **every premium matchup is symmetric** — both managers always have the
same feature set. There is *never* a premium-vs-basic game. That matters because the
playtester's core result is that **power-ups cancel in symmetric play** (standings r≈0.96
vs a no-power-up league): so premium buys a **richer experience, never a competitive edge.**
Pay-to-win is impossible by construction, which is exactly what makes charging for it
defensible. (It's also why a commish-disable is about *taste*, not *fairness* — track the
disable rate as a health signal, but it isn't fixing an imbalance.)

## The two engines, and a dynamic to expect
- **Growth engine — personal $5 + spillover.** A $5 holder turns every one of their weekly
  opponents premium for that week (spillover) → free trial + FOMO → conversion. Deliberately
  leaks a *taste* of premium to sell the habit.
- **Depth engine — $30 league unlock (often split).** Converts a whole league at once,
  bypassing the spillover equilibrium below.
- **Expect spillover to cap personal-tier penetration.** As payer density rises, non-payers
  get premium *free* more often → marginal reason to buy $5 falls. That's fine — it's why the
  **league unlock + split-pay is the real depth/revenue lever**; personal+spillover is the
  top-of-funnel. Price/UX should nudge engaged leagues toward the split ($30 ÷ 10 ≈ **$3/head**,
  cheaper than $5 personal *and* unlocks everyone — the best deal for a coordinated league),
  while $5 personal stays the frictionless solo / multi-league买 (covers N leagues at once).

## Entitlements — SCAFFOLDED (migration 0036 + server/src/premium.js)
Shipped as a scaffold (schema + the resolution rule + the worker helper + the gating seams);
the enforcement wiring, Stripe webhook, and paywall UI are the next implementation step.
- **`supabase/migrations/0036_premium_entitlements.sql`** — the tables below + RLS (member-
  scoped reads; entitlement writes are service-role only; the commish toggle is commissioner-
  gated), the read functions `user_premium` / `league_premium` / `matchup_premium` (the rule),
  and the mutations `grant_personal` / `grant_league` / `contribute_to_pool` (atomic split-pay
  funding) / `set_league_premium_disabled`.
- **`server/src/premium.js`** — `matchupPremium(id)` (fails *closed*), the grant helpers, the
  free-tier defaults, `premiumTier()` (cached read of the admin config), `gateFreePositions` /
  `gateFreePowerups` (take the tier's free lists), and the four documented integration seams
  (lock.js, resolve.js, the client paywall, the Stripe webhook).
- **`premium_tier` config (migration 0037) + super-admin control panel** — the FREE vs
  premium split for **positions** and **power-ups** is editable from the admin UI
  (`AdminPage` → PREMIUM TIER card → `admin_set_premium_tier`, admin-gated), stored globally,
  read by the worker (`premiumTier()`) and the client paywall. Defaults: free QB/RB/WR/TE +
  metric-swap/player-swap/momentum.

### Data model


```
entitlement   id · subject_type ('user'|'league') · subject_id · product ('personal'|'league')
              · season · source ('stripe'|'split'|'grant') · created_at · expires_at
league_pref   league_id · premium_disabled (bool, commish-set)
unlock_pool   league_id · season · target_cents (3000) · collected_cents · status
pool_contrib  pool_id · app_user_id · amount_cents · stripe_payment_id · created_at
```
- `userPremium(u)`  = any active `entitlement(user, u, personal, season)`.
- `leaguePremium(L)`= active `entitlement(league, L, league, season)` (set directly via $30, or
  when an `unlock_pool` reaches target → write the league entitlement).
- Resolution runs server-side in the worker at matchup build (alongside the sealed-pick
  reveal), so the feature set both clients see is authoritative — never client-trusted.
- **Spillover is computed, not purchased** — it's just the `OR` in the rule above; nothing to
  store. (Optional: log a `spillover_granted` event for analytics.)

## Break-even — pressure-testing "~1000 leagues"
Per-league/season revenue, avg 10 managers, `pL`=league-unlock rate, `pP`=personal rate among
managers in non-unlocked leagues:

```
R ≈ pL·$30 + 10·pP·$5·(1 − pL)
```

| Conversion | pL | pP | R / league | Break-even leagues (lean cost ≈ $12k/yr) |
|---|--:|--:|--:|--:|
| Low | 5% | 5% | ~$3.9 | ~3,100 |
| **Mid** | 15% | 12% | **~$9.6** | **~1,250** |
| High | 30% | 20% | ~$16 | ~750 |

**So "~1000 leagues to break even" ≈ the Mid scenario on a lean cost base** (free ESPN feed +
infra + a cheap commercial API + Stripe ≈ $12k/yr). It's a reasonable central estimate — but
the band is **~750–3,100**, and **conversion is the entire lever.** Two things to pin down:
1. **1000 *total* leagues (with conversion baked in) vs 1000 *paying*?** At Mid conversion,
   1000 *total* ≈ break-even. If you meant 1000 *paying*, revenue is ~3× higher and the cost
   base could be far richer.
2. **The cost base.** $12k/yr assumes no official feed / no marks-licensing minimums. Stay
   mark-free on the free feed and that holds; take on the official feed and break-even moves to
   the thousands (see `unit-economics.md`).

## What to instrument (so the pilot measures THIS model)
Events (constants in `src/app/analytics.ts`, `Ev.*`):
`premium_tier_viewed {tier}` · `premium_purchased {tier, amount}` · `spillover_granted` (a free
premium matchup) · `split_started` / `split_contributed {amount}` / `split_completed` ·
`commish_premium_toggled {on}` · plus the existing `gated_feature_attempted` (intent).
Funnels to watch: gated-intent → tier-viewed → purchased (by tier); spillover exposure →
later personal purchase (does the taste convert?); split started → completed.
