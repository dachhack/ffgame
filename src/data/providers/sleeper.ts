// The Sleeper provider — wraps the existing Sleeper driver (src/data/sleeper.ts
// + buildSleeperLeague) behind the platform-agnostic LeagueProvider interface.
// Sleeper is uniquely client-side: a free, no-auth, CORS-enabled public API, so
// it needs no proxy. Other providers will not be `clientSide` (see types.ts).
import {
  resolveUser as sleeperResolveUser,
  getLeagues as sleeperGetLeagues,
  getStandings as sleeperGetStandings,
  sleeperAvatarUrl,
} from '../sleeper';
import { buildSleeperLeague } from '../buildLeague';
import type { LeagueProvider } from './types';

/** The current NFL season year and the previous one, newest first. In the
 *  off-season/pre-draft window the current year's league may be empty; the prior
 *  (completed) season is still there as the full-data demo. */
function recentSeasons(): string[] {
  const y = new Date().getFullYear();
  return [String(y), String(y - 1)];
}

export const sleeperProvider: LeagueProvider = {
  id: 'sleeper',
  label: 'Sleeper',
  clientSide: true,
  auth: 'handle',

  avatarUrl: (id) => sleeperAvatarUrl(id),

  async resolveUser(handle) {
    const u = await sleeperResolveUser(handle);
    return u ? { provider: 'sleeper', ...u } : null;
  },

  // Show the user's recent leagues — the current NFL season plus the previous
  // one — so someone whose live league is this year still sees it (the completed
  // prior season is the richest demo, but both are playable). A caller can still
  // pin a single season explicitly.
  async getLeagues(user, season) {
    const seasons = season ? [season] : recentSeasons();
    const lists = await Promise.all(seasons.map((s) => sleeperGetLeagues(user.userId, s)));
    return lists.flat().map((l) => ({ provider: 'sleeper' as const, ...l }));
  },

  getStandings: (leagueId) => sleeperGetStandings(leagueId),

  buildLeague: (leagueId, userId, onProgress, opts) =>
    buildSleeperLeague(leagueId, userId, onProgress, { addKdst: opts?.addKdst }),
};
