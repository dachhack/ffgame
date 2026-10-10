// DFS BULLSEYE (v0.660.0, 0462) — the worker's dfs_bullseye resolver branch,
// end to end on the real FINAL path (stampFinals), on baked Week-1 plays,
// against an in-memory Supabase double (final-resolve.mjs's). Asserts:
//   1. the open contest's SOLO row (a seat paired with itself) stamps a ring
//      total equal to the engine's own scoreDfsBullseye under stock PPR;
//   2. a salary-cap league playing Bullseye stamps both sides, each its own
//      squad — and banks no drip coin (that is the drip engine's alone);
//   3. a squad saved the old way (numbered slots) scores the same as named.
// Run from server/: npx tsx test/dfs-bullseye.mjs
import { readFileSync } from 'node:fs';
import { __setClientForTest } from '../src/supabase.js';
import { stampFinals } from '../src/resolve.js';
import { injectWeek, makePlayer } from '../src/engine.js';
import { slugMeta } from '../../packages/core/src/data/slugMeta.ts';
import { classicPoints } from '../../packages/core/src/engine/classic.ts';
import { dfsCard, dfsSlotsOf, dfsSlotPos, scoreDfsBullseye, dfsBullseyeConfigOf, DFS_SLOT_NAMES, dfsTiebreak, tiebreakDistance } from '../../packages/core/src/engine/dfsBullseye.ts';

const WEEK = 1;
function makeFakeDb(tables) {
  const rpc = [];
  const match = (rows, preds) => rows.filter((r) => preds.every((p) => p(r)));
  // `ord` / `rng` model .order().range() (v0.489.4): the worker pages its reads
  // of injury_status past PostgREST's 1000-row cap, and a double that answers
  // every select with everything would prove a pagination bug absent. It has to
  // sort and slice like the real client, or the test is agreeing with itself.
  function builder(source, preds = [], ord = [], rng = null) {
    const rowsNow = () => {
      let rows = match(source, preds);
      for (const c of [...ord].reverse()) {
        rows = [...rows].sort((a, b) => String(a[c] ?? '').localeCompare(String(b[c] ?? '')));
      }
      return rng ? rows.slice(rng[0], rng[1] + 1) : rows;
    };
    const api = {
      select: () => api,
      eq: (c, v) => builder(source, [...preds, (r) => r[c] === v], ord, rng),
      in: (c, vs) => { const s = new Set(vs); return builder(source, [...preds, (r) => s.has(r[c])], ord, rng); },
      is: (c, v) => builder(source, [...preds, (r) => (v === null ? r[c] == null : r[c] === v)], ord, rng),
      not: (c, op, v) => builder(source, [...preds, (r) => (op === 'is' && v === null ? r[c] != null : true)], ord, rng),
      order: (c) => builder(source, preds, [...ord, c], rng),
      range: (from, to) => builder(source, preds, ord, [from, to]),
      maybeSingle: () => Promise.resolve({ data: rowsNow()[0] ?? null, error: null }),
      then: (res, rej) => Promise.resolve({ data: rowsNow(), error: null }).then(res, rej),
      // .update(patch).eq(...).select('id') → mutate the matched rows, return them.
      update: (patch) => {
        const chain = {
          eq: (c, v) => { preds = [...preds, (r) => r[c] === v]; return chain; },
          select: () => { const hit = rowsNow(); hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }); },
          then: (res, rej) => { const hit = rowsNow(); hit.forEach((r) => Object.assign(r, patch)); return Promise.resolve({ error: null }).then(res, rej); },
        };
        return chain;
      },
      upsert: () => Promise.resolve({ error: null }),
    };
    return api;
  }
  const client = {
    from: (table) => builder(tables[table] ?? []),
    rpc: (name, args) => { rpc.push({ name, args }); return Promise.resolve({ error: null }); },
  };
  return { client, rpc };
}


