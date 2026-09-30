// NHL → stat lines (v0.564.0). Source: api-web.nhle.com, the public JSON
// behind NHL.com's Gamecenter. No key; updates live with the game.
//
//   schedule  /v1/schedule/{YYYY-MM-DD}     the week from that date (gameWeek[])
//   boxscore  /v1/gamecenter/{id}/boxscore  playerByGameStats per side
//   landing   /v1/gamecenter/{id}/landing   summary.scoring — who assisted,
//                                           at what strength — the only place
//                                           PPA/SHA and the game-winner live
//   roster    /v1/roster/{TEAM}/current     the directory (phase 2)
//
// Everything below is PURE over the payloads (see test/sports-adapters.mjs);
// the fetchers at the bottom are the only I/O.
import { getJson } from './http.js';

const BASE = 'https://api-web.nhle.com/v1';

/** "14:58" → 14.97 minutes. */
export const toiMinutes = (s) => {
  const m = /^(\d+):(\d\d)$/.exec(String(s ?? ''));
  return m ? Math.round((Number(m[1]) + Number(m[2]) / 60) * 100) / 100 : 0;
};

/** The season's starting year: 20262027 → "2026". */
export const nhlSeason = (season) => String(season ?? '').slice(0, 4);

// FUT/PRE → pre · LIVE/CRIT → live · OFF/FINAL → final. gameScheduleState
// carries postponements and cancellations regardless of gameState.
export function nhlStatus(g) {
  const sched = g?.gameScheduleState;
  if (sched === 'PPD') return 'postponed';
  if (sched === 'CNCL') return 'cancelled';
  const s = g?.gameState;
  if (s === 'LIVE' || s === 'CRIT') return 'live';
  if (s === 'OFF' || s === 'FINAL') return 'final';
  return 'pre';
}

const GAME_TYPE = { 1: 'preseason', 2: 'regular', 3: 'playoffs' };

/** One schedule game → sport_game row fields. */
export function nhlGameRow(g) {
  return {
    sport: 'nhl',
    season: nhlSeason(g.season),
    gameId: String(g.id),
    gameDate: g.gameDate ?? String(g.startTimeUTC ?? '').slice(0, 10),
    startUtc: g.startTimeUTC ?? null,
    status: nhlStatus(g),
    away: g.awayTeam?.abbrev ?? '',
    home: g.homeTeam?.abbrev ?? '',
    awayScore: g.awayTeam?.score ?? null,
    homeScore: g.homeTeam?.score ?? null,
    gameType: GAME_TYPE[g.gameType] ?? String(g.gameType ?? ''),
    clock: null,
  };
}

/** Every game on the schedule payload's days (the week from the date asked). */
export function nhlScheduleGames(payload, onlyDate = null) {
  const out = [];
  for (const day of payload?.gameWeek ?? []) {
    if (onlyDate && day.date !== onlyDate) continue;
    // The day's date is the league's local game date; a schedule game
    // carries only startTimeUTC, which puts an 8pm ET puck drop on tomorrow.
    for (const g of day.games ?? []) out.push(nhlGameRow({ ...g, gameDate: day.date }));
  }
  return out;
}

/** Special-teams and game-winner credit from the landing page's scoring
 *  summary: { playerId → { ppg, ppa, shg, sha, gwg } }. The game-winner is
 *  the winning side's (loser's final + 1)th goal, shootout excluded — the
 *  NHL's own definition. */
export function nhlScoringCredits(landing) {
  const credits = new Map();
  const bump = (id, k) => {
    if (id == null) return;
    const c = credits.get(id) ?? { ppg: 0, ppa: 0, shg: 0, sha: 0, gwg: 0 };
    c[k]++;
    credits.set(id, c);
  };
  const goals = [];
  for (const per of landing?.summary?.scoring ?? []) {
    if (per?.periodDescriptor?.periodType === 'SO') continue;
    for (const g of per.goals ?? []) {
      goals.push({ team: g.teamAbbrev?.default ?? g.teamAbbrev, id: g.playerId });
      if (g.strength === 'pp') { bump(g.playerId, 'ppg'); for (const a of g.assists ?? []) bump(a.playerId, 'ppa'); }
      if (g.strength === 'sh') { bump(g.playerId, 'shg'); for (const a of g.assists ?? []) bump(a.playerId, 'sha'); }
    }
  }
  const away = landing?.awayTeam, home = landing?.homeTeam;
  const final = ['OFF', 'FINAL'].includes(landing?.gameState);
  if (final && away && home && away.score !== home.score && landing?.gameOutcome?.lastPeriodType !== 'SO') {
    const winner = away.score > home.score ? away : home;
    const loserScore = Math.min(away.score, home.score);
    let n = 0;
    for (const g of goals) {
      if (g.team !== winner.abbrev) continue;
      n++;
      if (n === loserScore + 1) { bump(g.id, 'gwg'); break; }
    }
  }
  return credits;
}

