// Automated playtester — STEP 3: the adversary (hindsight exploit oracle).
//
// A *tool*, not what ships. It plays a MIRROR roster against a fixed HONEST opponent
// (identical players + honest metrics + honest buffs → baseline margin is exactly 0,
// verified) and SEARCHES its own loadout WITH hindsight of the baked week to find the
// strongest line. Any margin it opens is a pure loadout exploit on identical material:
// it isolates "how much does honest play leave on the table, and to which lever?".
//
// Two readings per draw:
//   • FREE   — metrics only, 0 coin (both sides keep honest buffs). If reassigning
//              metrics with hindsight reliably beats honest, the metric DEFAULTS are
//              exploitable.
//   • PAID   — metrics + bought buffs + metric-unlocks within a coin budget. Surfaces
//              the cheap degenerate lines (FG/Twin-Generals, momentum+combodrip, …).
//
// Search = coordinate ascent on per-slot metric (captures FG/suppress/nuke interactions)
// + greedy buff add within budget + unlock-metric options priced into the tab.
//
//   npx tsx tools/playtester/adversary.mjs --week=1-14 --n=40 --budget=200
import { rng, useWeek, drawRoster, buildMatchup, resolve, aiLoadout, slugMeta, powerupById, parseWeeks, mean, fmt } from './lib.mjs';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 40);
const seed = Number(flags.seed ?? 2027);
const BUDGET = Number(flags.budget ?? 200);

// Legal metric choices the adversary searches per position. Free metrics cost 0;
// unlock-gated metrics add their unlock's price to the tab the first time used.
const FREE = {
  QB: ['fg', 'pass', 'rush'], RB: ['rush', 'carries', 'rec', 'td'],
  WR: ['recyd', 'rec', 'tgt', 'td'], TE: ['recyd', 'tgt', 'rec', 'td'],
  K: ['banker', 'neg'], DEF: ['suppress', 'earn'],
};
const UNLOCK_METRIC = { combodrip: 'unlock-combo-drip', retyd: 'unlock-return', passbig: 'unlock-pass-td10' };
const UNLOCK_FOR = { QB: ['passbig'], RB: ['combodrip', 'retyd'], WR: ['combodrip', 'retyd'], TE: ['combodrip', 'retyd'], K: [], DEF: [] };
// Engine-modeled buffs the adversary may arm, with coin price.
const BUFFS = ['overtime', 'garbage-time', 'momentum', 'floodgates', 'ot-shield', 'fg-stack', 'fg-dual', 'counter-nuke', 'insurance', 'unlock-carries-wipe'];
const price = (id) => powerupById(id)?.price ?? 0;

// Amp capacity (0063): a trial arming 2-3 amplifiers must bundle the Second/
// Third Amp unlocks or the engine caps it back to one — so the greedy step
// prices capacity into the candidate instead of letting the cap void the buy.
const AMPS = ['momentum', 'garbage-time', 'overtime'];
function withCapacity(set) {
  const t = new Set(set);
  const n = AMPS.filter((a) => t.has(a)).length;
  if (n >= 2) t.add('amp-2');
  if (n >= 3) t.add('amp-3');
  return t;
}

/** Coin the adversary spends BEYOND the honest loadout = unlocks it adds + buffs it
 *  arms that the honest AI didn't already buy. (Honest buys are matched for free, so
 *  cost reflects only the adversary's deviation — what the exploit actually costs.) */
function costOf(metrics, buffs, honest) {
  const unlocks = new Set();
  metrics.forEach((m) => { if (UNLOCK_METRIC[m]) unlocks.add(UNLOCK_METRIC[m]); });
  let c = 0;
  for (const u of unlocks) if (!honest.owned.has(u)) c += price(u);
  for (const b of buffs) if (!honest.buffs.has(b)) c += price(b);
  return c;
}

/** Search the adversary's best loadout vs the REAL shipping honest AI on a mirror
 *  roster. Both start from the honest AI's actual loadout (aiLoadout) → baseline margin
 *  is 0, so any margin the search opens is the exploit the oracle finds OVER the
 *  shipping AI. Re-running this before/after an AI change shows the exploit shrink. */
