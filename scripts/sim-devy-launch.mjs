// DEVY LAUNCH SIM (v0.578.0) — how fairly do new college players reach the
// devy market under each launch rule, by how often a manager checks the app?
//
//   RACE      today: a player is buyable the moment the sweep finds him; the
//             first manager who checks and wants him maxes and holds his right.
//   WIN-10    a sealed 48h launch window, orders capped at 10 shares, filled
//             together; the right then goes to the first to max afterwards.
//   WIN-LOT   a sealed window with full-size orders; teams that max at the
//             fill draw lots for the right (the one-time tie-break).
//
// Result (Oct 1 2026, 400 seasons): RACE hands grinders 15× a casual's share
// and WIN-10 barely moves it (12×) — the race just restarts at the close.
// WIN-LOT is near-fair, and a 72h window (Tue noon → Fri noon) brings casuals
// to 0.88× (96h: 0.93×). Shipped default: 72h weekly, 7-day catch-up, full
// orders with a lottery among simultaneous maxers.
//
// Each season: 20 in-season weeks with a few new players each, plus an
// offseason wave (freshmen, transfers) — raced through the summer under RACE,
// one 7-day catch-up window under the windows. 12 teams: 2 GRINDERS (check
// hourly), 4 REGULARS (twice a day), 6 CASUALS (every ~3 days). A manager who
// thinks a player is underpriced goes for him. Fair = 1.00× a team's share.
//   node scripts/sim-devy-launch.mjs [seasons=400]
const SEASONS = Number(process.argv[2] ?? 400);
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const gauss = () => { const u = Math.max(rnd(), 1e-9), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
const H = 3600, DAY = 24 * H, WEEK = 7 * DAY;

const CLASSES = [['GRINDER', 2, 1 * H], ['REGULAR', 4, 12 * H], ['CASUAL', 6, 72 * H]];
const teams = CLASSES.flatMap(([cls, n, every]) => Array.from({ length: n }, () => ({ cls, every })));

/** A manager's next look at the app at or after t (random phase, ±30% jitter). */
const nextCheck = (tm, t) => t + tm.every * (0.7 + 0.6 * rnd()) * rnd();

function player() {
  const v = Math.exp(gauss());                     // true value
  const price = Math.max(1, v * Math.exp(0.6 * gauss()) * 4);
  return { v, price };
}
/** Who wants him: a manager whose read of his value beats the price. */
const wants = (p) => teams.map(() => p.v * 4 * Math.exp(0.5 * gauss()) > p.price * 1.15);

/** First wanting manager to look after `t0` (only those whose look falls before `until`). */
function firstTo(want, t0, until = Infinity) {
  let best = -1, at = Infinity;
  teams.forEach((tm, i) => { if (!want[i]) return; const t = nextCheck(tm, t0); if (t < at && t < until) { at = t; best = i; } });
  return best;
}

function run(rule, winH = 48) {
  const got = new Array(teams.length).fill(0);
  let total = 0;
  for (let s = 0; s < SEASONS; s++) {
    // the season: weeks of a few new players; the offseason wave on top
    const batches = [];
    for (let w = 0; w < 20; w++) batches.push({ at: w * WEEK, n: 1 + Math.floor(rnd() * 4), window: winH * H, catchup: false });
    batches.push({ at: 20 * WEEK, n: 40, window: 7 * DAY, catchup: true, spread: 12 * WEEK });
    for (const b of batches) {
      for (let k = 0; k < b.n; k++) {
        const p = player(); const want = wants(p);
        if (!want.some(Boolean)) continue;
        total += p.v;
        let winner = -1;
        if (rule === 'RACE') {
          // he appears whenever the sweep finds him; first wanting look wins
          const appear = b.at + (b.spread ?? WEEK) * rnd();
          winner = firstTo(want, appear);
        } else {
          const close = b.at + b.window;
          const inWindow = want.map((w, i) => w && nextCheck(teams[i], b.at) < close);
          if (rule === 'WIN-10') {
            // nobody maxes at the fill; the first wanting look after it does
            winner = firstTo(inWindow.map((x, i) => x || want[i]), close);
          } else {
            const maxers = inWindow.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
            winner = maxers.length ? maxers[Math.floor(rnd() * maxers.length)] : firstTo(want, close);
          }
        }
        if (winner >= 0) got[winner] += p.v;
      }
    }
  }
  const out = {};
  for (const [cls, n] of CLASSES) {
    const share = teams.reduce((a, tm, i) => a + (tm.cls === cls ? got[i] : 0), 0) / total;
    out[cls] = share / (n / teams.length);
  }
  return out;
}

const rules = ['RACE', 'WIN-10', 'WIN-LOT'];
console.log(`devy launch sim — ${SEASONS} seasons, 12 teams (2 grinders, 4 regulars, 6 casuals)`);
console.log('rights value won, × a fair share (1.00 = fair)\n');
console.log('rule      GRINDER  REGULAR  CASUAL   grinder ÷ casual');
const line = (r, o) => console.log(`${r.padEnd(9)}`
  + ` ${o.GRINDER.toFixed(2).padStart(7)}  ${o.REGULAR.toFixed(2).padStart(7)}  ${o.CASUAL.toFixed(2).padStart(6)}   ${(o.GRINDER / o.CASUAL).toFixed(1).padStart(8)}×`);
for (const r of rules) line(r, run(r));
console.log('\nWIN-LOT by weekly window length (catch-up stays 7 days):');
for (const h of [24, 48, 72, 96, 168]) line(`${h}h`, run('WIN-LOT', h));
