// Product analytics — a thin, dependency-free, provider-agnostic layer. Events flow to
// a pluggable SINK so the app is never coupled to a vendor: register a PostHog (or other)
// adapter at boot via registerSink(); until then events are logged in dev and dropped in
// prod (a small ring buffer flushes to the sink once it registers, so nothing fired during
// boot is lost). Every call is wrapped so analytics can never break the app.
//
// The event taxonomy + the freemium funnel this is built to measure live in
// docs/analytics-plan.md — keep the two in sync. Add events via the Ev constants.
import { APP_VERSION } from './version';
import { platform, storeGet, storeSet } from './platform';

export type Props = Record<string, string | number | boolean | null | undefined>;

export interface AnalyticsSink {
  track(event: string, props?: Props): void;
  identify(id: string, traits?: Props): void;
  /** Set person properties on WHOEVER the current person is, without touching
   *  the distinct id. This is the difference that matters: identify() with a
   *  new id SWITCHES users (two identified ids never merge in PostHog), so
   *  secondary handles — a Sleeper username, say — must land as traits on the
   *  signed-in person, not as a competing identity. Optional because a sink
   *  predating it should degrade to dropping traits, not crash. */
  setTraits?(traits: Props): void;
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
  demoSkip: 'demo_skip',         // {window} — jumped to the final whistle mid-playout (intent signal, not a failure)
  powerupBought: 'powerup_bought',
  podJoined: 'pod_joined',       // {already} — joined a public drop-in pod (solo path)
  weeklyJoined: 'weekly_joined', // {already, week} — joined this week's one-shot showdown
  podEntrySaved: 'pod_entry_saved', // {week, spent} — saved a salary-cap entry (DFS builder)
  dfsCreated: 'dfs_created',     // {teams} — approved commish founded a DFS league
  dfsJoined: 'dfs_joined',       // {already} — joined a DFS league by invite code
  // lead-capture funnel (the "request a code" modal — the demo's conversion)
  codeRequestOpened: 'code_request_opened',   // {platform} — modal shown
  codeRequested: 'code_requested',            // {platform, has_league_ref} — lead submitted (no PII)
  codeRequestFailed: 'code_request_failed',   // {error} — submit rejected
  soloPassIssued: 'solo_pass_issued',         // {waitlisted} — solo request auto-minted a pass (or hit the weekly cap)
  soloPassRedeemed: 'solo_pass_redeemed',     // {via:'link'|'manual'} — signed-in user claimed a pass, solo unlocked
  // premium funnel (docs/premium-model.md; fire once the gating + entitlements ship)
  gatedFeatureAttempted: 'gated_feature_attempted', // tried K/DST/IDP/locked power-up → premium INTENT
  premiumTierViewed: 'premium_tier_viewed',         // {tier:'personal'|'league'}
  premiumPurchased: 'premium_purchased',            // {tier, amount}
  spilloverGranted: 'spillover_granted',            // a matchup went premium because the opponent paid
  splitStarted: 'split_started',                    // a league split-pay pool opened
  splitContributed: 'split_contributed',            // {amount}
  splitCompleted: 'split_completed',                // pool reached $30 → league unlocked
  commishPremiumToggled: 'commish_premium_toggled', // {on}
  // social + league-life layer (the 0147–0150 sprint: chat, trades, push)
  chatOpened: 'chat_opened',              // {dm} — a chat surface came up (league channel or a DM thread)
  chatPosted: 'chat_posted',              // {kind:'text'|'gif'|'poll', dm, mentions} — message accepted by the server
  pollVoted: 'poll_voted',                // cast or changed a vote on a league poll
  chatPinned: 'chat_pinned',              // {on} — commish pinned/unpinned a message
  chatReacted: 'chat_reacted',            // {emoji} — a quick reaction toggled (0210)
  tradeProposed: 'trade_proposed',        // native league: offer sent
  tradeResponded: 'trade_responded',      // {action:'accept'|'reject'|'cancel'} — answered an offer
  waiverClaimed: 'waiver_claimed',        // {type:'waiver'|'fa'} — claim placed / free agent added
  draftPicked: 'draft_picked',            // made a pick in the draft room
  commishAction: 'commish_action',        // {tool:'note'|'flags'|'scoring'|'unflag'|...} — used a commish kit tool
  pushRegistered: 'push_registered',      // {granted} — push permission outcome (app-only; token registered when true)
  pushPrefSet: 'push_pref_set',           // {kind, muted} — flipped a per-kind push mute
  playerCardOpened: 'player_card_opened', // opened a player bio card
  playerStarred: 'player_starred',        // {on} — starred/unstarred a player (watchlist/trade signal)
  hubTileOpened: 'hub_tile_opened',       // {tile} — league home hub navigation
  // install funnel (the PWA "add to home screen" banner — src/app/pwa.ts)
  pwaInstallShown: 'pwa_install_shown',         // {ios} — banner rendered
  pwaInstallAccepted: 'pwa_install_accepted',   // took the native install dialog
  pwaInstallDeclined: 'pwa_install_declined',   // opened the dialog, said no
  pwaInstallDismissed: 'pwa_install_dismissed', // closed the banner (snoozed)
  pwaInstalled: 'pwa_installed',                // the browser confirmed the install
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
    const saved = storeGet(ATTR_STORE);
    if (saved) { attr = JSON.parse(saved); return attr!; }
    const q = platform().url.query();
    const a: Props = {};
    for (const k of UTM_KEYS) { const v = q.get(k); if (v) a[k] = v.slice(0, 200); }
    // `referrer()` is contracted to return EXTERNAL referrers only — each host
    // filters its own self-referrals, so an in-app navigation never overwrites
    // the ad that found the user.
    const ref = platform().url.referrer();
    if (ref) a.first_referrer = ref.slice(0, 300);
    if (Object.keys(a).length) { a.first_touch_at = new Date().toISOString(); storeSet(ATTR_STORE, JSON.stringify(a)); }
    attr = a;
  } catch { attr = {}; }
  return attr;
}

