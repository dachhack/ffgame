// THE LOCK-TIME FILL FIELDS A PLAYER WHERE HE PLAYS NOW (v0.523.0).
//
// Founder's wk-3 Thursday: the fill slotted Romeo Doubs — GB in the 2025 bake,
// NE since — into the ATL@GB window over a Ghost. He could only score zero.
// autoLineup (every live caller: lock.js, resolve.js) now reads the current
// team (liveTeamFor: the worker's override, then the directory); the bare
// aiLineup keeps the bake for the replay and the sims.
// Run: tsx scripts/check-live-team.mjs
import { setRuntimeSlate } from '../packages/core/src/data/nflSlate';
import { aiLineup } from '../packages/core/src/data/aiLineup';
import { autoLineup, liveTeamOf } from '../server/src/engine.js';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const et = (d, h) => Date.parse(`2026-09-${d}T${String(h).padStart(2, '0')}:15:00-04:00`);
setRuntimeSlate(3, [
  { away: 'ATL', home: 'GB', aScore: 0, hScore: 0, win: 'tnf', kickoff: et(24, 20) },
  { away: 'NE', home: 'NYJ', aScore: 0, hScore: 0, win: 'early', kickoff: et(27, 13) },
]);
ok('the directory knows Doubs is a Patriot now', liveTeamOf('romeo-doubs') === 'NE', liveTeamOf('romeo-doubs'));
ok('the live fill fields him in NE\'s game, not GB\'s', autoLineup(['romeo-doubs'], 3).map((p) => p.win).join() === 'early', autoLineup(['romeo-doubs'], 3));
ok('the bare builder still reads the bake (replay/sims unchanged)', aiLineup(['romeo-doubs'], 3).map((p) => p.win).join() === 'tnf', aiLineup(['romeo-doubs'], 3));
ok('a unit keeps its own team (gb-k plays Thursday)', autoLineup(['gb-k'], 3).map((p) => p.win).join() === 'tnf', autoLineup(['gb-k'], 3));
if (fails) { console.log(`\n${fails} LIVE-TEAM ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL LIVE-TEAM ASSERTIONS PASSED');
