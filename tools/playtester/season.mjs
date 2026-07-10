// Automated playtester — FULL-SEASON AI-vs-AI economy simulation.
//
// Models the real thing the single-week harness could not: a league of full-logic
// AI teams playing an entire season with a PERSISTENT, CARRIED-OVER drip-coin
// wallet (start = wallet_seed() = 100), the SAME blind budget logic on both sides,
// and SYMMETRIC extra slots. Coin earned each week (stipend + bounties + events) is
// banked into the wallet and spent next week — exactly as resolve.js credits it.
//
// It answers the questions the unilateral lever test can't:
//   • Does coin RUN AWAY over a season, or does the economy stay bounded?
//   • Do "overpowered" power-ups CANCEL OUT when both sides buy them? (standings vs
//     a no-power-up league — if outcomes barely move, the buys are a wash.)
//   • Are they a MANDATORY TAX? (one team opts out all season — does its win-rate
//     drop? if yes, every team is forced to buy them, which is its own balance smell.)
//
// Blind by construction: the AI reads only its OWN roster (aiLineup/aiBudgetPass are
// hindsight-free); it never sees the opponent's players, metrics, or buys.
//
//   npx tsx tools/playtester/season.mjs --teams=12 --weeks=14 --seasons=40
import { rng, useWeek, buildMatchup, resolve, slugMeta, powerupById, aiExtras, aiLoadout, WALLET_SEED, EXTRA_SLOT_CAP, mean, fmt } from './lib.mjs';
import { aiLiveBuffs, wantsComboDrip, AI_STACKS } from '../../src/data/aiLineup.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const M = Number(flags.teams ?? 12);
const W = Number(flags.weeks ?? 14);
const SEASONS = Number(flags.seasons ?? 40);
const baseSeed = Number(flags.seed ?? 7);
const WEEKS = Array.from({ length: W }, (_, i) => (i % 14) + 1); // cycle baked weeks 1..14
const ROSTER = { QB: 2, RB: 5, WR: 5, TE: 3, K: 1, DEF: 1 };     // 17-man roster

// ── Season-wide player pool (union of every baked week), drawn once per season ─
function seasonPool() {
  const pool = { QB: [], RB: [], WR: [], TE: [], K: [], DEF: [] }, proj = new Map(), seen = new Set();
  for (let w = 1; w <= 14; w++) {
    const c = useWeek(w);
    for (const pos of Object.keys(pool)) for (const s of c.pool[pos]) if (!seen.has(s)) { seen.add(s); pool[pos].push(s); proj.set(s, c.proj.get(s) || 0); }
  }
  return { pool, proj };
}

/** Snake-free random draft: shuffle each position pool (seeded) and deal round-robin
 *  so every player is uniquely owned and roster strength varies like a real league. */
function draftRosters(rand, pool, M) {
  const teams = Array.from({ length: M }, () => []);
  for (const [pos, n] of Object.entries(ROSTER)) {
    const arr = [...pool.pool[pos]];
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    let idx = 0;
    for (let k = 0; k < n; k++) for (let t = 0; t < M; t++) if (idx < arr.length) teams[t].push(arr[idx++]);
  }
  return teams;
}

