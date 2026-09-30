// The sport adapters, against real feed captures (NHL opening night
// 2026-09-29, MLB postseason 2026-09-29) and the documented NBA liveData
// sample. Every line is scored through core so the vocabulary and the
// scoring table are proven to agree. Run: `npx tsx test/sports-adapters.mjs`
// from server/.
import { readFileSync } from 'node:fs';
import { nhlBoxToGame, nhlScheduleGames, nhlScoringCredits, nhlRosterPlayers, toiMinutes } from '../src/sports/nhl.js';
import { mlbBoxLines, mlbLiveToGame, mlbScheduleGames, mlbDirectoryPlayers, inningsToOuts } from '../src/sports/mlb.js';
import { nbaBoxToGame, isoMinutes, seasonOfGameId, nbaSeasonGames } from '../src/sports/nba.js';
import { ADAPTERS } from '../src/sports/index.js';
import { SPORTS, eligibleFor, playerKey } from '../../packages/core/src/sports/index.ts';
import { linePoints, categoryTotals, compareCategories } from '../../packages/core/src/sports/score.ts';

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/sports/${n}`, import.meta.url), 'utf8'));
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };
const known = (sport, lines) => {
  const ids = new Set(SPORTS[sport].stats.filter((s) => !s.derived).map((s) => s.id));
  return lines.every((l) => Object.keys(l.line).every((k) => ids.has(k)));
};
const sum = (lines, k) => lines.reduce((t, l) => t + (l.line[k] ?? 0), 0);

// ── NHL ──────────────────────────────────────────────────────────────────────
{
  const box = fx('nhl-box-final-2026020002.json'), landing = fx('nhl-landing-final-2026020002.json');
  const { game, lines } = nhlBoxToGame(box, landing);
  ok(game.sport === 'nhl' && game.season === '2026' && game.gameId === '2026020002' && game.status === 'final', `NHL game row: ${game.away} ${game.awayScore} @ ${game.home} ${game.homeScore} (${game.status})`);
  ok(known('nhl', lines), 'NHL lines use only core stat ids');
  const skaters = lines.filter((l) => l.pos !== 'G');
  ok(sum(skaters, 'g') === game.awayScore + game.homeScore, `skater goals sum to the score (${sum(skaters, 'g')})`);
  const goalies = lines.filter((l) => l.pos === 'G');
  ok(goalies.length === 4 && goalies.filter((g) => g.line.w).length === 1 && goalies.filter((g) => g.line.l).length === 1, 'one winning and one losing goalie');
  ok(goalies.filter((g) => g.line.gs).length === 2 && goalies.every((g) => g.played === (g.line.gtoi > 0)), 'one starter per side; played follows ice time');
  const credits = nhlScoringCredits(landing);
  const gwg = [...credits.values()].reduce((t, c) => t + c.gwg, 0);
  ok(gwg === 1, `exactly one game-winning goal credited (${gwg})`);
  ok(sum(skaters, 'ppg') === [...credits.values()].reduce((t, c) => t + c.ppg, 0), 'power-play goals agree between box and landing');
  const star = lines.find((l) => l.extId === '8478851');
  ok(star && star.line.g === 1 && star.line.a === 1, `first star's line: ${star?.name} ${star?.line.g}G ${star?.line.a}A`);
  const pts = linePoints(SPORTS.nhl, star.line);
  ok(pts > 10, `first star scores ${pts} under the default table`);
  ok(toiMinutes('14:58') === 14.97 && toiMinutes('00:00') === 0, 'TOI parses');
  const sched = nhlScheduleGames(fx('nhl-schedule-2026-09-29.json'), '2026-09-29');
  ok(sched.length === 5 && sched.every((g) => g.sport === 'nhl' && g.gameType === 'regular'), `schedule: ${sched.length} games on opening night`);
  ok(sched.every((g) => g.gameDate === '2026-09-29') && sched.some((g) => g.startUtc.startsWith('2026-09-30')), 'an 8pm ET game dated 2026-09-30 UTC is still on the 29th');
  const live = nhlBoxToGame(fx('nhl-box-live-2026020003.json'));
  ok(live.game.status === 'live' && /^P3/.test(live.game.clock), `live game clock "${live.game.clock}"`);
  ok(live.lines.filter((l) => l.pos === 'G').every((g) => g.line.so === 0), 'no shutout credited while live');
  const roster = nhlRosterPlayers(fx('nhl-roster-bos.json'), 'BOS');
  ok(roster.length === 6 && roster.every((p) => /^\d+$/.test(p.extId) && p.name), 'roster rows carry numeric ids and names');
  ok(eligibleFor('nhl', 'L').join() === 'LW' && eligibleFor('nhl', 'R').join() === 'RW' && playerKey('nhl', 8478851) === 'nhl-8478851', 'NHL position map and player key');
}

