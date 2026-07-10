// Automated playtester — LATE SWAP (per-window locks, v0.95.0). Windows now seal
// one at a time, so a manager picks each later window KNOWING the real score of
// the windows already played. Within a window both sides still lock at the same
// kickoff (and slate-gating partitions rosters by window), so the earlier
// reveals don't expose the opponent's same-window pick — the measurable edge is
// SCORE-STATE VARIANCE MANAGEMENT:
//   • gamble  — trailing by >T at a window's lock → flip that window's skill
//     players to the boom/bust TD nuke (lower EV, higher variance + denial).
//   • protect — leading by >T → flip them to denial (WR/TE targets-stop,
//     RB rate-reset) to smother the opponent's comeback variance.
// Paired A/B: same rosters/draws, home runs the policy vs home honest, away
// fixed honest. The cohort that matters is FIRED matchups (the policy actually
// changed something) and, sharper, the trailing/leading cohorts under CONTROL.
//
//   npx tsx tools/playtester/lateswap.mjs --week=1-14 --n=150
import { rng, useWeek, drawRoster, toLive, resolve, slugMeta, parseWeeks, mean, fmt } from './lib.mjs';
import { aiLineup } from '../../src/data/aiLineup.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 150);
const seed = Number(flags.seed ?? 909);

const ORDER = ['tnf', 'early', 'late', 'snf', 'mnf'];
const SKILL = new Set(['RB', 'WR', 'TE']);

/** True margin (home − away) over the windows already locked — what the live
 *  board shows at the next window's kickoff (earlier windows ~final by then). */
function partialMargin(homePicks, awayPicks, week, playedWins) {
  const h = homePicks.filter((p) => playedWins.has(p.win));
  const a = awayPicks.filter((p) => playedWins.has(p.win));
  if (!h.length && !a.length) return 0;
  return resolve(toLive(h), toLive(a), week).margin;
}

import { statsForSlug } from '../../src/data/players.ts';
const proj = (slug) => { const { pos } = slugMeta(slug); return statsForSlug(slug, pos).ppr; };

/** Sequentially re-pick each window at its lock, given the margin so far. */
function lateSwap(basePicks, awayPicks, week, T, mode) {
  const picks = basePicks.map((p) => ({ ...p }));
  let fired = false;
  for (let i = 1; i < ORDER.length; i++) {
    const played = new Set(ORDER.slice(0, i));
    const m = partialMargin(picks, awayPicks, week, played);
    const winSkill = picks.filter((p) => p.win === ORDER[i] && SKILL.has(slugMeta(p.slug).pos));
    if (!winSkill.length) continue;
    if (mode === 'gamble1' && m < -T) {
      // Minimal-EV-sacrifice gamble: only the WEAKEST skill player flips to td.
      const weakest = [...winSkill].sort((a, b) => proj(a.slug) - proj(b.slug))[0];
      if (weakest.metric !== 'td') { weakest.metric = 'td'; fired = true; }
      continue;
    }
    if (mode === 'hail' && ORDER[i] === 'mnf' && m < -T) {
      // Monday-night hail mary: nothing changes all weekend; if still down big
      // at the MNF lock, throw the last window at the nuke.
      for (const p of winSkill) if (p.metric !== 'td') { p.metric = 'td'; fired = true; }
      continue;
    }
    for (const p of winSkill) {
      const pos = slugMeta(p.slug).pos;
      if ((mode === 'gamble' || mode === 'both') && m < -T && p.metric !== 'td') { p.metric = 'td'; fired = true; }
      else if ((mode === 'protect' || mode === 'both') && m > T) {
        const deny = pos === 'RB' ? 'rec' : 'tgt';
        if (p.metric !== deny) { p.metric = deny; fired = true; }
      }
    }
  }
  return { picks, fired };
}

const CONFIGS = [
  { key: 'gamble T=0', mode: 'gamble', T: 0 },
  { key: 'gamble T=15', mode: 'gamble', T: 15 },
  { key: 'gamble1 T=10', mode: 'gamble1', T: 10 },
  { key: 'hail T=20', mode: 'hail', T: 20 },
  { key: 'protect T=0', mode: 'protect', T: 0 },
  { key: 'protect T=15', mode: 'protect', T: 15 },
  { key: 'both T=10', mode: 'both', T: 10 },
];

console.log(`\nLATE SWAP — score-aware variance policy vs blind honest — weeks ${weeks.join(',')}, ${N}/wk\n`);
const agg = Object.fromEntries(CONFIGS.map((c) => [c.key, {
  n: 0, w: 0, t: 0, cw: 0, dT: [], dC: [], fired: 0,
  fw: 0, fcw: 0, fn: 0,           // fired-cohort: policy wins / control wins / n
  bw: 0, bcw: 0, bn: 0,           // behind-at-half cohort (control margin < 0 after 'early')
}]));

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 577);
  for (let i = 0; i < N; i++) {
    const Rh = drawRoster(rand, c, { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 });
    const Ra = drawRoster(rand, c, { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 });
    const base = aiLineup(Rh, week);
    const awayAi = aiLineup(Ra, week);
    const away = toLive(awayAi);
    const ctrl = resolve(toLive(base), away, week);
    const behindAtHalf = partialMargin(base, awayAi, week, new Set(['tnf', 'early'])) < 0;
    for (const cfg of CONFIGS) {
      const { picks, fired } = lateSwap(base, awayAi, week, cfg.T, cfg.mode);
      const r = fired ? resolve(toLive(picks), away, week) : ctrl;
      const a = agg[cfg.key];
      a.n++; a.dT.push(r.margin); a.dC.push(ctrl.margin);
      if (r.winner === 'home') a.w++; else if (r.winner === 'tie') a.t++;
      if (ctrl.winner === 'home') a.cw++;
      if (fired) { a.fired++; a.fn++; if (r.winner === 'home') a.fw++; if (ctrl.winner === 'home') a.fcw++; }
      if (behindAtHalf) { a.bn++; if (r.winner === 'home') a.bw++; if (ctrl.winner === 'home') a.bcw++; }
    }
  }
}

const pct = (x, n) => (n ? fmt((x / n) * 100) + '%' : '—');
console.log('policy'.padEnd(14) + 'WR'.padStart(8) + 'ctrlWR'.padStart(8) + 'mLift'.padStart(8) + 'fired'.padStart(8)
  + '  |  fired-cohort WR vs ctrl' + '  |  behind-at-half WR vs ctrl');
console.log('-'.repeat(104));
for (const cfg of CONFIGS) {
  const a = agg[cfg.key];
  const lift = mean(a.dT) - mean(a.dC);
  console.log(cfg.key.padEnd(14)
    + pct(a.w, a.n).padStart(8) + pct(a.cw, a.n).padStart(8)
    + ((lift >= 0 ? '+' : '') + fmt(lift)).padStart(8) + pct(a.fired, a.n).padStart(8)
    + `  |  ${pct(a.fw, a.fn)} vs ${pct(a.fcw, a.fn)} (n=${a.fn})`.padEnd(30)
    + `  |  ${pct(a.bw, a.bn)} vs ${pct(a.bcw, a.bn)} (n=${a.bn})`);
}
console.log(`\nReading: the fired-cohort and behind-at-half columns are the signal — does knowing
the live margin and re-picking later windows convert losses into wins (gamble) or
protect leads (protect)? Overall WR dilutes the effect with never-fired matchups.`);