const playerIndex = { metaForSlug: (slug) => { const m = slugMeta(slug); return m ? { pos: m.pos, team: m.team, full: slug } : null; } };
const SET = { dfs_bullseye: true, bullseye: 'slots', bullseye_radius: 10 };
const named = (m) => DFS_SLOT_NAMES.map((s) => ({ slot: s, sleeper_id: null, player_slug: m[s], pos: dfsSlotPos(s) }));
const A = { QB: 'jalen-hurts', RB1: 'saquon-barkley', RB2: 'derrick-henry', WR1: 'aj-brown', WR2: 'ceedee-lamb', WR3: 'justin-jefferson', TE: 'dallas-goedert', K: 'phi-k', DEF: 'phi-dst' };
const B = { QB: 'josh-allen', RB1: 'james-cook', RB2: 'bijan-robinson', WR1: 'ja-marr-chase', WR2: 'khalil-shakir', WR3: 'garrett-wilson', TE: 'travis-kelce', K: 'buf-k', DEF: 'buf-dst' };
// The same squad A, saved the old way: numbered slots in position order.
const legacyA = named(A).map((r, i) => ({ ...r, slot: i }));

const TABLES = {
  league: [
    { id: 'OPEN', lineup_policy: 'empty', settings_json: SET },
    { id: 'PRIV', lineup_policy: 'best_lineup', settings_json: { ...SET, bullseye: 'total' } },
    { id: 'OLD', lineup_policy: 'empty', settings_json: SET },
    { id: 'TIE', lineup_policy: 'best_lineup', settings_json: SET },
  ],
  league_membership: [
    { league_id: 'OPEN', sleeper_roster_id: 1, app_user_id: 'u1', enrolled: true, controller: 'human' },
    { league_id: 'PRIV', sleeper_roster_id: 1, app_user_id: 'u1', enrolled: true, controller: 'human' },
    { league_id: 'PRIV', sleeper_roster_id: 2, app_user_id: null, enrolled: false, controller: 'ai' },
    { league_id: 'OLD', sleeper_roster_id: 1, app_user_id: 'u1', enrolled: true, controller: 'human' },
    { league_id: 'TIE', sleeper_roster_id: 1, app_user_id: 'u1', enrolled: true, controller: 'human' },
    { league_id: 'TIE', sleeper_roster_id: 2, app_user_id: 'u2', enrolled: true, controller: 'human' },
  ],
  sleeper_lineup: [
    { league_id: 'OPEN', week: WEEK, roster_id: 1, starters_json: named(A) },
    { league_id: 'PRIV', week: WEEK, roster_id: 1, starters_json: named(A) },
    { league_id: 'PRIV', week: WEEK, roster_id: 2, starters_json: named(B) },
    { league_id: 'OLD', week: WEEK, roster_id: 1, starters_json: legacyA },
    // THE SAME SQUAD on both sides: the rings must tie, so the tie-breaker decides.
    { league_id: 'TIE', week: WEEK, roster_id: 1, starters_json: named(A) },
    { league_id: 'TIE', week: WEEK, roster_id: 2, starters_json: named(A) },
  ],
  sealed_pick: [], applied_state: [], player_flag: [], seat_agent: [], player_adjustment: [],
  matchup: [
    { id: 'open1', league_id: 'OPEN', week: WEEK, home_roster_id: 1, away_roster_id: 1, status: 'final', home_final: null, away_final: null },
    { id: 'priv1', league_id: 'PRIV', week: WEEK, home_roster_id: 1, away_roster_id: 2, status: 'final', home_final: null, away_final: null },
    { id: 'old1', league_id: 'OLD', week: WEEK, home_roster_id: 1, away_roster_id: 1, status: 'final', home_final: null, away_final: null },
    { id: 'tie1', league_id: 'TIE', week: WEEK, home_roster_id: 1, away_roster_id: 2, status: 'final', home_final: null, away_final: null },
  ],
};
const fake = makeFakeDb(TABLES);
__setClientForTest(fake.client);
const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));
injectWeek(WEEK, w.pbp, w.points);

