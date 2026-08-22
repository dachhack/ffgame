// Guard for ENGINE PARITY: the web's display pipeline and the worker's publish
// pipeline resolve the same lineups to the same numbers (v0.339.6).
//
// There are TWO resolution engines over the shared per-slot resolveSlot:
//
//   • matchup.ts `buildMatchup` — what the WEB LIVE BOARD renders through, and
//     whose settled values win on screen at FINAL;
//   • liveResolve.ts `resolveLiveMatchup` — what the WORKER publishes to
//     matchup_state (and the admin force-resolve previews), i.e. the numbers
//     that officially decide the week.
//
// Since v0.340.0 the layered RULES themselves (backups, suppress, banker,
// battle verdict, coin, awards) live once in engine/scoringRules.ts and both
// engines call them — the hand-synced copies this check was written against
// are gone. It found four real divergences in those copies on day one (the
// banker placement that flipped a match outcome, the unpaid turnover swing,
// the phantom week-1 stipend, the MVP-coin denominators), which is why they
// are gone. What can still drift, and what this file therefore guards now,
// is each engine's ORCHESTRATION: the pipeline order the shared rules run
// in, the SideLens glue mapping each engine's rows into them, and the input
// pairing from picks to slots. Same assertions, new failure surface.
//
// The fixture drives both engines from ONE lineup description through each
// side's real glue (slotKey'd picks for buildMatchup, (win,slot)-keyed
// LivePicks for resolveLiveMatchup) and asserts per-slot, per-window, total
// and coin equality. Plays are synthetic (week 900): no baked data, no feed —
// both engines see identical inputs and possession gating cancels out, so
// what is measured is purely the LAYERING.
// Run: npx tsx scripts/check-engine-parity.mjs
import { setRuntimeSlate } from '../packages/core/src/data/nflSlate.ts';
import { setSyntheticWeeks } from '../packages/core/src/data/realPbp.ts';
import { setActiveLeague } from '../packages/core/src/data/league.ts';
import { buildMatchup, slotKey, weekEarnings, WINDOW_WIN_BONUS } from '../packages/core/src/engine/matchup.ts';
import { resolveLiveMatchup } from '../packages/core/src/engine/liveResolve.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};
const r1 = (n) => Math.round(n * 10) / 10;

const WEEK = 900; // no baked plays, no baked slate — the live worker's shape

// ── The week's NFL slate (fixed five-window model: no kickoff timestamps) ──
setRuntimeSlate(WEEK, [
  { away: 'DEN', home: 'GB', aScore: 0, hScore: 0, win: 'tnf' },
  { away: 'KC', home: 'LV', aScore: 0, hScore: 0, win: 'early' },
  { away: 'PHI', home: 'DAL', aScore: 0, hScore: 0, win: 'early' },
  { away: 'SF', home: 'SEA', aScore: 0, hScore: 0, win: 'late' },
  { away: 'BUF', home: 'BAL', aScore: 0, hScore: 0, win: 'snf' },
  { away: 'CIN', home: 'CLE', aScore: 0, hScore: 0, win: 'mnf' },
]);

// ── Players: one Player object shared by BOTH engines ──────────────────────
const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };
const P = {};
const mk = (id, pos, team) => (P[id] = { id, name: id, full: id, pos, team, stats: { ...ZERO } });
mk('qb-you', 'QB', 'DEN'); mk('wr-you', 'WR', 'KC'); mk('rb-you', 'RB', 'PHI');
mk('te-you', 'TE', 'SF'); mk('wr2-you', 'WR', 'BUF'); mk('dst-you', 'DEF', 'CIN');
mk('qb-opp', 'QB', 'GB'); mk('wr-opp', 'WR', 'LV'); mk('rb-opp', 'RB', 'DAL');
mk('rb2-opp', 'RB', 'SF'); mk('qb2-opp', 'QB', 'BAL'); mk('wr2-opp', 'WR', 'CLE');
mk('tie-you', 'QB', 'DEN'); mk('tie-opp', 'QB', 'GB');
mk('fum-you', 'RB', 'PHI'); mk('fum-opp', 'RB', 'DAL');
mk('k-you', 'K', 'BUF'); mk('te2-opp', 'TE', 'SEA');

