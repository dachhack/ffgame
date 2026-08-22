// Guard for THE WINDOW STATE MACHINE (core windowPhase, v0.340.1).
//
// Every board renders the same timeline: SETUP until the lock lead, LOCKED
// until kickoff, LIVE for four hours, then FINAL. Until v0.340.1 that machine
// existed three times — the web's liveWinState useMemo, the app's FINAL
// lambda (with its own copy of the 4-hour literal), and the app's kicked
// check — the same hand-synced shape the scoring rules were in before
// scoringRules.ts. Now all three call core's windowPhase, and this file pins
// the machine's boundaries EXACTLY, because every transition is user-visible:
// LOCKED is when editing stops, LIVE is when the reveal happens, FINAL is
// when the board collapses and the week settles.
// Run: npx tsx scripts/check-window-phase.mjs
import {
  windowPhase, setRuntimeSlate, setTestTimeline, testTimelineOn, windowKickoffMs,
  LOCK_LEAD_MS, GAME_WINDOW_MS, TEST_LOCK_LEAD_MS, TEST_GAME_MS,
} from '../packages/core/src/data/nflSlate.ts';

let fails = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`);
  if (!cond) fails++;
};

// ── The product numbers themselves ─────────────────────────────────────────
// These ARE the rules managers plan around; a casual retune should read as a
// deliberate edit here, not a silent constant change.
ok(LOCK_LEAD_MS === 3_600_000, 'a window locks ONE HOUR before kickoff');
ok(GAME_WINDOW_MS === 4 * 3_600_000, 'a window reads live for FOUR HOURS after kickoff');

// ── A real-shaped week: one game with a known kickoff ──────────────────────
const WEEK = 901;
const K = Date.UTC(2025, 8, 14, 17, 0, 0); // a Sunday 1pm ET kickoff
setRuntimeSlate(WEEK, [{ away: 'KC', home: 'LV', aScore: 0, hScore: 0, win: 'early', kickoff: K }]);
const win = 'early';
const at = (ms, opts) => windowPhase(WEEK, win, ms, opts);

// ── 1. THE BOUNDARIES, to the millisecond ──────────────────────────────────
// Every one of these instants is a user-visible flip; an off-by-one here is a
// board that locks a second early or reveals a second late.
{
  ok(at(K - LOCK_LEAD_MS - 1) === 'setup', 'one ms before the lock lead: still SETUP (editable)');
  ok(at(K - LOCK_LEAD_MS) === 'locked', 'AT the lock lead: LOCKED — the boundary belongs to locked');
  ok(at(K - 1) === 'locked', 'one ms before kickoff: still LOCKED');
  ok(at(K) === 'live', 'AT kickoff: LIVE — the boundary belongs to live');
  ok(at(K + GAME_WINDOW_MS - 1) === 'live', 'one ms before the four-hour mark: still LIVE');
  ok(at(K + GAME_WINDOW_MS) === 'final', 'AT the four-hour mark: FINAL');
  ok(at(K + 30 * 24 * 3_600_000) === 'final', 'a month later it is still FINAL — no wraparound');
}

// ── 2. THE ADMIN HOLD: an open database never shows a lock ─────────────────
// The server is accepting edits under a hold; a board showing 🔒 (or LIVE)
// over an open database is lying, so EVERY phase reads SETUP.
{
  ok(at(K - 1, { held: true }) === 'setup', 'held: a locked window reads SETUP');
  ok(at(K + 1, { held: true }) === 'setup', 'held: even a kicked window reads SETUP');
  ok(at(K + GAME_WINDOW_MS + 1, { held: true }) === 'setup', 'held: even four hours in');
}

// ── 3. THE WORKER'S FINAL OUTRANKS THE CLOCK ───────────────────────────────
// matchup.status = 'final' means the week is settled; the app shows FINAL on
// every window whatever the time says (an early-settled week must not read
// LIVE for the rest of the afternoon).
{
  ok(at(K - LOCK_LEAD_MS - 1, { matchupFinal: true }) === 'final', 'a settled matchup reads FINAL even pre-lock');
  ok(at(K + 1, { matchupFinal: true }) === 'final', 'and mid-game');
  ok(at(K + 1, { matchupFinal: true, held: true }) === 'final', 'settled beats held — a settled week is not editable');
}

// ── 4. AN UNKNOWN KICKOFF READS SETUP ──────────────────────────────────────
// The web's long-standing behavior: no kickoff data → editable. (The app's
// lock gating ADDITIONALLY fails safe off server-sent kickoff times — that
// policy is deliberately its own, because the DB trigger is the authority.)
{
  ok(windowPhase(902, 'early', Date.now()) === 'setup', 'a week with no slate reads SETUP');
  ok(windowPhase(902, 'early', Date.now(), { matchupFinal: true }) === 'final', 'unless the worker settled it');
}

// ── 5. THE LIVE-TEST TIMELINE compresses the same machine ──────────────────
// Test mode plays the whole flow out in minutes; the transitions must use the
// COMPRESSED lead and duration, or the rehearsal locks an hour early.
{
  const anchor = Date.UTC(2025, 8, 1, 12, 0, 0);
  setTestTimeline(anchor);
  ok(testTimelineOn(), 'test timeline armed');
  // 'early' — the ONE window this week's single-game slate derives. (This
  // probe first asked for 'tnf', which does not exist in a derived one-window
  // week, got a null kickoff, and failed for a reason that had nothing to do
  // with test mode — the machine handles unknown windows, fixtures must not.)
  const tk = windowKickoffMs(WEEK, win);
  ok(tk != null && tk > anchor, 'test mode invents a compressed kickoff');
  ok(windowPhase(WEEK, win, tk - TEST_LOCK_LEAD_MS - 1) === 'setup', 'compressed lead: setup one ms before it');
  ok(windowPhase(WEEK, win, tk - TEST_LOCK_LEAD_MS) === 'locked', 'compressed lead: locked at one MINUTE out, not one hour');
  ok(windowPhase(WEEK, win, tk) === 'live', 'kickoff still flips to live');
  ok(windowPhase(WEEK, win, tk + TEST_GAME_MS) === 'final', 'final after the compressed two minutes, not four hours');
  setTestTimeline(null);
  ok(!testTimelineOn(), 'test timeline disarmed — later suites see the real clock');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL WINDOW-PHASE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
