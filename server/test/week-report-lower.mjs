// LOWER WINS (v0.701.3): a dart league scored on distance (and golf) reports
// the smallest score as the week's best, gives a game to the lower side and
// counts the standings so. Pure.
import assert from 'node:assert';
import { buildWeekReport, reportSections } from '../../packages/core/src/data/weekReport.ts';
const names = { 1: 'Blitz Brigade', 2: 'Dart Throw', 3: 'Punt Party', 4: 'Coin Flip' };
const matchups = [
  { week: 5, home_roster_id: 1, away_roster_id: 2, home_final: 26.3, away_final: 21.8 },
  { week: 5, home_roster_id: 3, away_roster_id: 4, home_final: 36.9, away_final: 32.6 },
];
const dart = buildWeekReport({ week: 5, league: 'Bull', format: 'standard', names, matchups, lowerWins: true });
assert.strictEqual(dart.top.name, 'Dart Throw', 'the smallest distance leads');
assert.strictEqual(dart.low.name, 'Punt Party', 'the largest is the worst');
assert.ok(dart.headline.startsWith('Dart Throw landed closest at 21.8'), dart.headline);
assert.ok(dart.headline.includes('Coin Flip edged Punt Party by 4.3'), 'the closest game goes to the lower side: ' + dart.headline);
const st = Object.fromEntries(dart.standings.map((s) => [s.name, `${s.w}-${s.l}`]));
assert.deepStrictEqual(st, { 'Dart Throw': '1-0', 'Coin Flip': '1-0', 'Blitz Brigade': '0-1', 'Punt Party': '0-1' });
assert.strictEqual(dart.standings[0].name, 'Dart Throw', 'among the winners, the lower total first');
const secs = reportSections(dart);
const week = secs.find((s) => s.title === 'The week').rows;
assert.strictEqual(week[0].label, 'Closest to the number'); assert.strictEqual(week[0].value, '21.8');
assert.strictEqual(week.find((r) => r.label === 'Furthest off').value, '36.9');
const res = secs.find((s) => s.title === 'Results').rows;
assert.strictEqual(res.find((r) => r.label.startsWith('Blitz')).sub, 'Dart Throw by 4.5');
// the ordinary report is untouched
const high = buildWeekReport({ week: 5, league: 'High', format: 'standard', names, matchups });
assert.strictEqual(high.top.name, 'Punt Party'); assert.strictEqual(high.lowerWins, undefined);
assert.ok(high.headline.startsWith('Punt Party led the week with 36.9'));
assert.strictEqual(reportSections(high)[0].rows[0].label, 'High score');
console.log('week-report-lower: all checks passed');
