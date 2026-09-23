// A window that has not kicked off publishes NOTHING — not its slot rows
// (0199) and, since v0.388.8, not its total either.
//
// Founder, Sunday morning of 2026 week 1, the SUN 1PM battle bar an hour
// before kickoff: "this hasn't kick off yet, but my opponent is up by 20+."
// The engine credits a Ghost Player (14 flat) and a Bye Steal (a flat
// projection) the moment they are applied, and scores a slot's player
// wherever he is filed; the resolver hid the slot rows of an un-kicked window
// but wrote its home/away totals as computed, so the opponent's sealed plays
// leaked onto the board as a number. Offline against the same fake Supabase
// client as resolve-batch.mjs. Run from server/:
//   npx tsx test/prekick-window.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { __setClientForTest } from '../src/supabase.js';
import { resolveMatchup } from '../src/resolve.js';
import { injectWeek } from '../src/engine.js';
import { slugMeta } from '../../packages/core/src/data/slugMeta.ts';
import { GHOST_POINTS } from '../../packages/core/src/engine/sim.ts';

const WEEK = 1;

function makeFakeDb(tables) {
  const writes = { matchup_state: [], matchup: [], rpc: [] };
  function builder(rows) {
    const api = {
      select: () => api,
      eq: (c, v) => builder(rows.filter((r) => r[c] === v)),
      in: (c, vs) => { const s = new Set(vs); return builder(rows.filter((r) => s.has(r[c]))); },
      not: (c, op, v) => builder(rows.filter((r) => (op === 'is' && v === null ? r[c] != null : true))),
      // .order().range() (v0.489.4): the worker pages its injury_status reads
      // past PostgREST's 1000-row cap, so every double it touches has to offer
      // the same chain. Slicing for real keeps a paging bug findable here.
      order: () => api,
      range: (from, to) => builder(rows.slice(from, to + 1)),
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
const U1 = 'user-1', U2 = 'user-2';

// Two humans, both sealed. Home fields Hurts on TNF and Barkley on SNF, and
// has CONJURED A GHOST into SNF slot 1 — a flat GHOST_POINTS credit the engine
// banks with no game played. Away fields one SNF pick.
const TABLES = {
  league: [{ id: 'L1', lineup_policy: 'best_lineup' }],
  league_membership: [
    { league_id: 'L1', sleeper_roster_id: 1, app_user_id: U1, enrolled: true, controller: 'human' },
    { league_id: 'L1', sleeper_roster_id: 2, app_user_id: U2, enrolled: true, controller: 'human' },
  ],
  sleeper_lineup: [],
  sealed_pick: [
    { matchup_id: 'm1', app_user_id: U1, game_window: 'tnf', roster_slot: '0', player_slug: 'jalen-hurts', metric_id: 'pass', locked: true },
    { matchup_id: 'm1', app_user_id: U1, game_window: 'snf', roster_slot: '0', player_slug: 'saquon-barkley', metric_id: 'td', locked: true },
    { matchup_id: 'm1', app_user_id: U2, game_window: 'snf', roster_slot: '0', player_slug: 'josh-allen', metric_id: 'pass', locked: true },
    // Opposes the ghost: an unopposed slot is a backup and banks nothing, which
    // would make the flat credit vanish for a reason this test isn't about.
    { matchup_id: 'm1', app_user_id: U2, game_window: 'snf', roster_slot: '1', player_slug: 'james-cook', metric_id: 'rush', locked: true },
  ],
  applied_state: [
    { matchup_id: 'm1', app_user_id: U1, week: WEEK, payload_json: { targeted: { ghost: ['snf|1'] } } },
  ],
  matchup: [
    { id: 'm1', league_id: 'L1', week: WEEK, home_roster_id: 1, away_roster_id: 2, status: 'live' },
  ],
};

const fake = makeFakeDb(TABLES);
__setClientForTest(fake.client);
const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));

async function run(startedWins) {
  injectWeek(WEEK, w.pbp, w.points);
  fake.reset();
  await resolveMatchup(TABLES.matchup[0], playerIndex, undefined, { playsInjected: true, startedWins });
  const by = {};
  for (const s of fake.writes.matchup_state) by[s.game_window] = s;
  return by;
}

// ── 1. Every window kicked: SNF carries the ghost's flat credit in its total ──
const all = await run(new Set(['tnf', 'snf']));
assert.ok(all.snf && all.tnf, 'both windows publish');
assert.ok(all.snf.home_score >= GHOST_POINTS, `SNF home total carries the ghost (${all.snf.home_score} ≥ ${GHOST_POINTS})`);
assert.ok(all.snf.slot_scores.some((r) => r.metric === 'ghost' && r.score === GHOST_POINTS), `SNF slot rows show the ghost banking ${GHOST_POINTS} once kicked`);
console.log(`  all kicked: tnf ${all.tnf.home_score}–${all.tnf.away_score} · snf ${all.snf.home_score}–${all.snf.away_score} (ghost inside) ✓`);

// ── 2. Only TNF kicked: SNF publishes 0–0 and no slot rows — the ghost and
//      Barkley's TD both stay sealed until Sunday night ─────────────────────
const tnfOnly = await run(new Set(['tnf']));
assert.strictEqual(tnfOnly.snf.home_score, 0, 'un-kicked SNF home total is 0 (the ghost does not leak)');
assert.strictEqual(tnfOnly.snf.away_score, 0, 'un-kicked SNF away total is 0');
assert.deepStrictEqual(tnfOnly.snf.slot_scores, [], 'un-kicked SNF publishes no slot rows');
assert.deepStrictEqual(
  { h: tnfOnly.tnf.home_score, a: tnfOnly.tnf.away_score }, { h: all.tnf.home_score, a: all.tnf.away_score },
  'the kicked window is untouched');
console.log(`  tnf only:   tnf ${tnfOnly.tnf.home_score}–${tnfOnly.tnf.away_score} · snf ${tnfOnly.snf.home_score}–${tnfOnly.snf.away_score} ✓`);

// ── 3. No kickoffs known (null): legacy behavior, everything publishes ──────
const none = await run(null);
assert.strictEqual(none.snf.home_score, all.snf.home_score, 'a slate with no kickoffs publishes as before (lock_at seals everything)');
console.log('  no slate:   publishes as before ✓');

console.log('\nPASS — a window that has not kicked off publishes 0–0 and no slots; its flat credits stay sealed until kickoff.');
