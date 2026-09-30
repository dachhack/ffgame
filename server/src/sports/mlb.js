// MLB → stat lines (v0.564.0). Source: statsapi.mlb.com, MLB's own Gameday
// API. No key. The cleanest of the four feeds: an official schedule, a live
// feed that carries the box score, and a diffPatch endpoint for incremental
// polling later.
//
//   schedule  /api/v1/schedule?sportId=1&date=YYYY-MM-DD&hydrate=team
//   live      /api/v1.1/game/{gamePk}/feed/live   gameData + liveData.boxscore
//   boxscore  /api/v1/game/{gamePk}/boxscore       the same box, final or live
//   players   /api/v1/sports/1/players?season=      the directory (phase 2)
//
// Pure over the payloads; fetchers at the bottom.
import { getJson } from './http.js';

const BASE = 'https://statsapi.mlb.com/api';

const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** "6.2" innings → 20 outs. The feed writes thirds after the point. */
export function inningsToOuts(ip) {
  const m = /^(\d+)(?:\.(\d))?$/.exec(String(ip ?? '').trim());
  if (!m) return 0;
  return Number(m[1]) * 3 + Number(m[2] ?? 0);
}

export function mlbStatus(status) {
  const d = String(status?.detailedState ?? '');
  if (/postponed/i.test(d)) return 'postponed';
  if (/cancel/i.test(d)) return 'cancelled';
  const a = status?.abstractGameState;
  if (a === 'Live') return 'live';
  if (a === 'Final') return 'final';
  return 'pre';
}

const GAME_TYPE = { R: 'regular', S: 'preseason', E: 'exhibition', F: 'playoffs', D: 'playoffs', L: 'playoffs', W: 'playoffs', A: 'allstar' };

const abbrOf = (team) => team?.abbreviation ?? team?.teamCode?.toUpperCase?.() ?? (team?.id != null ? String(team.id) : '');

/** One schedule game → sport_game row fields. */
export function mlbGameRow(g) {
  return {
    sport: 'mlb',
    season: String(g.season ?? String(g.gameDate ?? '').slice(0, 4)),
    gameId: String(g.gamePk),
    gameDate: g.officialDate ?? String(g.gameDate ?? '').slice(0, 10),
    startUtc: g.gameDate ?? null,
    status: mlbStatus(g.status),
    away: abbrOf(g.teams?.away?.team),
    home: abbrOf(g.teams?.home?.team),
    awayScore: g.teams?.away?.score ?? null,
    homeScore: g.teams?.home?.score ?? null,
    gameType: GAME_TYPE[g.gameType] ?? String(g.gameType ?? ''),
    clock: null,
  };
}

export function mlbScheduleGames(payload) {
  const out = [];
  for (const d of payload?.dates ?? []) for (const g of d.games ?? []) out.push(mlbGameRow(g));
  return out;
}

function hitterLine(b) {
  return {
    hgp: 1,
    pa: n(b.plateAppearances), ab: n(b.atBats), h: n(b.hits),
    '2b': n(b.doubles), '3b': n(b.triples), hr: n(b.homeRuns),
    r: n(b.runs), rbi: n(b.rbi), bb: n(b.baseOnBalls), ibb: n(b.intentionalWalks), hbp: n(b.hitByPitch),
    k: n(b.strikeOuts), sb: n(b.stolenBases), cs: n(b.caughtStealing),
    sf: n(b.sacFlies), sh: n(b.sacBunts), gidp: n(b.groundIntoDoublePlay),
  };
}

function pitcherLine(p) {
  return {
    pgp: 1,
    gs: n(p.gamesStarted), outs: p.outs != null ? n(p.outs) : inningsToOuts(p.inningsPitched),
    w: n(p.wins), l: n(p.losses), sv: n(p.saves), svo: n(p.saveOpportunities), bs: n(p.blownSaves), hld: n(p.holds),
    p_k: n(p.strikeOuts), p_bb: n(p.baseOnBalls), p_h: n(p.hits), p_hr: n(p.homeRuns), p_hbp: n(p.hitBatsmen),
    er: n(p.earnedRuns), p_r: n(p.runs), bf: n(p.battersFaced), pitches: n(p.numberOfPitches ?? p.pitchesThrown),
    cg: n(p.completeGames), sho: n(p.shutouts),
  };
}

