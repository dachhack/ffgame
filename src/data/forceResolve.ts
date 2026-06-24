// Admin "force-resolve": run the REAL engine in the browser against baked 2025
// play-by-play to preview a matchup's live scores before the season. Mirrors the
// worker's resolver (server/src/resolve.js) but client-side, using the same
// src/engine/sim.ts the demo runs. Writes per-window scores via admin_set_state.
import type { Player } from '../types';
import { defaultMetric } from './metrics';
import { resolveLiveMatchup, type LivePick } from '../engine/liveResolve';
import { loadRealWeek } from './realPbp';
import { slugMeta as meta } from './slugMeta';
import { adminMatchupPicks, adminSetMatchup, adminSetState, type MatchupPicks } from './liveApi';
import { aiLineup } from './aiLineup';

const ZERO = { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 };

function mkPlayer(slug: string): Player {
  const m = meta(slug);
  return { id: slug, name: slug, full: slug, pos: m.pos, team: m.team, stats: { ...ZERO } };
}

interface Slot { win: string; slot: string; slug: string; metric: string }

/** A side's slots: its sealed picks if it set any, else an honest AI auto-lineup
 *  from its Sleeper starters (src/data/aiLineup — sensible default metrics + a
 *  pre-game Field-General read, NO hindsight). The auto path covers empty seats,
 *  AI-controlled teams, and managers who didn't pick. */
function sideSlots(data: MatchupPicks, side: 'home' | 'away', week: number): Slot[] {
  const appUser = side === 'home' ? data.home_app_user : data.away_app_user;
  const picks = appUser ? data.picks.filter((p) => p.app_user_id === appUser && p.player_slug) : [];
  if (picks.length) {
    return picks.map((p) => ({ win: p.game_window, slot: p.roster_slot, slug: p.player_slug!, metric: p.metric_id || defaultMetric(meta(p.player_slug!).pos).id }));
  }
  // starters_json entries are { slot, sleeper_id, player_slug, pos } (server/src/sync.js).
  const lineup = (side === 'home' ? data.home_lineup : data.away_lineup) ?? [];
  const slugs = lineup.map((e) => e.player_slug).filter((s): s is string => !!s);
  return aiLineup(slugs, week);
}

/** A side's armed in-slot buffs — whatever it has BOUGHT (applied_state, surfaced
 *  via admin_matchup_picks). Power-ups are paid now, so there's no free AI draw;
 *  an unbought side simply resolves with none. */
function sideBuffs(data: MatchupPicks, side: 'home' | 'away'): string[] {
  return (side === 'home' ? data.home_buffs : data.away_buffs) ?? [];
}

const toLivePick = (s: Slot): LivePick => ({ win: s.win, slot: s.slot, player: mkPlayer(s.slug), metricId: s.metric });

/** Resolve a matchup from baked week `sourceWeek`, set it live, and write scores.
 *  Runs the shared resolver (cross-window Field General + best-ball backups), the
 *  same one the worker uses, so this preview matches live scoring. */
export async function forceResolve(matchupId: string, sourceWeek: number): Promise<{ window: string; home: number; away: number }[]> {
  const data = await adminMatchupPicks(matchupId);
  await loadRealWeek(sourceWeek); // baked plays into the engine's cache
  const { states, slots, coin } = resolveLiveMatchup(
    sideSlots(data, 'home', sourceWeek).map(toLivePick), sideSlots(data, 'away', sourceWeek).map(toLivePick), sourceWeek,
    { homeBuffs: new Set(sideBuffs(data, 'home')), awayBuffs: new Set(sideBuffs(data, 'away')) },
  );
  await adminSetMatchup(matchupId, 'live', true); // reveal picks + show on the board
  await adminSetState(matchupId, states, coin, slots);
  return states;
}