// ── The plays both engines read (identical injection path) ────────────────
setSyntheticWeeks([{ week: WEEK, pbp: {
  'qb-you': [{ c: 300, k: 'pass', y: 20 }, { c: 900, k: 'pass', y: 50 }, { c: 1500, k: 'pass', y: 80, td: 1 }],
  'qb-opp': [{ c: 600, k: 'pass', y: 100 }],
  'wr-you': [{ c: 600, k: 'rec', y: 30, tg: 1 }, { c: 1200, k: 'rec', y: 30, tg: 1 }],
  'wr-opp': [{ c: 900, k: 'rec', y: 10, tg: 1 }],
  'rb-you': [{ c: 450, k: 'rush', y: 40, ca: 1 }, { c: 2200, k: 'rush', y: 8, td: 1, ca: 1 }],
  'rb-opp': [{ c: 800, k: 'rush', y: 60, ca: 1 }, { c: 2000, k: 'rush', y: 5, td: 1, ca: 1 }],
  'te-you': [{ c: 700, k: 'rec', y: 15, tg: 1 }, { c: 1400, k: 'rec', y: 8, td: 1, tg: 1 }],
  'rb2-opp': [{ c: 500, k: 'rush', y: 25, ca: 1 }, { c: 1600, k: 'rush', y: 30, ca: 1 }],
  'wr2-you': [{ c: 1000, k: 'rec', y: 45, tg: 1 }],
  'qb2-opp': [{ c: 1100, k: 'pass', y: 120 }],
  'wr2-opp': [{ c: 400, k: 'rec', y: 20, tg: 1 }],
  // An exact tie by construction (identical lines), and a turnover apiece —
  // `to` is the RealPlay turnover flag turnoversCommitted counts.
  'tie-you': [{ c: 300, k: 'pass', y: 100 }],
  'tie-opp': [{ c: 500, k: 'pass', y: 100 }],
  'fum-you': [{ c: 400, k: 'rush', y: 30, ca: 1 }, { c: 1200, k: 'rush', y: 2, ca: 1, to: 1 }],
  'fum-opp': [{ c: 700, k: 'rush', y: 50, ca: 1 }, { c: 1900, k: 'rush', y: 0, ca: 1, to: 1 }, { c: 2600, k: 'rush', y: 1, ca: 1, to: 1 }],
  // A banker kicker (two XPs), a DST's splash line, and an opposing TE's TD —
  // fuel for the layered-effects scenario.
  'k-you': [{ c: 800, k: 'xp', y: 0 }, { c: 2200, k: 'xp', y: 0 }],
  'dst-you': [{ c: 500, k: 'sack', y: 0 }, { c: 1300, k: 'int', y: 0 }],
  'te2-opp': [{ c: 900, k: 'rec', y: 12, tg: 1 }, { c: 1700, k: 'rec', y: 6, td: 1, tg: 1 }],
}, points: {} }, {
  // Week 1 plays for the stipend rule: setSyntheticWeeks REPLACES the store
  // (the 0199.3 trap), so both weeks install in this one call.
  week: 1, pbp: { 'qb-you': [{ c: 300, k: 'pass', y: 50 }], 'qb-opp': [{ c: 600, k: 'pass', y: 25 }] }, points: {},
}]);

// ── The league buildMatchup resolves inside ───────────────────────────────
const roster = (ids) => ids;
setActiveLeague({
  league: {
    id: 'parity', name: 'Engine Parity', format: '2-team probe', season: 2025,
    teams: [
      { id: 't1', name: 'You', owner: 'You', ownerId: 't1', seed: 0, wins: 0, losses: 0, pf: 0, pa: 0, roster: roster(['qb-you', 'wr-you', 'rb-you', 'te-you', 'wr2-you', 'dst-you', 'tie-you', 'fum-you', 'k-you']) },
      { id: 't2', name: 'Opp', owner: 'Opp', ownerId: 't2', seed: 0, wins: 0, losses: 0, pf: 0, pa: 0, roster: roster(['qb-opp', 'wr-opp', 'rb-opp', 'rb2-opp', 'qb2-opp', 'wr2-opp', 'tie-opp', 'fum-opp', 'te2-opp']) },
    ],
    schedule: [],
  },
  players: P,
  weeks: 14,
});

