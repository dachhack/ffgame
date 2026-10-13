// THE FROZEN BOARD LEARNS WHAT A CONTEST LEAGUE NEEDS (v0.665.2). Founder: "I
// have a HC spot and a rookie only spot and the players are not populating."
// A board frozen before 0466 has no exp and no HC rows; topUpSalaryBoard fills
// exp from the index and adds the rows a fresh build carries, never touching
// a frozen salary. The database is an in-memory double; the projections feed
// is cut so the build prices the new rows at the floor.
import { __setClientForTest } from '../src/supabase.js';

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

const T = {
  pod_salary: [
    { season: '2026', week: 6, slug: 'qb-one', name: 'Q One', pos: 'QB', team: 'KC', salary: 8800, proj: 21.5, exp: null },
    { season: '2026', week: 6, slug: 'rb-rook', name: 'R Rook', pos: 'RB', team: 'BUF', salary: 5100, proj: 11.2, exp: null },
    { season: '2026', week: 6, slug: 'kc-k', name: 'KC Kicker', pos: 'K', team: 'KC', salary: 4200, proj: 8, exp: null },
    { season: '2026', week: 6, slug: 'kc-dst', name: 'KC D/ST', pos: 'DEF', team: 'KC', salary: 4000, proj: 7, exp: null },
    { season: '2026', week: 6, slug: 'buf-k', name: 'BUF Kicker', pos: 'K', team: 'BUF', salary: 4200, proj: 8, exp: null },
    { season: '2026', week: 6, slug: 'buf-dst', name: 'BUF D/ST', pos: 'DEF', team: 'BUF', salary: 4000, proj: 7, exp: null },
  ],
  league: [{ id: 'L', kind: 'dfs', season: '2026', settings_json: { positions_extra: [] } }],
};
const upserts = [];
function builder(name, preds = []) {
  const rows = () => (T[name] ?? []).filter((x) => preds.every((p) => p(x)));
  const api = {
    select: () => api,
    eq: (c, v) => builder(name, [...preds, (r) => String(r[c]) === String(v)]),
    in: (c, vs) => builder(name, [...preds, (r) => vs.includes(r[c])]),
    limit: () => api, range: () => api,
    then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej),
    upsert: (list) => { upserts.push(...list); return Promise.resolve({ error: null }); },
  };
  return api;
}
__setClientForTest({ from: (t) => builder(t) });
globalThis.fetch = async () => { throw new Error('no network in test'); };

const idx = {
  metaForSlug: (slug) => ({ 'qb-one': { exp: 7 }, 'rb-rook': { exp: 0 } })[slug] ?? null,
  allSlugs: () => [],
  sleeper: () => null,
};
const { topUpSalaryBoard } = await import('../src/pods.js');
const before = T.pod_salary.map((r) => ({ ...r }));
// The week's first pass: no league has unlocked a coach yet, so it fills in
// experience and nothing else.
const board0 = await topUpSalaryBoard('2026', 6, idx, new Set(['KC', 'BUF']), T.pod_salary.map((r) => ({ ...r })));
ok('the first pass fills experience and adds no position nobody wants', board0.length === T.pod_salary.length && upserts.length === 2 && !board0.some((r) => r.pos === 'HC'));
// v0.679.2: a league unlocks HEAD COACH after that pass. The same process's
// next pass adds the coaches — the week-6 CPU squads with an empty HC and
// Rookie Only spot were built against a board that never got them.
T.league[0].settings_json.positions_extra = ['HC'];
const board = await topUpSalaryBoard('2026', 6, idx, new Set(['KC', 'BUF']), board0);

ok('exp is filled from the index on the frozen rows', board.find((r) => r.slug === 'qb-one')?.exp === 7 && board.find((r) => r.slug === 'rb-rook')?.exp === 0);
ok('a rookie is a rookie now', board.find((r) => r.slug === 'rb-rook')?.exp === 0);
ok('the HC rows a contest league unlocked AFTER the first pass are added on the next, one per slate team', board.filter((r) => r.pos === 'HC').map((r) => r.slug).sort().join() === 'buf-hc,kc-hc');
ok('the new rows sit at the floor', board.filter((r) => r.pos === 'HC').every((r) => r.salary === 3000 && r.proj === 0));
ok('frozen salaries and projections are untouched', before.every((b) => { const n = board.find((r) => r.slug === b.slug); return n && n.salary === b.salary && n.proj === b.proj; }));
ok('the writes are the exp fixes and the new rows only', upserts.length === 4 && upserts.filter((u) => u.pos === 'HC').length === 2 && upserts.every((u) => u.season === '2026' && u.week === 6));
const again = await topUpSalaryBoard('2026', 6, idx, new Set(['KC', 'BUF']), board);
ok('a second pass in the same process writes nothing', again === board && upserts.length === 4);
// THE RAMS (v0.707.0): a slate team with nobody on the frozen board gets its people added — the index's LAR
// against the slate's LA. The projections feed is cut, so his season rate prices him (a real slug the bake knows).
const ramsIdx = { ...idx, allSlugs: () => [{ slug: 'matthew-stafford', full: 'Matthew Stafford', pos: 'QB', team: 'LAR', sid: '421', exp: 17 }] };
const wide = await topUpSalaryBoard('2026', 7, ramsIdx, new Set(['KC', 'BUF', 'LA']), [
  { season: '2026', week: 7, slug: 'qb-one', name: 'Q One', pos: 'QB', team: 'KC', salary: 8800, proj: 21.5, exp: 7 },
  { season: '2026', week: 7, slug: 'kc-k', name: 'KC Kicker', pos: 'K', team: 'KC', salary: 4200, proj: 8, exp: null },
  { season: '2026', week: 7, slug: 'kc-dst', name: 'KC D/ST', pos: 'DEF', team: 'KC', salary: 4000, proj: 7, exp: null },
  { season: '2026', week: 7, slug: 'la-k', name: 'LA Kicker', pos: 'K', team: 'LA', salary: 4200, proj: 8, exp: null },
  { season: '2026', week: 7, slug: 'la-dst', name: 'LA D/ST', pos: 'DEF', team: 'LA', salary: 4000, proj: 7, exp: null },
]);
const staff = wide.find((r) => r.slug === 'matthew-stafford');
ok('a slate team with nobody on the board gets its people, as the slate codes them', !!staff && staff.team === 'LA', wide.map((r) => r.slug));
const wide2 = await topUpSalaryBoard('2026', 7, ramsIdx, new Set(['KC', 'BUF', 'LA']), wide);
ok('one try per team per process: the next pass adds nothing', wide2 === wide);

if (fails) { console.log(`\nFAIL — ${fails} assertion(s) failed.`); process.exit(1); }
console.log('\nPASS — a frozen board learns exp and the extra positions.');
