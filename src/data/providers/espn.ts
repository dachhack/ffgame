// The ESPN provider — wraps the ESPN v3 adapter (src/data/espn.ts) behind the
// LeagueProvider interface. Unlike Sleeper, ESPN is NOT client-side: it goes
// through the `espn-league` Supabase Edge Function (CORS + cookies for private
// leagues), so `clientSide: false`, `auth: 'cookie'`.
//
// ESPN has no public username lookup, so the connect flow is league-id-centric
// (the ESPN connect form collects league id + season + optional cookies and
// calls buildLeague directly). resolveUser/getLeagues are therefore minimal —
// they exist to satisfy the interface, not to drive a Sleeper-style list.
import { espnNormalize, espnProxyFetch, type EspnCreds } from '../espn';
import { buildFromNormalized } from '../buildLeague';
import type { LeagueProvider, ProviderStanding } from './types';

/** Pack the per-user ESPN credentials into the opaque ProviderAuth bag. */
export function espnAuth(creds: { swid?: string; s2?: string; season?: string }): Record<string, string> {
  return { swid: creds.swid ?? '', s2: creds.s2 ?? '', season: creds.season ?? '2025' };
}

export const espnProvider: LeagueProvider = {
  id: 'espn',
  label: 'ESPN',
  clientSide: false,
  auth: 'cookie',

  // ESPN avatars aren't exposed by the read API; fall back to initials in the UI.
  avatarUrl: () => null,

  async resolveUser(handle) {
    const swid = handle.trim();
    if (!swid) return null;
    return { provider: 'espn', userId: swid, username: swid, displayName: 'ESPN Manager', avatar: null };
  },

  // ESPN league discovery (fan API) isn't wired yet — the connect form takes a
  // league id directly. Returns empty so the generic list flow is a no-op.
  async getLeagues() { return []; },

  async getStandings(leagueId, auth) {
    const norm = await espnNormalize({ leagueId, season: auth?.season ?? '2025', swid: auth?.swid, s2: auth?.s2 }, espnProxyFetch);
    const standings: ProviderStanding[] = norm.teams
      .map((t) => ({
        rosterId: t.rosterId, teamName: t.teamName, owner: t.owner, avatar: null,
        wins: t.wins, losses: t.losses, ties: t.ties, pf: t.pf, pa: t.pa, playerCount: t.playerKeys.length,
      }))
      .sort((a, b) => (b.wins - a.wins) || (b.pf - a.pf));
    return { name: norm.name, standings };
  },

  async buildLeague(leagueId, _userId, onProgress, opts) {
    const auth = opts?.auth ?? {};
    const creds: EspnCreds = { leagueId, season: auth.season ?? '2025', swid: auth.swid, s2: auth.s2 };
    const norm = await espnNormalize(creds, espnProxyFetch, onProgress);
    return buildFromNormalized(norm, { addKdst: opts?.addKdst });
  },
};
