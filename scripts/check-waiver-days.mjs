// Guard for THE WAIVER SCHEDULE (0337, 0338). Offline — check:parity.
//
// Three day-pickers became one per-day mode. What this pins is the reading:
// the server sends seven strings and both consoles have to turn them into the
// same screen, and the same sentence in the rulebook, or the founder is back
// to holding two settings screens up next to each other.
//
// 0338 adds the other half — the controls AROUND the schedule. A setting that
// cannot be honoured must either be unsayable or be named out loud, and these
// assertions are which is which.
import {
  WAIVER_DAY_MODES, WAIVER_MODE_LABEL, WAIVER_MODE_HINT, DEFAULT_WAIVER_DAYS,
  waiverDaysOf, nextWaiverMode, etTime, waiverScheduleLine,
  waiverDayModesFor, normalizeWaiverDays, effectiveGameHoldDow, holdLine, waiverConflicts, clearsOn,
} from '../packages/core/src/data/waiverDays.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };

ok(WAIVER_DAY_MODES.length === 4 && WAIVER_DAY_MODES.every((m) => WAIVER_MODE_LABEL[m] && WAIVER_MODE_HINT[m]),
  'four modes, each with a label and a one-line hint');
ok(WAIVER_MODE_HINT.waivers_to_fa === 'Players clear waivers once, then become FA for rest of day.',
  'the hints say what the day does in the words the rest of fantasy football uses');

// THE DEFAULT: waivers all week, Sunday clearing to free agency.
ok(DEFAULT_WAIVER_DAYS[0] === 'waivers_to_fa' && DEFAULT_WAIVER_DAYS.slice(1).every((m) => m === 'waivers'),
  'the default schedule is Sunday waivers-to-FA and waivers the rest of the week');

// A MISSING OR JUNK DAY READS AS WAIVERS — the half that withholds a player
// rather than handing him out. A parse that guessed 'fa' would open the wire.
ok(waiverDaysOf(null).every((m) => m === 'waivers') && waiverDaysOf([]).length === 7,
  'nothing at all reads as seven waivers days, not seven open ones');
ok(waiverDaysOf(['fa', 'nonsense', 'locked']).join(',') === 'fa,waivers,locked,waivers,waivers,waivers,waivers',
  'a junk entry reads as waivers and the short list is filled out');
ok(waiverDaysOf(DEFAULT_WAIVER_DAYS).join(',') === DEFAULT_WAIVER_DAYS.join(','), 'a good list round-trips');

// The ring the compact editor rides.
ok(nextWaiverMode('fa') === 'waivers' && nextWaiverMode('waivers') === 'waivers_to_fa'
   && nextWaiverMode('waivers_to_fa') === 'locked' && nextWaiverMode('locked') === 'fa',
  'the editor cycles fa → waivers → waivers to FA → locked → fa');

// ── 0338: THE CONTROLS AROUND THE SCHEDULE ─────────────────────────────────
//
// ROLLING 24H has no run, so a day cannot clear AT one. The mode is not
// offered, is not reachable by the ring, and a stored one reads as WAIVERS —
// the shut half, because the bug this replaces was a door opening at 3:00am on
// a run that never happened.
ok(waiverDayModesFor(null).join(',') === 'fa,waivers,locked',
  'rolling offers three modes — waivers-to-FA needs a run to clear at');
ok(waiverDayModesFor(180).length === 4, 'a daily run offers all four');
ok(nextWaiverMode('waivers', null) === 'locked' && nextWaiverMode('locked', null) === 'fa',
  'the rolling ring steps straight over waivers-to-FA');
ok(nextWaiverMode('waivers_to_fa', null) === 'fa',
  'and a mode the league can no longer say rings back to the first one it can');
ok(normalizeWaiverDays(DEFAULT_WAIVER_DAYS, null).join(',') === 'waivers,waivers,waivers,waivers,waivers,waivers,waivers',
  'a stored waivers-to-FA day reads as WAIVERS once the league goes rolling');
