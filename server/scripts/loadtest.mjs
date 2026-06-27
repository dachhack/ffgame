// Load-test the per-tick resolve sweep at ~100-league scale (Phase 0, §2b of
// docs/scale-2026-2027-plan.md). Proves the bottleneck migration 0034_scale_index
// was written for: `select * from matchup where week=? and status in ('live',
// 'final')` + resolving every live matchup, each ~25s tick, at ~100 leagues /
// ~600 matchups — WITHOUT live games. It reuses the REAL worker path
// (resolveMatchup / injectWeekPlays) so the timing reflects production, not a
// reimplementation.
//
// Needs Supabase (service-role key in server/.env) — like the worker, it can't
// run from the sandbox (no *.supabase.co egress); run it on a normal network or
// from the deployed worker (`fly ssh console`). Run under tsx (resolves the .ts
// engine imports), from server/:
//
//   npx tsx scripts/loadtest.mjs seed   [--leagues=100] [--teams=12] [--week=1] [--src=1]
//   npx tsx scripts/loadtest.mjs run    [--week=1] [--iters=5] [--chunk=20]
//   npx tsx scripts/loadtest.mjs reset
//
// `seed --dry` builds the real player pool / rosters / feed and tallies what it
// WOULD write, with NO Supabase and NO service key — a smoke test of the seeding
// logic. (Needs Sleeper egress for the player index, which the sandbox has.)
//
// Typical flow:  seed → run → (read the report) → reset.
// Everything it creates is namespaced `LOADTEST-*` and torn down by `reset`; it
// never touches real leagues. Plays are tagged game_id='LOADTEST'.
//
// ⚠ Isolation: resolve reads ALL live_play rows for the week. Use a week with no
// real ESPN plays (offseason, or an isolated --week like 1 before the season).
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { db } from '../src/supabase.js';
import { buildPlayerIndex } from '../src/playerIndex.js';
import { injectWeekPlays, resolveMatchup } from '../src/resolve.js';
import { NFL_SLATE, setRuntimeSlate } from '../../src/data/nflSlate.ts';

const PREFIX = 'LOADTEST-';     // every seeded league id starts with this
const GAME_ID = 'LOADTEST';     // live_play tag → reset deletes only our feed

// ── arg parsing ──────────────────────────────────────────────────────────────
const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
for (const a of rest) { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); if (m) flags[m[1]] = m[2] ?? true; }
const num = (v, d) => (v == null ? d : Number(v));

const log = (...a) => console.log(...a);
const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
const ms = (n) => `${n.toFixed(1)}ms`;

/** Baked week's play map { slug: RealPlay[] } from the committed PBP. */
function loadBaked(week) {
  const data = JSON.parse(readFileSync(new URL(`../../public/pbp/w${week}.json`, import.meta.url), 'utf8'));
  return data.pbp;
}

/** Insert rows in batches so a 100-league seed doesn't exceed payload limits. */
async function insertBatched(table, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await db().from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(`${table} insert: ${error.message}`);
  }
}

// ── seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  const leagues = num(flags.leagues, 100);
  const teams = num(flags.teams, 12);          // 12-team → 6 matchups/league → 600 @ 100
  const week = num(flags.week, 1);
  const src = num(flags.src, week);
  if (teams % 2) throw new Error('--teams must be even (each matchup pairs two)');
  if (!NFL_SLATE[src]) throw new Error(`no baked slate for week ${src} (use --src=1..14)`);

  // Plays + slate so autoLineup slate-gates exactly as the worker does on Sunday.
  setRuntimeSlate(week, NFL_SLATE[src]);
  const pbp = loadBaked(src);
  const idx = await buildPlayerIndex();

  // Pool of real skill slugs that have plays AND resolve to a pos+team — the
  // material autoLineup draws from. Grouped by position to build plausible rosters.
  const byPos = { QB: [], RB: [], WR: [], TE: [] };
  for (const slug of Object.keys(pbp)) {
    const meta = idx.metaForSlug?.(slug);
    if (meta?.pos && byPos[meta.pos]) byPos[meta.pos].push({ slug, pos: meta.pos, full: meta.full });
  }
  const poolSize = Object.values(byPos).reduce((n, a) => n + a.length, 0);
  if (poolSize < teams * 4) throw new Error(`thin player pool (${poolSize}) for week ${src}; pick a different --src`);
  log(`pool: ${byPos.QB.length} QB · ${byPos.RB.length} RB · ${byPos.WR.length} WR · ${byPos.TE.length} TE`);

  // Deterministic roster builder: rotate through each position pool by roster index
  // so rosters differ and spread across teams/windows (better slot fill).
  const take = (arr, start, n) => Array.from({ length: n }, (_, k) => arr[(start + k) % arr.length]).filter(Boolean);
  const rosterFor = (r) => [
    ...take(byPos.QB, r * 2, 2), ...take(byPos.RB, r * 5, 5),
    ...take(byPos.WR, r * 6, 6), ...take(byPos.TE, r * 2, 2),
  ].map((p, slot) => ({ slot, player_slug: p.slug, slug: p.slug, full: p.full, pos: p.pos }));

  const dry = !!flags.dry;
  log(`${dry ? '[DRY] ' : ''}seeding ${leagues} leagues × ${teams} teams (${leagues * teams / 2} matchups) at week ${week}…`);
  if (dry) log(`  sample roster (team 1): ${rosterFor(1).map((p) => `${p.pos}:${p.slug.split('-')[0]}`).join(' ')}`);
  let madeMatchups = 0;
  for (let lg = 0; lg < leagues; lg++) {
    let leagueId = `dry-${lg}`;
    if (!dry) {
      const { data: league, error } = await db().from('league')
        .insert({ sleeper_league_id: `${PREFIX}${lg}`, season: '2026', name: `Load Test ${lg}`, kdst_mode: 'random' })
        .select('id').single();
      if (error) throw new Error(`league insert: ${error.message}`);
      leagueId = league.id;
    }

    const members = [], lineups = [], matchups = [];
    for (let r = 1; r <= teams; r++) {
      members.push({ league_id: leagueId, sleeper_roster_id: r, sleeper_owner_id: `${PREFIX}${lg}-${r}`,
        app_user_id: null, enrolled: false, team_name: `LT ${lg}-${r}`, controller: 'ai' });
      lineups.push({ league_id: leagueId, week, roster_id: r, starters_json: rosterFor(r) });
    }
    for (let p = 0; p < teams / 2; p++) {
      matchups.push({ league_id: leagueId, week, sleeper_matchup_id: p + 1,
        home_roster_id: p * 2 + 1, away_roster_id: p * 2 + 2, status: 'live',
        lock_at: new Date().toISOString() });
    }
    if (!dry) {
      await insertBatched('league_membership', members);
      await insertBatched('sleeper_lineup', lineups);
      await insertBatched('matchup', matchups);
      if ((lg + 1) % 10 === 0) log(`  …${lg + 1}/${leagues} leagues`);
    }
    madeMatchups += matchups.length;
  }

  // The week's plays — inserted ONCE, shared by every matchup (polling is per-game,
  // not per-league: the whole reason this scales). Tagged GAME_ID for clean reset.
  const playRows = [];
  for (const [slug, plays] of Object.entries(pbp)) {
    for (const pl of plays) playRows.push({ week, game_id: GAME_ID, player_slug: slug,
      c: pl.c, t: pl.t ?? null, pid: pl.pid ?? null, k: pl.k, y: pl.y, td: pl.td, ca: pl.ca, tg: pl.tg, to: pl.to ?? null });
  }
  if (dry) {
    log(`✓ [DRY] would seed ${leagues} leagues · ${madeMatchups} live matchups · ${playRows.length} play rows (week ${week}). No DB writes.`);
    return;
  }
  await db().from('live_play').delete().eq('week', week).eq('game_id', GAME_ID);
  await insertBatched('live_play', playRows);

  log(`✓ seeded ${leagues} leagues · ${madeMatchups} live matchups · ${playRows.length} play rows (week ${week}).`);
  log(`  next:  npx tsx scripts/loadtest.mjs run --week=${week}`);
}

