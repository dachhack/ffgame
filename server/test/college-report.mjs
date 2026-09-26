// The college read-back (v0.550.1), against a fake in-memory client. No network.
import { __setClientForTest } from '../src/supabase.js';
import { collegeReport, collegeLeagueKind, playerLine } from '../src/collegeReport.js';

let fails = 0;
const ok = (cond, label) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

ok(collegeLeagueKind({ calendar: 'college' }) === 'college calendar' && collegeLeagueKind({ roster_shape: { devy: 2 } }) === 'devy'
  && collegeLeagueKind({}) === 'mixed', 'league kinds');
const line = playerLine('c-1', 'A (RB)', [205, 4], [{ player_slug: 'c-1', week: 205, game_id: 'g1' }, { player_slug: 'c-1', week: 205, game_id: 'g1' }]);
ok(line.includes('wk 205: 2 plays (g1)') && line.includes('wk 4: 0 plays'), 'a player line counts plays per week, by game');

// A tiny query-builder fake: filters eq / in / like on in-memory tables.
const T = {
  native_roster: [{ league_id: 'L1', roster_id: 1, slug: 'c-1', spot: 'active' }, { league_id: 'L1', roster_id: 2, slug: 'josh-allen', spot: 'active' },
    { league_id: 'L2', roster_id: 1, slug: 'c-2', spot: 'devy' }],
  league: [{ id: 'L1', name: 'Mixed', settings_json: {} }, { id: 'L2', name: 'Devy', settings_json: { roster_shape: { devy: 1 } } }],
  league_pool: [{ league_id: 'L1', slug: 'c-1', full_name: 'Tide Back', pos: 'RB' }, { league_id: 'L2', slug: 'c-2', full_name: 'Dawg WR', pos: 'WR' }],
  live_play: [{ week: 205, game_id: 'g1', player_slug: 'c-1' }, { week: 4, game_id: 'g1', player_slug: 'c-1' }, { week: 9, game_id: 'gx', player_slug: 'c-1' }],
  matchup: [{ league_id: 'L1', week: 5, status: 'scheduled' }],
};
const q = (rows) => {
  const b = {
    select: () => b, order: () => b, limit: () => b,
    eq: (k, v) => q(rows.filter((r) => r[k] === v)),
    in: (k, vs) => q(rows.filter((r) => vs.includes(r[k]))),
    like: (k, pat) => q(rows.filter((r) => String(r[k]).startsWith(pat.replace('%', '')))),
    then: (res) => res({ data: rows, error: null }),
  };
  return b;
};
__setClientForTest({ from: (t) => q(T[t] ?? []) });
const out = [];
const n = await collegeReport({ weeks: [205, 4], log: (s) => out.push(s) });
const text = out.join('\n');
ok(n === 2, 'finds every league with a college player rostered');
ok(/Mixed · mixed/.test(text) && /Devy · devy/.test(text), 'names each league and its kind');
ok(/c-1\s+Tide Back \(RB\)\s+wk 205: 1 plays \(g1\) · wk 4: 1 plays \(g1\)/.test(text), 'THE POINT: plays at the college week and mirrored into the NFL week');
ok(!/josh-allen/.test(text) && !/gx/.test(text), 'NFL players and other weeks are left out');
ok(/c-2 .*\[devy\]/.test(text), 'a devy stash is marked');
let threw = false; try { await collegeReport({ weeks: [] }); } catch { threw = true; }
ok(threw, 'weeks are required');

if (fails) { console.log(`${fails} FAILED`); process.exit(1); }
console.log('ALL COLLEGE REPORT CHECKS PASS');
