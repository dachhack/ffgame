// ROSTER CHANGED (v0.285.0) — a one-line notice that a league's rosters moved,
// so a screen showing them can refresh without waiting out its poll.
//
// It exists because the DROP button left the roster list and moved into the
// PLAYER CARD, which is a module-level overlay: it has no parent to call, and
// the screen underneath it has no idea a drop happened. Both hosts poll their
// team screen every 15 seconds, so nothing was ever WRONG — but a roster that
// takes a quarter of a minute to notice you dropped somebody reads as a failed
// tap, and the manager taps again.
//
// Deliberately just a signal, not the change: listeners re-read from the
// server rather than trusting a payload, so a notice can never leave a screen
// showing something the database doesn't agree with.
type Listener = (leagueId: string) => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe. */
export function onRosterChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Fired by whoever completed an add, drop, claim, trade or spot move. */
export function notifyRosterChanged(leagueId: string): void {
  for (const fn of [...listeners]) {
    try { fn(leagueId); } catch { /* one bad listener must not stop the rest */ }
  }
}


// ── LEAGUE SETTINGS CHANGED (v0.297.1) ──────────────────────────────────────
// The same idea one level up: a commissioner's SETTINGS moved, so a panel
// showing a number derived from them can re-read.
//
// It exists for the founder's "roster size doesn't adjust when I change the
// roster spots above": the ROSTER destination draws two editors side by side —
// the lineup BUILDER (starting spots, bench / taxi / IR) and the roster RULES
// (roster size, position limits) — and the size in the second is DERIVED from
// the first. They are separate components with separate loads, so the builder
// could change the answer and the rules panel would go on printing the number
// it read on mount. Now the builder says so and the rules panel re-reads.
const settingsListeners = new Set<Listener>();

/** Subscribe to "this league's settings changed"; returns the unsubscribe. */
export function onLeagueSettingsChanged(fn: Listener): () => void {
  settingsListeners.add(fn);
  return () => { settingsListeners.delete(fn); };
}

/** Fired by whoever saved a setting another panel's numbers depend on. */
export function notifyLeagueSettingsChanged(leagueId: string): void {
  for (const fn of [...settingsListeners]) {
    try { fn(leagueId); } catch { /* one bad listener must not stop the rest */ }
  }
}
