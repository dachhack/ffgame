// THE WAIVER SCHEDULE (0337) — one day, one mode, both consoles.
//
// Founder, holding Sleeper's settings screen next to ours: "I think we've got
// conflicting logic in waivers." We had three day-pickers — the run's days,
// free agency's days, and the days adds wait for the run — answering one
// question between them, in an order neither console stated. Sleeper asks it
// once, per day, with four answers. So do we.
//
// The words are Sleeper's own, because a commissioner comparing the two
// screens should not have to work out which of our phrasings means his.

export type WaiverDayMode = 'fa' | 'waivers' | 'waivers_to_fa' | 'locked';

/** Sunday first — `extract(dow)`'s order, and Sleeper's list order. */
export const WAIVER_DAY_MODES: readonly WaiverDayMode[] = ['fa', 'waivers', 'waivers_to_fa', 'locked'];

export const WAIVER_MODE_LABEL: Record<WaiverDayMode, string> = {
  fa: 'FREE AGENCY',
  waivers: 'WAIVERS',
  waivers_to_fa: 'WAIVERS TO FA',
  locked: 'LOCKED',
};

/** Sleeper's own one-line description of each. */
export const WAIVER_MODE_HINT: Record<WaiverDayMode, string> = {
  fa: 'Players are free agents for the entire day.',
  waivers: 'Players clear waivers once. Other FA remain on waivers after.',
  waivers_to_fa: 'Players clear waivers once, then become FA for rest of day.',
  locked: 'No FA pickups allowed. No players clear waivers.',
};

export const DAY_LABEL = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'] as const;
export const DAY_SHORT = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

/** What a league that has never said anything runs: waivers all week, Sunday
 *  clearing to free agency at the morning run so the day's streamers can be
 *  picked up once the claims have been decided. Sleeper's own default. */
export const SLEEPER_WAIVER_DAYS: readonly WaiverDayMode[] =
  ['waivers_to_fa', 'waivers', 'waivers', 'waivers', 'waivers', 'waivers', 'waivers'];

/** Read seven modes out of whatever the server sent. Anything missing or
 *  unrecognised reads as a waivers day — the safe half of the pair, since it
 *  withholds a player rather than handing him out. */
export function waiverDaysOf(raw: unknown): WaiverDayMode[] {
  const arr = Array.isArray(raw) ? raw : [];
  return Array.from({ length: 7 }, (_, i) => {
    const v = arr[i];
    return (WAIVER_DAY_MODES as readonly string[]).includes(v as string) ? (v as WaiverDayMode) : 'waivers';
  });
}

/** The next mode in the ring — the compact editor both consoles use, where
 *  Sleeper has the room for a sheet per day. */
export function nextWaiverMode(m: WaiverDayMode): WaiverDayMode {
  const i = WAIVER_DAY_MODES.indexOf(m);
  return WAIVER_DAY_MODES[(i + 1) % WAIVER_DAY_MODES.length];
}

/** Minutes past midnight ET → "3:00am". */
export function etTime(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ap = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')}${ap}`;
}

/** The schedule as a sentence, for the rulebook — the same reading in both
 *  hosts, and the one place the four modes are turned into prose. */
export function waiverScheduleLine(
  days: WaiverDayMode[], clearMin: number | null, gameHoldDow: number | null,
): string {
  const at = clearMin == null ? null : etTime(clearMin);
  const group = (mode: WaiverDayMode) => days
    .map((m, i) => (m === mode ? DAY_LABEL[i][0] + DAY_LABEL[i].slice(1, 3).toLowerCase() : null))
    .filter(Boolean).join(', ');
  const parts: string[] = [];
  const fa = group('fa'), wv = group('waivers'), wf = group('waivers_to_fa'), lk = group('locked');
  if (wv) parts.push(`${wv}: waivers${at ? ` clearing at ${at} ET` : ''}`);
  if (wf) parts.push(`${wf}: waivers, then free agency${at ? ` after the ${at} run` : ''}`);
  if (fa) parts.push(`${fa}: free agency all day`);
  if (lk) parts.push(`${lk}: locked — nothing moves`);
  if (gameHoldDow != null && DAY_LABEL[gameHoldDow]) {
    parts.push(`players dropped once the games start stay on waivers until ${
      DAY_LABEL[gameHoldDow][0] + DAY_LABEL[gameHoldDow].slice(1).toLowerCase()}${at ? ` ${at}` : ''}`);
  }
  return parts.join(' · ');
}
