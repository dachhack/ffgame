// THE STATHEAD ADAPTER (v0.634.0) — every daily sport, one feed.
//
// Stathead's daily-sport service (contract: dachhack/stathead
// docs/daily-sport-service.md) answers the three questions the poller asks
// an adapter — schedule(date), game(gameId), directory(season) — for NHL,
// MLB, NBA, WNBA, MLS and the Premier League, in our own stat vocabulary
// ("exactly the consumer's field ids"). So the adapter is mostly a reshaping
// of rows, plus three things the contract makes ours to handle:
//
//   IDS. A Stathead player_id is `<sport>-<id>`: the league id for NHL and
//   MLB (our key outright), the ESPN id for NBA, WNBA and soccer. Our NBA
//   pool keys are Sleeper ids, so an NBA row is keyed through the crosswalk's
//   sleeper_id (cached a day); a man Sleeper has not listed keeps his ESPN
//   id, a new key the directory will carry under the same rule. WNBA and
//   soccer keys are the ESPN id, which is what we hold.
//
//   SOCCER'S DICTIONARY is Stathead's (min g a sh sot fc fs yc rc og off sv
//   ga shf start sub_in cs tga); ours (core sports/soccer.ts) wants `gc` for
//   goals conceded and `posn` (1 GK 2 DEF 3 MID 4 FWD) from the match's
//   position code, and derives the rest. Knobs the feed does not serve (key
//   passes, tackles, penalties, xG) stay 0.
//
//   GAMES-PLAYED FLAGS the public box scores set (gp, gapp, hgp, pgp) are
//   set here from the served line the same way, so season sums and the
//   card read alike whichever feed a line came from.
//
// Selected per sport by SPORT_PROVIDER (config.js); the shadow read
// (poll/sportShadow.js) runs it beside the public adapter and compares.
import { statheadGames, statheadLines, statheadPlayers, statheadSeasonLines, statheadCrosswalk } from '../stathead.js';
import { mlbEligibility } from './mlb.js';
import { SPORTS, eligibleFor } from '../../../packages/core/src/sports/index.ts';

const log = (...a) => console.log('[stathead]', ...a);

const SOCCER = new Set(['epl', 'mls']);
const num = (v) => (v == null || v === '' ? 0 : Number(v) || 0);

/** `<sport>-<id>` → the bare id; a bare id passes through. */
export const bareId = (sport, playerId) => {
  const s = String(playerId ?? '');
  return s.startsWith(`${sport}-`) ? s.slice(sport.length + 1) : s;
};

/** A Stathead game row → the poller's game row. */
export function statheadGameRow(sport, r) {
  return {
    sport,
    season: String(r.season ?? ''),
    gameId: String(r.game_id),
    gameDate: r.game_date,
    startUtc: r.start_utc ?? null,
    status: r.status,
    away: r.away ?? '', home: r.home ?? '',
    awayScore: r.away_score ?? null, homeScore: r.home_score ?? null,
    gameType: r.game_type ?? '',
    clock: r.status === 'live' ? (r.clock || null) : null,
  };
}

/** Soccer position code → posn. ESPN's codes: G, D, M, F and detailed ones
 *  (CB, LB, AM-R, LF, ST…); our posMap knows the detailed ones. */
export function soccerPosn(pos) {
  const code = String(pos ?? '').toUpperCase().split('-')[0];
  // An unmapped detailed code reads by its last letter: xB a back, xM a
  // midfielder, xF or xW a forward.
  const last = code.slice(-1);
  const first = eligibleFor('epl', code)[0] ?? (last === 'G' || code === 'GK' ? 'GK' : last === 'B' || last === 'D' ? 'DEF' : last === 'M' ? 'MID' : last === 'F' || last === 'W' || code === 'ST' ? 'FWD' : null);
  return first === 'GK' ? 1 : first === 'DEF' ? 2 : first === 'MID' ? 3 : first === 'FWD' ? 4 : 0;
}

