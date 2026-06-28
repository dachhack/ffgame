// Automated playtester — targeted scenario probes for the handoff's "prime
// suspects". Separates "the mechanic is weak" from "the harness never triggered
// it" by measuring conditional effect (only when the trigger actually fires) and
// by hand-building best-case degenerate lines the random honest field rarely hits.
//
//   npx tsx tools/playtester/scenario.mjs --week=1-14 --n=200
import { rng, useWeek, drawRoster, buildSide, resolve, slugMeta, parseWeeks, fmt, mean } from './lib.mjs';
import { resolveLiveMatchup, makePlayer } from '../../server/src/engine.js';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 200);
const seed = Number(flags.seed ?? 99);
const live = (slug, metric, win, slot) => { const m = slugMeta(slug); return { win, slot, player: makePlayer(slug, m.pos, m.team), metricId: metric }; };

// ── Probe A: does a forced TE-TD nuke ever fire, and does it help when it does? ─
console.log(`\nPROBE A — TE-TD nuke: trigger rate + conditional win-rate (n≈${N}/wk)\n`);
let fired = 0, total = 0, wonFired = 0, wonAll = 0;
for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week);
  for (let i = 0; i < N; i++) {
    const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
    const te = hr.filter((s) => slugMeta(s).pos === 'TE').sort((a, b) => (c.proj.get(b) || 0) - (c.proj.get(a) || 0))[0];
    if (!te) continue;
    const awayPicks = buildSide(ar, week, {});
    const homeBase = buildSide(hr, week, {});
    const homeNuke = buildSide(hr, week, { metricOverride: (p) => (p.slug === te ? 'td' : null) });
    const base = resolve(homeBase, awayPicks, week);
    const nuke = resolve(homeNuke, awayPicks, week);
    // The TE-TD "fired" if forcing td changed the home total (nuke wiped a bank or
    // the TE banked its 8/TD differently than its drip would have).
    total++;
    if (Math.abs(nuke.home - base.home) > 0.05 || nuke.away !== base.away) { fired++; if (nuke.winner === 'home') wonFired++; }
    if (nuke.winner === 'home') wonAll++;
  }
}
console.log(`  fired ${fired}/${total} (${fmt(fired / total * 100)}%)   win-rate | fired ${fmt(wonFired / Math.max(1, fired) * 100)}%   overall ${fmt(wonAll / total * 100)}%`);

// ── Probe B: TE-TD cascade — a window stacked with TEs that each scored a TD,
//    vs a drip-heavy opponent in the same window. Hand-built best case. ─────────
console.log(`\nPROBE B — TE-TD cascade (best case): stacked TE-TDs vs a drip window\n`);
for (const week of weeks.slice(0, 6)) {
  const c = useWeek(week);
  // Find TEs that actually scored a TD this week (so the nuke + drip-knock fire).
  const tdTEs = c.pool.TE.filter((s) => (c.pbp[s] || []).some((p) => p.td && (p.k === 'rec' || p.k === 'receiving' || p.td > 0)));
  const drips = [...c.pool.WR].sort((a, b) => (c.proj.get(b) || 0) - (c.proj.get(a) || 0)).slice(0, 3);
  if (tdTEs.length < 2 || drips.length < 1) { console.log(`  w${week}: not enough TE-TDs (${tdTEs.length})`); continue; }
  // 'early' window has 3 slots — stack 2 TE-TDs + use slot 2 too. Opponent drips there.
  const home = [live(tdTEs[0], 'td', 'early', '0'), live(tdTEs[1], 'td', 'early', '1')];
  const away = [live(drips[0], 'recyd', 'early', '0'), live(drips[1], 'recyd', 'early', '1')];
  const r = resolve(home, away, week);
  console.log(`  w${week}: 2× TE-TD [${tdTEs[0].split('-')[0]}, ${tdTEs[1].split('-')[0]}] → home ${fmt(r.home)} vs away-drips ${fmt(r.away)}  (away wiped to ${fmt(r.away)})`);
}

// ── Probe C: Twin Generals (fg-stack) — two FG QBs in one window, mult×mult ───
console.log(`\nPROBE C — Twin Generals (fg-stack): two FG QBs vs the same drip window\n`);
for (const week of weeks.slice(0, 6)) {
  const c = useWeek(week);
  const qbs = [...c.pool.QB].sort((a, b) => ((c.pbp[b] || []).reduce((n, p) => n + (p.k === 'pass' ? p.y : 0), 0)) - ((c.pbp[a] || []).reduce((n, p) => n + (p.k === 'pass' ? p.y : 0), 0))).slice(0, 2);
  const wr = [...c.pool.WR].sort((a, b) => (c.proj.get(b) || 0) - (c.proj.get(a) || 0)).slice(0, 2);
  if (qbs.length < 2 || wr.length < 2) { console.log(`  w${week}: thin pool`); continue; }
  // Two FG QBs + a drip WR (slot 2), OPPOSED by a weak away drip so the FG-multiplied
  // drip actually banks (an unopposed slot is best-ball-zeroed). Measure the WR slot.
  const oppo = [live(wr[1], 'recyd', 'early', '2')];
  const single = resolve([live(qbs[0], 'fg', 'early', '0'), live(wr[0], 'recyd', 'early', '2')], oppo, week);
  const twin = resolveLiveMatchup([live(qbs[0], 'fg', 'early', '0'), live(qbs[1], 'fg', 'early', '1'), live(wr[0], 'recyd', 'early', '2')], oppo, week, { homeBuffs: new Set(['fg-stack']) });
  const sSlot = single.slots.find((s) => s.side === 'home' && s.slot === '2')?.score ?? 0;
  const tSlot = twin.slots.find((s) => s.side === 'home' && s.slot === '2')?.score ?? 0;
  console.log(`  w${week}: WR drip — 1 General → ${fmt(sSlot)}   ·   Twin Generals → ${fmt(tSlot)}   (${fmt(tSlot / Math.max(0.1, sSlot), 2)}×)`);
}

// ── Probe D: unilateral extra-slot coin farm — how much coin per extra slot ───
console.log(`\nPROBE D — unilateral extra-slot coin farm (avg home coin by extra count)\n`);
for (const extra of [0, 1, 2]) {
  const coins = [];
  for (const week of weeks) {
    const c = useWeek(week);
    const rand = rng(seed + week + extra * 1000);
    for (let i = 0; i < N; i++) {
      const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
      const r = resolve(buildSide(hr, week, { extra }), buildSide(ar, week, {}), week);
      coins.push(r.coin.home);
    }
  }
  console.log(`  extra=${extra}: avg home coin ${fmt(mean(coins))}`);
}
