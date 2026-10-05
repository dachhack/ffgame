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

/** THE BOOT REPORT (v0.633.1). With the token set, the worker says at boot
 *  what the feed holds and whether every pool key resolves — the shadow
 *  read's first two questions, answered where the secrets already are
 *  (the deploy workflow prints the boot log) rather than on a laptop.
 *  One meta read, then per daily sport in our leagues: the crosswalk against
 *  the pool keys and yesterday's slate. Nothing is written. */
export async function statheadBootReport({ log = console.log, sports = null } = {}) {
  if (!statheadConfigured()) { log('stathead: no token — the public feeds only'); return null; }
  const { db, allRows } = await import('./supabase.js');
  const meta = await statheadMeta();
  const per = meta?.sports ?? meta?.rows ?? meta ?? {};
  const names = Array.isArray(per) ? per.map((x) => x.sport ?? '?') : Object.keys(per);
  log(`stathead meta: as_of ${meta?.as_of ?? '?'}; sports ${names.join(', ') || '?'}`);
  for (const sp of names) {
    const m = Array.isArray(per) ? per.find((x) => x.sport === sp) : per[sp];
    if (m && typeof m === 'object') log(`stathead ${sp}: season ${m.current_season ?? '?'}, as_of ${m.as_of ?? '?'}, ${Object.entries(m).filter(([k, v]) => typeof v === 'number').map(([k, v]) => `${k} ${v}`).join(', ')}${m.status ? `, ${m.status}` : ''}`);
  }
  const { data: leagues, error } = await db().from('league').select('id, sport').neq('sport', 'nfl').eq('provider', 'native');
  if (error) throw new Error(`league read: ${error.message}`);
  const ours = [...new Set((leagues ?? []).map((l) => l.sport))].filter((s) => !sports || sports.includes(s)).sort();
  const out = { meta, coverage: {} };
  for (const sp of ours) {
    const ids = (leagues ?? []).filter((l) => l.sport === sp).map((l) => l.id);
    const keys = new Set();
    for (const id of ids) {
      const rows = await allRows((from, to) => db().from('league_pool').select('slug').eq('league_id', id).order('slug').range(from, to));
      for (const r of rows) if (r.slug.startsWith(`${sp}-`)) keys.add(r.slug);
    }
    try {
      const xw = await statheadCrosswalk(sp);
      const cov = crosswalkCoverage(sp, [...keys], xw.rows ?? xw);
      out.coverage[sp] = { keys: keys.size, found: cov.found.length, missing: cov.missing };
      log(`stathead crosswalk ${sp}: ${cov.found.length}/${keys.size} pool keys resolve across ${ids.length} league${ids.length === 1 ? '' : 's'}${cov.missing.length ? `; missing ${cov.missing.slice(0, 25).join(', ')}${cov.missing.length > 25 ? ` … +${cov.missing.length - 25}` : ''}` : ''}`);
    } catch (e) { log(`stathead crosswalk ${sp}: ${e.message}`); }
    try {
      const y = new Date(Date.now() - 86400e3).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
      const g = await statheadGames(sp, { date: y });
      const rows = g.rows ?? g;
      const first = rows[0];
      let lines = null;
      if (first) { const l = await statheadLines(sp, first.game_id); lines = `${(l.rows ?? []).length} lines for ${first.away}@${first.home}${l.stored ? ' (stored)' : ''}${l.revised_at ? `, revised ${l.revised_at}` : ''}`; }
      log(`stathead slate ${sp} ${y}: ${rows.length} games, as_of ${g.as_of ?? '?'}${lines ? `; ${lines}` : ''}`);
    } catch (e) { log(`stathead slate ${sp}: ${e.message}`); }
  }
  return out;
}
