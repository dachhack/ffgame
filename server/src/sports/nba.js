// NBA and WNBA → stat lines (v0.616.0). Source: the leagues' liveData CDN,
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

// ── The NBA directory: Sleeper's (phase 2) ───────────────────────────────────
// stats.nba.com refuses cloud hosts, so the roster comes from Sleeper's
// public directory (the same family the NFL worker already reads):
// position + fantasy_positions, team, injury status, and search_rank — a
// popularity order that stands in for ADP until a season line exists.
// Sleeper ids are NOT NBA ids; a Sleeper row carries no nba.com id, so the
// crosswalk to cdn.nba.com box scores is by (team, name) — see
// sportDirectory.js. The player_key still uses the Sleeper id, as the one
// id we hold for every player.
const SLEEPER_INJURY = { Out: 'O', DTD: 'GTD', IR: 'OFS', Doubtful: 'D', Questionable: 'Q', Probable: 'P', Sus: 'O' };

export function sleeperNbaPlayers(directory) {
  const out = [];
  for (const p of Object.values(directory ?? {})) {
    if (!p || !p.active || !p.team || !/^\d+$/.test(String(p.player_id))) continue;
    const name = p.full_name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    if (!name) continue;
    const codes = [...new Set([p.position, ...(p.fantasy_positions ?? [])].filter(Boolean))];
    out.push({
      extId: String(p.player_id), name, team: p.team, pos: p.position ?? '', feedCodes: codes,
      jersey: p.number != null ? String(p.number) : null, headshot: null,
      injury: p.injury_status ? { code: SLEEPER_INJURY[p.injury_status] ?? 'O', note: [p.injury_body_part, p.injury_notes].filter(Boolean).join(' — ') || null } : null,
      searchRank: Number.isFinite(p.search_rank) ? p.search_rank : null,
      season: null, seasonId: null, gp: 0,
    });
  }
  return out;
}

/** Sleeper's season stats (`/v1/stats/nba/regular/{year}`, keyed by Sleeper
 *  id; `year` is the season's starting year) → core season lines. `sp` is
 *  seconds played. */
export function sleeperNbaSeasonLines(stats) {
  const out = new Map();
  for (const [id, s] of Object.entries(stats ?? {})) {
    if (!s || !s.gp) continue;
    out.set(String(id), {
      gp: s.gp ?? 0, min: Math.round(((s.sp ?? 0) / 60) * 100) / 100, pts: s.pts ?? 0,
      fgm: s.fgm ?? 0, fga: s.fga ?? 0, ftm: s.ftm ?? 0, fta: s.fta ?? 0, tpm: s.tpm ?? 0, tpa: s.tpa ?? 0,
      oreb: s.oreb ?? 0, dreb: s.dreb ?? 0, reb: s.reb ?? 0, ast: s.ast ?? 0, stl: s.stl ?? 0, blk: s.blk ?? 0,
      tov: s.to ?? 0, pf: s.pf ?? 0,
      // Per-game derived stats as SEASON COUNTS (core sports/card.ts): a
      // season line cannot re-derive them, so the source's counts ride along.
      dd: s.dd ?? 0, td: s.td ?? 0,
    });
  }
  return out;
}

// ── The WNBA directory: ESPN's (phase 2) ─────────────────────────────────────
// Sleeper has no WNBA; the CDN's static roster files refuse cloud hosts; so
// the directory is ESPN's team roster, the same family the college poller
// reads (site.api.espn.com …/basketball/wnba/teams/{id}/roster). ESPN ids
// become the player_key; box-score personIds crosswalk by name + team
// (sportDirectory.js).
const ESPN_WNBA = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba';

// ESPN's WNBA abbreviations → the league's own tricodes, which the box
// scores (cdn.wnba.com) carry and every team join reads. Unknown codes pass.
export const WNBA_TEAM = { NY: 'NYL', LV: 'LVA', LA: 'LAS', CONN: 'CON', PHX: 'PHO', WSH: 'WAS', GS: 'GSV' };
export const wnbaTeam = (code) => WNBA_TEAM[String(code ?? '').toUpperCase()] ?? String(code ?? '').toUpperCase();

/** One ESPN roster payload (athletes flat, or grouped) → directory rows. */
export function espnWnbaRoster(roster) {
  const team = wnbaTeam(roster?.team?.abbreviation ?? '');
  const items = (roster?.athletes ?? []).flatMap((a) => (Array.isArray(a?.items) ? a.items : [a]));
  const out = [];
  for (const a of items) {
    const id = String(a?.id ?? '');
    const name = (a?.fullName ?? a?.displayName ?? '').trim();
    if (!/^\d+$/.test(id) || !name) continue;
    const pos = a?.position?.abbreviation ?? '';
    const inj = Array.isArray(a?.injuries) && a.injuries[0] ? a.injuries[0] : null;
    const status = a?.status?.type;
    out.push({
      extId: id, name, team, pos, feedCodes: pos ? [pos] : [],
      jersey: a?.jersey != null ? String(a.jersey) : null, headshot: a?.headshot?.href ?? null,
      injury: inj ? { code: /out/i.test(inj.status ?? '') ? 'O' : /doubt/i.test(inj.status ?? '') ? 'D' : /quest|day/i.test(inj.status ?? '') ? 'Q' : 'GTD', note: inj.details?.type ?? inj.shortComment ?? null } : null,
      active: status == null ? true : status === 'active',
      searchRank: null, season: null, seasonId: null, gp: 0,
    });
  }
  return out;
}