/** Circle-method round robin, cycled to W weeks. weeks[w] = [[home,away],…]. */
function schedule(M, W) {
  const arr = [...Array(M).keys()], rounds = [];
  for (let r = 0; r < M - 1; r++) {
    const pairs = [];
    for (let i = 0; i < M / 2; i++) pairs.push([arr[i], arr[M - 1 - i]]);
    rounds.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  return Array.from({ length: W }, (_, w) => rounds[w % rounds.length]);
}

/** Blind budget pass with a CARRIED-OVER wallet (no per-week reseed) — thin
 *  wrapper over the SHARED aiLoadout mirror (lib.mjs ⇄ server/src/lock.js):
 *  first amp → RIVALRY → remaining amps → the conditional STACKS (§18, gated
 *  by `stacks`) → combo-drip → extra slots. `legacy: true` restores the
 *  pre-battle-play amps-only order for the retrain-validation probe. */
function seasonBudget(wallet, roster, key, week, legacy = false, stacks = AI_STACKS) {
  if (legacy) {
    let bal = wallet;
    const owned = new Set(), buffs = new Set();
    let extra = 0;
    const buy = (item) => { const p = powerupById(item)?.price ?? 9999; if (bal >= p) { bal -= p; return true; } return false; };
    const AMPS = new Set(['momentum', 'garbage-time', 'overtime']);
    const ampCap = () => 1 + (buffs.has('amp-2') ? 1 : 0) + (buffs.has('amp-2') && buffs.has('amp-3') ? 1 : 0);
    const desired = [...aiLiveBuffs(key, week)];
    if (roster.some((s) => wantsComboDrip(s, slugMeta(s).pos))) desired.push('unlock-combo-drip');
    for (const item of desired) {
      if (AMPS.has(item) && [...buffs].filter((b) => AMPS.has(b)).length >= ampCap()) {
        const need = buffs.has('amp-2') ? 'amp-3' : 'amp-2';
        if (bal < (powerupById(need)?.price ?? 9999) + (powerupById(item)?.price ?? 9999)) continue;
        buy(need); buffs.add(need);
      }
      if (buy(item)) (item.startsWith('unlock-') ? owned : buffs).add(item);
    }
    for (let i = 0; i < EXTRA_SLOT_CAP; i++) { if (buy('extra-slot')) extra++; else break; }
    return { owned, buffs, extra, targeted: {}, wallet: bal };
  }
  const l = aiLoadout(roster, key, week, wallet, stacks);
  const extrasFor = (ownPicks, oppPicks, wk) => aiExtras(l, ownPicks, wk);
  return { ...l, extrasFor };
}

// ── Saver policies (team-0 probes): buy NOTHING until the amp bundle fits the
// wallet, then splurge on the whole bundle at once; repeat. Tests whether
// hoarding toward a capacity stack beats the steady one-amp-a-week meta.
const SAVER_BUNDLES = {
  pair: ['momentum', 'garbage-time', 'amp-2'],                       // ◎185
  trio: ['momentum', 'garbage-time', 'overtime', 'amp-2', 'amp-3'],  // ◎305
};
function makeSaver(bundle) {
  const items = SAVER_BUNDLES[bundle];
  const total = items.reduce((n, id) => n + (powerupById(id)?.price ?? 9999), 0);
  const policy = (wallet) => {
    if (wallet < total) return { owned: new Set(), buffs: new Set(), extra: 0, wallet };
    policy.splurges++;
    return { owned: new Set(), buffs: new Set(items), extra: 0, wallet: wallet - total };
  };
  policy.splurges = 0;
  return policy;
}

// ── Air Raid policies (team-0 probes, §16): does the ◎40 reprice make it a
// viable SECOND buy? amp-then-raid buys the proven amp first and adds Air Raid
// when the wallet still covers it; raid-then-amp inverts the priority. The
// owned unlock flips the QB onto passbig via the load's metricOverride.
function makeRaid(order) {
  const policy = (wallet, roster, key, week) => {
    let bal = wallet;
    const buffs = new Set(), owned = new Set();
    const buy = (id) => { const p = powerupById(id)?.price ?? 9999; if (bal < p) return false; bal -= p; return true; };
    const amp = aiLiveBuffs(key, week)[0];
    for (const it of (order === 'raid-first' ? ['unlock-pass-td10', amp] : [amp, 'unlock-pass-td10'])) {
      if (buy(it)) (it.startsWith('unlock-') ? owned : buffs).add(it);
    }
    if (owned.has('unlock-pass-td10')) policy.raids++;
    return {
      owned, buffs, extra: 0, wallet: bal,
      metricOverride: owned.has('unlock-pass-td10') ? (p, pos) => (pos === 'QB' ? 'passbig' : null) : null,
    };
  };
  policy.raids = 0;
  return policy;
}

// ── Run one season. skip = Set of team ids that buy NOTHING all year ('all' = none buy).
// t0policy: optional (wallet, roster, key, week) → load override for team 0 (saver probes).
function runSeason(seed, skip = new Set(), t0policy = null) {
  const rand = rng(seed);
  const pool = seasonPool();
  const rosters = draftRosters(rand, pool, M);
  const sched = schedule(M, W);
  const wallet = Array(M).fill(WALLET_SEED);
  const wins = Array(M).fill(0), losses = Array(M).fill(0);
  const buys = {};
  const walletByWeek = [];
  let homeWins = 0, games = 0; const scores = [], coins = [];

  for (let wi = 0; wi < W; wi++) {
    const week = WEEKS[wi];
    useWeek(week);
    // Each team sets its blind loadout from its current wallet.
    const load = rosters.map((r, t) => {
      if (skip === 'all' || skip.has(t)) return { owned: new Set(), buffs: new Set(), extra: 0, wallet: wallet[t] };
      if (t === 0 && t0policy) return t0policy(wallet[0], r, `${seed}:t0`, week);
      const l = seasonBudget(wallet[t], r, `${seed}:t${t}`, week);
      for (const b of [...l.buffs, ...l.owned]) buys[b] = (buys[b] || 0) + 1;
      if (l.targeted?.rivalry) buys['rivalry'] = (buys['rivalry'] || 0) + 1;
      if (l.targeted?.ghost) buys['ghost'] = (buys['ghost'] || 0) + 1;
      if (l.targeted?.don) buys['double-or-nothing'] = (buys['double-or-nothing'] || 0) + 1;
      if (l.targeted?.herring) buys['red-herring'] = (buys['red-herring'] || 0) + 1;
      if (l.extra) buys['extra-slot'] = (buys['extra-slot'] || 0) + l.extra;
      return l;
    });
    for (const [h, a] of sched[wi]) {
      wallet[h] = load[h].wallet; wallet[a] = load[a].wallet; // post-spend
      const { homePicks, awayPicks } = buildMatchup(rosters[h], rosters[a], week, load[h], load[a]);
      // Targeted plays (rivalry / ghost / …): a load may carry an extrasFor hook
      // that reads the BUILT lineups (own side first) and returns LiveExtras —
      // both sides get theirs, so symmetric policies cancel like buffs do.
      const hx = load[h].extrasFor?.(homePicks, awayPicks, week);
      const ax = load[a].extrasFor?.(awayPicks, homePicks, week);
      const r = resolve(homePicks, awayPicks, week, load[h].buffs, load[a].buffs, hx || ax ? { home: hx, away: ax } : undefined);
      if (r.winner === 'home') { wins[h]++; losses[a]++; } else if (r.winner === 'away') { wins[a]++; losses[h]++; }
      wallet[h] += r.coin.home; wallet[a] += r.coin.away; // bank weekly earnings
      homeWins += r.winner === 'home' ? 1 : 0; games++;
      scores.push(r.home, r.away); coins.push(r.coin.home, r.coin.away);
    }
    walletByWeek.push(mean(wallet));
  }
  const strength = rosters.map((r) => r.reduce((n, s) => n + (pool.proj.get(s) || 0), 0));
  return { wins, losses, wallet, buys, walletByWeek, homeWR: homeWins / games, scores, coins, strength };
}

// ── Pearson correlation ──────────────────────────────────────────────────────
function pearson(x, y) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sx += dx * dx; sy += dy * dy; }
  return sxy / (Math.sqrt(sx * sy) || 1);
}

