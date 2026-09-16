// 🧪 REHEARSAL TOOLS, off unless asked for (v0.393.5).
//
// Founder, a week into the season, looking at "REHEARSAL · v0.393.4 week 1 ·
// DONE" on a real league's board: "let's get rid of all these rehearsals or
// make them just for me." The strip was already the server's to grant
// (sim_run_state answers 'forbidden' to anyone but a super-admin) and only
// showed on 🧪 LIVE TEST leagues — but every league the founder ever
// rehearsed in stays flagged, and the founder is the admin. So the strip is
// now ALSO behind a per-device switch that defaults to off: the gear shows
// "🧪 REHEARSAL TOOLS" to an admin, and the boards stay clean until it is on.
import { storeGet, storeSet } from '../platform';

const KEY = 'rehearsal:tools';
const listeners = new Set<() => void>();

export function rehearsalToolsOn(): boolean { return storeGet(KEY) === '1'; }
export function setRehearsalTools(on: boolean): void {
  storeSet(KEY, on ? '1' : '');
  for (const l of listeners) l();
}
/** Re-render when the switch flips; returns the unsubscribe. */
export function onRehearsalTools(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
