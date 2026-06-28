// Mark-free mode — hide NFL trademarks (team logos) and NFLPA likeness (player
// headshots) so the product can ship WITHOUT those licenses (docs/unit-economics.md).
// When on, the imagery resolvers in media.ts return null and the UI's existing fallbacks
// render generic position pills / team-abbreviation badges / initials instead — so no NFL
// marks appear anywhere. (Team abbreviations and player names are text/facts, kept.)
//
// Baked in, with three switches (first one set wins):
//   1. ?markfree=1 | ?markfree=0  URL param — persisted; for live demos / flipping fast.
//   2. setMarkFree(bool)          — programmatic runtime toggle (persists).
//   3. VITE_MARK_FREE=true        — build-time env: the production "ship mark-free" switch.
// Default OFF (full imagery), so nothing changes until you flip a switch.
const KEY = 'drip:markFree';

function readInitial(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get('markfree');
    if (q != null) {
      const on = q !== '0' && q.toLowerCase() !== 'false';
      try { localStorage.setItem(KEY, String(on)); } catch { /* ignore */ }
      return on;
    }
    const ls = localStorage.getItem(KEY);
    if (ls != null) return ls === 'true';
  } catch { /* no window/storage (SSR/tests) */ }
  return import.meta.env?.VITE_MARK_FREE === 'true';
}

let markFree = readInitial();

/** Whether NFL marks/likeness should be hidden (imagery suppressed → generic fallbacks). */
export function isMarkFree(): boolean { return markFree; }

/** Flip mark-free mode at runtime (persists across reloads). */
export function setMarkFree(on: boolean): void {
  markFree = on;
  try { localStorage.setItem(KEY, String(on)); } catch { /* ignore */ }
}
