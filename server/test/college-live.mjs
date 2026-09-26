// The college live feed (0371): who a college athlete is, and where his
// week's games land. No network.
import { collegeResolveSlug, nflWeekForKickoff, nflWeekWindows } from '../src/poll/plays.js';
import { collegeSlateRows, COLLEGE_BASE, etTuesdayStart, bowlBoardWeek, bowlSchedule, bowlSlateRows } from '../src/poll/collegeSlate.js';
import { bowlWeekNow } from '../src/index.js';

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

// ── bowl season (0375): ESPN's one postseason week, cut into ET Tue–Mon weeks ──
{
  const at = (iso) => Date.parse(iso);
  // Sunday 14 Dec 2025, noon ET → its week opened Tuesday 9 Dec, midnight ET (05:00Z in winter).
  ok(new Date(etTuesdayStart(at('2025-12-14T17:00:00Z'))).toISOString() === '2025-12-09T05:00:00.000Z', 'a bowl week opens at midnight ET on Tuesday');
  ok(new Date(etTuesdayStart(at('2025-12-16T05:30:00Z'))).toISOString() === '2025-12-16T05:00:00.000Z', 'just after Tuesday midnight ET is the new week');
  ok(new Date(etTuesdayStart(at('2025-12-16T04:30:00Z'))).toISOString() === '2025-12-09T05:00:00.000Z', 'Monday 11:30pm ET is still the old week');
  const first = at('2025-12-14T17:00:00Z');
  ok(bowlBoardWeek(first, first) === 216, 'the first bowl is BOWL 1, board week 216');
  ok(bowlBoardWeek(at('2025-12-23T01:00:00Z'), first) === 217, 'Monday night the 22nd is BOWL 2');
  ok(bowlBoardWeek(at('2026-01-20T00:30:00Z'), first) === 221, 'the title game, 19 Jan, is BOWL 6');
  ok(bowlBoardWeek(at('2026-03-01T00:00:00Z'), first) === null, 'nothing past board week 223');

  const games = [
    { eventId: 'b1', home: 'NAVY', away: 'ARMY', kickoffMs: first, date: '2025-12-14T17:00:00Z', completed: true },
    { eventId: 'b2', home: 'UGA', away: 'OSU', kickoffMs: at('2025-12-20T20:00:00Z'), date: '2025-12-20T20:00:00Z', completed: false },
    { eventId: 'b3', home: 'TBD', away: 'TBD', kickoffMs: at('2026-01-20T00:30:00Z'), date: '2026-01-20T00:30:00Z', completed: false },
  ];
  const sched = bowlSchedule(games);
  ok(sched.map((g) => `${g.eventId}:${g.boardWeek}`).join() === 'b1:216,b2:217', 'the live schedule holds real matchups only, each at its board week');
  const rows = bowlSlateRows(2025, games);
  ok(rows.length === 3 && rows[2].week === 221 && rows[2].home === 'TBD-b3' && rows[2].game_id === 'b3',
    'the slate keeps the TBD title game as a placeholder, so bowl weeks exist before the matchups do');
  ok(rows[0].season === '2025' && rows[0].week === 216 && rows[0].home === 'NAVY', 'a real bowl is written under its schools');
  ok(bowlWeekNow(sched, at('2025-12-08T12:00:00Z')) === null, 'before the Tuesday of the first bowl: no bowl context');
  ok(bowlWeekNow(sched, at('2025-12-15T12:00:00Z')) === 217, 'BOWL 1 all final → BOWL 2 is being played');
  ok(bowlWeekNow(sched.map((g) => ({ ...g, completed: true })), at('2026-01-25T12:00:00Z')) === null, 'every bowl final → done');
  ok(bowlWeekNow([], at('2025-12-20T12:00:00Z')) === null, 'no bowls known → none');
}

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL COLLEGE LIVE CHECKS PASS');
