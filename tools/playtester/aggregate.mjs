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
import { makePlayer } from '../../server/src/engine.js';
import { windowsForWeek } from '../../src/data/nflSlate.ts';

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
function lowOf(roster, pos, c) {
  const cand = roster.filter((s) => slugMeta(s).pos === pos);
  return cand.sort((a, b) => (c.proj.get(a) || 0) - (c.proj.get(b) || 0))[0] ?? null;
}
const overridePos = (pos, metric) => (p, pp) => (pp === pos ? metric : null);
const overrideSlug = (slug, metric) => (p) => (p.slug === slug ? metric : null);

// ── Targeting helpers over BUILT lineups (for the extras levers) ──────────────
// All targeting is BLIND-legal: season projection + own lineup + the opponent's
// window pools — never the week's box score. The one concession: slot-targeted
// opponent plays (jinx / cold-snap / napalm) aim at the away side's top
// projected slot, i.e. scout-informed placement — an upper bound on the play.
const key = (p) => `${p.win}|${p.slot}`;
const projOf = (p, c) => c.proj.get(p.player.id) ?? 0;
const SKILL = new Set(['RB', 'WR', 'TE']);
function topPick(picks, c, filter = () => true) {
  let best = null, bp = -Infinity;
  for (const p of picks) { if (!filter(p)) continue; const v = projOf(p, c); if (v > bp) { bp = v; best = p; } }
  return best;
}
function lowPick(picks, c, filter = () => true) {
  let best = null, bp = Infinity;
  for (const p of picks) { if (!filter(p)) continue; const v = projOf(p, c); if (v < bp) { bp = v; best = p; } }
  return best;
}
/** The window id where `picks` fields the most players matching `filter`. */
function densestWindow(picks, filter = () => true) {
  const n = new Map();
  for (const p of picks) if (filter(p)) n.set(p.win, (n.get(p.win) ?? 0) + 1);
  let best = null, bc = 0;
  for (const [w, k] of n) if (k > bc) { best = w; bc = k; }
  return best;
}
/** First open home base slot — prefer one the away side fielded (contests an
 *  otherwise-unopposed slot), else any unfilled base window slot. Null = full. */
function emptyHomeSlot(homePicks, awayPicks, week) {
  const taken = new Set(homePicks.map(key));
  const awayAt = new Set(awayPicks.map(key));
  const open = [];
  for (const w of windowsForWeek(week)) for (let i = 0; i < w.slots; i++) {
    const k = `${w.id}|${i}`;
    if (!taken.has(k)) open.push(k);
  }
  return open.find((k) => awayAt.has(k)) ?? open[0] ?? null;
}
/** Home's best BENCHED slug (rostered, not fielded) — the Bye Steal stand-in:
 *  the flat fill scores its clamped projection, like a real bye stud would. */