function searchLoadout(R, week, allowPaid) {
  const honest = aiLoadout(R, `adv:${week}`, week);      // the real shipping loadout (owned/buffs/extra)
  const { homePicks, awayPicks } = buildMatchup(R, R, week, honest, honest);
  const adv = homePicks.map((p) => ({ win: p.win, slot: p.slot, player: p.player, metricId: p.metricId }));
  const opp = awayPicks;
  const oppBuffs = honest.buffs;                          // opponent runs its honest buffs
  const pos = adv.map((p) => slugMeta(p.player.id).pos);
  const ev = (metrics, buffs) => resolve(adv.map((p, i) => ({ ...p, metricId: metrics[i] })), opp, week, buffs, oppBuffs).margin;

  let metrics = adv.map((p) => p.metricId);              // honest start
  let buffs = new Set(honest.buffs);                      // start matched to honest → baseline 0
  let best = ev(metrics, buffs);

  const ascend = (withUnlocks) => {
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < adv.length; i++) {
        const opts = [...(FREE[pos[i]] || [])];
        if (withUnlocks) for (const u of (UNLOCK_FOR[pos[i]] || [])) opts.push(u);
        for (const m of opts) {
          if (metrics[i] === m) continue;
          const trial = metrics.slice(); trial[i] = m;
          if (allowPaid && costOf(trial, buffs, honest) > BUDGET) continue;
          const v = ev(trial, buffs);
          if (v > best + 1e-6) { best = v; metrics = trial; }
        }
      }
    }
  };

  ascend(false);                                          // FREE: metric coordinate ascent, no spend
  const freeMargin = best, freeMetrics = metrics.slice();

  if (allowPaid) {
    ascend(true);                                         // allow unlock metrics now
    // Greedy buff add within budget.
    for (let it = 0; it < BUFFS.length; it++) {
      let pick = null, pickV = best;
      for (const b of BUFFS) {
        if (buffs.has(b)) continue;
        const trial = withCapacity(new Set([...buffs, b]));
        if (costOf(metrics, trial, honest) > BUDGET) continue;
        const v = ev(metrics, trial);
        if (v > pickV + 1e-6) { pickV = v; pick = trial; } // trial, not b — keeps the bundled capacity
      }
      if (!pick) break;
      buffs = pick; best = pickV;
    }
    ascend(true);                                         // re-tune metrics after buffs (FG-stack etc.)
  }

  // Describe the loadout deltas vs honest for lever tallying (only what the oracle
  // changed FROM the shipping AI: re-picked metrics + buffs it armed beyond honest).
  const deltas = [];
  for (let i = 0; i < adv.length; i++) if (metrics[i] !== adv[i].metricId) deltas.push(`${pos[i]}→${metrics[i]}`);
  for (const b of buffs) if (!honest.buffs.has(b)) deltas.push(`+${b}`);
  return { freeMargin, freeWin: freeMargin > 0, paidMargin: best, paidWin: best > 0, cost: costOf(metrics, buffs, honest), deltas };
}

// ── Run ──────────────────────────────────────────────────────────────────────
console.log(`\nADVERSARY (hindsight oracle) vs fixed HONEST mirror — ${N} draws/week · weeks ${weeks.join(',')} · budget ${BUDGET}\n`);

const freeMargins = [], paidMargins = [], costs = [];
let freeWins = 0, paidWins = 0, total = 0;
const leverFreq = new Map();
const topLines = [];

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 5237);
  for (let i = 0; i < N; i++) {
    const R = drawRoster(rand, c);
    const s = searchLoadout(R, week, true);
    total++;
    freeMargins.push(s.freeMargin); paidMargins.push(s.paidMargin); costs.push(s.cost);
    if (s.freeWin) freeWins++; if (s.paidWin) paidWins++;
    for (const d of s.deltas) leverFreq.set(d, (leverFreq.get(d) || 0) + 1);
    topLines.push({ week, margin: s.paidMargin, cost: s.cost, deltas: s.deltas });
  }
}

const winPct = (w) => fmt(w / total * 100);
console.log('── how exploitable is honest play? ──');
console.log(`  FREE  (metrics only, 0 coin):  win ${winPct(freeWins)}%   avg margin +${fmt(mean(freeMargins))}`);
console.log(`  PAID  (≤${BUDGET} coin):         win ${winPct(paidWins)}%   avg margin +${fmt(mean(paidMargins))}   avg cost ${fmt(mean(costs))}`);

console.log('\n── recurring exploit levers (share of draws the search adopts them) ──');
for (const [k, v] of [...leverFreq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${k.padEnd(20)} ${fmt(v / total * 100)}%`);
}

console.log('\n── top exploit lines (biggest margins on identical material) ──');
for (const t of topLines.sort((a, b) => b.margin - a.margin).slice(0, 8)) {
  console.log(`  w${t.week}  +${fmt(t.margin)}  (${t.cost} coin)  ${t.deltas.slice(0, 8).join(' ')}`);
}
