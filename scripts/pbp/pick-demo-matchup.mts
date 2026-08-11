// Pick the matchup the native demo replays (apps/mobile/src/screens/DemoBoard).
//
// The demo exists to show the board's moments — the reveal flip, the nuke burst,
// the hot glow — so it needs a week and a pairing that actually contains them.
// Most don't: of the 1,260 combinations this scans (14 baked weeks x every
// ordered pair of the 10 baked teams), the large majority resolve with no nuke
// at all, and plenty leave a whole window unfilled.
//
// Ranks by: nukes, then hot slots, then no empty windows, then closest finish.
// The current pick is week 8, Gone Fishing Phins vs Taco Time Titans — 2 nukes,
// a hot streak, every window filled, decided in the last one.
//
// RE-RUN THIS rather than guessing whenever public/pbp/*.json is regenerated:
// the pick is a property of the baked data, and regenerating it can silently
// turn the demo into five windows of nothing happening.
//
//   npx tsx scripts/pbp/pick-demo-matchup.mts
//
// Then copy the winning week into apps/mobile/assets/pbp/ and update WEEK /
// YOU_TEAM / OPP_TEAM in DemoBoard.tsx.

import { readFileSync } from 'node:fs';
import { resetToDemoLeague, getActiveLeague } from '../../packages/core/src/data/league';
import { installRealWeek } from '../../packages/core/src/data/realPbp';
import { defaultLineup, aiLineup, buildMatchup, liveCardFlags } from '../../packages/core/src/engine/matchup';

resetToDemoLeague();
const lg = getActiveLeague();
const ids = lg.teams.map(t => t.id);
const name = (id: string) => lg.teams.find(t => t.id === id)!.name;

const out: any[] = [];
for (let wk = 1; wk <= 14; wk++) {
  installRealWeek(wk, JSON.parse(readFileSync(new URL(`../../public/pbp/w${wk}.json`, import.meta.url), 'utf8')));
  for (let i = 0; i < ids.length; i++) for (let j = 0; j < ids.length; j++) {
    if (i === j) continue;
    const YOU = ids[i], OPP = ids[j];
    let r;
    try { r = buildMatchup(YOU, OPP, wk, defaultLineup(YOU, wk), aiLineup(OPP, YOU, wk), {}, {}, {}, {}, {}, true); }
    catch { continue; }
    if (!r.real) continue;
    const slots = r.windows.flatMap(w => w.slots);
    const nukes = slots.filter(s => liveCardFlags(s.events, 'you', 1e9).nuked || liveCardFlags(s.events, 'their', 1e9).nuked).length;
    const hots  = slots.filter(s => liveCardFlags(s.events, 'you', 1e9).hot   || liveCardFlags(s.events, 'their', 1e9).hot).length;
    const empty = r.windows.filter(w => w.slots.every(s => !s.you)).length;
    const margin = Math.abs(r.youFinal - r.theirFinal);
    out.push({ wk, YOU, OPP, nukes, hots, empty, margin, you: r.youFinal, them: r.theirFinal });
  }
}
// Want: a nuke, some heat, no empty windows, and a close game.
out.sort((a, b) => (b.nukes - a.nukes) || (b.hots - a.hots) || (a.empty - b.empty) || (a.margin - b.margin));
console.log('scanned', out.length, 'pairings');
for (const o of out.slice(0, 12))
  console.log(`wk${String(o.wk).padStart(2)} ${name(o.YOU).padEnd(24)} vs ${name(o.OPP).padEnd(24)} nukes=${o.nukes} hot=${o.hots} emptyWins=${o.empty} ${o.you.toFixed(1)}-${o.them.toFixed(1)} (${o.margin.toFixed(1)})`);
