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

/** THE WIRE'S COPIES TAG (v0.729.0). Founder: "In leagues with copies, should
 *  we have number of copies available on waivers?" — yes, on the default list
 *  too, not only under SHOW OWNED: "1 of 2 left · Hawks" for a player some
 *  team already holds a copy of. Null with one copy, or when nobody holds him. */
export function copyWireTag(held: Map<string, number[]>, slug: string, copies: number | null | undefined,
  myRoster: number | null | undefined, nameOf: (rid: number) => string): string | null {
  const n = copiesOf(copies);
  const h = held.get(slug) ?? [];
  if (n <= 1 || !h.length) return null;
  const names = [...h].sort((a, b) => (a === myRoster ? -1 : b === myRoster ? 1 : a - b)).map((r) => (r === myRoster ? 'you' : nameOf(r)));
  return `${copiesLeft(held, slug, n)} of ${n} left · ${names.join(', ')}`;
}

/** WHO HOLDS WHOM NOW, for the board's two teams (v0.730.11). A live week's
 *  pool (sleeper_lineup) is refreshed add-only (0314) — a dropped man who
 *  already played must keep the starting spot his sealed pick holds — so it
 *  still lists every player a team dropped since kickoff. Founder: "team 4 has
 *  10 bench, but in match up they have 13" (Kickoff League, three waiver drops
 *  after the Thursday kickoff). The bench, the best-ball/auto-fill preview and
 *  the auto-slot write read the roster as it stands; this is that, per team.
 *  The resolver already scores from native_roster, so this only makes the
 *  boards say what it counts. */
export function boardHeldBy(rows: readonly HeldRow[], rids: readonly (number | null | undefined)[]): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  for (const r of rows) {
    if (!rids.includes(r.roster_id)) continue;
    if (!out.has(r.roster_id)) out.set(r.roster_id, new Set());
    out.get(r.roster_id)!.add(r.slug);
  }
  return out;
}

/** Is `slug` on `rid`'s roster now? Unknown (rows not loaded yet) reads as yes,
 *  so a board draws what it drew before the read lands rather than an empty bench. */
export const heldNow = (held: Map<number, Set<string>> | null | undefined, rid: number | null | undefined, slug: string): boolean =>
  !held || rid == null || !!held.get(rid)?.has(slug);

/** OFF THE ROSTER, STILL ON THE MATCHUP (v0.730.12). Founder: "if they have
 *  already played, then dropped or removed from the roster somehow, you can
 *  keep them in the matchup but remove from my team. Make a note on players
 *  off roster but still in the matchup screen." A bench entry whose player the
 *  team no longer holds stays only once his game has started this week (he
 *  played for them; a bye is not playing), marked `offRoster`; before that he
 *  is gone. A starter is never removed (his sealed pick holds the spot) — just
 *  marked, so a dropped man in a lineup is visible as one. */
export function boardOffRoster<E extends { slug: string; state: 'pre' | 'live' | 'done'; opponent?: string | null }>(
  e: E, held: Map<number, Set<string>> | null | undefined, rid: number | null | undefined, where: 'bench' | 'starter',
): (E & { offRoster?: boolean }) | null {
  if (heldNow(held, rid, e.slug)) return e;
  const played = e.state !== 'pre' && e.opponent !== 'BYE';
  if (where === 'bench' && !played) return null;
  return { ...e, offRoster: true };
}