/** A served `stats` object → our line for the sport, games-played flags set. */
export function statheadLine(sport, stats, { pos, played } = {}) {
  const s = stats ?? {};
  if (SOCCER.has(sport)) {
    const line = { posn: soccerPosn(pos) };
    for (const k of ['min', 'start', 'g', 'a', 'sh', 'sot', 'yc', 'rc', 'og', 'sv', 'cs']) if (k in s) line[k] = num(s[k]);
    if ('ga' in s) line.gc = num(s.ga);
    if (line.min > 0) line.gp = 1;
    return line;
  }
  const line = {};
  for (const [k, v] of Object.entries(s)) if (typeof v === 'number' || (typeof v === 'string' && v !== '' && !Number.isNaN(Number(v)))) line[k] = num(v);
  if (sport === 'nhl') {
    if (String(pos ?? '').toUpperCase() === 'G') { if (line.gapp == null) line.gapp = (line.gtoi ?? 0) > 0 ? 1 : 0; }
    else if (line.gp == null) line.gp = played === false ? 0 : 1;
  } else if (sport === 'mlb') {
    const batted = (line.pa ?? 0) > 0 || (line.ab ?? 0) > 0 || (line.r ?? 0) > 0 || (line.sb ?? 0) > 0;
    const pitched = (line.bf ?? 0) > 0 || (line.outs ?? 0) > 0 || (line.gs ?? 0) > 0;
    if (line.hgp == null && batted) line.hgp = 1;
    if (line.pgp == null && pitched) line.pgp = 1;
  } else if (line.gp == null) {
    line.gp = played === false ? 0 : ((line.min ?? 0) > 0 ? 1 : 0);
  }
  return line;
}

/** A /lines response → the poller's { game, lines }. `keyOf` turns a
 *  Stathead player_id into our bare id (identity for NHL, MLB, WNBA, soccer;
 *  the crosswalk for NBA). */
export function statheadBoxToGame(sport, payload, keyOf = (id) => bareId(sport, id)) {
  const rows = payload?.rows ?? [];
  const game = payload?.game ? statheadGameRow(sport, payload.game) : null;
  const lines = rows.map((r) => {
    const played = r.played !== false;
    const line = statheadLine(sport, r.stats, { pos: r.pos, played });
    return { extId: String(keyOf(r.player_id)), name: r.name ?? '', team: r.team ?? '', pos: r.pos ?? '', played, line, statheadId: String(r.player_id) };
  }).filter((l) => l.extId);
  return { game, lines, stored: !!payload?.stored, revisedAt: payload?.revised_at ?? null };
}

/** How many games a season line has, in the sport's own count. */
const gamesOf = (sport, line) => (sport === 'mlb' ? (line?.hgp ?? 0) + (line?.pgp ?? 0) : sport === 'nhl' ? (line?.gp ?? 0) + (line?.gapp ?? 0) : line?.gp ?? 0);
const ENOUGH = { mlb: 40, nhl: 20, nba: 20, wnba: 10, epl: 10, mls: 10 };

/** A season-lines response → Map(player_id → our line with gp). */
export function statheadSeasonMap(sport, payload) {
  const out = new Map();
  for (const r of payload?.rows ?? []) {
    const line = statheadLine(sport, r.stats, { pos: r.pos, played: true });
    if (sport === 'mlb') { if (line.hgp == null && (r.stats?.hgp != null)) line.hgp = num(r.stats.hgp); if (line.pgp == null && r.stats?.pgp != null) line.pgp = num(r.stats.pgp); }
    else if (sport === 'nhl') { if (String(r.pos ?? '').toUpperCase() === 'G') { if (r.gp != null) line.gapp = num(r.gp); } else if (r.gp != null) line.gp = num(r.gp); }
    else if (r.gp != null) line.gp = num(r.gp);
    out.set(String(r.player_id), { line, posGames: r.pos_games ?? null, team: r.team ?? null });
  }
  return out;
}

/** The directory: served players + this and last season's lines → the rows
 *  sportDirectory's directoryRow expects. */
