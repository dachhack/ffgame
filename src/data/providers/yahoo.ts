// The Yahoo provider — wraps the Yahoo adapter (src/data/yahoo.ts) behind the
// LeagueProvider interface. Yahoo is the only OFFICIAL API, but it needs OAuth
// 2.0, so it's not client-side: tokens are obtained via the yahooClient redirect
// flow and every call goes through the yahoo-oauth Edge Function.
// clientSide:false, auth:'oauth'. League discovery works (getLeagues), so the
// connect flow can list the user's Yahoo leagues after sign-in.
import { yahooNormalize, yahooLeagues } from '../yahoo';
import { yahooApi } from './yahooClient';
import { buildFromNormalized } from '../buildLeague';
import type { LeagueProvider, ProviderLeague, ProviderStanding } from './types';

export const yahooProvider: LeagueProvider = {
  id: 'yahoo',
  label: 'Yahoo',
  clientSide: false,
  auth: 'oauth',

  avatarUrl: () => null,

  // No handle-based lookup — identity comes from the OAuth token.
  async resolveUser() {
    return { provider: 'yahoo', userId: 'me', username: 'me', displayName: 'Yahoo Manager', avatar: null };
  },

  async getLeagues() {
    const ls = await yahooLeagues(yahooApi);
    return ls.map((l): ProviderLeague => ({
      provider: 'yahoo', leagueId: l.leagueKey, name: l.name, season: l.season, totalRosters: 0, status: '',
      avatar: null, format: 'Yahoo', scoring: '', starters: 0,
    }));
  },

  async getStandings(leagueId) {
    const norm = await yahooNormalize(leagueId, yahooApi);
    const standings: ProviderStanding[] = norm.teams
      .map((t) => ({
        rosterId: t.rosterId, teamName: t.teamName, owner: t.owner, avatar: null,
        wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf, pa: t.pa, playerCount: t.playerKeys.length,
      }))
      .sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf));
    return { name: norm.name, standings };
  },

  async buildLeague(leagueId, _userId, onProgress, opts) {
    const norm = await yahooNormalize(leagueId, yahooApi, onProgress);
    return buildFromNormalized(norm, { addKdst: opts?.addKdst });
  },
};