// ── Run the experiment ───────────────────────────────────────────────────────
console.log(`\nFULL-SEASON AI vs AI — ${M} teams · ${W} weeks · ${SEASONS} seasons · seed start ${WALLET_SEED} coin\n`);

const walletTraj = Array(W).fill(0);
let homeWRsum = 0, scoreAll = [], coinAll = [];
const buysTotal = {};
let corrSum = 0;           // standings correlation: full-budget vs no-budget league
let strengthCorrSum = 0;   // wins vs roster strength (sanity: sim rewards roster)
let devWith = 0, devWithout = 0, devGames = 0; // mandatory-tax probe (team 0)
let savPair = 0, savTrio = 0, savPairN = 0, savTrioN = 0; // saver probes (team 0)
let raidA = 0, raidB = 0, raidAN = 0, raidBN = 0;         // Air Raid reprice probes (team 0)
let legacyWins = 0;                                        // retrain probe: team 0 on the OLD (no battle-play) order
// §18 stack probes: team 0 turns ONE conditional stack on (rest of the field
// steady) — plus a full-stack arm. Buy counters show how often each fires.
const STACK_ARMS = ['raid', 'raidFirst', 'twinFg', 'don', 'herring', 'stackExtras', 'all'];
const stackWins = Object.fromEntries(STACK_ARMS.map((a) => [a, 0]));
const stackBuys = Object.fromEntries(STACK_ARMS.map((a) => [a, 0]));

