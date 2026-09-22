// THE WAIVER SCHEDULE (0337, 0338) — one day, one mode, both consoles.
//
// Founder: "I think we've got conflicting logic in waivers." We had three
// day-pickers — the run's days, free agency's days, and the days adds wait for
// the run — answering one question between them, in an order neither console
// stated. It is asked once now, per day, with four answers.
//
// 0338, the same founder a day later: "looks like the three waiver selections
// can conflict with the daily schedule?" They could. The schedule stopped its
// three pickers contradicting EACH OTHER and left the controls ABOVE it —
// ROLLING 24H, HOLD, AFTER GAMES CLEAR — free to promise a run the schedule
// never holds. So the second half of that rule lives here: what each control
// can mean given the others, which readings are honest, and what to say when
// one of them cannot be honoured. Both consoles ask this file rather than
// deciding for themselves, and scripts/check-waiver-days.mjs pins the answers.

export type WaiverDayMode = 'fa' | 'waivers' | 'waivers_to_fa' | 'locked';

/** Sunday first — `extract(dow)`'s order. */
export const WAIVER_DAY_MODES: readonly WaiverDayMode[] = ['fa', 'waivers', 'waivers_to_fa', 'locked'];

export const WAIVER_MODE_LABEL: Record<WaiverDayMode, string> = {
  fa: 'FREE AGENCY',
  waivers: 'WAIVERS',
  waivers_to_fa: 'WAIVERS TO FA',
  locked: 'LOCKED',
};

/** One line each, in the words the rest of fantasy football uses for them. */
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
 *  picked up once the claims have been decided. The standard week. */
export const DEFAULT_WAIVER_DAYS: readonly WaiverDayMode[] =
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

/** THE MODES A LEAGUE CAN ACTUALLY SAY (0338).
 *
 *  WAIVERS TO FA means "the run decides today's claims, and then the leftovers
 *  are free agents". A league on ROLLING 24H has no run: each dropped player
 *  clears 24 hours after HIS drop, on his own clock, and there is no moment in
 *  the day when today's claims have been decided. So the mode has nothing to
 *  name, and offering it is how the old bug got back in — the door opened at
 *  3:00am, a time that appears nowhere in such a league's settings, on a run
 *  that never happened. Three modes when rolling, four when there is a run. */
export function waiverDayModesFor(clearMin: number | null): readonly WaiverDayMode[] {
  return clearMin == null ? ['fa', 'waivers', 'locked'] : WAIVER_DAY_MODES;
}

/** The next mode in the ring — the compact editor both consoles use. Rings
 *  through the modes this league can say, so the rolling case simply never
 *  lands on WAIVERS TO FA. */
export function nextWaiverMode(m: WaiverDayMode, clearMin: number | null = 180): WaiverDayMode {
  const ring = waiverDayModesFor(clearMin);
  const i = ring.indexOf(m);
  return ring[(i + 1) % ring.length];          // -1 + 1 = 0: an unsayable mode rings to the first
}

/** A stored schedule read for a league as it is configured NOW. A league that
 *  set WAIVERS TO FA days and then moved to ROLLING 24H keeps the rows; they
 *  read as WAIVERS, which is what the database does with them (0338's
 *  `fa_window_open_at`) — the shut half of the pair, because a door that opens
 *  on a run nobody runs is the bug, and a door that stays shut is a setting. */
export function normalizeWaiverDays(days: readonly WaiverDayMode[], clearMin: number | null): WaiverDayMode[] {
  const ok = new Set(waiverDayModesFor(clearMin));
  return days.map((m) => (ok.has(m) ? m : 'waivers'));
}

/** Does the run visit this day? The client's copy of `league_waiver_day_clears`
 *  for a league with an explicit schedule: the day that promises a run is the
 *  day the run happens. */
export function dayClears(m: WaiverDayMode): boolean {
  return m === 'waivers' || m === 'waivers_to_fa';
}

/** WHERE THE AFTER-GAMES HOLD ACTUALLY LANDS (0338).
 *
 *  "Players dropped once the games start stay on waivers until Wednesday" is a
 *  promise about a RUN. Pick a Wednesday the schedule spends as FREE AGENCY or
 *  LOCKED and there is no run that morning to decide anybody — the hold would
 *  expire on nothing, which is the same shape of bug as a door opening on a
 *  run that never happened. So the hold rolls forward to the first day at or
 *  after the chosen one that the schedule does clear. Null when the schedule
 *  clears no day at all: then there is no run all week and the rule cannot
 *  apply, so each player keeps his own hold. */
