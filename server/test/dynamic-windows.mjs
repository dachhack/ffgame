// Verify dynamic lineup windows: demo (baked) week = fixed 8 slots; a live 2026
// week-1 slate (Wed opener) = 9 slots across 6 windows, and the engine + AI place
// split-window players on the derived ids consistently.
import { windowsForWeek, windowForTeam, setRuntimeSlate, clearRuntimeSlate } from '../../src/data/nflSlate.ts';
import { slotsFor, totalSlotsWith } from '../../src/engine/matchup.ts';
import { aiLineup } from '../../src/data/aiLineup.ts';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) fails++; };

// ── 1) Demo / baked week 1 (no runtime slate) → fixed five, 8 slots ──
clearRuntimeSlate();
const demo = windowsForWeek(1);
ok(demo.length === 5, `demo week 1 has 5 windows (got ${demo.length})`);
ok(totalSlotsWith(1) === 8, `demo week 1 total slots = 8 (got ${totalSlotsWith(1)})`);
ok(demo.map(w => w.id).join(',') === 'tnf,early,late,snf,mnf', `demo ids: ${demo.map(w=>w.id)}`);

// ── 2) Live 2026 week-1 slate with real kickoffs ──
const K = (s) => Date.parse(s);
const slate = [
 ['SEA','NE','tnf','2026-09-10T00:20Z'],['LA','SF','tnf','2026-09-11T00:35Z'],
 ['CIN','TB','early','2026-09-13T17:00Z'],['DET','NO','early','2026-09-13T17:00Z'],
 ['TEN','NYJ','early','2026-09-13T17:00Z'],['IND','BAL','early','2026-09-13T17:00Z'],
 ['PIT','ATL','early','2026-09-13T17:00Z'],['CAR','CHI','early','2026-09-13T17:00Z'],
 ['JAX','CLE','early','2026-09-13T17:00Z'],['HOU','BUF','early','2026-09-13T17:00Z'],
 ['LV','MIA','late','2026-09-13T20:25Z'],['MIN','GB','late','2026-09-13T20:25Z'],
 ['PHI','WAS','late','2026-09-13T20:25Z'],['LAC','ARI','late','2026-09-13T20:25Z'],
 ['NYG','DAL','snf','2026-09-14T00:20Z'],['KC','DEN','mnf','2026-09-15T00:15Z'],
].map(([a,h,w,k]) => ({ away:a, home:h, aScore:0, hScore:0, win:w, kickoff:K(k) }));
setRuntimeSlate(1, slate);

const live = windowsForWeek(1);
console.log('\nlive week-1 windows:');
for (const w of live) console.log(`  ${w.id.padEnd(6)} ${w.label.padEnd(8)} ${w.time.padEnd(10)} ${w.slots} slots`);
ok(live.length === 6, `live week 1 has 6 windows (got ${live.length})`);
ok(totalSlotsWith(1) === 9, `live week 1 total slots = 9 (got ${totalSlotsWith(1)})`);
ok(live.map(w=>w.id).join(',') === 'wed,tnf,early,late,snf,mnf', `live ids: ${live.map(w=>w.id)}`);
ok(slotsFor('wed',1) === 1 && slotsFor('early',1) === 3 && slotsFor('late',1) === 2, `slot counts wed/early/late = 1/3/2`);
ok(windowForTeam(1,'SEA') === 'wed' && windowForTeam(1,'NE') === 'wed', `Wed teams → 'wed' window`);
ok(windowForTeam(1,'LA') === 'tnf' && windowForTeam(1,'SF') === 'tnf', `Thu teams → 'tnf' window`);
ok(windowForTeam(1,'DEN') === 'mnf', `Mon team → 'mnf'`);

// ── 3) Server AI places the Wed players on the 'wed' window ──
// Slugs whose slugMeta.team resolves to a Wed team (SEA/NE). Use known players.
const roster = ['geno-smith','drake-maye','saquon-barkley','josh-allen','ja-marr-chase','patrick-mahomes'];
const picks = aiLineup(roster, 1, new Set(), 0);
const wins = new Set(picks.map(p => p.win));
console.log('\nAI pick windows:', [...wins].join(','), '| picks:', picks.map(p=>`${p.slug}:${p.win}#${p.slot}`).join(' '));
ok([...wins].every(w => live.some(lw => lw.id === w)), `every AI pick win id is a derived window`);

clearRuntimeSlate();
console.log(`\n${fails ? `FAIL (${fails})` : 'ALL PASS'}`);
process.exit(fails ? 1 : 0);
