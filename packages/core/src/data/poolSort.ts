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
//   • PROJ — projected points per game, UNDER THIS LEAGUE'S RULES as of
//     v0.310.0 (see below). Descending. "Who scores the most", which ADP only
//     approximates.
//   • OWN  — the share of this platform's drafted leagues rostering him
//     (player_ownership, 0199). Descending. "Who does everybody else have."
//
// A player the source doesn't know sorts LAST in every order rather than
// first — an unknown ADP is not an ADP of zero, and a missing projection is
// not a projection of zero. The pool's rank breaks every tie, so two players
// the source can't separate stay in the order the league already agreed on.

import { ADP_2026 } from './adp2026';
import { PROJ_2026 } from './proj2026';
import { projectedPoints } from '../engine/projScoring';

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
// THE PROJECTION IS THE LEAGUE'S, NOT THE BAKE'S (v0.310.0, founder: "so we
// can apply scoring changes to the projections in waivers, drafts and the
// matchup board by league and position?"). It could not: v0.308.0 built the
// league-aware projection and v0.309.0 made it exact, but the only surface
// wired to it was the matchup board's lineup rows. Every pool — waiver wire,
// free agents, the draft room — still sorted and displayed the raw PPR bake, so
// a TE-premium league ranked its tight ends as though it paid nothing extra.
//
// `projectedPoints` reads the catalog the screen installed, so this is the same
// number the board shows for the same player. NO SLOT is passed: a player in a
// pool is not in a lineup, and `scopedAdjustFor` stands a spot-scoped rule aside
// where there is no spot.
//
// NULL STILL MEANS UNKNOWN. `projectedPoints` returns 0 for a player the bake
// has never heard of, and 0 would sort him at the BOTTOM of a descending list
// next to genuinely worthless players — the same claim-from-absence this file
// opens by refusing. So the presence check comes from the bake, and only a
// player it knows gets a number at all.
export const projFor = (slug: string, pos?: string | null): number | null =>
  PROJ_2026.has(slug) ? projectedPoints({ id: slug, pos: pos ?? '', team: null }) : null;

/** One row of any available-player list: the shape both the order and the
 *  displayed value are derived from. `pos` is what makes the projection the
 *  league's — a position premium cannot be applied to a player whose position
 *  we were not told. */
export interface PoolRow { slug: string; pos?: string | null; rank?: number | null }

/** The value a row shows for the order it is sorted by — '—' when the source
 *  doesn't know him, which is also why he sorted last. */
export function poolSortValue(by: PoolSort, row: PoolRow, own?: Record<string, number>): string {
  if (by === 'rank') return row.rank != null ? `#${row.rank}` : '—';
  if (by === 'adp') { const v = adpFor(row.slug); return v != null ? v.toFixed(1) : '—'; }
  if (by === 'proj') { const v = projFor(row.slug, row.pos); return v != null ? `${v.toFixed(1)}/g` : '—'; }
  const o = own?.[row.slug];
  return o != null ? `${o}%` : '0%';
}

/** Order a list of available players. Stable, non-mutating, and rank always
 *  breaks the tie. `own` is the map `playerOwnership` returns (absent = the
 *  ownership order falls back to rank, rather than claiming everyone is 0%
 *  while the call is still in flight). */
export function sortPool<T extends PoolRow>(
  rows: T[], by: PoolSort, own?: Record<string, number> | null,
): T[] {
  const rankOf = (r: T) => r.rank ?? Number.MAX_SAFE_INTEGER;
  if (by === 'rank') return [...rows].sort((a, b) => rankOf(a) - rankOf(b));
  if (by === 'own' && !own) return [...rows].sort((a, b) => rankOf(a) - rankOf(b));
  // Missing sorts last in every order: a key that pushes unknowns to the end
  // whichever direction the known values run.
  const key = (r: T): number => {
    if (by === 'adp') return adpFor(r.slug) ?? Number.MAX_SAFE_INTEGER;
    if (by === 'proj') { const v = projFor(r.slug, r.pos); return v == null ? Number.MAX_SAFE_INTEGER : -v; }
    const o = own?.[r.slug];
    return o == null ? Number.MAX_SAFE_INTEGER : -o;
  };
  return [...rows].sort((a, b) => {
    const d = key(a) - key(b);
    return d !== 0 ? d : rankOf(a) - rankOf(b);
  });
}
