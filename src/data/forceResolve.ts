// Admin "force-resolve": run the REAL engine in the browser against baked 2025
// play-by-play to preview a matchup's live scores before the season. Mirrors the
// worker's resolver (server/src/resolve.js) but client-side, using the same
// src/engine/sim.ts the demo runs. Writes per-window scores via admin_set_state.
import type { Player, Pos } from '../types';
import { WINDOWS, defaultMetric } from './metrics';
import { resolveSlot, EMPTY_PLAYER, type SlotInput } from '../engine/sim';
import { loadRealWeek } from './realPbp';
import { BAKED_SLUGS } from './bakedSlugs';
import { adminMatchupPicks, adminSetMatchup, adminSetState, type MatchupPicks } from './liveApi';

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };

function meta(slug: string): { pos: Pos; team: string } {
  if (slug.endsWith('-dst')) return { pos: 'DEF', team: slug.slice(0, -4).toUpperCase() };
  if (slug.endsWith('-k')) return { pos: 'K', team: slug.slice(0, -2).toUpperCase() };
  const b = BAKED_SLUGS[slug];
  return b ? { pos: b.pos as Pos, team: b.team } : { pos: 'WR', team: '' };
}
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

/** Resolve a matchup from baked week `sourceWeek`, set it live, and write scores.
 *  Returns the per-window result. */
export async function forceResolve(matchupId: string, sourceWeek: number): Promise<{ window: string; home: number; away: number }[]> {
  const data = await adminMatchupPicks(matchupId);
  await loadRealWeek(sourceWeek); // baked plays into the engine's cache
  const home = sideSlots(data, 'home');
  const away = new Map(sideSlots(data, 'away').map((s) => [`${s.win}-${s.slot}`, s]));

  const win: Record<string, { home: number; away: number }> = {};
  const bump = (w: string, side: 'home' | 'away', v: number) => { (win[w] ||= { home: 0, away: 0 })[side] += v; };
  const si = (s: Slot): SlotInput => ({ player: mkPlayer(s.slug), metricId: s.metric });
  const empty: SlotInput = { player: EMPTY_PLAYER, metricId: '' };

  for (const hs of home) {
    const key = `${hs.win}-${hs.slot}`;
    const as = away.get(key);
    const r = resolveSlot(si(hs), as ? si(as) : empty, sourceWeek, key);
    bump(hs.win, 'home', r.youFinal);
    if (as) { bump(hs.win, 'away', r.theirFinal); away.delete(key); }
  }
  for (const as of away.values()) {
    const r = resolveSlot(si(as), empty, sourceWeek, `${as.win}-${as.slot}`);
    bump(as.win, 'away', r.youFinal);
  }

  const round = (n: number) => Math.round(n * 10) / 10;
  const states = Object.entries(win).map(([window, s]) => ({ window, home: round(s.home), away: round(s.away) }));
  await adminSetMatchup(matchupId, 'live', true); // reveal picks + show on the board
  await adminSetState(matchupId, states);
  return states;
}
