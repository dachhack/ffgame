// Seat assignment for a matchup's sealed picks (0199.2 — the vacated-seat
// ruling). sealed_pick rows key on the ACCOUNT that saved them, with no roster
// column, so a seat reassignment orphans its saved lineup: the rows stay in
// the table under the previous occupant's app_user_id. The founder's ruling is
// that saved picks belong to the SEAT — "score their saved picks" — so an
// orphaned lineup is adopted by the seat that plainly owns it, and the same
// rule runs in the worker's resolver and both hosts' boards (via
// getRevealedPicks), keeping what members watch equal to what scores.
//
// Adoption is deliberately conservative — only when unambiguous:
//   · ALL orphaned rows share ONE author (two departed managers = no way to
//     split them between the seats), and
//   · exactly ONE seat has no rows of its own (an occupant who saved a lineup
//     is never overridden by a predecessor's).
// Anything ambiguous is dropped from both display and scoring: a ghost lineup
// that can't be attributed shouldn't render as if it will score.

export interface SealedRowLike {
  app_user_id: string;
  locked: boolean;
}

export interface SeatAssignment<T> {
  home: T[];
  away: T[];
  /** Which seat (if either) adopted orphaned rows this pass. */
  adopted: 'home' | 'away' | null;
}

/** Split a matchup's sealed rows between its two seats by CURRENT occupant,
 *  adopting orphaned rows under the rule above. Rows from ambiguous orphan
 *  authors are omitted from both sides. */
export function assignSealedRows<T extends SealedRowLike>(
  rows: T[],
  homeUser: string | null | undefined,
  awayUser: string | null | undefined,
): SeatAssignment<T> {
  const home = rows.filter((r) => homeUser != null && r.app_user_id === homeUser);
  const away = rows.filter((r) => awayUser != null && r.app_user_id === awayUser);
  const orphans = rows.filter(
    (r) => (homeUser == null || r.app_user_id !== homeUser) && (awayUser == null || r.app_user_id !== awayUser),
  );
  if (orphans.length) {
    const authors = new Set(orphans.map((r) => r.app_user_id));
    if (authors.size === 1 && (home.length === 0) !== (away.length === 0)) {
      if (home.length === 0) return { home: orphans, away, adopted: 'home' };
      return { home, away: orphans, adopted: 'away' };
    }
  }
  return { home, away, adopted: null };
}
