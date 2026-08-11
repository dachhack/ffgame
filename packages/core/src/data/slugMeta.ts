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
  const b = BAKED_SLUGS[slug];
  return b ? { pos: b.pos as Pos, team: normTeam(b.team) } : { pos: 'WR', team: '' };
}
