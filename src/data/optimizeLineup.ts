// AI auto-lineup builder. Given a roster's starter slugs and a real week, lay them
// onto the WINDOWS slot grid and pick, for each player, the METRIC that maximises
// their own score that week — a deterministic "best lineup" for AI-controlled or
// missed-pick teams. Scoring reuses the real engine's per-slot resolver
// (resolveSlot solo vs an empty opponent), so the chosen metric matches live play.
// The week's plays must already be loaded (loadRealWeek) before calling.
import type { Player } from '../types';
import { WINDOWS, defaultMetric, METRICS } from './metrics';
import { slugMeta } from './slugMeta';
import { resolveSlot, EMPTY_PLAYER } from '../engine/sim';

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };

/** Minimal Player from a slug (pos/team from slugMeta); stats come from baked PBP. */
export function mkPlayer(slug: string): Player {
  const m = slugMeta(slug);
  return { id: slug, name: slug, full: slug, pos: m.pos, team: m.team, stats: { ...ZERO } };
}

/** The metric (from the player's position catalog) that scores the player highest
 *  this week, solo. Skips locked/unlockable metrics. Falls back to the position
 *  default when nothing scores (no plays, or only self-zeroing metrics like FG). */
export function bestMetric(slug: string, week: number): string {
  const pos = slugMeta(slug).pos;
  const player = mkPlayer(slug);
  const fallback = defaultMetric(pos).id;
  let bestId = fallback;
  let bestScore = -Infinity;
  for (const m of METRICS[pos] ?? []) {
    if (m.lock) continue; // requires an unlock; not available to an auto-pick
    const r = resolveSlot({ player, metricId: m.id }, { player: EMPTY_PLAYER, metricId: 'none' }, week, '', {});
    if (r.youFinal > bestScore) { bestScore = r.youFinal; bestId = m.id; }
  }
  return bestScore > 0 ? bestId : fallback;
}

export interface OptiPick { win: string; slot: string; slug: string; metric: string }

/** Spread starters across the window/slot grid, each with its best-scoring metric. */
export function optimizeLineup(slugs: string[], week: number): OptiPick[] {
  const clean = slugs.filter(Boolean);
  const out: OptiPick[] = [];
  let i = 0;
  for (const w of WINDOWS) for (let s = 0; s < w.slots; s++) {
    const slug = clean[i++];
    if (slug) out.push({ win: w.id, slot: String(s), slug, metric: bestMetric(slug, week) });
  }
  return out;
}
