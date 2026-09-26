// The college live feed (0371): who a college athlete is, and where his
// week's games land. No network.
import { collegeResolveSlug } from '../src/poll/plays.js';
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

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL COLLEGE LIVE CHECKS PASS');
