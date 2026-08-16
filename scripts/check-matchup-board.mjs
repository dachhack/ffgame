// The classic MATCHUP BOARD's arithmetic, checked in Node.
//
// This lives in check:parity rather than beside the screens because the
// numbers are the product: live totals, projected finals, who is left to
// play, and the win chance derived from them. Two hosts render this board;
// them disagreeing about any figure is worse than either looking wrong.
// The cases that earn their keep are the ones where the obvious
// implementation is wrong — a live player must not be worth live+proj, a
// finished player must not be improved by a projection, and an EMPTY
// starting spot is not "yet to play".
import { projectEntry, winProbability, yetToPlayBreakdown, buildMatchupBoard, gameFor, entryState } from '../packages/core/src/engine/matchupBoard';
let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const E = (o) =>
  ({ slug: 's', name: 'N', pos: 'RB', team: 'KC', live: 0, proj: 10, state: 'pre', ...o });

// projectEntry — the case the naive version gets wrong
ok('done keeps its final, projection cannot improve it', projectEntry(E({ state: 'done', live: 20, proj: 10 })) === 20);
ok('pre is the projection', projectEntry(E({ state: 'pre', live: 0, proj: 12 })) === 12);
ok('live over projection keeps the live score', projectEntry(E({ state: 'live', live: 20, proj: 10 })) === 20);
ok('live under projection floors at the projection', projectEntry(E({ state: 'live', live: 3, proj: 10 })) === 10);
ok('live NEVER adds live+proj', projectEntry(E({ state: 'live', live: 20, proj: 10 })) !== 30);

// winProbability
const wideOpen = winProbability(110, 100, 9, 9);
const nearlyDone = winProbability(110, 100, 1, 0);
ok('same margin is more decisive with fewer left', nearlyDone > wideOpen, { wideOpen, nearlyDone });
ok('a 10-pt edge with everyone to play stays modest', wideOpen < 0.75, wideOpen);
ok('never claims 100% while anything is unresolved', winProbability(200, 100, 1, 0) <= 0.99);
ok('a settled blowout may read 100%', winProbability(200, 100, 0, 0) === 1);
ok('dead heat is a coin flip', Math.abs(winProbability(100, 100, 5, 5) - 0.5) < 1e-9);
const a = winProbability(110, 100, 4, 4), b = winProbability(100, 110, 4, 4);
ok('the two sides sum to 1', Math.abs(a + b - 1) < 1e-9, { a, b });

// yet-to-play breakdown
ok('roster order, not alphabetical',
  yetToPlayBreakdown([E({ pos: 'WR' }), E({ pos: 'QB' }), E({ pos: 'WR' }), E({ pos: 'TE' })]) === '1 QB, 2 WR, 1 TE',
  yetToPlayBreakdown([E({ pos: 'WR' }), E({ pos: 'QB' }), E({ pos: 'WR' }), E({ pos: 'TE' })]));
ok('finished players drop out', yetToPlayBreakdown([E({ pos: 'QB', state: 'done' }), E({ pos: 'RB' })]) === '1 RB');

// the whole board
const slots = [
  { slot: 'S1', type: 'QB', pos: ['QB'] },
  { slot: 'S2', type: 'RB', pos: ['RB'] },
];
const board = buildMatchupBoard({
  week: 1, locked: true, slots, labelFor: (d) => d.type,
  home: { rosterId: 1, team: 'Us', starters: { S1: E({ pos: 'QB', live: 20, proj: 18, state: 'done' }), S2: E({ pos: 'RB', live: 4, proj: 12, state: 'live' }) } },
  away: { rosterId: 2, team: 'Them', starters: { S1: E({ pos: 'QB', live: 10, proj: 15, state: 'done' }), S2: null } },
});
ok('live total counts only what is scored', board.home.live === 24, board.home.live);
ok('projected blends done + live floor', board.home.projected === 32, board.home.projected);
ok('an EMPTY spot is not "yet to play"', board.away.yetToPlay === 0, board.away.yetToPlay);
ok('an empty spot contributes nothing', board.away.projected === 10, board.away.projected);
ok('win pcts still sum to 1', Math.abs(board.home.winPct + board.away.winPct - 1) < 1e-9);

// slate helpers
const slate = [{ home: 'CIN', away: 'TB', kickoff: '2026-09-13T17:00:00Z' }];
ok('away team reads its opponent', gameFor('TB', slate)?.opponent === 'CIN');
ok('home team reads its opponent', gameFor('CIN', slate)?.opponent === 'TB');
ok('home/away is distinguished', gameFor('CIN', slate)?.home === true && gameFor('TB', slate)?.home === false);
ok('a team with no game is a bye (null)', gameFor('KC', slate) === null);

const T = Date.parse('2026-09-13T17:00:00Z');
ok('before kickoff is pre', entryState('2026-09-13T17:00:00Z', 'TB', T - 1000) === 'pre');
ok('after kickoff is live', entryState('2026-09-13T17:00:00Z', 'TB', T + 1000) === 'live');
ok('a FINAL team is done even mid-window', entryState('2026-09-13T17:00:00Z', 'TB', T + 1000, new Set(['TB'])) === 'done');
ok('no kickoff (bye) is pre, never live', entryState(null, 'KC', T + 1e9) === 'pre');

console.log(fails ? `\n${fails} FAILED` : '\nALL MATCHUP-BOARD ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
