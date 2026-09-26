// The college directory poll (0365): roster parsing, the FBS list, and the
// retirement rule — a sweep with ANY failed roster must not retire anybody.
// Fixtures are cut from real 2026 ESPN responses (Alabama's roster shape, the
// core API's $ref list); no network.
import { fbsTeamIds, rosterRows, runCollegeSweep, sweepEveryMs, statRows, mergeStatRows } from '../src/poll/college.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

const athlete = (id, name, pos, years, abbr, status = 'active') => ({
  id: String(id), fullName: name, jersey: '1',
  position: { abbreviation: pos },
  experience: { years, abbreviation: abbr },
  status: { type: status },
});
const ALA = {
  team: { id: '333', abbreviation: 'ALA', displayName: 'Alabama Crimson Tide' },
  athletes: [
    { position: 'offense', items: [
      athlete(5001, 'Qb One', 'QB', 3, 'JR'),
      athlete(5002, 'Big Lineman', 'OL', 4, 'SR'),
      athlete(5003, 'Edge Rusher', 'EDGE', 2, 'SO'),
      athlete(5004, 'Safety Man', 'S', 1, 'FR'),
      athlete(5005, 'Kick Er', 'PK', 4, 'SR'),
      athlete(5006, 'Long Snap', 'LS', 4, 'SR'),
      athlete(5007, 'Gone Guy', 'WR', 4, 'SR', 'inactive'),
      { id: 'x9', fullName: 'Bad Id', position: { abbreviation: 'RB' } },
    ] },
  ],
};

// ── 1. roster parsing ──
{
  const rows = rosterRows(ALA);
  const by = Object.fromEntries(rows.map((r) => [r.espn_id, r]));
  ok(rows.length === 5, `five fantasy players kept, linemen/snappers/bad ids dropped (got ${rows.length})`);
  ok(!by['5002'] && !by['5006'], 'OL and LS are not fantasy players');
  ok(by['5003']?.pos === 'DL' && by['5003']?.espn_pos === 'EDGE', 'EDGE maps to DL and keeps ESPN\'s label');
  ok(by['5004']?.pos === 'DB' && by['5005']?.pos === 'K', 'S → DB, PK → K');
  ok(by['5001']?.school === 'Alabama Crimson Tide' && by['5001']?.school_abbr === 'ALA' && by['5001']?.school_id === '333',
    'school comes from the roster\'s team');
  ok(by['5001']?.class_year === 3 && by['5001']?.class_label === 'JR', 'class year and label');
  ok(by['5007']?.active === false, 'a non-active status is carried as inactive');
}

// ── 2. the FBS list ──
{
  const feed = { items: [
    { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/2?lang=en&region=us' },
    { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/333?lang=en' },
    { $ref: 'http://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/2026/teams/333?lang=en' },
    { $ref: 'nonsense' },
  ] };
  const ids = fbsTeamIds(feed);
  ok(JSON.stringify(ids) === '["2","333"]', `ids read from $ref links, deduped (got ${JSON.stringify(ids)})`);
}

// ── 3. the sweep and the retirement rule ──
const fakeRpc = () => {
  const calls = [];
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn === 'upsert_college_players') return { data: { rows: args.p_rows.length } };
    if (fn === 'finish_college_sweep') return { data: { retired: 7 } };
    return { error: { message: 'unexpected ' + fn } };
  };
  return { calls, rpc };
};
const teamsFeed = { items: [
  { $ref: '.../seasons/2026/teams/333?x' }, { $ref: '.../seasons/2026/teams/57?x' },
] };
{
  const { calls, rpc } = fakeRpc();
  const fetchJson = async (url) => url.includes('groups/80') ? teamsFeed : { ...ALA, team: { ...ALA.team, id: url.match(/teams\/(\d+)/)[1] } };
  const r = await runCollegeSweep(2026, () => {}, fetchJson, rpc);
  ok(r.schools === 2 && r.rows === 10 && r.failed === 0, `clean sweep writes both schools (got ${JSON.stringify(r)})`);
  ok(calls.some((c) => c.fn === 'finish_college_sweep') && r.retired === 7, 'a clean sweep retires the unseen');
}
{
  const { calls, rpc } = fakeRpc();
  const fetchJson = async (url) => {
    if (url.includes('groups/80')) return teamsFeed;
    if (url.includes('/teams/57/')) throw new Error('503');
    return ALA;
  };
  const r = await runCollegeSweep(2026, () => {}, fetchJson, rpc);
  ok(r.failed === 1 && r.rows === 5, 'one failed roster: the other school still lands');
  ok(!calls.some((c) => c.fn === 'finish_college_sweep') && r.retired === 0,
    'THE POINT: a sweep with a failed roster retires nobody');
}

// ── 4. cadence ──
{
  const prev = process.env.COLLEGE_POLL_MS; delete process.env.COLLEGE_POLL_MS;
  ok(sweepEveryMs(new Date('2027-04-15T00:00:00Z')) === 86400000, 'daily in the offseason (transfers, signings)');
  ok(sweepEveryMs(new Date('2026-10-15T00:00:00Z')) === 7 * 86400000, 'weekly in season');
  if (prev != null) process.env.COLLEGE_POLL_MS = prev;
}

// ── 5. season stat lines (0369) — cut from ESPN's 2025 byathlete page ──
{
  const page = {
    categories: [
      { name: 'general', names: ['gamesPlayed', 'fumblesForced'] },
      { name: 'passing', names: ['completions', 'passingYards', 'passingTouchdowns', 'interceptions'] },
      { name: 'rushing', names: ['rushingAttempts', 'rushingYards', 'yardsPerRushAttempt', 'rushingTouchdowns'] },
      { name: 'receiving', names: ['receptions', 'receivingTargets', 'receivingYards', 'receivingTouchdowns'] },
    ],
    athletes: [
      { athlete: { id: '4918103' }, categories: [
        { name: 'general', totals: ['13', '-'] },
        { name: 'passing', totals: ['-', '-', '-', '-'] },
        { name: 'rushing', totals: ['295', '1,659', '5.6', '16'] },
        { name: 'receiving', totals: ['30', '41', '286', '0'] },
      ] },
      { athlete: { id: 'bad' }, categories: [] },
    ],
  };
  const [r, ...rest] = statRows(page);
  ok(rest.length === 0, 'a bad id is dropped');
  ok(r.espn_id === '4918103' && r.gp === 13 && r.rush_yds === 1659 && r.rush_td === 16, 'columns found by name, thousands separator read');
  ok(r.rec === 30 && r.rec_yds === 286 && r.rec_td === 0, 'receiving read past the targets column');
  ok(r.pass_yds === null && r.ints === null, "'-' is none, not zero");
}

// ── 6. ESPN fills one category per request: merge them (0369) ──
{
  const m = mergeStatRows([
    [{ espn_id: '1', gp: 12, rush_yds: 900, rec_yds: null }],
    [{ espn_id: '1', gp: 12, rush_yds: null, rec_yds: 400 }, { espn_id: '2', gp: 5, rec_yds: 80 }],
  ]);
  const one = m.find((r) => r.espn_id === '1');
  ok(m.length === 2 && one.rush_yds === 900 && one.rec_yds === 400 && one.gp === 12,
    'a back\'s rushing and receiving walks become one line');
}

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL COLLEGE POLL CHECKS PASS');
