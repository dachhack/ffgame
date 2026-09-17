// WHEN DOES MY CLAIM SETTLE? (v0.404.0)
//
// Founder, on a claim that resolved seconds after he made it: "it looks like
// my bid for golden went through immediately." Migration 0289 gave every
// claim a clearing time — the moment free agency next opens, or the league's
// own waiver run where free agency never opens — and native_team_state hands
// it back on each pending row. This turns that instant into the line the
// waiver card shows, so "pending until when" has a visible answer instead of
// being something a manager has to infer from silence.
//
// Shared rather than written twice: the web card and the app card disagreeing
// about what time a claim clears is the kind of difference nobody notices
// until it matters.

const ET = 'America/New_York';

/** ET wall clock, "10:00 AM" / "3 AM" — minutes dropped when they are zero. */
function etTime(d: Date): string {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: ET, hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  const mm = get('minute');
  return `${get('hour')}${mm === '00' ? '' : `:${mm}`} ${get('dayPeriod').toUpperCase()}`;
}

/** ET calendar day, for deciding whether a stamp needs its weekday said. */
function etDay(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function etWeekday(d: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: ET, weekday: 'short' }).format(d);
}

/**
 * "clears 10 AM ET" for today, "clears Thu 3 AM ET" for any other day, and
 * "clearing now" for a time that has already passed — a claim whose clock ran
 * out is waiting on the next sweep, not on the clock, and saying "clears 10 AM"
 * about a moment in the past reads like the screen is stuck.
 *
 * Null in, null out: a claim with no clearing time at all (a pre-0289 row) has
 * nothing honest to say, and a card that renders nothing is better than one
 * that renders a guess.
 */
export function fmtClearsAt(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  if (ms <= nowMs) return 'clearing now';
  const d = new Date(ms);
  const sameDay = etDay(d) === etDay(new Date(nowMs));
  return `clears ${sameDay ? '' : `${etWeekday(d)} `}${etTime(d)} ET`;
}
