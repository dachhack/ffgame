// THE WEEK ACTUALLY CLOSES — a test for the real scorer's FINAL path, the seam
// that had no coverage and where the "finals never get stamped" bug hid.
//
// Every other resolve test runs the engine or resolveMatchup at status 'live'.
// But home_final/away_final and the weekly coin are written ONLY at
// status 'final' (resolve.js), and closing a week is two steps the tick runs
// back to back: finalizeMatchups flips 'live'→'final', then stampFinals resolves
// those rows so their scores land. This drives that exact pair — the real
// functions, on real (baked Week-1) plays — and asserts:
//
//   1. finalizeMatchups ALONE leaves home_final NULL. (This is the whole bug:
//      flipping status is not scoring. The completed-week tick used to stop
//      here.)
//   2. stampFinals then writes home_final/away_final == the resolved totals AND
//      banks each side's coin via credit_wallet.
//   3. A second stampFinals is a quiet no-op — nothing left with a NULL score.
//
// Offline, against a MUTABLE in-memory Supabase double (no DB, no key), so it
// runs in CI where ESPN and Supabase are unreachable. Run from server/:
//   npx tsx test/final-resolve.mjs
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { __setClientForTest } from '../src/supabase.js';
import { stampFinals } from '../src/resolve.js';
import { finalizeMatchups } from '../src/lock.js';
import { injectWeek } from '../src/engine.js';
import { slugMeta } from '../../packages/core/src/data/slugMeta.ts';

const WEEK = 1;

// ── Mutable fake Supabase: rows are live objects, writes mutate them in place ──
// (resolve-batch.mjs's double records writes separately; here the finalize →
// re-select → score → re-select flow needs the row a write touched to be the
// row the next read sees, so status='final' and a written home_final actually
// take.)
function makeFakeDb(tables) {
  const rpc = [];
  const match = (rows, preds) => rows.filter((r) => preds.every((p) => p(r)));
  function builder(source, preds = []) {
    const rowsNow = () => match(source, preds);
    const api = {
      select: () => api,
      eq: (c, v) => builder(source, [...preds, (r) => r[c] === v]),
      in: (c, vs) => { const s = new Set(vs); return builder(source, [...preds, (r) => s.has(r[c])]); },
      is: (c, v) => builder(source, [...preds, (r) => (v === null ? r[c] == null : r[c] === v)]),
      not: (c, op, v) => builder(source, [...preds, (r) => (op === 'is' && v === null ? r[c] != null : true)]),
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

const ROSTER_A = ['jalen-hurts', 'saquon-barkley', 'aj-brown', 'ceedee-lamb', 'dak-prescott', 'derrick-henry', 'lamar-jackson', 'justin-jefferson'];
const ROSTER_B = ['josh-allen', 'james-cook', 'khalil-shakir', 'joe-burrow', 'ja-marr-chase', 'bijan-robinson', 'jahmyr-gibbs', 'caleb-williams'];
const lineup = (slugs) => slugs.map((s) => ({ player_slug: s }));

// A drip league with both seats enrolled and a full lineup — the ordinary case,
// so the finals are real non-zero scores and both sides bank coin.
const TABLES = {
  league: [{ id: 'L1', lineup_policy: 'best_lineup' }],
  league_membership: [
    { league_id: 'L1', sleeper_roster_id: 1, app_user_id: 'u1', enrolled: true, controller: 'human' },
    { league_id: 'L1', sleeper_roster_id: 2, app_user_id: 'u2', enrolled: true, controller: 'human' },
  ],
  sleeper_lineup: [
    { league_id: 'L1', week: WEEK, roster_id: 1, starters_json: lineup(ROSTER_A) },
    { league_id: 'L1', week: WEEK, roster_id: 2, starters_json: lineup(ROSTER_B) },
  ],
  sealed_pick: [],
  applied_state: [],
  matchup: [
    // As the tick sees it the instant the week's last game goes final: still 'live'.
    { id: 'm1', league_id: 'L1', week: WEEK, home_roster_id: 1, away_roster_id: 2, status: 'live', home_final: null, away_final: null },
  ],
};

const fake = makeFakeDb(TABLES);
__setClientForTest(fake.client);
const w = JSON.parse(readFileSync(new URL(`../../public/pbp/w${WEEK}.json`, import.meta.url)));
injectWeek(WEEK, w.pbp, w.points);

const M = () => TABLES.matchup.find((m) => m.id === 'm1');
let fails = 0;
const ok = (label, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`); if (!cond) fails++; };

// ── 1. finalize alone flips status but does NOT score — this WAS the bug ─────
const flipped = await finalizeMatchups(WEEK, true);
ok('finalizeMatchups flips the live matchup to final', flipped === 1 && M().status === 'final');
ok('…but home_final is still NULL after finalize alone (scoring is a separate step)',
  M().home_final == null && M().away_final == null);
ok('…and no coin has been banked yet', fake.rpc.filter((c) => c.name === 'credit_wallet').length === 0);

// ── 2. stampFinals resolves the final row: real scores land, coin banks ──────
const stamped = await stampFinals(WEEK, playerIndex, { playsInjected: true });
ok('stampFinals reports one matchup stamped', stamped === 1);
ok('home_final and away_final are now written', M().home_final != null && M().away_final != null);
ok('the finals are real, non-zero scores from the baked plays', M().home_final > 0 && M().away_final > 0);
const credits = fake.rpc.filter((c) => c.name === 'credit_wallet');
ok('both sides banked their weekly coin (credit_wallet ×2)', credits.length === 2);
ok('coin was banked for BOTH rosters', new Set(credits.map((c) => c.args.p_roster_id)).size === 2);

// ── 3. a second pass is a quiet no-op — nothing left unscored ────────────────
const again = await stampFinals(WEEK, playerIndex, { playsInjected: true });
ok('re-running stampFinals stamps nothing (the week is closed)', again === 0);
ok('no extra coin was banked on the re-run', fake.rpc.filter((c) => c.name === 'credit_wallet').length === 2);

console.log(M().home_final != null
  ? `\n  final: ${M().home_final} — ${M().away_final}`
  : '\n  (unstamped)');
if (fails) { console.log(`\nFAIL — ${fails} assertion(s) failed.`); process.exit(1); }
console.log('\nPASS — a completed week closes end to end: finalize flips, stampFinals scores + banks, re-run is a no-op.');
