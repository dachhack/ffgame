// Guard for THE PUBLISHED SCORE — bar, card and headline read one number
// (v0.339.3 / v0.339.4).
//
// Founder, over two screenshots side by side: "scoring discrepancy between the
// app and mobile web… I need these to match." The app renders the resolver's
// own rows out of matchup_state; the web re-simulated the whole week in the
// browser. A FLAT metric matched, because it is clock-independent once the
// plays are in. A DRIP metric did not, because its value IS a function of the
// clock and the two hosts were sampling different clocks — both honest, only
// one official.
//
// v0.339.3 pointed the WINDOW BAR at the server. That left the cards under it
// and the board headline above it still re-simulating, so the web was then
// internally inconsistent as well: a bar that did not equal the cards it sat
// on. v0.339.4 finishes it, and this pins the two things that make it either
// right or silently, plausibly wrong:
//
//   • THE SIDE FLIP. Rows are stored home/away and read you/them. Get it
//     backwards and every card shows the opponent's score — the numbers are
//     real, the layout is fine, and nothing looks broken.
//   • MISSING ≠ ZERO. A window that hasn't kicked, or an unopposed half, has
//     no published row. Reading that as 0 would blank a card that the local
//     sim can still score honestly.
//
// Run: npx tsx scripts/check-live-score.mjs
import {
  encodeSrvSlots, decodeSrvSlots, srvSlotScore, srvSlotRow, srvBoardTotals, shownScore,
} from '../packages/core/src/engine/liveScore.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

const rows = [
  { side: 'home', slot: '0', slug: 'josh-allen', score: 12.3 },
  { side: 'home', slot: '1', slug: 'saquon-barkley', score: 4 },
  { side: 'away', slot: '0', slug: 'ceedee-lamb', score: 8.1 },
];

// ── 1. THE SIDE FLIP, in both directions ──────────────────────────────────
{
  const home = decodeSrvSlots(encodeSrvSlots(rows, true));
  ok(srvSlotScore(home, 'y', 0) === 12.3, 'as the HOME seat, the home row is yours');
  ok(srvSlotScore(home, 't', 0) === 8.1, 'and the away row is theirs');

  const away = decodeSrvSlots(encodeSrvSlots(rows, false));
  ok(srvSlotScore(away, 'y', 0) === 8.1, 'as the AWAY seat, the away row is yours');
  ok(srvSlotScore(away, 't', 0) === 12.3, 'and the home row is theirs');
  ok(srvSlotScore(home, 'y', 0) !== srvSlotScore(away, 'y', 0),
    'THE POINT: the two seats read the SAME rows as different numbers — a flipped mapping shows the opponent\'s score on your card and looks perfectly normal');
}

// ── 2. Both keys resolve the same row ─────────────────────────────────────
// The app matches a row by roster slot OR by slug; carrying both means the two
// hosts agree about which card a row belongs to even if slot numbering drifts.
{
  const m = decodeSrvSlots(encodeSrvSlots(rows, true));
  ok(srvSlotScore(m, 'y', 1) === 4, 'by roster slot');
  ok(srvSlotScore(m, 'y', 99, 'saquon-barkley') === 4, 'by slug when the slot does not match');
  ok(srvSlotScore(m, 'y', 1, 'somebody-else') === 4, 'the SLOT wins when both are known — it is what savePicks wrote');
  ok(srvSlotScore(m, 'y', '1') === 4, 'a string slot index and a numeric one are the same key');
}

// ── 3. MISSING IS NOT ZERO ────────────────────────────────────────────────
{
  const m = decodeSrvSlots(encodeSrvSlots(rows, true));
  ok(srvSlotScore(m, 't', 1) === null, 'an unopposed half yields null, NOT 0');
  ok(srvSlotScore(m, 'y', 7) === null, 'a slot the server never published yields null');
  ok(shownScore({ final: false, srv: null, bank: 6.4 }) === 6.4,
    '…and null falls through to the local bank, so the card still scores');
  ok(shownScore({ final: false, srv: 0, bank: 6.4 }) === 0,
    'a PUBLISHED zero is honoured — the resolver really did score it at nothing');
}

// ── 4. A published row wins over the local sim ────────────────────────────
{
  ok(shownScore({ final: false, srv: 9.3, bank: 8.5 }) === 9.3,
    'THE FIX: live, the resolver\'s number wins over this client\'s re-simulation');
  ok(shownScore({ final: true, settled: 9.3, srv: 4, bank: 8.5 }) === 9.3,
    'at FINAL the settled engine value wins — it banks the drip tail the playback ceiling cuts');
  ok(shownScore({ final: true, settled: null, srv: 4, bank: 8.5 }) === 8.5,
    'at FINAL with nothing settled, the bank — not the mid-game server row');
  ok(shownScore({ final: false, srv: undefined, bank: 2 }) === 2,
    'the sim/demo boards, which have no server at all, are untouched');
  ok(shownScore({ final: false, srv: Number.NaN, bank: 2 }) === 2,
    'a NaN score is treated as unpublished rather than rendered');
}

