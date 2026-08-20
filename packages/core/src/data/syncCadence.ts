// HOW OFTEN TO MIRROR SLEEPER (v0.319.0). A pure function of the clock and the
// week's kickoffs, so it can be tested against a fixed instant instead of
// observed in production a week before the season.
//
// Founder: "I'd rather keep things as consistent daily as possible. we need to
// cover waiver movements from overnight claims. So fire at 20 min intervals
// from 4am to 10am est. Then an hourly fire until 4am again. On game days, fire
// every 5 starting 2 hours before game time then increase the speed as we
// approach game time."
//
// ── WHAT THIS REPLACES ─────────────────────────────────────────────────────
// A flat 6-hour timer. Rosters could therefore be six hours stale at kickoff:
// an overnight waiver claim that processed at 4am was not guaranteed to be on
// the board before a 1pm lock, and a Sunday-morning inactive could miss the
// lock entirely. The manual refresh button (0204) was the mitigation, and it
// stays — but a manager should not have to know to press it.
//
// ── THE THREE RULES, AND WHY THE TIGHTEST ONE WINS ─────────────────────────
//   • WAIVERS: 04:00–10:00 ET, every 20 minutes. Overnight claims land in this
//     window and a manager waking up should see a true roster.
//   • OTHERWISE: hourly. Deliberately a flat, boring number — a predictable
//     schedule can be reasoned about from a log timestamp, which an adaptive
//     one cannot.
//   • BEFORE A KICKOFF: from two hours out, tightening as lock approaches —
//     5 minutes, then 2 inside the last half hour, then 1 inside the last ten.
//     Inactives are announced ~90 minutes before kickoff, which the 5-minute
//     rung catches; the final rungs exist for the manager still editing at
//     lock.
//
// They compose by MINIMUM, not by precedence, and that is load-bearing rather
// than tidy: London games kick at 9:30am ET, so their two-hour ramp starts at
// 7:30am — INSIDE the waiver window. A precedence order would have had to
// decide which rule "wins" and would have got that case wrong whichever way it
// was written. The tightest applicable cadence is always the safe answer.
//
// ── SCALE, HONESTLY ────────────────────────────────────────────────────────
// Baseline is 36 fires a day (18 waiver + 18 hourly), against 4 before. A
// Sunday with four kickoff windows adds ~38 fires per window, so ~166 for the
// day. A sync pass costs roughly 1.8s per league, so the 1-minute rung is
// comfortable to ~30 leagues and degrades gracefully beyond that: `syncTick` is
// non-reentrant, so an overrunning pass absorbs the next firing rather than
// stacking. The worker logs when a pass outruns its own cadence so that
// degradation is visible rather than inferred.

/** The cadence in force at one instant, and which rule produced it. The reason
 *  is logged, so a stale roster can be diagnosed from the worker's own output
 *  rather than by re-deriving the schedule by hand. */
export interface SyncCadence {
  intervalMs: number;
  reason: string;
}

export const SYNC_IDLE_MS = 60 * 60_000;        // hourly, 10:00–04:00 ET
export const SYNC_WAIVER_MS = 20 * 60_000;      // 04:00–10:00 ET
export const WAIVER_START_ET = 4;
export const WAIVER_END_ET = 10;

/** Tightening rungs before a kickoff, tightest first. `withinMs` is inclusive:
 *  a kickoff exactly two hours out is already on the 5-minute rung. */
export const KICKOFF_RAMP: { withinMs: number; everyMs: number }[] = [
  { withinMs: 10 * 60_000, everyMs: 1 * 60_000 },
  { withinMs: 30 * 60_000, everyMs: 2 * 60_000 },
  { withinMs: 120 * 60_000, everyMs: 5 * 60_000 },
];

/** The hour (0–23) in US Eastern, DST included. `America/New_York` rather than
 *  a fixed offset because the season straddles the November change: a hardcoded
 *  −4 would put the waiver window an hour wrong from the first Sunday in
 *  November onwards, which is exactly the half of the season that decides
 *  playoff seeding.
 *
 *  The `24` guard mirrors `windowFromKickoff` in the worker's scoreboard
 *  reader: Node renders midnight as hour 24 under `hour12: false`, and reading
 *  that as a number puts 00:30 ET outside every window that tests `< 4`. */
export function etHour(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).formatToParts(new Date(ms));
  const hr = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
  return hr === 24 ? 0 : hr;
}

/** Is this instant inside the overnight-waiver window (04:00–10:00 ET)? Start
 *  inclusive, end exclusive — 10:00:00 ET is already back on the hourly rung. */
export function inWaiverWindow(ms: number): boolean {
  const h = etHour(ms);
  return h >= WAIVER_START_ET && h < WAIVER_END_ET;
}

/** How long until the next kickoff still ahead of us, or null if none is.
 *  A game already under way has a kickoff in the past and is not a deadline
 *  any more — the lineup it gates is locked. */
export function msToNextKickoff(nowMs: number, kickoffsMs: readonly number[]): number | null {
  let best: number | null = null;
  for (const k of kickoffsMs) {
    if (!Number.isFinite(k)) continue;
    const lead = k - nowMs;
    if (lead < 0) continue;
    if (best === null || lead < best) best = lead;
  }
  return best;
}

/** THE CADENCE IN FORCE RIGHT NOW.
 *
 *  Every applicable rule is evaluated and the SHORTEST interval wins — see the
 *  London case in the header for why this is a minimum rather than a
 *  precedence chain. */
export function syncCadenceAt(nowMs: number, kickoffsMs: readonly number[] = []): SyncCadence {
  let best: SyncCadence = { intervalMs: SYNC_IDLE_MS, reason: 'hourly' };
  const take = (intervalMs: number, reason: string) => {
    if (intervalMs < best.intervalMs) best = { intervalMs, reason };
  };

  if (inWaiverWindow(nowMs)) take(SYNC_WAIVER_MS, 'waiver window 04:00-10:00 ET');

  const lead = msToNextKickoff(nowMs, kickoffsMs);
  if (lead !== null) {
    for (const rung of KICKOFF_RAMP) {
      if (lead <= rung.withinMs) {
        take(rung.everyMs, `kickoff in ${Math.round(lead / 60_000)}m`);
        break;                      // rungs are tightest-first; the first fit is the tightest
      }
    }
  }
  return best;
}
