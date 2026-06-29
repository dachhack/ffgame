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

  async getLeagues(user, season = '2025') {
    const leagues = await sleeperGetLeagues(user.userId, season);
    return leagues.map((l) => ({ provider: 'sleeper' as const, ...l }));
  },

  getStandings: (leagueId) => sleeperGetStandings(leagueId),

  buildLeague: (leagueId, userId, onProgress, opts) =>
    buildSleeperLeague(leagueId, userId, onProgress, { addKdst: opts?.addKdst }),
};
