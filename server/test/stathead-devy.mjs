// StatHead's devy board (0403): mapping and chunked loading. No network.
import { statheadDevyRows, loadStatheadDevy, cardOf, checkDevyBoard } from '../src/poll/statheadDevy.js';

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
ok(ups.length === 4 && ups.reduce((n, [, a]) => n + a.p_rows.length, 0) === 3200, 'loaded in chunks of 800, every row once');
ok(new Set(calls.map(([, a]) => a.p_as_of)).size === 1, 'every chunk and the finish share one as_of');
ok(calls.at(-1)[0] === 'finish_stathead_devy' && r.matched === 7, 'finished last, and its answer comes back');

let threw = false;
try { await loadStatheadDevy(async (fn) => ({ data: null, error: fn === 'upsert_stathead_devy' ? { message: 'boom' } : null }), () => {}, async () => big); }
catch { threw = true; }
ok(threw, 'a failed chunk stops before finishing, so the old board stays');

// 0406: the card keeps StatHead's numbers and drops the third-party list facts
const card = cardOf({ compositeRank: { oneQB: 3 }, profile: { stars: 5 }, marketListed: true, pListed: 0.9, name: 'X' });
ok(card.compositeRank?.oneQB === 3 && card.profile?.stars === 5, 'the card carries StatHead\'s ranks and profile');
ok(!('marketListed' in card) && !('pListed' in card), 'and never whether a third-party list carries him');
ok(rows[0].card && rows[0].card.compositeRank?.oneQB === 1, 'every row brings its card');

// v0.592.0: the weekly reprice — when profilesThrough (or, v0.594.0, generatedAt) moves
{
  const st = { through: null };
  const seen = [];
  const rpc2 = async (fn) => { seen.push(fn); return { data: fn === 'refresh_college_prices' ? { ok: true, priced: 42 } : { ok: true, matched: 7 }, error: null }; };
  const wk4 = { ...big, profilesThrough: '2026 week 4' };
  const r1 = await checkDevyBoard(rpc2, () => {}, async () => wk4, st);
  ok(r1.changed && r1.priced === 42 && st.through === '2026 week 4' && seen.at(-1) === 'refresh_college_prices', 'a new week loads the board, then reprices');
  seen.length = 0;
  const r2 = await checkDevyBoard(rpc2, () => {}, async () => wk4, st);
  ok(!r2.changed && seen.length === 0, 'the same week does nothing');
  const r3 = await checkDevyBoard(rpc2, () => {}, async () => ({ ...big, profilesThrough: '2026 week 5' }), st);
  ok(r3.changed && st.through === '2026 week 5', 'next Sunday\'s week reprices again');
  const bad = async (fn) => ({ data: null, error: fn === 'refresh_college_prices' ? { message: 'boom' } : null });
  let threw2 = false;
  try { await checkDevyBoard(bad, () => {}, async () => ({ ...big, profilesThrough: '2026 week 6' }), st); } catch { threw2 = true; }
  ok(threw2 && st.through === '2026 week 5', 'a failed reprice is retried next check (the week is not marked done)');
  // v0.594.0: a rebuilt board in the same week reprices too
  seen.length = 0;
  const g1 = { ...big, profilesThrough: '2026 week 5', generatedAt: '2026-10-03T00:48:29Z' };
  const r4 = await checkDevyBoard(rpc2, () => {}, async () => g1, st);
  ok(r4.changed && st.generated === '2026-10-03T00:48:29Z' && seen.at(-1) === 'refresh_college_prices', 'same week, new generatedAt: reprices');
  seen.length = 0;
  const r5 = await checkDevyBoard(rpc2, () => {}, async () => g1, st);
  ok(!r5.changed && seen.length === 0, 'the same build does nothing');
  const r6 = await checkDevyBoard(rpc2, () => {}, async () => ({ ...g1, generatedAt: '2026-10-04T09:00:00Z' }), st);
  ok(r6.changed && st.through === '2026 week 5', 'the next build reprices again');
}

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL STATHEAD-DEVY TESTS PASSED');
