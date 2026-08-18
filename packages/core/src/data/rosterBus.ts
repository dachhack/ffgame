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
