// Engine bridge: the worker resolves the REAL Drip game by running the SAME
// TypeScript engine the client runs (src/engine/sim.ts), via tsx — one source of
// truth, no compiled copy to drift. This replaces resolve.js's placeholder
// base-points score with the actual metric effects (nuke / erase / streak / drip).
//
// How live data reaches the engine: sim.ts pulls each player's timeline from
// realPbpFor(week, player.id). realPbp.ts exposes setSyntheticWeeks() — the same
// hook the client uses for live Sleeper leagues — so the worker injects the week's
// live_play rows (keyed by slug) and the engine reads them transparently.
//
// NOTE: run anything importing this under tsx (see package.json scripts), so the
// .ts imports resolve in Node.
import { resolveSlot, EMPTY_PLAYER } from '../../src/engine/sim.ts';
import { resolveLiveMatchup } from '../../src/engine/liveResolve.ts';
import { setSyntheticWeeks, clearSyntheticWeeks } from '../../src/data/realPbp.ts';
import { aiLineup, aiLiveBuffs } from '../../src/data/aiLineup.ts';

const ZERO_STATS = {
  games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0,
  targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0,
};

/** Minimal Player for the engine. `id` MUST be the slug the plays are keyed by. */
export function makePlayer(slug, pos, team, full) {
  return { id: slug, name: full || slug, full: full || slug, pos: pos || 'WR', team: team || '', stats: { ...ZERO_STATS } };
}

export const EMPTY = EMPTY_PLAYER;
export { clearSyntheticWeeks, resolveLiveMatchup, aiLiveBuffs };

/** AI auto-lineup for a real LIVE game — delegates to the shared honest builder
 *  (src/data/aiLineup.ts): place a roster's Sleeper starters on sensible default
 *  metrics (fixing the old QB→fg / DEF→suppress zero-scoring bug) plus a pre-game
 *  Field-General read. With a `week` that has a known NFL slate, players are
 *  slate-gated into the window their team actually plays, exactly like a human's
 *  lineup. Returns [{ win, slot, slug, metric }] — the sealed-pick shape. */
export function autoLineup(slugs, week = 0) {
  return aiLineup(slugs ?? [], week);
}

/** Inject a week's plays so the engine sees them via realPbpFor(week, slug).
 *  bySlug: { [slug]: RealPlay[] } (the live_play rows in RealPlay shape). */
export function injectWeek(week, bySlug, points = {}) {
  setSyntheticWeeks([{ week, pbp: bySlug, points }]);
}

/** Resolve one window slot (you vs their) with full metric effects.
 *  you/their: { player, metricId }. Returns the SlotResolution (events + finals).
 *  Pass EMPTY as `their.player` (metricId:'') for an unopposed slot. */
export function resolveWindow(you, their, week, label = '', opts = {}) {
  return resolveSlot(you, their, week, label, opts);
}

/** Convenience: turn live_play DB rows into the RealPlay shape the engine wants,
 *  grouped by slug. Rows: { player_slug, c, t, pid, k, y, td, ca, tg, to }. */
export function rowsToPbp(rows) {
  const by = {};
  for (const r of rows) {
    (by[r.player_slug] ||= []).push({ c: r.c, t: r.t ?? undefined, pid: r.pid ?? undefined, k: r.k, y: r.y, td: r.td, ca: r.ca, tg: r.tg, ...(r.to ? { to: r.to } : {}) });
  }
  for (const s of Object.keys(by)) by[s].sort((a, b) => a.c - b.c);
  return by;
}
