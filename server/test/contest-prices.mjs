// A LEAGUE'S OWN PRICES (v0.730.33). Founder, over Monday Showdown's board:
// "Let's discount QBs in this league by $2000" — then, offered a cap raise
// that comes to the same thing: "No. Do the QB discount". The shared board
// stays; the league's price_adj cuts (or marks up) a position, and the worker
// and the apps price as the server's squad check (_contest_price, 0518) does.
import { contestPriced, contestPriceAdjOf, contestAutoBuild, contestConfigOf } from '../../packages/core/src/engine/contest.ts';
import { readFileSync } from 'node:fs';
let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const board = [
  { slug: 'purdy', pos: 'QB', team: 'SF', salary: 8600, proj: 22.4 }, { slug: 'mariota', pos: 'QB', team: 'WAS', salary: 3000, proj: 3.3 },
  { slug: 'cmc', pos: 'RB', team: 'SF', salary: 8600, proj: 20.8 }, { slug: 'white', pos: 'RB', team: 'WAS', salary: 3000, proj: 10.8 },
];
const adj = contestPriceAdjOf({ budget: 30000, price_adj: { QB: -2000 } });
ok('the league\'s settings read as { QB: -2000 }', JSON.stringify(adj) === '{"QB":-2000}', adj);
ok('…and the map the RPC returns reads the same', JSON.stringify(contestPriceAdjOf({ qb: -2000 })) === '{"QB":-2000}');
const p = contestPriced(board, adj);
ok('a QB costs $2,000 less: Purdy $6,600, Mariota $1,000', p[0].salary === 6600 && p[1].salary === 1000, p.map((r) => r.salary));
ok('every other position is untouched', p[2].salary === 8600 && p[3].salary === 3000);
ok('a price never goes below $0', contestPriced(board, { QB: -9000 })[1].salary === 0);
ok('no adjustment hands the same rows back', contestPriced(board, contestPriceAdjOf({})) === board);
const cfg = contestConfigOf({ contest_format: 'h2h', roster_slots: [{ pos: ['QB'] }, { pos: ['RB'] }], budget: 11000 }, 'dfs');
const b = contestAutoBuild(p, cfg, 'seed', null);
ok('the auto-build spends the league\'s prices: Purdy at $6,600 fits a $11,000 cap beside a $3,000 RB', b.S1 === 'purdy', b);
const pods = readFileSync(new URL('../src/pods.js', import.meta.url), 'utf8');
const subs = readFileSync(new URL('../src/contestSubs.js', import.meta.url), 'utf8');
ok('pods: the CPU\'s pool is priced the league\'s way', pods.includes('contestPriced(playable, contestPriceAdjOf(pod.settings_json))'));
ok('auto-sub: its board is priced the league\'s way', subs.includes('contestPriced(boardRows, contestPriceAdjOf(lg.settings_json))'));
if (fails) { console.error(`${fails} failed`); process.exit(1); }
console.log('contest-prices: all passed');