let fails = 0;
const ok = (label, cond, got) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${!cond && got !== undefined ? ` — got ${JSON.stringify(got)}` : ''}`); if (!cond) fails++; };
const M = (id) => TABLES.matchup.find((m) => m.id === id);

// What the engine says each squad is worth, independently of the resolver.
const pts = (slug, slot) => { const m = slugMeta(slug); return classicPoints(makePlayer(slug, m?.pos, m?.team, slug), WEEK, 1, dfsSlotPos(slot), slot); };
const expectOf = (leagueId, home, away, settings) =>
  scoreDfsBullseye({ home: dfsSlotsOf(named(home)), away: dfsSlotsOf(named(away)) }, dfsCard(leagueId, WEEK), dfsBullseyeConfigOf(settings), pts);

const stamped = await stampFinals(WEEK, playerIndex, { playsInjected: true });
ok('stampFinals stamps all four rows', stamped === 4, stamped);

const raw = Object.values(A).reduce((s, slug, i) => s + pts(slug, DFS_SLOT_NAMES[i]), 0);
ok('the squad really scored (baked week-1 points)', raw > 20, raw);

const eOpen = expectOf('OPEN', A, A, SET);
ok('open contest: the solo row stamps the engine\'s ring total', M('open1').home_final === Math.round(eOpen.home * 10) / 10, [M('open1').home_final, eOpen.home]);
ok('open contest: the ring total is not the raw points', M('open1').home_final !== Math.round(raw * 10) / 10);

const ePriv = expectOf('PRIV', A, B, { ...SET, bullseye: 'total' });
ok('private league: home stamps its squad\'s ring total', M('priv1').home_final === Math.round(ePriv.home * 10) / 10, [M('priv1').home_final, ePriv.home]);
ok('private league: away stamps ITS squad, not home\'s', M('priv1').away_final === Math.round(ePriv.away * 10) / 10 && ePriv.home !== ePriv.away, [M('priv1').away_final, ePriv.away]);
ok('no drip coin is banked for a Bullseye contest', fake.rpc.filter((c) => c.name === 'credit_wallet').length === 0);

const eOld = expectOf('OLD', A, A, SET);
ok('a numbered (save_pod_entry) squad scores like the named one', M('old1').home_final === Math.round(eOld.home * 10) / 10, [M('old1').home_final, eOld.home]);

// ── THE TIE-BREAKER (v0.660.1): identical squads tie on rings; the seat whose
// own tie-break spot landed closer is put 0.01 ahead, and both distances land.
const tieCard = dfsCard('TIE', WEEK);
const tb1 = dfsTiebreak('TIE', WEEK, 1, tieCard), tb2 = dfsTiebreak('TIE', WEEK, 2, tieCard);
const d1 = tiebreakDistance(pts(A[tb1.slot], tb1.slot), tb1.target, 10), d2 = tiebreakDistance(pts(A[tb2.slot], tb2.slot), tb2.target, 10);
const ring = Math.round(expectOf('TIE', A, A, SET).home * 10) / 10;
const T = M('tie1');
ok('tie: both tie-break distances are stored', T.home_tb === d1 && T.away_tb === d2, [T.home_tb, T.away_tb, d1, d2]);
if (d1 !== d2) {
  const homeWins = d1 < d2;
  ok('tie: the closer tie-break wins by exactly 0.01', homeWins
    ? T.home_final === Math.round((ring + 0.01) * 100) / 100 && T.away_final === ring
    : T.away_final === Math.round((ring + 0.01) * 100) / 100 && T.home_final === ring, [T.home_final, T.away_final, ring, d1, d2]);
} else {
  ok('tie: an equal tie-break leaves the tie standing', T.home_final === T.away_final);
}

console.log(`\n  open ${M('open1').home_final} · private ${M('priv1').home_final}–${M('priv1').away_final} · old ${M('old1').home_final}`);
if (fails) { console.log(`\nFAIL — ${fails} assertion(s) failed.`); process.exit(1); }
console.log('\nPASS — DFS Bullseye scores end to end on the final path.');
