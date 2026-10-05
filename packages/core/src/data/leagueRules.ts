// WHAT A LEAGUE'S SEASONS ALLOW (0442). Founder: "Devy spots and the devy
// market don't make sense for redraft leagues. Nor does taxi. Dynasty leagues
// can't do vampire or guillotine modes either." Said in the form before
// CREATE, in the same words the server refuses with.
import type { LeagueContinuity, LeagueFormat } from './liveApi';
import { isDynastyContinuity } from './liveApi';

/** A redraft league starts over every season — nothing to develop or stash. */
export const isRedraft = (c: LeagueContinuity | string | null | undefined): boolean => (c ?? 'redraft') === 'redraft';

/** Why this format can't be played under this continuity, or null. */
export function formatBlocked(format: LeagueFormat, continuity: LeagueContinuity | string | null | undefined): string | null {
  if ((format === 'guillotine' || format === 'vampire') && isDynastyContinuity(continuity)) {
    return 'a dynasty league plays head-to-head — guillotine and vampire tear apart rosters that are meant to carry over';
  }
  return null;
}

/** Why a devy shelf, the devy market or a taxi squad can't live in a league
 *  with this continuity, or null. */
export function shelfBlocked(continuity: LeagueContinuity | string | null | undefined): string | null {
  return isRedraft(continuity)
    ? 'devy spots, the devy market and the taxi squad are for keeper and dynasty leagues — a redraft league starts over every season, so there is nothing to develop'
    : null;
}