// ── One lineup description drives both engines through their real glue ─────
// [win, slotIndex, playerId, metricId] — buildMatchup gets slotKey'd picks
// (exactly what the web board holds), resolveLiveMatchup gets (win,slot)
// LivePicks with slot = String(index) (exactly what savePicks stores as
// roster_slot and the worker reads back).
const toPicks = (rows) => Object.fromEntries(rows.map(([w, i, pid, m]) => [slotKey(w, i), { playerId: pid, metricId: m }]));
const toLive = (rows) => rows.map(([w, i, pid, m]) => ({ win: w, slot: String(i), player: P[pid], metricId: m }));

// The web live board's exact call shape: your buffs {}, opponent's REVEALED
// buffs [] (not the AI default draw — passing undefined would hand the demo
// opponent three free amplifiers the worker never grants).
const runBoth = (youRows, oppRows, { buffs = {}, oppBuffs = [], extras = {} } = {}) => {
  const m = buildMatchup('t1', 't2', WEEK, toPicks(youRows), toPicks(oppRows), {}, {}, {}, buffs, { ...extras }, false, oppBuffs);
  const r = resolveLiveMatchup(toLive(youRows), toLive(oppRows), WEEK, {
    homeBuffs: new Set(Object.keys(buffs).filter((k) => buffs[k])),
    awayBuffs: new Set(oppBuffs),
  });
  return { m, r };
};

const stateOf = (r, win) => r.states.find((s) => s.window === win) ?? { home: 0, away: 0 };
const winOf = (m, win) => m.windows.find((w) => w.window.id === win);
// buildMatchup keeps the window bonus beside the battle; liveResolve bakes it
// into the state. Fold it in the same way before comparing.
const boardWin = (m, win) => {
  const b = winOf(m, win)?.battle;
  if (!b) return { home: 0, away: 0 };
  return {
    home: r1(b.youTotal + (b.winner === 'you' ? b.bonus : 0)),
    away: r1(b.theirTotal + (b.winner === 'their' ? b.bonus : 0)),
  };
};
const slotFinal = (m, win, idx, side) => {
  const s = winOf(m, win)?.slots.find((x) => x.slotIndex === idx);
  return s ? r1(side === 'home' ? s.youFinal : s.theirFinal) : null;
};
const liveSlot = (r, win, idx, side) => {
  const s = r.slots.find((x) => x.win === win && x.slot === String(idx) && x.side === side);
  return s ? r1(s.score) : null;
};

// ── 1. A PLAIN MIXED BOARD: flats, drips, a nuke — no cross-slot effects ───
{
  const you = [['tnf', 0, 'qb-you', 'pass'], ['early', 0, 'wr-you', 'recyd'], ['early', 1, 'rb-you', 'rush']];
  const opp = [['tnf', 0, 'qb-opp', 'pass'], ['early', 0, 'wr-opp', 'recyd'], ['early', 1, 'rb-opp', 'rush']];
  const { m, r } = runBoth(you, opp);
  for (const [w, i] of [['tnf', 0], ['early', 0], ['early', 1]]) {
    ok(slotFinal(m, w, i, 'home') === liveSlot(r, w, i, 'home'),
      `s1 ${w}#${i} you: board ${slotFinal(m, w, i, 'home')} == published ${liveSlot(r, w, i, 'home')}`);
    ok(slotFinal(m, w, i, 'away') === liveSlot(r, w, i, 'away'),
      `s1 ${w}#${i} opp: board ${slotFinal(m, w, i, 'away')} == published ${liveSlot(r, w, i, 'away')}`);
  }
  for (const w of ['tnf', 'early']) {
    const b = boardWin(m, w), s = stateOf(r, w);
    ok(b.home === r1(s.home) && b.away === r1(s.away),
      `s1 window ${w}: board ${b.home}–${b.away} == published ${r1(s.home)}–${r1(s.away)} (bonus folded the same way)`);
  }
  ok(r1(m.youFinal) === r1(r.home) && r1(m.theirFinal) === r1(r.away),
    `s1 THE HEADLINE: board ${r1(m.youFinal)}–${r1(m.theirFinal)} == published ${r1(r.home)}–${r1(r.away)}`);
}

