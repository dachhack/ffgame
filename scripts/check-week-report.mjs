// Guard for THE WEEKLY REPORT (core data/weekReport, v0.391.0).
//
// Founder: "Can we get a weekly report for each league in the chat?" The
// worker builds it from plain rows and both hosts render its sections; this
// pins the reading of a small week so a refactor can't quietly change what
// the league is told. Run: npx tsx scripts/check-week-report.mjs
import { buildWeekReport, reportBody, reportSections, slugPretty, headlineOf, reportHasScores,
  nextReportRelease, weekReportRelease, GAME_RUN_MS, REPORT_HOUR_ET } from '../packages/core/src/data/weekReport.ts';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'PROBE FAIL'}  ${label}`); if (!cond) fails++; };
const eq = (got, want, label) => ok(JSON.stringify(got) === JSON.stringify(want), `${label}\n        got:  ${JSON.stringify(got)}\n        want: ${JSON.stringify(want)}`);

const names = { 1: 'Bulls', 2: 'Bears', 3: 'Cubs', 4: '' };
const matchups = [
  { week: 1, home_roster_id: 1, away_roster_id: 2, home_final: 120.4, away_final: '99.9' },
  { week: 1, home_roster_id: 3, away_roster_id: 4, home_final: 88.0, away_final: 90.5 },
  { week: 2, home_roster_id: 1, away_roster_id: 3, home_final: 101.15, away_final: 100.8 },
  { week: 2, home_roster_id: 2, away_roster_id: 4, home_final: 130, away_final: 70 },
  { week: 3, home_roster_id: 1, away_roster_id: 4, home_final: null, away_final: null },  // not this week
];
const slots = [
  { home_roster_id: 1, away_roster_id: 3, side: 'home', slug: 'josh-allen', score: 31.2, metric: 'BIG' },
  { home_roster_id: 1, away_roster_id: 3, side: 'away', slug: 'bal-dst', score: 12 },
  { home_roster_id: 2, away_roster_id: 4, side: 'away', slug: 'ceedee-lamb-wr', score: '31.2' },
];
const r = buildWeekReport({ week: 2, league: 'Test League', format: null, names, matchups, slots });

eq(r.format, 'standard', 'a null format reads standard');
eq(r.results.length, 2, 'this week has two games');
eq(r.results[0].home.name, 'Bears', 'results lead with the biggest score');
eq(r.results[1], { home: { roster: 1, name: 'Bulls', score: 101.2 }, away: { roster: 3, name: 'Cubs', score: 100.8 }, margin: 0.4 }, 'finals round to a tenth and the margin is theirs');
eq(r.top, { roster: 2, name: 'Bears', score: 130 }, 'the top score is the week\'s single best');
eq(r.low, { roster: 4, name: 'Roster 4', score: 70 }, 'a seat without a team name reads Roster N');
eq(r.closest?.margin, 0.4, 'the closest game is the tightest margin');
eq(r.blowout?.margin, 60, 'the blowout is the widest');
eq(r.mvp, { slug: 'josh-allen', name: 'Josh Allen', team: 'Bulls', score: 31.2, metric: 'BIG' }, 'MVP is the best slot, first one wins a tie, credited to the seat that started him');
eq(r.standings.map((s) => `${s.name} ${s.w}-${s.l}`), ['Bulls 2-0', 'Bears 1-1', 'Roster 4 1-1', 'Cubs 0-2'], 'standings run the whole season, wins then points for');
eq(r.standings[1].pf, 229.9, 'points for sums the season');
eq(r.standings[2].pa, 218, 'points against too');
eq(r.headline, 'Bears led the week with 130.0. Bulls edged Cubs by 0.4.', 'the headline names the leader and the squeaker');
ok(reportBody(r).startsWith('📋 Week 2 report — Bears led the week') && reportBody(r).includes('MVP Josh Allen 31.2.'), 'the chat line carries the headline and the MVP');
ok(reportBody(r).length <= 500, 'the chat line fits the body rule');
const secs = reportSections(r);
eq(secs.map((s) => s.title), ['The week', 'Results', 'Standings'], 'a standard league gets three sections');
eq(secs[0].rows[0], { label: 'High score', value: '130.0', sub: 'Bears', hot: true }, 'the high score row is hot');
eq(secs[1].rows[1], { label: 'Bulls vs Cubs', value: '101.2–100.8', sub: 'Bulls by 0.4' }, 'a result row reads home vs away and who won');
eq(secs[2].rows[0], { label: '1. Bulls', value: '2-0', sub: '221.6 for · 200.7 against' }, 'a standings row');

// Guillotine: the chopped seat is the elimination row, else the low score.
const g = buildWeekReport({ week: 2, league: 'Chop', format: 'guillotine', names, matchups, slots: [], eliminated: [4] });
eq(g.eliminated, { roster: 4, name: 'Roster 4', score: 70 }, 'guillotine names the chopped seat with the score that did it');
ok(g.headline.endsWith('Roster 4 was chopped.'), 'the guillotine headline says who fell');
eq(reportSections(g)[1], { title: 'Guillotine', rows: [{ label: 'Chopped', value: '70.0', sub: 'Roster 4' }] }, 'a guillotine section');
const g2 = buildWeekReport({ week: 2, league: 'Chop', format: 'guillotine', names, matchups, slots: [] });
eq(g2.eliminated?.roster, 4, 'without an elimination row yet, the low score is the chopped seat');

// Vampire: the bites.
const v = buildWeekReport({ week: 2, league: 'Bite', format: 'vampire', names, matchups, slots: [],
  bites: [{ vampire: 2, victim: 1, take: 'josh-allen', give: 'gardner-minshew-qb' }] });
eq(v.bites, [{ vampire: 'Bears', victim: 'Bulls', take: 'Josh Allen', give: 'Gardner Minshew' }], 'bites read as names');
eq(reportSections(v)[1].rows[0], { label: 'Bears bit Bulls', value: 'Josh Allen', sub: 'gave back Gardner Minshew' }, 'a bite row');
const v0 = buildWeekReport({ week: 2, league: 'Bite', format: 'vampire', names, matchups, slots: [] });
eq(reportSections(v0)[1].rows[0].sub, 'no blood drawn this week', 'a quiet vampire week says so');

// Edges.
const empty = buildWeekReport({ week: 5, league: 'Quiet', names, matchups, slots: [] });
eq(empty.headline, 'Week 5 closed with no games scored.', 'a week with no finals still reads');
eq(reportSections(empty).map((s) => s.title), ['Standings'], 'and only shows the standings');
const one = buildWeekReport({ week: 1, league: 'Two', names, matchups: [matchups[0]], slots: [] });
eq(one.blowout, undefined, 'one game is not a blowout');
eq(one.headline, 'Bulls led the week with 120.4.', 'and its headline skips the closest-game clause');
ok(headlineOf({ ...one, results: [{ ...one.results[0], margin: 20 }, one.results[0] ], closest: { ...one.results[0], margin: 20.5 } }).includes('beat Bears 120.4–99.9'), 'a wide closest game reads as a plain win');
// v0.393.4, from the first real run: a tie is a tie, and a league that has
// not drafted (every final 0.0) does not "lead the week with 0.0".
const tied = buildWeekReport({ week: 1, league: 'Tie', names, matchups: [
  { week: 1, home_roster_id: 1, away_roster_id: 2, home_final: 88, away_final: 88 },
  { week: 1, home_roster_id: 3, away_roster_id: 4, home_final: 100, away_final: 60 },
], slots: [] });
eq(tied.headline, 'Cubs led the week with 100.0. Bulls and Bears tied at 88.0.', 'a tie reads as a tie, never "edged by 0.0"');
const zero = buildWeekReport({ week: 1, league: 'Undrafted', names, matchups: [
  { week: 1, home_roster_id: 1, away_roster_id: 2, home_final: 0, away_final: 0 },
], slots: [] });
ok(!reportHasScores(zero), 'an all-zero week has no scores');
eq(zero.headline, 'Week 1 closed with no games scored.', 'and says so instead of crowning a 0.0');
eq(slugPretty('bal-dst'), 'BAL D/ST', 'a defence slug');
eq(slugPretty('bal-k'), 'BAL K', 'a kicker unit slug');
eq(slugPretty('josh-johnson-qb'), 'Josh Johnson', 'a tagged slug drops its tag');
eq(slugPretty('aj-brown'), 'Aj Brown', 'a plain slug title-cases');

// ── THE MORNING AFTER (v0.457.0) ────────────────────────────────────────────
// Founder, on a week-2 report posted while the Monday game was still on: "the
// reports shouldn't go out until early AM on the day after the week closes
// (Tuesday like 4AM EST)." The rule is the next 4 AM EASTERN after the last
// game could have ended — by timezone NAME, because "4AM EST" is 09:00Z in
// January and 08:00Z in September, and the season is played in the half where
// hard-coding the other one puts the report an hour wrong.
{
  const iso = (ms) => new Date(ms).toISOString();
  // The week that started this: Monday 2026-09-21, 8:15pm ET kickoff (EDT).
  const mnf = Date.parse('2026-09-22T00:15:00Z');
  ok(iso(weekReportRelease(mnf)) === '2026-09-22T08:00:00.000Z',
    `a Monday-night week reports Tuesday 4 AM ET = 08:00Z in September (got ${iso(weekReportRelease(mnf))})`);
  // Mid-game is still held: the very moment the founder's report went out.
  ok(weekReportRelease(mnf) > Date.parse('2026-09-22T03:22:00Z'),
    'and the instant the bad report actually posted is BEFORE that release');
  // November, EST: the same 4 AM is an hour later in UTC.
  const nov = Date.parse('2026-11-24T01:15:00Z');   // Mon Nov 23, 8:15pm EST
  ok(iso(weekReportRelease(nov)) === '2026-11-24T09:00:00.000Z',
    `in EST the same rule lands at 09:00Z (got ${iso(weekReportRelease(nov))})`);
  // A Saturday-ending week reports Sunday morning — one rule, no calendar cases.
  const sat = Date.parse('2026-12-27T01:00:00Z');   // Sat Dec 26, 8pm EST
  ok(iso(weekReportRelease(sat)) === '2026-12-27T09:00:00.000Z',
    `a Saturday-ending week reports the next morning, not "Tuesday" (got ${iso(weekReportRelease(sat))})`);
  // Strictly after: a game ending at 3 AM ET reports at 4 AM the SAME morning;
  // one ending at 4:01 waits a full day rather than releasing into the past.
  ok(iso(nextReportRelease(Date.parse('2026-09-22T07:00:00Z'))) === '2026-09-22T08:00:00.000Z',
    'an hour before the boundary releases on it');
  ok(iso(nextReportRelease(Date.parse('2026-09-22T08:00:00.001Z'))) === '2026-09-23T08:00:00.000Z',
    'a millisecond after it waits for tomorrow — the boundary is strict');
  // Spring forward: 2 AM ET does not exist on 2027-03-14, 4 AM does.
  ok(iso(nextReportRelease(Date.parse('2027-03-14T05:00:00Z'))) === '2027-03-14T08:00:00.000Z',
    `the DST-shortened night still has a 4 AM (got ${iso(nextReportRelease(Date.parse('2027-03-14T05:00:00Z')))})`);
  // NO SLATE, NO GATE. Holding a report forever on a missing row would be a
  // worse failure than posting one early.
  ok(weekReportRelease(null) === 0 && weekReportRelease(undefined) === 0 && weekReportRelease(NaN) === 0,
    'an unknown slate reports 0 — the caller reads that as "no gate"');
  ok(GAME_RUN_MS === 4 * 60 * 60 * 1000 && REPORT_HOUR_ET === 4,
    'the pad is four hours and the hour is 4 AM');
}

console.log(fails ? `\n${fails} WEEK-REPORT PROBE(S) FAILED` : '\nALL WEEK-REPORT PROBES PASSED');
process.exit(fails ? 1 : 0);
