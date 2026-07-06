// The MyFantasyLeague provider — wraps the MFL adapter (src/data/mfl.ts) behind
// the LeagueProvider interface. MFL's export API is public but not CORS-open and
// league calls redirect to per-league hosts, so it runs through the generic
// `fantasy-proxy` Edge Function (which follows the redirect server-side):
// clientSide:false, auth:'none'. Connect is league-id-centric.
import { mflNormalize, type MflCreds } from '../mfl';
import { buildFromNormalized } from '../buildLeague';
import { proxyGetJson } from './proxy';
import type { LeagueProvider, ProviderStanding } from './types';

export const mflProvider: LeagueProvider = {
  id: 'mfl',
  label: 'MyFantasyLeague',
  clientSide: false,
  auth: 'none',

  avatarUrl: () => null,

  async resolveUser(handle) {
    const id = handle.trim();
    if (!id) return null;
    return { provider: 'mfl', userId: id, username: id, displayName: 'MFL Manager', avatar: null };
  },

  async getLeagues() { return []; },

  async getStandings(leagueId, auth) {
    const norm = await mflNormalize({ leagueId, season: auth?.season ?? '2025' }, proxyGetJson);
    const standings: ProviderStanding[] = norm.teams
      .map((t) => ({
        rosterId: t.rosterId, teamName: t.teamName, owner: t.owner, avatar: null,
        wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf, pa: t.pa, playerCount: t.playerKeys.length,
      }))
      .sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf));
    return { name: norm.name, standings };
  },

  async buildLeague(leagueId, _userId, onProgress, opts) {
    const creds: MflCreds = { leagueId, season: opts?.auth?.season ?? '2025' };
    const norm = await mflNormalize(creds, proxyGetJson, onProgress);
    return buildFromNormalized(norm, { addKdst: opts?.addKdst });
  },
};
