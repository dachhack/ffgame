// Automated playtester — FIRST-BUY VARIETY probe.
//
// The season meta says everyone's first purchase is "an amplifier" (§12-§14).
// This probe asks whether that's true DOMINANCE or a missed conditioning
// opportunity: with ONE purchase allowed (the realistic week-1 wallet), which
// buy maximizes margin lift on the SAME paired matchup — and can a BLIND,
// roster-aware rule (buy Combo Drip when you actually roster a dual-threat,
// Air Raid when you roster an elite QB) beat always-buying-the-amp?
//
// The resolver is deterministic, so each candidate's per-matchup lift is exact.
// The ORACLE (argmax per matchup, hindsight) is the variety upper bound; the
// rule rows are what a blind manager/AI can actually capture.
//
//   npx tsx tools/playtester/firstbuy.mjs --week=1-14 --n=100
import { rng, useWeek, drawRoster, buildMatchup, resolve, slugMeta, powerupById, parseWeeks, mean, fmt } from './lib.mjs';
import { wantsComboDrip } from '../../src/data/aiLineup.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week ?? '1-14');
const N = Number(flags.n ?? 100);
const seed = Number(flags.seed ?? 24601);
const price = (id) => powerupById(id)?.price ?? 0;

// Best dual-threat on the roster (Combo Drip's target), by projection.
function bestCombo(roster, c) {
  let best = null;
  for (const s of roster) {
    const pos = slugMeta(s).pos;
    if (!wantsComboDrip(s, pos)) continue;
    if (!best || (c.proj.get(s) || 0) > (c.proj.get(best) || 0)) best = s;
  }
  return best;
}
const qbOf = (roster) => roster.find((s) => slugMeta(s).pos === 'QB');

// Candidate one-buy treatments. build → {load:{owned,extra,metricOverride}, buffs} or null if N/A.
const CANDIDATES = [
  { id: 'momentum', cost: price('momentum'), build: () => ({ buffs: new Set(['momentum']) }) },
  { id: 'garbage-time', cost: price('garbage-time'), build: () => ({ buffs: new Set(['garbage-time']) }) },
  { id: 'overtime', cost: price('overtime'), build: () => ({ buffs: new Set(['overtime']) }) },
  { id: 'combo-drip', cost: price('unlock-combo-drip'), build: (r, c) => {
    const t = bestCombo(r, c);
    return t ? { load: { owned: new Set(['unlock-combo-drip']), metricOverride: (p) => (p.slug === t ? 'combodrip' : null) } } : null;
  } },
  { id: 'air-raid', cost: price('unlock-pass-td10'), build: (r) => {
    const q = qbOf(r);
    return q ? { load: { owned: new Set(['unlock-pass-td10']), metricOverride: (p) => (p.slug === q ? 'passbig' : null) } } : null;
  } },
  { id: 'extra-slot', cost: price('extra-slot'), build: () => ({ load: { extra: 1 } }) },
  { id: 'no-buy', cost: 0, build: () => ({}) },
];

// Blind decision rules: pick(candidates-availability, features) → candidate id.
const QB_ELITE_RANK = 8; // "elite QB" = week's top-8 projected passers
const RULES = [
  { id: 'always-momentum', pick: () => 'momentum' },
  { id: 'always-garbage', pick: () => 'garbage-time' },
  { id: 'always-overtime', pick: () => 'overtime' },
  { id: 'always-combo', pick: (f) => (f.hasCombo ? 'combo-drip' : 'momentum') },
  { id: 'always-airraid', pick: () => 'air-raid' },
  { id: 'always-extra', pick: () => 'extra-slot' },
  { id: 'combo-if-dual', pick: (f) => (f.comboProj >= f.eliteComboBar ? 'combo-drip' : 'momentum') },
  { id: 'raid-if-eliteQB', pick: (f) => (f.qbElite ? 'air-raid' : 'momentum') },
  { id: 'roster-aware', pick: (f) => (f.comboProj >= f.eliteComboBar ? 'combo-drip' : f.qbElite ? 'air-raid' : 'momentum') },
];