function skaterLine(p, credit) {
  return {
    gp: 1,
    toi: toiMinutes(p.toi),
    g: p.goals ?? 0, a: p.assists ?? 0, pm: p.plusMinus ?? 0, pim: p.pim ?? 0,
    sog: p.sog ?? 0, hit: p.hits ?? 0, blk: p.blockedShots ?? 0,
    ppg: credit?.ppg ?? p.powerPlayGoals ?? 0, ppa: credit?.ppa ?? 0,
    shg: credit?.shg ?? 0, sha: credit?.sha ?? 0, gwg: credit?.gwg ?? 0,
    fow: 0, fol: 0, // the box score gives a percentage only; faceoff counts come with the play-by-play (phase 2)
    gva: p.giveaways ?? 0, tka: p.takeaways ?? 0,
  };
}

function goalieLine(p, isStarter) {
  const toi = toiMinutes(p.toi);
  const dec = p.decision;
  const ga = p.goalsAgainst ?? 0;
  return {
    gapp: toi > 0 ? 1 : 0,
    gs: isStarter ? 1 : 0,
    gtoi: toi,
    w: dec === 'W' ? 1 : 0, l: dec === 'L' ? 1 : 0, otl: dec === 'O' ? 1 : 0,
    ga, sv: p.saves ?? 0, sa: p.shotsAgainst ?? 0,
    // A shutout is the win with no goals against while the only goalie who
    // played — a relief appearance at 0 GA is not one. `so` is set by the
    // caller once it has seen the whole side.
    so: 0,
  };
}

/** A box score (plus its landing page, when given) → the game row and one
 *  line per player who dressed. */
export function nhlBoxToGame(box, landing = null) {
  const credits = landing ? nhlScoringCredits(landing) : new Map();
  const game = {
    ...nhlGameRow({ ...box, gameDate: box.gameDate }),
    clock: box.clock ? `${box.periodDescriptor?.periodType === 'REG' ? 'P' + box.periodDescriptor?.number : box.periodDescriptor?.periodType ?? ''} ${box.clock.timeRemaining ?? ''}`.trim() : null,
  };
  const lines = [];
  for (const side of ['awayTeam', 'homeTeam']) {
    const team = box[side]?.abbrev ?? '';
    const stats = box.playerByGameStats?.[side];
    if (!stats) continue;
    for (const p of [...(stats.forwards ?? []), ...(stats.defense ?? [])]) {
      lines.push({ extId: String(p.playerId), name: p.name?.default ?? '', team, pos: p.position ?? '', played: true, line: skaterLine(p, credits.get(p.playerId)) });
    }
    const goalies = stats.goalies ?? [];
    const dressed = goalies.filter((g) => toiMinutes(g.toi) > 0);
    // The starter is the goalie with the most ice time (the box score carries
    // no starter flag); a shutout needs the win, 0 GA and nobody else in net.
    const starter = dressed.reduce((a, g) => (toiMinutes(g.toi) > toiMinutes(a?.toi) ? g : a), null);
    for (const g of goalies) {
      const line = goalieLine(g, starter === g);
      if (line.w && line.ga === 0 && dressed.length === 1 && game.status === 'final') line.so = 1;
      lines.push({ extId: String(g.playerId), name: g.name?.default ?? '', team, pos: 'G', played: line.gapp === 1, line });
    }
  }
  return { game, lines };
}

/** A roster payload → directory rows (phase 2 fills league_pool from these). */
export function nhlRosterPlayers(roster, team) {
  const out = [];
  for (const group of ['forwards', 'defensemen', 'goalies']) {
    for (const p of roster?.[group] ?? []) {
      out.push({
        extId: String(p.id),
        name: `${p.firstName?.default ?? ''} ${p.lastName?.default ?? ''}`.trim(),
        team, pos: p.positionCode ?? '', jersey: p.sweaterNumber ?? null,
        headshot: p.headshot ?? null,
      });
    }
  }
  return out;
}

// ── The directory (phase 2) ───────────────────────────────────────────────────
// Teams from the standings (32 rows, one call), a roster per team, and the
// season summary reports from the stats REST API — every skater and goalie
// in one call each, plus the "realtime" report for hits and blocks.
const STATS = 'https://api.nhle.com/stats/rest/en';

/** "2026" → 20262027, the stats API's season id. */
export const nhlSeasonId = (season) => Number(`${season}${Number(season) + 1}`);

