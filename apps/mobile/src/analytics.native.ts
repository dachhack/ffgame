// The native host's analytics sink: core's `track()` / `identify()` calls, sent
// to PostHog over its public HTTP capture API.
//
// WHY NOT posthog-react-native: it pulls in a native dependency chain
// (async-storage / device-info) that this app deliberately does not carry — it
// stores through MMKV (see platform.native.ts) — and adding a native module
// means every playtester needs a fresh build before a single event arrives.
// The capture API is a plain JSON POST, so the sink below is dependency-free,
// works in the builds already on people's phones, and matches core's contract
// exactly: register a sink, core does the rest (packages/core/src/analytics.ts).
//
// Enabled ONLY when a project token is configured (VITE_POSTHOG_KEY, the public
// phc_ ingestion token — same key name as the web build reads, so one value
// configures both hosts). Unset = every call below is a no-op and nothing is
// sent, which is what a playtester build with no env should do.
//
// Event taxonomy: docs/analytics-plan.md. Add events via core's `Ev` constants.
import { AppState, Platform as RNPlatform } from 'react-native';
import { registerSink, type AnalyticsSink, type Props } from '@drip/core/analytics';
import { APP_VERSION } from '@drip/core/version';
import { env, storeGet, storeSet } from '@drip/core/platform';

// US cloud, same as the web build. Overridable for an EU project or a
// self-hosted instance without touching code.
const DEFAULT_HOST = 'https://us.i.posthog.com';

// Batching: events are queued and posted together. A phone on a stadium's
// cell network is the expected environment, so one request per event would be
// both slow and lossy.
const FLUSH_MS = 10_000;      // idle flush — an event never sits longer than this
const FLUSH_AT = 20;          // …or as soon as this many are waiting
const MAX_QUEUE = 200;        // hard cap: a long offline stretch must not grow without bound
const REQUEST_MS = 10_000;    // a hung request must not pin the queue forever

const ID_STORE = 'drip.analytics.did.v1';   // the anonymous device id, persisted
const USER_STORE = 'drip.analytics.uid.v1'; // the identified user id, once known

/** A random id for a device that has never been seen. Not a UUID (Hermes has no
 *  `crypto.randomUUID`) and doesn't need to be — it only has to be unique per
 *  install, which 128 bits of Math.random comfortably is for this scale. */
function randomId(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  return s;
}

// `distinct_id` is sent BOTH top-level and inside properties. The batch API
// documents it on properties; several PostHog ingestion paths read the
// top-level field. Sending both is a few bytes and removes the question.
type Payload = { event: string; distinct_id: string; properties: Record<string, unknown>; timestamp: string };