export function effectiveGameHoldDow(days: readonly WaiverDayMode[], dow: number | null): number | null {
  if (dow == null) return null;
  for (let i = 0; i < 7; i++) {
    const d = (dow + i) % 7;
    if (dayClears(days[d])) return d;
  }
  return null;
}

/** THE HOLD, SAID HONESTLY. Hold days count RUNS — "wait for the second run
 *  after the drop" — so with no daily run there is nothing for them to count,
 *  and the database gives a rolling league a flat 24 hours whatever the number
 *  says (0126, unchanged). A console offering 2 DAYS and 3 DAYS there is
 *  offering settings that do nothing. */
export function holdLine(clearMin: number | null, holdDays: number): string {
  if (clearMin == null) {
    return holdDays === 0
      ? 'Rolling: a dropped player is a free agent the moment he is dropped.'
      : 'Rolling: each dropped player clears exactly 24h after his own drop.';
  }
  const at = etTime(clearMin);
  return holdDays === 0
    ? `Daily: a dropped player is free immediately; claims resolve at the ${at} run.`
    : `Daily: a dropped player clears at the ${at} run${holdDays > 1 ? `, ${holdDays} runs after the drop` : ' on the next day the run visits'}.`;
}

/** WHAT THIS COMBINATION CANNOT DO (0338).
 *
 *  The schedule made the three old day-pickers agree with each other. This is
 *  the other half: the controls around it — the run mode, the hold, the
 *  after-games day, the free-agency switch — say things the schedule may not
 *  be able to honour. Rather than silently picking a winner (which is how a
 *  commissioner ends up with a league that behaves unlike its own settings
 *  screen), every console prints these, in the order a reader meets them.
 *
 *  'warn' is a setting that will not do what it says. 'info' is a setting that
 *  is simply redundant. Nothing here blocks a save: they all have a defined
 *  reading, and the reading is what the text names. */
export interface WaiverConflict { level: 'warn' | 'info'; text: string }

