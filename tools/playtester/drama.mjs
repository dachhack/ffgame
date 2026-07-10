// Automated playtester — DRAMA AUDIT: how often do dramatic moments actually fire?
//
// Balance work (findings §1–§9) proved the game is FAIR; this measures whether it
// is EXCITING. It runs seeded honest-field matchups (the exact shipping-AI loadout,
// same substrate as harness.mjs) with the resolver's raw per-slot event streams
// captured, and counts the beats a viewer would experience as drama:
//
//   • effect moments — TD nukes / shutdowns / carry wipes (bank-zeroing), TE-TD
//     drip nukes, counter-nuke reflections, erases, hot-streak ignitions, turnovers
//   • slot tension  — in-slot lead swaps, photo-finish slots, comebacks
//   • match narrative — lead changes across the merged week timeline, when the
//     LAST lead change lands (walk-off %), final-margin closeness
//
// Usage:
//   npx tsx tools/playtester/drama.mjs --week=1-14 --n=100            # honest baseline
//   npx tsx tools/playtester/drama.mjs --week=1-14 --n=100 --override=TE:td
//       (what-if: both sides arm the neutral-EV TE-TD nuke — the drama delta)
//
// Flags: --week --n --seed --override=POS:metric[,POS:metric] --list
//        --persona=both|home  (opt sides into the shipping NUKER persona draw;
//         --persona=home doubles as the neutrality check — home WR should stay ~50%)
//
// Caveat (documented, not hidden): match-narrative numbers are computed from the
// raw in-slot banks, which exclude the post-resolution best-ball backup subs /
// DEF-suppress halving / K-banker bonus. Final closeness uses the OFFICIAL totals.
import { rng, useWeek, drawRoster, aiLoadout, buildMatchup, parseWeeks, mean, pct, fmt, round } from './lib.mjs';
import { resolveLiveMatchup } from '../../server/src/engine.js';
import { WINDOWS } from '../../src/data/metrics.ts';
import { classifyEvent, wasCountered } from '../../src/engine/moments.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 100);
const seed = Number(flags.seed ?? 12345);

// --override=TE:td,WR:rec → force a metric per position, BOTH sides (symmetric,
// like the season sim — we're measuring the drama of a meta, not an exploit).
const overrides = new Map();
if (typeof flags.override === 'string') {
  for (const part of flags.override.split(',')) {
    const [pos, metric] = part.split(':');
    if (pos && metric) overrides.set(pos.toUpperCase(), metric);
  }
}
const metricOverride = overrides.size ? (_pick, pos) => overrides.get(pos) ?? null : null;
const persona = flags.persona === 'both' || flags.persona === 'home' ? flags.persona : null;

// ── Event classification — shared with the UI (src/engine/moments.ts) ───────
const KIND_KEY = { nuke: 'nukeWipe', tenuke: 'teDripNuke', shutdown: 'shutdown', carrywipe: 'carryWipe', erase: 'erase', hot: 'hotIgnite', turnover: 'turnover' };
const COUNTS = ['nukeWipe', 'teDripNuke', 'counterNuke', 'shutdown', 'carryWipe', 'erase', 'hotIgnite', 'turnover'];

const sign = (x) => (x > 1e-9 ? 1 : x < -1e-9 ? -1 : 0);

