// HOW LONG HAS THIS OFFER GOT? (v0.437.0)
//
// Migration 0321 put two clocks on a trade: an offer may expire, and a trade
// out for a league vote closes its window at a fixed moment. Both want the
// same sentence — a rough, glanceable "how much longer" rather than a
// timestamp, because nobody reads "expires 2026-09-23T14:00Z" as urgency.
//
// Shared rather than written twice, for the reason waiverClock.ts is: the web
// row and the app row disagreeing about whether an offer has a day left is
// the kind of difference nobody notices until somebody misses a deadline.

/**
 * "6h left", "42m left", "2d left", "closing now" — and null when there is no
 * clock at all, so a caller can render nothing rather than a guess.
 *
 * Rounded DOWN on purpose: an offer with 59 minutes on it says "59m left",
 * not "1h", because the number a manager acts on should never be generous.
 */
export function fmtTimeLeft(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const left = ms - nowMs;
  if (left <= 0) return 'closing now';
  const mins = Math.floor(left / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.floor(hours / 24)}d left`;
}

/** The vote so far on a trade out for league review (0321). */
export function voteTally(votes: { roster_id: number; veto: boolean }[] | undefined) {
  const list = votes ?? [];
  return { vetoes: list.filter((v) => v.veto).length, allows: list.filter((v) => !v.veto).length, cast: list.length };
}
