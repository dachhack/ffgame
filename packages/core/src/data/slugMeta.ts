// Resolve a player's position + NFL team from their engine slug. K/DST slugs are
// team-keyed (`${team}-k` / `${team}-dst`); skill players live in BAKED_SLUGS.
// The team codes here already match the NFL slate's (LA/JAX/WAS/LV…), so a slug
// can be slate-gated to its game window without any further normalization.
import type { Pos } from '../types';
import { BAKED_SLUGS } from './bakedSlugs';

// Relocation / alt codes → the slate's codes (matches buildLeague.normTeam).
export function normTeam(t: string): string {
  const u = (t ?? '').toUpperCase();
  return u === 'LAR' ? 'LA' : u === 'WSH' ? 'WAS' : u === 'JAC' ? 'JAX' : u === 'OAK' ? 'LV' : u === 'SD' ? 'LAC' : u === 'STL' ? 'LA' : u;
}

// Runtime overlay (0200.1) — live meta for players the BAKE doesn't know.
// The bake covers the 2025 demo names; a 2026 fringe rookie (the 8/15 case:
// Ian Wheeler, an RB the founder fielded) fell through to the WR/'' fallback
// below, and the app's client-side duel log — which builds its engine Players
// from THIS lookup — banked him at 0.0 with no drip events while the server
// scored him fine: position-gated metrics plus an empty team (possession
// gating) zero the accrual. Boards that hold the league pool install it here
// so every slugMeta consumer resolves live players correctly. Same
// module-global contract as the other engine caches.
const overlay = new Map<string, { pos: Pos; team: string }>();
export function setSlugMetaOverrides(rows: { slug: string; pos?: string | null; team?: string | null }[]): void {
  for (const r of rows) {
    if (!r.slug || !r.pos) continue;
    overlay.set(r.slug, { pos: r.pos as Pos, team: normTeam(r.team ?? '') });
  }
}
export function clearSlugMetaOverrides(): void { overlay.clear(); }

export function slugMeta(slug: string): { pos: Pos; team: string } {
  // A missing slug resolves to the same neutral answer as an unknown one.
  // This is a pure lookup on the render path of every board, and callers reach
  // it through data we do not control — `sleeper_lineup.starters_json` is an
  // untrusted JSON blob that gets *cast* to PoolPlayer[], so a row missing its
  // slug type-checks perfectly and then throws here. An unresolvable player
  // should degrade to "unknown team", never take the screen down with it.
  if (!slug) return { pos: 'WR', team: '' };
  if (slug.endsWith('-dst')) return { pos: 'DEF', team: normTeam(slug.slice(0, -4)) };
  if (slug.endsWith('-k')) return { pos: 'K', team: normTeam(slug.slice(0, -2)) };
  const o = overlay.get(slug);
  if (o) return o;
  const b = BAKED_SLUGS[slug];
  return b ? { pos: b.pos as Pos, team: normTeam(b.team) } : { pos: 'WR', team: '' };
}
