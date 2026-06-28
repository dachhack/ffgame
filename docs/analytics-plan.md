# Analytics & retention plan (pilot instrumentation)

> **DEFERRED (decided):** the analytics *layer* is shipped (`src/app/analytics.ts`), but
> wiring an actual provider (**PostHog** recommended) is parked for later — add
> `posthog-js` + `VITE_POSTHOG_KEY` and call `registerSink()` when ready (snippet below).
> Until then events log in dev and no-op in prod; nothing else depends on it.


_Goal: before spending on payments, licensing, or GTM, **measure whether people come
back** and **whether they want the paid tier**. This doc is the event taxonomy + what to
watch. The code is `src/app/analytics.ts` (a provider-agnostic layer) wired into the store._

> **Model of record:** see **`docs/premium-model.md`** — $5 personal / $30 league / split-pay
> / opponent **spillover** / commish-disable. The section below is the earlier simpler sketch;
> the premium-model doc supersedes the tier mechanics and the event list (`Ev.*` updated).

## Freemium model (the thing we're measuring toward)
Founder's proposal, which fits the game's structure unusually well:

- **Free tier:** QB/RB/WR/TE from your real league + a limited power-up set.
- **Paid ($10, upgrades the whole LEAGUE):** adds K/DST/IDP, the full power-up set, and
  special in-season events.

**Why it's a good fit (not just a guess):**
1. **Fair by construction — no pay-to-win.** Matchups are *within* a Sleeper league
   (they mirror the Sleeper schedule), and the upgrade is **league-wide** — so both sides
   of every game always have the *same* tier. The playtester's core result is that
   power-ups **cancel in symmetric play** (standings r≈0.96 vs a no-power-up league), so a
   paid league is internally fair and a free league is internally fair. Paid adds *breadth
   and content*, not raw advantage.
2. **The free tier is a complete, balanced game.** Skill-only (no K/DST) resolves at a
   **50.7% home win-rate** in the harness — internally fair and fun on its own. And under
   best-player fielding the AI benches K/DST anyway, so removing them barely changes optimal
   play: free feels whole, paid feels like *more*, not *un-crippled*.
3. **Lowest-friction monetization.** One buyer (the commish — already the league's
   organizer and natural payer) unlocks everyone. High conversion potential per league,
   built-in evangelist, $10 impulse price. IDP is already flag-gated (`IDP_ENABLED`) — a
   ready paid-content lever. "Special events" justify a **per-season** (recurring) charge.

**Recommendations / watch-items:**
- Price **per season** ($10/league/season), not one-time-forever — protects LTV; the
  special events are what make renewal feel earned.
- ARPU is **per league** (~$10 ÷ ~10 managers ≈ $1/manager/season) → this is a **volume
  model**. But unit economics are forgiving: the live feed is free (ESPN, 99.58%-validated)
  and infra is ~$25–30/mo at pilot scale, so a few hundred paying leagues clears costs.
- Tune the free power-up split with the playtester: include a couple of the *good* buffs
  (momentum/overtime/garbage-time are the EV winners) so free is fun, and reserve breadth
  (defensive/counter buffs, events) for paid — never gate so hard that free churns before
  it would ever convert.

## North Star & the metrics that matter
- **North Star: Weekly-Active Leagues** (a league with ≥1 manager who set a lineup that
  week). Fantasy is a weekly cadence; weekly retention is the whole game.
- **Activation:** % of imported leagues that reach *first lineup set* and *first matchup
  resolved*.
- **Retention:** week-N return rate of a weekly cohort (the curve that decides everything).
- **Monetization intent (leading indicator):** `gated_feature_attempted` rate — managers
  reaching for K/DST/IDP/locked power-ups is *demand for the paywall* before the paywall
  even converts. Watch this first; it tells you if the paid tier is wanted.
- **Conversion:** % of weekly-active leagues that upgrade.

## Event taxonomy
Implemented now (`src/app/analytics.ts`, `Ev.*`, wired in `src/app/store.tsx`):

| Event | Where | Funnel stage |
|---|---|---|
| `app_open` | `main.tsx` boot | acquisition |
| `sleeper_connected` + `identify(userId)` | `setSleeperUser` | acquisition |
| `screen_view {screen}` | `navigate` | (whole funnel) |
| `league_opened {live, teams}` | `loadSimLeague` | activation |
| `lineup_set {week, slots}` | `setLineup` | **activation** |
| `powerup_bought {id, price}` | `buyPowerup` | engagement |

To add as the gating/paywall ships (constants already defined):
| Event | Fire when |
|---|---|
| `gated_feature_attempted {feature}` | user tries to start a K/DST/IDP or a locked power-up — **the key intent signal** |
| `upgrade_prompt_shown {placement}` | a paywall nudge renders |
| `upgrade_viewed` | the upgrade screen opens (CommishDash) |
| `upgrade_started` | Stripe checkout begins |
| `upgrade_completed {leagueId, amount}` | payment succeeds (fire server-side from the worker for truth) |
| `league_upgraded` | the league flips to paid (server-side) |

Plus a `matchup_resolved` (server-side, from the worker) for the activation/retention truth
that doesn't depend on the client being open.

## Wiring a provider
The app is **not** coupled to a vendor — `analytics.ts` buffers events to a pluggable sink.
Recommended: **PostHog** (product analytics + funnels + retention cohorts; generous free
tier; self-hostable). At boot, register an adapter:

```ts
import posthog from 'posthog-js';
import { registerSink } from './app/analytics';
posthog.init(import.meta.env.VITE_POSTHOG_KEY, { api_host: 'https://us.i.posthog.com' });
registerSink({
  track: (e, p) => posthog.capture(e, p),
  identify: (id, t) => posthog.identify(id, t),
});
```

Until a key is set, events log in dev and no-op in prod — so instrumentation can land and
be reviewed before any vendor decision. Add `posthog-js` + `VITE_POSTHOG_KEY` when ready.
Server-side truth events (`matchup_resolved`, `upgrade_completed`) should post from the Fly
worker to PostHog's capture API so they don't depend on an open tab.

## Pilot read-out (what success looks like)
Run the closed pilot (`docs/pilot-2026-plan.md` step F) with this instrumented. Decision
gates, in order:
1. **Activation:** do most imported leagues set a lineup and resolve a matchup? (If not, the
   onboarding/first-run is the problem — fix before anything else.)
2. **Week-2/3 retention:** does a weekly cohort come back? This is the make-or-break curve.
3. **Intent:** is `gated_feature_attempted` firing — do people *want* K/DST/IDP/more
   power-ups? Only then is the $10 upgrade worth building payments for.
Don't build Stripe, licensing, or GTM until 1–2 clear.
