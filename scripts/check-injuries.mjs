// Guard for the injury report's PRECEDENCE rules — the ones the badges and the
// engine's healthy() both hang off, and which are easy to break silently.
//
// Silently is the operative word, and why this file exists. The worker has
// polled ESPN into `injury_status` since 0001, but nothing read it until
// v0.167.0: on a 2026 board every badge rendered blank and `defaultLineup` /
// `aiLineup` believed the whole league was available. Nothing errored. A wrong
// answer here looks exactly like a healthy league, so only an assertion catches
// it.
// Run: npx tsx scripts/check-injuries.mjs
import {
  injuryFor, setLiveInjuries, clearLiveInjuries, hasLiveInjuries, injuryRowFor,
  setInjurySeason,
} from '../packages/core/src/data/injuries.ts';

let fails = 0;
const eq = (label, got, want) => {
  const ok = got === want;
  if (!ok) { fails++; console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

// 1. The baked 2025 report still serves a 2025 board, unchanged.
clearLiveInjuries();
setInjurySeason(2025);
eq('2025 baked: a week designation', injuryFor(1, 'christian-mccaffrey'), 'Q');
eq('2025 baked: IR applies from its start week', injuryFor(4, 'james-conner'), 'IR');
eq('2025 baked: IR does not apply before it', injuryFor(3, 'james-conner'), null);
eq('2025 baked: an unlisted player is healthy', injuryFor(1, 'josh-allen'), null);

// 2. A season with no live report loaded shows nothing (rather than replaying
//    last year's tags against this year's roster).
setInjurySeason(2026);
eq('2026, no report loaded', injuryFor(1, 'christian-mccaffrey'), null);
eq('2026, no report loaded: hasLiveInjuries', hasLiveInjuries(1), false);

// 3. The live report serves the week it was polled for, detail included.
setLiveInjuries(3, {
  'christian-mccaffrey': { status: 'O', comment: 'knee' },
  'ceedee-lamb': { status: 'Q' },
});
eq('live: designation', injuryFor(3, 'christian-mccaffrey'), 'O');
eq('live: hasLiveInjuries', hasLiveInjuries(3), true);
eq('live: player off the report', injuryFor(3, 'josh-allen'), null);
eq('live: detail row', injuryRowFor(3, 'christian-mccaffrey')?.comment, 'knee');

// 4. And ONLY that week. The ESPN feed is a snapshot of the designations
//    standing right now — it carries no week and keeps no history, so tagging
//    any other week with it would be an invention.
eq('live: another week is not covered', injuryFor(4, 'christian-mccaffrey'), null);
eq('live: another week has no detail', injuryRowFor(4, 'christian-mccaffrey'), null);

// 5. For a week it covers, the live report WINS — the two reports must never
//    blend into one board.
setInjurySeason(2025);
setLiveInjuries(1, { 'ceedee-lamb': { status: 'D' } });
eq('live outranks baked: baked designation suppressed', injuryFor(1, 'christian-mccaffrey'), null);
eq('live outranks baked: baked IR suppressed', injuryFor(1, 'brandon-aiyuk'), null);
eq('live outranks baked: live designation served', injuryFor(1, 'ceedee-lamb'), 'D');
eq('baked still serves an uncovered week', injuryFor(2, 'isaiah-likely'), 'O');

// 6. Clearing reverts cleanly — a league exit must not strand the last board's
//    designations over the next one.
clearLiveInjuries();
eq('cleared: baked is back', injuryFor(1, 'christian-mccaffrey'), 'Q');
eq('cleared: hasLiveInjuries', hasLiveInjuries(1), false);

// 7. The engine's rule, on live data: `s !== 'O' && s !== 'IR'`. Out and IR are
//    never auto-fielded; Questionable and Doubtful are legitimate starts and
//    stay startable. Keep in step with defaultLineup/aiLineup in engine/matchup.
setInjurySeason(2026);
setLiveInjuries(5, {
  'p-out': { status: 'O' }, 'p-ir': { status: 'IR' },
  'p-q': { status: 'Q' }, 'p-d': { status: 'D' },
});
const healthy = (slug) => { const s = injuryFor(5, slug); return s !== 'O' && s !== 'IR'; };
eq('engine: Out is not auto-fielded', healthy('p-out'), false);
eq('engine: IR is not auto-fielded', healthy('p-ir'), false);
eq('engine: Questionable is startable', healthy('p-q'), true);
eq('engine: Doubtful is startable', healthy('p-d'), true);
eq('engine: an unlisted player is startable', healthy('p-clean'), true);

clearLiveInjuries();
console.log(fails ? `FAIL  ${fails} injury assertion(s) failed` : 'OK    injury report precedence');
process.exit(fails ? 1 : 0);
