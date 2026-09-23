// THE COMMISSIONER'S POINT ADJUSTMENTS (0355), checked in Node.
//
// An adjustment is read in exactly one place — classicPoints — by the worker's
// resolve and both boards, off one module-global install. So this pins the
// install itself: it lands on the right player in the right WEEK only, flat
// after the flag's multiplier (it corrects what he scored, it is not a bonus
// to be multiplied), a starter's adjustment moves his side's total and a bench
// player's does not, and clearing it gives back the unadjusted number exactly.
import { readFileSync } from 'node:fs';
import { classicPoints, resolveClassicMatchup, CLASSIC_SLOTS } from '../packages/core/src/engine/classic';
import { clearLeagueScoring } from '../packages/core/src/engine/leagueScoring';
import { installRealWeek } from '../packages/core/src/data/realPbp';
import { setLeagueFlags, clearLeagueFlags, setLeagueAdjustments, clearLeagueAdjustments, adjustmentFor, adjustmentsLeague } from '../packages/core/src/data/commish';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const near = (a, b) => Math.abs(a - b) < 0.051;

const WEEK = 1;
installRealWeek(WEEK, JSON.parse(readFileSync(new URL('../public/pbp/w1.json', import.meta.url))));
const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const mk = (id, pos, team) => ({ id, name: id, full: id, pos, team, stats: { ...ZERO } });
const RB = mk('saquon-barkley', 'RB', 'PHI');
const QB = mk('josh-allen', 'QB', 'BUF');
const WR = mk('ja-marr-chase', 'WR', 'CIN');

clearLeagueScoring(); clearLeagueFlags(); clearLeagueAdjustments();
const base = classicPoints(RB, WEEK, { ppr: 1 });
const baseQb = classicPoints(QB, WEEK, { ppr: 1 });
ok('the bake scores (else every case is vacuous)', base > 0 && baseQb > 0, { base, baseQb });

setLeagueAdjustments('L1', [{ week: WEEK, slug: RB.id, points: '6' }, { week: 2, slug: QB.id, points: -4 }]);
ok('the cache names its league', adjustmentsLeague() === 'L1');
ok('+6 lands on him', near(classicPoints(RB, WEEK, { ppr: 1 }), base + 6), classicPoints(RB, WEEK, { ppr: 1 }));
ok('a week-2 adjustment leaves his week 1 alone', near(classicPoints(QB, WEEK, { ppr: 1 }), baseQb));
ok('…and is there for week 2', adjustmentFor(QB.id, 2) === -4);

setLeagueFlags('L1', [{ slug: RB.id, label: 'x', rules: { bonus_mult: 2 } }]);
ok('flat after the flag multiplier — ×2 then +6, never (raw+6)×2',
  near(classicPoints(RB, WEEK, { ppr: 1 }), base * 2 + 6), classicPoints(RB, WEEK, { ppr: 1 }));
clearLeagueFlags();

// A starter's adjustment moves the side; a bench player's does not.
const slot = (pos) => CLASSIC_SLOTS.find((d) => d.pos.includes(pos) && d.pos.length === 1).slot;
const side = (starters, bench) => ({ picks: starters.map((p) => ({ slot: slot(p.pos), player: p })), roster: [...starters, ...bench], hasLineup: true });
clearLeagueAdjustments();
const before = resolveClassicMatchup(side([RB], [QB]), side([WR], []), WEEK, { ppr: 1 });
setLeagueAdjustments('L1', [{ week: WEEK, slug: RB.id, points: 6 }, { week: WEEK, slug: QB.id, points: 10 }]);
const after = resolveClassicMatchup(side([RB], [QB]), side([WR], []), WEEK, { ppr: 1 });
ok('the starter\'s +6 moves his side by 6 (the benched QB\'s +10 does not)', near(after.home, before.home + 6), { before: before.home, after: after.home });
ok('the other side is untouched', near(after.away, before.away));
ok('the slot row carries it', near(after.slots.find((s) => s.slug === RB.id).score, before.slots.find((s) => s.slug === RB.id).score + 6));
ok('the window state agrees with the total', near(after.states[0].home, after.home));

clearLeagueAdjustments();
ok('cleared: back to the unadjusted number exactly', classicPoints(RB, WEEK, { ppr: 1 }) === base);
ok('cleared: the cache speaks for nobody', adjustmentsLeague() === null);
setLeagueAdjustments('L2', [{ week: WEEK, slug: RB.id, points: 0 }, { week: WEEK, slug: WR.id, points: 'x' }]);
ok('zero and junk install as nothing', adjustmentFor(RB.id, WEEK) === 0 && adjustmentFor(WR.id, WEEK) === 0);
clearLeagueAdjustments();

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nadjust: all ok');
