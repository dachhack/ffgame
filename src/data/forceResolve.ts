// Admin "force-resolve": run the REAL engine in the browser against baked 2025
// play-by-play to preview a matchup's live scores before the season. Mirrors the
// worker's resolver (server/src/resolve.js) but client-side, using the same
// src/engine/sim.ts the demo runs. Writes per-window scores via admin_set_state.
import type { Player } from '../types';
import { WINDOWS, defaultMetric } from './metrics';
import { resolveLiveMatchup, type LivePick } from '../engine/liveResolve';
import { loadRealWeek } from './realPbp';
import { slugMeta as meta } from './slugMeta';
import { adminMatchupPicks, adminSetMatchup, adminSetState, type MatchupPicks } from './liveApi';

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };

function mkPlayer(slug: string): Player {
  const m = meta(slug);
  return { id: slug, name: slug, full: slug, pos: m.pos, team: m.team, stats: { ...ZERO } };
}

interface Slot { win: string; slot: string; slug: string; metric: string }

/** A side's slots: its sealed picks if enrolled, else its Sleeper lineup spread
 *  across the window grid with each position's default metric. */
function sideSlots(data: MatchupPicks, side: 'home' | 'away'): Slot[] {
  const appUser = side === 'home' ? data.home_app_user : data.away_app_user;
  const picks = appUser ? data.picks.filter((p) => p.app_user_id === appUser && p.player_slug) : [];
  if (picks.length) {
    return picks.map((p) => ({ win: p.game_window, slot: p.roster_slot, slug: p.player_slug!, metric: p.metric_id || defaultMetric(meta(p.player_slug!).pos).id }));
  }
  const lineup = (side === 'home' ? data.home_lineup : data.away_lineup) ?? [];
  const out: Slot[] = [];
  let i = 0;
  for (const w of WINDOWS) for (let s = 0; s < w.slots; s++) {
    const e = lineup[i++];
    if (e?.slug) out.push({ win: w.id, slot: String(s), slug: e.slug, metric: defaultMetric(meta(e.slug).pos).id });
  }
  return out;
}

const toLivePick = (s: Slot): LivePick => ({ win: s.win, slot: s.slot, player: mkPlayer(s.slug), metricId: s.metric });

/** Resolve a matchup from baked week `sourceWeek`, set it live, and write scores.
 *  Runs the shared resolver (cross-window Field General + best-ball backups), the
 *  same one the worker uses, so this preview matches live scoring. */
export async function forceResolve(matchupId: string, sourceWeek: number): Promise<{ window: string; home: number; away: number }[]> {
  const data = await adminMatchupPicks(matchupId);
  await loadRealWeek(sourceWeek); // baked plays into the engine's cache
  const { states, coin } = resolveLiveMatchup(sideSlots(data, 'home').map(toLivePick), sideSlots(data, 'away').map(toLivePick), sourceWeek);
  await adminSetMatchup(matchupId, 'live', true); // reveal picks + show on the board
  await adminSetState(matchupId, states, coin);
  return states;
}
