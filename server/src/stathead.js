// THE STATHEAD DAILY-SPORT FEED (v0.633.0) — the client.
//
// Stathead serves NHL, MLB, NBA, WNBA, MLS and the Premier League behind one
// bearer token (contract: dachhack/stathead docs/daily-sport-service.md).
// Every /v1 route wants `Authorization: Bearer <token>`; GET / is the
// unauthenticated health check. The token is a Fly secret (STATHEAD_TOKEN),
// never a file in this repository. This module is the one place the worker
// talks to it: the adapters (to come, behind the shadow-read week) and the
// CLI's probe read through here.
import { getJson } from './sports/http.js';
import { config } from './config.js';

export const statheadConfigured = () => !!(config.statheadUrl && config.statheadToken);

/** GET a /v1 route with the token; `params` become the query string. */
export async function statheadGet(path, params = {}, { timeoutMs = 30000 } = {}) {
  if (!statheadConfigured()) throw new Error('STATHEAD_URL and STATHEAD_TOKEN are not set');
  const q = Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  const url = `${config.statheadUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}${q ? `?${q}` : ''}`;
  return getJson(url, { timeoutMs, tries: 2, headers: { Authorization: `Bearer ${config.statheadToken}` } });
}

/** /v1/meta: per sport, as_of, current_season, seasons, row counts, notes. */
export const statheadMeta = () => statheadGet('/v1/meta');
/** The slate for a US Eastern date, or a season's calendar. */
export const statheadGames = (sport, { date, season } = {}) => statheadGet(`/v1/${sport}/games`, { date, season });
/** One game's box score: rows per player who dressed, plus `game`, `stored`, `revised_at`. */
export const statheadLines = (sport, gameId) => statheadGet(`/v1/${sport}/games/${encodeURIComponent(gameId)}/lines`);
export const statheadPlayers = (sport, season) => statheadGet(`/v1/${sport}/players`, { season });
export const statheadSeasonLines = (sport, season) => statheadGet(`/v1/${sport}/season-lines`, { season });
export const statheadAdp = (sport, season) => statheadGet(`/v1/${sport}/adp`, { season });
export const statheadCrosswalk = (sport) => statheadGet(`/v1/${sport}/crosswalk`);
export const statheadTeams = (sport) => statheadGet(`/v1/${sport}/teams`);

/** Which Stathead sport id serves ours — the same six letters, today. */
export const statheadSportOf = (sport) => sport;

/** THE CROSSWALK CHECK (v0.633.0): which of a pool's keys resolve. A Drip key
 *  is `<sport>-<id>`: the league id for NHL and MLB (Stathead's player_id
 *  outright), Sleeper's for NBA and ESPN's for WNBA (in the crosswalk's
 *  `sleeper_id` / `espn_id`). Returns the keys found, and the ones not. */
export function crosswalkCoverage(sport, poolKeys, crosswalkRows) {
  const prefix = `${sport}-`;
  const direct = new Set(), bySleeper = new Map(), byEspn = new Map();
  for (const r of crosswalkRows ?? []) {
    if (r.player_id) direct.add(String(r.player_id));
    if (r.sleeper_id) bySleeper.set(String(r.sleeper_id), r.player_id);
    if (r.espn_id) byEspn.set(String(r.espn_id), r.player_id);
  }
  const found = [], missing = [];
  for (const key of poolKeys) {
    const id = key.startsWith(prefix) ? key.slice(prefix.length) : null;
    const hit = id == null ? null
      : sport === 'nhl' || sport === 'mlb' ? (direct.has(key) ? key : null)
      : sport === 'nba' ? (bySleeper.get(id) ?? null)
      : sport === 'wnba' ? (byEspn.get(id) ?? (direct.has(key) ? key : null))
      : (direct.has(key) ? key : null);
    if (hit) found.push({ key, player_id: hit }); else missing.push(key);
  }
  return { found, missing };
}
