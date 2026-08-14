// Commissioner kit (0141), client side: the league note and player flags.
//
// The flags follow the injuries pattern: a synchronous module cache behind
// flagFor(), because the render paths that show flags (pool rows, pickers,
// the player card) are deep component trees that cannot await. The host loads
// the current league's flags into the cache and bumps a version counter in
// its store/state so the tree re-renders — same contract as setLiveInjuries.
//
// One league at a time, deliberately: a board only ever shows one league, and
// swapping leagues swaps the cache wholesale (or clears it on exit).

export interface LeagueNote { text: string | null; at: string | null; canEdit: boolean; }

let flagLeague: string | null = null;
let flags = new Map<string, string>();

/** Replace the cache with LEAGUE's flags. */
export function setLeagueFlags(leagueId: string, rows: { slug: string; label: string }[]): void {
  flagLeague = leagueId;
  flags = new Map(rows.map((r) => [r.slug, r.label]));
}

export function clearLeagueFlags(): void {
  flagLeague = null;
  flags = new Map();
}

/** The commissioner's label on this player, if any. Synchronous — render
 *  paths and the player card call it directly. */
export function flagFor(slug: string): string | null {
  return flags.get(slug) ?? null;
}

/** Which league the cache currently speaks for (null = empty). */
export function flagsLeague(): string | null {
  return flagLeague;
}