// ── 2. FIELD GENERAL: a cross-slot window multiplier, layered by both ──────
{
  const you = [['early', 0, 'wr-you', 'recyd'], ['early', 1, 'rb-you', 'rush'], ['tnf', 0, 'qb-you', 'fg']];
  const opp = [['early', 0, 'wr-opp', 'recyd'], ['early', 1, 'rb-opp', 'rush'], ['tnf', 0, 'qb-opp', 'pass']];
  // fg only multiplies its OWN window's other slots — put the QB alone in tnf
  // so the assertion is that both engines agree it therefore multiplies
  // nothing and scores 0 itself; then again WITH a same-window drip.
  const a = runBoth(you, opp);
  ok(slotFinal(a.m, 'tnf', 0, 'home') === 0 && liveSlot(a.r, 'tnf', 0, 'home') === 0,
    's2 a lone Field General banks 0 in both engines');
  const you2 = [['early', 0, 'wr-you', 'recyd'], ['early', 1, 'qb-you', 'fg'], ['early', 2, 'rb-you', 'rush']];
  const b = runBoth(you2, opp);
  ok(slotFinal(b.m, 'early', 0, 'home') === liveSlot(b.r, 'early', 0, 'home'),
    `s2 the fg-multiplied drip matches: board ${slotFinal(b.m, 'early', 0, 'home')} == published ${liveSlot(b.r, 'early', 0, 'home')}`);
  ok(r1(b.m.youFinal) === r1(b.r.home), `s2 totals with fg armed: ${r1(b.m.youFinal)} == ${r1(b.r.home)}`);
}

// ── 3. BEST-BALL BACKUPS: the unopposed player subs the same way ───────────
// wr2-you (snf) has no opponent; auto-maximize must pick the same starter in
// both engines. THE WEB BOARD ITSELF didn't auto-sub until v0.339.6 — its
// buildMatchup call omitted autoBackups while the worker always auto-subbed,
// so an unassigned backup scored 0 on the board and subbed in officially.
{
  const you = [['tnf', 0, 'qb-you', 'pass'], ['early', 0, 'wr-you', 'recyd'], ['snf', 0, 'wr2-you', 'recyd']];
  const opp = [['tnf', 0, 'qb-opp', 'pass'], ['early', 0, 'wr-opp', 'recyd']];
  const { m, r } = runBoth(you, opp);
  ok(r1(m.youFinal) === r1(r.home),
    `s3 totals with an auto-subbed backup: board ${r1(m.youFinal)} == published ${r1(r.home)}`);
  for (const w of ['tnf', 'early', 'snf']) {
    const bw = boardWin(m, w), s = stateOf(r, w);
    ok(bw.home === r1(s.home), `s3 window ${w} you: ${bw.home} == ${r1(s.home)}`);
  }
}

