// Sport leagues on the worker: what gets locked when a game starts, how a
// side scores from its locked slot-days, the points and categories verdicts,
// and when a period is done. Pure parts only. Run from server/:
// `npx tsx test/sports-league.mjs`.
import { startedGames, locksFor, sideScore, scoreMatchup, periodDone, slotAllowsFor, rotoTable } from '../src/sportLeague.js';
import { SPORTS } from '../../packages/core/src/sports/index.ts';
import { sportPeriod, sportWeekOf, sportRosterSlots, sportLeagueSettings, mondayOnOrBefore, currentSeason, sportSettingsOf, SPORT_WEEK_BASE } from '../../packages/core/src/sports/league.ts';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };

// ── the calendar ─────────────────────────────────────────────────────────────
ok(mondayOnOrBefore('2026-10-20') === '2026-10-19' && mondayOnOrBefore('2026-10-19') === '2026-10-19' && mondayOnOrBefore('2026-10-25') === '2026-10-19', 'Monday on or before');
const p1 = sportPeriod(301, '2026-10-19');
ok(p1.from === '2026-10-19' && p1.to === '2026-10-25' && sportPeriod(303, '2026-10-19').from === '2026-11-02' && sportPeriod(14, '2026-10-19') === null, 'period dates from the base week');
ok(sportWeekOf('2026-10-19', '2026-10-19') === 301 && sportWeekOf('2026-10-25', '2026-10-19') === 301 && sportWeekOf('2026-10-26', '2026-10-19') === 302 && sportWeekOf('2026-10-01', '2026-10-19') === null, 'week of a date');
ok(SPORT_WEEK_BASE === 300, 'sport weeks start above 300');
ok(currentSeason('nba', new Date('2026-10-01T00:00:00Z')) === '2026' && currentSeason('nhl', new Date('2027-03-01T00:00:00Z')) === '2026' && currentSeason('mlb', new Date('2027-03-01T00:00:00Z')) === '2027' && currentSeason('wnba', new Date('2026-06-01T00:00:00Z')) === '2026', 'current season per sport');

// ── the settings a league is created with ────────────────────────────────────
const slots = sportRosterSlots(SPORTS.nba);
ok(slots.length === 10 && slots.filter((s) => s.label.startsWith('C')).length === 2 && slots.find((s) => s.label === 'G').pos.join() === 'PG,SG', `NBA lineup: ${slots.map((s) => s.label).join(' ')}`);
const st = sportLeagueSettings('nhl', { periodStart: '2026-10-07' });
ok(st.roster_slots.length === 12 && st.sport.period_start === '2026-10-05' && st.sport.weeks === 27 && st.sport.format === 'points' && st.sport.categories.length === 12, 'NHL settings: 12 starters, period from the Monday, the sport block');
const back = sportSettingsOf({ roster_slots: st.roster_slots, sport: st.sport });
ok(back && back.period_start === '2026-10-05' && back.weeks === 27, 'settings read back');
ok(sportSettingsOf({}) === null && sportSettingsOf(null) === null, 'an NFL league has no sport block');

// ── locking ──────────────────────────────────────────────────────────────────
const now = Date.parse('2026-10-21T00:00:00Z');
const games = [
  { gameId: 'a', gameDate: '2026-10-20', status: 'pre', startUtc: '2026-10-20T23:30:00Z', home: 'BOS', away: 'NYK' },
  { gameId: 'b', gameDate: '2026-10-20', status: 'pre', startUtc: '2026-10-21T02:00:00Z', home: 'LAL', away: 'GSW' },
  { gameId: 'c', gameDate: '2026-10-20', status: 'live', startUtc: '2026-10-20T23:00:00Z', home: 'MIA', away: 'ORL' },
  { gameId: 'd', gameDate: '2026-10-20', status: 'postponed', startUtc: '2026-10-20T23:00:00Z', home: 'DEN', away: 'UTA' },
];
const started = startedGames(games, now);
ok(started.map((g) => g.gameId).join() === 'a,c', 'started: live, or past start; the 10pm ET game not yet; a postponement never');
const picks = [
  { matchup_id: 'm1', app_user_id: 'u1', game_window: 'wk', roster_slot: 'S1', player_slug: 'nba-1' },   // BOS
  { matchup_id: 'm1', app_user_id: 'u1', game_window: 'wk', roster_slot: 'S2', player_slug: 'nba-2' },   // LAL (not started)
  { matchup_id: 'm1', app_user_id: 'u2', game_window: 'wk', roster_slot: 'S1', player_slug: 'nba-3' },   // NYK
  { matchup_id: 'm1', app_user_id: 'u2', game_window: 'wk', roster_slot: 'S2', player_slug: null },
  { matchup_id: 'm1', app_user_id: 'u2', game_window: 'early', roster_slot: 'x', player_slug: 'nba-1' }, // not a classic row
];
const teamOf = (s) => ({ 'nba-1': 'BOS', 'nba-2': 'LAL', 'nba-3': 'NYK' })[s];
const rows = locksFor(games[0], picks, teamOf, new Set());
ok(rows.length === 2 && rows.every((r) => r.game_date === '2026-10-20' && r.game_id === 'a') && rows.map((r) => r.player_slug).join() === 'nba-1,nba-3', 'the two players on the started game lock, the LAL one waits');
ok(locksFor(games[0], picks, teamOf, new Set(['m1|u1|2026-10-20|S1|a'])).length === 1, 'an existing lock is not retaken');
ok(locksFor({ ...games[0], gameId: 'a2' }, picks, teamOf, new Set(['m1|u1|2026-10-20|S1|a'])).length === 2, 'a second game the same day (a doubleheader) locks the slot again under its own id');
const allows = slotAllowsFor([{ pos: ['PG'] }, { pos: ['C'] }], (slug) => ({ 'nba-1': ['C'], 'nba-3': ['PG', 'SG'] })[slug]);
ok(!allows('S1', 'nba-1') && allows('S2', 'nba-1') && allows('S1', 'nba-3') && allows('S9', 'nba-1') && allows('S1', 'nba-99'), 'a centre may not lock at point guard; unknown slots and players allow');
ok(locksFor(games[0], picks, teamOf, new Set(), allows).map((r) => r.player_slug).join() === 'nba-3', 'the illegal spot is skipped at lock time');

