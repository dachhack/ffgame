// Automated playtester — STEP 2: the lever aggregator (single-lever A/B).
//
// Measures each metric / power-up / loadout lever against the HONEST field with a
// PAIRED A/B: for every seeded matchup we resolve it twice over the SAME two
// rosters — a control (both sides stripped honest: no buffs, no unlocks, no extra
// slots) and a treatment (home arms exactly ONE lever, away still stripped honest).
// Pairing cancels roster luck, so the win-rate/margin delta is the lever's own
// effect. Stripped baseline → control home win-rate ≈ 50%, so >50% under treatment
// is the lever's edge. We report per lever: win-rate, margin lift, avg coin, biggest
// single-slot swing, coin cost, and lift-per-coin — and flag the outliers vs cost-peers.
//
//   npx tsx tools/playtester/aggregate.mjs --week=1-14 --n=120
//   npx tsx tools/playtester/aggregate.mjs --week=1 --n=300 --only=te-nuke-all,momentum
//
// Flags: --week  --n (paired matchups/week/lever)  --seed  --only=a,b,c
import { rng, useWeek, drawRoster, buildMatchup, resolve, slugMeta, powerupById, parseWeeks, mean, fmt } from './lib.mjs';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 120);
const seed = Number(flags.seed ?? 4242);
const only = flags.only ? new Set(String(flags.only).split(',')) : null;

const price = (id) => powerupById(id)?.price ?? 0;

// Pick the home roster's highest-projected slug of a position (for single-target
// metric levers — the player a human would actually point the metric at).
function topOf(roster, pos, c) {
  const cand = roster.filter((s) => slugMeta(s).pos === pos);
  return cand.sort((a, b) => (c.proj.get(b) || 0) - (c.proj.get(a) || 0))[0] ?? null;
}
const overridePos = (pos, metric) => (p, pp) => (pp === pos ? metric : null);
const overrideSlug = (slug, metric) => (p) => (p.slug === slug ? metric : null);

// ── Lever registry. build(homeRoster, c) → the home side's treatment ─────────
// { buffs?:Set, owned?:Set, extra?:int, metricOverride?:fn }. cost is coin spent.
const LEVERS = [
  // Engine-modeled in-slot buffs (price = the power-up's coin cost).
  { id: 'momentum', cost: price('momentum'), build: () => ({ buffs: new Set(['momentum']) }) },
  { id: 'garbage-time', cost: price('garbage-time'), build: () => ({ buffs: new Set(['garbage-time']) }) },
  { id: 'floodgates', cost: price('floodgates'), build: () => ({ buffs: new Set(['floodgates']) }) },
  { id: 'overtime', cost: price('overtime'), build: () => ({ buffs: new Set(['overtime']) }) },
  { id: 'ot-shield', cost: price('ot-shield'), build: () => ({ buffs: new Set(['ot-shield']) }) },
  { id: 'counter-nuke', cost: price('counter-nuke'), build: () => ({ buffs: new Set(['counter-nuke']) }) },
  { id: 'insurance', cost: price('insurance'), build: () => ({ buffs: new Set(['insurance']) }) },
  { id: 'carries-wipe', cost: price('unlock-carries-wipe'), build: () => ({ buffs: new Set(['unlock-carries-wipe']) }) },

  // Free metric choices (cost 0) — the suspect "is a default-overridable metric
  // dominant?" levers. NUKE wipes the matched opponent's bank; TE-TD also knocks
  // every opposing drip in the window by 1.0/min.
  { id: 'te-nuke-1', cost: 0, build: (r, c) => ({ metricOverride: overrideSlug(topOf(r, 'TE', c), 'td') }) },
  { id: 'te-nuke-all', cost: 0, build: () => ({ metricOverride: overridePos('TE', 'td') }) },
  { id: 'rb-nuke-all', cost: 0, build: () => ({ metricOverride: overridePos('RB', 'td') }) },
  { id: 'wr-nuke-all', cost: 0, build: () => ({ metricOverride: overridePos('WR', 'td') }) },
  { id: 'def-suppress', cost: 0, build: () => ({ metricOverride: overridePos('DEF', 'suppress') }) },
  { id: 'k-banker', cost: 0, build: () => ({ metricOverride: overridePos('K', 'banker') }) }, // already the default; sanity peer

  // Paid metric unlocks.
  { id: 'combo-drip', cost: price('unlock-combo-drip'),
    build: (r, c) => ({ owned: new Set(['unlock-combo-drip']), metricOverride: overrideSlug(topOf(r, 'RB', c), 'combodrip') }) },
  { id: 'air-raid', cost: price('unlock-pass-td10'),
    build: () => ({ owned: new Set(['unlock-pass-td10']), metricOverride: overridePos('QB', 'passbig') }) },

  // Coin/slot farming.
  { id: 'extra-slot-1', cost: price('extra-slot'), build: () => ({ extra: 1 }) },
  { id: 'extra-slot-2', cost: 2 * price('extra-slot'), build: () => ({ extra: 2 }) },
];

