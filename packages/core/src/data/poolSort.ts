// HOW A LIST OF AVAILABLE PLAYERS IS ORDERED (v0.302.0, founder: "we also need
// sort by ADP and projected points in waivers and draftable players. Sort by
// ownership % would be good too").
//
// Every list of available players in this project — the waiver wire, the free
// agent pool, the draft room's board — has always been ordered by RANK, the
// number the pool was seeded with. Rank answers "who is best" in the abstract;
// it does not answer "who is going early", "who scores most this year", or
// "who has everyone else already taken", and those are three different
// questions a manager asks at three different moments.
//
// The four orders, and what each is FOR:
//
//   • RANK — the pool's own order. The default, and the one the draft board's
//     autopick follows, so a room that sorts by anything else still sees the
//     order the clock will take if it runs out.
//   • ADP  — consensus average draft position (adp2026). Ascending: earlier is
//     first. "Who is going before my next pick."
//   • PROJ — projected PPR points per game (proj2026). Descending. "Who scores
//     the most", which ADP only approximates.
//   • OWN  — the share of this platform's drafted leagues rostering him
//     (player_ownership, 0199). Descending. "Who does everybody else have."
//
// A player the source doesn't know sorts LAST in every order rather than
// first — an unknown ADP is not an ADP of zero, and a missing projection is
// not a projection of zero. The pool's rank breaks every tie, so two players
// the source can't separate stay in the order the league already agreed on.

import { ADP_2026 } from './adp2026';
import { PROJ_2026 } from './proj2026';

export type PoolSort = 'rank' | 'adp' | 'proj' | 'own';

export const POOL_SORTS: { id: PoolSort; label: string; hint: string }[] = [
  { id: 'rank', label: 'RANK', hint: "the pool's own order — what autopick follows" },
  { id: 'adp', label: 'ADP', hint: 'consensus average draft position, earliest first' },
  { id: 'proj', label: 'PROJ', hint: 'projected PPR points per game, highest first' },
  { id: 'own', label: 'OWN %', hint: 'share of drafted leagues rostering him' },
];

// THE LIVE MARKET OVERLAY (v0.306.1, founder: "let's do 1" — the live ESPN
// feed over the baked consensus). Same shape as every other per-league engine
// cache: a module map behind a synchronous getter, installed when a screen
// loads it and cleared on the way out.
//
// It OVERLAYS the bake rather than replacing it. `adp2026.ts` is a consensus
// blend (FantasyPros + Sleeper + FFC) and the feed is ESPN's own draft rooms —
// roughly 13 picks apart at the median — so a player the feed doesn't price,
// or every player when the feed is stale, keeps the consensus number instead of
// falling off the board. A poll failure should cost freshness, not the column.
let liveAdp: Record<string, number> | null = null;
export function setLiveAdp(m?: Record<string, number> | null): void {
  liveAdp = m && Object.keys(m).length ? m : null;
}
export function clearLiveAdp(): void { liveAdp = null; }
/** Is the board showing a live market right now? For the label that says so. */
export const adpIsLive = (): boolean => liveAdp != null;

export const adpFor = (slug: string): number | null =>
  liveAdp?.[slug] ?? ADP_2026.get(slug) ?? null;
export const projFor = (slug: string): number | null => PROJ_2026.get(slug) ?? null;

/** The value a row shows for the order it is sorted by — '—' when the source
 *  doesn't know him, which is also why he sorted last. */
export function poolSortValue(by: PoolSort, slug: string, rank?: number | null, own?: Record<string, number>): string {
  if (by === 'rank') return rank != null ? `#${rank}` : '—';
  if (by === 'adp') { const v = adpFor(slug); return v != null ? v.toFixed(1) : '—'; }
  if (by === 'proj') { const v = projFor(slug); return v != null ? `${v.toFixed(1)}/g` : '—'; }
  const o = own?.[slug];
  return o != null ? `${o}%` : '0%';
}

/** Order a list of available players. Stable, non-mutating, and rank always
 *  breaks the tie. `own` is the map `playerOwnership` returns (absent = the
 *  ownership order falls back to rank, rather than claiming everyone is 0%
 *  while the call is still in flight). */
export function sortPool<T extends { slug: string; rank?: number | null }>(
  rows: T[], by: PoolSort, own?: Record<string, number> | null,
): T[] {
  const rankOf = (r: T) => r.rank ?? Number.MAX_SAFE_INTEGER;
  if (by === 'rank') return [...rows].sort((a, b) => rankOf(a) - rankOf(b));
  if (by === 'own' && !own) return [...rows].sort((a, b) => rankOf(a) - rankOf(b));
  // Missing sorts last in every order: a key that pushes unknowns to the end
  // whichever direction the known values run.
  const key = (r: T): number => {
    if (by === 'adp') return adpFor(r.slug) ?? Number.MAX_SAFE_INTEGER;
    if (by === 'proj') { const v = projFor(r.slug); return v == null ? Number.MAX_SAFE_INTEGER : -v; }
    const o = own?.[r.slug];
    return o == null ? Number.MAX_SAFE_INTEGER : -o;
  };
  return [...rows].sort((a, b) => {
    const d = key(a) - key(b);
    return d !== 0 ? d : rankOf(a) - rankOf(b);
  });
}
