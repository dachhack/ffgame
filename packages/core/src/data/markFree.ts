// Mark-free mode — hide NFL trademarks (team logos) and NFLPA likeness (player
// headshots) so the product can ship WITHOUT those licenses (docs/unit-economics.md).
// When on, the imagery resolvers in media.ts return null and the UI's existing fallbacks
// render generic position pills / team-abbreviation badges / initials instead — so no NFL
// marks appear anywhere. (Team abbreviations and player names are text/facts, kept.)
//
// Switches, first one that answers wins:
//   1. VITE_MARK_FREE=true        — build-time env: a build that ships mark-free.
//   2. GLOBAL switch (0395)       — site_pref.mark_free, flipped by a super admin.
//                                   On for everyone; nobody can opt back in.
//   3. ?markfree=1 | ?markfree=0  — URL param, THIS PAGE LOAD ONLY. It used to
//      persist, which was a footgun: one visit to a shared/tested markfree link
//      stripped imagery from that browser FOREVER.
//   4. PERSONAL switch (0395)     — app_user.mark_free, the gear's "just me"
//      toggle; follows the account to every device.
// Default OFF (full imagery).
//
// 2 and 4 live on the server but are read SYNCHRONOUSLY on every render, so they
// are cached in device storage (MMKV / localStorage) and refreshed by
// applyServerMarkFree() after boot. A device that has never synced falls back to
// its last cache, or off.
import { platform, storeGet, storeSet, env } from '../platform';

const KEY = 'drip:markFree';            // personal: cache of app_user.mark_free
const GLOBAL_KEY = 'drip:markFree:global'; // global: cache of site_pref.mark_free

const listeners = new Set<() => void>();

function buildForced(): boolean { return env('VITE_MARK_FREE') === 'true'; }
function globalCached(): boolean { return storeGet(GLOBAL_KEY) === 'true'; }

function resolve(): boolean {
  if (buildForced() || globalCached()) return true;
  const q = platform().url.query().get('markfree');
  if (q != null) return q !== '0' && q.toLowerCase() !== 'false';
  return storeGet(KEY) === 'true';
}

// Resolved LAZILY on first read, not at module scope: a host installs its
// platform adapter during boot, and this module can be pulled in by an import
// chain that runs before that. Reading eagerly would latch the neutral
// platform's answer (always false) and quietly disable the build-time switch.
let markFree: boolean | null = null;

function settle(): boolean {
  const next = resolve();
  const changed = markFree !== null && markFree !== next;
  markFree = next;
  if (changed) for (const l of listeners) l();
  return changed;
}

/** Whether NFL marks/likeness should be hidden (imagery suppressed → generic fallbacks). */
export function isMarkFree(): boolean {
  if (markFree === null) markFree = resolve();
  return markFree;
}

/** True when mark-free is on for everyone (build or global switch), so a
 *  personal "off" can't bring imagery back. The gear shows the switch locked. */
export function isMarkFreeForced(): boolean {
  return buildForced() || globalCached();
}

/** This device's copy of the personal preference (null = never set). */
export function personalMarkFree(): boolean | null {
  const v = storeGet(KEY);
  return v == null || v === '' ? null : v === 'true';
}

/** Global switch as last synced (not counting the build env). */
export function globalMarkFree(): boolean { return globalCached(); }

/** Set the personal preference on this device. Callers also save it to the
 *  profile (liveApi.setMyMarkFree) so it follows the account. Returns whether
 *  the effective mode changed. */
export function setMarkFree(on: boolean): boolean {
  storeSet(KEY, String(on));
  return settle();
}

/** Install the server's answer (liveApi.syncMarkFree). `mine` null = the
 *  account has no preference yet, and this device's copy is left alone.
 *  Returns whether the effective mode changed — the host re-renders (native)
 *  or reloads (web) on true. */
export function applyServerMarkFree(state: { global: boolean; mine: boolean | null }): boolean {
  storeSet(GLOBAL_KEY, String(!!state.global));
  if (state.mine != null) storeSet(KEY, String(state.mine));
  return settle();
}

/** Re-render when the effective mode flips; returns the unsubscribe. */
export function onMarkFree(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
