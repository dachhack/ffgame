// Guard for THE WAIVER SCHEDULE (0337). Offline — check:parity.
//
// Three day-pickers became one per-day mode, with Sleeper's four values and
// Sleeper's own words. What this pins is the reading: the server sends seven
// strings and both consoles have to turn them into the same screen, and the
// same sentence in the rulebook, or the founder is back to holding two
// settings screens up next to each other.
import {
  WAIVER_DAY_MODES, WAIVER_MODE_LABEL, WAIVER_MODE_HINT, SLEEPER_WAIVER_DAYS,
  waiverDaysOf, nextWaiverMode, etTime, waiverScheduleLine,
} from '../packages/core/src/data/waiverDays.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };

ok(WAIVER_DAY_MODES.length === 4 && WAIVER_DAY_MODES.every((m) => WAIVER_MODE_LABEL[m] && WAIVER_MODE_HINT[m]),
  'four modes, each with a label and Sleeper\'s own hint');
ok(WAIVER_MODE_HINT.waivers_to_fa === 'Players clear waivers once, then become FA for rest of day.',
  'the hints are quoted from the screen a commissioner is comparing against');

// THE DEFAULT IS SLEEPER'S: waivers all week, Sunday clearing to free agency.
ok(SLEEPER_WAIVER_DAYS[0] === 'waivers_to_fa' && SLEEPER_WAIVER_DAYS.slice(1).every((m) => m === 'waivers'),
  'the default schedule is Sunday waivers-to-FA and waivers the rest of the week');

// A MISSING OR JUNK DAY READS AS WAIVERS — the half that withholds a player
// rather than handing him out. A parse that guessed 'fa' would open the wire.
ok(waiverDaysOf(null).every((m) => m === 'waivers') && waiverDaysOf([]).length === 7,
  'nothing at all reads as seven waivers days, not seven open ones');
ok(waiverDaysOf(['fa', 'nonsense', 'locked']).join(',') === 'fa,waivers,locked,waivers,waivers,waivers,waivers',
  'a junk entry reads as waivers and the short list is filled out');
ok(waiverDaysOf(SLEEPER_WAIVER_DAYS).join(',') === SLEEPER_WAIVER_DAYS.join(','), 'a good list round-trips');

// The ring the compact editor rides.
ok(nextWaiverMode('fa') === 'waivers' && nextWaiverMode('waivers') === 'waivers_to_fa'
   && nextWaiverMode('waivers_to_fa') === 'locked' && nextWaiverMode('locked') === 'fa',
  'the editor cycles fa → waivers → waivers to FA → locked → fa');

ok(etTime(180) === '3:00am' && etTime(0) === '12:00am' && etTime(720) === '12:00pm' && etTime(1380) === '11:00pm',
  'the clear time reads as a time of day, midnight and noon included');

// THE SENTENCE. One reading of the schedule, so the rulebook and the console
// cannot describe the same league differently.
{
  const line = waiverScheduleLine([...SLEEPER_WAIVER_DAYS], 180, 3);
  ok(line.includes('Mon, Tue, Wed, Thu, Fri, Sat: waivers clearing at 3:00am ET'),
    `the waivers days group up (${line})`);
  ok(line.includes('Sun: waivers, then free agency after the 3:00am run'), 'Sunday reads as the two-stage day it is');
  ok(line.includes('dropped once the games start stay on waivers until Wednesday 3:00am'),
    'and the after-games hold says which morning');
  const none = waiverScheduleLine(['fa', 'fa', 'fa', 'fa', 'fa', 'fa', 'fa'], 180, null);
  ok(none === 'Sun, Mon, Tue, Wed, Thu, Fri, Sat: free agency all day',
    `an always-open league says so and nothing else (${none})`);
  const locked = waiverScheduleLine(['locked', 'waivers', 'waivers', 'waivers', 'waivers', 'waivers', 'waivers'], null, null);
  ok(locked.includes('Sun: locked — nothing moves') && !locked.includes('clearing at'),
    `a league with no daily run names no run time (${locked})`);
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL WAIVER-SCHEDULE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
