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

// ── The directory (phase 2) ───────────────────────────────────────────────────
// The players list (one call), the teams (one), the season hitting /
// pitching / fielding leaderboards (three per season — every player in each,
// so no per-player calls), and the 40-man roster per team for IL status.

export function mlbHitterSeasonLine(st) {
  return {
    hgp: n(st.gamesPlayed), pa: n(st.plateAppearances), ab: n(st.atBats), h: n(st.hits),
    '2b': n(st.doubles), '3b': n(st.triples), hr: n(st.homeRuns), r: n(st.runs), rbi: n(st.rbi),
    bb: n(st.baseOnBalls), ibb: n(st.intentionalWalks), hbp: n(st.hitByPitch), k: n(st.strikeOuts),
    sb: n(st.stolenBases), cs: n(st.caughtStealing), sf: n(st.sacFlies), sh: n(st.sacBunts), gidp: n(st.groundIntoDoublePlay),
  };
}

export function mlbPitcherSeasonLine(st) {
  return {
    pgp: n(st.gamesPlayed), gs: n(st.gamesStarted), outs: st.outs != null ? n(st.outs) : inningsToOuts(st.inningsPitched),
    w: n(st.wins), l: n(st.losses), sv: n(st.saves), svo: n(st.saveOpportunities), bs: n(st.blownSaves), hld: n(st.holds),
    p_k: n(st.strikeOuts), p_bb: n(st.baseOnBalls), p_h: n(st.hits), p_hr: n(st.homeRuns), p_hbp: n(st.hitBatsmen),
    er: n(st.earnedRuns), p_r: n(st.runs), bf: n(st.battersFaced), pitches: n(st.numberOfPitches),
    cg: n(st.completeGames), sho: n(st.shutouts),
  };
}

/** Season lines by player id: a hitter's, a pitcher's, or both on one line. */
export function mlbSeasonLines(hitting, pitching) {
  const out = new Map();
  for (const s of hitting?.stats?.[0]?.splits ?? []) out.set(String(s.player.id), mlbHitterSeasonLine(s.stat));
  for (const s of pitching?.stats?.[0]?.splits ?? []) {
    const id = String(s.player.id);
    out.set(id, { ...(out.get(id) ?? {}), ...mlbPitcherSeasonLine(s.stat) });
  }
  return out;
}

/** Fielding games by position per player, for eligibility. */
export function mlbFieldingGames(fielding) {
  const out = new Map();
  for (const s of fielding?.stats?.[0]?.splits ?? []) {
    const id = String(s.player.id), pos = s.position?.abbreviation;
    if (!pos) continue;
    const m = out.get(id) ?? new Map();
    m.set(pos, (m.get(pos) ?? 0) + n(s.stat.games ?? s.stat.gamesPlayed));
    out.set(id, m);
  }
  return out;
}

const OF = new Set(['LF', 'CF', 'RF', 'OF']);
const ELIG_GAMES = 10;

/** The platform rule: a position played 10+ games (fielding), a pitcher's
 *  role from his starts, a DH for a hitter with no fielding position, and
 *  always the primary position. Returns feed codes (OF collapsed). */
export function mlbEligibility(primary, games, line) {
  const codes = new Set();
  const add = (c) => { if (c) codes.add(OF.has(c) ? 'OF' : c); };
  for (const [pos, g] of games ?? []) if (g >= ELIG_GAMES && pos !== 'P' && pos !== 'DH') add(pos);
  const gs = line?.gs ?? 0, pg = line?.pgp ?? 0;
  const pitched = pg > 0 || primary === 'P' || primary === 'TWP';
  if (pitched) {
    if (gs >= 3 && gs >= pg / 2) codes.add('SP');
    if (pg - gs >= 5 || gs < 3) codes.add('RP');
    if (gs >= 5 && pg - gs >= 10) { codes.add('SP'); codes.add('RP'); }
  }
  const hits = (line?.hgp ?? 0) > 0;
  if (primary && primary !== 'P' && primary !== 'TWP') add(primary);
  if (hits && ![...codes].some((c) => !['SP', 'RP'].includes(c))) codes.add('DH');
  if (primary === 'TWP') { codes.add('DH'); }
  return [...codes];
}

