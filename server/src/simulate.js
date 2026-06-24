// Feed simulator: replay our baked 2025 play-by-play into the LIVE pipeline on a
// wall-clock timer — exactly as ESPN will drip plays in during a real game — so the
// whole path is proven before we ever point at ESPN:
//
//   baked wN.json ─▶ live_play rows ─▶ resolveMatchup ─▶ matchup_state ─▶ board
//
// The ONLY thing this swaps out vs production is the literal ESPN fetch in
// poll/plays.js; the row shape is identical (the baker and the ESPN adapter both
// emit RealPlay), so everything downstream is exercised for real.
//
// Two modes:
//   • live  — drives a real pilot matchup in Supabase. Open that matchup's live
//             board and watch it animate as the "feed" arrives.
//   • --dry — no DB. Runs the same engine over the same time-ordered feed and
//             asserts the live_play↔RealPlay round-trip reproduces the baked
//             per-player points exactly (the property that must hold for the swap).
//
// Run from server/ (tsx resolves the .ts engine imports):
//   npm run cli -- simulate <leagueId> <week> [--src=<wk>] [--speed=600] [--tick=1000]
//   npm run cli -- simulate --dry [--week=1] [--speed=900]
import { readFileSync } from 'node:fs';
import { injectWeek, rowsToPbp, resolveWindow, makePlayer } from './engine.js';

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const round = (n) => Math.round(n * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Baked week's play map: { slug: RealPlay[] } plus the source points for the check. */
function loadBaked(srcWeek) {
  const data = JSON.parse(readFileSync(new URL(`../../public/pbp/w${srcWeek}.json`, import.meta.url), 'utf8'));
  return { pbp: data.pbp, points: data.points ?? {} };
}

/** PPR + K + DST from RealPlay rows — mirrors resolve.js:baseScore and the baker,
 *  so the dry round-trip check can compare against baked points. */
function baseScore(plays) {
  let recYds = 0, rushYds = 0, passYds = 0, rec = 0, rushTd = 0, recTd = 0, passTd = 0, sp = 0;
  for (const p of plays) {
    if (p.k === 'pass') { passYds += p.y; if (p.td) passTd++; }
    else if (p.k === 'rush') { rushYds += p.y; if (p.td) rushTd++; }
    else if (p.k === 'rec') { rec++; recYds += p.y; if (p.td) recTd++; }
    else if (p.k === 'fg') sp += p.y < 40 ? 3 : p.y < 50 ? 4 : 5;
    else if (p.k === 'xp') sp += 1; else if (p.k === 'sack') sp += 1;
    else if (p.k === 'int') sp += 3; else if (p.k === 'fumrec') sp += 2;
    else if (p.k === 'dst_td') sp += 6; else if (p.k === 'safety') sp += 2;
  }
  return Math.round((rec + recYds * 0.1 + rushYds * 0.1 + (rushTd + recTd) * 6 + passYds * 0.04 + passTd * 4 + sp) * 10) / 10;
}

/** Flatten baked pbp into one time-ordered feed of live_play-shaped rows. `at` is
 *  the release time (real wall-clock seconds since kickoff, ESPN's `t`). */
function buildFeed(pbp, week) {
  const feed = [];
  for (const [slug, plays] of Object.entries(pbp)) {
    for (const p of plays) {
      feed.push({
        at: p.t ?? p.c ?? 0,
        row: { week, game_id: 'SIM', player_slug: slug, c: p.c, t: p.t ?? null, pid: p.pid ?? null, k: p.k, y: p.y, td: p.td, ca: p.ca, tg: p.tg, to: p.to ?? null },
      });
    }
  }
  feed.sort((a, b) => a.at - b.at);
  return feed;
}

// Sample head-to-head pairs for the dry drip (real Week-N slugs + metric ids). We
// keep only pairs whose players actually have plays in the chosen week.
const DRY_PAIRS = [
  { youSlug: 'saquon-barkley', youPos: 'RB', youTeam: 'PHI', youMetric: 'td', themSlug: 'james-cook', themPos: 'RB', themTeam: 'BUF', themMetric: 'td' },
  { youSlug: 'josh-allen', youPos: 'QB', youTeam: 'BUF', youMetric: 'pass', themSlug: 'jalen-hurts', themPos: 'QB', themTeam: 'PHI', themMetric: 'pass' },
  { youSlug: 'ja-marr-chase', youPos: 'WR', youTeam: 'CIN', youMetric: 'rec', themSlug: 'justin-jefferson', themPos: 'WR', themTeam: 'MIN', themMetric: 'rec' },
];

// ── DRY: no DB. Time-released feed → real engine, then assert round-trip. ─────────
async function simulateDry({ week, speed, tickMs }) {
  const { pbp, points } = loadBaked(week);
  const feed = buildFeed(pbp, week);
  const maxAt = feed.length ? feed[feed.length - 1].at : 0;
  const pairs = DRY_PAIRS.filter((p) => pbp[p.youSlug]?.length && pbp[p.themSlug]?.length);
  log(`DRY · week ${week} · ${Object.keys(pbp).length} players · ${feed.length} plays over ${fmtClock(maxAt)} · speed ${speed}×`);
  log(`tracking ${pairs.length} head-to-head pairs through the real engine as the feed drips in:\n`);

  let i = 0;
  const released = [];
  for (let clk = 0; ; clk += speed) {
    while (i < feed.length && feed[i].at <= clk) released.push(feed[i++].row);
    injectWeek(week, rowsToPbp(released)); // exactly what the worker does each tick
    const line = pairs.map((p) => {
      const you = { player: makePlayer(p.youSlug, p.youPos, p.youTeam), metricId: p.youMetric };
      const them = { player: makePlayer(p.themSlug, p.themPos, p.themTeam), metricId: p.themMetric };
      const r = resolveWindow(you, them, week, '', {});
      return `${p.youSlug.split('-')[0]} ${String(r.youFinal).padStart(4)} – ${String(r.theirFinal).padEnd(4)} ${p.themSlug.split('-')[0]}`;
    }).join('   |   ');
    log(`  ${fmtClock(Math.min(clk, maxAt)).padStart(5)}  ${line}`);
    if (i >= feed.length) break;
    await sleep(tickMs);
  }

  // Round-trip proof: live_play-shaped rows → rowsToPbp → points must equal baked.
  const bySlug = rowsToPbp(released);
  let ok = 0, off = 0; const misses = [];
  for (const [slug, want] of Object.entries(points)) {
    const got = baseScore(bySlug[slug] ?? []);
    if (Math.abs(got - want) <= 0.05) ok++;
    else { off++; if (misses.length < 8) misses.push(`${slug} got ${got} want ${want}`); }
  }
  log(`\nround-trip check (live_play shape → engine points vs baked): ${ok}/${ok + off} exact`);
  if (off) { log('MISMATCHES:', misses.join(' · ')); log(`\nFAIL — ${off} players differ; the feed round-trip is NOT lossless.`); process.exitCode = 1; }
  else log(`PASS — every player's points reproduce exactly from the feed shape. The pipeline is ready for an ESPN source of the same shape.`);
}

// ── LIVE: drive a real pilot matchup in Supabase. ────────────────────────────────
async function simulateLive(leagueId, week, { srcWeek, speed, tickMs }) {
  const { db } = await import('./supabase.js');
  const { resolveMatchup } = await import('./resolve.js');
  const { buildPlayerIndex } = await import('./playerIndex.js');
  const { pbp } = loadBaked(srcWeek);

  const { data: matchups } = await db().from('matchup').select('*').eq('league_id', leagueId).eq('week', week);
  if (!matchups?.length) throw new Error(`No matchups for league ${leagueId} week ${week}. Run: cli sync-week ${leagueId} ${week}`);
  const ids = matchups.map((m) => m.id);

  log(`LIVE · league ${leagueId} · week ${week} (plays from baked w${srcWeek}) · ${matchups.length} matchups`);
  log('locking picks + going live, clearing prior feed…');
  const now = new Date().toISOString();
  await db().from('sealed_pick').update({ locked: true, revealed_at: now }).in('matchup_id', ids).eq('locked', false);
  await db().from('matchup').update({ status: 'live' }).in('id', ids);
  await db().from('live_play').delete().eq('week', week);
  const live = matchups.map((m) => ({ ...m, status: 'live' }));

  const playerIndex = await buildPlayerIndex();
  const feed = buildFeed(pbp, week);
  const maxAt = feed.length ? feed[feed.length - 1].at : 0;
  log(`feed: ${feed.length} plays over ${fmtClock(maxAt)} game-time · speed ${speed}× · open the live board now\n`);

  let i = 0;
  for (let clk = 0; ; clk += speed) {
    const batch = [];
    while (i < feed.length && feed[i].at <= clk) batch.push(feed[i++].row);
    if (batch.length) await db().from('live_play').insert(batch);
    for (const m of live) { try { await resolveMatchup(m, playerIndex); } catch (e) { log('resolve', m.id, e.message); } }
    const { data: st } = await db().from('matchup_state').select('matchup_id,home_score,away_score').in('matchup_id', ids);
    const totals = new Map();
    for (const s of st ?? []) { const t = totals.get(s.matchup_id) ?? { h: 0, a: 0 }; t.h += s.home_score; t.a += s.away_score; totals.set(s.matchup_id, t); }
    const line = live.map((m) => { const t = totals.get(m.id) ?? { h: 0, a: 0 }; return `${round(t.h)}–${round(t.a)}`; }).join('  ');
    log(`  ${fmtClock(Math.min(clk, maxAt)).padStart(5)}  +${batch.length} plays  ·  ${line}`);
    if (i >= feed.length) break;
    await sleep(tickMs);
  }

  log('\nfeed complete — finalizing matchups…');
  await db().from('matchup').update({ status: 'final' }).in('id', ids);
  for (const m of live) await resolveMatchup({ ...m, status: 'final' }, playerIndex);
  log('done. Matchups are FINAL with the full baked game resolved through the live path.');
}

/** Parse `simulate` args and dispatch. Called from cli.js. */
export async function simulate(args) {
  const flags = {};
  const pos = [];
  for (const a of args) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
    if (m) flags[m[1]] = m[2] ?? true; else pos.push(a);
  }
  const speed = Number(flags.speed ?? 600);    // game-seconds advanced per tick
  const tickMs = Number(flags.tick ?? 1000);   // real ms per tick
  if (flags.dry) {
    await simulateDry({ week: Number(flags.week ?? pos[1] ?? 1), speed, tickMs });
    return;
  }
  const [leagueId, week] = pos;
  if (!leagueId || !week) throw new Error('usage: simulate <leagueId> <week> [--src=<wk>] [--speed=600] [--tick=1000]  |  simulate --dry [--week=1]');
  await simulateLive(leagueId, Number(week), { srcWeek: Number(flags.src ?? week), speed, tickMs });
}
