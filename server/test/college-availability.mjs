// The conference availability poll (v0.615.0): row parsing, the status map,
// name matching against an ESPN roster, report timestamps, and the plan —
// what is written, what is carried, what is cleared, and when the prune
// must not run. Fixture cut from the SEC's real Game Day report for
// Alabama–Mississippi State (Oct 3, 2026) and Alabama's ESPN roster. No network.
import { readFileSync } from 'node:fs';
import {
  parseRow, mapAvailability, foldName, matchPlayer, reportStamp, gameLabel, reportRows, planAvailability,
  SCHOOLS, SOURCE, CARRY_SOURCE,
} from '../src/poll/collegeAvailability.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };
const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), `${label} — got ${JSON.stringify(a)}`);

// ── rows ──
eq(parseRow("TE #0 Trey'Dez Green"), { pos: 'TE', jersey: '0', name: "Trey'Dez Green" }, 'row parses pos, jersey, name');
eq(parseRow('OL #07 Houston Ka\'aha\'aina-Torres').jersey, '7', 'jersey loses its leading zero');
eq(parseRow('38 #38 Karsten Busch')?.pos, '38', 'a walk-on with no position still parses (and matches no roster position)');
eq(parseRow('Trey Green'), null, 'a row without a number is not a row');

// ── statuses ──
eq(['Out', 'Out - (1st Half)', 'Doubtful', 'Questionable', 'Game Time Decision', 'Probable', 'Available', 'Exempt', '', 'Suspended'].map(mapAvailability),
  ['O', 'Q', 'D', 'Q', 'Q', 'A', 'A', null, null, null], 'the conference vocabulary maps to O / D / Q / A / nothing');

// ── names ──
const roster = [
  { espn_id: '1', full_name: "Trey'Dez Green", jersey: '0' },
  { espn_id: '2', full_name: 'Phillip Wright', jersey: '55' },
  { espn_id: '3', full_name: "Houston Ka'aha'aina-Torres", jersey: '70' },
  { espn_id: '4', full_name: 'José Ramírez', jersey: '11' },
  { espn_id: '5', full_name: 'Marcus Smith', jersey: '3' },
  { espn_id: '6', full_name: 'Malik Smith', jersey: '21' },
  { espn_id: '7', full_name: 'Jalen Smith', jersey: '28' },
  { espn_id: '8', full_name: 'Jalen Smith', jersey: '44' },
];
eq(foldName("Trey'Dez Green Jr."), 'treydez green', 'fold drops apostrophes, case and suffixes');
eq(matchPlayer(parseRow('TE #0 Trey\'Dez Green'), roster)?.espn_id, '1', 'exact folded name');
eq(matchPlayer(parseRow('DL #55 Phillip Wright III'), roster)?.espn_id, '2', 'a suffix on one side only');
eq(matchPlayer(parseRow('OL #70 Houston Torres'), roster)?.espn_id, '3', 'jersey + surname when the first name differs');
eq(matchPlayer(parseRow('WR #11 Jose Ramirez'), roster)?.espn_id, '4', 'diacritics fold away');
eq(matchPlayer(parseRow('DB #99 M. Smith'), roster), null, 'two M. Smiths and no jersey match → nobody (never guessed)');
eq(matchPlayer(parseRow('DB #21 M. Smith'), roster)?.espn_id, '6', 'jersey breaks the surname tie');
eq(matchPlayer(parseRow('DB #44 Jalen Smith'), roster)?.espn_id, '8', 'two players with the same name: the jersey decides');
eq(matchPlayer(parseRow('DB #45 Jalen Smith'), roster), null, 'same name, wrong jersey → nobody');
eq(matchPlayer(parseRow('QB #12 Nobody Here'), roster), null, 'a stranger matches nobody');

// ── times ──
eq(reportStamp('2026-10-03', '9:30:00', 'CT'), '2026-10-03T14:30:00.000Z', '9:30 CT in October is 14:30Z (daylight time)');
eq(reportStamp('2026-12-05', '20:00:00', 'ET'), '2026-12-06T01:00:00.000Z', '8pm ET in December is 01:00Z next day (standard time)');
eq(reportStamp('2026-03-07', '20:00:00', 'ET'), '2026-03-08T01:00:00.000Z', 'the Saturday before the March change is still standard time');
eq(reportStamp('2026-11-01', '12:00:00', 'ET'), '2026-11-01T17:00:00.000Z', 'the first Sunday of November is standard time');
eq(reportStamp('2026-10-03', '9:30', 'PST'), '2026-10-03T16:30:00.000Z', 'seconds optional; a PST label still reads as Pacific');
eq(reportStamp('Saturday', '9:30:00', 'CT'), null, 'junk dates no designation');
eq(gameLabel('2026-10-03', 'Mississippi State'), 'Sat Oct 3 vs Mississippi State', 'the game label');