for (let s = 0; s < SEASONS; s++) {
  const seed = baseSeed + s * 101;
  const A = runSeason(seed);                    // everyone buys (full logic)
  const C = runSeason(seed, 'all');             // nobody buys (lineups only)
  const B = runSeason(seed, new Set([0]));      // team 0 opts out, rest buy
  const pairPolicy = makeSaver('pair'), trioPolicy = makeSaver('trio');
  const D = runSeason(seed, new Set(), pairPolicy); // team 0 hoards for the pair bundle
  const E = runSeason(seed, new Set(), trioPolicy); // team 0 hoards for the full stack

  A.walletByWeek.forEach((v, i) => { walletTraj[i] += v / SEASONS; });
  homeWRsum += A.homeWR; scoreAll.push(...A.scores); coinAll.push(...A.coins);
  for (const [k, v] of Object.entries(A.buys)) buysTotal[k] = (buysTotal[k] || 0) + v;
  corrSum += pearson(A.wins, C.wins);
  strengthCorrSum += pearson(A.wins, A.strength);
  devWith += A.wins[0]; devWithout += B.wins[0]; devGames += W;
  savPair += D.wins[0]; savPairN += pairPolicy.splurges;
  savTrio += E.wins[0]; savTrioN += trioPolicy.splurges;
  const ampRaid = makeRaid('amp-first'), raidAmp = makeRaid('raid-first');
  const F = runSeason(seed, new Set(), ampRaid);   // team 0: amp, then Air Raid when it fits
  const G = runSeason(seed, new Set(), raidAmp);   // team 0: Air Raid first, amp when it fits
  raidA += F.wins[0]; raidAN += ampRaid.raids;
  raidB += G.wins[0]; raidBN += raidAmp.raids;
  // Retrain validation: team 0 keeps the LEGACY order (amps only, no battle
  // plays) while the field runs the retrained policy. If the retrain is real,
  // legacy team 0 should fall below the steady buyer's win-rate.
  const H = runSeason(seed, new Set(), (w, r, k, wk) => seasonBudget(w, r, k, wk, true));
  legacyWins += H.wins[0];
  // §18 stack probes: team 0 deviates with one stack on (or all of them).
  for (const arm of STACK_ARMS) {
    const OFF = { raid: false, raidFirst: false, twinFg: false, don: false, herring: false, stackExtras: false };
    const stacks = arm === 'all'
      ? { ...OFF, raid: true, twinFg: true, don: true, herring: true, stackExtras: true }
      : arm === 'raidFirst' ? { ...OFF, raid: true, raidFirst: true }
      : { ...OFF, [arm]: true };
    const policy = (w, r, k, wk) => {
      const l = seasonBudget(w, r, k, wk, false, stacks);
      if (l.owned.has('unlock-pass-td10')) stackBuys[arm]++;
      if (l.buffs.has('fg-stack')) stackBuys[arm]++;
      if (l.targeted?.don) stackBuys[arm]++;
      if (l.targeted?.herring) stackBuys[arm]++;
      if (arm === 'stackExtras' && l.preferWin && l.extra) stackBuys[arm]++;
      return l;
    };
    const S = runSeason(seed, new Set(), policy);
    stackWins[arm] += S.wins[0];
  }
}

console.log('── economy ──');
console.log(`  mean wallet by week: ${walletTraj.map((v) => fmt(v, 0)).join(' → ')}`);
console.log(`  → ${walletTraj[W - 1] > WALLET_SEED * 2 ? 'RUNS AWAY (unbounded accumulation)' : 'bounded (spend ≈ earn; coin stays scarce)'}`);
console.log(`  weekly coin/side: mean ${fmt(mean(coinAll))}  ·  team score: mean ${fmt(mean(scoreAll))}`);
console.log(`  home win-rate ${fmt(homeWRsum / SEASONS * 100)}%  (fairness sanity ~50%)`);

