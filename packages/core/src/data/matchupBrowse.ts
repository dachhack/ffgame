// THE WEEK'S MATCHUPS AS A RING (v0.424.0). Founder: "a way in web and app for
// players to see the matchup view for all match ups in the league for every
// week … a chip that goes to the next matchup for that week."
//
// The classic board draws whatever seat it is handed on the LEFT, so walking
// the league is a question of which seat to hand it next. This module answers
// that from the week's matchup rows alone, so both hosts step through the same
// ring in the same order, and the chip can say where in it you are.
export interface BrowseRow { id: string; home_roster_id: number; away_roster_id: number }

/** The week's matchups in a stable, readable order — the lowest home seat
 *  first, id as the tiebreak — so every host walks the same ring. */
export function orderMatchups<T extends BrowseRow>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.home_roster_id - b.home_roster_id || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Where a seat's matchup sits in the ring (0-based), or -1 on a bye. */
export function matchupIndex(rows: BrowseRow[], seat: number | null | undefined): number {
  if (seat == null) return -1;
  return orderMatchups(rows).findIndex((m) => m.home_roster_id === seat || m.away_roster_id === seat);
}

/** "2/6" for the chip; "–/6" from a bye, where the seat is in no matchup. */
export function matchupOrdinal(rows: BrowseRow[], seat: number | null | undefined): string {
  const n = rows.length;
  const i = matchupIndex(rows, seat);
  return `${i < 0 ? '–' : i + 1}/${n}`;
}

/** The HOME seat of the next matchup after this seat's, wrapping at the end;
 *  the first matchup's from a bye (or an unknown seat); null with no rows.
 *  Home, so the browsed pair draws the way the schedule names it. */
export function nextMatchupSeat(rows: BrowseRow[], seat: number | null | undefined): number | null {
  const ring = orderMatchups(rows);
  if (!ring.length) return null;
  const i = matchupIndex(rows, seat);
  return ring[(i + 1) % ring.length].home_roster_id;
}
