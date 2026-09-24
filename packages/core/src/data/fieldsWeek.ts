// ▦ WHICH WEEK THE FIELDS SHOW (v0.390.0, v0.506.0).
//
// Founder: "Let's put fields on the upper left at the top of the my leagues
// page." Off a board there is no matchup to borrow a week from, so the
// leagues page asks the slate: the latest week already under way — what's on
// now, or what just happened. A week is under way from the Wednesday 3 AM ET
// before its first kickoff (v0.506.0; it used to be the kickoff itself). Before any kickoff (the
// dead days of August) it is the earliest week the slate knows. Ordered by
// kickoff, not week number, so a preseason board week (101+) and week 1
// compare by when they actually played.
export interface SlateWeekRow { week: number; kickoff?: string | number | null }

// THE WEEK TURNS OVER ON WEDNESDAY (v0.506.0). Founder, on the fields widget
// still showing week 2 on a Thursday morning: "It should move to the next
// week on Wednesday early AM." A week used to begin at its FIRST KICKOFF, so
// from Monday night to Thursday night the fields showed a week that was over.
// Now a week begins at 3:00 AM ET on the Wednesday before its first kickoff —
// Tuesday stays on the week just played (Monday night's game, the waiver
// wire), Wednesday is the new week's slate, waiting to kick.
const TURN_HOUR_ET = 3;
const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** 3:00 AM ET on the latest Wednesday at or before `ms`. */
export function weekTurnBefore(ms: number): number {
  const parts = Object.fromEntries(et.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const dow = DOW[parts.weekday] ?? 0;
  const secsIntoDay = Number(parts.hour) * 3600 + Number(parts.minute) * 60 + Number(parts.second);
  let daysBack = (dow - 3 + 7) % 7;
  if (daysBack === 0 && secsIntoDay < TURN_HOUR_ET * 3600) daysBack = 7;
  return ms - (daysBack * 86400 + secsIntoDay - TURN_HOUR_ET * 3600) * 1000;
}

export function fieldsWeekFrom(rows: SlateWeekRow[], nowMs: number): number | null {
  const first = new Map<number, number>();
  for (const r of rows) {
    const ms = r.kickoff == null ? NaN : typeof r.kickoff === 'number' ? r.kickoff : Date.parse(r.kickoff);
    if (!Number.isFinite(ms)) continue;
    const cur = first.get(r.week);
    if (cur == null || ms < cur) first.set(r.week, ms);
  }
  if (!first.size) return null;
  let best: number | null = null, bestMs = -Infinity;
  let earliest: number | null = null, earliestMs = Infinity;
  for (const [week, kick] of first) {
    const start = weekTurnBefore(kick);
    if (start <= nowMs && start > bestMs) { best = week; bestMs = start; }
    if (start < earliestMs) { earliest = week; earliestMs = start; }
  }
  return best ?? earliest;
}

/** The slate's weeks in the order they are played (by first kickoff) — what
 *  the fields widget's ‹ › step through (v0.506.0). */
export function slateWeekOrder(rows: SlateWeekRow[]): number[] {
  const first = new Map<number, number>();
  for (const r of rows) {
    const ms = r.kickoff == null ? NaN : typeof r.kickoff === 'number' ? r.kickoff : Date.parse(r.kickoff);
    if (!Number.isFinite(ms)) continue;
    const cur = first.get(r.week);
    if (cur == null || ms < cur) first.set(r.week, ms);
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([w]) => w);
}
