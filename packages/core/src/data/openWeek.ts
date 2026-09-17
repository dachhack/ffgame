// WHICH WEEK A MATCHUP SCREEN OPENS ON (v0.401.0).
//
// Founder: "When you go to matchup in a classic league you should go to the
// current week that is to be played if it is Wednesday or later."
//
// TWO THINGS WERE WRONG, and only one of them is this rule.
//
// 1. The APP never asked the question. Its matchup screen called the week-LESS
//    myMatchup, which is `.order('week').limit(1)` — the league's FIRST week,
//    for ever. myMatchupFrom's comment already records this exact bug being
//    found and fixed for the leagues list in v0.364.0; the matchup screen kept
//    the old call. So on a phone you opened week 1 in December.
//
// 2. The web's rule rolled over too early. It held a week until its last
//    kickoff + 4 hours — so the moment Monday Night Football ended, around
//    00:30 ET Tuesday, the screen jumped to next week. Tuesday is when you
//    read what just happened; Wednesday is when you start caring about what is
//    next. The founder's line is the better rule and it is also the simpler
//    one to say.
//
// THE RULE: a week stays open until the first Wednesday 00:00 ET after its
// games are done. Before that you get the week just played; from Wednesday
// you get the week to be played.
//
// A PURE FUNCTION, because the interesting cases are all calendar edges —
// Tuesday 23:59 vs Wednesday 00:01, a week with no Monday game, the November
// DST change, a league whose weeks have no slate at all — and every one of
// them is a fixed instant a test can name rather than a day someone has to
// wait for. check:parity asserts them.

/** A week's first and last kickoff, in epoch ms. */
export interface WeekKicks { first: number; last: number }

/** Games are done this long after the last one KICKS OFF (not ends). */
export const GAME_MS = 4 * 3_600_000;

/** Weekday in US Eastern, 0 = Sunday … 3 = Wednesday. `America/New_York`
 *  rather than a fixed offset: the season straddles the November change, and
 *  a hardcoded −4 would put this an hour wrong for exactly the half of the
 *  season that decides seeding. */
export function etWeekday(ms: number): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' })
    .format(new Date(ms));
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}

/** The hour 0–23 in US Eastern. Node renders midnight as hour 24 under
 *  hour12:false, which would read 00:30 ET as later than every bound — the
 *  same guard syncCadence.etHour carries, for the same reason. */
function etHourOf(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).formatToParts(new Date(ms));
  const hr = Number(parts.find((p) => p.type === 'hour')?.value ?? '12');
  return hr === 24 ? 0 : hr;
}

/** When a week stops being the one you are shown: the first Wednesday 00:00 ET
 *  strictly after its games are done.
 *
 *  Walked an hour at a time rather than computed with date arithmetic, because
 *  "add N days then set midnight" has to be done IN the target zone to survive
 *  a DST change, and stepping until the zone itself reports Wednesday hour 0
 *  is the version that cannot get that wrong. At most ~170 iterations. */
export function weekClosesAt(lastKickoffMs: number): number {
  const HOUR = 3_600_000;
  // Start from the top of the hour after the games are done, then walk.
  let t = Math.ceil((lastKickoffMs + GAME_MS) / HOUR) * HOUR;
  for (let i = 0; i < 24 * 8; i++) {
    if (etWeekday(t) === 3 && etHourOf(t) === 0) return t;
    t += HOUR;
  }
  return t;   // unreachable in practice; never loop for ever over a clock
}

/** The week to open: the first one whose review window has not closed.
 *
 *  `weeks` may be in any order and may include preseason numbers; `kicks` is
 *  keyed by week and may be missing entries. A week with NO known slate sorts
 *  last and is returned rather than skipped — an unscheduled week is the one
 *  thing we cannot say is over. */
export function openWeekFrom(
  weeks: number[],
  kicks: Record<number, WeekKicks>,
  nowMs: number,
  /** Week → every matchup in it is FINAL. v0.407.0; see below. */
  finals: Record<number, boolean> = {},
): number | null {
  if (!weeks.length) return null;
  const ordered = weeks.slice().sort((a, b) =>
    (kicks[a]?.first ?? Infinity) - (kicks[b]?.first ?? Infinity) || a - b);
  for (const w of ordered) {
    const k = kicks[w];
    if (!k) {
      // NO SLATE FOR THIS WEEK (v0.407.0). Founder, on a league whose board
      // still opened on week 1 with "NFL SLATE 0 GAMES" and "all final" under
      // both scores: "still opens to week 1."
      //
      // Without kickoffs the Wednesday rule has nothing to measure, and the
      // old answer — return it, we cannot say it is over — is right for a week
      // that has not been played. It is wrong for one that plainly has. A
      // league whose schedule was rebuilt mid-season (a kickoff league, a
      // converted one) can have real, finished weeks with no slate rows
      // behind them, and that league was pinned to week 1 for the rest of the
      // season with no way to say otherwise.
      //
      // The matchups' own status is the league's answer to "is this week
      // done", and it needs no slate at all. Every one final ⇒ over; anything
      // else ⇒ this is the week.
      if (finals[w]) continue;
      return w;
    }
    if (nowMs < weekClosesAt(k.last)) return w;
  }
  return ordered[ordered.length - 1];
}
