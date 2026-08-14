// Live player→team resolution (0142): the worker-published override layer on
// top of the baked directory (playerBio.ts `team`).
//
// The bake is the baseline; the override table carries only the drift since
// the bake (trades, cuts, signings — the worker diffs Sleeper's directory
// against the bake daily). Same synchronous-cache shape as injuries and
// commish flags, because pool builders and render paths can't await.
//
// An override with team=null is a REAL answer ("free agent now, whatever the
// bake says"), which is why the cache stores null values rather than dropping
// them — teamFor distinguishes "overridden to nothing" from "no override".
import { PLAYER_BIO } from './playerBio';

let overrides = new Map<string, string | null>();

/** Replace the override cache (rows straight from player_team_override). */
export function setTeamOverrides(rows: { slug: string; team: string | null }[]): void {
  overrides = new Map(rows.map((r) => [r.slug, r.team]));
}

export function clearTeamOverrides(): void {
  overrides = new Map();
}

/** The player's current NFL team abbr: live override first, bake second,
 *  null when neither knows (or the player is currently a free agent). */
export function teamFor(slug: string): string | null {
  if (overrides.has(slug)) return overrides.get(slug) ?? null;
  return PLAYER_BIO[slug]?.team ?? null;
}

/** Override-aware display team: the live answer when there is one, else
 *  whatever the caller already had (a pool row's own team survives for slugs
 *  the directory doesn't know). */
export function displayTeam(slug: string, fallback?: string | null): string {
  return teamFor(slug) ?? fallback ?? '';
}
