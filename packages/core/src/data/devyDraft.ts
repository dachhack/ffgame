// THE DEVY DRAFT (0411) — devy rounds at the end of the draft, and the picks
// that trade for them. Stated once for every host.
//
// A devy pick is a pick asset whose round is 100 + k (devy round k): rookie
// rounds are 1–10 and startup slots at most 99, so the number never collides
// and every trade path moves it unchanged. In a running draft the devy block
// starts at `devy_from` (an overall pick number) and every pick from there on
// is a college player.

export const DEVY_ROUND_BASE = 100;

/** Is this pick-asset round a devy round? */
export const isDevyPickRound = (round: number): boolean => round > DEVY_ROUND_BASE;

/** "R3" for a rookie round, "DEVY R1" for devy round 1. */
export const pickRoundLabel = (round: number): string =>
  isDevyPickRound(round) ? `DEVY R${round - DEVY_ROUND_BASE}` : `R${round}`;

/** The devy round (1-based) the pick at `overall` falls in, or null before
 *  the block (or in a draft without one). */
export function devyBlockRound(overall: number, teams: number, devyFrom: number | null | undefined): number | null {
  if (!devyFrom || !teams || overall < devyFrom) return null;
  return Math.floor((overall - devyFrom) / teams) + 1;
}

/** A board column's label: "R5" or, inside the block, "D1". `round` is the
 *  draft's own 1-based round. */
export function draftRoundLabel(round: number, teams: number, devyFrom: number | null | undefined): string {
  const k = devyBlockRound((round - 1) * teams + 1, teams, devyFrom);
  return k != null ? `D${k}` : `R${round}`;
}

/** The line the draft room shows under the round counter in the block. */
export function devyBlockLine(overall: number, teams: number, devyFrom: number | null | undefined, devyRounds: number | null | undefined): string | null {
  const k = devyBlockRound(overall, teams, devyFrom);
  if (k == null) {
    if (devyFrom && devyRounds) return `devy rounds start at pick ${devyFrom} — college players wait until then`;
    return null;
  }
  return `DEVY ROUND ${k}${devyRounds ? ` of ${devyRounds}` : ''} — college players only`;
}
