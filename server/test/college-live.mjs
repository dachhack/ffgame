// The college live feed (0371): who a college athlete is, and where his
// week's games land. No network.
import { collegeResolveSlug, nflWeekForKickoff, nflWeekWindows } from '../src/poll/plays.js';
import { collegeSlateRows, COLLEGE_BASE } from '../src/poll/collegeSlate.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

ok(collegeResolveSlug('Cam Ward', '4688380', 'MIA') === 'c-4688380', 'a college athlete is c-<espn_id>, whatever his name');
ok(collegeResolveSlug('Josh Allen', 5000001, 'BUF') === 'c-5000001', 'THE POINT: a college "Josh Allen" never lands on the Bills QB');
ok(collegeResolveSlug('No Id', null, 'ALA') === null && collegeResolveSlug('Bad', 'x1', 'ALA') === null, 'no id → no slug');

const rows = collegeSlateRows(2026, 3, [
  { eventId: '401', date: '2026-09-12T16:00:00Z', home: 'ALA', away: 'FSU' },
  { eventId: '402', date: '2026-09-12T23:30:00Z', home: 'MIA', away: 'BUF' },
]);
ok(rows.length === 2 && rows.every((r) => r.week === COLLEGE_BASE + 3 && r.season === '2026'), 'college Week 3 is board week 203');
ok(rows[1].home === 'MIA' && rows[1].game_id === '402', 'school codes stand as ESPN gives them (MIA the Hurricanes, week 203 only)');

// ── mixed leagues (0372): which NFL week a college kickoff scores in ──
{
  const H = 3600e3, thu = Date.parse('2026-10-08T00:15:00Z'), mnf = Date.parse('2026-10-13T00:15:00Z');
  const windows = nflWeekWindows([{ week: 4, first: thu - 7 * 24 * H, last: mnf - 7 * 24 * H }, { week: 5, first: thu, last: mnf }, { week: 6, first: thu + 7 * 24 * H, last: mnf + 7 * 24 * H }]);
  const sat = Date.parse('2026-10-10T19:30:00Z'), thuCollege = Date.parse('2026-10-08T23:30:00Z');
  ok(nflWeekForKickoff(sat, windows) === 5, 'a Saturday college game scores in that NFL week');
  ok(nflWeekForKickoff(thuCollege, windows) === 5, 'so does Thursday\'s college game, kicking before TNF');
  ok(nflWeekForKickoff(Date.parse('2026-08-29T20:00:00Z'), windows) === null, 'Week 0 in August scores in no NFL week');
  ok(nflWeekForKickoff(NaN, windows) === null, 'no kickoff, no week');
  ok(nflWeekForKickoff(Date.parse('2026-10-06T23:30:00Z'), windows) === 5, 'Tuesday-night MACtion belongs to the week ahead');
  ok(nflWeekForKickoff(Date.parse('2026-10-06T00:00:00Z'), windows) === 4, 'Monday night is still the week behind');
}

// ── the window's edges, on the real 2026 calendar ──
{
  // The 2026 opener is Wednesday 9 Sep, 8:20pm ET (00:20Z on the 10th).
  const [w1] = nflWeekWindows([{ week: 1, first: Date.parse('2026-09-10T00:20:00Z'), last: Date.parse('2026-09-15T00:15:00Z') }]);
  ok(new Date(w1.lo).toISOString() === '2026-09-08T04:00:00.000Z', 'NFL Week 1 opens at midnight ET on Tuesday Sep 8');
  ok(nflWeekForKickoff(Date.parse('2026-09-07T23:30:00Z'), [w1]) === null, 'Labor Day Monday (SMU at FSU) is not NFL Week 1');
  ok(nflWeekForKickoff(Date.parse('2026-09-08T23:30:00Z'), [w1]) === 1, 'a Tuesday-night game that week is');
}

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL COLLEGE LIVE CHECKS PASS');
