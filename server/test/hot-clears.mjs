// 🔥 HOT comes off with the whistle (v0.388.13).
//
// Founder, Monday: "still says hot, but game has been over for a while."
// The resolver's slot rows carry `hot` (the engine's last-tick streak state),
// and a finished game leaves no later tick to cool it. The tick now hands
// resolveMatchup the teams whose game ESPN marks completed (opts.doneTeams);
// their players publish without `hot`. Same fake-Supabase harness as
// resolve-batch.mjs. Run from server/:  npx tsx test/hot-clears.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { __setClientForTest } from '../src/supabase.js';
import { resolveMatchup } from '../src/resolve.js';
import { injectWeek } from '../src/engine.js';
import { slugMeta, normTeam } from '../../packages/core/src/data/slugMeta.ts';

const WEEK = 1;
function makeFakeDb(tables) {
  const writes = { matchup_state: [], matchup: [], rpc: [] };
  function builder(rows) {
    const api = {
      select: () => api,
      eq: (c, v) => builder(rows.filter((r) => r[c] === v)),
      in: (c, vs) => { const s = new Set(vs); return builder(rows.filter((r) => s.has(r[c]))); },
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
  return { client, writes, reset: () => { writes.matchup_state = []; } };
}
const playerIndex = { metaForSlug: (slug) => { const m = slugMeta(slug); return m ? { pos: m.pos, team: m.team, full: slug } : null; } };
const U1 = 'user-1', U2 = 'user-2';
// Two drip receivers each side in one window — drips run hot on a good day.
const TABLES = {
  league: [{ id: 'L1', lineup_policy: 'best_lineup' }],
  league_membership: [
    { league_id: 'L1', sleeper_roster_id: 1, app_user_id: U1, enrolled: true, controller: 'human' },
    { league_id: 'L1', sleeper_roster_id: 2, app_user_id: U2, enrolled: true, controller: 'human' },
  ],
  sleeper_lineup: [],
  sealed_pick: [
    { matchup_id: 'm1', app_user_id: U1, game_window: 'early', roster_slot: '0', player_slug: 'jamarr-chase', metric_id: 'recyd', locked: true },
    { matchup_id: 'm1', app_user_id: U1, game_window: 'early', roster_slot: '1', player_slug: 'ceedee-lamb', metric_id: 'recyd', locked: true },
    { matchup_id: 'm1', app_user_id: U2, game_window: 'early', roster_slot: '0', player_slug: 'puka-nacua', metric_id: 'recyd', locked: true },
    { matchup_id: 'm1', app_user_id: U2, game_window: 'early', roster_slot: '1', player_slug: 'justin-jefferson', metric_id: 'recyd', locked: true },
  ],
  applied_state: [],
  matchup: [{ id: 'm1', league_id: 'L1', week: WEEK, home_roster_id: 1, away_roster_id: 2, status: 'live' }],
};
const fake = makeFakeDb(TABLES);
__setClientForTest(fake.client);
const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));

async function rows(doneTeams) {
  injectWeek(WEEK, w.pbp, w.points);
  fake.reset();
  await resolveMatchup(TABLES.matchup[0], playerIndex, undefined, { playsInjected: true, startedWins: new Set(['early']), doneTeams });
  return fake.writes.matchup_state.flatMap((s) => s.slot_scores ?? []);
}

const live = await rows(undefined);
const hotRows = live.filter((r) => r.hot);
console.log('  live rows:', live.map((r) => `${r.slug}${r.hot ? ' 🔥' : ''}`).join(' · '));
assert.ok(hotRows.length >= 1, 'the fixture must produce at least one hot slot, or the test is vacuous');

// The hot player's game is over → his row cools; a teammate-less other game stays.
const t = normTeam(slugMeta(hotRows[0].slug).team);
const after = await rows(new Set([t]));
for (const r of after) {
  const team = normTeam(slugMeta(r.slug).team);
  if (team === t) assert.ok(!r.hot, `${r.slug} (${team}, game over) publishes no hot`);
}
const stillHot = after.filter((r) => r.hot && normTeam(slugMeta(r.slug).team) !== t);
const wasHotElsewhere = live.filter((r) => r.hot && normTeam(slugMeta(r.slug).team) !== t);
assert.strictEqual(stillHot.length, wasHotElsewhere.length, 'other teams’ games still running keep their 🔥');
console.log(`  ${t} done: ${hotRows.filter((r) => normTeam(slugMeta(r.slug).team) === t).length} row(s) cooled, ${stillHot.length} elsewhere still hot ✓`);

// Every game over → nobody is hot.
const all = await rows(new Set(live.map((r) => normTeam(slugMeta(r.slug).team))));
assert.ok(all.every((r) => !r.hot), 'every game final: no row is hot');
assert.deepStrictEqual(all.map((r) => r.score), live.map((r) => r.score), 'scores are untouched — only the badge cools');
console.log('  all done: no 🔥, scores identical ✓');
console.log('\nPASS — a finished game’s players publish without hot; scores unchanged.');
