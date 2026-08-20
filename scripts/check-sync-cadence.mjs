// SYNC CADENCE (v0.319.0), checked in Node against fixed instants.
//
// This is in check:parity because it is the class of code that cannot be tested
// by running it: a schedule is only observably wrong a week into the season, at
// which point the cost is a stale lineup at lock. Every case below pins a
// specific instant, so "does 4am ET still mean 4am ET in January" is a test
// rather than a hope.
//
// The cases that earn their keep: the two boundaries of the waiver window (both
// exclusive/inclusive ends), that DST does not move it, that the kickoff ramp
// tightens in the right order, that a LONDON game — which kicks at 9:30am ET,
// inside the waiver window — takes the tighter of the two rules, and that a
// game already under way stops being a deadline.
import {
  syncCadenceAt, etHour, inWaiverWindow, msToNextKickoff,
  SYNC_IDLE_MS, SYNC_WAIVER_MS, KICKOFF_RAMP,
} from '../packages/core/src/data/syncCadence';

let fails = 0;
const ok = (name, cond, got) => {
  if (!cond) { fails++; console.log(`FAIL ${name}${got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); }
  else console.log(`ok   ${name}`);
};
const MIN = 60_000;
/** An instant, written in ET so the test reads like the founder's spec. EDT is
 *  −04:00 (Mar–Nov), EST is −05:00 — spelled out rather than computed, because
 *  a test that derives the offset the same way the code does proves nothing. */
const et = (iso) => Date.parse(iso);

// ── THE CLOCK ITSELF ───────────────────────────────────────────────────────
ok('4am ET in September reads as hour 4', etHour(et('2026-09-09T04:00:00-04:00')) === 4);
ok('4am ET in January reads as hour 4 too (EST, not a fixed offset)',
  etHour(et('2027-01-13T04:00:00-05:00')) === 4);
ok('midnight ET reads as 0, not 24 (the Intl hour12:false quirk)',
  etHour(et('2026-09-09T00:30:00-04:00')) === 0, etHour(et('2026-09-09T00:30:00-04:00')));

// ── THE WAIVER WINDOW ──────────────────────────────────────────────────────
ok('03:59 ET is not yet the waiver window', !inWaiverWindow(et('2026-09-09T03:59:00-04:00')));
ok('04:00 ET is (start inclusive)', inWaiverWindow(et('2026-09-09T04:00:00-04:00')));
ok('09:59 ET still is', inWaiverWindow(et('2026-09-09T09:59:00-04:00')));
ok('10:00 ET is not (end exclusive)', !inWaiverWindow(et('2026-09-09T10:00:00-04:00')));
// THE CASE A FIXED −4 OFFSET WOULD FAIL. After the November change, 4am ET is
// 09:00 UTC rather than 08:00; a hardcoded offset would run the waiver window
// an hour late for the entire second half of the season.
ok('the window does not drift when DST ends',
  inWaiverWindow(et('2026-11-18T04:00:00-05:00')) && !inWaiverWindow(et('2026-11-18T03:59:00-05:00')));

// ── THE THREE RULES IN ISOLATION ───────────────────────────────────────────
{
  const noon = et('2026-09-09T12:00:00-04:00');          // Wednesday, no games
  ok('a quiet afternoon is hourly', syncCadenceAt(noon, []).intervalMs === SYNC_IDLE_MS);
  const dawn = et('2026-09-09T05:00:00-04:00');
  ok('the waiver window is every 20 minutes', syncCadenceAt(dawn, []).intervalMs === SYNC_WAIVER_MS);
  ok('…and says so, because the log is the diagnosis',
    /waiver/.test(syncCadenceAt(dawn, []).reason), syncCadenceAt(dawn, []).reason);
}

// ── THE KICKOFF RAMP ───────────────────────────────────────────────────────
{
  const kick = et('2026-09-13T13:00:00-04:00');          // Sunday 1pm ET
  const at = (minsBefore) => syncCadenceAt(kick - minsBefore * MIN, [kick]).intervalMs;
  ok('3 hours out is still hourly', at(180) === SYNC_IDLE_MS, at(180));
  ok('exactly 2 hours out is on the 5-minute rung (inclusive)', at(120) === 5 * MIN, at(120));
  ok('90 minutes out — when inactives drop — is 5 minutes', at(90) === 5 * MIN, at(90));
  ok('31 minutes out is still 5 minutes', at(31) === 5 * MIN, at(31));
  ok('30 minutes out tightens to 2', at(30) === 2 * MIN, at(30));
  ok('11 minutes out is still 2', at(11) === 2 * MIN, at(11));
  ok('10 minutes out tightens to 1', at(10) === 1 * MIN, at(10));
  ok('a minute before lock is 1', at(1) === 1 * MIN, at(1));
  ok('the ramp only ever tightens', (() => {
    let prev = Infinity;
    for (let m = 180; m >= 0; m--) { const v = at(m); if (v > prev) return false; prev = v; }
    return true;
  })());
}

// ── A GAME ALREADY UNDER WAY IS NOT A DEADLINE ─────────────────────────────
{
  const kick = et('2026-09-13T13:00:00-04:00');
  const during = kick + 40 * MIN;                        // second quarter
  ok('a kickoff in the past stops driving the cadence',
    syncCadenceAt(during, [kick]).intervalMs === SYNC_IDLE_MS, syncCadenceAt(during, [kick]).intervalMs);
  ok('…and msToNextKickoff ignores it', msToNextKickoff(during, [kick]) === null);
  // …but the NEXT window is a deadline again.
  const late = et('2026-09-13T16:25:00-04:00');
  ok('the late window pulls the ramp back on', syncCadenceAt(during, [kick, late]).intervalMs === SYNC_IDLE_MS);
  ok('…once it is inside two hours', syncCadenceAt(late - 90 * MIN, [kick, late]).intervalMs === 5 * MIN);
  ok('the NEAREST upcoming kickoff wins, not the first in the list',
    msToNextKickoff(kick - 200 * MIN, [late, kick]) === 200 * MIN);
}

// ── THE LONDON CASE: THE RULES COMPOSE BY MINIMUM ──────────────────────────
// A 9:30am ET kickoff puts its two-hour ramp at 7:30am — INSIDE the waiver
// window. This is why the rules take a minimum rather than a precedence order:
// either precedence would be wrong here for one of the two rules.
{
  const london = et('2026-10-04T09:30:00-04:00');
  const t = et('2026-10-04T08:00:00-04:00');             // 90m out, and in the window
  ok('the London ramp overlaps the waiver window', inWaiverWindow(t) && london - t <= 120 * MIN);
  ok('…and the TIGHTER rule wins', syncCadenceAt(t, [london]).intervalMs === 5 * MIN,
    syncCadenceAt(t, [london]));
  ok('…which is the kickoff, not the waiver', /kickoff/.test(syncCadenceAt(t, [london]).reason));
  // And inside ten minutes of a London kickoff it is a minute, not twenty.
  const t2 = london - 5 * MIN;
  ok('a London lock still gets the 1-minute rung', syncCadenceAt(t2, [london]).intervalMs === 1 * MIN);
}

// ── DEGENERATE INPUT MUST NOT WIDEN THE CADENCE ────────────────────────────
{
  const dawn = et('2026-09-09T05:00:00-04:00');
  ok('no fixtures at all still honours the waiver window',
    syncCadenceAt(dawn).intervalMs === SYNC_WAIVER_MS);
  ok('NaN kickoffs are ignored rather than poisoning the comparison',
    syncCadenceAt(dawn, [NaN, undefined, null]).intervalMs === SYNC_WAIVER_MS);
  ok('a bye week (empty slate) is hourly, not never',
    syncCadenceAt(et('2026-09-09T12:00:00-04:00'), []).intervalMs === SYNC_IDLE_MS);
}

// ── THE SHAPE OF THE RAMP TABLE ────────────────────────────────────────────
ok('the ramp is declared tightest-first, which the lookup relies on',
  KICKOFF_RAMP.every((r, i) => i === 0 || r.withinMs > KICKOFF_RAMP[i - 1].withinMs));
ok('…and every rung is tighter than the idle cadence',
  KICKOFF_RAMP.every((r) => r.everyMs < SYNC_IDLE_MS));

// ── THE DAILY BUDGET, SO A COST REGRESSION IS VISIBLE ──────────────────────
// Counting the fires a quiet Wednesday produces pins the founder's spec in the
// one unit that matters operationally. 6h at 20m + 18h at 60m = 36.
{
  let fires = 0, t = et('2026-09-09T00:00:00-04:00');
  const end = t + 24 * 3600e3;
  while (t < end) { fires++; t += syncCadenceAt(t, []).intervalMs; }
  ok('a quiet day is 36 syncs (18 waiver + 18 hourly), against 4 before', fires === 36, fires);
}

if (fails) { console.log(`\n${fails} SYNC-CADENCE ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL SYNC-CADENCE ASSERTIONS PASSED');
