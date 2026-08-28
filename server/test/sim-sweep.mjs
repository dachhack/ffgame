// The board-driven sim sweep's CLOCK MATH (0251). The sweep's judgement —
// feed shape, lineups, resolution — is simulate.js's and resolve.js's, proven
// by dry mode and the smoke. What is NEW is the cursor windowing that replaces
// the CLI's private loop, and that is exactly what a worker restart, a crashed
// tick, or two deliveries of one play would corrupt if it were wrong. So these
// pin the pure pieces: the derived clock, the (from, to] release window, and
// the dedupe that keeps only the LATEST delivery of a play's key.
import { simClock, dueRows } from '../src/simsweep.js';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};
const eq = (got, want, label) => ok(JSON.stringify(got) === JSON.stringify(want), `${label} (got ${JSON.stringify(got)})`);

// ── simClock: wall-elapsed × speed, floored at zero ─────────────────────────
eq(simClock(1000_000, 1000_000, 20), 0, 'clock starts at 0');
eq(simClock(1000_000, 1060_000, 20), 1200, '60s of wall at 20× is 1200 feed-seconds');
eq(simClock(1000_000, 990_000, 20), 0, 'a skewed clock never goes negative');

// ── dueRows: the (from, to] window ──────────────────────────────────────────
const row = (slug, k, at, y = 5) => ({ at, row: { week: 1, game_id: 'SIM', player_slug: slug, c: at, t: at, pid: at, k, y, td: 0, ca: 0, tg: 0, to: null } });
const feed = [row('a', 'rush', 10), row('b', 'rush', 20), row('c', 'rush', 30), row('d', 'rush', 40)];

eq(dueRows(feed, 0, 25).map((r) => r.player_slug), ['a', 'b'], 'releases everything at or before the clock');
eq(dueRows(feed, 25, 40).map((r) => r.player_slug), ['c', 'd'], 'the cursor end is exclusive, the clock end inclusive');
eq(dueRows(feed, 20, 20).length, 0, 'an unmoved clock releases nothing');
// The boundary play releases EXACTLY once across consecutive windows.
const first = dueRows(feed, 0, 20).map((r) => r.player_slug);
const second = dueRows(feed, 20, 40).map((r) => r.player_slug);
ok(first.includes('b') && !second.includes('b'), 'a boundary play is released once, in the earlier window');
eq([...first, ...second].sort().join(''), 'abcd', 'consecutive windows cover the feed with no gap or overlap');

// ── dedupe: one write per conflict key, the LATEST delivery wins ────────────
// A provisional stat and its fix share the key (week,game,pid,slug,kind); when
// both fall in one window the fix must be the row that reaches the upsert.
const prov = row('e', 'rec', 50, 12);
const fix = { at: 60, row: { ...prov.row, y: 27 } };
const deduped = dueRows([prov, fix], 40, 70);
eq(deduped.length, 1, 'provisional + fix in one window collapse to one row');
eq(deduped[0].y, 27, '…and the later delivery (the fix) is the one kept');
// Different KINDS of the same pid stay distinct rows (a QB pass + its catch).
const pass = { at: 55, row: { ...prov.row, k: 'pass' } };
eq(dueRows([prov, pass], 40, 70).length, 2, 'same pid, different kind = two rows');

if (fails) { console.log(`\nFAIL — ${fails} assertion(s)`); process.exit(1); }
console.log('\nALL SIM-SWEEP ASSERTIONS PASSED');