// ── 5. THE HEADLINE: the sum of the published windows ─────────────────────
// Exactly what the app's own totals do. These rows already carry the contested
// window's +5, so this is not an approximation of the official score.
{
  const states = [
    { game_window: 'tnf', home_score: 30, away_score: 21.5 },
    { game_window: 'sun-early', home_score: 12.5, away_score: 40 },
  ];
  const h = srvBoardTotals(states, true);
  ok(h.you === 42.5 && h.them === 61.5, 'the home seat sums to 42.5 vs 61.5');
  const a = srvBoardTotals(states, false);
  ok(a.you === 61.5 && a.them === 42.5, 'the away seat sees the same board mirrored');
  ok(srvBoardTotals([], true) === null && srvBoardTotals(null, true) === null,
    'nothing published yields null, so the board keeps its local sim rather than showing 0–0');
  ok(srvBoardTotals([{ game_window: 'tnf', home_score: 0.1, away_score: 0.2 }], true).you === 0.1,
    'a published 0.1 is a real score, not "nothing published"');
}

// ── 6. THE WHOLE POINT, end to end: bar, cards and headline agree ─────────
// The invariant the founder was actually asking for. The window's slot rows
// sum to its window row, and the window rows sum to the headline — so one
// screen cannot show three different answers.
{
  const slots = [
    { side: 'home', slot: '0', slug: 'a', score: 12.3 },
    { side: 'home', slot: '1', slug: 'b', score: 4.2 },
    { side: 'away', slot: '0', slug: 'c', score: 8.1 },
    { side: 'away', slot: '1', slug: 'd', score: 3.4 },
  ];
  const states = [{ game_window: 'tnf', home_score: 16.5, away_score: 11.5, slot_scores: slots }];
  const m = decodeSrvSlots(encodeSrvSlots(slots, true));
  const cards = [0, 1].reduce((n, i) => n + srvSlotScore(m, 'y', i), 0);
  const bar = shownScore({ final: false, srv: states[0].home_score, bank: 999 });
  const head = srvBoardTotals(states, true).you;
  ok(Math.abs(cards - bar) < 1e-9, 'the CARDS sum to the BAR');
  ok(Math.abs(bar - head) < 1e-9, 'the BAR equals the HEADLINE (one window)');
  ok(Math.abs(cards - 16.5) < 1e-9, 'and all three are the resolver\'s 16.5, not a local re-simulation\'s 999');
}

// ── 7. A MALFORMED PAYLOAD DEGRADES TO THE LOCAL SIM ──────────────────────
// This crosses a JSON boundary purely so a memoized component can compare it
// by value. If that ever throws mid-render it takes the whole board down, and
// the correct failure is a card that scores the old way.
{
  for (const bad of ['', null, undefined, 'not json', '{}', '[1,2,3]', '[{"w":"x","k":"0","v":1}]', '[{"w":"y","k":"0","v":"abc"}]']) {
    const m = decodeSrvSlots(bad);
    ok(m instanceof Map && srvSlotScore(m, 'y', 0) === null,
      `a ${JSON.stringify(bad)} payload yields no rows rather than throwing`);
  }
  ok(encodeSrvSlots([], true) === '' && encodeSrvSlots(null, true) === '',
    'an empty window encodes to \'\' — the memo-stable "nothing published"');
}

// ── 8. THE APP'S ROW LOOKUP RUNS THE SAME RULE (v0.339.6) ─────────────────
// Duel.tsx used to hand-roll its match (either key, array order); the web
// decodes slot-first-then-slug. Same rule now, from one function — because a
// row carrying flags (hot/nuked) has to be matched WHOLE on the app, the rule
// itself is what's shared, not just the score.
{
  const rows = [
    { side: 'home', slot: '0', slug: 'stale-slug', score: 3, hot: true },
    { side: 'home', slot: '9', slug: 'josh-allen', score: 7, nuked: true },
    { side: 'away', slot: '0', slug: 'ceedee-lamb', score: 5 },
  ];
  ok(srvSlotRow(rows, 'home', '0', 'josh-allen')?.score === 3,
    'THE PRECEDENCE: the slot match wins even when another row matches the slug');
  ok(srvSlotRow(rows, 'home', '4', 'josh-allen')?.score === 7,
    'no slot match → the slug row, flags and all');
  ok(srvSlotRow(rows, 'home', '4', 'josh-allen')?.nuked === true,
    'the WHOLE row comes back — the app reads hot/nuked off it');
  ok(srvSlotRow(rows, 'away', '0')?.score === 5, 'sides never cross');
  ok(srvSlotRow(rows, 'home', 0, 'x') === rows[0],
    'a numeric slot index and a string one are the same key');
  ok(srvSlotRow(rows, 'home', '4') === undefined && srvSlotRow([], 'home', '0') === undefined
    && srvSlotRow(null, 'home', '0') === undefined,
    'no match, empty, and null all yield undefined rather than throwing');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL LIVE-SCORE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
