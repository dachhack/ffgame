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
import { resolveSlot, EMPTY_PLAYER } from '../../packages/core/src/engine/sim.ts';
import { resolveLiveMatchup } from '../../packages/core/src/engine/liveResolve.ts';
import { resolveClassicMatchup, CLASSIC_WIN, classicSlots, leagueSlotDefs, leagueBestball } from '../../packages/core/src/engine/classic.ts';
import { assignSealedRows } from '../../packages/core/src/engine/seatPicks.ts';
import { setSyntheticWeeks, clearSyntheticWeeks, realPbpFor } from '../../packages/core/src/data/realPbp.ts';

/** Diagnostic: how many plays the ENGINE would see for (week, slug) right now. */
export function playsFor(week, slug) {
  return realPbpFor(week, slug)?.length ?? 0;
}
import { aiLineup, aiLiveBuffs } from '../../packages/core/src/data/aiLineup.ts';

const ZERO_STATS = {
  games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0,
  targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0,
};

/** Minimal Player for the engine. `id` MUST be the slug the plays are keyed by. */
export function makePlayer(slug, pos, team, full) {
  return { id: slug, name: full || slug, full: full || slug, pos: pos || 'WR', team: team || '', stats: { ...ZERO_STATS } };
}

export const EMPTY = EMPTY_PLAYER;
export { clearSyntheticWeeks, resolveLiveMatchup, aiLiveBuffs, resolveClassicMatchup, CLASSIC_WIN, classicSlots, leagueSlotDefs, leagueBestball, assignSealedRows };

/** AI auto-lineup for a real LIVE game — delegates to the shared honest builder
 *  (src/data/aiLineup.ts): place a roster's Sleeper starters on sensible default
 *  metrics (fixing the old QB→fg / DEF→suppress zero-scoring bug) plus a pre-game
 *  Field-General read. With a `week` that has a known NFL slate, players are
 *  slate-gated into the window their team actually plays, exactly like a human's
 *  lineup. Returns [{ win, slot, slug, metric }] — the sealed-pick shape. */
export function autoLineup(slugs, week = 0, owned = new Set(), extra = 0, personaKey) {
  return aiLineup(slugs ?? [], week, owned, extra, personaKey);
}

/** Inject a week's plays so the engine sees them via realPbpFor(week, slug).
 *  bySlug: { [slug]: RealPlay[] } (the live_play rows in RealPlay shape). */
// ADDITIVE across weeks (0199.3). setSyntheticWeeks CLEARS the whole synth
// store and installs only what it's handed — correct for the client (one board,
// one week) but a live trap here: the tick runs one context per active week
// (preseason + regular share this process), so a single-week install means the
// second context's injection erased the first's plays. With no tick overlap
// that was masked by ordering; the moment ticks ran long enough to overlap on
// the 8/15 Saturday slate, week 102's plays vanished mid-resolve and every
// live window wrote honest-looking zeros. Keep every injected week installed.
const injectedWeeks = new Map();
export function injectWeek(week, bySlug, points = {}) {
  injectedWeeks.set(week, { week, pbp: bySlug, points });
  setSyntheticWeeks([...injectedWeeks.values()]);
}

/** Resolve one window slot (you vs their) with full metric effects.
 *  you/their: { player, metricId }. Returns the SlotResolution (events + finals).
 *  Pass EMPTY as `their.player` (metricId:'') for an unopposed slot. */
export function resolveWindow(you, their, week, label = '', opts = {}) {
  return resolveSlot(you, their, week, label, opts);
}

/** Convenience: turn live_play DB rows into the RealPlay shape the engine wants,
 *  grouped by slug. Rows: { player_slug, c, t, pid, k, y, td, ca, tg, to } plus
 *  the 0166 truth flags fd/cp/ic/sk when the poller stored them. */
export function rowsToPbp(rows) {
  const by = {};
  for (const r of rows) {
    (by[r.player_slug] ||= []).push({
      c: r.c, t: r.t ?? undefined, pid: r.pid ?? undefined, k: r.k, y: r.y, td: r.td, ca: r.ca, tg: r.tg,
      ...(r.to ? { to: r.to } : {}),
      ...(r.fd ? { fd: 1 } : {}), ...(r.cp ? { cp: 1 } : {}), ...(r.ic ? { ic: 1 } : {}), ...(r.sk ? { sk: 1 } : {}),
      ...(r.rk ? { rk: r.rk } : {}), ...(r.tt ? { tt: r.tt } : {}), ...(r.hf ? { hf: 1 } : {}),
    });
  }
  for (const s of Object.keys(by)) by[s].sort((a, b) => a.c - b.c);
  return by;
}
