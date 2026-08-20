// WHICH REGULAR-SEASON WEEK THE WORKER SHOULD KEEP FRESH (v0.320.0).
//
// A pure rule, so the one case that matters — the preseason, which happens once
// a year and is happening right now — can be tested against a fixed instant
// instead of discovered on the first Sunday that counts.
//
// ── THE BUG THIS EXISTS TO FIX ─────────────────────────────────────────────
// `syncWeek` mirrors exactly ONE week, and the worker picks it with
// `regularWeek()`: Sleeper's `/state/nfl` week when it has one, else ESPN's.
// BOTH sources are wrong during the preseason, in different ways, and the
// second section below is the one that was actually biting.
//
// ESPN first. Its regular-season scoreboard, called with no `week` parameter,
// is not answering the question we are asking:
//
//   GET .../scoreboard?dates=2026&seasontype=2
//     → week.number = 3          (on 20 Aug, having been 2 the day before)
//     → 100 events, 2026-01-03 … 2026-09-20 — last season's January playoffs,
//       August PRESEASON games, and September regular-season games in one bag
//
//   GET .../scoreboard?dates=2026&seasontype=2&week=1
//     → week.number = 1, 16 events, 2026-09-10 … 2026-09-15   ← correct
//
// So the un-parameterised number drifts forward with the calendar during
// August. That is a real hazard and rule 2 below neutralises it — but the
// codebase never reached ESPN, because Sleeper answered first.
//
// ── THE HALF THAT WAS ACTUALLY BITING, FOUND BY BOOTING THE WORKER ─────────
// An earlier comment in the worker asserted "Sleeper's /state/nfl week sits at
// 0 all August", and the fix was first written around that belief. Booting the
// worker disproved it in one line — `regular week: 2 (sleeper /state/nfl)` —
// and Sleeper's state says:
//
//   { "week": 2, "season_type": "pre", "display_week": 2, ... }
//
// That 2 is PRESEASON WEEK 2. The old rule read `state.week` without ever
// looking at `season_type`, so a preseason week number was used as a
// regular-season week — which is why regular-season week 2 was being mirrored
// on 20 August. As the preseason runs on it would have written weeks 3 and 4
// for the same reason, and week 1 would have stayed untouched until Sleeper
// flipped to `season_type: "regular"` around 8 September.
//
// So the week is only Sleeper's to give when Sleeper says the REGULAR season is
// what is being played. `pre` and `off` mean "ask someone else".
//
// The lesson is cheap to state and was nearly expensive to miss: the comment
// describing an upstream feed was out of date, and the feed itself took ten
// seconds to ask. Ask the feed.
//
// ── THE RULE ───────────────────────────────────────────────────────────────
// 1. Sleeper's own week, when its season_type says regular (or post).
//    Authoritative then, and it is the source that knows about postponements.
// 2. Otherwise, if the regular season has not kicked off yet, the answer is
//    WEEK 1 — whatever ESPN's drifting number says. Nothing else is playable,
//    and week 1 is the week that must be current the moment it opens.
// 3. Otherwise ESPN's number, clamped to a real regular-season week. The clamp
//    is not decoration: an out-of-range week silently mirrors nothing.
//
// PRESEASON BOARDS ARE UNAFFECTED. Weeks 101-104 are seeded with the whole
// player pool on purpose — every player available for the preseason rehearsal —
// and nothing here writes them. This rule only decides which REGULAR-season
// week gets Sleeper's real rosters.

/** Real regular-season weeks. 18 since 2021; the clamp uses it as the ceiling. */
export const REG_SEASON_WEEKS = 18;

/** Sleeper `/state/nfl` season_type. `pre` and `off` mean its `week` is NOT a
 *  regular-season week and must not be read as one. */
export type SleeperSeasonType = 'pre' | 'regular' | 'post' | 'off' | string;

export interface RegularWeekInputs {
  /** Sleeper `/state/nfl` week. During the preseason this is the PRESEASON
   *  week — 2 on 20 Aug 2026 — which is the trap this module exists for. */
  sleeperWeek?: number | null;
  /** Sleeper's own statement of which season that week belongs to. Absent is
   *  treated as untrusted: a caller that cannot say must not be believed. */
  sleeperSeasonType?: SleeperSeasonType | null;
  /** ESPN's reported current regular-season week. Untrustworthy before the
   *  season starts; see the header. */
  espnWeek?: number | null;
  /** First kickoff of regular-season week 1. Fetched with an explicit `week=1`,
   *  which is the form of the call ESPN answers correctly. */
  week1KickoffMs?: number | null;
  nowMs: number;
}

export interface RegularWeekChoice {
  week: number;
  /** Which rule produced it. Logged, so a wrong week is diagnosable from the
   *  worker's own output rather than by re-deriving three sources by hand. */
  reason: string;
}

export function regularWeekFrom(i: RegularWeekInputs): RegularWeekChoice {
  const sleeper = Number(i.sleeperWeek);
  const st = i.sleeperSeasonType;
  // `post` counts: the playoffs follow week 18 and Sleeper keeps numbering.
  const sleeperIsRegular = st === 'regular' || st === 'post';
  if (sleeperIsRegular && Number.isFinite(sleeper) && sleeper >= 1) {
    return { week: Math.min(REG_SEASON_WEEKS, Math.trunc(sleeper)), reason: `sleeper /state/nfl (${st})` };
  }
  // THE PRESEASON GUARD. Before week 1 kicks off there is exactly one sensible
  // regular-season week to keep current, and it is 1.
  const k1 = Number(i.week1KickoffMs);
  if (Number.isFinite(k1) && i.nowMs < k1) {
    return { week: 1, reason: 'preseason — week 1 has not kicked off' };
  }
  const espn = Number(i.espnWeek);
  if (Number.isFinite(espn) && espn >= 1) {
    return {
      week: Math.min(REG_SEASON_WEEKS, Math.trunc(espn)),
      reason: espn > REG_SEASON_WEEKS ? `espn (clamped from ${Math.trunc(espn)})` : 'espn',
    };
  }
  return { week: 1, reason: 'no source — defaulting to 1' };
}