function topBench(roster, homePicks, c) {
  const fielded = new Set(homePicks.map((p) => p.player.id));
  const bench = roster.filter((s) => !fielded.has(s));
  bench.sort((a, b) => (c.proj.get(b) || 0) - (c.proj.get(a) || 0));
  return bench[0] ?? null;
}

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
  // Amp bundles WITH capacity priced in (0063) — blind EV of running 2-3 amps.
  { id: 'amp-pair', cost: price('momentum') + price('garbage-time') + price('amp-2'),
    build: () => ({ buffs: new Set(['momentum', 'garbage-time', 'amp-2']) }) },
  { id: 'amp-trio', cost: price('momentum') + price('garbage-time') + price('overtime') + price('amp-2') + price('amp-3'),
    build: () => ({ buffs: new Set(['momentum', 'garbage-time', 'overtime', 'amp-2', 'amp-3']) }) },

  // Free metric choices (cost 0) — the suspect "is a default-overridable metric
  // dominant?" levers. NUKE wipes the matched opponent's bank; TE-TD also knocks
  // every opposing drip in the window by 1.0/min.
  { id: 'te-nuke-1', cost: 0, build: (r, c) => ({ metricOverride: overrideSlug(topOf(r, 'TE', c), 'td') }) },
  { id: 'te-nuke-all', cost: 0, build: () => ({ metricOverride: overridePos('TE', 'td') }) },
  { id: 'rb-nuke-all', cost: 0, build: () => ({ metricOverride: overridePos('RB', 'td') }) },
  { id: 'wr-nuke-all', cost: 0, build: () => ({ metricOverride: overridePos('WR', 'td') }) },
  // Single-flip nukes — the situational use a real (trailing) manager makes.
  // The -all levers above are torture tests; THESE carry the fair-discount target.
  { id: 'rb-nuke-1', cost: 0, build: (r, c) => ({ metricOverride: overrideSlug(topOf(r, 'RB', c), 'td') }) },
  { id: 'wr-nuke-1', cost: 0, build: (r, c) => ({ metricOverride: overrideSlug(topOf(r, 'WR', c), 'td') }) },
  // Denial levers — "does denial pay its opportunity cost?" (§10's protect
  // policy said no; the steal retune aims these at ~48-52%).
  { id: 'wr-erase-all', cost: 0, build: () => ({ metricOverride: overridePos('WR', 'rec') }) },
  { id: 'wr-stop-all', cost: 0, build: () => ({ metricOverride: overridePos('WR', 'tgt') }) },
  { id: 'rb-reset-all', cost: 0, build: () => ({ metricOverride: overridePos('RB', 'rec') }) },
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

  // ── New battle-layer metric picks (free) ────────────────────────────────────
  // Underdog: RB/WR comeback metric — ×1.5 on gains fired while trailing the
  // matched slot. A PAID UNLOCK since v0.128.0 (◎35) — the costs price that in.
  // -1 targets the top player; -all is the torture test.
  { id: 'wr-underdog-1', cost: price('unlock-underdog'), build: (r, c) => ({ metricOverride: overrideSlug(topOf(r, 'WR', c), 'underdog') }) },
  { id: 'rb-underdog-1', cost: price('unlock-underdog'), build: (r, c) => ({ metricOverride: overrideSlug(topOf(r, 'RB', c), 'underdog') }) },
  { id: 'wr-underdog-all', cost: price('unlock-underdog'), build: () => ({ metricOverride: overridePos('WR', 'underdog') }) },
  // The INTENDED use: the roster's weakest WR — the player who actually expects
  // to trail its head-to-head (the comeback boost is live most of the game).
  { id: 'wr-underdog-low', cost: price('unlock-underdog'), build: (r, c) => ({ metricOverride: overrideSlug(lowOf(r, 'WR', c), 'underdog') }) },
  // Field Marshal: DEF builds a window-wide shield vs opposing nukes/erases.
  { id: 'def-marshal', cost: 0, build: () => ({ metricOverride: overridePos('DEF', 'marshal') }) },

  // ── Targeted pre-kickoff bets (extras — resolved by the live engine) ────────
  // extras(homePicks, awayPicks, c, roster, week) → home-side LiveExtras or null
  // (null = the lever has no legal target this pairing; counted as a miss).
  { id: 'double-or-nothing', cost: price('double-or-nothing'),
    extras: (hp, ap, c) => { const t = topPick(hp, c, (p) => SKILL.has(p.player.pos)); return t ? { don: { win: t.win, slot: t.slot } } : null; } },
  { id: 'grudge', cost: price('grudge'),
    extras: (hp, ap, c) => { const t = topPick(hp, c, (p) => SKILL.has(p.player.pos)); return t ? { grudge: [key(t)] } : null; } },
  { id: 'lead-change', cost: price('lead-change'),
    extras: (hp, ap, c) => { const t = topPick(hp, c, (p) => SKILL.has(p.player.pos)); return t ? { leadChange: [key(t)] } : null; } },
  { id: 'rivalry', cost: price('rivalry'),
    extras: (hp) => { const w = densestWindow(hp); return w ? { rivalry: [w] } : null; } },
  { id: 'jinx', cost: price('jinx'),
    extras: (hp, ap, c) => { const t = topPick(ap, c, (p) => SKILL.has(p.player.pos)); return t ? { jinx: [key(t)] } : null; } },
  // Red Herring decoy: attach to home's LOWEST-projected WR — every away WR in
  // that window is capped to the decoy's total.
  { id: 'red-herring', cost: price('red-herring'),
    extras: (hp, ap, c) => { const t = lowPick(hp, c, (p) => p.player.pos === 'WR'); return t ? { redHerring: [key(t)] } : null; } },
  // Slot fills: Ghost banks a flat set 14 in an open slot; Bye Steal banks the
  // best benched player's clamped projection (the bye-stud stand-in).
  { id: 'ghost', cost: price('ghost'),
    extras: (hp, ap, c, r, week) => { const k = emptyHomeSlot(hp, ap, week); return k ? { ghost: [k] } : null; } },
  { id: 'bye-steal', cost: price('bye-steal'),
    extras: (hp, ap, c, r, week) => {
      const k = emptyHomeSlot(hp, ap, week); const slug = k ? topBench(r, hp, c) : null;
      if (!k || !slug) return null;
      const [win, slot] = k.split('|'); const m = slugMeta(slug);
      return { byeSteal: { win, slot, player: makePlayer(slug, m.pos, m.team), pts: Math.min(25, c.proj.get(slug) || 0) } };
    } },

  // ── Live tactical fires (extras) — HONEST fixed clocks, no hindsight ────────
  // Surge ×2 on own top drip slot from 20:00; Cold Snap freezes the away top
  // slot from 20:00; Napalm burns the away top drip from 10:00 (hot streaks
  // build early-mid game); Bunker armors own top slot from kickoff; EMP freezes
  // the away side's densest drip window from 15:00.
  { id: 'surge', cost: price('surge'),
    extras: (hp, ap, c) => { const t = topPick(hp, c, (p) => SKILL.has(p.player.pos)); return t ? { surge: { [key(t)]: 1200 } } : null; } },
  { id: 'cold-snap', cost: price('cold-snap'),
    extras: (hp, ap, c) => { const t = topPick(ap, c, (p) => SKILL.has(p.player.pos)); return t ? { coldSnap: { [key(t)]: 1200 } } : null; } },
  { id: 'napalm', cost: price('napalm'),
    extras: (hp, ap, c) => { const t = topPick(ap, c, (p) => SKILL.has(p.player.pos)); return t ? { napalm: { [key(t)]: 600 } } : null; } },
  { id: 'bunker', cost: price('bunker'),
    extras: (hp, ap, c) => { const t = topPick(hp, c, (p) => SKILL.has(p.player.pos)); return t ? { bunker: { [key(t)]: 0 } } : null; } },
  { id: 'emp', cost: price('emp'),
    extras: (hp, ap) => { const w = densestWindow(ap, (p) => SKILL.has(p.player.pos)); return w ? { emp: { [w]: 900 } } : null; } },
];