// ── One matchup → drama record ───────────────────────────────────────────────
function dramaMatch(rand, week, key) {
  const c = useWeek(week);
  const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
  const hl = aiLoadout(hr, `${key}:home`, week), al = aiLoadout(ar, `${key}:away`, week);
  const { homePicks, awayPicks } = buildMatchup(hr, ar, week,
    { owned: hl.owned, extra: hl.extra, metricOverride, persona: persona ? `${key}:home` : undefined },
    { owned: al.owned, extra: al.extra, metricOverride, persona: persona === 'both' ? `${key}:away` : undefined });
  useWeek(week);
  const res = resolveLiveMatchup(homePicks, awayPicks, week, { homeBuffs: hl.buffs, awayBuffs: al.buffs, captureEvents: true });

  const d = { week, sig: 0, biggestWipe: 0 };
  for (const k of COUNTS) d[k] = 0;

  // Effect moments + per-slot tension.
  let slotSwaps = 0, photoFinish = 0, contested = 0, maxSlotComeback = 0;
  for (const s of res.slotEvents) {
    let last = 0, swaps = 0, sawBoth = false, maxDefYou = 0, maxDefTheir = 0;
    let finalYou = 0, finalTheir = 0;
    for (const e of s.events) {
      if (e.sig) d.sig++;
      const c = classifyEvent(e);
      const kind = c ? KIND_KEY[c.kind] : null;
      if (kind && d[kind] !== undefined) d[kind]++;
      if (c && wasCountered(e)) d.counterNuke++;
      if (kind === 'nukeWipe' || kind === 'shutdown' || kind === 'carryWipe') d.biggestWipe = Math.max(d.biggestWipe, c.pts);
      const m = sign(e.youBank - e.theirBank);
      if (m !== 0 && last !== 0 && m !== last) swaps++;
      if (m !== 0) last = m;
      if (e.youBank > 0 && e.theirBank > 0) sawBoth = true;
      maxDefYou = Math.max(maxDefYou, e.theirBank - e.youBank);
      maxDefTheir = Math.max(maxDefTheir, e.youBank - e.theirBank);
      finalYou = e.youBank; finalTheir = e.theirBank;
    }
    if (!sawBoth) continue; // unopposed / empty pairing — no head-to-head tension
    contested++;
    slotSwaps += swaps;
    if (Math.abs(finalYou - finalTheir) <= 3) photoFinish++;
    const comeback = finalYou > finalTheir ? maxDefYou : finalTheir > finalYou ? maxDefTheir : 0;
    maxSlotComeback = Math.max(maxSlotComeback, comeback);
  }
  d.slotSwaps = slotSwaps; d.contested = contested;
  d.photoFinish = photoFinish; d.maxSlotComeback = round(maxSlotComeback);

  // Match narrative: merge each window's slot streams by clock, in slate order,
  // and walk the cumulative (raw-bank) score line.
  const winOrder = WINDOWS.map((w) => w.id);
  const byWin = new Map(winOrder.map((id) => [id, []]));
  for (const s of res.slotEvents) byWin.get(s.win)?.push(s);
  let baseH = 0, baseA = 0, lead = 0, leadChanges = 0, lastChangeAt = -1, maxDefH = 0, maxDefA = 0;
  const span = winOrder.filter((id) => byWin.get(id).length).length || 1;
  let wIdx = 0;
  for (const winId of winOrder) {
    const slots = byWin.get(winId);
    if (!slots.length) continue;
    const merged = slots
      .flatMap((s, i) => s.events.map((e) => ({ e, i })))
      .sort((a, b) => a.e.clock - b.e.clock);
    const curH = new Array(slots.length).fill(0), curA = new Array(slots.length).fill(0);
    const maxClock = merged.length ? merged[merged.length - 1].e.clock : 1;
    for (const { e, i } of merged) {
      curH[i] = e.youBank; curA[i] = e.theirBank;
      const h = baseH + curH.reduce((a, b) => a + b, 0);
      const a = baseA + curA.reduce((x, y) => x + y, 0);
      const m = sign(h - a);
      if (m !== 0 && lead !== 0 && m !== lead) { leadChanges++; lastChangeAt = (wIdx + e.clock / Math.max(1, maxClock)) / span; }
      if (m !== 0) lead = m;
      maxDefH = Math.max(maxDefH, a - h);
      maxDefA = Math.max(maxDefA, h - a);
    }
    baseH += curH.reduce((a, b) => a + b, 0);
    baseA += curA.reduce((x, y) => x + y, 0);
    wIdx++;
  }
  d.leadChanges = leadChanges;
  d.lastChangeAt = lastChangeAt; // fraction of the week (raw-bank line); −1 = wire-to-wire
  d.comebackWon = (baseH > baseA ? maxDefH : baseA > baseH ? maxDefA : 0);

  d.home = res.home; d.away = res.away;
  d.margin = round(Math.abs(res.home - res.away));
  return d;
}