ok(normalizeWaiverDays(DEFAULT_WAIVER_DAYS, 180).join(',') === DEFAULT_WAIVER_DAYS.join(','),
  'and is left exactly alone while there is a run');
{
  const c = waiverConflicts({ days: [...DEFAULT_WAIVER_DAYS], clearMin: null, holdDays: 1, gameHoldDow: null, faMode: 'open' });
  ok(c.length === 1 && c[0].level === 'warn' && c[0].text.includes('Sun'),
    `rolling + a stored waivers-to-FA day is named, not silently dropped (${c[0]?.text})`);
}

// THE HOLD counts RUNS. With no run there is nothing to count, and the
// database gives a flat 24h whatever the number says — so the console must not
// present 2 DAYS and 3 DAYS there as if they did something.
ok(holdLine(null, 1) === 'Rolling: each dropped player clears exactly 24h after his own drop.',
  'the rolling hold line says 24h and does not multiply it by the hold days');
ok(holdLine(null, 0).includes('the moment he is dropped'), 'a hold of NONE is immediate');
ok(holdLine(180, 2).includes('3:00am') && holdLine(180, 2).includes('2 runs after the drop'),
  'the daily hold line names the run time and how many runs');
{
  const c = waiverConflicts({ days: ['fa', 'fa', 'fa', 'fa', 'fa', 'fa', 'fa'], clearMin: null, holdDays: 3, gameHoldDow: null, faMode: 'open' });
  ok(c.some((x) => x.level === 'info' && x.text.includes('3 DAYS reads the same as 1 DAY')),
    'three rolling hold days are called redundant rather than left to look effective');
}

// AFTER GAMES, CLEAR <day> is a promise about a RUN. Name a day the schedule
// spends as FREE AGENCY or LOCKED and the hold would expire on nothing.
{
  const days = ['waivers_to_fa', 'waivers', 'waivers', 'fa', 'waivers', 'waivers', 'waivers'];
  ok(effectiveGameHoldDow(days, 3) === 4, 'an after-games day the run does not visit rolls to the next one that does');
  ok(effectiveGameHoldDow([...DEFAULT_WAIVER_DAYS], 3) === 3, 'and a day it does visit stays put');
  ok(effectiveGameHoldDow(['fa', 'fa', 'fa', 'fa', 'fa', 'fa', 'fa'], 3) === null,
    'a week with no run at all has nowhere for the hold to land');
  ok(effectiveGameHoldDow([...DEFAULT_WAIVER_DAYS], null) === null, 'NONE stays none');
  const c = waiverConflicts({ days, clearMin: 180, holdDays: 1, gameHoldDow: 3, faMode: 'open' });
  ok(c.some((x) => x.level === 'warn' && x.text.includes('Wednesday') && x.text.includes('Thursday')),
    `the roll-forward is spelled out with both days (${c.find((x) => x.text.includes('Wednesday'))?.text})`);
}

// THE LEAGUE-WIDE SWITCH beats the schedule, which is fine — but a schedule
// still showing FREE AGENCY days has to say it is being overruled.
{
  const c = waiverConflicts({ days: [...DEFAULT_WAIVER_DAYS], clearMin: 180, holdDays: 1, gameHoldDow: null, faMode: 'off' });
  ok(c.some((x) => x.level === 'warn' && x.text.includes('overrules the schedule')),
    'free agency OFF says out loud that it overrules the days that open a door');
  const open = waiverConflicts({ days: [...DEFAULT_WAIVER_DAYS], clearMin: 180, holdDays: 1, gameHoldDow: null, faMode: 'open' });
  ok(open.length === 0, 'and the default week with the default switch has nothing to warn about');
}

