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
import { rng, useWeek, buildMatchup, resolve, slugMeta, powerupById, WALLET_SEED, EXTRA_SLOT_CAP, mean, fmt } from './lib.mjs';
import { aiLiveBuffs, wantsComboDrip } from '../../src/data/aiLineup.ts';

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

/** Blind budget pass with a CARRIED-OVER wallet (no per-week reseed). Mirrors
 *  server/src/lock.js:aiBudgetPass priority order: EV buffs → combo-drip → extra slots. */
function seasonBudget(wallet, roster, key, week) {
  let bal = wallet;
  const owned = new Set(), buffs = new Set();
  let extra = 0;
  const buy = (item) => { const p = powerupById(item)?.price ?? 9999; if (bal >= p) { bal -= p; return true; } return false; };
  const desired = [...aiLiveBuffs(key, week)];
  if (roster.some((s) => wantsComboDrip(s, slugMeta(s).pos))) desired.push('unlock-combo-drip');
  for (const item of desired) if (buy(item)) (item.startsWith('unlock-') ? owned : buffs).add(item);
  for (let i = 0; i < EXTRA_SLOT_CAP; i++) { if (buy('extra-slot')) extra++; else break; }
  return { owned, buffs, extra, wallet: bal };
}

// ── Run one season. skip = Set of team ids that buy NOTHING all year ('all' = none buy).
function runSeason(seed, skip = new Set()) {
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
      const l = seasonBudget(wallet[t], r, `${seed}:t${t}`, week);
      for (const b of [...l.buffs, ...l.owned]) buys[b] = (buys[b] || 0) + 1;
      if (l.extra) buys['extra-slot'] = (buys['extra-slot'] || 0) + l.extra;
      return l;
    });
    for (const [h, a] of sched[wi]) {
      wallet[h] = load[h].wallet; wallet[a] = load[a].wallet; // post-spend
      const { homePicks, awayPicks } = buildMatchup(rosters[h], rosters[a], week, load[h], load[a]);
      const r = resolve(homePicks, awayPicks, week, load[h].buffs, load[a].buffs);
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

for (let s = 0; s < SEASONS; s++) {
  const seed = baseSeed + s * 101;
  const A = runSeason(seed);                    // everyone buys (full logic)
  const C = runSeason(seed, 'all');             // nobody buys (lineups only)
  const B = runSeason(seed, new Set([0]));      // team 0 opts out, rest buy

  A.walletByWeek.forEach((v, i) => { walletTraj[i] += v / SEASONS; });
  homeWRsum += A.homeWR; scoreAll.push(...A.scores); coinAll.push(...A.coins);
  for (const [k, v] of Object.entries(A.buys)) buysTotal[k] = (buysTotal[k] || 0) + v;
  corrSum += pearson(A.wins, C.wins);
  strengthCorrSum += pearson(A.wins, A.strength);
  devWith += A.wins[0]; devWithout += B.wins[0]; devGames += W;
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
