// A TEAM DRAFTED AFTER THE LOCK STILL FIELDS A LINEUP (v0.707.1). Founder, on
// his test league's week 5: "Test Wedding is calculating my score as 0" — 0.0
// against 89.4, every card 0.0.
//
// The league drafted fifteen minutes after the week locked. The CPU seats got
// their sealed rows on the auto-slot's agent path right after the draft; the
// human seat, which the auto-slot leaves alone once a week is live, had NO
// rows at all. At resolve that seat reached the classic branch through the
// drip fallback (aiSide), whose non-null drip-shaped picks made `picks != null`
// read as "this side stored a lineup", so it scored its stored nothing instead
// of the unmanaged fill every other row-less seat gets.
//
// This drives the real stampFinals over baked week-1 plays with that exact
// shape: a human seat with no sealed rows, a CPU seat with locked 'wk' rows.
// Offline, in-memory Supabase double (final-resolve.mjs's). Run from server/:
//   npx tsx test/classic-drafted-after-lock.mjs
import { readFileSync } from 'node:fs';
import { __setClientForTest } from '../src/supabase.js';
import { stampFinals } from '../src/resolve.js';
import { injectWeek } from '../src/engine.js';
import { slugMeta } from '../../packages/core/src/data/slugMeta.ts';

const WEEK = 1;

function makeFakeDb(tables) {
  const match = (rows, preds) => rows.filter((r) => preds.every((p) => p(r)));
  function builder(source, preds = [], ord = [], rng = null) {
    const rowsNow = () => {
      let rows = match(source, preds);
      for (const c of [...ord].reverse()) rows = [...rows].sort((a, b) => String(a[c] ?? '').localeCompare(String(b[c] ?? '')));
      return rng ? rows.slice(rng[0], rng[1] + 1) : rows;
    };
    const api = {
      select: () => api,
      eq: (c, v) => builder(source, [...preds, (r) => r[c] === v], ord, rng),
      neq: (c, v) => builder(source, [...preds, (r) => r[c] !== v], ord, rng),
      gt: (c, v) => builder(source, [...preds, (r) => r[c] > v], ord, rng),
      gte: (c, v) => builder(source, [...preds, (r) => r[c] >= v], ord, rng),
      lt: (c, v) => builder(source, [...preds, (r) => r[c] < v], ord, rng),
      lte: (c, v) => builder(source, [...preds, (r) => r[c] <= v], ord, rng),
      in: (c, vs) => { const s = new Set(vs); return builder(source, [...preds, (r) => s.has(r[c])], ord, rng); },
      is: (c, v) => builder(source, [...preds, (r) => (v === null ? r[c] == null : r[c] === v)], ord, rng),
      not: (c, op, v) => builder(source, [...preds, (r) => (op === 'is' && v === null ? r[c] != null : true)], ord, rng),
      or: () => builder(source, preds, ord, rng),
      limit: () => builder(source, preds, ord, rng),
      order: (c) => builder(source, preds, [...ord, c], rng),
      range: (from, to) => builder(source, preds, ord, [from, to]),
      maybeSingle: () => Promise.resolve({ data: rowsNow()[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rowsNow()[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rowsNow(), error: null }).then(res, rej),
      update: (patch) => {
        const chain = {
          eq: (c, v) => { preds = [...preds, (r) => r[c] === v]; return chain; },
          select: () => { const hit = rowsNow(); hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }); },
          then: (res, rej) => { const hit = rowsNow(); hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ error: null }).then(res, rej); },
        };
        return chain;
      },
      upsert: () => Promise.resolve({ error: null }),
      insert: () => Promise.resolve({ error: null }),
      delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }), then: (res) => Promise.resolve({ error: null }).then(res) }) }),
    };
    return api;
  }
  return { from: (table) => builder(tables[table] ?? []), rpc: () => Promise.resolve({ data: null, error: null }) };
}

const playerIndex = { metaForSlug: (slug) => { const m = slugMeta(slug); return m ? { pos: m.pos, team: m.team, full: slug, exp: 5 } : null; } };
const HUMAN = ['jalen-hurts', 'saquon-barkley', 'derrick-henry', 'aj-brown', 'ceedee-lamb', 'dallas-goedert', 'justin-jefferson', 'phi-k', 'phi-dst', 'dak-prescott', 'lamar-jackson'];
const CPU = { QB: 'josh-allen', RB1: 'james-cook', RB2: 'bijan-robinson', WR1: 'ja-marr-chase', WR2: 'khalil-shakir', TE: 'dalton-kincaid', FLEX: 'jahmyr-gibbs', K: 'buf-k', DEF: 'buf-dst' };
const old = '2026-08-01T00:00:00Z';
const TABLES = {
  league: [{ id: 'L1', season: '2026', lineup_policy: 'best_lineup', settings_json: { game_mode: 'classic' } }],
  league_membership: [
    { league_id: 'L1', sleeper_roster_id: 1, app_user_id: 'u1', enrolled: true, controller: 'human' },
    { league_id: 'L1', sleeper_roster_id: 2, app_user_id: null, enrolled: false, controller: null },
  ],
  seat_agent: [{ league_id: 'L1', roster_id: 2, agent_user_id: 'a2' }],
  // the raw roster, slot 0 — what the draft writes for a week already locked
  sleeper_lineup: [
    { league_id: 'L1', week: WEEK, roster_id: 1, starters_json: HUMAN.map((s) => ({ slot: 0, player_slug: s })) },
    { league_id: 'L1', week: WEEK, roster_id: 2, starters_json: Object.values(CPU).map((s) => ({ slot: 0, player_slug: s })) },
  ],
  native_roster: [
    ...HUMAN.map((slug) => ({ league_id: 'L1', roster_id: 1, slug, spot: 'active', added_at: old })),
    ...Object.values(CPU).map((slug) => ({ league_id: 'L1', roster_id: 2, slug, spot: 'active', added_at: old })),
  ],
  league_pool: [...HUMAN, ...Object.values(CPU)].map((slug) => ({ league_id: 'L1', slug, pos: slugMeta(slug)?.pos ?? null, exp: 5, sleeper_id: null })),
  // the CPU seat was filled on the agent path; the human seat has NOTHING
  sealed_pick: Object.entries(CPU).map(([slot, slug]) => ({ matchup_id: 'm1', app_user_id: 'a2', game_window: 'wk', roster_slot: slot, player_slug: slug, metric_id: null, locked: true })),
  applied_state: [],
  injury_status: [],
  matchup: [{ id: 'm1', league_id: 'L1', week: WEEK, home_roster_id: 1, away_roster_id: 2, status: 'final', home_final: null, away_final: null }],
};
__setClientForTest(makeFakeDb(TABLES));
const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));
injectWeek(WEEK, w.pbp, w.points);

let fails = 0;
const ok = (label, cond, extra) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && extra !== undefined ? `  ← ${JSON.stringify(extra)}` : ''}`); if (!cond) fails++; };
const M = () => TABLES.matchup[0];
const n = await stampFinals(WEEK, playerIndex, { playsInjected: true });
ok('the week stamps', n === 1 && M().home_final != null && M().away_final != null, M());
ok('the CPU seat, filled on the agent path, scores its sealed lineup', M().away_final > 0, M().away_final);
ok('THE POINT: the human seat with NO sealed rows scores its best lineup, not an empty one', M().home_final > 0, M().home_final);
console.log(`\n  final: ${M().home_final} — ${M().away_final}`);
if (fails) { console.log(`\nFAIL — ${fails} assertion(s) failed.`); process.exit(1); }
console.log('classic-drafted-after-lock: all passed');