const levers = only ? LEVERS.filter((l) => only.has(l.id)) : LEVERS;

// ── Run the paired A/B ───────────────────────────────────────────────────────
console.log(`\nLEVER A/B vs HONEST FIELD — ${N} paired matchups/week · weeks ${weeks.join(',')} · seed ${seed}\n`);

const stats = new Map(levers.map((l) => [l.id, { wins: 0, ties: 0, n: 0, miss: 0, marginT: [], marginC: [], coin: [], coinC: [], topSlot: 0 }]));

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 7919);
  for (let i = 0; i < N; i++) {
    const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
    // Control: both sides stripped honest (no loadout). Symmetric builder.
    const ctrlPair = buildMatchup(hr, ar, week, {}, {});
    const ctrl = resolve(ctrlPair.homePicks, ctrlPair.awayPicks, week);
    for (const l of levers) {
      const st = stats.get(l.id);
      const t = l.build ? (l.build(hr, c) || {}) : {};
      // Home arms one lever; away stays stripped honest. Extra slots resolve
      // SYMMETRICALLY (away fields a bench player in any slot home creates).
      // Extras-only levers reuse the control lineups (identical picks — the
      // treatment is purely the targeted payload), saving a rebuild.
      const rebuilt = t.owned || t.extra || t.metricOverride;
      const { homePicks, awayPicks } = rebuilt
        ? buildMatchup(hr, ar, week, { owned: t.owned, extra: t.extra || 0, metricOverride: t.metricOverride }, {})
        : ctrlPair;
      let ex;
      if (l.extras) {
        ex = l.extras(homePicks, awayPicks, c, hr, week);
        if (!ex) { st.miss++; continue; } // no legal target this pairing
      }
      const r = resolve(homePicks, awayPicks, week, t.buffs ?? new Set(), new Set(), ex ? { home: ex } : undefined);
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
  const wr = s.n ? (s.wins / s.n) * 100 : 0;
  const marginLift = mean(s.marginT) - mean(s.marginC);
  const avgCoin = mean(s.coin);
  const perCoin = l.cost > 0 ? marginLift / (l.cost / 10) : null; // margin pts per 10 coin
  const applied = s.n + s.miss ? (s.n / (s.n + s.miss)) * 100 : 0; // % of pairings with a legal target
  return { id: l.id, cost: l.cost, wr, marginLift, avgCoin, perCoin, topSlot: s.topSlot, applied };
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
console.log('lever'.padEnd(18) + 'cost'.padStart(6) + 'homeWR'.padStart(9) + 'marginLift'.padStart(12) + 'avgCoin'.padStart(9) + 'pts/10c'.padStart(9) + 'maxSlot'.padStart(9) + 'apply%'.padStart(8) + '  flags');
console.log('-'.repeat(106));
for (const r of rows) {
  console.log(
    r.id.padEnd(18) +
    String(r.cost).padStart(6) +
    (fmt(r.wr) + '%').padStart(9) +
    (r.marginLift >= 0 ? '+' : '') + fmt(r.marginLift).padStart(r.marginLift >= 0 ? 11 : 12) +
    fmt(r.avgCoin).padStart(9) +
    (r.perCoin == null ? '—' : fmt(r.perCoin, 2)).padStart(9) +
    fmt(r.topSlot).padStart(9) +
    (fmt(r.applied, 0) + '%').padStart(8) +
    '  ' + flagFor(r),
  );
}
console.log('\nExtras levers are scored only on pairings with a legal target (apply%); ghost/bye-steal');
console.log('need an open home slot. jinx/cold-snap/napalm aim at the away top slot — a scout-informed');
console.log('UPPER BOUND on those plays. Still not modeled by the pure resolver: turnover-boost, spy,');
console.log('trick-play/hail-mary/pick-six triggers vs honest field, metric/player-swap, mulligan,');
console.log('and the clutch plays (conditional live offers — no LiveExtras surface yet).');
