// Sleeper public read API (server-side). Mirrors src/data/sleeper.ts but for Node
// and covering the sync surface: league, users, rosters, weekly matchups, and the
// full player directory (which carries espn_id + injury_status).
const BASE = 'https://api.sleeper.app/v1';

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw new Error(`Sleeper fetch failed: ${url}`);
}

export const getLeague = (leagueId) => getJson(`${BASE}/league/${leagueId}`);
export const getLeagueUsers = (leagueId) => getJson(`${BASE}/league/${leagueId}/users`);
export const getLeagueRosters = (leagueId) => getJson(`${BASE}/league/${leagueId}/rosters`);
export const getMatchups = (leagueId, week) => getJson(`${BASE}/league/${leagueId}/matchups/${week}`);
export const getState = () => getJson(`${BASE}/state/nfl`);

/** Resolve a Sleeper username to its account (for linking app_user ↔ sleeper). */
export async function resolveUser(username) {
  const u = String(username).trim().replace(/^@/, '');
  if (!u) return null;
  const d = await getJson(`${BASE}/user/${encodeURIComponent(u)}`);
  if (!d || !d.user_id) return null;
  return { userId: String(d.user_id), username: String(d.username ?? u), displayName: String(d.display_name ?? u) };
}

/** Full NFL player directory (~5 MB). Heavy — fetch at most daily. */
export const getPlayers = () => getJson(`${BASE}/players/nfl`);