const ruleStats = new Map(RULES.map((r) => [r.id, { lift: [], wins: 0, n: 0, hitOracle: 0, cost: [] }]));
const oracleStats = { lift: [], wins: 0, n: 0, shares: new Map() };

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 6151);
  // Week-level bars for the blind rules (observable pre-kickoff: projections).
  const qbSorted = [...c.pool.QB].map((s) => c.proj.get(s) || 0).sort((a, b) => b - a);
  const qbBar = qbSorted[QB_ELITE_RANK - 1] ?? Infinity;
  const comboAll = [];
  for (const pos of ['RB', 'WR', 'TE']) for (const s of c.pool[pos]) if (wantsComboDrip(s, pos)) comboAll.push(c.proj.get(s) || 0);
  comboAll.sort((a, b) => b - a);
  const eliteComboBar = comboAll[Math.max(0, Math.floor(comboAll.length * 0.25) - 1)] ?? Infinity; // top quartile of the week's dual-threats

  for (let i = 0; i < N; i++) {
    const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
    const ctrlPair = buildMatchup(hr, ar, week, {}, {});
    const ctrl = resolve(ctrlPair.homePicks, ctrlPair.awayPicks, week);

    // Deterministic per-candidate lift on this exact pairing.
    const lifts = new Map(), margins = new Map();
    for (const cand of CANDIDATES) {
      const t = cand.build(hr, c);
      if (!t) continue; // N/A on this roster (e.g. no dual-threat)
      if (cand.id === 'no-buy') { lifts.set(cand.id, 0); margins.set(cand.id, ctrl.margin); continue; }
      const { homePicks, awayPicks } = buildMatchup(hr, ar, week, t.load ?? {}, {});
      const r = resolve(homePicks, awayPicks, week, t.buffs ?? new Set(), new Set());
      lifts.set(cand.id, r.margin - ctrl.margin);
      margins.set(cand.id, r.margin);
    }

    // Blind features a manager can see before kickoff.
    const comboSlug = bestCombo(hr, c);
    const qb = qbOf(hr);
    const f = {
      hasCombo: !!comboSlug,
      comboProj: comboSlug ? (c.proj.get(comboSlug) || 0) : -Infinity,
      eliteComboBar,
      qbElite: qb ? (c.proj.get(qb) || 0) >= qbBar : false,
    };

    let oracleId = 'no-buy';
    for (const [id, l] of lifts) if (l > (lifts.get(oracleId) ?? 0) + 1e-9) oracleId = id;
    oracleStats.lift.push(lifts.get(oracleId)); oracleStats.n++;
    if (margins.get(oracleId) > 0) oracleStats.wins++;
    oracleStats.shares.set(oracleId, (oracleStats.shares.get(oracleId) || 0) + 1);

    for (const rule of RULES) {
      let id = rule.pick(f);
      if (!lifts.has(id)) id = 'momentum'; // fallback when the pick is N/A
      const st = ruleStats.get(rule.id);
      st.lift.push(lifts.get(id)); st.n++;
      if (margins.get(id) > 0) st.wins++;
      if (id === oracleId) st.hitOracle++;
      st.cost.push(CANDIDATES.find((x) => x.id === id).cost);
    }
  }
}

console.log(`\nFIRST-BUY VARIETY — one purchase vs stripped-honest field · ${N}/week · weeks ${weeks.join(',')} · seed ${seed}\n`);
console.log('rule'.padEnd(18) + 'avgCost'.padStart(8) + 'homeWR'.padStart(9) + 'meanLift'.padStart(10) + '=oracle'.padStart(9));
console.log('-'.repeat(56));
const rows = RULES.map((r) => { const s = ruleStats.get(r.id); return { id: r.id, cost: mean(s.cost), wr: s.wins / s.n * 100, lift: mean(s.lift), hit: s.hitOracle / s.n * 100 }; })
  .sort((a, b) => b.lift - a.lift);
for (const r of rows) console.log(r.id.padEnd(18) + fmt(r.cost, 0).padStart(8) + (fmt(r.wr) + '%').padStart(9) + ((r.lift >= 0 ? '+' : '') + fmt(r.lift)).padStart(10) + (fmt(r.hit, 0) + '%').padStart(9));
console.log('oracle (hindsight)'.padEnd(18) + '—'.padStart(8) + (fmt(oracleStats.wins / oracleStats.n * 100) + '%').padStart(9) + ('+' + fmt(mean(oracleStats.lift))).padStart(10) + '100%'.padStart(9));

console.log('\n── oracle pick shares (how often each buy is the per-matchup argmax) ──');
for (const [id, n] of [...oracleStats.shares.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${id.padEnd(14)} ${fmt(n / oracleStats.n * 100)}%`);
}
console.log('\nReading: if an always-amp rule ties the roster-aware rules and the oracle is');
console.log('mostly amps, the amp meta is real dominance. If roster-aware beats always-amp,');
console.log('the variety exists and the AI/UX should surface conditional buying.');