// A WINDOW THAT CLOSES BEFORE THE RUN leaves a waivers-to-FA day with no open
// minute — unlocked at an hour the league does not have.
{
  const c = waiverConflicts({ days: [...DEFAULT_WAIVER_DAYS], clearMin: 720, holdDays: 1, gameHoldDow: null, faMode: 'window', faStart: 480, faEnd: 600 });
  ok(c.some((x) => x.text.includes('never reach an open minute')), 'a window that shuts before the run is named');
  const night = waiverConflicts({ days: [...DEFAULT_WAIVER_DAYS], clearMin: 720, holdDays: 1, gameHoldDow: null, faMode: 'window', faStart: 1200, faEnd: 240 });
  ok(night.length === 0, 'and an overnight window, which wraps past the run, is not');
}

ok(etTime(180) === '3:00am' && etTime(0) === '12:00am' && etTime(720) === '12:00pm' && etTime(1380) === '11:00pm',
  'the clear time reads as a time of day, midnight and noon included');

// THE SENTENCE. One reading of the schedule, so the rulebook and the console
// cannot describe the same league differently.
{
  const line = waiverScheduleLine([...DEFAULT_WAIVER_DAYS], 180, 3);
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
  // 0338: the sentence reads the league as CONFIGURED, so the rulebook cannot
  // promise a two-stage Sunday to a league whose run does not exist.
  const roll = waiverScheduleLine([...DEFAULT_WAIVER_DAYS], null, null);
  ok(!roll.includes('then free agency') && roll.includes('Sun, Mon'),
    `a rolling league's rulebook does not promise a clear-then-FA day (${roll})`);
  const rolled = waiverScheduleLine(['waivers_to_fa', 'waivers', 'waivers', 'fa', 'waivers', 'waivers', 'waivers'], 180, 3);
  ok(rolled.includes('until Thursday 3:00am'),
    `and it names the morning the after-games hold really ends on (${rolled})`);
}

// ── 0341: WHEN HE CLEARS, AS A DAY ─────────────────────────────────────────
// The wire printed a countdown. A weekday is the same fact already converted,
// and it stays true while you read it.
{
  // Tuesday 2026-09-22, 9:52pm local — the founder's own screenshot.
  const now = new Date(2026, 8, 22, 21, 52).getTime();
  const at = (y, m, d, h) => new Date(y, m, d, h).toISOString();
  ok(clearsOn(null, now) === null && clearsOn(undefined, now) === null,
    'a player with no hold gets no badge at all, rather than a badge saying nothing');
  ok(clearsOn(at(2026, 8, 22, 10), now) === null, 'a hold that has already passed is not a hold');
  ok(clearsOn(at(2026, 8, 22, 23), now)?.day === 'today', 'later tonight is "today"');
  ok(clearsOn(at(2026, 8, 23, 3), now)?.day === 'tomorrow', 'and 3am tomorrow is "tomorrow", not "Wed"');
  // THE CALENDAR-DAY RULE. Five hours out is tomorrow here; an elapsed-hours
  // reading would call it today, which is the bug a countdown cannot avoid.
  ok(clearsOn(at(2026, 8, 24, 3), now)?.day === 'Thursday', 'Thursday 3am reads as Thursday');
  ok(clearsOn(at(2026, 8, 24, 3), now)?.short === 'Thu', '…and short as Thu, the shape of badge Sleeper prints');
  ok(clearsOn(at(2026, 8, 26, 3), now)?.short === 'Sat', 'a Saturday run reads Sat');
  // Read at 11pm, the same hold must still say tomorrow rather than today.
  const late = new Date(2026, 8, 22, 23, 30).getTime();
  ok(clearsOn(at(2026, 8, 23, 3), late)?.day === 'tomorrow',
    'a 3am hold read at 11:30pm is still TOMORROW — calendar days, not elapsed hours');
  ok(clearsOn('not a date', now) === null, 'and junk is no badge rather than a thrown screen');
}

console.log(fails ? `\n${fails} PROBE FAIL(s)` : '\nALL WAIVER-SCHEDULE ASSERTIONS PASSED');
process.exit(fails ? 1 : 0);
