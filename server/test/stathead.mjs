// The Stathead client's pure parts (v0.633.0): the crosswalk coverage rule a
// pool is checked by before a sport switches provider. Run from server/:
// `npx tsx test/stathead.mjs`.
import { crosswalkCoverage, statheadSportOf } from '../src/stathead.js';
import { bareId, statheadGameRow, statheadLine, statheadBoxToGame, statheadSeasonMap, statheadDirectory, buildKeyMap, soccerPosn } from '../src/sports/statheadAdapter.js';
import { compareLines, compareSlates, describeLines } from '../src/poll/sportShadow.js';
import { linePoints } from '../../packages/core/src/sports/score.ts';
import { SPORTS } from '../../packages/core/src/sports/index.ts';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };

const xw = [
  { player_id: 'nhl-8478402', full_name: 'Connor McDavid', nhl_id: '8478402', sleeper_id: '5001' },
  { player_id: 'nba-3945274', full_name: 'Luka Doncic', espn_id: '3945274', sleeper_id: '1658' },
  { player_id: 'wnba-3917450', full_name: "A'ja Wilson", espn_id: '3917450', sleeper_id: null },
  { player_id: 'mlb-660271', full_name: 'Shohei Ohtani', mlb_id: '660271' },
];
const nhl = crosswalkCoverage('nhl', ['nhl-8478402', 'nhl-999'], xw);
ok(nhl.found.length === 1 && nhl.found[0].player_id === 'nhl-8478402' && nhl.missing.join() === 'nhl-999', 'NHL keys are the league id: a direct match, a miss reported');
const nba = crosswalkCoverage('nba', ['nba-1658', 'nba-7'], xw);
ok(nba.found.length === 1 && nba.found[0].player_id === 'nba-3945274' && nba.missing.join() === 'nba-7', 'NBA keys are Sleeper ids and resolve through the crosswalk to the ESPN-keyed player');
const wnba = crosswalkCoverage('wnba', ['wnba-3917450'], xw);
ok(wnba.found.length === 1 && wnba.found[0].player_id === 'wnba-3917450', 'WNBA keys are ESPN ids: a direct match');
const mlb = crosswalkCoverage('mlb', ['mlb-660271', 'nba-1658'], xw);
ok(mlb.found.length === 1 && mlb.missing.join() === 'nba-1658', 'a key of another sport never resolves');
ok(crosswalkCoverage('nhl', [], xw).found.length === 0 && crosswalkCoverage('nhl', ['nhl-1'], []).missing.join() === 'nhl-1', 'empty pool, empty crosswalk');
ok(statheadSportOf('epl') === 'epl', 'the six sport ids are shared');


// ── THE ADAPTER (v0.634.0): the contract's rows → the poller's shapes ─────────
ok(bareId('nhl', 'nhl-8478402') === '8478402' && bareId('nhl', '8478402') === '8478402' && bareId('mlb', 'nhl-1') === 'nhl-1', 'player_id loses its own sport prefix only');

const game = statheadGameRow('nhl', { game_id: 2026020002, game_date: '2026-09-29', start_utc: '2026-09-29T23:00:00Z', home: 'TOR', away: 'MTL', status: 'final', clock: 'Final', period: 3, home_score: 4, away_score: 2, season: 2026, game_type: 'regular', source: 'nhl' });
ok(game.gameId === '2026020002' && game.season === '2026' && game.away === 'MTL' && game.home === 'TOR' && game.awayScore === 2 && game.homeScore === 4 && game.clock === null && game.gameType === 'regular', 'a game row: ids as strings, scores, no clock once final');
ok(statheadGameRow('nhl', { game_id: 1, status: 'live', clock: '12:34', period: 2 }).clock === '12:34', 'a live game keeps its clock');

const skater = statheadLine('nhl', { toi: 21.5, g: 1, a: 2, pm: 1, pim: 0, sog: 4, hit: 1, blk: 0, ppg: 0, ppa: 1, shg: 0, sha: 0, gwg: 1, fow: 12, fol: 9, gva: 1, tka: 0 }, { pos: 'C', played: true });
ok(skater.gp === 1 && skater.g === 1 && skater.a === 2 && skater.ppa === 1 && skater.gapp == null, 'an NHL skater line carries gp 1 and every served key');
const goalie = statheadLine('nhl', { gapp: 1, gs: 1, gtoi: 60, w: 1, l: 0, otl: 0, ga: 2, sv: 30, sa: 32, so: 0 }, { pos: 'G', played: true });
ok(goalie.gapp === 1 && goalie.sv === 30 && goalie.gp == null, 'an NHL goalie line keeps gapp, never gp');
ok(statheadLine('nhl', { gs: 0, gtoi: 0, ga: 0 }, { pos: 'G' }).gapp === 0, 'a goalie who sat: gapp 0');
ok(statheadLine('nhl', {}, { pos: 'D', played: false }).gp === 0, 'a scratched skater: gp 0');
const nhlDef = SPORTS.nhl;
ok(Math.abs(linePoints(nhlDef, skater) - linePoints(nhlDef, { ...skater })) < 1e-9 && linePoints(nhlDef, skater) > 0, 'the mapped skater scores under the NHL default table');