export function statheadDirectory(sport, players, cur, prior, season, keyOf = (id) => bareId(sport, id)) {
  const out = [];
  for (const p of players?.rows ?? []) {
    const id = String(p.player_id);
    const c = cur.get(id), pr = prior.get(id);
    const use = c && gamesOf(sport, c.line) >= (ENOUGH[sport] ?? 20) ? c : (pr ?? c ?? null);
    const seasonId = use && use === c ? season : pr ? String(Number(season) - 1) : season;
    let feedCodes = Array.isArray(p.eligible) && p.eligible.length ? p.eligible : [p.pos].filter(Boolean);
    if (sport === 'mlb') {
      // Eligibility from the season's games at each position (10+), as the
      // public adapter reads it off the fielding leaderboard; a DH or a
      // two-way man from the hitting and pitching lines.
      const pg = use?.posGames ?? c?.posGames ?? null;
      const games = new Map(Object.entries(pg ?? {}).map(([k, v]) => [k, num(v)]));
      feedCodes = mlbEligibility(p.pos || 'P', games.size ? games : undefined, use?.line ?? null);
    }
    out.push({
      extId: String(keyOf(id)), name: p.full_name ?? '', team: p.team ?? '', pos: p.pos ?? '',
      feedCodes, jersey: p.jersey ?? null, headshot: p.headshot_url ?? null,
      active: p.active !== false,
      injury: p.injury_status ? { code: String(p.injury_status).toUpperCase(), note: p.injury_note ?? null } : null,
      exp: Number.isFinite(Number(p.exp)) && p.exp != null ? Number(p.exp) : null,
      season: use?.line ?? null, seasonId, gp: gamesOf(sport, use?.line),
      statheadId: id, ids: p.ids ?? null,
    });
  }
  return out;
}

// ── the crosswalk, for NBA keys ────────────────────────────────────────────────
const XW_TTL_MS = 24 * 3600e3;
const xw = new Map(); // sport → { at, toOurs: Map(stathead player_id → our bare id) }
export function buildKeyMap(sport, rows) {
  const toOurs = new Map();
  for (const r of rows ?? []) {
    const id = String(r.player_id ?? '');
    if (!id) continue;
    if (sport === 'nba' && r.sleeper_id) toOurs.set(id, String(r.sleeper_id));
  }
  return toOurs;
}
async function keyMapFor(sport) {
  if (sport !== 'nba') return null;
  const c = xw.get(sport);
  if (c && Date.now() - c.at < XW_TTL_MS) return c.toOurs;
  const payload = await statheadCrosswalk(sport);
  const toOurs = buildKeyMap(sport, payload.rows ?? payload);
  xw.set(sport, { at: Date.now(), toOurs });
  log(`${sport} crosswalk: ${toOurs.size} Sleeper ids for ${(payload.rows ?? payload).length} players`);
  return toOurs;
}
const keyOfWith = (sport, map) => (id) => {
  const bare = bareId(sport, id);
  return map?.get(String(id)) ?? map?.get(`${sport}-${bare}`) ?? bare;
};

/** The adapter for one sport. */
export function statheadAdapter(sport) {
  if (!SPORTS[sport] || sport === 'nfl') throw new Error(`no Stathead sport ${sport}`);
  return {
    id: sport,
    provider: 'stathead',
    async schedule(date) {
      const g = await statheadGames(sport, { date });
      return (g.rows ?? []).map((r) => statheadGameRow(sport, r));
    },
    async game(gameId) {
      const [payload, map] = await Promise.all([statheadLines(sport, gameId), keyMapFor(sport)]);
      const r = statheadBoxToGame(sport, payload, keyOfWith(sport, map));
      if (!r.game) throw new Error(`${sport} ${gameId}: no game on the lines response`);
      return r;
    },
    async directory(season) {
      const [players, cur, prior, map] = await Promise.all([
        statheadPlayers(sport, season),
        statheadSeasonLines(sport, season),
        statheadSeasonLines(sport, String(Number(season) - 1)).catch(() => ({ rows: [] })),
        keyMapFor(sport),
      ]);
      return statheadDirectory(sport, players, statheadSeasonMap(sport, cur), statheadSeasonMap(sport, prior), season, keyOfWith(sport, map));
    },
  };
}
