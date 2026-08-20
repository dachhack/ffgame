// Resolve a player's position + NFL team from their engine slug. K/DST slugs are
// team-keyed (`${team}-k` / `${team}-dst`); skill players live in BAKED_SLUGS.
// The team codes here already match the NFL slate's (LA/JAX/WAS/LV…), so a slug
// can be slate-gated to its game window without any further normalization.
import type { Pos } from '../types';
import { BAKED_SLUGS } from './bakedSlugs';
import { PLAYER_BIO } from './playerBio';
import { teamFor } from './playerTeam';

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

// SLUG → SLEEPER ID (0205 / v0.317.0). Separate from the meta overlay because
// it answers a different question and has a different lifetime: `slugMeta`
// resolves a POSITION, which the bakes can usually guess, while this resolves
// an IDENTITY, which nothing else can. The IDP bake is the only one keyed by
// identity — three of its 963 slugs name two different men each — so a
// projection for `byron-young` is unanswerable without it.
//
// Installed by the same call, from the same pool rows, because a board that
// knows a player's position from the pool knows his id too, and asking every
// projection call site to thread an extra argument would have meant six edits
// that could each be forgotten separately.
const idBySlug = new Map<string, string>();

export function setSlugMetaOverrides(
  rows: { slug: string; pos?: string | null; team?: string | null; sleeperId?: string | null; sleeper_id?: string | null }[],
): void {
  for (const r of rows) {
    // The id is installed even when the row has no position — the two travel
    // together but neither is a precondition for the other, and dropping an id
    // because a pos was missing would silently mis-price a defender.
    const id = r.sleeperId ?? r.sleeper_id;
    if (r.slug && id) idBySlug.set(r.slug, id);
    if (!r.slug || !r.pos) continue;
    overlay.set(r.slug, { pos: r.pos as Pos, team: normTeam(r.team ?? '') });
  }
}
export function clearSlugMetaOverrides(): void { overlay.clear(); idBySlug.clear(); }

/** Install a whole slug → Sleeper id map, as `league_pool_ids` (0205) serves
 *  it. The boards that RENDER projections build their rosters from
 *  `sleeper_lineup.starters_json`, which carries no id at all, so the pool's
 *  own map is the only way a matchup board can tell the two Byron Youngs
 *  apart. Merged rather than replacing: a board may install a roster's meta
 *  and the league's ids from two different reads that land in either order. */
export function setSlugSleeperIds(ids: Record<string, string | null | undefined>): void {
  for (const [slug, id] of Object.entries(ids)) if (slug && id) idBySlug.set(slug, id);
}

/** This slug's Sleeper id, if a league pool has been installed and knows one.
 *  Undefined is the normal answer away from a pool — every bake except IDP is
 *  name-keyed, and IDP resolves 960 of its 963 rows by name alone. */
export function slugSleeperId(slug: string): string | undefined {
  return idBySlug.get(slug);
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
  const o = overlay.get(slug);
  if (o) return o;
  const b = BAKED_SLUGS[slug];
  if (b) return { pos: b.pos as Pos, team: normTeam(b.team) };
  // THE BAKE IS 2025 PLAY-BY-PLAY, so it structurally CANNOT know a 2026
  // rookie: genRealPbp only mints a slug for someone who has NFL plays. That
  // is why re-baking it never fixed rookies, and why every one of them fell
  // through to the WR/'' default below — reading as a bye on the matchup board
  // and, worse, being SCORED as a WR by classicPoints (mkPlayer resolves a
  // player's position through here).
  //
  // The DIRECTORY bake knows them, with a real position and team, so it is the
  // second source. Deliberately AFTER BAKED_SLUGS and never before it: that
  // map's team is the player's MAJORITY 2025 team, which is what the baked
  // play stream's possession gating is written against — overruling it with a
  // current-season team would quietly change how baked plays score.
  //
  // Team goes through teamFor, so the worker's live override layer (0142)
  // beats the bake for anyone who has since moved.
  const bio = PLAYER_BIO[slug];
  if (bio?.pos) return { pos: bio.pos as Pos, team: normTeam(teamFor(slug) ?? bio.team ?? '') };
  return { pos: 'WR', team: '' };
}
