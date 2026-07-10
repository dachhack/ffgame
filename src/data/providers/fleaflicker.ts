// The Fleaflicker provider — wraps the Fleaflicker adapter (src/data/fleaflicker.ts)
// behind the LeagueProvider interface. Fleaflicker's read API is public (no auth)
// but not CORS-enabled, so it runs through the generic `fantasy-proxy` Edge
// Function: clientSide:false, auth:'none'. Connect is league-id-centric.
import { fleaflickerNormalize, type FleaflickerCreds } from '../fleaflicker';
import { buildFromNormalized } from '../buildLeague';
import { proxyGetJson } from './proxy';
import type { LeagueProvider, ProviderStanding } from './types';

export const fleaflickerProvider: LeagueProvider = {
  id: 'fleaflicker',
  label: 'Fleaflicker',
  clientSide: false,
  auth: 'none',

  avatarUrl: () => null,

  async resolveUser(handle) {
    const id = handle.trim();
    if (!id) return null;
    return { provider: 'fleaflicker', userId: id, username: id, displayName: 'Fleaflicker Manager', avatar: null };
  },

  async getLeagues() { return []; },

  async getStandings(leagueId, auth) {
    const norm = await fleaflickerNormalize({ leagueId, season: auth?.season ?? '2025' }, proxyGetJson);
    const standings: ProviderStanding[] = norm.teams
      .map((t) => ({
        rosterId: t.rosterId, teamName: t.teamName, owner: t.owner, avatar: null,
        wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf, pa: t.pa, playerCount: t.playerKeys.length,
      }))
      .sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf));
    return { name: norm.name, standings };
  },

  async buildLeague(leagueId, _userId, onProgress, opts) {
    const creds: FleaflickerCreds = { leagueId, season: opts?.auth?.season ?? '2025' };
    const norm = await fleaflickerNormalize(creds, proxyGetJson, onProgress);
    return buildFromNormalized(norm, { addKdst: opts?.addKdst });
  },
};