// ── Run + report ─────────────────────────────────────────────────────────────
console.log(`\nDRAMA AUDIT — ${N} matchups/week · weeks ${weeks.join(',')} · seed ${seed}${overrides.size ? ` · override ${[...overrides].map(([p, m]) => `${p}:${m}`).join(',')}` : ''}${persona ? ` · persona:${persona}` : ''}${!overrides.size && !persona ? ' · honest field' : ''}\n`);

const all = [];
for (const week of weeks) {
  const rand = rng(seed + week * 7919);
  const ms = [];
  for (let i = 0; i < N; i++) ms.push(dramaMatch(rand, week, `w${week}:${i}`));
  all.push(...ms);
  if (flags.list) {
    for (const m of ms.slice(0, 12)) console.log(`  w${week} ${fmt(m.home)}–${fmt(m.away)}  leadChg ${m.leadChanges}  hot ${m.hotIgnite}  nukes ${m.nukeWipe + m.teDripNuke}  erase ${m.erase}  sig ${m.sig}`);
  }
}

function report(label, ms) {
  const per = (k) => mean(ms.map((m) => m[k]));
  const has = (k) => (100 * ms.filter((m) => m[k] > 0).length) / ms.length;
  console.log(`── ${label} · n=${ms.length} ──`);
  console.log(`  EFFECT MOMENTS (per matchup · % of matchups with ≥1)`);
  for (const k of COUNTS) console.log(`    ${k.padEnd(12)} ${fmt(per(k), 2).padStart(6)}   ${fmt(has(k), 0).padStart(3)}%`);
  console.log(`    biggest wipe seen: ${fmt(Math.max(...ms.map((m) => m.biggestWipe)))} pts · sig plays/matchup ${fmt(per('sig'), 1)}`);
  const zero = (100 * ms.filter((m) => m.sig === 0).length) / ms.length;
  console.log(`    matchups with ZERO signature plays: ${fmt(zero, 0)}%`);
  console.log(`  SLOT TENSION`);
  console.log(`    contested slots/matchup ${fmt(per('contested'), 1)} · in-slot lead swaps ${fmt(per('slotSwaps'), 1)} · photo-finish slots (≤3 pts) ${fmt(per('photoFinish'), 2)} (${fmt(has('photoFinish'), 0)}% ≥1)`);
  console.log(`  MATCH NARRATIVE (raw-bank line)`);
  const lc = ms.map((m) => m.leadChanges);
  const late = ms.filter((m) => m.lastChangeAt >= 0.8).length / ms.length;
  const wire = ms.filter((m) => m.leadChanges === 0).length / ms.length;
  console.log(`    lead changes  mean ${fmt(mean(lc), 1)}  p50 ${fmt(pct(lc, 50), 0)}  p95 ${fmt(pct(lc, 95), 0)}   wire-to-wire ${fmt(100 * wire, 0)}%   walk-off (last change in final 20%) ${fmt(100 * late, 0)}%`);
  console.log(`    winner overcame deficit  mean ${fmt(per('comebackWon'), 1)}  p95 ${fmt(pct(ms.map((m) => m.comebackWon), 95), 1)}`);
  const margins = ms.map((m) => m.margin);
  console.log(`    OFFICIAL final margin  mean ${fmt(mean(margins))}  ≤10 pts ${fmt((100 * margins.filter((x) => x <= 10).length) / ms.length, 0)}%  ≤5 pts ${fmt((100 * margins.filter((x) => x <= 5).length) / ms.length, 0)}%`);
  const homeWR = (100 * ms.filter((m) => m.home > m.away).length) / ms.length;
  console.log(`    home win-rate ${fmt(homeWR)}%${persona === 'home' ? '  ← neutrality check (persona on home only; expect ~50%)' : ''}`);
  console.log('');
}

if (weeks.length > 1) {
  for (const week of weeks) report(`WEEK ${week}`, all.filter((m) => m.week === week));
}
report('ALL WEEKS', all);
