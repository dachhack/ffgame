// Product analytics — a thin, dependency-free, provider-agnostic layer. Events flow to
// a pluggable SINK so the app is never coupled to a vendor: register a PostHog (or other)
// adapter at boot via registerSink(); until then events are logged in dev and dropped in
// prod (a small ring buffer flushes to the sink once it registers, so nothing fired during
// boot is lost). Every call is wrapped so analytics can never break the app.
//
// The event taxonomy + the freemium funnel this is built to measure live in
// docs/analytics-plan.md — keep the two in sync. Add events via the Ev constants.
import { APP_VERSION } from './version';

export type Props = Record<string, string | number | boolean | null | undefined>;

export interface AnalyticsSink {
  track(event: string, props?: Props): void;
  identify(id: string, traits?: Props): void;
}

// Canonical event names (string-constant'd to avoid typos; doc'd in analytics-plan.md).
export const Ev = {
  appOpen: 'app_open',
  sleeperConnected: 'sleeper_connected',
  screenView: 'screen_view',
  leagueOpened: 'league_opened',
  lineupSet: 'lineup_set',
  // guided demo funnel (the logged-out landing board)
  demoStep: 'demo_step',   // {step:'metric'|'power'} — advanced a decision step
  demoRun: 'demo_run',     // {star, metric, powerup} — hit RUN on the demo board
  demoQuickrun: 'demo_quickrun', // {placed} — one-tap RUN A LIVE WEEK (auto-picks) — the cold-traffic path
  powerupBought: 'powerup_bought',
  podJoined: 'pod_joined',       // {already, founded} — joined a public drop-in pod (solo path)
  // lead-capture funnel (the "request a code" modal — the demo's conversion)
  codeRequestOpened: 'code_request_opened',   // {platform} — modal shown
  codeRequested: 'code_requested',            // {platform, has_league_ref} — lead submitted (no PII)
  codeRequestFailed: 'code_request_failed',   // {error} — submit rejected
  // premium funnel (docs/premium-model.md; fire once the gating + entitlements ship)
  gatedFeatureAttempted: 'gated_feature_attempted', // tried K/DST/IDP/locked power-up → premium INTENT
  premiumTierViewed: 'premium_tier_viewed',         // {tier:'personal'|'league'}
  premiumPurchased: 'premium_purchased',            // {tier, amount}
  spilloverGranted: 'spillover_granted',            // a matchup went premium because the opponent paid
  splitStarted: 'split_started',                    // a league split-pay pool opened
  splitContributed: 'split_contributed',            // {amount}
  splitCompleted: 'split_completed',                // pool reached $30 → league unlocked
  commishPremiumToggled: 'commish_premium_toggled', // {on}
} as const;

// ── First-touch attribution ──────────────────────────────────────────────────
// Captured once from the FIRST visit's URL (utm_* params + referrer), persisted,
// and merged into every event so paid traffic (e.g. the Reddit ads) stays
// distinguishable from organic all the way down the funnel. First-touch by
// design: a later organic revisit must not overwrite the ad that found them.
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
const ATTR_STORE = 'drip.attribution.v1';
let attr: Props | null = null;

/** The visitor's first-touch attribution ({} when organic/direct with no referrer). */
export function attribution(): Props {
  if (attr) return attr;
  try {
    const saved = localStorage.getItem(ATTR_STORE);
    if (saved) { attr = JSON.parse(saved); return attr!; }
    const q = new URLSearchParams(window.location.search);
    const a: Props = {};
    for (const k of UTM_KEYS) { const v = q.get(k); if (v) a[k] = v.slice(0, 200); }
    const ref = document.referrer;
    if (ref && !ref.includes(window.location.hostname)) a.first_referrer = ref.slice(0, 300);
    if (Object.keys(a).length) { a.first_touch_at = new Date().toISOString(); localStorage.setItem(ATTR_STORE, JSON.stringify(a)); }
    attr = a;
  } catch { attr = {}; }
  return attr;
}

let sink: AnalyticsSink | null = null;
type Buffered = { kind: 'track'; event: string; props?: Props } | { kind: 'identify'; id: string; traits?: Props };
const buffer: Buffered[] = [];
const isDev = !!import.meta.env?.DEV;

/** Register the real provider (e.g. a PostHog adapter). Flushes any buffered events. */
export function registerSink(s: AnalyticsSink): void {
  sink = s;
  for (const e of buffer.splice(0)) {
    try { if (e.kind === 'track') s.track(e.event, e.props); else s.identify(e.id, e.traits); } catch { /* never throw */ }
  }
}

export function track(event: string, props?: Props): void {
  try {
    const a = attribution();
    const merged = Object.keys(a).length ? { ...a, ...props } : props;
    if (sink) { sink.track(event, merged); return; }
    if (isDev) console.debug('[analytics]', event, merged ?? {});
    if (buffer.length < 100) buffer.push({ kind: 'track', event, props: merged });
  } catch { /* never throw */ }
}

export function identify(id: string, traits?: Props): void {
  try {
    if (sink) { sink.identify(id, traits); return; }
    if (isDev) console.debug('[analytics] identify', id, traits ?? {});
    if (buffer.length < 100) buffer.push({ kind: 'identify', id, traits });
  } catch { /* never throw */ }
}

/** Call once at app boot. */
export function initAnalytics(): void {
  track(Ev.appOpen, { version: APP_VERSION });
}
