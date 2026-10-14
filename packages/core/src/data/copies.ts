// COPIES (0500): a league may run 1–4 copies of every player, each on a
// different team. Rosters come league-wide (`nativeRosters`), so who holds a
// player is a list, not one seat — these helpers keep every screen agreeing on
// it, and with one copy they answer exactly as the old single-owner maps did.

export interface HeldRow { roster_id: number; slug: string }

/** Every team that holds each player, in seat order. */
export function holdersBySlug(rows: readonly HeldRow[]): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const a = m.get(r.slug);
    if (a) { if (!a.includes(r.roster_id)) a.push(r.roster_id); } else m.set(r.slug, [r.roster_id]);
  }
  for (const a of m.values()) a.sort((x, y) => x - y);
  return m;
}

export const copiesOf = (n: number | null | undefined): number => Math.max(1, Math.min(4, Math.round(Number(n) || 1)));

/** A copy is open to `rid`: fewer teams hold him than the league's copies,
 *  and `rid` isn't one of them. With no team given, just "any copy left". */
export function copyOpen(held: Map<string, number[]>, slug: string, copies: number | null | undefined, rid?: number | null): boolean {
  const h = held.get(slug) ?? [];
  if (rid != null && h.includes(rid)) return false;
  return h.length < copiesOf(copies);
}

/** Copies still free, for a "1 of 2 left" read-out. */
export const copiesLeft = (held: Map<string, number[]>, slug: string, copies: number | null | undefined): number =>
  Math.max(0, copiesOf(copies) - (held.get(slug)?.length ?? 0));

/** The holder that matters to `rid`: `rid` itself when it holds him, else the
 *  first other team. The single-owner answer the old maps gave. */
export function holderFor(held: Map<string, number[]>, slug: string, rid?: number | null): number | undefined {
  const h = held.get(slug);
  if (!h?.length) return undefined;
  return rid != null && h.includes(rid) ? rid : h[0];
}

/** The matchup board's taxi/IR sets, keyed by slug (0164, 0307). With copies,
 *  only the two teams on the board count, and when both hold him, `myRid`'s
 *  copy decides — a rival's IR copy never benches my active one. */
export function boardStashSets(rows: readonly (HeldRow & { spot?: string | null })[], rids: readonly (number | null | undefined)[], myRid?: number | null): { stashed: Set<string>; onIr: Set<string> } {
  const pickRow = new Map<string, HeldRow & { spot?: string | null }>();
  for (const r of rows) {
    if (!rids.includes(r.roster_id)) continue;
    const had = pickRow.get(r.slug);
    if (!had || (r.roster_id === myRid && had.roster_id !== myRid)) pickRow.set(r.slug, r);
  }
  const stashed = new Set<string>(), onIr = new Set<string>();
  for (const [slug, r] of pickRow) {
    if (r.spot && r.spot !== 'active') stashed.add(slug);
    if (r.spot === 'ir' || r.spot === 'out') onIr.add(slug);   // OUT (0307) is the injured shelf too
  }
  return { stashed, onIr };
}
