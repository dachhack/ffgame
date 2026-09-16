// WHICH SLOT DIDN'T SAVE (v0.394.2).
//
// Founder, staring at "⚠ NOT SAVED — Combo Drip is one per unlock — you own
// 1, buy another to field more" over a board reading SLOTS SET 8/8: "what's
// up with the not saved alert?"
//
// The live boards autosave the WHOLE lineup after every edit, and a Postgres
// upsert is one statement — so any row the database refuses rolls back every
// other row with it. One over-cap Combo Drip therefore blocked the entire
// lineup, on every retry, forever, while the counter (which reads local state)
// kept saying the board was full. The banner named the RULE and never the
// SLOT, so there was nothing to act on.
//
// This is the third time that shape has bitten. The code's own comments record
// the other two: a locked window once painted a permanent NOT SAVED banner
// over a fully-saved board, and the slot-cap trigger once made an 11-slot
// practice board "only keep 8". Both were patched with a targeted client-side
// filter, which is whack-a-mole — the next rule the client doesn't mirror does
// it again. `savePicksBestEffort` (liveApi) fixes the shape instead: when the
// batch is refused it re-sends the rows ONE AT A TIME, so every legal pick
// lands and only the genuinely illegal ones come back. This file turns those
// back into a line a manager can act on.

/** One row the server refused, and why. */
export interface FailedPick { win: string; slot: string; slug: string | null; error: string }

/** Window ids are fixed (nflSlate winMetaFor mints them), so a static map gives
 *  the board's own label without needing the week's slate in hand. */
const WIN_LABEL: Record<string, string> = {
  tnf: 'TNF', wed: 'WED', fri: 'FRI', sat: 'SAT', tue: 'TUE', mnf: 'MNF',
  am: 'SUN AM', early: 'SUN 1PM', late: 'SUN 4PM', snf: 'SNF',
  wk: 'LINEUP', ALL: 'LINEUP',
};
export const winLabelOf = (win: string): string => WIN_LABEL[win] ?? win.toUpperCase();

/** "SUN 1PM · S2" — where to look on the board. */
export const failedSlotLabel = (f: FailedPick): string => `${winLabelOf(f.win)} · ${f.slot}`;

/** The key both live boards index their picks by, so a caller can mark the
 *  offending slots in the UI rather than only printing them. */
export const failedSlotKey = (f: FailedPick): string => `${f.win}#${f.slot}`;

/** The banner. Names the slot FIRST (it is the actionable half) and keeps the
 *  server's own words for the reason, since the database is the authority on
 *  why. Returns null for an empty list so callers can assign it straight to a
 *  nullable error state. */
export function pickFailureNote(failed: FailedPick[]): string | null {
  if (!failed.length) return null;
  const where = failed.map(failedSlotLabel).join(', ');
  // One reason covers the common case (the same rule refusing several rows);
  // distinct reasons are worth showing in full, because the fix differs.
  const reasons = [...new Set(failed.map((f) => f.error.trim()).filter(Boolean))];
  const why = reasons.length === 1 ? reasons[0] : reasons.join(' · ');
  return failed.length === 1
    ? `NOT SAVED — ${where}: ${why}`
    : `${failed.length} SLOTS NOT SAVED — ${where}: ${why}`;
}
