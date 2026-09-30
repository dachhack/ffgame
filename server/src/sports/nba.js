// NBA and WNBA → stat lines (v0.564.0). Source: the leagues' liveData CDN,
// the JSON NBA.com's own game pages read. Same shape for both leagues; the
// league id in the path is 00 (NBA) or 10 (WNBA).
//
//   scoreboard  cdn.{nba,wnba}.com/static/json/liveData/scoreboard/todaysScoreboard_{00|10}.json
//   boxscore    cdn.{nba,wnba}.com/static/json/liveData/boxscore/boxscore_{gameId}.json
//
// CAVEATS, measured 2026-09-30 (docs/multi-sport-plan.md): the CDN sits
// behind Akamai and refuses a bare client — send browser headers — and it
// refused this build container outright (403), so the fixture behind the
// test is the documented sample, not a capture. stats.nba.com is NOT used:
// it blocks cloud hosts. The scoreboard is today's only; a date's schedule
// comes from the season schedule file (phase 2).
import { getJson } from './http.js';

const HOST = { nba: 'https://cdn.nba.com', wnba: 'https://cdn.wnba.com' };
const LEAGUE = { nba: '00', wnba: '10' };

/** "PT25M01.00S" → 25.02 minutes. */
export function isoMinutes(s) {
  const m = /^PT(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(String(s ?? ''));
  if (!m) return 0;
  return Math.round((Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60) * 100) / 100;
}

/** A game id's season: "0022000181" → "2020" (positions 3–4 are the season's
 *  two-digit starting year, for both leagues). */
export const seasonOfGameId = (gameId) => String(2000 + Number(String(gameId).slice(3, 5)));

// gameStatus 1 pre · 2 live · 3 final; a postponement shows in the text.
export function nbaStatus(g) {
  const text = String(g?.gameStatusText ?? '');
  if (/ppd|postponed/i.test(text)) return 'postponed';
  if (/cancel/i.test(text)) return 'cancelled';
  const s = Number(g?.gameStatus);
  return s === 2 ? 'live' : s === 3 ? 'final' : 'pre';
}

const gameType = (gameId) => ({ '1': 'preseason', '2': 'regular', '3': 'allstar', '4': 'playoffs', '5': 'playin' })[String(gameId).charAt(2)] ?? '';

export function nbaGameRow(g, sport) {
  const id = String(g.gameId);
  return {
    sport,
    season: seasonOfGameId(id),
    gameId: id,
    gameDate: String(g.gameEt ?? g.gameTimeUTC ?? '').slice(0, 10),
    startUtc: g.gameTimeUTC ?? null,
    status: nbaStatus(g),
    away: g.awayTeam?.teamTricode ?? '',
    home: g.homeTeam?.teamTricode ?? '',
    awayScore: g.awayTeam?.score ?? null,
    homeScore: g.homeTeam?.score ?? null,
    gameType: gameType(id),
    clock: nbaStatus(g) === 'live' ? `Q${g.period ?? ''} ${g.gameClock ?? ''}`.trim() : null,
  };
}

export function nbaScoreboardGames(payload, sport) {
  return (payload?.scoreboard?.games ?? []).map((g) => nbaGameRow(g, sport));
}

function playerLine(p) {
  const s = p.statistics ?? {};
  return {
    gp: p.played === '1' || p.played === 1 ? 1 : 0,
    min: isoMinutes(s.minutes),
    pts: s.points ?? 0,
    fgm: s.fieldGoalsMade ?? 0, fga: s.fieldGoalsAttempted ?? 0,
    ftm: s.freeThrowsMade ?? 0, fta: s.freeThrowsAttempted ?? 0,
    tpm: s.threePointersMade ?? 0, tpa: s.threePointersAttempted ?? 0,
    oreb: s.reboundsOffensive ?? 0, dreb: s.reboundsDefensive ?? 0, reb: s.reboundsTotal ?? 0,
    ast: s.assists ?? 0, stl: s.steals ?? 0, blk: s.blocks ?? 0, tov: s.turnovers ?? 0,
    pf: s.foulsPersonal ?? 0,
  };
}

/** A liveData box score → game row + one line per listed player (the
 *  inactive are listed too, with played 0, so a manager sees the scratch). */
export function nbaBoxToGame(box, sport) {
  const g = box?.game ?? {};
  const game = nbaGameRow(g, sport);
  const lines = [];
  for (const side of ['awayTeam', 'homeTeam']) {
    const team = g[side]?.teamTricode ?? '';
    for (const p of g[side]?.players ?? []) {
      const line = playerLine(p);
      lines.push({
        extId: String(p.personId), name: p.name ?? `${p.firstName ?? ''} ${p.familyName ?? ''}`.trim(),
        team, pos: p.position ?? '', played: line.gp === 1, line,
        status: p.status === 'INACTIVE' ? (p.notPlayingReason ?? 'INACTIVE') : null,
      });
    }
  }
  return { game, lines };
}

// ── I/O ──────────────────────────────────────────────────────────────────────
const referer = (sport) => ({ Referer: `https://www.${sport}.com/`, Origin: `https://www.${sport}.com` });
export const fetchScoreboard = (sport) =>
  getJson(`${HOST[sport]}/static/json/liveData/scoreboard/todaysScoreboard_${LEAGUE[sport]}.json`, { headers: referer(sport) });
export const fetchBox = (sport, gameId) =>
  getJson(`${HOST[sport]}/static/json/liveData/boxscore/boxscore_${gameId}.json`, { headers: referer(sport) });

const basketball = (sport) => ({
  id: sport,
  // The live CDN only knows today; a date other than today is answered from
  // the season schedule in phase 2. Until then a past date returns [].
  async schedule(date) {
    const sb = await fetchScoreboard(sport);
    const games = nbaScoreboardGames(sb, sport);
    return date && sb?.scoreboard?.gameDate && sb.scoreboard.gameDate !== date ? [] : games;
  },
  async game(gameId) { return nbaBoxToGame(await fetchBox(sport, gameId), sport); },
});

export const nba = basketball('nba');
export const wnba = basketball('wnba');
