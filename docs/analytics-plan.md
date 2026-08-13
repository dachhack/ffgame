# Analytics & retention plan (pilot instrumentation)

> **STATUS:** the layer is `packages/core/src/analytics.ts` (provider-agnostic) and
> **PostHog is wired on both hosts** — web via `posthog-js` in `src/main.tsx`, native via
> `apps/mobile/src/analytics.native.ts` ("The native app" below). Both are gated on
> `VITE_POSTHOG_KEY`: without it events log in dev and no-op in prod, and nothing else
> depends on them. Still open: the server-side truth events from the worker.


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
| `app_open {version, standalone}` | `main.tsx` boot — `standalone` = launched from an installed home-screen icon rather than a browser tab | acquisition |
| `sleeper_connected` + `setTraits({sleeper_username, sleeper_user_id})` | `setSleeperUser` — traits, never `identify()`: the Sleeper id must not compete with the Supabase id for who the person IS | acquisition |
| `screen_view {screen}` | `navigate` | (whole funnel) |
| `league_opened {live, teams}` | `loadSimLeague` | activation |
| `lineup_set {week, slots}` | `setLineup` | **activation** |
| `powerup_bought {id, price}` | `buyPowerup` | engagement |
| `demo_step {step}` | `DemoBoard` — advanced a guided decision step | acquisition |
| `demo_run {star, metric, powerup}` | `DemoBoard` — hit RUN on the landing demo | acquisition |
| `demo_quickrun {placed}` | `DemoBoard` — one-tap RUN A LIVE WEEK (auto-picks); always precedes its `demo_run` | acquisition |
| `code_request_opened {platform}` | `RequestCodeModal` mount (any entry point) | **conversion** |
| `code_requested {platform, has_league_ref}` | lead submitted — no PII in the event | **conversion** |
| `code_request_failed {error}` | submit rejected | conversion |
| `pod_joined {already}` | `LiveOnboard` — one-tap seat in a public drop-in pod (solo path, 0089) | **activation** |
| `weekly_joined {already, week}` | `LiveOnboard` — one-tap seat in this week's one-shot showdown (0090) | **activation** |
| `pod_entry_saved {week, spent}` | `PodBuilder` — saved a salary-cap entry (DFS builder, 0092) | **activation** |
| `dfs_created {teams}` | `LiveOnboard` — approved commish founded a DFS league (0094) | acquisition |
| `dfs_joined {already}` | `LiveOnboard` — joined a DFS league by invite code (0094) | **activation** |
| `pwa_install_shown {ios}` | `InstallPrompt` — the add-to-home-screen banner rendered | retention |
| `pwa_install_accepted` / `pwa_install_declined` | the native install dialog's outcome (Chromium only) | retention |
| `pwa_install_dismissed` | banner closed — snoozed 45 days | retention |
| `pwa_installed` | the browser confirmed an install (`appinstalled`) | **retention** |

Every event also carries the visitor's **first-touch attribution** (`utm_source` /
`utm_medium` / `utm_campaign` / `utm_content` / `utm_term` + `first_referrer` +
`first_touch_at`), captured on the first load and persisted (`analytics.ts
attribution()`). The same object is stored on the lead row itself
(`code_request.attribution`, migration 0088) so admin triage can see which channel
produced each league request — this is what makes the paid-ads spend (e.g. Reddit,
`?utm_source=reddit&utm_campaign=...`) measurable end to end. First-touch by design:
a later organic revisit doesn't overwrite the ad that found them.

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

### The native app
The Expo app reports through the **same** core layer and the **same** `VITE_POSTHOG_KEY`
(read from `expo.extra` — see `apps/mobile/app.config.js`), so one token covers both hosts
and a person who uses the phone and the browser is one person, not two: both call
`identify()` with the **Supabase user id** — the web in `LiveOnboard` on session load, the
app in `App.tsx` — and both attach the account email as a person trait so the person shows
as a name in PostHog rather than a UUID. That id is the ONLY thing ever passed to
`identify()`; every other handle (the Sleeper username) goes through `setTraits()`, because
two identified ids never merge in PostHog — identifying with a second id doesn't enrich the
person, it silently splits them in two. (That was a real bug: the web used to identify with
the Sleeper user id, so the same human was one person on the phone and a different one in
the browser. Persons split before the fix stay split — PostHog can't merge two identified
ids retroactively — but all events after it land on the Supabase-id person.)

The sink is `apps/mobile/src/analytics.native.ts` — a dependency-free POST to PostHog's
`/batch/` capture API rather than `posthog-react-native`, which would drag in a native
dependency chain this app deliberately doesn't carry (it stores through MMKV) and would
mean a fresh build on every playtester's phone before a single event arrived. It batches
(10s / 20 events), flushes on backgrounding, requeues 5xx and network failures, drops 4xx,
and caps the queue at 200 so a long offline stretch can't grow without bound. Anonymous
events carry `$process_person_profile: false`, mirroring the web's `identified_only`.

| Event | Where (native) |
|---|---|
| `app_open {version, native:true}` | `index.ts` boot — `native` is what separates app traffic from web/PWA |
| `screen_view {screen}` | `App.tsx`, from the derived screen (`signin`/`leagues`/`picks`/`demo`/`commish`/`admin`) |
| `league_opened {live:true}` | opening a league from `Leagues` — the app has no sim leagues, so it's always live |
| `lineup_set {week, slots}` | `LivePicks` autosave, after the server accepts |
| `powerup_bought {id, price, practice}` | `ShopModal`, after `wallet_buy_powerup` returns ok |
| `gated_feature_attempted {feature}` | free — it fires from `premiumClient` in core, which both hosts share |

Native has no referrer and no UTM params, so first-touch attribution is empty there by
design (`platform.native.ts` returns `''`); install attribution is the store's problem.

## Pilot read-out (what success looks like)
Run the closed pilot (`docs/pilot-2026-plan.md` step F) with this instrumented. Decision
gates, in order:
1. **Activation:** do most imported leagues set a lineup and resolve a matchup? (If not, the
   onboarding/first-run is the problem — fix before anything else.)
2. **Week-2/3 retention:** does a weekly cohort come back? This is the make-or-break curve.
3. **Intent:** is `gated_feature_attempted` firing — do people *want* K/DST/IDP/more
   power-ups? Only then is the $10 upgrade worth building payments for.
Don't build Stripe, licensing, or GTM until 1–2 clear.
