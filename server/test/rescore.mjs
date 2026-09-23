// THE COMMISSIONER'S RE-SCORE (0353), the worker's half. Fake Supabase and a
// scripted scorer, so this pins the ERRAND — what it reads, what it refuses,
// what it writes and in what order — not the engine's arithmetic, which the
// restamp and diff-week paths already share.
//   • a PREVIEW writes nothing: no stamp, no report, just a closed request
//     carrying before/after, what moved, what flipped, and who saved no lineup;
//   • an APPLY runs stampFinals(restamp) for exactly that league, then rebuilds
//     and force-posts the week's report, and only when something moved;
//   • a drip league, a week with no slate, and a scorer that throws each close
//     their request with the reason, and the sweep carries on to the next;
//   • a request already started is never picked up twice.
// Run from server/:  npx tsx test/rescore.mjs
import assert from 'node:assert';
import { __setClientForTest } from '../src/supabase.js';
import { sweepRescores } from '../src/rescore.js';

const CL = 'aaaaaaaa-0000-0000-0000-000000000001';   // classic
const DR = 'bbbbbbbb-0000-0000-0000-000000000002';   // drip
const U1 = 'u1', U2 = 'u2', U3 = 'u3', U4 = 'u4';

function makeFakeDb(tables) {
  const rpcs = [];
  function builder(name, rows) {
    const api = {
      select: () => api,
      eq: (c, v) => builder(name, rows.filter((r) => r[c] === v)),
      in: (c, vs) => { const s = new Set(vs); return builder(name, rows.filter((r) => s.has(r[c]))); },
      is: (c, v) => builder(name, rows.filter((r) => (v === null ? r[c] == null : r[c] === v))),
      not: (c, op, v) => builder(name, rows.filter((r) => (op === 'is' && v === null ? r[c] != null : true))),
      order: () => api,
      limit: (k) => builder(name, rows.slice(0, k)),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  }
  const client = {
    from: (name) => ({
      ...builder(name, tables[name] ?? []),
      update: (patch) => {
        const q = [];
        const api = {
          eq: (c, v) => { q.push([c, v]); return api; },
          then: (res, rej) => {
            for (const r of tables[name] ?? []) if (q.every(([c, v]) => r[c] === v)) Object.assign(r, patch);
            return Promise.resolve({ data: null, error: null }).then(res, rej);
          },
        };
        return api;
      },
    }),
    rpc: (fn, args) => {
      rpcs.push({ fn, args });
      if (fn === 'rescore_finish') {
        const r = tables.rescore_request.find((x) => x.id === args.p_id);
        Object.assign(r, { done_at: 'now', result: args.p_result, error: args.p_error });
      }
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { client, rpcs };
}

const tables = {
  league: [
    { id: CL, name: 'Classic', season: '2026', settings_json: { game_mode: 'classic' } },
    { id: DR, name: 'Drip', season: '2026', settings_json: { game_mode: 'drip' } },
  ],
  matchup: [
    { id: 'm1', league_id: CL, week: 3, status: 'final', home_roster_id: 1, away_roster_id: 2, home_final: 100.0, away_final: 98.0 },
    { id: 'm2', league_id: CL, week: 3, status: 'final', home_roster_id: 3, away_roster_id: 4, home_final: 80.0, away_final: 90.0 },
    { id: 'd1', league_id: DR, week: 3, status: 'final', home_roster_id: 1, away_roster_id: 2, home_final: 50, away_final: 60 },
  ],
  league_membership: [
    { league_id: CL, sleeper_roster_id: 1, app_user_id: U1, team_name: 'Ones' },
    { league_id: CL, sleeper_roster_id: 2, app_user_id: U2, team_name: 'Twos' },
    { league_id: CL, sleeper_roster_id: 3, app_user_id: U3, team_name: 'Threes' },
    { league_id: CL, sleeper_roster_id: 4, app_user_id: U4, team_name: 'Fours' },
  ],
  // Seat 4 saved nothing; seat 2's only row is empty (no player), which is nothing.
  sealed_pick: [
    { matchup_id: 'm1', app_user_id: U1, player_slug: 'a' },
    { matchup_id: 'm1', app_user_id: U2, player_slug: null },
    { matchup_id: 'm2', app_user_id: U3, player_slug: 'c' },
  ],
  rescore_request: [
    { id: 1, league_id: CL, week: 3, apply: false, started_at: null, done_at: null },
    { id: 2, league_id: DR, week: 3, apply: false, started_at: null, done_at: null },
    { id: 3, league_id: CL, week: 9, apply: false, started_at: 'earlier', done_at: null },   // already running
  ],
};
const { client, rpcs } = makeFakeDb(tables);
__setClientForTest(client);

const calls = { resolve: [], stamp: [], report: [], slate: [] };
// m1 flips (100–98 → 97–99.5); m2 unchanged.
const NOW = { m1: { home: 97.0, away: 99.5 }, m2: { home: 80.0, away: 90.0 } };
const deps = {
  installWeekSlate: async (w, s) => { calls.slate.push([w, s]); return w === 7 ? 0 : 16; },
  injectWeekPlays: async () => {},
  prefetchTick: async () => ({}),
  resolveMatchup: async (m, _i, _o, opts) => {
    calls.resolve.push({ id: m.id, dry: opts.dryRun });
    if (m.id === 'boom') throw new Error('scorer blew up');
    return NOW[m.id];
  },
  stampFinals: async (week, _i, opts) => {
    calls.stamp.push({ week, ...opts });
    const rows = tables.matchup.filter((m) => m.league_id === opts.leagueId && m.week === week);
    const moved = rows.map((m) => ({ id: m.id, league_id: m.league_id, week, home_roster_id: m.home_roster_id,
      away_roster_id: m.away_roster_id, was: { home: m.home_final, away: m.away_final }, now: NOW[m.id] }));
    for (const m of rows) { m.home_final = NOW[m.id].home; m.away_final = NOW[m.id].away; }
    opts.report(moved);
    return moved.length;
  },
  buildLeagueReport: async (_l, week) => ({ headline: `week ${week}` }),
  postReport: async (l, week, _r, opts) => { calls.report.push({ league: l.id, week, force: opts.force }); },
};

// ── 1. a preview, a drip refusal, and the one already running left alone ──
let n = await sweepRescores(null, () => {}, deps);
assert.equal(n, 2, 'two open, unstarted requests closed');
const pv = tables.rescore_request.find((r) => r.id === 1);
assert.equal(pv.error, null, 'the preview succeeded');
assert.equal(pv.result.changed, 1, 'one matchup would move');
assert.equal(pv.result.flipped, 1, 'and its result would change hands');
const m1 = pv.result.matchups.find((m) => m.id === 'm1');
assert.deepEqual([m1.was, m1.now, m1.home_team], [{ home: 100, away: 98 }, { home: 97, away: 99.5 }, 'Ones']);
assert.ok(pv.result.matchups.find((m) => m.id === 'm2').moved === false, 'the unchanged one says so');
assert.deepEqual(pv.result.autofilled.map((s) => s.roster_id).sort(), [2, 4], 'seats with no real pick are named');
assert.ok(calls.resolve.every((c) => c.dry === true), 'a preview only ever resolves dry');
assert.equal(calls.stamp.length, 0, 'a preview never stamps');
assert.equal(calls.report.length, 0, 'nor touches the report');
assert.equal(tables.matchup.find((m) => m.id === 'm1').home_final, 100, 'the stored final is untouched');
const dr = tables.rescore_request.find((r) => r.id === 2);
assert.match(dr.error, /drip/, 'a drip league is refused by the worker too');
assert.ok(!calls.resolve.some((c) => c.id === 'd1'), 'and nothing of it is resolved');
assert.equal(tables.rescore_request.find((r) => r.id === 3).done_at, null, 'a started request is not picked up again');

// ── 2. the apply ──
tables.rescore_request.push({ id: 4, league_id: CL, week: 3, apply: true, started_at: null, done_at: null });
n = await sweepRescores(null, () => {}, deps);
assert.equal(n, 1);
const ap = tables.rescore_request.find((r) => r.id === 4);
assert.equal(ap.error, null);
assert.equal(calls.stamp.length, 1, 'stamped once');
assert.equal(calls.stamp[0].restamp, true, 'as a re-stamp');
assert.equal(calls.stamp[0].leagueId, CL, 'of this league only');
assert.equal(ap.result.changed, 1);
assert.equal(ap.result.report, 'rebuilt', 'the report was rebuilt');
assert.deepEqual(calls.report, [{ league: CL, week: 3, force: true }], 'and posted, replacing the old one');
const fin = rpcs.filter((c) => c.fn === 'rescore_finish').map((c) => c.args.p_id);
assert.deepEqual(fin, [1, 2, 4], 'every request is closed through rescore_finish, in order');

// ── 3. an apply that moves nothing leaves the report alone ──
tables.rescore_request.push({ id: 5, league_id: CL, week: 3, apply: true, started_at: null, done_at: null });
await sweepRescores(null, () => {}, deps);
assert.equal(tables.rescore_request.find((r) => r.id === 5).result.changed, 0);
assert.equal(calls.report.length, 1, 'no change, no second report');

// ── 4. no slate, and a scorer that throws: closed with the reason, sweep goes on ──
tables.matchup.push({ id: 'm7', league_id: CL, week: 7, status: 'final', home_roster_id: 1, away_roster_id: 2, home_final: 1, away_final: 2 });
tables.matchup.push({ id: 'boom', league_id: CL, week: 8, status: 'final', home_roster_id: 1, away_roster_id: 2, home_final: 1, away_final: 2 });
tables.rescore_request.push({ id: 6, league_id: CL, week: 7, apply: false, started_at: null, done_at: null });
tables.rescore_request.push({ id: 7, league_id: CL, week: 8, apply: false, started_at: null, done_at: null });
n = await sweepRescores(null, () => {}, deps);
assert.equal(n, 2);
assert.match(tables.rescore_request.find((r) => r.id === 6).error, /no NFL slate/);
assert.match(tables.rescore_request.find((r) => r.id === 7).error, /scorer blew up/);

console.log('rescore: all ok');