const two = statheadLine('mlb', { pa: 4, ab: 3, h: 2, '2b': 0, '3b': 0, hr: 1, r: 1, rbi: 2, bb: 1, k: 1, gs: 1, outs: 18, w: 1, p_k: 8, p_bb: 1, p_h: 4, er: 2, p_r: 2, bf: 24, pitches: 95 }, { pos: 'TWP', played: true });
ok(two.hgp === 1 && two.pgp === 1 && two.hr === 1 && two.outs === 18 && two.p_k === 8, 'a two-way MLB row carries both dictionaries and both games-played flags');
ok(statheadLine('mlb', { pa: 4, ab: 4, h: 1 }).pgp == null && statheadLine('mlb', { pa: 4, ab: 4, h: 1 }).hgp === 1, 'a hitter only: hgp, no pgp');
ok(statheadLine('mlb', { gs: 0, outs: 3, bf: 4 }).pgp === 1 && statheadLine('mlb', { gs: 0, outs: 3, bf: 4 }).hgp == null, 'a reliever only: pgp, no hgp');
ok(statheadLine('mlb', { pa: 0, ab: 0 }, { played: false }).hgp == null, 'a benched hitter has no games-played flag');

const nbaLine = statheadLine('nba', { min: 34, pts: 30, fgm: 11, fga: 20, ftm: 6, fta: 7, tpm: 2, tpa: 6, oreb: 1, dreb: 7, reb: 8, ast: 9, stl: 1, blk: 0, tov: 3, pf: 2 }, { pos: 'G', played: true });
ok(nbaLine.gp === 1 && nbaLine.pts === 30 && nbaLine.reb === 8, 'an NBA line: gp from minutes');
ok(statheadLine('nba', { min: 0 }, { played: false }).gp === 0 && statheadLine('wnba', { min: 0, pts: 0 }, { played: true }).gp === 0, 'no minutes, no game played');
ok(statheadLine('nba', { pts: '12', min: '20' }).pts === 12, 'numeric strings are numbers');

const soc = statheadLine('epl', { min: 90, g: 1, a: 0, sh: 3, sot: 2, fc: 1, fs: 2, yc: 1, rc: 0, og: 0, off: 1, sv: 0, ga: 0, shf: 0, start: 1, sub_in: 0, cs: 1, tga: 0 }, { pos: 'AM-R', played: true });
ok(soc.posn === 3 && soc.gc === 0 && soc.gp === 1 && soc.g === 1 && soc.cs === 1 && soc.yc === 1 && !('ga' in soc) && !('fc' in soc) && !('tga' in soc), 'a soccer line: ga → gc, posn from the ESPN code, Stathead-only keys dropped');
const gk = statheadLine('mls', { min: 90, sv: 5, ga: 2, cs: 0, start: 1 }, { pos: 'G' });
ok(gk.posn === 1 && gk.gc === 2 && gk.sv === 5, 'a goalkeeper: posn 1, goals conceded, saves');
ok(soccerPosn('G') === 1 && soccerPosn('D') === 2 && soccerPosn('CB') === 2 && soccerPosn('M') === 3 && soccerPosn('DM') === 3 && soccerPosn('F') === 4 && soccerPosn('ST') === 4 && soccerPosn('LF') === 4 && soccerPosn('RWB') === 2 && soccerPosn('') === 0, 'ESPN position codes, plain and detailed, → posn');
const eplDef = SPORTS.epl;
ok(linePoints(eplDef, soc) === 2 + 5 - 1 + 1, 'the mapped midfielder scores under FPL: 60+ appearance, mid goal, yellow, mid clean sheet');

