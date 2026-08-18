// THE BAKED SEASON (v0.285.0) — every week of 2025 play-by-play, player-major,
// for the player card's game log.
//
// WHY NOT live_play: the card used to read a player's season out of the live
// table, and got back exactly the weeks the live pipeline had broadcast — one,
// if the simulator had replayed one. But live_play is DOWNSTREAM of this data
// (server/src/simulate.js: "baked wN.json → live_play rows"), so the log was
// reading the less complete of two copies of the same plays. The bake is the
// season; it ships with the app, so a game log is instant and works on a
// plane.
//
// WHY NOT the week files: public/pbp/wN.json is week-major — the axis the BOARD
// reads on (one week, every player). A card reads the other axis (one player,
// every week), and getting a season out of the week files means fetching and
// parsing all fourteen. scripts/pbp/genSeasonLog.mjs re-pivots them once at
// build time into a single 1.5 MB file (~200 KB inside the APK's zip).
//
// HOSTS: the web fetches it as a static asset. Native has no assetUrl — Metro
// bundles JSON through `require` instead — so the app installs its own loader
// at startup, the same shape as the platform's other host-installed pieces.
import type { RealPlay } from './realPbp';
import { platform } from '../platform';

/** The file scripts/pbp/genSeasonLog.mjs writes. Weeks are string keys — it is
 *  JSON — and are widened to numbers on the way out. */
export interface SeasonLogFile {
  v: number;
  weeks: number[];
  pbp: Record<string, Record<string, RealPlay[]>>;
}

let loader: (() => SeasonLogFile | Promise<SeasonLogFile>) | null = null;
let pending: Promise<SeasonLogFile> | null = null;

/** Native installs the Metro `require` here; the web needs nothing. */
export function setSeasonLogLoader(fn: (() => SeasonLogFile | Promise<SeasonLogFile>) | null): void {
  loader = fn;
  pending = null;
}

async function fetchBaked(): Promise<SeasonLogFile> {
  const res = await fetch(platform().assetUrl('pbp/season.json'));
  if (!res.ok) throw new Error(`season log: HTTP ${res.status}`);
  return (await res.json()) as SeasonLogFile;
}

/** Load once and hold it. A FAILED load drops the cache so the next card can
 *  try again — a dropped connection must not turn into a permanently empty
 *  game log for the rest of the session. */
function load(): Promise<SeasonLogFile> {
  if (!pending) {
    pending = Promise.resolve(loader ? loader() : fetchBaked())
      .catch((e) => { pending = null; throw e; });
  }
  return pending;
}

/** One player's season: week → his plays that week. Weeks he has no plays in
 *  are absent, not empty — a bye and a healthy scratch are the same silence
 *  here, and the log says "no game" from the slate rather than guessing. */
export async function playerSeasonLog(slug: string): Promise<Record<number, RealPlay[]>> {
  const file = await load();
  const byWeek = file.pbp?.[slug];
  if (!byWeek) return {};
  const out: Record<number, RealPlay[]> = {};
  for (const [w, plays] of Object.entries(byWeek)) {
    const n = Number(w);
    if (Number.isFinite(n) && plays?.length) out[n] = plays;
  }
  return out;
}

/** Which weeks the bake covers — for a caller that wants to say so. */
export async function seasonLogWeeks(): Promise<number[]> {
  return (await load()).weeks ?? [];
}
