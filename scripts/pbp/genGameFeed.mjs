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
import { clockOf, fixTeam } from '../espn/espnAdapter.mjs';

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

// Clock-management rows carry no field situation — the visual skips them.
const SKIP_TYPES = new Set([
  'Timeout', 'Official Timeout', 'Two-minute warning', 'End Period',
  'End of Half', 'End of Game', 'Coin Toss',
]);

// Yards-to-endzone for a situation, from the perspective of the team named in
// `abbrs` (the situation's own team). ESPN's numeric `yardsToEndzone` is flipped
// on a small share of plays (e.g. a 4th & 19 punt at "TEN 25" carrying yte 25
// instead of 75); `possessionText` ("TEN 25" / "50") matches the broadcast spot
// and is authoritative, so parse it first and fall back to the number.
function yteOf(sit, abbrs) {
  const yte = Number(sit?.yardsToEndzone ?? 0) || 0;
  const pt = String(sit?.possessionText ?? '').trim();
  if (pt === '50') return 50;
  const m = /^([A-Z]{2,4})\s+(\d{1,2})$/.exec(pt);
  if (!m) return yte;
  const n = Number(m[2]);
  return abbrs.has(m[1]) ? 100 - n : n;
}

/** One ESPN summary → [gameKey, teams[], GamePlay[]] (null if no drives yet). */
export function gameToFeed(summary) {
  const comp = summary?.header?.competitions?.[0];
  const byId = new Map();   // competitor id -> nflverse abbr
  const abbrsOf = new Map(); // competitor id -> Set of raw + fixed abbrs (possessionText matching)
  let home = '', away = '';
  for (const c of comp?.competitors ?? []) {
    const raw = c?.team?.abbreviation ?? '';
    const abbr = fixTeam(raw);
    const id = String(c?.id ?? c?.team?.id);
    byId.set(id, abbr);
    abbrsOf.set(id, new Set([raw, abbr]));
    if (c?.homeAway === 'home') home = abbr; else if (c?.homeAway === 'away') away = abbr;
  }
  if (!home || !away) return null;
  const eventId = summary?.header?.id ?? '';

  const drives = [...(summary?.drives?.previous ?? [])];
  if (summary?.drives?.current?.plays) drives.push(summary.drives.current);
  const all = [];
  for (let d = 0; d < drives.length; d++) for (const p of drives[d]?.plays ?? []) all.push([d, p]);
  if (!all.length) return null;

  let startMs = Infinity;
  for (const [, p] of all) { const ms = Date.parse(p?.wallclock ?? ''); if (Number.isFinite(ms) && ms < startMs) startMs = ms; }

  const plays = [];
  for (const [drv, p] of all) {
    const ty = p?.type?.text ?? '';
    const tm = byId.get(String(p?.start?.team?.id ?? ''));
    if (SKIP_TYPES.has(ty) || !tm) continue;
    const c = clockOf(Number(p?.period?.number ?? 1), p?.clock?.displayValue ?? '15:00');
    const wm = Date.parse(p?.wallclock ?? '');
    const t = Number.isFinite(wm) && Number.isFinite(startMs) ? Math.max(0, Math.round((wm - startMs) / 1000)) : null;
    const idStr = String(p?.id ?? '');
    const pid = idStr.startsWith(String(eventId)) ? Number(idStr.slice(String(eventId).length)) : null;
    plays.push({
      c, ...(t != null ? { t } : {}), ...(pid != null ? { pid } : {}),
      drv, tm,
      ...(() => { const t2 = byId.get(String(p?.end?.team?.id ?? '')); return t2 && t2 !== tm ? { tm2: t2 } : {}; })(),
      dn: Number(p?.start?.down ?? 0) || 0,
      dist: Number(p?.start?.distance ?? 0) || 0,
      yl: yteOf(p?.start, abbrsOf.get(String(p?.start?.team?.id ?? '')) ?? new Set()),
      yl2: yteOf(p?.end ?? p?.start, abbrsOf.get(String(p?.end?.team?.id ?? p?.start?.team?.id ?? '')) ?? new Set()),
      ty, txt: p?.text ?? '',
      ...(p?.scoringPlay ? { sc: 1 } : {}),
      ...(p?.isPenalty ? { pen: 1 } : {}),
      ...(p?.isTurnover ? { to: 1 } : {}),
      hs: Number(p?.homeScore ?? 0) || 0,
      as: Number(p?.awayScore ?? 0) || 0,
    });
  }
  plays.sort((a, b) => a.c - b.c || (a.pid ?? 0) - (b.pid ?? 0));
  return [`${away}@${home}`, [away, home], plays];
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