const levers = only ? LEVERS.filter((l) => only.has(l.id)) : LEVERS;

// ── Run the paired A/B ───────────────────────────────────────────────────────
console.log(`\nLEVER A/B vs HONEST FIELD — ${N} paired matchups/week · weeks ${weeks.join(',')} · seed ${seed}\n`);

const stats = new Map(levers.map((l) => [l.id, { wins: 0, ties: 0, n: 0, marginT: [], marginC: [], coin: [], coinC: [], topSlot: 0 }]));

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 7919);
  for (let i = 0; i < N; i++) {
    const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
    // Control: both sides stripped honest (no loadout). Symmetric builder.
    const ctrlPair = buildMatchup(hr, ar, week, {}, {});
    const ctrl = resolve(ctrlPair.homePicks, ctrlPair.awayPicks, week);
    for (const l of levers) {
      const t = l.build(hr, c) || {};
      // Home arms one lever; away stays stripped honest. Extra slots resolve
      // SYMMETRICALLY (away fields a bench player in any slot home creates).
      const { homePicks, awayPicks } = buildMatchup(hr, ar, week, { owned: t.owned, extra: t.extra || 0, metricOverride: t.metricOverride }, {});
      const r = resolve(homePicks, awayPicks, week, t.buffs ?? new Set(), new Set());
      const st = stats.get(l.id);
      st.n++;
      if (r.winner === 'home') st.wins++; else if (r.winner === 'tie') st.ties++;
      st.marginT.push(r.margin);
      st.marginC.push(ctrl.margin);
      st.coin.push(r.coin.home);
      st.coinC.push(ctrl.coin.home);
      if (r.topSlot > st.topSlot) st.topSlot = r.topSlot;
    }
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
const baseCoin = mean([...stats.values()][0].coinC); // stripped-honest home coin baseline
const rows = levers.map((l) => {
  const s = stats.get(l.id);
  const wr = (s.wins / s.n) * 100;
  const marginLift = mean(s.marginT) - mean(s.marginC);
  const avgCoin = mean(s.coin);
  const perCoin = l.cost > 0 ? marginLift / (l.cost / 10) : null; // margin pts per 10 coin
  return { id: l.id, cost: l.cost, wr, marginLift, avgCoin, perCoin, topSlot: s.topSlot };
}).sort((a, b) => b.wr - a.wr);

const flagFor = (r) => {
  const f = [];
  if (r.wr >= 60) f.push('DOMINANT');
  if (r.cost === 0 && r.wr >= 55) f.push('FREE+STRONG');
  if (r.cost > 0 && r.wr < 53 && Math.abs(r.marginLift) < 8) f.push('DEAD-vs-honest');
  if (r.avgCoin >= baseCoin * 1.4) f.push('COIN-RUNAWAY');
  if (r.cost > 0 && r.perCoin >= 1.2) f.push('CHEAP-EDGE');
  return f.join(' ');
};

console.log(`control home win-rate baseline ≈ 50% · stripped-honest home coin ≈ ${fmt(baseCoin)}\n`);
console.log('lever'.padEnd(16) + 'cost'.padStart(6) + 'homeWR'.padStart(9) + 'marginLift'.padStart(12) + 'avgCoin'.padStart(9) + 'pts/10c'.padStart(9) + 'maxSlot'.padStart(9) + '  flags');
console.log('-'.repeat(96));
for (const r of rows) {
  console.log(
    r.id.padEnd(16) +
    String(r.cost).padStart(6) +
    (fmt(r.wr) + '%').padStart(9) +
    (r.marginLift >= 0 ? '+' : '') + fmt(r.marginLift).padStart(r.marginLift >= 0 ? 11 : 12) +
    fmt(r.avgCoin).padStart(9) +
    (r.perCoin == null ? '—' : fmt(r.perCoin, 2)).padStart(9) +
    fmt(r.topSlot).padStart(9) +
    '  ' + flagFor(r),
  );
}
console.log('\nNot modeled by the pure resolver (no signal here): double-or-nothing, turnover-boost,');
console.log('spy, trick-play, hail-mary, pick-six, bye-steal, metric/player-swap, mulligan, emp.');
