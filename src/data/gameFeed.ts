// Per-GAME play-by-play feeds for the field visual (FieldView) — every scrimmage
// play of an NFL game with its field situation (down, distance, start/end
// yards-to-endzone, possession, text, score). Parallel to realPbp.ts but keyed
// by GAME, not player: the engine never reads this, only the drive-chart UI.
// Baked by scripts/pbp/genGameFeed.mjs into public/gamefeed/wN.json and fetched
// lazily per week, so it costs nothing until a field is actually opened.
import { REAL_WEEKS } from './realWeeks';

export interface GamePlay {
  c: number;        // game-elapsed seconds (same clockOf as RealPlay)
  t?: number;       // real seconds since the game's first snap
  pid?: number;     // ESPN/nflverse play id (stable per-game key)
  drv: number;      // drive ordinal (0-based)
  tm: string;       // possession team abbr (nflverse style)
  tm2?: string;     // team in possession AFTER the play, when it flips (punt/INT/kick)
  dn: number;       // down 1-4, 0 = kickoff/PAT/no-down
  dist: number;     // yards to go
  yl: number;       // start yards-to-endzone (tm's perspective)
  yl2: number;      // end yards-to-endzone ((tm2 ?? tm)'s perspective)
  ty: string;       // ESPN play type text ("Pass Reception", "Punt", …)
  txt: string;      // full play description
  sc?: number;      // 1 = scoring play
  pen?: number;     // 1 = penalty
  to?: number;      // 1 = turnover
  hs: number;       // home score after the play
  as: number;       // away score after the play
}
export interface WeekGameFeed {
  games: Record<string, GamePlay[]>; // "AWAY@HOME" -> plays
  teams: Record<string, string>;     // team abbr -> "AWAY@HOME"
}
export interface TeamGameFeed { key: string; away: string; home: string; plays: GamePlay[]; }

const cache = new Map<number, WeekGameFeed>();
const inflight = new Map<number, Promise<void>>();

// ── Live overlay (worker-ingested game_feed rows) ────────────────────────────
// For a real pilot week the worker's game_feed docs are installed here. Like the
// realPbp live overlay, a live week is EXCLUSIVE — baked 2025 data must never
// leak into a 2026 board that shares the same week number.
const liveFeeds = new Map<number, WeekGameFeed>();

/** game_feed DB rows → a week's {games, teams} (mirrors the baker's shape). */
export function feedRowsToWeek(rows: { key: string; away: string; home: string; plays: GamePlay[] }[]): WeekGameFeed {
  const games: Record<string, GamePlay[]> = {};
  const teams: Record<string, string> = {};
  for (const r of rows) {
    games[r.key] = r.plays ?? [];
    teams[r.away] = r.key; teams[r.home] = r.key;
  }
  return { games, teams };
}
/** Install the week's live game feeds; makes that week resolve live-only. */
export function setLiveGameFeed(week: number, feed: WeekGameFeed): void { liveFeeds.set(week, feed); }
/** Drop all live game feeds (back to baked resolution). */
export function clearLiveGameFeeds(): void { liveFeeds.clear(); }

/** True when the week has any field-visual data (live overlay or baked). */
export function hasGameFeed(week: number): boolean {
  const live = liveFeeds.get(week);
  if (live) return Object.keys(live.games).length > 0;
  return REAL_WEEKS.has(week);
}

/** Fetch + cache a week's game feeds (no-op for non-real weeks / already loaded).
 *  A live-overlaid week never fetches baked data — the overlay is exclusive. */
export function loadGameFeedWeek(week: number): Promise<void> {
  if (liveFeeds.has(week) || !REAL_WEEKS.has(week) || cache.has(week)) return Promise.resolve();
  let p = inflight.get(week);
  if (!p) {
    const url = `${import.meta.env.BASE_URL}gamefeed/w${week}.json`;
    p = fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`gamefeed w${week}: HTTP ${r.status}`))))
      .then((data: WeekGameFeed) => { cache.set(week, data); })
      .catch((e) => { console.error('[gameFeed] load failed', e); /* leave uncached → no field */ })
      .finally(() => { inflight.delete(week); });
    inflight.set(week, p);
  }
  return p;
}

/** A team's game feed for a loaded week, or null (not loaded / bye / unknown).
 *  The live overlay wins and is exclusive (a live week ignores baked data). */
export function gameFeedFor(week: number, team?: string | null): TeamGameFeed | null {
  if (!team) return null;
  const wk = liveFeeds.get(week) ?? cache.get(week);
  const key = wk?.teams[team];
  const plays = key ? wk?.games[key] : undefined;
  if (!key || !plays) return null;
  const [away, home] = key.split('@');
  return { key, away, home, plays };
}
