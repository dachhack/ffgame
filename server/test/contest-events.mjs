// THE EVENT PLAYS ON THE WORKER'S FEED (v0.694.1): Hail Mary, Pick Six and
// Jinx read the scorer's {k, td, y} events, which a real row carries — the
// worker handed them playsFor's COUNT instead, so none of the three could
// score live. This runs them through the worker's own
// feed and fails on the old shape.
import { injectWeek, playEventsFor, playsFor } from '../src/engine.js';
import { contestEventBonus, contestJinxValue } from '../../packages/core/src/engine/contestPlays.ts';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const W = 901;
injectWeek(W, {
  'ev-qb': [{ c: 100, k: 'pass', y: 12, td: 0, ca: 0, tg: 0 }, { c: 900, k: 'pass', y: 44, td: 1, ca: 0, tg: 0 }],
  'ev-rb': [{ c: 200, k: 'rush', y: 3, td: 0, ca: 0, tg: 0 }, { c: 1400, k: 'rec', y: 9, td: 1, ca: 1, tg: 1 }],
  'ev-dst': [{ c: 500, k: 'int', y: 30, td: 1, ca: 0, tg: 0 }],
  'ev-short': [{ c: 300, k: 'pass', y: 39, td: 1, ca: 0, tg: 0 }],
});
const ev = playEventsFor(W, 'ev-qb');
ok('the feed hands the scorer the real rows: k, y, td', ev.length === 2 && ev[1].k === 'pass' && ev[1].y === 44 && ev[1].td === 1 && ev[0].td === 0, ev);
ok('a player with no rows gives an empty list, not null', Array.isArray(playEventsFor(W, 'nobody')) && playEventsFor(W, 'nobody').length === 0);
ok('playsFor stays the count the glance line reads', playsFor(W, 'ev-qb') === 2, playsFor(W, 'ev-qb'));
const both = [{ id: 'hail-mary' }, { id: 'pick-six' }];
let b = contestEventBonus(both, ['ev-qb', 'ev-rb'], (s) => playEventsFor(W, s));
ok('Hail Mary fires on the worker feed: a 44-yard touchdown pass', b.some((x) => x.id === 'hail-mary' && x.delta === 15) && !b.some((x) => x.id === 'pick-six'), b);
b = contestEventBonus(both, ['ev-short', 'ev-dst'], (s) => playEventsFor(W, s));
ok('…not on a 39-yarder; Pick Six fires on the defense\'s interception return', !b.some((x) => x.id === 'hail-mary') && b.some((x) => x.id === 'pick-six' && x.delta === 25), b);
ok('Jinx strikes the first touchdown: the back\'s receiving score at its catalog value', contestJinxValue(playEventsFor(W, 'ev-rb'), { pass: 4, rush: 6, rec: 6 }) === 6);
// The old shape, kept as the regression it was: a count has no plays in it.
const old = (s) => playsFor(W, s) ?? [];
b = contestEventBonus(both, ['ev-qb', 'ev-dst'], old);
ok('the old count shape scores nothing (the bug this test guards)', b.length === 0, b);
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('contest-events: all passed');