export function waiverConflicts(cfg: {
  days: readonly WaiverDayMode[];
  clearMin: number | null;
  holdDays: number;
  gameHoldDow: number | null;
  faMode: 'open' | 'window' | 'off';
  faStart?: number | null;
  faEnd?: number | null;
}): WaiverConflict[] {
  const { days, clearMin, holdDays, gameHoldDow, faMode } = cfg;
  const out: WaiverConflict[] = [];
  const named = (pred: (m: WaiverDayMode) => boolean) => days
    .map((m, i) => (pred(m) ? DAY_LABEL[i][0] + DAY_LABEL[i].slice(1, 3).toLowerCase() : null))
    .filter(Boolean).join(', ');

  // 1. The run mode against the schedule's two-stage days.
  if (clearMin == null) {
    const wf = named((m) => m === 'waivers_to_fa');
    if (wf) out.push({ level: 'warn', text: `ROLLING 24H has no run for a day to clear AT, so WAIVERS TO FA has no moment to open on — ${wf} read as WAIVERS. Switch to DAILY AT A SET TIME to use them.` });
  }

  // 2. The hold against the run mode. Hold days count runs; rolling has none.
  if (clearMin == null && holdDays > 1) {
    out.push({ level: 'info', text: `HOLD counts RUNS, and ROLLING 24H has none — ${holdDays} DAYS reads the same as 1 DAY here: a flat 24h from the drop.` });
  }

  // 3. The after-games day against the schedule's run days.
  if (gameHoldDow != null) {
    const eff = effectiveGameHoldDow(days, gameHoldDow);
    const nm = (d: number) => DAY_LABEL[d][0] + DAY_LABEL[d].slice(1).toLowerCase();
    if (eff == null) {
      out.push({ level: 'warn', text: `AFTER GAMES, CLEAR names ${nm(gameHoldDow)}, but the schedule has no day the run visits at all — the after-games hold cannot apply and each player keeps his own hold.` });
    } else if (eff !== gameHoldDow) {
      out.push({ level: 'warn', text: `AFTER GAMES, CLEAR names ${nm(gameHoldDow)}, which the schedule spends as ${WAIVER_MODE_LABEL[days[gameHoldDow]]} — no run that morning, so the hold lands on ${nm(eff)} instead.` });
    }
  }

  // 4. The league-wide free-agency switch against the days that open a door.
  if (faMode === 'off') {
    const open = named((m) => m === 'fa' || m === 'waivers_to_fa');
    if (open) out.push({ level: 'warn', text: `FREE AGENCY is NONE — WAIVERS ONLY, which overrules the schedule: ${open} cannot open a door. Every unowned player is a claim, every day.` });
  }

  // 5. The daily window against the run it is supposed to follow. A window
  //    that has closed by the time the run speaks leaves a WAIVERS TO FA day
  //    with no open minutes — the door is technically unlocked at an hour the
  //    league does not have.
  if (faMode === 'window' && clearMin != null && cfg.faEnd != null && cfg.faStart != null) {
    const wf = named((m) => m === 'waivers_to_fa');
    const closesBefore = cfg.faEnd > cfg.faStart ? cfg.faEnd <= clearMin : false;  // an overnight window wraps past the run
    if (wf && closesBefore) {
      out.push({ level: 'warn', text: `The free-agency window closes at ${etTime(cfg.faEnd)}, before the ${etTime(clearMin)} run — ${wf} never reach an open minute.` });
    }
  }

  return out;
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
  rawDays: WaiverDayMode[], clearMin: number | null, rawGameHoldDow: number | null,
): string {
  // Read as the league is configured, not as the rows were typed: a stored
  // WAIVERS TO FA in a rolling league is a WAIVERS day, and an after-games day
  // the run does not visit is the next one it does (0338).
  const days = normalizeWaiverDays(rawDays, clearMin);
  const gameHoldDow = effectiveGameHoldDow(days, rawGameHoldDow);
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
      DAY_LABEL[gameHoldDow][0] + DAY_LABEL[gameHoldDow].slice(1).toLowerCase()} ${at ?? etTime(180)}`);
  }
  return parts.join(' · ');
}

/** ── WHEN HE CLEARS, AS A DAY (0341) ────────────────────────────────────────
 *
 *  Founder, over Sleeper's player list: "Waivers in sleeper have the date the
 *  player clears." Ours printed a COUNTDOWN — `⏳ 6h 12m` — which is a worse
 *  answer to the same question in every way that matters. A countdown has to
 *  be read and converted before it means anything ("6h 12m from 9:52pm is…"),
 *  it is wrong the moment the screen sleeps, and at 30 hours it stops being a
 *  duration a person can picture at all. A weekday is none of those: `W (Wed)`
 *  is the answer, already converted, and it stays true while you read it.
 *
 *  TODAY and TOMORROW are named rather than dated, because that is how the
 *  answer is used — "can I have him tonight?" — and a bare "Tue" on a Monday
 *  makes you count. Beyond that the weekday IS the date at this range: a hold
 *  never runs a week, so a day name cannot be ambiguous.
 *
 *  Null when he is already free: the caller draws no badge at all rather than
 *  a badge saying nothing, which is the difference between a wire that reads
 *  as a list of players and one that reads as a list of locks. */
export function clearsOn(until: string | null | undefined, now: number = Date.now()): { day: string; short: string } | null {
  if (!until) return null;
  const at = Date.parse(until);
  if (!Number.isFinite(at) || at <= now) return null;
  // Compare CALENDAR days in the viewer's own zone, not elapsed hours: a hold
  // ending at 3am Wednesday is "Wed" from Tuesday lunchtime and from Tuesday
  // 11pm alike, and `(at - now) / 86400000` would call the second one "today".
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const d1 = new Date(at); d1.setHours(0, 0, 0, 0);
  const days = Math.round((d1.getTime() - d0.getTime()) / 86_400_000);
  if (days <= 0) return { day: 'today', short: 'today' };
  if (days === 1) return { day: 'tomorrow', short: 'tmrw' };
  const i = new Date(at).getDay();
  const full = DAY_LABEL[i];
  return { day: full[0] + full.slice(1).toLowerCase(), short: full.slice(0, 3)[0] + full.slice(1, 3).toLowerCase() };
}