const IL = { D7: 'IL7', D10: 'IL10', D15: 'IL15', D60: 'IL60' };

/** 40-man roster payloads → { playerId → { status, jersey } }. */
export function mlbRosterStatus(rosters) {
  const out = new Map();
  for (const r of rosters) for (const e of r?.roster ?? []) {
    const code = e.status?.code ?? '';
    out.set(String(e.person?.id), { injury: IL[code] ? { code: IL[code], note: e.status?.description ?? null } : null, minors: code === 'RM', jersey: e.jerseyNumber ?? null });
  }
  return out;
}

export function mlbBuildDirectory({ players, teams, cur, prior, fielding, rosters, season }) {
  const teamAbbr = new Map((teams?.teams ?? []).map((t) => [t.id, t.abbreviation]));
  const curLines = mlbSeasonLines(cur.hitting, cur.pitching), priorLines = mlbSeasonLines(prior.hitting, prior.pitching);
  const games = mlbFieldingGames(fielding);
  const status = mlbRosterStatus(rosters);
  const out = [];
  for (const p of players?.people ?? []) {
    if (p.active === false || !p.currentTeam?.id) continue;
    const id = String(p.id);
    const c = curLines.get(id), pr = priorLines.get(id);
    const played = (l) => (l?.hgp ?? 0) + (l?.pgp ?? 0);
    const use = played(c) >= 40 ? c : (pr ?? c ?? null);
    const primary = p.primaryPosition?.abbreviation ?? '';
    const st = status.get(id);
    out.push({
      extId: id, name: p.fullName ?? '', team: teamAbbr.get(p.currentTeam.id) ?? String(p.currentTeam.id),
      pos: primary, feedCodes: mlbEligibility(primary, games.get(id), use ?? c ?? pr),
      jersey: st?.jersey ?? p.primaryNumber ?? null, headshot: null,
      injury: st?.injury ?? null, minors: st?.minors ?? false,
      season: use, seasonId: use && use === c ? season : pr ? String(Number(season) - 1) : season, gp: played(use),
    });
  }
  return out;
}

// ── I/O ──────────────────────────────────────────────────────────────────────
export const fetchMlbSchedule = (date) => getJson(`${BASE}/v1/schedule?sportId=1&date=${date}&hydrate=team`);
export const fetchMlbTeams = (season) => getJson(`${BASE}/v1/teams?sportId=1&season=${season}`);
const leaderboard = (group, season) => getJson(`${BASE}/v1/stats?stats=season&group=${group}&season=${season}&sportId=1&playerPool=all&limit=8000`, { timeoutMs: 60000 });
export const fetchMlbSeason = async (season) => ({ hitting: await leaderboard('hitting', season), pitching: await leaderboard('pitching', season) });
export const fetchMlbFielding = (season) => leaderboard('fielding', season);
export const fetchMlbRoster40 = (teamId) => getJson(`${BASE}/v1/teams/${teamId}/roster?rosterType=40Man`);
export const fetchMlbLive = (gamePk) => getJson(`${BASE}/v1.1/game/${gamePk}/feed/live`);
export const fetchMlbPlayers = (season) =>
  getJson(`${BASE}/v1/sports/1/players?season=${season}&fields=people,id,fullName,active,currentTeam,id,primaryPosition,abbreviation,primaryNumber`, { timeoutMs: 60000 });

export const mlb = {
  id: 'mlb',
  async schedule(date) { return mlbScheduleGames(await fetchMlbSchedule(date)); },
  async game(gameId) { return mlbLiveToGame(await fetchMlbLive(gameId)); },
  /** ~38 requests: players, teams, six leaderboards, 30 rosters. */
  async directory(season) {
    const priorSeason = String(Number(season) - 1);
    const [players, teams, cur, prior, fielding] = await Promise.all([
      fetchMlbPlayers(season), fetchMlbTeams(season), fetchMlbSeason(season), fetchMlbSeason(priorSeason), fetchMlbFielding(season),
    ]);
    const rosters = [];
    for (const t of teams.teams ?? []) {
      try { rosters.push(await fetchMlbRoster40(t.id)); } catch (e) { throw new Error(`roster ${t.abbreviation}: ${e.message}`); }
    }
    return mlbBuildDirectory({ players, teams, cur, prior, fielding, rosters, season });
  },
};
