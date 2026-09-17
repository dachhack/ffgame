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

// Spelled out, because the plural is the point: "Thu" + "s" is "Thus", which
// is a word, which is how a typo of this shape survives a read-through.
const DAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** "10 AM" / "2:30 PM" from a minute of the ET day. */
function fmtMin(m: number): string {
  const h = Math.floor(m / 60) % 24, mm = m % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${mm ? `:${String(mm).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * The league's waiver schedule, said in one sentence (v0.405.0).
 *
 * Founder: "i changed waivers to clear at 2pm tomorrow (thursday) but this
 * still says they clear at 4am." Part of why that was only discoverable by
 * staring at a claim is that the card said "Waivers clear DAILY at …" whatever
 * the day set was — so a league clearing once a week described itself as a
 * league clearing every day, and the one place the schedule appeared was
 * wrong. This says the days it actually runs.
 *
 * `clearMin` null is the rolling league: no run to name, 24h from each drop.
 */
export function waiverScheduleText(
  clearMin: number | null | undefined,
  clearDow: number[] | null | undefined,
  holdDays: number | null | undefined,
): string {
  const hold = `${holdDays ?? 1}-day hold`;
  if (clearMin == null) return `Waivers roll — a dropped player clears 24h later (${hold}).`;
  const days = Array.isArray(clearDow) && clearDow.length
    ? clearDow.filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b).map((d) => DAY_PLURAL[d]).join(' & ')
    : null;
  return `Waivers clear ${days ?? 'daily'} at ${fmtMin(clearMin)} ET (${hold}).`;
}
