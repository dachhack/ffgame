// AN EMPTY SPOT (v0.695.0). Founder, on a Bullseye matchup with both HC spots
// empty: "CPUs failed to set HC. Those spots should take the -10 as well."
// Two rules: the auto-build never leaves a spot empty when someone fits it
// (a head coach rides the board at proj 0, and the dart's build only aimed
// with a projected number); and an empty Bullseye spot is a zero ROW that
// carries the penalty, so the table can show the −10 on it.
import { scoreContest, contestConfigOf, contestAutoBuild } from '../../packages/core/src/engine/contest.ts';
import { ringScore } from '../../packages/core/src/engine/bullseye.ts';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const slots = [{ pos: ['QB'] }, { pos: ['WR'] }, { pos: ['HC'] }];
const cfg = (extra) => contestConfigOf({ contest: 'bullseye', bullseye: 'slots', bullseye_radius: 10, contest_format: 'h2h', roster_slots: slots, budget: 50000, ...extra }, 'dfs');
const board = [
  { slug: 'qb-a', pos: 'QB', team: 'BUF', salary: 8000, proj: 21 }, { slug: 'qb-b', pos: 'QB', team: 'KC', salary: 7000, proj: 18 },
  { slug: 'wr-a', pos: 'WR', team: 'BUF', salary: 6000, proj: 14 }, { slug: 'wr-b', pos: 'WR', team: 'KC', salary: 4000, proj: 9 },
  { slug: 'buf-hc', pos: 'HC', team: 'BUF', salary: 3000, proj: 0 }, { slug: 'kc-hc', pos: 'HC', team: 'KC', salary: 2500, proj: 0 },
];
const card = { targets: { S1: 20, S2: 10, S3: 6 }, total: 36 };
let b = contestAutoBuild(board, cfg(), 'seed-1', card);
ok('the dart’s auto-build fills the HC spot although every coach is priced at 0', b.S3 === 'kc-hc' || b.S3 === 'buf-hc', b);
b = contestAutoBuild(board, cfg({ contest: 'golf' }), 'seed-1', null);
ok('golf’s auto-build fills it too', b.S3 === 'kc-hc', b);
b = contestAutoBuild(board.map((r) => (r.pos === 'HC' ? { ...r, proj: r.slug === 'buf-hc' ? 7 : 4 } : r)), cfg(), 'seed-1', card);
ok('a coach priced by his game (the worker’s pool) is aimed at the number like anyone', b.S3 === 'buf-hc', b);
// THE PENALTY ROW: an empty spot scores like a no-show, as its own row
const pts = { 'qb-a': 20, 'wr-a': 10, 'wr-b': 0 };
const pointsOf = (slug) => pts[slug] ?? 0;
const r = scoreContest({ home: { S1: 'qb-a', S2: 'wr-a', S3: null }, away: { S1: 'qb-a', S2: 'wr-a', S3: 'kc-hc' } }, cfg(), pointsOf, { card, settled: true });
const row = r.slots.find((x) => x.side === 'home' && x.slot === 'S3');
ok('an empty Bullseye spot is a row of its own: no player, 0.0, the −10 on it', !!row && row.slug === null && row.score === 0 && row.aim?.penalty === 10, row);
ok('…and the squad scores exactly as one whose coach posted nothing', r.home === r.away, [r.home, r.away]);
const full = scoreContest({ home: { S1: 'qb-a', S2: 'wr-a', S3: 'kc-hc' }, away: { S1: 'qb-a', S2: 'wr-a', S3: null } }, cfg(), (s) => (s === 'kc-hc' ? 6 : pointsOf(s)), { card, settled: true });
ok('…a bullseye’s ring plus the penalty short of a coach who hit his number', full.home - full.away === ringScore(6, 6, 10) + 10, [full.home, full.away]);
const t = scoreContest({ home: { S1: 'qb-a', S2: 'wr-a', S3: null }, away: { S1: 'qb-a', S2: 'wr-a', S3: 'kc-hc' } }, cfg({ bullseye: 'total' }), pointsOf, { card, settled: true });
ok('under a one-team total the empty spot adds the penalty to the distance, same as a zero', t.home === t.away && t.home === Math.abs(30 - 36) + 10, [t.home, t.away]);
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('contest-empty: all passed');
