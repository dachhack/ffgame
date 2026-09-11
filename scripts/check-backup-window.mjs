// A backup never covers an EARLIER window (v0.388.3). Founder, Thursday of
// Week 1: the opponent's Thursday backup had auto-subbed into a Wednesday slot
// that was already final. Pins bestBallBackups' window rule for both the
// manual assignment and the auto pass, with a rank the caller supplies.
import { bestBallBackups } from '../packages/core/src/engine/scoringRules.ts';

let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };
const P = (id) => ({ id, name: id, full: id, pos: 'RB', team: 'X', stats: {} });
const lens = {
  key: (s) => `${s.win}#${s.slot}`, win: (s) => s.win,
  player: (s) => s.me, metric: () => 'rush', opp: (s) => s.them,
  get: (s) => s.score, set: (s, v) => { s.score = v; },
};
const order = ['wed', 'tnf', 'early', 'late'];
const winRank = (w) => order.indexOf(w);
const mk = () => [
  { win: 'wed', slot: '0', me: P('wed-starter'), them: P('o1'), score: 0.5 },
  { win: 'tnf', slot: '0', me: P('thu-backup'), them: null, score: 9.4 },
  { win: 'early', slot: '0', me: P('sun-starter'), them: P('o2'), score: 3.0 },
];

{ // auto: the Thursday backup skips the lower Wednesday starter for Sunday's
  const slots = mk(); const subs = [];
  bestBallBackups(slots, lens, {}, { winRank, subbed: (b, st) => subs.push(`${b.me.id}->${st.me.id}`) });
  ok(subs.join() === 'thu-backup->sun-starter', `auto covers a LATER window, not the earlier one (${subs.join() || 'none'})`);
  ok(slots[0].score === 0.5 && slots[2].score === 9.4 && slots[1].score === 0, 'wed keeps 0.5, sun takes 9.4, the backup banks 0 in place');
}
{ // manual: an assignment onto an earlier window is refused, not honoured
  const slots = mk(); const subs = [];
  bestBallBackups(slots, lens, { 'tnf#0': 'wed#0' }, { winRank, subbed: (b, st) => subs.push(`${b.me.id}->${st.me.id}`) });
  ok(subs.length === 0 && slots[0].score === 0.5, `a manual assignment onto an earlier window does nothing (${subs.join() || 'none'})`);
}
{ // without a rank the old behaviour stands (classic 'wk', slate-less tests)
  const slots = mk(); const subs = [];
  bestBallBackups(slots, lens, {}, { subbed: (b, st) => subs.push(`${b.me.id}->${st.me.id}`) });
  ok(subs.join() === 'thu-backup->wed-starter', `no rank → lowest starter anywhere, as before (${subs.join()})`);
}
{ // same window is fine
  const slots = [
    { win: 'tnf', slot: '0', me: P('a'), them: P('o'), score: 1 },
    { win: 'tnf', slot: '1', me: P('b'), them: null, score: 5 },
  ]; const subs = [];
  bestBallBackups(slots, lens, {}, { winRank, subbed: (b, st) => subs.push(`${b.me.id}->${st.me.id}`) });
  ok(subs.join() === 'b->a', 'same window is coverable');
}
if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL BACKUP-WINDOW ASSERTIONS PASSED');
