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
{ // same window: no longer a backup at all (v0.434.0) — an opposed starter
  // in the window means the opponent did not leave it empty, so the
  // unopposed slot plays in place rather than covering its neighbour
  const slots = [
    { win: 'tnf', slot: '0', me: P('a'), them: P('o'), score: 1 },
    { win: 'tnf', slot: '1', me: P('b'), them: null, score: 5 },
  ]; const subs = [];
  bestBallBackups(slots, lens, {}, { winRank, subbed: (b, st) => subs.push(`${b.me.id}->${st.me.id}`) });
  ok(subs.length === 0 && slots[1].score === 5 && slots[0].score === 1, `a window with an opposed starter is not empty: the unopposed neighbour banks in place, no same-window sub (${subs.join() || 'none'})`);
}
// ── THE WHOLE WINDOW, NOT THE SLOT (v0.434.0) ────────────────────────────
// Founder: "We should have players sub only if every opposing slot in their
// window is unopposed." A slot unopposed inside a window the opponent partly
// filled plays in place; only a window the opponent left entirely empty
// makes backups of its slots.
{ // partly filled window: the unopposed slot keeps its score, nobody subs
  const slots = [
    { win: 'early', slot: '0', me: P('a'), them: P('o1'), score: 3.0 },
    { win: 'early', slot: '1', me: P('b'), them: null, score: 9.4 },      // unopposed, but the window is opposed
    { win: 'late', slot: '0', me: P('c'), them: P('o2'), score: 1.0 },
  ];
  const subs = [];
  bestBallBackups(slots, lens, {}, { winRank, subbed: (b, st) => subs.push(`${b.me.id}->${st.me.id}`), zeroed: (b) => subs.push(`zeroed:${b.me.id}`) });
  ok(subs.length === 0 && slots[1].score === 9.4 && slots[2].score === 1.0, `a slot unopposed in a partly filled window is not a backup — it banks 9.4 in place (${subs.join() || 'no subs'})`);
}
{ // an entirely empty opposing window: its slots are backups, as before
  const slots = [
    { win: 'early', slot: '0', me: P('a'), them: null, score: 3.0 },
    { win: 'early', slot: '1', me: P('b'), them: null, score: 9.4 },
    { win: 'late', slot: '0', me: P('c'), them: P('o2'), score: 1.0 },
  ];
  const subs = [];
  bestBallBackups(slots, lens, {}, { winRank, subbed: (b, st) => subs.push(`${b.me.id}->${st.me.id}`) });
  ok(subs.join() === 'b->c' && slots[2].score === 9.4 && slots[0].score === 0 && slots[1].score === 0, `a window the opponent left empty makes backups: the best subs into the later starter, the rest bank 0 (${subs.join() || 'none'})`);
}
{ // a manual assignment from a partly filled window is ignored — there is no backup to assign
  const slots = [
    { win: 'early', slot: '0', me: P('a'), them: P('o1'), score: 3.0 },
    { win: 'early', slot: '1', me: P('b'), them: null, score: 9.4 },
    { win: 'late', slot: '0', me: P('c'), them: P('o2'), score: 1.0 },
  ];
  const subs = [];
  bestBallBackups(slots, lens, { 'early#1': 'late#0' }, { winRank, subbed: (b, st) => subs.push(`${b.me.id}->${st.me.id}`) });
  ok(subs.length === 0 && slots[2].score === 1.0 && slots[1].score === 9.4, 'an assignment on a slot that is not a backup does nothing');
}

if (fails) { console.log(`\n${fails} FAILED`); process.exit(1); }
console.log('\nALL BACKUP-WINDOW ASSERTIONS PASSED');