console.log('\n── power-up buys (per season, full-budget league) ──');
for (const [k, v] of Object.entries(buysTotal).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(20)} ${fmt(v / SEASONS, 1)} buys/season`);

console.log('\n── cancellation hypothesis ──');
console.log(`  standings correlation full-budget vs no-budget league: r=${fmt(corrSum / SEASONS, 2)}`);
console.log(`  (r→1 ⇒ buys barely move outcomes ⇒ symmetric power-ups CANCEL OUT)`);
console.log(`  sanity — wins vs roster strength: r=${fmt(strengthCorrSum / SEASONS, 2)} (sim rewards roster)`);

console.log('\n── mandatory-tax probe (team 0) ──');
const wWith = devWith / devGames * 100, wWithout = devWithout / devGames * 100;
console.log(`  team 0 win-rate — buying ${fmt(wWith)}%  vs  opting out ${fmt(wWithout)}%  (Δ ${fmt(wWith - wWithout)} pts)`);
console.log(`  ${wWith - wWithout >= 5 ? '⇒ power-ups are a MANDATORY TAX (opting out costs real win-rate)' : '⇒ opting out is ~free ⇒ power-ups are near-cosmetic to outcomes'}`);

console.log('\n── saver probe (team 0 hoards coin for an amp bundle, others steady) ──');
const wPair = savPair / devGames * 100, wTrio = savTrio / devGames * 100;
console.log(`  steady buyer ${fmt(wWith)}%  ·  opt-out ${fmt(wWithout)}%`);
console.log(`  saver-pair (◎185: momentum+garbage+2nd amp)      ${fmt(wPair)}%  (${fmt(savPairN / SEASONS, 1)} splurge weeks/season)`);
console.log(`  saver-trio (◎305: all three amps + capacity)     ${fmt(wTrio)}%  (${fmt(savTrioN / SEASONS, 1)} splurge weeks/season)`);
console.log(`  ${Math.max(wPair, wTrio) > wWith + 2 ? '⇒ HOARDING BEATS STEADY — capacity prices need a look' : '⇒ steady buying holds up — naked saving weeks cost more than the splurge returns'}`);

console.log('\n── Air Raid probe (team 0 also buys the repriced Air Raid, others steady) ──');
const wRaidA = raidA / devGames * 100, wRaidB = raidB / devGames * 100;
console.log(`  steady buyer (amp only)                          ${fmt(wWith)}%`);
console.log(`  amp-then-raid (Air Raid when wallet allows)      ${fmt(wRaidA)}%  (${fmt(raidAN / SEASONS, 1)} raid weeks/season)`);
console.log(`  raid-then-amp (Air Raid first, amp when it fits) ${fmt(wRaidB)}%  (${fmt(raidBN / SEASONS, 1)} raid weeks/season)`);

console.log('\n── retrain probe (team 0 on the LEGACY amps-only order vs the retrained field) ──');
const wLegacy = legacyWins / devGames * 100;
console.log(`  retrained buyer (amps + rivalry/ghost)           ${fmt(wWith)}%`);
console.log(`  legacy buyer (amps only, battle plays skipped)   ${fmt(wLegacy)}%  (Δ ${fmt(wWith - wLegacy)} pts)`);
console.log(`  ${wWith - wLegacy > 1 ? '⇒ the retrained battle-play order EARNS its coin at the table' : '⇒ battle plays wash out at the table — keep them optional, revisit prices'}`);

console.log('\n── §18 stack probes (team 0 turns ONE conditional stack on, field steady) ──');
console.log(`  steady buyer (no stacks)                         ${fmt(wWith)}%`);
const ARM_LABEL = {
  raid: 'raid stack (Air Raid when no FG deploys)     ',
  raidFirst: 'raid-FIRST stack (Air Raid before the amp)   ',
  twinFg: 'twin-FG stack (fg-stack, 2 QBs share window) ',
  don: 'don stack (surplus → DoN on its top slot)    ',
  herring: 'herring stack (surplus → cheap WR decoy)     ',
  stackExtras: 'extra-slot stack (extras → rivalry window)   ',
  all: 'FULL stack (raid+twinFg+don+herring+extras)  ',
};
for (const arm of STACK_ARMS) {
  const wr = stackWins[arm] / devGames * 100;
  console.log(`  ${ARM_LABEL[arm]} ${fmt(wr)}%  (Δ ${fmt(wr - wWith)} pts · ${fmt(stackBuys[arm] / SEASONS, 1)} fires/season)`);
}
