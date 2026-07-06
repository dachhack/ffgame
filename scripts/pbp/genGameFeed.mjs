// Build-time generator: bakes per-GAME play-by-play feeds ("game feeds") for the
// field visual (FieldView) from ESPN's free summary endpoint — the same source
// the live poller uses, so replay and live render identically.
//
// Unlike public/pbp/wN.json (per-PLAYER fantasy plays), a game feed keeps every
// scrimmage play of a game with its field situation: down, distance, start/end
// yards-to-endzone, possession team, play text, score. That is exactly what a
// Sleeper/ESPN-style drive chart renders; none of it exists in the RealPlay
// contract, so it bakes to a parallel artifact and the engine never sees it.
//
// Output: public/gamefeed/wN.json = { games: { "AWAY@HOME": GamePlay[] },
//                                     teams: { ABBR: "AWAY@HOME" } }
// GamePlay = { c, t?, pid?, drv, tm, tm2?, dn, dist, yl, yl2, ty, txt, sc?, pen?, to?, hs, as }
//   c/t/pid   game-elapsed sec / real sec since first snap / play id — the same
//             semantics (and clockOf) as RealPlay, so the feed clock drives both.
//   drv       drive ordinal (0-based)
//   tm        possession team (nflverse abbr), dn/dist down & distance (dn 0 = ST/PAT)
//   yl / yl2  start / end yards-to-endzone. yl is from tm's perspective; yl2 is
//             from tm2's when possession flips on the play (punt, kickoff, INT),
//             else tm's — mirroring ESPN's start/end situation objects.
//   tm2       team in possession AFTER the play, only when it differs from tm
//   ty        ESPN play type text ("Pass Reception", "Punt", …)
//   txt       full play description
//   sc/pen/to scoring / penalty / turnover flags (1 or absent)
//   hs/as     home / away score after the play
//
// Usage: node scripts/pbp/genGameFeed.mjs [weeks]     (default 1-14)
//   weeks: "3" or "2-5". Summaries are cached in scripts/pbp/espn-cache/
//   (gitignored) so re-runs don't refetch.
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { gameToFeed } from '../espn/espnAdapter.mjs';

const here = new URL('.', import.meta.url);
const CACHE = new URL('espn-cache/', here);
const OUT = new URL('../../public/gamefeed/', here);
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

const arg = process.argv[2] || '1-14';
const [lo, hi] = arg.includes('-') ? arg.split('-').map(Number) : [Number(arg), Number(arg)];
const WEEKS = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

const SB = (w) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2025&seasontype=2&week=${w}`;
const SUM = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`;

async function getJson(url, cacheKey, tries = 4) {
  const file = new URL(`${cacheKey}.json`, CACHE);
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        const data = await r.json();
        writeFileSync(file, JSON.stringify(data));
        return data;
      }
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 1000 * (i + 1)));
  }
  throw new Error(`fetch failed: ${url}`);
}

for (const w of WEEKS) {
  const sb = await getJson(SB(w), `sb_w${w}`);
  const events = (sb.events ?? []).map((e) => e.id);
  const games = {}; const teams = {};
  for (const id of events) {
    const sum = await getJson(SUM(id), `sum_${id}`);
    const feed = gameToFeed(sum);
    if (!feed) { console.warn(`w${w} event ${id}: no drives, skipped`); continue; }
    const [key, [a, h], plays] = feed;
    games[key] = plays;
    teams[a] = key; teams[h] = key;
  }
  const out = new URL(`w${w}.json`, OUT);
  writeFileSync(out, JSON.stringify({ games, teams }));
  const n = Object.values(games).reduce((s, g) => s + g.length, 0);
  console.log(`w${w}: ${Object.keys(games).length} games, ${n} plays → public/gamefeed/w${w}.json`);
}