const hasStats = (o) => !!o && typeof o === 'object' && Object.keys(o).length > 0;

/** A boxscore payload (`/boxscore`, or a live feed's liveData.boxscore) plus
 *  the game's row fields → lines for every player who batted or pitched.
 *  A two-way player gets one line carrying both halves. */
export function mlbBoxLines(box, teams) {
  const lines = [];
  for (const side of ['away', 'home']) {
    const t = box?.teams?.[side];
    if (!t) continue;
    const team = teams?.[side] ?? abbrOf(t.team);
    for (const p of Object.values(t.players ?? {})) {
      const bat = p.stats?.batting, pit = p.stats?.pitching;
      const batted = hasStats(bat) && (n(bat.plateAppearances) > 0 || n(bat.atBats) > 0 || n(bat.runs) > 0 || n(bat.stolenBases) > 0);
      const pitched = hasStats(pit) && (n(pit.battersFaced) > 0 || n(pit.outs) > 0 || inningsToOuts(pit.inningsPitched) > 0 || n(pit.gamesStarted) > 0);
      if (!batted && !pitched) continue;
      const line = { ...(batted ? hitterLine(bat) : {}), ...(pitched ? pitcherLine(pit) : {}) };
      const played = (p.allPositions ?? []).map((a) => a.abbreviation).filter(Boolean);
      lines.push({
        extId: String(p.person?.id ?? ''),
        name: p.person?.fullName ?? '',
        team,
        pos: p.position?.abbreviation ?? '',
        played: true,
        line,
        gamePositions: played,
      });
    }
  }
  return lines.filter((l) => l.extId);
}

/** The live feed → game row + lines. Status and score come from gameData
 *  and the linescore; the box from liveData. */
export function mlbLiveToGame(feed) {
  const gd = feed?.gameData ?? {};
  const ls = feed?.liveData?.linescore ?? {};
  const teams = { away: abbrOf(gd.teams?.away), home: abbrOf(gd.teams?.home) };
  const status = mlbStatus(gd.status);
  const game = {
    sport: 'mlb',
    season: String(gd.game?.season ?? String(gd.datetime?.officialDate ?? '').slice(0, 4)),
    gameId: String(feed?.gamePk ?? gd.game?.pk ?? ''),
    gameDate: gd.datetime?.officialDate ?? String(gd.datetime?.dateTime ?? '').slice(0, 10),
    startUtc: gd.datetime?.dateTime ?? null,
    status,
    away: teams.away, home: teams.home,
    awayScore: ls.teams?.away?.runs ?? null, homeScore: ls.teams?.home?.runs ?? null,
    gameType: GAME_TYPE[gd.game?.type] ?? String(gd.game?.type ?? ''),
    clock: status === 'live' && ls.currentInning ? `${ls.inningState ?? ls.inningHalf ?? ''} ${ls.currentInning}`.trim() : null,
  };
  return { game, lines: mlbBoxLines(feed?.liveData?.boxscore, teams) };
}

/** The players directory → rows (phase 2). */
export function mlbDirectoryPlayers(payload) {
  return (payload?.people ?? []).map((p) => ({
    extId: String(p.id), name: p.fullName ?? '', teamId: p.currentTeam?.id ?? null,
    pos: p.primaryPosition?.abbreviation ?? '', active: p.active !== false,
  }));
}

// ── I/O ──────────────────────────────────────────────────────────────────────
export const fetchMlbSchedule = (date) => getJson(`${BASE}/v1/schedule?sportId=1&date=${date}&hydrate=team`);
export const fetchMlbLive = (gamePk) => getJson(`${BASE}/v1.1/game/${gamePk}/feed/live`);
export const fetchMlbPlayers = (season) => getJson(`${BASE}/v1/sports/1/players?season=${season}`);

export const mlb = {
  id: 'mlb',
  async schedule(date) { return mlbScheduleGames(await fetchMlbSchedule(date)); },
  async game(gameId) { return mlbLiveToGame(await fetchMlbLive(gameId)); },
};
