// Automated playtester — LIVE-FIRE TIMING SCHOOL (findings §19).
//
// The lever battery measured the live tacticals (surge / cold-snap / napalm)
// with DUMB fixed clocks. This driver asks the question a live manager actually
// faces: WHEN should you fire? Policies per play, paired against the same
// stripped-honest control matchup:
//   • fixed-600 / 1200 / 1800 — fire blind at 10:00 / 20:00 / 30:00 game clock.
//   • on-hot   — fire the moment the TARGET's drip first goes HOT (the real
//                signal a manager watches). HOLDS the coin when it never fires
//                (fires% shows how often the trigger appears).
//   • oracle   — hindsight ceiling: try every 600s grid clock, keep the best
//                final margin. No manager can play this; it bounds the skill.
// Hot moments are read from a STANDALONE resolveSlot of the target pairing —
// window-level cross-effects (TE nukes killing streaks) can shift the true
// in-matchup hot clock slightly; treat on-hot as a close approximation.
//
//   npx tsx tools/playtester/livefire.mjs --week=1-14 --n=80
import { rng, useWeek, drawRoster, buildMatchup, resolve, slugMeta, powerupById, parseWeeks, mean, fmt } from './lib.mjs';
import { resolveSlot, EMPTY_PLAYER } from '../../src/engine/sim.ts';

const flags = {};
for (const a of process.argv.slice(2)) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const weeks = parseWeeks(flags.week);
const N = Number(flags.n ?? 80);
const seed = Number(flags.seed ?? 1717);

const SKILL = new Set(['RB', 'WR', 'TE']);
const key = (p) => `${p.win}|${p.slot}`;
function topPick(picks, c) {
  let best = null, bp = -Infinity;
  for (const p of picks) { if (!SKILL.has(p.player.pos)) continue; const v = c.proj.get(p.player.id) ?? 0; if (v > bp) { bp = v; best = p; } }
  return best;
}
/** First clock at which `who`'s drip goes HOT in this slot pairing (standalone). */
function firstHot(you, them, week, who) {
  const r = resolveSlot(
    you ? { player: you.player, metricId: you.metricId } : { player: EMPTY_PLAYER, metricId: 'none' },
    them ? { player: them.player, metricId: them.metricId } : { player: EMPTY_PLAYER, metricId: 'none' },
    week, '');
  for (const e of r.events) {
    if (e.side !== who) continue;
    if ((e.effect?.type === 'streak' || e.drip) && (e.effect?.text ?? e.play ?? '').includes('HOT')) return e.clock;
  }
  return null;
}

// side: 'home' fires on its own slot (surge) or the away slot (cold-snap/napalm).
const PLAYS = [
  { id: 'surge', field: 'surge', targetSide: 'home', hotOf: 'you' },      // own top slot; trigger = OWN drip hot
  { id: 'cold-snap', field: 'coldSnap', targetSide: 'away', hotOf: 'their' }, // opp top slot; trigger = THEIR drip hot
  { id: 'napalm', field: 'napalm', targetSide: 'away', hotOf: 'their' },
];
const ORACLE_GRID = [0, 600, 1200, 1800, 2400, 3000];
// hot-else-1800 = the actionable manager rule: fire the moment the target goes
// hot; if nothing is hot by 30:00, fire anyway (never waste the buy).
const POLICIES = ['fixed-600', 'fixed-1200', 'fixed-1800', 'on-hot', 'hot-else-1800', 'oracle'];

console.log(`\nLIVE-FIRE TIMING — ${N} paired matchups/week · weeks ${weeks.join(',')} · seed ${seed}\n`);

const stats = new Map();
for (const p of PLAYS) for (const pol of POLICIES) stats.set(`${p.id}:${pol}`, { d: [], wins: 0, n: 0, fired: 0 });

for (const week of weeks) {
  const c = useWeek(week);
  const rand = rng(seed + week * 6007);
  for (let i = 0; i < N; i++) {
    const hr = drawRoster(rand, c), ar = drawRoster(rand, c);
    const { homePicks, awayPicks } = buildMatchup(hr, ar, week, {}, {});
    const ctrl = resolve(homePicks, awayPicks, week);
    const fireAt = (play, clock) => {
      const t = topPick(play.targetSide === 'home' ? homePicks : awayPicks, c);
      if (!t) return null;
      const r = resolve(homePicks, awayPicks, week, new Set(), new Set(), { home: { [play.field]: { [key(t)]: clock } } });
      return r;
    };
    for (const play of PLAYS) {
      const t = topPick(play.targetSide === 'home' ? homePicks : awayPicks, c);
      if (!t) continue;
      // the slot pairing at the target key (for the hot-trigger read)
      const hk = key(t);
      const you = homePicks.find((p) => key(p) === hk) ?? null;
      const them = awayPicks.find((p) => key(p) === hk) ?? null;
      for (const pol of POLICIES) {
        const st = stats.get(`${play.id}:${pol}`);
        st.n++;
        let r = null;
        if (pol.startsWith('fixed-')) { r = fireAt(play, Number(pol.slice(6))); if (r) st.fired++; }
        else if (pol === 'on-hot') {
          const hc = firstHot(you, them, week, play.hotOf);
          if (hc != null) { r = fireAt(play, hc); st.fired++; } // else HOLD (keep the coin)
        } else if (pol === 'hot-else-1800') {
          const hc = firstHot(you, them, week, play.hotOf);
          r = fireAt(play, hc ?? 1800); if (r) st.fired++;
        } else { // oracle
          let best = null;
          for (const g of ORACLE_GRID) { const rr = fireAt(play, g); if (rr && (!best || rr.margin > best.margin)) best = rr; }
          r = best; if (r) st.fired++;
        }
        const margin = r ? r.margin : ctrl.margin; // HOLD = control outcome
        st.d.push(margin - ctrl.margin);
        if (margin > 0) st.wins++;
      }
    }
  }
}

const price = (id) => powerupById(id)?.price ?? 0;
console.log('play · policy'.padEnd(24) + 'homeWR'.padStart(8) + 'marginLift'.padStart(12) + 'pts/10c'.padStart(9) + 'fired%'.padStart(8));
console.log('-'.repeat(64));
for (const play of PLAYS) {
  for (const pol of POLICIES) {
    const st = stats.get(`${play.id}:${pol}`);
    const lift = mean(st.d);
    const wr = st.n ? (st.wins / st.n) * 100 : 0;
    const perCoin = lift / (price(play.id) / 10);
    console.log(`${play.id} · ${pol}`.padEnd(24) + (fmt(wr) + '%').padStart(8) + ((lift >= 0 ? '+' : '') + fmt(lift)).padStart(12) + fmt(perCoin, 2).padStart(9) + (fmt(st.fired / st.n * 100, 0) + '%').padStart(8));
  }
  console.log('');
}
console.log('on-hot HOLDS the coin when the trigger never appears (fired% < 100). oracle is a');
console.log('hindsight ceiling — the gap between it and the best honest policy is the value a');
console.log('sharp live manager can chase with better timing.');