// ── The season schedule (phase 5) ────────────────────────────────────────────
// The live scoreboard only knows today. Any other date comes from the
// season schedule file on the same CDN (scheduleLeagueV2*.json): every game
// of the season under gameDates[].games[], dated in Eastern time
// ("10/22/2026 00:00:00") with a gameDateTimeUTC. Cached for six hours.
// SHAPE FROM THE PUBLIC FILE'S DOCUMENTATION, not a capture — the CDN
// refuses this build container (see the header) — so the parser is
// defensive and the test runs on a documented-shape sample.
const etDateOf = (s) => {
  // "10/22/2026 00:00:00" → "2026-10-22"; an ISO date passes through.
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(s ?? ''));
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  return String(s ?? '').slice(0, 10);
};

/** The season schedule → sport_game row fields for one Eastern date. */
export function nbaSeasonGames(payload, sport, date) {
  const out = [];
  for (const d of payload?.leagueSchedule?.gameDates ?? []) {
    if (etDateOf(d.gameDate) !== date) continue;
    for (const g of d.games ?? []) {
      if (!g?.gameId) continue;
      const row = nbaGameRow({ ...g, gameEt: g.gameDateTimeEst ?? g.gameDateEst ?? d.gameDate, gameTimeUTC: g.gameDateTimeUTC ?? g.gameTimeUTC ?? null }, sport);
      row.gameDate = date;
      // Scores on the schedule file lag the scoreboard; only carry them when
      // the game is over.
      if (row.status !== 'final') { row.awayScore = null; row.homeScore = null; }
      out.push(row);
    }
  }
  return out;
}

const referer = (sport) => ({ Referer: `https://www.${sport}.com/`, Origin: `https://www.${sport}.com` });
const scheduleCache = new Map();   // sport → { at, payload }
const SCHEDULE_TTL_MS = 6 * 3600e3;
const SCHEDULE_FILES = { nba: ['scheduleLeagueV2.json', 'scheduleLeagueV2_1.json'], wnba: ['scheduleLeagueV2_10.json', 'scheduleLeagueV2.json'] };
async function seasonSchedule(sport) {
  const c = scheduleCache.get(sport);
  if (c && Date.now() - c.at < SCHEDULE_TTL_MS) return c.payload;
  let lastErr = null;
  for (const f of SCHEDULE_FILES[sport]) {
    try {
      const payload = await getJson(`${HOST[sport]}/static/json/staticData/${f}`, { headers: referer(sport), timeoutMs: 60000 });
      if (payload?.leagueSchedule?.gameDates) { scheduleCache.set(sport, { at: Date.now(), payload }); return payload; }
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error(`${sport}: no season schedule`);
}

// ── I/O ──────────────────────────────────────────────────────────────────────
export const fetchSleeperNba = () => getJson('https://api.sleeper.app/v1/players/nba', { timeoutMs: 60000 });
export const fetchEspnWnbaTeams = () => getJson(`${ESPN_WNBA}/teams`);
export const fetchEspnWnbaRoster = (teamId) => getJson(`${ESPN_WNBA}/teams/${teamId}/roster`);
export const fetchSleeperNbaSeason = (year) => getJson(`https://api.sleeper.app/v1/stats/nba/regular/${year}`, { timeoutMs: 60000 });
export const fetchScoreboard = (sport) =>
  getJson(`${HOST[sport]}/static/json/liveData/scoreboard/todaysScoreboard_${LEAGUE[sport]}.json`, { headers: referer(sport) });
export const fetchBox = (sport, gameId) =>
  getJson(`${HOST[sport]}/static/json/liveData/boxscore/boxscore_${gameId}.json`, { headers: referer(sport) });

const basketball = (sport) => ({
  id: sport,
  // Today from the live scoreboard (scores and clocks); any other date from
  // the season schedule file. A scoreboard that is not on the asked date
  // (early morning, before it rolls) also falls back to the file.
  async schedule(date) {
    let sb = null;
    try { sb = await fetchScoreboard(sport); } catch { sb = null; }
    if (sb?.scoreboard?.gameDate && (!date || sb.scoreboard.gameDate === date)) return nbaScoreboardGames(sb, sport);
    return nbaSeasonGames(await seasonSchedule(sport), sport, date);
  },
  async game(gameId) { return nbaBoxToGame(await fetchBox(sport, gameId), sport); },
  async directory(season) {
    if (sport === 'wnba') {
      const teams = (await fetchEspnWnbaTeams())?.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team) ?? [];
      const out = [];
      for (const t of teams) {
        try { out.push(...espnWnbaRoster(await fetchEspnWnbaRoster(t.id))); }
        catch (e) { throw new Error(`roster ${t.abbreviation}: ${e.message}`); }
      }
      return out;
    }
    const [dir, cur, prior] = await Promise.all([fetchSleeperNba(), fetchSleeperNbaSeason(season).catch(() => ({})), fetchSleeperNbaSeason(String(Number(season) - 1)).catch(() => ({}))]);
    const curL = sleeperNbaSeasonLines(cur), priorL = sleeperNbaSeasonLines(prior);
    return sleeperNbaPlayers(dir).map((p) => {
      const c = curL.get(p.extId), pr = priorL.get(p.extId);
      const use = (c?.gp ?? 0) >= 20 ? c : (pr ?? c ?? null);
      return { ...p, season: use, seasonId: use && use === c ? season : pr ? String(Number(season) - 1) : null, gp: use?.gp ?? 0 };
    });
  },
});

export const nba = basketball('nba');
export const wnba = basketball('wnba');
