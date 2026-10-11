// SCARCITY PRICING (v0.666.0, engine/salaryPricing.ts). Founder: "What's the
// process for updating the prices to make sure they align with how every
// position is likely to score?" Value over the position's replacement, the
// rate calibrated so the all-studs nine lands just over the budget. Pure.
import { priceBoard, replacementLevels, studsCost, SALARY_BUDGET, TARGET_SHARE, SALARY_FLOOR } from '../../packages/core/src/engine/salaryPricing.ts';
import { buildSalaryBoard } from '../src/pods.js';

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// A board shaped like a real week: 40 QB, 90 RB, 120 WR, 40 TE, 32 K, 32 DEF,
// projections sloping down the way the feed does.
const rows = [];
const slope = (pos, n, top, floor) => { for (let i = 0; i < n; i++) rows.push({ slug: `${pos.toLowerCase()}${i}`, pos, proj: Math.round((top - (top - floor) * (i / (n - 1)) ** 0.7) * 10) / 10 }); };
slope('QB', 40, 24, 6); slope('RB', 90, 22, 2); slope('WR', 120, 21, 2); slope('TE', 40, 16, 2); slope('K', 32, 10, 5); slope('DEF', 32, 11, 3);
rows.push({ slug: 'kc-hc', pos: 'HC', proj: 0 }, { slug: 'kc-p', pos: 'P', proj: 0 });

const { priced, rate, replacement } = priceBoard(rows);
const bySlug = new Map(priced.map((p) => [p.row.slug, p]));
ok('replacement is the body after the league\'s starters (QB13, RB25, WR37, TE13)', replacement.get('QB') === rows.find((r) => r.slug === 'qb12').proj && replacement.get('RB') === rows.find((r) => r.slug === 'rb24').proj && replacement.get('WR') === rows.find((r) => r.slug === 'wr36').proj);
const studs = studsCost(priced);
ok(`the all-studs nine lands just over the budget (${studs} vs ${SALARY_BUDGET}, target ${TARGET_SHARE})`, Math.abs(studs / SALARY_BUDGET - TARGET_SHARE) < 0.03, studs);
ok('a 20-point RB costs more than a 20-point QB (scarcity, not raw points)', (() => {
  const q = priceBoard([...rows, { slug: 'q20', pos: 'QB', proj: 20 }, { slug: 'r20', pos: 'RB', proj: 20 }]);
  const m = new Map(q.priced.map((p) => [p.row.slug, p.salary]));
  return m.get('r20') > m.get('q20');
})());
ok('the replacement-level body is at the floor; nobody is below it', bySlug.get('qb12').salary === SALARY_FLOOR && priced.every((p) => p.salary >= SALARY_FLOOR));
ok('prices are $100 steps and monotone within a position', priced.every((p) => p.salary % 100 === 0) && (() => { const rb = priced.filter((p) => p.row.pos === 'RB').sort((a, b) => b.row.proj - a.row.proj); return rb.every((p, i) => i === 0 || p.salary <= rb[i - 1].salary); })());
ok('HC and P (no feed projection) sit at the floor', bySlug.get('kc-hc').salary === SALARY_FLOOR && bySlug.get('kc-p').salary === SALARY_FLOOR && bySlug.get('kc-hc').vorp === 0);
ok('the rate is one number per board, inside its bounds', rate >= 150 && rate <= 1500);
ok('deterministic', JSON.stringify(priceBoard(rows).priced.map((p) => p.salary)) === JSON.stringify(priced.map((p) => p.salary)));

// The worker's board carries priced_proj alongside the price.
const idx = { allSlugs: () => [{ slug: 'star-rb', full: 'Star Back', pos: 'RB', team: 'KC', sid: '1', exp: 3 }, { slug: 'dud-wr', full: 'Dud Wide', pos: 'WR', team: 'BUF', sid: '2', exp: 1 }] };
const weekly = { bySid: new Map([['1', 18], ['2', 4]]), kByTeam: new Map([['KC', 9]]), defByTeam: new Map([['KC', 8], ['BUF', 6]]), source: 'test' };
const board = buildSalaryBoard(idx, new Set(['KC', 'BUF']), weekly, new Set(['HC']));
ok('the worker board rows carry priced_proj = proj and a salary', board.every((r) => r.priced_proj === r.proj && r.salary >= SALARY_FLOOR) && board.some((r) => r.pos === 'HC'));

if (fails) { console.log(`\nFAIL — ${fails} assertion(s) failed.`); process.exit(1); }
console.log('\nPASS — the board prices scarcity and calibrates to the budget.');