// ── MLB ──────────────────────────────────────────────────────────────────────
{
  const box = fx('mlb-box-final-849845.json');
  const lines = mlbBoxLines(box, { away: 'PHI', home: 'ATL' });
  ok(known('mlb', lines), 'MLB lines use only core stat ids');
  const hitters = lines.filter((l) => l.line.hgp), pitchers = lines.filter((l) => l.line.pgp);
  ok(hitters.length >= 18 && pitchers.length >= 2, `${hitters.length} hitters, ${pitchers.length} pitchers`);
  ok(sum(pitchers, 'w') === 1 && sum(pitchers, 'l') === 1, 'one win and one loss');
  ok(sum(pitchers, 'outs') === 27 * 2 || sum(pitchers, 'outs') >= 51, `pitcher outs sum to a full game (${sum(pitchers, 'outs')})`);
  ok(sum(hitters, 'r') === sum(pitchers, 'p_r'), 'runs scored equal runs allowed');
  const harris = lines.find((l) => l.extId === '671739');
  ok(harris && harris.line.h === 3 && harris.line.r === 2 && harris.gamePositions.includes('CF'), `Michael Harris II: ${harris?.line.h}-for-${harris?.line.ab}, played ${harris?.gamePositions}`);
  const starters = pitchers.filter((p) => p.line.gs);
  ok(starters.length === 2, 'two starting pitchers');
  ok(inningsToOuts('6.2') === 20 && inningsToOuts('1.0') === 3 && inningsToOuts('') === 0, 'innings parse to outs');
  const live = mlbLiveToGame(fx('mlb-live-849851.json'));
  ok(live.game.status === 'live' && live.game.away === 'BOS' && live.game.home === 'NYY' && /6/.test(live.game.clock), `live: ${live.game.away} @ ${live.game.home}, "${live.game.clock}"`);
  ok(live.lines.length > 20 && known('mlb', live.lines), `live feed yields ${live.lines.length} lines`);
  const sched = mlbScheduleGames(fx('mlb-schedule-2026-09-29.json'));
  ok(sched.length === 4 && sched.every((g) => g.gameType === 'playoffs'), `schedule: ${sched.length} postseason games`);
  const dir = mlbDirectoryPlayers(fx('mlb-players-sample.json'));
  ok(dir.length === 20 && dir.every((p) => /^\d+$/.test(p.extId)), 'directory rows carry numeric ids');
  // A pitcher's line scores like a pitcher; a 5x5 comparison runs on totals.
  const sp = starters[0];
  const spPts = linePoints(SPORTS.mlb, sp.line);
  ok(Number.isFinite(spPts), `${sp.name} scores ${spPts} (${sp.line.outs} outs, ${sp.line.p_k} K, ${sp.line.er} ER)`);
  const a = categoryTotals(SPORTS.mlb, hitters.filter((h) => h.team === 'PHI').map((h) => h.line));
  const b = categoryTotals(SPORTS.mlb, hitters.filter((h) => h.team === 'ATL').map((h) => h.line));
  const v = compareCategories(SPORTS.mlb, a, b, ['r', 'hr', 'rbi', 'sb', 'avg']);
  ok(v.cats.length === 5 && v.cats.every((c) => c.a != null && c.b != null), `5 hitting categories compared: ${v.wins}-${v.losses}-${v.ties}`);
  ok(eligibleFor('mlb', 'CF').join() === 'OF' && eligibleFor('mlb', 'P').join() === 'SP,RP', 'MLB position map');
}