// ── run: replicate the worker's per-tick resolve sweep and time it ───────────
async function run() {
  const week = num(flags.week, 1);
  const iters = num(flags.iters, 5);
  const chunk = num(flags.chunk, 20);          // matches index.js (Promise.all chunks of 20)
  const tickBudgetMs = num(flags.budget, 25000); // PLAYS_POLL_MS default
  setRuntimeSlate(week, NFL_SLATE[week] ?? NFL_SLATE[1]);
  const idx = await buildPlayerIndex();

  log(`load test · week ${week} · ${iters} sweeps · chunk ${chunk} · budget ${tickBudgetMs}ms/tick\n`);
  const sweepTimes = [], perMatchup = [];
  for (let it = 0; it < iters; it++) {
    const tQuery = performance.now();
    // THE indexed query migration 0034 targets.
    const { data: live, error } = await db().from('matchup').select('*').eq('week', week).in('status', ['live', 'final']);
    if (error) throw new Error(`matchup scan: ${error.message}`);
    const queryMs = performance.now() - tQuery;
    if (!live?.length) { log('no live matchups — run `seed` first.'); return; }

    const tSweep = performance.now();
    await injectWeekPlays(week);               // fetched ONCE per tick, as in the worker
    const injectMs = performance.now() - tSweep;

    let done = 0;
    for (let i = 0; i < live.length; i += chunk) {
      await Promise.all(live.slice(i, i + chunk).map(async (m) => {
        const t = performance.now();
        try { await resolveMatchup(m, idx, undefined, { playsInjected: true }); done++; }
        catch (e) { log('  resolve error', m.id, e.message); }
        perMatchup.push(performance.now() - t);
      }));
    }
    const sweepMs = performance.now() - tSweep;
    sweepTimes.push(sweepMs);
    log(`  sweep ${it + 1}: ${live.length} matchups · query ${ms(queryMs)} · inject ${ms(injectMs)} · resolve+write ${ms(sweepMs)} (${done} ok)`);
  }

  const sortedSweep = [...sweepTimes].sort((a, b) => a - b);
  const sortedPm = [...perMatchup].sort((a, b) => a - b);
  const worst = sortedSweep[sortedSweep.length - 1];
  log(`\n── report ──`);
  log(`sweep  p50 ${ms(pct(sortedSweep, 50))} · p95 ${ms(pct(sortedSweep, 95))} · max ${ms(worst)}`);
  log(`per-matchup  p50 ${ms(pct(sortedPm, 50))} · p95 ${ms(pct(sortedPm, 95))} · max ${ms(sortedPm[sortedPm.length - 1])}`);
  const headroom = ((tickBudgetMs - worst) / tickBudgetMs) * 100;
  log(`worst sweep is ${(worst / tickBudgetMs * 100).toFixed(1)}% of the ${tickBudgetMs}ms tick budget (${headroom.toFixed(1)}% headroom).`);
  if (worst > tickBudgetMs) log(`✗ FAIL — a sweep exceeds the tick budget. Shard the poll loop or raise PLAYS_POLL_MS / worker resources.`);
  else if (worst > tickBudgetMs * 0.5) log(`⚠ TIGHT — over half the budget. Watch it; consider sharding before scaling past this league count.`);
  else log(`✓ PASS — comfortable headroom at this scale.`);
}

// ── reset: tear down everything LOADTEST-* ───────────────────────────────────
async function reset() {
  const { data: leagues } = await db().from('league').select('id').like('sleeper_league_id', `${PREFIX}%`);
  const ids = (leagues ?? []).map((l) => l.id);
  if (ids.length) {
    const { data: mu } = await db().from('matchup').select('id').in('league_id', ids);
    const mids = (mu ?? []).map((m) => m.id);
    if (mids.length) {
      await db().from('matchup_state').delete().in('matchup_id', mids);
      await db().from('sealed_pick').delete().in('matchup_id', mids);
      await db().from('applied_state').delete().in('matchup_id', mids);
    }
    await db().from('matchup').delete().in('league_id', ids);
    await db().from('sleeper_lineup').delete().in('league_id', ids);
    await db().from('league_membership').delete().in('league_id', ids);
    await db().from('league').delete().in('id', ids);
  }
  await db().from('live_play').delete().eq('game_id', GAME_ID);
  log(`✓ reset — removed ${ids.length} LOADTEST leagues + their matchups/lineups/state + the LOADTEST feed.`);
}

const main = { seed, run, reset }[cmd];
if (!main) { log('usage: loadtest.mjs <seed|run|reset> [--flags]  (see header)'); process.exit(1); }
main().catch((e) => { console.error(e); process.exit(1); });
