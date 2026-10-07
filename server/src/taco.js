// THE TACO LOCKER (v0.647.0, founder: "A commish can lock a team from making
// trades or dropping players. We also leverage the AI team rules to auto-set
// the best lineup for that team on Thursday AM est").
//
// The lock itself is 0320's per-team lock (league_membership.wire_locked):
// every drop, add, claim and trade already asks team_lock_reason. This module
// is the CLOCK for the other half — WHEN the worker sets a locked team's
// lineup — kept pure so the rule is testable without a database or a tick.
//
// THE RULE. Once per board week, from Thursday 9:00 AM Eastern: the first tick
// at or after that moment re-plans the team's lineup exactly as an AI seat's
// (lock.js — the agent branch, aiValueOf, every unlocked spot; a player whose
// game has started stands). The seat's taco_set_week is stamped with the
// week, so the set happens once, and a worker that was down at nine sets it
// on the first tick it is back — Thursday night, Sunday morning, whenever —
// until the week rolls on Tuesday. Tuesday and Wednesday are the manager's:
// waivers run Wednesday, and a lineup set before them would be stale.

/** Thursday morning, Eastern. 9 is after Wednesday's waivers have settled
 *  and before anyone kicks off; early enough that the manager sees the
 *  lineup all day. */
export const TACO_HOUR_ET = 9;

/** The Eastern wall clock for an instant: day of week (0 = Sunday) and hour. */
export function etClock(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false })
    .formatToParts(new Date(ms));
  const wd = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
  return { dow: dow < 0 ? 0 : dow, hour };
}

/** Is a locked team's lineup due to be set NOW for this board week?
 *  `setWeek` is the seat's taco_set_week (the last week the worker set it). */
export function tacoDue(nowMs, week, setWeek) {
  if (setWeek != null && Number(setWeek) >= week) return false;   // this week is done
  const { dow, hour } = etClock(nowMs);
  if (dow === 2 || dow === 3) return false;                        // Tuesday, Wednesday: the manager's
  if (dow === 4) return hour >= TACO_HOUR_ET;                      // Thursday from nine
  return true;                                                     // Friday through Monday: catch-up
}

/** The chat card the house posts when the worker has set a locked team's
 *  lineup. Short, for league members. */
export function tacoLine(team, week) {
  return `🌮 Taco Locker set ${team}'s lineup for week ${week} — the best projected starters, the way an AI team's are set.`;
}
