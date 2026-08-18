// THE SEASON LOG — the player card's game-log data, baked (v0.285.0).
//
// The card used to read a player's season out of `live_play`, which holds only
// what the live pipeline has actually broadcast — one week, if the simulator
// has replayed one week. But the season itself is baked: public/pbp/wN.json is
// the real 2025 play-by-play, and live_play is downstream of it (see
// server/src/simulate.js: "baked wN.json → live_play rows"). So a game log
// reading live_play was asking the least complete of two copies of the same
// data.
//
// This re-pivots those week files from WEEK-major to PLAYER-major, which is the
// axis a card reads on: one player, every week. Same play objects, minus the
// two fields no scorer touches (`t` wall-clock, `pid` nflverse play id) and
// minus zero-valued flags, which is where the size goes:
//
//   14 week files      3.3 MB     (week-major, every field)
//   season.json        1.5 MB     (player-major, scoring fields only)
//   APK growth         1.2 MB     (measured: 18.8 MB → 20.1 MB, build 28800)
//
// That last number is NOT the 200 KB the file gzips to, and the difference is
// worth knowing before anyone tries to shrink it: Metro does not ship this as
// a zip-compressed asset — it inlines the JSON into index.android.bundle,
// which Hermes then compiles to bytecode. So the APK pays for bytecode, not
// for deflated JSON. Getting the 200 KB would mean expo-asset + a runtime file
// read, which is a dependency and an async hop to save a megabyte we have.
// The web, fetching it over HTTP, does get the ~200 KB for free.
//
// Explicit gzip is still the wrong call either way: it would need a
// decompressor in the bundle to undo what every HTTP server already does.
//
// Usage: node scripts/pbp/genSeasonLog.mjs
//   Reads public/pbp/w*.json (genRealPbp.mjs's output) and writes
//   public/pbp/season.json + apps/mobile/assets/pbp/season.json.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const pubDir = new URL('../../public/pbp/', here);
const nativeDir = new URL('../../apps/mobile/assets/pbp/', here);

// Fields a scorer or a statline actually reads. `c` (game-elapsed clock) stays
// because rawPlaysFrom sorts on it; `t` and `pid` are for real-time power-up
// gating and live-feed keying, neither of which a game log does.
const KEEP = ['td', 'ca', 'tg', 'to', 'fd', 'cp', 'ic', 'sk', 'rk', 'tt', 'hf', 'p6'];

const weeks = readdirSync(new URL(pubDir))
  .map((f) => /^w(\d+)\.json$/.exec(f))
  .filter(Boolean)
  .map((m) => Number(m[1]))
  .sort((a, b) => a - b);
if (!weeks.length) throw new Error('no public/pbp/wN.json files — run genRealPbp.mjs first');

const pbp = {};
let plays = 0;
for (const w of weeks) {
  const week = JSON.parse(readFileSync(new URL(`w${w}.json`, pubDir), 'utf8'));
  for (const [slug, ps] of Object.entries(week.pbp ?? {})) {
    const arr = ps.map((p) => {
      const o = { c: p.c, k: p.k, y: p.y };
      for (const f of KEEP) if (p[f]) o[f] = p[f];
      return o;
    });
    if (!arr.length) continue;
    (pbp[slug] ||= {})[w] = arr;
    plays += arr.length;
  }
}

const out = JSON.stringify({ v: 1, weeks, pbp });
mkdirSync(new URL(nativeDir), { recursive: true });
writeFileSync(new URL('season.json', pubDir), out);
writeFileSync(new URL('season.json', nativeDir), out);

const raw = weeks.reduce((n, w) => n + statSync(new URL(`w${w}.json`, pubDir)).size, 0);
console.log(`season log: ${Object.keys(pbp).length} players · ${plays} plays · weeks ${weeks.join(',')}`);
console.log(`  ${(raw / 1048576).toFixed(2)} MB of week files → ${(out.length / 1048576).toFixed(2)} MB`);
console.log('  wrote public/pbp/season.json + apps/mobile/assets/pbp/season.json');
