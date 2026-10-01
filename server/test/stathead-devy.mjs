// StatHead's devy board (0403): mapping and chunked loading. No network.
import { statheadDevyRows, loadStatheadDevy } from '../src/poll/statheadDevy.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

const player = (id, name, pos, r1, extra = {}) => ({
  name, pos, school: 'Ohio State', draftYear: 2027, cfbdId: id,
  compositeValue: { sf: 9990, oneQB: 9990 - r1 }, compositeRank: { sf: r1 + 1, oneQB: r1 }, ...extra,
});
const board = { players: [
  player('5079720', 'Jeremiah Smith', 'WR', 1),
  player('4870906', 'Arch Manning', 'QB', 3),
  player('x12', 'Bad Id', 'RB', 4),
  player('5000001', 'A Kicker', 'K', 5),
  { name: 'No Rank', pos: 'TE', cfbdId: '5000002', compositeRank: {} },
] };
const rows = statheadDevyRows(board);
ok(rows.length === 2, `two usable players (bad id, kicker and unranked dropped) — got ${rows.length}`);
ok(rows[0].espn_id === '5079720' && rows[0].rank_1qb === 1 && rows[0].rank_sf === 2 && rows[0].value_1qb === 9989,
  'cfbdId is the ESPN id; 1QB and superflex composite rank and value kept');
ok(rows[1].pos === 'QB' && rows[1].draft_year === 2027, 'position and draft year kept');

const big = { players: Array.from({ length: 3200 }, (_, i) => player(String(6000000 + i), `P ${i}`, 'RB', i + 1)) };
const calls = [];
const rpc = async (fn, args) => { calls.push([fn, args]); return { data: fn === 'finish_stathead_devy' ? { ok: true, matched: 7 } : { ok: true }, error: null }; };
const r = await loadStatheadDevy(rpc, () => {}, async () => big);
const ups = calls.filter(([fn]) => fn === 'upsert_stathead_devy');
ok(ups.length === 3 && ups.reduce((n, [, a]) => n + a.p_rows.length, 0) === 3200, 'loaded in three chunks, every row once');
ok(new Set(calls.map(([, a]) => a.p_as_of)).size === 1, 'every chunk and the finish share one as_of');
ok(calls.at(-1)[0] === 'finish_stathead_devy' && r.matched === 7, 'finished last, and its answer comes back');

let threw = false;
try { await loadStatheadDevy(async (fn) => ({ data: null, error: fn === 'upsert_stathead_devy' ? { message: 'boom' } : null }), () => {}, async () => big); }
catch { threw = true; }
ok(threw, 'a failed chunk stops before finishing, so the old board stays');

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL STATHEAD-DEVY TESTS PASSED');