// ── scoring ──────────────────────────────────────────────────────────────────
const nba = SPORTS.nba;
const home = [
  { roster_slot: 'S1', game_date: '2026-10-20', line: { pts: 30, reb: 10, ast: 10, stl: 1, blk: 0, tov: 4, fgm: 12, fga: 20, ftm: 4, fta: 5, tpm: 2 } },
  { roster_slot: 'S2', game_date: '2026-10-20', line: null },                                  // scratched after lock
  { roster_slot: 'S1', game_date: '2026-10-21', line: { pts: 10, reb: 2, ast: 3, stl: 0, blk: 0, tov: 1, fgm: 4, fga: 10, ftm: 2, fta: 2, tpm: 0 } },
];
const away = [
  { roster_slot: 'S1', game_date: '2026-10-20', line: { pts: 25, reb: 5, ast: 2, stl: 2, blk: 2, tov: 1, fgm: 10, fga: 15, ftm: 5, fta: 5, tpm: 3 } },
];
const hs = sideScore(nba, { scoring: {} }, home);
ok(hs.total === (30 + 12 + 15 + 3 - 4) + (10 + 2.4 + 4.5 - 1) && hs.slots.S1 === hs.total && hs.slots.S2 === 0 && hs.lines.length === 2, `home side: ${hs.total} over two days, the scratch counts 0`);
const pts = scoreMatchup(nba, { format: 'points', scoring: {} }, home, away);
ok(pts.homeScore === hs.total && pts.awayScore === 25 + 6 + 3 + 6 + 6 - 1 && pts.slotScores.format === 'points', `points verdict ${pts.homeScore} – ${pts.awayScore}`);
const cats = scoreMatchup(nba, { format: 'cats', categories: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fgpct', 'ftpct', 'tov'], scoring: {} }, home, away);
ok(cats.slotScores.format === 'cats' && cats.homeScore + cats.awayScore + cats.slotScores.ties === 9, `9-cat verdict ${cats.homeScore}-${cats.awayScore}-${cats.slotScores.ties}`);
ok(cats.slotScores.cats.find((c) => c.id === 'tov').result === 'b' && cats.slotScores.cats.find((c) => c.id === 'reb').result === 'a', 'lower-is-better turnovers go to the away side; rebounds to home');
ok(scoreMatchup(nba, { format: 'points', scoring: { dd: 5 } }, home, away).homeScore === pts.homeScore + 5, 'a double-double knob lands on the night it happened');

// ── roto ─────────────────────────────────────────────────────────────────────
const roto = rotoTable(nba, { format: 'roto', categories: ['pts', 'reb', 'tov'] }, [
  { roster_id: 1, line: { pts: 30, reb: 10, tov: 4 } }, { roster_id: 1, line: { pts: 10, reb: 2, tov: 1 } },
  { roster_id: 2, line: { pts: 25, reb: 5, tov: 1 } }, { roster_id: 3, line: null },
], [1, 2, 3]);
ok(roto.length === 3 && roto[0].roster_id === 1 && roto[0].points === 3 + 3 + 1 && roto.find((r) => r.roster_id === 2).points === 2 + 2 + 2, `roto: seat 1 leads ${roto[0].points} (best PTS and REB, most TO)`);
// A seat with no line has 0 of everything: last in the counting categories
// and — as in every roto league before its first game — first in turnovers.
ok(roto.find((r) => r.roster_id === 3).points === 1 + 1 + 3 && roto.find((r) => r.roster_id === 3).totals.pts == null, 'a seat with no line yet sits last in the counting cats and first in turnovers');

// ── the period's end ─────────────────────────────────────────────────────────
const per = { from: '2026-10-19', to: '2026-10-25' };
ok(!periodDone(per, '2026-10-25', []) && periodDone(per, '2026-10-26', []) && !periodDone(per, '2026-10-26', ['2026-10-25']) && periodDone(per, '2026-10-26', ['2026-10-26']), 'done the day after, unless a game from inside it is still live');
ok(periodDone(per, '2026-10-26', ['2026-10-01']) && periodDone(per, '2026-11-09', ['2026-10-25']), 'a live game from before the period, or one stuck for days, does not hold it');

console.log(fails ? `\n${fails} FAILED` : '\nall sport league checks passed');
process.exit(fails ? 1 : 0);