// ── NBA (documented sample) ─────────────────────────────────────────────────
{
  const { game, lines } = nbaBoxToGame(fx('nba-box-doc-0022000180.json'), 'nba');
  ok(game.sport === 'nba' && game.season === '2020' && game.status === 'final' && game.away === 'ORL' && game.home === 'BOS', `NBA game row: ${game.away} ${game.awayScore} @ ${game.home} ${game.homeScore}`);
  ok(known('nba', lines), 'NBA lines use only core stat ids');
  const brown = lines.find((l) => l.extId === '1627759');
  ok(brown && brown.line.pts === 21 && brown.line.ast === 8 && brown.line.min === 25.02, `Jaylen Brown: ${brown?.line.pts} pts, ${brown?.line.ast} ast, ${brown?.line.min} min`);
  ok(linePoints(SPORTS.nba, brown.line) === 21 + 2 * 1.2 + 8 * 1.5 + 1 * 3 - 2, 'Yahoo default points for that line');
  ok(isoMinutes('PT00M00.00S') === 0 && seasonOfGameId('1022400012') === '2024', 'ISO minutes and WNBA season id');
  ok(eligibleFor('nba', 'G-F').join() === 'SG,SF' && eligibleFor('wnba', 'F-C').join() === 'F,C', 'basketball position maps');
}

// ── the NBA season schedule file (documented shape) ─────────────────────────
{
  const sched = { leagueSchedule: { seasonYear: '2026-27', leagueId: '00', gameDates: [
    { gameDate: '10/20/2026 00:00:00', games: [
      { gameId: '0022600001', gameCode: '20261020/OKCHOU', gameStatus: 1, gameStatusText: '7:30 pm ET', gameDateEst: '2026-10-20T00:00:00Z', gameDateTimeEst: '2026-10-20T19:30:00Z', gameDateTimeUTC: '2026-10-20T23:30:00Z', homeTeam: { teamTricode: 'HOU', score: 0 }, awayTeam: { teamTricode: 'OKC', score: 0 } },
      { gameId: '0022600002', gameCode: '20261020/GSWLAL', gameStatus: 3, gameStatusText: 'Final', gameDateTimeEst: '2026-10-20T22:00:00Z', gameDateTimeUTC: '2026-10-21T02:00:00Z', homeTeam: { teamTricode: 'LAL', score: 110 }, awayTeam: { teamTricode: 'GSW', score: 104 } },
    ] },
    { gameDate: '10/21/2026 00:00:00', games: [{ gameId: '0022600003', gameStatus: 1, gameDateTimeUTC: '2026-10-21T23:00:00Z', homeTeam: { teamTricode: 'BOS' }, awayTeam: { teamTricode: 'NYK' } }] },
  ] } };
  const day = nbaSeasonGames(sched, 'nba', '2026-10-20');
  ok(day.length === 2 && day.every((g) => g.gameDate === '2026-10-20' && g.sport === 'nba' && g.season === '2026'), 'the file yields the asked Eastern date only');
  ok(day[0].status === 'pre' && day[0].startUtc === '2026-10-20T23:30:00Z' && day[0].awayScore === null, 'a game ahead: its UTC start, no score');
  ok(day[1].status === 'final' && day[1].homeScore === 110 && day[1].gameType === 'regular', 'a final carries its score');
  ok(nbaSeasonGames(sched, 'nba', '2026-10-22').length === 0 && nbaSeasonGames({}, 'nba', '2026-10-20').length === 0, 'no games on an empty day or an empty file');
}

ok(Object.keys(ADAPTERS).sort().join() === 'mlb,nba,nhl,wnba', 'four adapters registered');

console.log(fails ? `\n${fails} FAILED` : '\nall sport adapter checks passed');
process.exit(fails ? 1 : 0);
