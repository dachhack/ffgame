// Automated playtester — STEP 1: the minimal headless harness.
//
// Runs many seeded HONEST-FIELD matchups (both sides field the shipping AI's real
// loadout — no hindsight) over one or more baked weeks and reports the baseline
// meta: score/margin/coin distributions, home win-rate (a sanity ~50%), and the
// biggest single-slot + total-score blowups. This is the field the aggregator and
// adversary measure against.
//
//   npx tsx tools/playtester/harness.mjs --week=1 --n=20 --list   # per-matchup lines
//   npx tsx tools/playtester/harness.mjs --week=1 --n=500         # week summary
//   npx tsx tools/playtester/harness.mjs --week=1-14 --n=300      # full sweep
//
// Flags: --week (1 | 1-14 | 1,3,5)  --n (matchups/week)  --seed  --list
import { rng, useWeek, honestMatch, parseWeeks, mean, pct, fmt } from './lib.mjs';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 200);
const seed = Number(flags.seed ?? 12345);

console.log(`\nHONEST FIELD — ${N} matchups/week · weeks ${weeks.join(',')} · seed ${seed}\n`);

const all = [];
for (const week of weeks) {
  useWeek(week);
  const rand = rng(seed + week * 7919);
  const ms = [];
  for (let i = 0; i < N; i++) ms.push(honestMatch(rand, week, `w${week}:${i}`));
  all.push(...ms.map((m) => ({ ...m, week })));

  if (flags.list) {
    for (const m of ms.slice(0, 30)) {
      console.log(`  w${week} ${fmt(m.home)} – ${fmt(m.away)}  (${m.winner})  coin ${m.coin.home}/${m.coin.away}  topSlot ${fmt(m.topSlot)}`);
    }
  }

  const scores = ms.flatMap((m) => [m.home, m.away]);
  const coins = ms.flatMap((m) => [m.coin.home, m.coin.away]);
  const margins = ms.map((m) => Math.abs(m.margin));
  const homeWR = ms.filter((m) => m.winner === 'home').length / ms.length;
  const ties = ms.filter((m) => m.winner === 'tie').length;
  const top = ms.reduce((a, b) => (b.topSlot > a.topSlot ? b : a));
  const bigBlow = ms.reduce((a, b) => (b.blowup > a.blowup ? b : a));

  console.log(`Week ${String(week).padStart(2)} · n=${ms.length}`);
  console.log(`  score   mean ${fmt(mean(scores))}  p50 ${fmt(pct(scores, 50))}  p95 ${fmt(pct(scores, 95))}  max ${fmt(pct(scores, 100))}`);
  console.log(`  margin  mean ${fmt(mean(margins))}  p95 ${fmt(pct(margins, 95))}  max ${fmt(pct(margins, 100))}`);
  console.log(`  coin    mean ${fmt(mean(coins))}  p50 ${fmt(pct(coins, 50))}  p95 ${fmt(pct(coins, 95))}  max ${fmt(pct(coins, 100))}`);
  console.log(`  home win-rate ${fmt(homeWR * 100)}%  (ties ${ties})   biggest slot ${fmt(top.topSlot)} [${top.topSlotInfo?.metric}]   biggest team total ${fmt(bigBlow.blowup)}`);
  console.log('');
}

if (weeks.length > 1) {
  const scores = all.flatMap((m) => [m.home, m.away]);
  const coins = all.flatMap((m) => [m.coin.home, m.coin.away]);
  const homeWR = all.filter((m) => m.winner === 'home').length / all.length;
  console.log('── ALL WEEKS ──');
  console.log(`  n=${all.length}  score mean ${fmt(mean(scores))} p95 ${fmt(pct(scores, 95))} max ${fmt(pct(scores, 100))}`);
  console.log(`  coin mean ${fmt(mean(coins))} p95 ${fmt(pct(coins, 95))} max ${fmt(pct(coins, 100))}   home WR ${fmt(homeWR * 100)}%`);
}
