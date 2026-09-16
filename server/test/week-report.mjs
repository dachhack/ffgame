// THE WEEKLY REPORT posts once (v0.391.0).
//
// Founder: "Can we get a weekly report for each league in the chat?" The
// tick's completed-week branch calls postWeekReports after stampFinals; this
// pins that a league reports only when every final is stamped, that last
// season's leagues stay quiet, that the chat line is the house's (no author,
// kind 'report', the week on it), and that a second pass — or a restart that
// forgot it posted — never says the week twice. Fake Supabase, in-memory.
// Run from server/:  npx tsx test/week-report.mjs
import assert from 'node:assert';
import { __setClientForTest } from '../src/supabase.js';
import { postWeekReports, sweepRequests, __resetForTest } from '../src/report.js';

const LID = 'aaaaaaaa-0000-0000-0000-000000000001';
const OLD = 'bbbbbbbb-0000-0000-0000-000000000002';
const LATE = 'cccccccc-0000-0000-0000-000000000003';

function makeFakeDb(tables) {
  const writes = { league_report: [], league_message: [] };
  const like = (v, pat) => new RegExp('^' + String(pat).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$').test(String(v ?? ''));
  function builder(name, rows) {
    const api = {
      select: () => api,
      eq: (c, v) => builder(name, rows.filter((r) => r[c] === v)),
      lte: (c, v) => builder(name, rows.filter((r) => r[c] <= v)),
      in: (c, vs) => { const s = new Set(vs); return builder(name, rows.filter((r) => s.has(r[c]))); },
      like: (c, pat) => builder(name, rows.filter((r) => like(r[c], pat))),
      is: (c, v) => builder(name, rows.filter((r) => (v === null ? r[c] == null : r[c] === v))),
      order: () => api,
      limit: (k) => builder(name, rows.slice(0, k)),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  }
  const client = {
    from: (name) => ({
      ...builder(name, tables[name] ?? []),
      upsert: (row, opts) => {
        const key = String(opts?.onConflict ?? '').split(',');
        const hit = (tables[name] ?? []).find((r) => key.every((k) => r[k] === row[k]));
        const run = () => {
          if (hit && opts?.ignoreDuplicates) return Promise.resolve({ data: [], error: null });
          if (hit) { Object.assign(hit, row); return Promise.resolve({ data: [hit], error: null }); }
          (tables[name] ??= []).push(row); writes[name]?.push(row);
          return Promise.resolve({ data: [row], error: null });
        };
        return { select: run, then: (res, rej) => run().then(res, rej) };
      },
      insert: (row) => { (tables[name] ??= []).push(row); writes[name]?.push(row); return Promise.resolve({ data: null, error: null }); },
      update: (patch) => {
        const q = { filters: [] };
        const api = {
          eq: (c, v) => { q.filters.push([c, v]); return api; },
          then: (res, rej) => {
            for (const r of tables[name] ?? []) if (q.filters.every(([c, v]) => r[c] === v)) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return api;
      },
      delete: () => {
        const q = { filters: [] };
        const api = {
          eq: (c, v) => { q.filters.push([c, v]); return api; },
          then: (res, rej) => {
            tables[name] = (tables[name] ?? []).filter((r) => !q.filters.every(([c, v]) => r[c] === v));
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return api;
      },
    }),
  };
  return { client, writes };
}

const WEEK = 2;
const tables = {
  league: [
    { id: LID, name: 'Chat League', season: '2026', settings_json: { format: 'standard' } },
    { id: OLD, name: 'Last Year', season: '2025', settings_json: {} },
    { id: LATE, name: 'Still Playing', season: '2026', settings_json: {} },
  ],
  league_membership: [
    { league_id: LID, sleeper_roster_id: 1, team_name: 'Bulls' }, { league_id: LID, sleeper_roster_id: 2, team_name: 'Bears' },
    { league_id: LID, sleeper_roster_id: 3, team_name: 'Cubs' }, { league_id: LID, sleeper_roster_id: 4, team_name: 'Sox' },
  ],
  matchup: [
    { id: 'm1', league_id: LID, week: 1, home_roster_id: 1, away_roster_id: 2, home_final: 100, away_final: 90, status: 'final' },
    { id: 'm2', league_id: LID, week: 1, home_roster_id: 3, away_roster_id: 4, home_final: 80, away_final: 95, status: 'final' },
    { id: 'm3', league_id: LID, week: 2, home_roster_id: 1, away_roster_id: 3, home_final: 110.3, away_final: 109.9, status: 'final' },
    { id: 'm4', league_id: LID, week: 2, home_roster_id: 2, away_roster_id: 4, home_final: 70, away_final: 120, status: 'final' },
    { id: 'o1', league_id: OLD, week: 2, home_roster_id: 1, away_roster_id: 2, home_final: 50, away_final: 60, status: 'final' },
    { id: 'l1', league_id: LATE, week: 2, home_roster_id: 1, away_roster_id: 2, home_final: 50, away_final: 60, status: 'final' },
    { id: 'l2', league_id: LATE, week: 2, home_roster_id: 3, away_roster_id: 4, home_final: null, away_final: null, status: 'final' },
  ],
  matchup_state: [
    { matchup_id: 'm3', game_window: 'SUN 1PM', slot_scores: [{ side: 'home', slot: 'QB', slug: 'josh-allen', score: 33.4, metric: 'BIG' }, { side: 'away', slot: 'RB', slug: 'bijan-robinson', score: 21 }] },
    { matchup_id: 'm4', game_window: 'SUN 1PM', slot_scores: [{ side: 'away', slot: 'WR', slug: 'ceedee-lamb', score: 29.9 }] },
  ],
  league_txn: [], vampire_steal: [], league_report: [], league_message: [], report_request: [],
};
const { client, writes } = makeFakeDb(tables);
__setClientForTest(client);
__resetForTest();

const n = await postWeekReports(WEEK, '2026');
assert.equal(n, 1, 'exactly one league reported: the stamped 2026 one');
assert.equal(writes.league_report.length, 1);
const rep = writes.league_report[0];
assert.equal(rep.league_id, LID); assert.equal(rep.week, WEEK);
assert.equal(rep.payload.top.name, 'Sox', 'the top score is the week\'s best');
assert.equal(rep.payload.mvp.name, 'Josh Allen', 'the MVP is the best slot');
assert.equal(rep.payload.mvp.team, 'Bulls');
assert.deepEqual(rep.payload.standings.map((s) => `${s.name} ${s.w}-${s.l}`), ['Sox 2-0', 'Bulls 2-0', 'Cubs 0-2', 'Bears 0-2'], 'standings run both weeks, points for breaking the tie');
assert.equal(writes.league_message.length, 1);
const msg = writes.league_message[0];
assert.equal(msg.author_id, null, 'the house posts without an author');
assert.equal(msg.kind, 'report'); assert.equal(msg.report_week, WEEK); assert.equal(msg.league_id, LID);
assert.ok(msg.body.startsWith('📋 Week 2 report — Sox led the week with 120.0. Bulls edged Cubs by 0.4.'), msg.body);
assert.ok(msg.body.includes('MVP Josh Allen 33.4'), msg.body);
console.log('PASS  one stamped 2026 league reports; last season and a half-stamped league stay quiet');

// A second pass in the same minute is throttled; a forced one finds nothing new.
assert.equal(await postWeekReports(WEEK, '2026'), 0, 'throttled re-pass posts nothing');
assert.equal(await postWeekReports(WEEK, '2026', { force: true }), 0, 'forced re-pass posts nothing');
// A restart forgets what it posted — the league_report key still stops it.
__resetForTest();
assert.equal(await postWeekReports(WEEK, '2026'), 0, 'a restarted worker does not post the week twice');
assert.equal(writes.league_message.length, 1);
console.log('PASS  a week is reported once, across ticks and restarts');

// The late league finishes stamping → its report goes out on the next look.
tables.matchup.find((m) => m.id === 'l2').home_final = 88; tables.matchup.find((m) => m.id === 'l2').away_final = 77;
assert.equal(await postWeekReports(WEEK, '2026', { force: true }), 1, 'the late league reports once its finals are stamped');
assert.equal(writes.league_message.length, 2);
assert.equal(writes.league_message[1].league_id, LATE);
console.log('PASS  a league reports the moment its last final is stamped');
console.log('ALL WEEK-REPORT TESTS PASSED');

// ── 0277: an admin's request forces a report, replacing the old line ────────
// The LATE league is only half-stamped again for a new week 3, and last
// season's league asks too: both go out, status and season not consulted.
tables.matchup.push(
  { id: 'l3', league_id: LATE, week: 3, home_roster_id: 1, away_roster_id: 2, home_final: 55, away_final: 44, status: 'live' },
  { id: 'l4', league_id: LATE, week: 3, home_roster_id: 3, away_roster_id: 4, home_final: null, away_final: null, status: 'live' },
);
tables.report_request.push(
  { id: 1, league_id: LATE, week: 3, done_at: null, error: null },
  { id: 2, league_id: OLD, week: 2, done_at: null, error: null },
  { id: 3, league_id: LID, week: 9, done_at: null, error: null },       // no matchups
);
const msgsBefore = tables.league_message.length;
assert.equal(await sweepRequests('2026'), 2, 'two requests posted, the empty week closed with an error');
assert.ok(tables.report_request.every((r) => r.done_at), 'every request closed');
assert.equal(tables.report_request[2].error, 'no matchups for that week');
assert.equal(tables.league_message.length, msgsBefore + 2, 'two new lines');
const late3 = tables.league_message.find((m) => m.league_id === LATE && m.report_week === 3);
assert.ok(late3?.body.includes('Roster 1 led the week with 55.0'), late3?.body);
console.log('PASS  an admin request forces a report from whatever finals exist');
// Asking again replaces the line rather than adding a second.
tables.report_request.push({ id: 4, league_id: LATE, week: 3, done_at: null, error: null });
await sweepRequests('2026');
assert.equal(tables.league_message.filter((m) => m.league_id === LATE && m.report_week === 3).length, 1, 'one line for the week after a re-request');
console.log('PASS  a re-request replaces the chat line instead of doubling it');
console.log('ALL WEEK-REPORT TESTS PASSED (0277)');
