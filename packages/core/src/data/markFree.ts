// Mark-free mode — hide NFL trademarks (team logos) and NFLPA likeness (player
// headshots) so the product can ship WITHOUT those licenses (docs/unit-economics.md).
// When on, the imagery resolvers in media.ts return null and the UI's existing fallbacks
// render generic position pills / team-abbreviation badges / initials instead — so no NFL
// marks appear anywhere. (Team abbreviations and player names are text/facts, kept.)
//
// Baked in, with three switches (first one set wins):
//   1. ?markfree=1 | ?markfree=0  URL param — THIS PAGE LOAD ONLY (=0 also clears
//      any stored flag). It used to persist, which was a footgun: one visit to a
//      shared/tested markfree link stripped imagery from that browser FOREVER —
//      and the demo silently looked broken ("where did the player photos go?").
//   2. setMarkFree(bool)          — the explicit admin toggle (persists).
//   3. VITE_MARK_FREE=true        — build-time env: the production "ship mark-free" switch.
// Default OFF (full imagery), so nothing changes until you flip a switch.
import { platform, storeGet, storeSet, storeRemove, env } from '../platform';
const KEY = 'drip:markFree';

function readInitial(): boolean {
  const q = platform().url.query().get('markfree');
  if (q != null) {
    const on = q !== '0' && q.toLowerCase() !== 'false';
    // ?markfree=0 is the antidote: also clear a previously-persisted flag.
    if (!on) storeRemove(KEY);
    return on;
  }
  const ls = storeGet(KEY);
  if (ls != null) return ls === 'true';
  return env('VITE_MARK_FREE') === 'true';
}

// Resolved LAZILY on first read, not at module scope: a host installs its
// platform adapter during boot, and this module can be pulled in by an import
// chain that runs before that. Reading eagerly would latch the neutral
// platform's answer (always false) and quietly disable the build-time switch.
let markFree: boolean | null = null;

/** Whether NFL marks/likeness should be hidden (imagery suppressed → generic fallbacks). */
export function isMarkFree(): boolean {
  if (markFree === null) markFree = readInitial();
  return markFree;
}

/** Flip mark-free mode at runtime (persists across reloads). */
export function setMarkFree(on: boolean): void {
  markFree = on;
  storeSet(KEY, String(on));
}