let sink: AnalyticsSink | null = null;
type Buffered =
  | { kind: 'track'; event: string; props?: Props }
  | { kind: 'identify'; id: string; traits?: Props }
  | { kind: 'traits'; traits: Props };
const buffer: Buffered[] = [];
const isDev = () => platform().isDev;

/** Register the real provider (e.g. a PostHog adapter). Flushes any buffered events. */
export function registerSink(s: AnalyticsSink): void {
  sink = s;
  for (const e of buffer.splice(0)) {
    try {
      if (e.kind === 'track') s.track(e.event, e.props);
      else if (e.kind === 'identify') s.identify(e.id, e.traits);
      else s.setTraits?.(e.traits);
    } catch { /* never throw */ }
  }
}

export function track(event: string, props?: Props): void {
  try {
    const a = attribution();
    const merged = Object.keys(a).length ? { ...a, ...props } : props;
    if (sink) { sink.track(event, merged); return; }
    if (isDev()) console.debug('[analytics]', event, merged ?? {});
    if (buffer.length < 100) buffer.push({ kind: 'track', event, props: merged });
  } catch { /* never throw */ }
}

export function identify(id: string, traits?: Props): void {
  try {
    if (sink) { sink.identify(id, traits); return; }
    if (isDev()) console.debug('[analytics] identify', id, traits ?? {});
    if (buffer.length < 100) buffer.push({ kind: 'identify', id, traits });
  } catch { /* never throw */ }
}

/** Attach person properties to the current person — identified or not — without
 *  changing who the events belong to. Use this for every handle that is NOT the
 *  canonical login id: identify() is reserved for the Supabase user id, which is
 *  the one id both hosts share (see docs/analytics-plan.md). */
export function setTraits(traits: Props): void {
  try {
    if (sink) { sink.setTraits?.(traits); return; }
    if (isDev()) console.debug('[analytics] setTraits', traits);
    if (buffer.length < 100) buffer.push({ kind: 'traits', traits });
  } catch { /* never throw */ }
}

/** Call once at app boot.
 *
 *  `launch` carries host-specific launch context merged into the app_open
 *  event — the web shell passes `{ standalone }` (launched from the home
 *  screen rather than a browser tab, so installs can be read as a retention
 *  cohort), and a native shell can pass its own equivalents. It's a parameter
 *  rather than something read here because the check is `window.matchMedia`,
 *  and core carries no browser globals; the host that knows how to answer is
 *  the host that should. */
export function initAnalytics(launch: Props = {}): void {
  track(Ev.appOpen, { version: APP_VERSION, ...launch });
}
