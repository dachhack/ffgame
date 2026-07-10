// Equivalence test for the per-tick bulk-prefetch optimization (resolve.js).
// Proves: resolving a matchup via the batched `ctx` path (prefetchTick) produces
// BYTE-IDENTICAL scores + matchup_state as the per-matchup query path, over a mix
// of enrolled / unenrolled / AI / empty-policy sides. Runs offline against a fake
// in-memory Supabase client (no DB, no key). Run from server/:
//   npx tsx test/resolve-batch.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { __setClientForTest } from '../src/supabase.js';
import { resolveMatchup, prefetchTick } from '../src/resolve.js';
import { injectWeek } from '../src/engine.js';
import { slugMeta } from '../../src/data/slugMeta.ts';

const WEEK = 1;

// ── Fake Supabase client: just enough of the query builder for resolve.js. ───────
// Reads filter in-memory fixtures by eq/in; writes are recorded for comparison.
function makeFakeDb(tables) {
  const writes = { matchup_state: [], matchup: [], rpc: [] };
  function builder(rows) {
    const api = {
      select: () => api,
      eq: (c, v) => builder(rows.filter((r) => r[c] === v)),
      in: (c, vs) => { const s = new Set(vs); return builder(rows.filter((r) => s.has(r[c]))); },
      // .not(col, 'is', null) — the only negation resolve.js uses (v0.109.0+).
      not: (c, op, v) => builder(rows.filter((r) => (op === 'is' && v === null ? r[c] != null : true))),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return api;
  }
  const client = {
    from(table) {
      const rows = tables[table] ?? [];
      const api = builder(rows);
      api.upsert = (newRows) => { writes.matchup_state.push(...newRows); return Promise.resolve({ error: null }); };
      api.update = (patch) => ({ eq: (c, v) => { writes.matchup.push({ patch, [c]: v }); return Promise.resolve({ error: null }); } });
      return api;
    },
    rpc: (name, args) => { writes.rpc.push({ name, args }); return Promise.resolve({ error: null }); },
  };
  return { client, writes, reset: () => { writes.matchup_state = []; writes.matchup = []; writes.rpc = []; } };
}

const playerIndex = { metaForSlug: (slug) => { const m = slugMeta(slug); return m ? { pos: m.pos, team: m.team, full: slug } : null; } };

// Two rosters spread across NFL windows so autoLineup fills multiple slots.
const ROSTER_A = ['jalen-hurts', 'saquon-barkley', 'aj-brown', 'ceedee-lamb', 'dak-prescott', 'derrick-henry', 'lamar-jackson', 'justin-jefferson'];
const ROSTER_B = ['josh-allen', 'james-cook', 'khalil-shakir', 'joe-burrow', 'ja-marr-chase', 'bijan-robinson', 'jahmyr-gibbs', 'caleb-williams'];
const lineup = (slugs) => slugs.map((s) => ({ player_slug: s }));
const U1 = 'user-1', U2 = 'user-2';

const TABLES = {
  league: [{ id: 'L1', lineup_policy: 'best_lineup' }, { id: 'L2', lineup_policy: 'empty' }],
  league_membership: [
    { league_id: 'L1', sleeper_roster_id: 1, app_user_id: U1, enrolled: true, controller: 'human' }, // enrolled, has picks
    { league_id: 'L1', sleeper_roster_id: 2, app_user_id: null, enrolled: false, controller: 'ai' },  // unenrolled → ai fallback
    { league_id: 'L2', sleeper_roster_id: 1, app_user_id: null, enrolled: false, controller: 'ai' },  // ai
    { league_id: 'L2', sleeper_roster_id: 2, app_user_id: U2, enrolled: true, controller: 'human' },  // enrolled, NO picks + empty policy
  ],
  sleeper_lineup: [
    { league_id: 'L1', week: WEEK, roster_id: 1, starters_json: lineup(ROSTER_A) },
    { league_id: 'L1', week: WEEK, roster_id: 2, starters_json: lineup(ROSTER_B) },
    { league_id: 'L2', week: WEEK, roster_id: 1, starters_json: lineup(ROSTER_A) },
    { league_id: 'L2', week: WEEK, roster_id: 2, starters_json: lineup(ROSTER_B) },
  ],
  sealed_pick: [
    { matchup_id: 'm1', app_user_id: U1, game_window: 'tnf', roster_slot: '0', player_slug: 'jalen-hurts', metric_id: 'pass', locked: true },
    { matchup_id: 'm1', app_user_id: U1, game_window: 'snf', roster_slot: '0', player_slug: 'saquon-barkley', metric_id: 'td', locked: true },
  ],
  applied_state: [],
  matchup: [
    { id: 'm1', league_id: 'L1', week: WEEK, home_roster_id: 1, away_roster_id: 2, status: 'live' }, // enrolled vs ai-fallback
    { id: 'm2', league_id: 'L2', week: WEEK, home_roster_id: 1, away_roster_id: 2, status: 'live' }, // ai vs enrolled-no-picks (empty policy)
  ],
};

const fake = makeFakeDb(TABLES);
__setClientForTest(fake.client);

const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));

async function runPath(useCtx) {
  injectWeek(WEEK, w.pbp, w.points);
  fake.reset();
  const ctx = useCtx ? await prefetchTick(TABLES.matchup, WEEK) : undefined;
  const out = [];
  for (const m of TABLES.matchup) {
    const ret = await resolveMatchup(m, playerIndex, undefined, { playsInjected: true, ctx });
    const states = fake.writes.matchup_state.filter((s) => s.matchup_id === m.id)
      .map((s) => ({ w: s.game_window, h: s.home_score, a: s.away_score }))
      .sort((x, y) => (x.w < y.w ? -1 : 1));
    out.push({ id: m.id, ret, states });
  }
  return out;
}

const perMatchup = await runPath(false);   // per-matchup query path (today's behavior)
const batched = await runPath(true);       // bulk-prefetch ctx path (the optimization)

let nonEmpty = 0;
for (let i = 0; i < perMatchup.length; i++) {
  const a = perMatchup[i], b = batched[i];
  assert.deepStrictEqual(b.ret, a.ret, `ret mismatch for ${a.id}: ${JSON.stringify(a.ret)} vs ${JSON.stringify(b.ret)}`);
  assert.deepStrictEqual(b.states, a.states, `state mismatch for ${a.id}`);
  if (a.states.some((s) => s.h || s.a)) nonEmpty++;
  console.log(`  ${a.id}: home ${a.ret.home} away ${a.ret.away} coin ${JSON.stringify(a.ret.coin)} · ${a.states.length} windows — batched == per-matchup ✓`);
}
assert.ok(nonEmpty >= 1, 'expected at least one matchup to resolve to non-empty scores (test would be vacuous otherwise)');

console.log(`\nPASS — bulk-prefetch path is byte-identical to per-matchup queries across ${perMatchup.length} matchups (${nonEmpty} with live scores).`);
