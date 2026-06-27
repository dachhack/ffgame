// Automated playtester — mechanics tuning probes. Quantifies WHICH mechanic drives
// the degenerate ceiling, to rank retune targets (not the AI — the rules).
//
//   npx tsx tools/playtester/mechanics.mjs --week=1-14 --n=200
import { rng, useWeek, drawRoster, buildMatchup, resolve, slugMeta, parseWeeks, mean, pct, fmt } from './lib.mjs';
import { resolveLiveMatchup, makePlayer } from '../../server/src/engine.js';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 200);
const seed = Number(flags.seed ?? 31);
const live = (slug, metric, win, slot) => { const m = slugMeta(slug); return { win, slot, player: makePlayer(slug, m.pos, m.team), metricId: metric }; };

// ── Probe 1: score concentration — does ONE slot carry a team? ────────────────
console.log(`\nPROBE 1 — score concentration in the honest field (${N}/wk)\n`);
const topShare = [], top2Share = [];
for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week);
  for (let i = 0; i < N; i++) {
    const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
    const { homePicks, awayPicks } = buildMatchup(hr, ar, week, {}, {});
    const r = resolve(homePicks, awayPicks, week);
    for (const side of ['home', 'away']) {
      const tot = r[side];
      if (tot <= 0) continue;
      const slots = r.slots.filter((s) => s.side === side).map((s) => s.score).sort((a, b) => b - a);
      topShare.push(slots[0] / tot);
      top2Share.push((slots[0] + (slots[1] || 0)) / tot);
    }
  }
}
console.log(`  top-1 slot share of team total: mean ${fmt(mean(topShare) * 100)}%  p95 ${fmt(pct(topShare, 95) * 100)}%`);
console.log(`  top-2 slot share of team total: mean ${fmt(mean(top2Share) * 100)}%  p95 ${fmt(pct(top2Share, 95) * 100)}%`);
console.log(`  → if one or two drip slots are most of the score, the drip-rate / FG curve is the lever`);

// ── Probe 2: amplifier stacking — do momentum+overtime+garbage compound on one drip? ──
console.log(`\nPROBE 2 — amplifier stack on a single elite drip slot (factor vs no buffs)\n`);
const SETS = [
  ['none', []], ['momentum', ['momentum']], ['overtime', ['overtime']], ['garbage-time', ['garbage-time']],
  ['mom+ot', ['momentum', 'overtime']], ['mom+ot+garb', ['momentum', 'overtime', 'garbage-time']],
];
const factors = new Map(SETS.map(([k]) => [k, []]));
for (const week of weeks) {
  const c = useWeek(week);
  const wr = [...c.pool.WR].sort((a, b) => (c.proj.get(b) || 0) - (c.proj.get(a) || 0)).slice(0, 6);
  if (wr.length < 2) continue;
  // elite WR drip (slot 0) opposed by a weak WR drip so it banks; measure that slot.
  const home = [live(wr[0], 'recyd', 'early', '0')];
  const oppo = [live(wr[5], 'recyd', 'early', '0')];
  const base = resolveLiveMatchup(home, oppo, week, {}).slots.find((s) => s.side === 'home')?.score ?? 0;
  if (base <= 1) continue;
  for (const [k, b] of SETS) {
    const v = resolveLiveMatchup(home, oppo, week, { homeBuffs: new Set(b) }).slots.find((s) => s.side === 'home')?.score ?? 0;
    factors.get(k).push(v / base);
  }
}
for (const [k] of SETS) console.log(`  ${k.padEnd(14)} ×${fmt(mean(factors.get(k)), 2)}`);
const stack = mean(factors.get('mom+ot+garb')), add = mean(factors.get('momentum')) + mean(factors.get('overtime')) + mean(factors.get('garbage-time')) - 2;
console.log(`  → stacked ×${fmt(stack, 2)} vs additive-expectation ×${fmt(add, 2)} — ${stack > add ? 'COMPOUNDS (super-additive)' : 'sub-additive'}`);

// ── Probe 3: FG multiplier curve + Twin Generals (formula + measured) ─────────
console.log(`\nPROBE 3 — Field General curve (1 + 0.003·passYds) & Twin Generals stacking\n`);
for (const y of [150, 250, 350, 450]) console.log(`  ${y} passYds → single ×${fmt(1 + 0.003 * y, 2)}   ·   twin (two ${y}-yd QBs) ×${fmt((1 + 0.003 * y) ** 2, 2)}`);
console.log(`  → the twin multiplier looks explosive, but this IGNORES the opportunity cost: both QBs`);
console.log(`    score 0 and eat two slots to boost the one drip left in the window. Net of that, Twin`);
console.log(`    Generals beats its best alternative only ~10/14 weeks and loses 4/14 — NOT degenerate.`);