const box = statheadBoxToGame('nhl', { sport: 'nhl', game: { game_id: 2026020002, game_date: '2026-09-29', home: 'TOR', away: 'MTL', status: 'final', season: 2026 }, stored: true, revised_at: null, count: 2, rows: [
  { player_id: 'nhl-8480018', name: 'Nick Suzuki', team: 'MTL', pos: 'C', played: true, stats: { toi: 20.1, g: 1, a: 1 } },
  { player_id: 'nhl-8476945', name: 'Sam Montembeault', team: 'MTL', pos: 'G', played: true, stats: { gapp: 1, gs: 1, gtoi: 58.5, ga: 4, sv: 28, sa: 32 } },
] });
ok(box.game.gameId === '2026020002' && box.lines.length === 2 && box.lines[0].extId === '8480018' && box.lines[0].line.gp === 1 && box.lines[1].line.gapp === 1 && box.stored === true, 'a lines response → { game, lines } keyed by the bare id');

const keyMap = buildKeyMap('nba', [{ player_id: 'nba-3945274', espn_id: '3945274', sleeper_id: '1658' }, { player_id: 'nba-4066648', espn_id: '4066648', sleeper_id: null }]);
const keyOf = (id) => keyMap.get(String(id)) ?? bareId('nba', id);
const nbaBox = statheadBoxToGame('nba', { game: { game_id: '401584', game_date: '2026-10-04', home: 'BOS', away: 'LAL', status: 'final' }, rows: [
  { player_id: 'nba-3945274', name: 'Luka Doncic', team: 'LAL', pos: 'G', played: true, stats: { min: 36, pts: 31 } },
  { player_id: 'nba-4066648', name: 'Someone New', team: 'LAL', pos: 'F', played: true, stats: { min: 10, pts: 4 } },
] }, keyOf);
ok(nbaBox.lines[0].extId === '1658' && nbaBox.lines[1].extId === '4066648', 'NBA rows are keyed by the Sleeper id through the crosswalk; an unlisted man keeps his ESPN id');

const cur = statheadSeasonMap('mlb', { rows: [{ player_id: 'mlb-660271', name: 'Shohei Ohtani', team: 'LAD', pos: 'TWP', season: 2026, gp: 150, stats: { pa: 650, ab: 560, h: 170, hr: 48, gs: 20, outs: 300, p_k: 150, hgp: 150, pgp: 20 }, pos_games: { DH: 148, P: 20 } }] });
const prior = statheadSeasonMap('mlb', { rows: [] });
const dir = statheadDirectory('mlb', { rows: [{ player_id: 'mlb-660271', full_name: 'Shohei Ohtani', team: 'LAD', pos: 'TWP', eligible: ['DH', 'SP'], jersey: '17', headshot_url: 'h', active: true, injury_status: null, injury_note: null, exp: 8, debut_season: 2018, ids: { sleeper_id: '5000' } }] }, cur, prior, '2026');
ok(dir.length === 1 && dir[0].extId === '660271' && dir[0].exp === 8 && dir[0].seasonId === '2026' && dir[0].gp === 170 && dir[0].season.hgp === 150 && dir[0].season.pgp === 20, "an MLB directory row: this season's line with both games-played counts, tenure");
ok(dir[0].feedCodes.includes('SP') && dir[0].feedCodes.includes('DH') && !dir[0].feedCodes.includes('C'), 'eligibility from the season: SP from starts, DH for the two-way man');
const thin = statheadDirectory('nhl', { rows: [{ player_id: 'nhl-1', full_name: 'Rookie', team: 'BOS', pos: 'C', eligible: ['C'], exp: 0, injury_status: 'IR', injury_note: 'knee' }] },
  statheadSeasonMap('nhl', { rows: [{ player_id: 'nhl-1', pos: 'C', season: 2026, gp: 3, stats: { g: 1, a: 0 } }] }),
  statheadSeasonMap('nhl', { rows: [{ player_id: 'nhl-1', pos: 'C', season: 2025, gp: 70, stats: { g: 20, a: 30 } }] }), '2026');
ok(thin[0].seasonId === '2025' && thin[0].gp === 70 && thin[0].season.g === 20 && thin[0].injury.code === 'IR' && thin[0].injury.note === 'knee' && thin[0].exp === 0, 'three games into the season the card still shows last season; injury carried; exp 0 kept');
const gkDir = statheadDirectory('nhl', { rows: [{ player_id: 'nhl-2', full_name: 'Keeper', team: 'BOS', pos: 'G', eligible: ['G'] }] },
  statheadSeasonMap('nhl', { rows: [{ player_id: 'nhl-2', pos: 'G', season: 2026, gp: 25, stats: { gs: 24, gtoi: 1450, w: 15, sv: 700, sa: 760, ga: 60 } }] }), new Map(), '2026');
