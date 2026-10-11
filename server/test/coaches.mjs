// WHO THE HEAD COACH IS (0468). Founder: "The head coaches are just listed
// as Jaguars Head coach and Bears Head coach. Can we get a scan for their
// names each week." The scan reads ESPN's team directory and coach records;
// the pure half (abbreviation → unit code, record → name, rows) is pinned
// here, and the sync is run against an in-memory double with a canned feed.
import { __setClientForTest } from '../src/supabase.js';
import { unitCodeOf, coachNameOf, teamRoleRows, fetchHeadCoaches, syncHeadCoaches } from '../src/poll/coaches.js';
import { buildSalaryBoard } from '../src/pods.js';

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };

// ── codes ──────────────────────────────────────────────────────────────────
ok('JAX → jax', unitCodeOf('JAX') === 'jax', unitCodeOf('JAX'));
ok('WSH → was (ESPN spells Washington its own way)', unitCodeOf('WSH') === 'was');
ok('LAR → la (the Rams, #1095)', unitCodeOf('LAR') === 'la');
ok('an unknown abbreviation is dropped', unitCodeOf('PRO') === null);

// ── names ──────────────────────────────────────────────────────────────────
ok('first + last', coachNameOf({ firstName: 'Liam', lastName: 'Coen' }) === 'Liam Coen');
ok('no name → null', coachNameOf({ firstName: '', lastName: ' ' }) === null);

// ── rows ───────────────────────────────────────────────────────────────────
const teams = { sports: [{ leagues: [{ teams: [
  { team: { id: '30', abbreviation: 'JAX' } },
  { team: { id: '3', abbreviation: 'CHI' } },
  { team: { id: '28', abbreviation: 'WSH' } },
  { team: { id: '14', abbreviation: 'LAR' } },
  { team: { id: '99', abbreviation: 'PRO' } },
] }] }] };
const coaches = new Map([
  ['30', [{ firstName: 'Liam', lastName: 'Coen' }]],
  ['3', [{ firstName: 'Ben', lastName: 'Johnson' }]],
  ['28', [{ firstName: 'Dan', lastName: 'Quinn' }]],
  // the Rams' page came back empty this time: no row, the old name stands
  ['14', []],
]);
const rows = teamRoleRows(teams, coaches);
ok('one row per team with a coach', rows.length === 3, rows);
ok('slug is the unit, name is the person', rows.some((r) => r.slug === 'jax-hc' && r.name === 'Liam Coen' && r.team === 'JAX'), rows);
ok('Washington lands on was-hc', rows.some((r) => r.slug === 'was-hc' && r.name === 'Dan Quinn'), rows);
ok('a team without a record is skipped, not blanked', !rows.some((r) => r.slug === 'la-hc'));

// ── the fetch: teams, then each team's coach list, then each record ───────
const calls = [];
const fetchJson = async (url) => {
  calls.push(url);
  if (url.includes('/teams?')) return teams;
  const m = /teams\/(\d+)\/coaches/.exec(url);
  if (m) return { items: (coaches.get(m[1]) ?? []).map((_, i) => ({ $ref: `http://core/coach/${m[1]}/${i}` })) };
  const c = /coach\/(\d+)\/(\d+)/.exec(url);
  if (c) return coaches.get(c[1])[Number(c[2])];
  throw new Error(`unexpected ${url}`);
};
const fetched = await fetchHeadCoaches('2026', { fetchJson });
ok('fetch walks the directory to three names', fetched.length === 3 && fetched.every((r) => r.name), fetched);
ok('coach refs are read over https', calls.filter((u) => u.includes('/coach/')).every((u) => u.startsWith('https:')), calls);
ok('the season is in the coaches route', calls.some((u) => u.includes('/seasons/2026/teams/30/coaches')), calls);

// ── the sync: changed rows only, then the names pushed into pools/boards ──
const T = { team_role: [{ slug: 'jax-hc', name: 'Liam Coen' }, { slug: 'chi-hc', name: 'Matt Eberflus' }] };
const upserts = []; const rpcs = [];
function builder(name) {
  const api = {
    select: () => api,
    then: (res, rej) => Promise.resolve({ data: T[name] ?? [], error: null }).then(res, rej),
    upsert: (list) => { upserts.push(...list); return Promise.resolve({ error: null }); },
  };
  return api;
}
__setClientForTest({ from: (t) => builder(t), rpc: (fn) => { rpcs.push(fn); return Promise.resolve({ data: 5, error: null }); } });
// A real scan refuses a short read (a feed outage must not blank the table).
let short = null;
try { await syncHeadCoaches('2026', { fetchJson }); } catch (e) { short = e.message; }
ok('fewer than 16 names is refused', /too short/.test(short ?? ''), short);
// Pad the feed to a full league so the sync runs.
const big = { sports: [{ leagues: [{ teams: [...Array(32)].map((_, i) => ({ team: { id: String(100 + i), abbreviation: ['ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAR', 'LAC', 'LV', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WSH'][i] } })) }] }] };
const bigFetch = async (url) => {
  if (url.includes('/teams?')) return big;
  const m = /teams\/(\d+)\/coaches/.exec(url);
  if (m) return { items: [{ $ref: `https://core/coach/${m[1]}` }] };
  const c = /coach\/(\d+)$/.exec(url);
  const i = Number(c[1]) - 100;
  const abbr = big.sports[0].leagues[0].teams[i].team.abbreviation;
  if (abbr === 'JAX') return { firstName: 'Liam', lastName: 'Coen' };
  if (abbr === 'CHI') return { firstName: 'Ben', lastName: 'Johnson' };
  return { firstName: 'Coach', lastName: abbr };
};
const r = await syncHeadCoaches('2026', { fetchJson: bigFetch });
ok('32 scanned', r.scanned === 32, r);
ok('only the changed rows are written (Coen unchanged, Chicago renamed)', !upserts.some((u) => u.slug === 'jax-hc') && upserts.some((u) => u.slug === 'chi-hc' && u.name === 'Ben Johnson'), upserts.map((u) => u.slug));
ok('the names are pushed into pools and boards', rpcs.includes('sync_team_role_names') && r.pushed === 5, r);

// ── the board carries the name when it knows one ───────────────────────────
const idx = { allSlugs: () => [], metaForSlug: () => null };
const board = buildSalaryBoard(idx, new Set(['JAX', 'CHI']), null, new Set(['HC']), new Map([['jax-hc', 'Liam Coen']]));
const jax = board.find((x) => x.slug === 'jax-hc'); const chi = board.find((x) => x.slug === 'chi-hc');
ok('a scanned coach is on the board by name', jax?.name === 'Liam Coen', jax);
ok('an unscanned one keeps the unit label', chi?.name === 'CHI Head Coach', chi);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
