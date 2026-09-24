// THE SITUATION AND THE LEADERS on a game's status (v0.508.0) — what the
// fields widget prints as "● KC · 2nd & 7 · BUF 34" and lists when a game is
// opened. Synthetic summary: the shape is the contract, not ESPN's uptime.
import { gameStatus, gameSituation } from '../../scripts/espn/espnAdapter.mjs';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

const end = (dd, spot, team) => ({ down: 2, distance: 7, yardsToEndzone: 34, shortDownDistanceText: dd, possessionText: spot, team: { id: team } });
const summary = (plays, extra = {}) => ({
  header: { competitions: [{ status: { period: 3, displayClock: '4:12', type: { name: 'STATUS_IN_PROGRESS', detail: '4:12 - 3rd', shortDetail: '4:12 - 3rd' } },
    competitors: [{ id: '12', team: { abbreviation: 'KC' } }, { id: '2', team: { abbreviation: 'BUF' } }] }] },
  drives: { previous: [{ plays: plays.slice(0, 1) }], current: { plays: plays.slice(1) } },
  leaders: [{ team: { abbreviation: 'KC' }, leaders: [
    { name: 'passingYards', leaders: [{ displayValue: '18/25, 210 YDS', athlete: { shortName: 'P. Mahomes' } }] },
    { name: 'sacks', leaders: [{ displayValue: '1 SACK', athlete: { shortName: 'X. Def' } }] },
  ] }, { team: { abbreviation: 'WSH' }, leaders: [{ name: 'receivingYards', leaders: [{ displayValue: '5 REC, 76 YDS', athlete: { displayName: 'Terry McLaurin' } }] }] }],
  ...extra,
});

const s = gameStatus(summary([{ end: end('1st & 10', 'KC 25', '12') }, { end: end('2nd & 7', 'BUF 34', '12') }, { text: 'Timeout', end: {} }]));
ok(s.sit?.dd === '2nd & 7' && s.sit?.spot === 'BUF 34' && s.sit?.poss === 'KC' && s.sit?.ytg === 34, 'the situation is the latest play that has one (a timeout row after it carries none)');
ok(s.short === '4:12 - 3rd' && s.period === 3, 'the header fields are unchanged');
ok(s.leaders?.length === 2, 'passing, rushing and receiving leaders only — sacks are not a stat line the card shows');
ok(s.leaders?.[0].name === 'P. Mahomes' && s.leaders?.[0].line === '18/25, 210 YDS' && s.leaders?.[0].cat === 'pass', 'a leader carries his short name and ESPN\'s phrased line');
ok(s.leaders?.[1].team === 'WAS' && s.leaders?.[1].name === 'Terry McLaurin', 'team codes normalise (WSH → WAS) and a missing short name falls back to the full one');
const none = gameSituation({ header: { competitions: [{}] } });
ok(!('sit' in none) && !('leaders' in none), 'no drives and no leaders: nothing invented');

console.log(fails ? `FAIL  ${fails} situation assertion(s) failed` : 'OK    game situation and leaders');
process.exit(fails ? 1 : 0);