/** A skater summary row (+ its realtime row) → a core season line. */
export function nhlSkaterSeasonLine(sum, rt = null) {
  const gp = sum.gamesPlayed ?? 0;
  return {
    gp, toi: Math.round(((sum.timeOnIcePerGame ?? 0) * gp) / 60 * 100) / 100,
    g: sum.goals ?? 0, a: sum.assists ?? 0, pm: sum.plusMinus ?? 0, pim: sum.penaltyMinutes ?? 0,
    sog: sum.shots ?? 0, hit: rt?.hits ?? 0, blk: rt?.blockedShots ?? 0,
    ppg: sum.ppGoals ?? 0, ppa: Math.max(0, (sum.ppPoints ?? 0) - (sum.ppGoals ?? 0)),
    shg: sum.shGoals ?? 0, sha: Math.max(0, (sum.shPoints ?? 0) - (sum.shGoals ?? 0)),
    gwg: sum.gameWinningGoals ?? 0, fow: 0, fol: 0, gva: rt?.giveaways ?? 0, tka: rt?.takeaways ?? 0,
  };
}

export function nhlGoalieSeasonLine(g) {
  return {
    gapp: g.gamesPlayed ?? 0, gs: g.gamesStarted ?? 0, gtoi: Math.round(((g.timeOnIce ?? 0) / 60) * 100) / 100,
    w: g.wins ?? 0, l: g.losses ?? 0, otl: g.otLosses ?? 0,
    ga: g.goalsAgainst ?? 0, sv: g.saves ?? 0, sa: g.shotsAgainst ?? 0, so: g.shutouts ?? 0,
  };
}

/** Season lines by player id from the three reports. */
export function nhlSeasonLines(skaters, goalies, realtime = null) {
  const rt = new Map((realtime?.data ?? []).map((r) => [String(r.playerId), r]));
  const out = new Map();
  for (const s of skaters?.data ?? []) out.set(String(s.playerId), nhlSkaterSeasonLine(s, rt.get(String(s.playerId))));
  for (const g of goalies?.data ?? []) out.set(String(g.playerId), nhlGoalieSeasonLine(g));
  return out;
}

export const nhlStandingsTeams = (standings) =>
  (standings?.standings ?? []).map((t) => t.teamAbbrev?.default ?? t.teamAbbrev).filter(Boolean);

// ── I/O ──────────────────────────────────────────────────────────────────────
export const fetchNhlSchedule = (date) => getJson(`${BASE}/schedule/${date}`);
export const fetchNhlStandings = () => getJson(`${BASE}/standings/now`);
const report = (kind, seasonId) => getJson(`${STATS}/${kind}?cayenneExp=seasonId=${seasonId}%20and%20gameTypeId=2&limit=-1`);
export const fetchNhlSeason = async (season) => {
  const id = nhlSeasonId(season);
  const [skaters, goalies, realtime] = await Promise.all([report('skater/summary', id), report('goalie/summary', id), report('skater/realtime', id).catch(() => null)]);
  return nhlSeasonLines(skaters, goalies, realtime);
};
export const fetchNhlBox = (gameId) => getJson(`${BASE}/gamecenter/${gameId}/boxscore`);
export const fetchNhlLanding = (gameId) => getJson(`${BASE}/gamecenter/${gameId}/landing`);
export const fetchNhlRoster = (team) => getJson(`${BASE}/roster/${team}/current`);

export const nhl = {
  id: 'nhl',
  async schedule(date) { return nhlScheduleGames(await fetchNhlSchedule(date), date); },
  async game(gameId) {
    const [box, landing] = await Promise.all([fetchNhlBox(gameId), fetchNhlLanding(gameId).catch(() => null)]);
    return nhlBoxToGame(box, landing);
  },
  /** Every rostered player with a season line for ranking: this season's
   *  once he has 20 games in it, else last season's. ~35 requests. */
  async directory(season) {
    const teams = nhlStandingsTeams(await fetchNhlStandings());
    const [cur, prior] = await Promise.all([fetchNhlSeason(season), fetchNhlSeason(String(Number(season) - 1))]);
    const out = [];
    for (const team of teams) {
      let roster;
      try { roster = await fetchNhlRoster(team); } catch (e) { throw new Error(`roster ${team}: ${e.message}`); }
      for (const p of nhlRosterPlayers(roster, team)) {
        const c = cur.get(p.extId), pr = prior.get(p.extId);
        const played = (l) => (l?.gp ?? 0) + (l?.gapp ?? 0);
        const use = played(c) >= 20 ? c : (pr ?? c ?? null);
        out.push({ ...p, injury: null, season: use, seasonId: use === c && c ? season : pr ? String(Number(season) - 1) : season, gp: played(use) });
      }
    }
    return out;
  },
};