// ── 4. THE COIN ECONOMY: what the modal promises is what the wallet gets ───
// weekEarnings (the web's earnings modal) vs LiveResult.coin (what resolve.js
// banks into drip_wallet at final). "Kept in sync by hand" until v0.339.6,
// when writing THIS CHECK found the hand-sync broken twice: coinFor banked a
// week-1 stipend weekEarnings deliberately zeroes, and it never banked the
// turnover swing the modal shows (± coin per turnover, both directions).
{
  const you = [['tnf', 0, 'qb-you', 'pass'], ['early', 0, 'wr-you', 'recyd'], ['snf', 0, 'wr2-you', 'recyd']];
  const opp = [['tnf', 0, 'qb-opp', 'pass'], ['early', 0, 'wr-opp', 'recyd']];
  const { m, r } = runBoth(you, opp);
  const eYou = weekEarnings(m, 'you', WEEK);
  const eOpp = weekEarnings(m, 'their', WEEK);
  ok(Math.round(eYou.total) === Math.round(r.coin.home),
    `s4 your coin: modal ${Math.round(eYou.total)} == banked ${Math.round(r.coin.home)}`);
  ok(Math.round(eOpp.total) === Math.round(r.coin.away),
    `s4 their coin: modal ${Math.round(eOpp.total)} == banked ${Math.round(r.coin.away)}`);
}

// Week 1 zeroes the stipend on BOTH sides of the promise. The board's rule is
// deliberate (no phantom +50 before any play); the worker banked it anyway.
{
  const wk1 = weekEarnings(runBoth([['tnf', 0, 'qb-you', 'pass']], [['tnf', 0, 'qb-opp', 'pass']]).m, 'you', 1);
  ok(wk1.stipend === 0, 's4 week 1 has no stipend in the modal (the rule under test)');
  const picks = [['tnf', 0, 'qb-you', 'pass']], oppP = [['tnf', 0, 'qb-opp', 'pass']];
  const rW1 = resolveLiveMatchup(toLive(picks), toLive(oppP), 1);
  const rW9 = resolveLiveMatchup(toLive(picks), toLive(oppP), WEEK);
  ok(rW9.coin.home - rW1.coin.home === 50,
    's4 the worker banks the stipend every week EXCEPT week 1 — matching the modal');
}

// The turnover swing: your giveaway costs you, theirs pays you — the modal
// has always shown this and until v0.339.6 the wallet never moved for it.
{
  const you = [['early', 0, 'fum-you', 'rush']];
  const opp = [['early', 0, 'fum-opp', 'rush']];
  const { m, r } = runBoth(you, opp);
  const eYou = weekEarnings(m, 'you', WEEK);
  ok(eYou.turnover === 10, `s4 the modal's swing: 2 of theirs − 1 of yours = +10 (got ${eYou.turnover})`);
  ok(Math.round(eYou.total) === Math.round(r.coin.home),
    `s4 …and the wallet banks the same swing: modal ${Math.round(eYou.total)} == banked ${Math.round(r.coin.home)}`);
  ok(Math.round(weekEarnings(m, 'their', WEEK).total) === Math.round(r.coin.away),
    's4 the losing side of the swing matches too');
  // Turnover Boost triples the rate for the side that armed it — both books.
  const b = runBoth(you, opp, { buffs: { 'turnover-boost': true } });
  const eB = weekEarnings(b.m, 'you', WEEK, 25);
  ok(eB.turnover === 25, `s4 boosted swing at 25/turnover (got ${eB.turnover})`);
  ok(Math.round(eB.total) === Math.round(b.r.coin.home),
    `s4 the boosted wallet matches the boosted modal: ${Math.round(eB.total)} == ${Math.round(b.r.coin.home)}`);
}

// ── 5. WINDOW BONUS EDGE: a dead-even window pays NOBODY, in both ──────────
// Both engines gate the +5 on a >= 0.1 margin; if either drifted to > or to
// raw float compare, a tied window would pay one side in one place only.
{
  const you = [['tnf', 0, 'tie-you', 'pass']];
  const opp = [['tnf', 0, 'tie-opp', 'pass']]; // identical stat lines — a tie by construction
  const { m, r } = runBoth(you, opp);
  const b = winOf(m, 'tnf')?.battle, s = stateOf(r, 'tnf');
  ok(b?.winner === 'push' && b?.bonus === 0, 's5 the board calls a tied window a push');
  ok(r1(s.home) === r1(s.away), 's5 the published state pays neither side the bonus');
  ok(r1(m.youFinal) === r1(r.home), 's5 and the totals agree');
}

