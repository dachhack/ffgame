// Lineup alarms (0184) — "a window locks soon and you have empty slots", the
// one notification that saves someone's week. Computed client-side from data
// the platform already serves:
//
//   liveSlate(week)      → the week's real games + kickoffs (worker-synced)
//   setRuntimeSlate(...) → derives the week's own windows (preseason clusters
//                          included — the tnf/tnf2 lesson from LivePicks)
//   windowKickoffMs(...) → earliest kickoff per window; lock = kickoff − 1h
//   slotsFor(win, week)  → the window's slot capacity (base — extra powerup
//                          slots deliberately excluded: an alarm should never
//                          fire over a slot you'd have to buy)
//   myPicks(matchup)     → which of those slots actually hold a player
//
// Returns the SOONEST alarming window inside the horizon, or null. The slate
// install is module-global by week and the slate is NFL-wide, so computing
// alarms for several leagues on the same week reuses one install harmlessly.
import { liveSlate, myPicks } from './liveApi';
import { setRuntimeSlate, windowsForWeek, windowKickoffMs, LOCK_LEAD_MS } from './nflSlate';
import type { WindowId } from '../types';
import { slotsFor } from '../engine/matchup';

export interface LineupAlarm {
  win: string;
  /** When the window's picks lock (kickoff − 1h), epoch ms. */
  lockMs: number;
  empty: number;
}

const DEFAULT_HORIZON_MS = 90 * 60_000;

export async function lineupAlarmFor(
  matchupId: string, week: number, userId: string, horizonMs = DEFAULT_HORIZON_MS,
): Promise<LineupAlarm | null> {
  const [slate, picks] = await Promise.all([
    liveSlate(week).catch(() => []),
    myPicks(matchupId, userId).catch(() => []),
  ]);
  if (slate.length) {
    setRuntimeSlate(week, slate.map((g) => ({
      away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId,
      kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined,
    })));
  }
  const now = Date.now();
  let best: LineupAlarm | null = null;
  for (const w of windowsForWeek(week)) {
    const kick = windowKickoffMs(week, w.id);
    if (kick == null) continue;
    const lock = kick - LOCK_LEAD_MS;
    if (lock <= now || lock - now > horizonMs) continue;   // already locked, or not urgent yet
    const cap = slotsFor(w.id, week);
    const set = picks.filter((p) => p.game_window === String(w.id) && p.player_slug).length;
    const empty = cap - set;
    if (empty > 0 && (!best || lock < best.lockMs)) best = { win: String(w.id), lockMs: lock, empty };
  }
  return best;
}

/** Short display line: "LOCKS 6:20 PM · 3 EMPTY". */
export function alarmLabel(a: LineupAlarm): string {
  const t = new Date(a.lockMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `LOCKS ${t} · ${a.empty} EMPTY`;
}
