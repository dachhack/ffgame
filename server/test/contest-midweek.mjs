// A CONTEST LEAGUE MADE MID-WEEK (v0.730.28). Monday Showdown was made on the
// Monday of week 6; the worker read Thursday's kickoff as its lock, so every
// human seat was a "no-show" at once, and the CPU's build took players whose
// games were over (a member: "it says my team is locked in as … who have all
// already played"). The lock is the first kickoff after the league was made,
// and a build only takes players still to play.
import { contestOwnLockMs } from '../../packages/core/src/engine/contest.ts';
import { readFileSync } from 'node:fs';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const T = (iso) => Date.parse(iso);
const thu = T('2026-10-16T00:15:00Z'), sun = T('2026-10-18T17:00:00Z'), mnf = T('2026-10-20T00:15:00Z');
const kicks = [thu, sun, sun, mnf];
ok('made before the week starts: the week\'s first kickoff', contestOwnLockMs(T('2026-10-14T12:00:00Z'), thu, kicks) === thu);
ok('made on Monday: Monday night\'s kickoff (Monday Showdown)', contestOwnLockMs(T('2026-10-19T14:18:47Z'), thu, kicks) === mnf, contestOwnLockMs(T('2026-10-19T14:18:47Z'), thu, kicks));
ok('made after the last kickoff: no lock left', contestOwnLockMs(T('2026-10-20T03:00:00Z'), thu, kicks) === null);
ok('no week lock: none', contestOwnLockMs(T('2026-10-19T14:00:00Z'), null, kicks) === null);
ok('unknown creation: the week\'s first kickoff', contestOwnLockMs(NaN, thu, kicks) === thu);
const pods = readFileSync(new URL('../src/pods.js', import.meta.url), 'utf8');
ok('pods: a contest no-show waits for its own lock', pods.includes("contest ? contestOwnLockMs(Date.parse(pod.created_at ?? ''), lockMs, kicks?.values() ?? []) : lockMs") && pods.includes("settings_json, created_at')"));
ok('pods: a CPU build only takes players still to play', pods.includes('contestAutoBuild(cpuPool.filter((b) => !teamLocked(b.team)), contest,'));
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('contest-midweek: all passed');