// ── 6. EVERYTHING AT ONCE: suppress + banker + TE nuke + backup + battle ───
// The layered board a real week produces: your DST suppress sets a halving
// bar over EVERY opposing slot in ANY window; your banker K's XPs pay +1 per
// TD you scored; their TE's TD nukes your same-window drips; your unopposed
// backup subs. Each effect is applied by both engines in different code and
// in a different ORDER-SENSITIVE pipeline — if the order ever drifts
// (suppress before vs after backups, banker before vs after suppress), the
// numbers split. This is the scenario that pins the ordering.
// Every slot head-to-head ON PURPOSE: a first cut of this scenario left the
// opponent's TE unopposed, and the best-ball rule (correctly, identically, in
// both engines) zeroed it into a backup that subbed for the away QB — so the
// nuke never fired and the scenario silently tested less than it claimed.
// Full H2H keeps every effect live where it was fielded.
{
  const you = [
    ['tnf', 0, 'qb-you', 'pass'],
    ['early', 0, 'wr-you', 'recyd'], ['early', 1, 'rb-you', 'td'],
    ['late', 0, 'te-you', 'recyd'], ['late', 1, 'wr2-you', 'recyd'],
    ['snf', 0, 'k-you', 'banker'],
    ['mnf', 0, 'dst-you', 'suppress'],
  ];
  const opp = [
    ['tnf', 0, 'qb-opp', 'pass'],
    ['early', 0, 'wr-opp', 'recyd'], ['early', 1, 'rb-opp', 'rush'],
    ['late', 0, 'rb2-opp', 'rush'], ['late', 1, 'te2-opp', 'td'], // the TE TD — nukes your late drips
    ['snf', 0, 'qb2-opp', 'pass'],
    ['mnf', 0, 'wr2-opp', 'recyd'],
  ];
  const { m, r } = runBoth(you, opp);
  // The TE really is a starter and really scored: 18 yds at 0.04 + a 12-pt TD
  // = 12.7, PLUS a quarter of the matched drip's bank its TD wiped (+1.3) —
  // the nuke's steal, which the first version of this assertion forgot and
  // the engine correctly refused to. If this reads 0 the scenario has
  // collapsed back into the backup shape and the nuke coverage is vacuous.
  ok(liveSlot(r, 'late', 1, 'away') === 14,
    `s6 the nuking TE scored as a starter, steal included (14, got ${liveSlot(r, 'late', 1, 'away')})`);
  for (const [w, i, side] of [
    ['tnf', 0, 'home'], ['tnf', 0, 'away'],
    ['early', 0, 'home'], ['early', 0, 'away'], ['early', 1, 'home'], ['early', 1, 'away'],
    ['late', 0, 'home'], ['late', 0, 'away'], ['late', 1, 'home'], ['late', 1, 'away'],
    ['snf', 0, 'home'], ['snf', 0, 'away'], ['mnf', 0, 'home'], ['mnf', 0, 'away'],
  ]) {
    ok(slotFinal(m, w, i, side) === liveSlot(r, w, i, side),
      `s6 ${w}#${i} ${side}: board ${slotFinal(m, w, i, side)} == published ${liveSlot(r, w, i, side)}`);
  }
  for (const w of ['tnf', 'early', 'late', 'snf', 'mnf']) {
    const b = boardWin(m, w), st = stateOf(r, w);
    ok(b.home === r1(st.home) && b.away === r1(st.away),
      `s6 window ${w}: board ${b.home}–${b.away} == published ${r1(st.home)}–${r1(st.away)}`);
  }
  ok(r1(m.youFinal) === r1(r.home) && r1(m.theirFinal) === r1(r.away),
    `s6 THE FULLY LAYERED HEADLINE: board ${r1(m.youFinal)}–${r1(m.theirFinal)} == published ${r1(r.home)}–${r1(r.away)}`);
  ok(Math.round(weekEarnings(m, 'you', WEEK).total) === Math.round(r.coin.home)
    && Math.round(weekEarnings(m, 'their', WEEK).total) === Math.round(r.coin.away),
    's6 and the coin books balance under the full stack');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL ENGINE-PARITY ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
