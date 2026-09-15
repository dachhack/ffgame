// ▦ WHICH WEEK THE FIELDS SHOW (v0.390.0).
//
// Founder: "Let's put fields on the upper left at the top of the my leagues
// page." Off a board there is no matchup to borrow a week from, so the
// leagues page asks the slate: the week whose FIRST kickoff is the latest
// one already past — what's on now, or what just happened — and it stays
// there until the next week's opener kicks off. Before any kickoff (the
// dead days of August) it is the earliest week the slate knows. Ordered by
// kickoff, not week number, so a preseason board week (101+) and week 1
// compare by when they actually played.
export interface SlateWeekRow { week: number; kickoff?: string | number | null }

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
  for (const [week, ms] of first) {
    if (ms <= nowMs && ms > bestMs) { best = week; bestMs = ms; }
    if (ms < earliestMs) { earliest = week; earliestMs = ms; }
  }
  return best ?? earliest;
}
