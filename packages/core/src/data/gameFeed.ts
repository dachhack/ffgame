// Per-GAME play-by-play feeds for the field visual (FieldView) — every scrimmage
// play of an NFL game with its field situation (down, distance, start/end
// yards-to-endzone, possession, text, score). Parallel to realPbp.ts but keyed
// by GAME, not player: the engine never reads this, only the drive-chart UI.
// Baked by scripts/pbp/genGameFeed.mjs into public/gamefeed/wN.json and fetched
// lazily per week, so it costs nothing until a field is actually opened.
import { REAL_WEEKS } from './realWeeks';
import { platform } from '../platform';

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
  yac?: number;     // yards after catch (receptions) — splits the pass arc from the run-after
  ret?: number;     // return yards (kickoffs/punts) — splits the kick arc from the runback
  sc?: number;      // 1 = scoring play
  pen?: number;     // 1 = penalty
  to?: number;      // 1 = turnover
  hs: number;       // home score after the play
  as: number;       // away score after the play
}
export interface WeekGameFeed {
  games: Record<string, GamePlay[]>; // "AWAY@HOME" -> plays
  teams: Record<string, string>;     // team abbr -> "AWAY@HOME"
  states?: Record<string, string>;   // "AWAY@HOME" -> real game state (pre|in|post), live rows only
}
export interface TeamGameFeed { key: string; away: string; home: string; plays: GamePlay[]; st?: string | null; }

const cache = new Map<number, WeekGameFeed>();
const inflight = new Map<number, Promise<void>>();

// ── Live overlay (worker-ingested game_feed rows) ────────────────────────────
// For a real pilot week the worker's game_feed docs are installed here. Like the
// realPbp live overlay, a live week is EXCLUSIVE — baked 2025 data must never
// leak into a 2026 board that shares the same week number.
const liveFeeds = new Map<number, WeekGameFeed>();

