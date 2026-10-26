// A backup's stakes follow him (v0.734.0). Gridiron Gang, week 7: Double or
// Nothing and Grudge on Caleb Williams' unopposed TNF spot did nothing, though
// his score subbed in for the SNF starter. Pins that the stakes settle on the
// covered slot, and that they stay inert when the backup doesn't sub in.
import { applyPostSlotPipeline } from '../packages/core/src/engine/orchestrate.ts';

const sideLens = (side) => ({
  key: (s) => `${s.win}#${s.slot}`, win: (s) => s.win,
  player: (s) => (side === 'home' ? s.homeP : s.awayP), metric: () => 'pass',
  opp: (s) => (side === 'home' ? s.awayP : s.homeP),
  get: (s) => (side === 'home' ? s.home : s.away),
  set: (s, v) => { if (side === 'home') s.home = v; else s.away = v; },
});
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${msg}`); if (!c) fails++; };
const P = (id) => ({ id, name: id, full: id, pos: 'QB', team: 'X', stats: {} });
const mk = (calebPts, holaniPts, oppSnf) => [
  { win: 'tnf', slot: '0', homeP: P('caleb'), awayP: null, home: calebPts, away: 0, events: [] },
  { win: 'snf', slot: '0', homeP: P('holani'), awayP: P('opp'), home: holaniPts, away: oppSnf, events: [] },
];
const run = (slots, home) => applyPostSlotPipeline(slots, {
  week: 7,
  a: { lens: sideLens('home'), evSide: 'you', ...home },
  b: { lens: sideLens('away'), evSide: 'their' },
  eventsOf: (s) => s.events,
});
const stakes = { backups: { 'tnf#0': 'snf#0' }, don: 'tnf#0', grudge: ['tnf#0'] };

{ // Caleb 24 subs over Holani 3 vs 8: DoN doubles to 48, Grudge (+40 ≥ 10) +25
  const s = mk(24, 3, 8); run(s, stakes);
  ok(s[0].home === 0, `the backup banks 0 in place (${s[0].home})`);
  ok(s[1].home === 73, `SNF takes 24, doubled to 48, +25 grudge = 73 (${s[1].home})`);
}
{ // the stakes can lose there too: Caleb 6 subs over Holani 2 vs 9
  const s = mk(6, 2, 9); run(s, stakes);
  ok(s[1].home === -25, `a lost DoN zeroes it and the grudge takes 25 (${s[1].home})`);
}
{ // no sub (Holani outscored him): the stakes stay on the unopposed spot, inert
  const s = mk(4, 12, 8); run(s, stakes);
  ok(s[1].home === 12 && s[0].home === 0, `no sub → no stake anywhere (snf ${s[1].home}, tnf ${s[0].home})`);
}
{ // a starter's own stake is untouched
  const s = mk(24, 3, 8); run(s, { backups: { 'tnf#0': 'snf#0' }, don: 'snf#0' });
  ok(s[1].home === 48, `a DoN already on the covered slot settles once (${s[1].home})`);
}
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log(fails ? '' : '\nALL BACKUP-STAKE ASSERTIONS PASSED');