ok(gkDir[0].gp === 25 && gkDir[0].season.gapp === 25 && gkDir[0].season.gp == null && gkDir[0].exp === null, 'a goalie season line: gp → gapp; unknown tenure is null');
ok(statheadDirectory('epl', { rows: [{ player_id: 'epl-45', full_name: 'Mo', team: 'LIV', pos: 'F', eligible: ['F'], exp: 9 }] }, new Map(), new Map(), '2026')[0].feedCodes.join() === 'F', 'a soccer directory row keeps ESPN codes for the core posMap');

// ── THE SHADOW READ (v0.634.0): both feeds compared ────────────────────────────
const oursSlate = [{ gameId: '1', away: 'MTL', home: 'TOR', status: 'final' }, { gameId: '2', away: 'NJ', home: 'BOS', status: 'live' }, { gameId: '3', away: 'LA', home: 'SJ', status: 'pre' }];
const theirSlate = [{ gameId: '1', away: 'MTL', home: 'TOR', status: 'final' }, { gameId: '2', away: 'NJD', home: 'BOS', status: 'final' }, { gameId: '9', away: 'VGK', home: 'SEA', status: 'pre' }];
const sl = compareSlates('nhl', oursSlate, theirSlate);
ok(sl.matched.length === 2 && sl.onlyOurs.join() === 'LAK@SJS' && sl.onlyTheirs.join() === 'VGK@SEA' && sl.statusDiffs.length === 1 && sl.statusDiffs[0].includes('NJD@BOS'), 'slates match by teams through the aliases; a status disagreement is named');

const oursLines = [
  { extId: '1', name: 'Nick Suzuki', team: 'MTL', played: true, line: { gp: 1, g: 1, a: 1, sog: 3 } },
  { extId: '2', name: 'Cole Caufield', team: 'MTL', played: true, line: { gp: 1, g: 0, a: 1, sog: 5 } },
  { extId: '3', name: 'Scratch Guy', team: 'MTL', played: false, line: { gp: 0 } },
];
const theirLines = [
  { extId: '1', name: 'Nick Suzuki', team: 'MTL', played: true, line: { gp: 1, g: 1, a: 1, sog: 3 } },
  { extId: '2', name: 'Cole Caufield', team: 'MTL', played: true, line: { gp: 1, g: 0, a: 2, sog: 5 } },
  { extId: '4', name: 'Extra Dresser', team: 'MTL', played: true, line: { gp: 1, g: 0, a: 0, sog: 1 } },
];
const cl = compareLines('nhl', oursLines, theirLines);
ok(cl.matched === 2 && cl.agree === 1 && cl.diffs.length === 1 && cl.diffs[0].name === 'Cole Caufield' && cl.diffs[0].fields.join() === 'a' && cl.diffs[0].delta < 0, 'NHL lines match by id; the one assist disagreement is named with its field');
ok(cl.onlyOurs.join() === 'Scratch Guy' && cl.onlyOursScoring.length === 0 && cl.onlyTheirs.join() === 'Extra Dresser' && cl.onlyTheirsScoring.join() === 'Extra Dresser', 'a scratch only we list is not a scoring gap; a dressed man only they list is');
const text = describeLines('MTL@TOR', cl);
ok(text.includes('1/2 lines differ') && text.includes('Cole Caufield ours') && text.includes('[a]') && text.includes('1 scoring only theirs (Extra Dresser)'), 'the log line names the game, the count, the top disagreement and the gaps');
ok(describeLines('MTL@TOR', compareLines('nhl', oursLines.slice(0, 1), theirLines.slice(0, 1))) === 'MTL@TOR: 1 lines agree', 'agreement is one quiet line');

const nbaOurs = [{ extId: '1658', name: 'Luka Dončić', team: 'LAL', played: true, line: { gp: 1, min: 36, pts: 31, reb: 8, ast: 9 } }];
const nbaTheirs = [{ extId: '3945274', name: 'Luka Doncic', team: 'LAL', played: true, line: { gp: 1, min: 36, pts: 31, reb: 8, ast: 9 } }];
ok(compareLines('nba', nbaOurs, nbaTheirs).agree === 1, 'NBA lines match by team and normalised name across the two id spaces');

console.log(fails ? `\n${fails} FAILED` : '\nall stathead checks passed');
process.exit(fails ? 1 : 0);