class PostHogSink implements AnalyticsSink {
  private queue: Payload[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private sending = false;
  /** The id every event is attributed to: the device id until sign-in, the
   *  user id afterwards. Persisted, so a returning launch is already the
   *  identified person rather than a new anonymous one. */
  private distinctId: string;
  /** The device id, kept even after identify() — it is what `$identify` links
   *  the person back to, so the pre-sign-in events aren't stranded on an
   *  orphan profile. */
  private readonly deviceId: string;
  /** One per app launch, so PostHog can group a visit's events. */
  private readonly sessionId = randomId();
  private identified: boolean;

  constructor(private readonly key: string, private readonly host: string) {
    this.deviceId = storeGet(ID_STORE) ?? (() => { const id = randomId(); storeSet(ID_STORE, id); return id; })();
    const saved = storeGet(USER_STORE);
    this.identified = !!saved;
    this.distinctId = saved ?? this.deviceId;
  }

  track(event: string, props?: Props): void {
    this.enqueue(event, { ...props });
  }

  identify(id: string, traits?: Props): void {
    if (!id) return;
    const wasAnon = !this.identified || this.distinctId !== id;
    const previous = this.distinctId;
    this.distinctId = id;
    this.identified = true;
    storeSet(USER_STORE, id);
    // `$identify` with `$anon_distinct_id` is what merges the device's earlier
    // anonymous events into the person — send it only on the transition, since
    // re-aliasing an already-identified id on every launch is noise.
    this.enqueue('$identify', {
      ...(traits ? { $set: { ...traits } } : {}),
      ...(wasAnon && previous !== id ? { $anon_distinct_id: previous } : {}),
    });
  }

  setTraits(traits: Props): void {
    // `$set` is PostHog's dedicated set-person-properties event — it updates
    // whoever `distinct_id` currently is without any identity change, which is
    // exactly the contract core's setTraits() promises.
    this.enqueue('$set', { $set: { ...traits } });
  }

  private enqueue(event: string, props: Record<string, unknown>): void {
    this.queue.push({
      event,
      distinct_id: this.distinctId,
      properties: {
        ...props,
        distinct_id: this.distinctId,
        $session_id: this.sessionId,
        $device_id: this.deviceId,
        // Mirrors the web's `person_profiles: 'identified_only'`: an anonymous
        // device's events are still counted, but don't each mint a person.
        ...(this.identified ? {} : { $process_person_profile: false }),
        $app_version: APP_VERSION,
        $os: RNPlatform.OS === 'ios' ? 'iOS' : 'Android',
        $os_version: String(RNPlatform.Version),
        $device_type: 'Mobile',
        $lib: 'drip-native',
        $lib_version: APP_VERSION,
      },
      // Stamped at enqueue, not at send: a batch that waited out a tunnel must
      // report when the tap happened, not when the signal came back.
      timestamp: new Date().toISOString(),
    });
    // Drop the OLDEST when full. The newest events describe what the user is
    // doing now, which is the part worth keeping.
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
    if (this.queue.length >= FLUSH_AT) void this.flush();
    else this.schedule();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, FLUSH_MS);
  }

  /** Post everything queued. Safe to call at any time; never throws. */
  async flush(): Promise<void> {
    if (this.sending || !this.queue.length) return;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const batch = this.queue.splice(0);
    this.sending = true;
    try {
      const ctl = new AbortController();
      const kill = setTimeout(() => ctl.abort(), REQUEST_MS);
      try {
        const res = await fetch(`${this.host}/batch/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: this.key, batch }),
          signal: ctl.signal,
        });
        // 4xx means PostHog rejected the payload itself (bad key, malformed
        // event) — retrying would only replay the same rejection forever, so
        // those are dropped. 5xx and network errors are transient: requeue.
        if (!res.ok && res.status >= 500) this.requeue(batch);
      } finally {
        clearTimeout(kill);
      }
    } catch {
      this.requeue(batch);
    } finally {
      this.sending = false;
      if (this.queue.length) this.schedule();
    }
  }

  /** Put a failed batch back at the FRONT — it is older than whatever arrived
   *  while it was in flight, and the cap still applies. */
  private requeue(batch: Payload[]): void {
    this.queue.unshift(...batch);
    if (this.queue.length > MAX_QUEUE) this.queue.splice(0, this.queue.length - MAX_QUEUE);
  }
}

let sink: PostHogSink | null = null;

/** Register PostHog as core's analytics sink, if this build has a token.
 *
 *  Call once at boot, AFTER the platform adapter is installed (it reads env and
 *  storage through it) and BEFORE `initAnalytics()`. Returns whether analytics
 *  is actually on, so a caller can log it in dev; there is no other observable
 *  difference — with no token, core keeps buffering to nowhere exactly as it
 *  did before, and no network call is ever made. */
export function initNativeAnalytics(): boolean {
  if (sink) return true;
  const key = env('VITE_POSTHOG_KEY');
  if (!key) return false;
  const host = (env('VITE_POSTHOG_HOST') || DEFAULT_HOST).replace(/\/+$/, '');
  sink = new PostHogSink(key, host);
  registerSink(sink);

  // Backgrounding is the app's last reliable moment: iOS can suspend the
  // process without further warning, and anything still queued dies with it.
  AppState.addEventListener('change', (state) => {
    if (state !== 'active') void sink?.flush();
  });
  return true;
}