// ── the fixture ──
const FX = JSON.parse(readFileSync(new URL('./fixtures/sec-gameday-2941.json', import.meta.url), 'utf8'));
const ALA = [
  { espn_id: '5225235', full_name: 'John Cooper', jersey: '19', pos: 'QB', school_id: '333' },
  { espn_id: '5141426', full_name: 'AK Dear', jersey: '0', pos: 'RB', school_id: '333' },
  { espn_id: '5209375', full_name: 'Jorden Edmonds', jersey: '16', pos: 'DB', school_id: '333' },
  { espn_id: '5141519', full_name: 'Justin Hill', jersey: '8', pos: 'LB', school_id: '333' },
  { espn_id: '5079479', full_name: 'Cayden Jones', jersey: '23', pos: 'LB', school_id: '333' },
  { espn_id: '5079593', full_name: 'Zavier Mincey', jersey: '12', pos: 'DB', school_id: '333' },
  { espn_id: '4870970', full_name: 'Yhonzae Pierre', jersey: '0', pos: 'LB', school_id: '333' },
  { espn_id: '4905925', full_name: 'Devan Thompkins', jersey: '1', pos: 'DL', school_id: '333' },
  { espn_id: '4899417', full_name: 'Desmond Umeozulu', jersey: '9', pos: 'LB', school_id: '333' },
];
const SEC = { code: 'SEC', name: 'SEC' };
const rows = reportRows(FX, SEC);
eq(rows.length, 18, 'every row of both teams, one per player');
eq(rows[0], { conf: 'SEC', confName: 'SEC', team: 'Alabama', opponent: 'Mississippi State', pos: 'LB', jersey: '8', name: 'Justin Hill', raw: 'Out', tag: 'O', reportType: 'Game Day', posted: 'Saturday 9:30 CT', postedAt: '2026-10-03T14:30:00.000Z', gameDate: '2026-10-03' }, 'a row knows its game, its report and its posting time');
eq(reportRows({}, SEC), [], 'an empty report set is no rows');
eq(reportRows(null, SEC), [], 'a null payload is no rows');
ok(SCHOOLS.Alabama[0] === '333' && SCHOOLS['Mississippi State'][0] === '344' && Object.keys(SCHOOLS).length === 67, 'the Power Four map: 67 schools, by ESPN location name');

