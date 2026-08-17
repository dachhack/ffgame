// TENURE BANDS — "rookie", "1–3 years", and the rest, as one definition.
//
// The waiver wire filters on years of NFL experience, and so does the roster
// builder's per-spot filter (0172, `min_exp`/`max_exp`). Those two must agree
// about what a ROOKIE is, or a league can build a rookies-only spot and then
// fail to find its rookies in the pool.
//
// THE UNKNOWN RULE, and it is the whole reason this is a function rather than
// an inline comparison: `exp` is null for a player the pool has never been
// told about (a pre-0172 seed, or a name Sleeper's directory doesn't carry).
// An unknown answers NO to every band except ANY — the same no-guess rule
// `slotAllows` follows when a spot carries a tenure window. Including unknowns
// in "rookie" would quietly hand a rookies-only league a pool of veterans.

export type TenureBand = 'any' | 'rookie' | 'y1_3' | 'y4_7' | 'y8';

export const TENURE_BANDS: { id: TenureBand; label: string; short: string }[] = [
  { id: 'any', label: 'ANY TENURE', short: 'ANY' },
  { id: 'rookie', label: 'ROOKIES', short: 'ROOK' },
  { id: 'y1_3', label: '1–3 YEARS', short: '1–3' },
  { id: 'y4_7', label: '4–7 YEARS', short: '4–7' },
  { id: 'y8', label: '8+ YEARS', short: '8+' },
];

// Positions whose "players" are team units — a tenure band is meaningless for
// them, so they pass every band. THE SAME SET, THE SAME RULE as slotAllows'
// tenure-window exemption (engine/classic.ts): before v0.258.0 the two
// disagreed — the engine let a D/ST fill a rookies-only spot while this filter
// hid every D/ST from the ROOKIES chip, so the wire could never show you the
// units a rookies-only league's own spots would accept.
const TEAM_UNIT_POS = new Set(['K', 'DEF', 'HC', 'P']);

/** Does this player's accrued experience fall in the band? A rookie is exp 0 —
 *  the seasons ACCRUED, not the season they're in. Pass `pos` where you have
 *  it: a team unit (K/DST/HC/P) matches every band, exactly as slotAllows
 *  exempts them from a spot's tenure window. */
export function tenureMatches(band: TenureBand, exp: number | null | undefined, pos?: string | null): boolean {
  if (band === 'any') return true;
  if (pos && TEAM_UNIT_POS.has(pos.toUpperCase())) return true;
  if (exp == null || !Number.isFinite(exp)) return false;   // unknown proves nothing
  if (band === 'rookie') return exp === 0;
  if (band === 'y1_3') return exp >= 1 && exp <= 3;
  if (band === 'y4_7') return exp >= 4 && exp <= 7;
  return exp >= 8;
}