/** game_feed DB rows → a week's {games, teams} (mirrors the baker's shape). */
export function feedRowsToWeek(rows: { key: string; away: string; home: string; plays: GamePlay[]; state?: string | null }[]): WeekGameFeed {
  const games: Record<string, GamePlay[]> = {};
  const teams: Record<string, string> = {};
  const states: Record<string, string> = {};
  for (const r of rows) {
    games[r.key] = r.plays ?? [];
    teams[r.away] = r.key; teams[r.home] = r.key;
    if (r.state) states[r.key] = r.state;
  }
  return { games, teams, states };
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

/** Install a week's baked game feeds from data the host already holds.
 *
 *  The twin of realPbp's `installRealWeek`, and for the same reason:
 *  `loadGameFeedWeek` below reaches its JSON through `platform().assetUrl`,
 *  which assumes a host serving files over HTTP. The native app has no origin
 *  and `assetUrl` throws there by design; its copy arrives as a Metro
 *  `require()` of a bundled JSON, already parsed.
 *
 *  Fills the BAKED cache, not the live overlay — a live week must stay
 *  exclusive, so `setLiveGameFeed` remains the only way in for worker rows. */
export function installGameFeedWeek(week: number, feed: WeekGameFeed): void {
  if (!feed || typeof feed !== 'object' || !feed.games || !feed.teams) {
    throw new Error(`installGameFeedWeek(${week}): expected a WeekGameFeed with games + teams`);
  }
  cache.set(week, feed);
}

/** Fetch + cache a week's game feeds (no-op for non-real weeks / already loaded).
 *  A live-overlaid week never fetches baked data — the overlay is exclusive. */
export function loadGameFeedWeek(week: number): Promise<void> {
  if (liveFeeds.has(week) || !REAL_WEEKS.has(week) || cache.has(week)) return Promise.resolve();
  let p = inflight.get(week);
  if (!p) {
    const url = platform().assetUrl(`gamefeed/w${week}.json`);
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
/** EVERY game in the week's feed, live overlay first then the bake.
 *
 *  `gameFeedFor` answers "which game is this player in", which is the question
 *  a slot asks. The ▦ ALL GAMES board asks the opposite one — "what is on
 *  tonight" — and before this it could only answer it by looking up the teams
 *  of players somebody had slotted, so a game nobody in your matchup was
 *  playing in did not exist as far as that screen was concerned (v0.338.2).
 *
 *  Order is the feed's own insertion order, which is the schedule order the
 *  worker ingests in — so the board reads like the day's card. */
export function allGameFeeds(week: number): TeamGameFeed[] {
  const wk = liveFeeds.get(week) ?? cache.get(week);
  if (!wk) return [];
  return Object.entries(wk.games).map(([key, plays]) => {
    const [away, home] = key.split('@');
    return { key, away, home, plays: plays ?? [], st: wk.states?.[key] ?? null };
  });
}

/** OFFENSIVE POSSESSION INTERVALS, DERIVED FROM THE FEED (v0.339.2).
 *
 *  A drip metric is defined as accruing "while your team has the ball", and
 *  `sim.offSecs` gates it on intervals from `realPossFor` — which reads the
 *  BAKED week cache, written only by scripts/pbp/genRealPbp.mjs. No live path
 *  ever filled it, so in a live game the intervals came back empty and
 *  `offSecs` took its `if (!intervals.length) return t1 - t0` fallback: every
 *  drip accrued on every GAME minute rather than every offensive minute.
 *  That fallback was written for genuinely unknown data and had quietly become
 *  the normal case in-season, over-crediting every drip in every live window.
 *
 *  The feed already knows possession — `tm` on each play — so the intervals can
 *  be derived rather than plumbed through a new column.
 *
 *  THE RULE: the span between play i and play i+1 belongs to whoever runs play
 *  i+1. Deliberately keyed off the NEXT play's `tm` rather than this play's
 *  `tm2`: `tm2` is only present when possession flips, so a feed that omits it
 *  on a turnover would silently credit the wrong side for a whole drive, while
 *  the next play's `tm` is always populated and is the same fact stated
 *  positively. The tail after the last play is credited to nobody — the game
 *  has not been played past it yet, which is the live case.
 *
 *  Pure and exported for its own sake: this is a scoring rule, and it is
 *  asserted directly (scripts/check-poss.mjs). */
export function possFromPlays(plays: GamePlay[]): Record<string, number[][]> {
  const out: Record<string, number[][]> = {};
  if (!plays?.length) return out;
  const ord = [...plays].sort((a, b) => a.c - b.c);
  for (let i = 0; i + 1 < ord.length; i++) {
    const team = ord[i + 1].tm;
    const a = ord[i].c, b = ord[i + 1].c;
    if (!team || !(b > a)) continue;
    const arr = (out[team] ||= []);
    const last = arr[arr.length - 1];
    // Merge a span that continues the same team's drive rather than emitting
    // one interval per play — offSecs walks these per game-minute, and a
    // hundred adjacent one-play slivers is the same answer done slowly.
    if (last && last[1] === a) last[1] = b;
    else arr.push([a, b]);
  }
  return out;
}

/** This team's derived offensive intervals for the week's loaded feed, or []
 *  when there is no feed (which is what `offSecs` treats as "unknown"). */
/** One slotted player's contribution to the ALL GAMES board: which game it
 *  tints (via team), which side, the slot clock the game's field should
 *  mirror, and the play ids it banked. */
export interface FieldBoardEntry { team?: string | null; side: 'you' | 'their'; clock: number; pids?: number[] }
export interface FieldBoardGame { feed: TeamGameFeed; clock: number; you: Set<number>; their: Set<number>; mine: boolean }

/** THE ALL GAMES GROUPING RULE (v0.338.2, lifted to core in v0.340.1).
 *
 *  Seed a card for EVERY game on the week's feed first, then overlay the
 *  slotted entries for tinting and clock — a game nobody slotted still gets a
 *  card (the founder's ruling: the screen is called ALL GAMES, and a slate
 *  filtered to your matchup reads as a broken feed). An entry game is sampled
 *  at its FURTHEST slot clock so the field mirrors what the slot rows show; a
 *  game with no slot to mirror shows everything ingested (Infinity against
 *  the `p.c <= clock` visibility test). ACTIVE games first, finished games
 *  sink to the bottom (founder's call, v0.342.0: "the active games are always
 *  at the top"); within each band your games lead, then the rest in the
 *  feed's own schedule order. A game is finished only when the feed SAYS so
 *  (state 'post') — a missing state is a live unknown, never a burial.
 *
 *  Lived in the web's FieldBoard useMemo until v0.340.1, with the app running
 *  a DIFFERENT (slotted-only) rule and check-field-board pinning a
 *  reimplementation — now all three call this. */
export function groupFieldGames(week: number, entries: FieldBoardEntry[]): FieldBoardGame[] {
  const m = new Map<string, FieldBoardGame>();
  for (const feed of allGameFeeds(week)) {
    m.set(feed.key, { feed, clock: Infinity, you: new Set(), their: new Set(), mine: false });
  }
  for (const e of entries) {
    const feed = gameFeedFor(week, e.team);
    if (!feed) continue;
    let g = m.get(feed.key);
    // Belt and braces: a feed reachable by TEAM but absent from the games map
    // would otherwise drop a game the entries-only rule showed. Never seen,
    // but that path must not regress.
    if (!g) { g = { feed, clock: 0, you: new Set(), their: new Set(), mine: false }; m.set(feed.key, g); }
    // First entry for this game replaces the seeded Infinity with a real slot
    // clock; later entries take the furthest.
    g.clock = g.mine ? Math.max(g.clock, e.clock) : e.clock;
    g.mine = true;
    const pids = e.side === 'you' ? g.you : g.their;
    for (const pid of e.pids ?? []) pids.add(pid);
  }
  const all = [...m.values()];
  const doneOf = (g: FieldBoardGame) => g.feed.st === 'post';
  const band = (g: FieldBoardGame) => (doneOf(g) ? 2 : 0) + (g.mine ? 0 : 1);
  // Stable by construction: sort only on the band, so within a band the
  // feed's own order (and mine-insertion order) is preserved.
  return all.map((g, i) => [g, i] as const)
    .sort((a, b) => band(a[0]) - band(b[0]) || a[1] - b[1])
    .map(([g]) => g);
}

export function feedPossFor(week: number, team?: string | null): number[][] {
  const f = gameFeedFor(week, team);
  if (!f || !team) return [];
  return possFromPlays(f.plays)[team] ?? [];
}

export function gameFeedFor(week: number, team?: string | null): TeamGameFeed | null {
  if (!team) return null;
  const wk = liveFeeds.get(week) ?? cache.get(week);
  const key = wk?.teams[team];
  const plays = key ? wk?.games[key] : undefined;
  if (!key || !plays) return null;
  const [away, home] = key.split('@');
  return { key, away, home, plays, st: wk?.states?.[key] ?? null };
}