// ── the plan, the morning of the game ──
const NOW = Date.parse('2026-10-03T15:00:00Z');
const day = (n) => new Date(NOW + n * 86400e3).toISOString();
const held = [
  // Alabama's stale Out from last week's report — not on this week's set → cleared.
  { player_slug: 'c-5141426', status: 'O', source: SOURCE, designation_date: day(-7), comment: 'SEC availability report · Game Day (Saturday 9:00 CT) · Out · Sat Sep 26 vs South Carolina', team: 'ALA' },
  // LSU, no report this week (non-conference game): his Out carries as Q…
  { player_slug: 'c-5079420', status: 'O', source: SOURCE, designation_date: day(-7), comment: 'SEC availability report · Game Day (Saturday 13:00 CT) · Out · Sat Sep 26 vs Texas A&M', team: 'LSU' },
  // …his Questionable teammate does not…
  { player_slug: 'c-5079421', status: 'Q', source: SOURCE, designation_date: day(-7), comment: 'SEC availability report · Game Day (Saturday 13:00 CT) · Game Time Decision · Sat Sep 26 vs Texas A&M', team: 'LSU' },
  // …nor an Out older than the carry window…
  { player_slug: 'c-5079422', status: 'O', source: SOURCE, designation_date: day(-20), comment: 'SEC availability report · Game Day (Saturday 13:00 CT) · Out · Sat Sep 12 vs Florida', team: 'LSU' },
  // …and a carry already standing keeps standing.
  { player_slug: 'c-5079423', status: 'Q', source: CARRY_SOURCE, designation_date: day(-8), comment: "Out on his school's last availability report (Sat Sep 25 vs Ole Miss) · no report filed for this game — check before kickoff", team: 'LSU' },
  // Somebody else's row under a college slug is not this poll's to touch.
  { player_slug: 'c-999', status: 'O', source: 'espn', designation_date: day(-1), comment: null, team: 'LSU' },
];
const schoolId = (name) => SCHOOLS[name]?.[0] ?? null;
const plan = planAvailability({ rows, rosterBySchool: new Map([['333', ALA]]), schoolId, held, now: NOW });
const by = Object.fromEntries(plan.upserts.map((u) => [u.player_slug, u]));
eq(Object.keys(by).sort(), ['c-5079420', 'c-5079423', 'c-5079479', 'c-5141519', 'c-5209375', 'c-5079593', 'c-4899417'].sort(), 'written: four Outs, the game-time decision, the LSU carry, the standing carry');
eq([by['c-5141519'].status, by['c-5079593'].status, by['c-5079479'].status], ['O', 'Q', 'O'], 'Out → O, Game Time Decision → Q, an exemptStatus of Out still reads its status');
eq(by['c-5141519'].comment, 'SEC availability report · Game Day (Saturday 9:30 CT) · Out · Sat Oct 3 vs Mississippi State', 'the comment is the conference\'s words and the game');
eq([by['c-5141519'].source, by['c-5141519'].team, by['c-5141519'].designation_date], [SOURCE, 'ALA', '2026-10-03T14:30:00.000Z'], 'source, school and the report\'s own time');
ok(!by['c-5225235'], 'Exempt is no statement');
ok(!by['c-5141426'] && !by['c-4870970'], 'Available clears — and clears last week\'s Out');
eq([by['c-5079420'].status, by['c-5079420'].source, by['c-5079420'].comment], ['Q', CARRY_SOURCE, "Out on his school's last availability report (Sat Sep 26 vs Texas A&M) · no report filed for this game — check before kickoff"], 'the carry: Out last report, nothing filed this week → Q, saying so');
eq(by['c-5079423'].comment, held[4].comment, 'a standing carry is re-asserted unchanged');
eq(plan.deletes.sort(), ['c-5079421', 'c-5079422', 'c-5141426'].sort(), 'cleared: the stale Alabama Out, the LSU Questionable, the LSU Out past the window — never the espn row');
eq(plan.unmatched.map((u) => `${u.why}:${u.name}`), ['player:Zakari Tillman', 'player:Ayden Williams'], 'Mississippi State had no roster loaded: its Outs are reported unmatched, its Exempts are not');
eq([plan.statements, plan.schools, plan.carried, plan.prunedSkipped], [8, 2, 2, false], 'counts: eight statements, two schools, two carries (one new, one standing)');

// ── an incomplete read: write, never clear ──
const partial = planAvailability({ rows, rosterBySchool: new Map([['333', ALA]]), schoolId, held, now: NOW, complete: false });
eq([partial.upserts.length, partial.deletes.length, partial.prunedSkipped], [7, 0, true], 'a conference that did not answer stops the prune, not the writes');

// ── three days after the game: the Outs stand, the game-time decision is history ──
const later = planAvailability({ rows, rosterBySchool: new Map([['333', ALA]]), schoolId, held: [], now: NOW + 3 * 86400e3 });
eq(later.upserts.map((u) => u.status).sort(), ['O', 'O', 'O', 'O'], 'Q/D about a game already played are dropped; Out stands until the next report');

// ── two reports in one set: the newer one speaks ──
const older = JSON.parse(JSON.stringify(FX));
older['1000'] = { ...older['2941'], ReportType: 'Update 2', publishDate: '2026-10-02', postedTime: '19:00:00', games: [{ teamDisplayName: 'Alabama', rows: [{ name: 'RB #0 AK Dear', status: 'Doubtful' }] }, { teamDisplayName: 'Mississippi State', rows: [] }] };
const two = planAvailability({ rows: reportRows(older, SEC), rosterBySchool: new Map([['333', ALA]]), schoolId, held: [], now: NOW });
ok(!two.upserts.find((u) => u.player_slug === 'c-5141426'), 'Friday\'s Doubtful yields to Saturday\'s Available, whatever order the set lists them');

// ── the NFL poll leaves college rows alone ──
const nfl = readFileSync(new URL('../src/poll/injuries.js', import.meta.url), 'utf8');
ok(nfl.includes("!s.startsWith('c-')"), 'poll/injuries.js prunes nothing under a c- slug');

if (fails) { console.error(`${fails} failure(s)`); process.exit(1); }
console.log('college-availability: all pass');
