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
import { WINDOWS } from '../../src/data/metrics.ts';
import { DEFAULT_AI_METRIC } from '../../src/data/aiLineup.ts';

// The lineup spots in window order (tnf, early×3, late×2, snf, mnf).
const SLOTS = WINDOWS.flatMap((w) => Array.from({ length: w.slots }, (_, j) => ({ win: w.id, slot: String(j) })));

/** Auto-build a roster's lineup from its synced Sleeper starters: fill the
 *  window/slot grid, honest default metric per position (shared DEFAULT_AI_METRIC).
 *  No Field-General flip here — the dry round-trip asserts per-player points
 *  reproduce the baked box score, and FG zeroes its QB. Shape matches enrolledPicks. */
function autoLineup(starters) {
  return (starters ?? [])
    .filter((s) => s.player_slug)
    .slice(0, SLOTS.length)
    .map((s, i) => ({ win: SLOTS[i].win, slot: SLOTS[i].slot, slug: s.player_slug, metric: DEFAULT_AI_METRIC[s.pos] || 'rush' }));
}

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
 *  the release time (real wall-clock seconds since kickoff, ESPN's `t`).
 *   • jitter: up to N s of random per-play delay → plays arrive late + out of
 *     order, like the real ESPN stat feed.
 *   • corrections (0–1): that fraction of scoring plays arrive PROVISIONAL (a
 *     wrong stat) first, then the TRUE baked value `correctionDelay` s later —
 *     same key, so the upsert overwrites and the score self-corrects live. */
function buildFeed(pbp, week, jitter = 0, corrections = 0, correctionDelay = 60) {
  const feed = [];
  for (const [slug, plays] of Object.entries(pbp)) {
    for (const p of plays) {
      const baseAt = (p.t ?? p.c ?? 0) + (jitter > 0 ? Math.random() * jitter : 0);
      const row = { week, game_id: 'SIM', player_slug: slug, c: p.c, t: p.t ?? null, pid: p.pid ?? null, k: p.k, y: p.y, td: p.td, ca: p.ca, tg: p.tg, to: p.to ?? null };
      if (corrections > 0 && (p.y > 0 || p.td > 0) && Math.random() < corrections) {
        // A plausible early (wrong) stat: yards off by a few, or a TD not yet ruled.
        const provY = p.y > 0 ? Math.max(0, p.y + (Math.random() < 0.5 ? -1 : 1) * (3 + Math.floor(Math.random() * 12))) : p.y;
        const provTd = p.td > 0 && Math.random() < 0.4 ? 0 : p.td;
        if (provY !== p.y || provTd !== p.td) {
          feed.push({ at: baseAt, row: { ...row, y: provY, td: provTd }, corr: 'prov' });
          feed.push({ at: baseAt + correctionDelay * (1 + Math.random()), row, corr: 'fix' });
          continue;
        }
      }
      feed.push({ at: baseAt, row });
    }
  }
  feed.sort((a, b) => a.at - b.at);
  return feed;
}

// The live_play conflict key — the unit a re-poll reconciles on (week,game,pid,slug,kind).
const keyOf = (r) => `${r.week}|${r.game_id}|${r.pid}|${r.player_slug}|${r.k}`;

/** In-memory model of live_play under the worker's per-poll reconcile: each poll
 *  carries a game's FULL current play set, so we upsert every row (corrections
 *  overwrite by key) and drop rows no longer present (a play reclassified to a
 *  different kind, or removed). Mirrors poll/plays.js exactly. */
function makeStore() {
  const m = new Map();
  return {
    poll(rows) {
      const present = new Set(rows.map(keyOf));
      for (const r of rows) m.set(keyOf(r), r);
      for (const k of [...m.keys()]) if (!present.has(k)) m.delete(k);
    },
    size: () => m.size,
    pointsFor: (slug) => baseScore([...m.values()].filter((r) => r.player_slug === slug)),
  };
}

// Sample head-to-head pairs for the dry drip (real Week-N slugs + metric ids). We
// keep only pairs whose players actually have plays in the chosen week.
const DRY_PAIRS = [
  { youSlug: 'saquon-barkley', youPos: 'RB', youTeam: 'PHI', youMetric: 'td', themSlug: 'james-cook', themPos: 'RB', themTeam: 'BUF', themMetric: 'td' },
  { youSlug: 'josh-allen', youPos: 'QB', youTeam: 'BUF', youMetric: 'pass', themSlug: 'jalen-hurts', themPos: 'QB', themTeam: 'PHI', themMetric: 'pass' },
  { youSlug: 'ja-marr-chase', youPos: 'WR', youTeam: 'CIN', youMetric: 'rec', themSlug: 'justin-jefferson', themPos: 'WR', themTeam: 'MIN', themMetric: 'rec' },
];

// ── DRY: no DB. Time-released feed → real engine, then assert round-trip. ─────────
async function simulateDry({ week, speed, tickMs, jitter }) {
  const { pbp, points } = loadBaked(week);
  const feed = buildFeed(pbp, week, jitter);
  const maxAt = feed.length ? feed[feed.length - 1].at : 0;
  if (jitter) log(`(latency: up to ${jitter}s of random per-play delay — plays arrive late + out of order)`);
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
  log(`\nround-trip check${jitter ? ' (with latency)' : ''} (live_play shape → engine points vs baked): ${ok}/${ok + off} exact`);
  if (off) { log('MISMATCHES:', misses.join(' · ')); log(`\nFAIL — ${off} players differ; the feed round-trip is NOT lossless.`); process.exitCode = 1; }
  else log(`round-trip PASS — every player's points reproduce exactly from the feed shape${jitter ? ', even with late/out-of-order delivery' : ''}.`);

  // ── Reconciliation: what happens when ESPN re-sends a play corrected or with
  // more data? Each poll carries the game's full current set, so we model that:
  // upsert-by-key + drop-missing. Prove corrections, kind-flips and dupes reconcile.
  const allRows = feed.map((f) => f.row);
  const clone = (mut) => allRows.map((r) => ({ ...r })).map((r) => (mut(r), r));
  // pick a player with a real reception to mutate
  let P = null, recPid = null, recY = 0, recTd = 0;
  for (const [slug, plays] of Object.entries(pbp)) { const rp = plays.find((p) => p.k === 'rec' && p.y > 0); if (rp) { P = slug; recPid = rp.pid; recY = rp.y; recTd = rp.td || 0; break; } }
  const checks = [];
  if (P) {
    const base = baseScore(pbp[P]);
    // 1) VALUE correction: ESPN revises that catch +50 yds on a later poll → +5.0 pts.
    const sV = makeStore(); sV.poll(allRows); sV.poll(clone((r) => { if (r.player_slug === P && r.pid === recPid && r.k === 'rec') r.y += 50; }));
    checks.push(['value-correction', sV.pointsFor(P), Math.round((base + 5) * 10) / 10, sV.size()]);
    // 2) KIND-FLIP: the catch is overturned to incomplete → reception removed, no double-count.
    const sK = makeStore(); sK.poll(allRows); sK.poll(clone((r) => { if (r.player_slug === P && r.pid === recPid && r.k === 'rec') { r.k = 'incomplete'; r.y = 0; r.td = 0; } }));
    checks.push(['kind-flip', sK.pointsFor(P), Math.round((base - (1 + recY * 0.1 + recTd * 6)) * 10) / 10, sK.size()]);
    // 3) DUPLICATE poll: re-sending identical data is a no-op (idempotent).
    const sD = makeStore(); sD.poll(allRows); const before = sD.size(); sD.poll(allRows);
    checks.push(['duplicate-idempotent', sD.size(), before, sD.size()]);
  }
  const baseSize = (() => { const s = makeStore(); s.poll(allRows); return s.size(); })();
  let rOk = true; const rLines = [];
  for (const [name, got, want, size] of checks) {
    const pass = Math.abs(got - want) <= 0.05 && size === baseSize;
    if (!pass) rOk = false;
    rLines.push(`${name} ${pass ? '✓' : `✗ (got ${got} want ${want}, size ${size}/${baseSize})`}`);
  }
  log(`reconcile check: ${rLines.join(' · ')}`);
  if (!P) log('reconcile SKIP — no reception found to mutate this week.');
  else if (!rOk) { log(`\nFAIL — corrections do not reconcile correctly.`); process.exitCode = 1; }
  else log(`reconcile PASS — corrected re-sends overwrite by key, reclassified plays drop the stale row, dupes are no-ops.`);

  if ((off || (P && !rOk))) log(`\nFAIL`); else log(`\nPASS — feed round-trip + reconciliation both hold. Ready for a real ESPN source.`);
}

// ── LIVE: drive a real pilot matchup in Supabase. ────────────────────────────────
async function simulateLive(leagueId, week, { srcWeek, speed, tickMs, jitter, corrections }) {
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
  await db().from('live_play').delete().eq('week', week).eq('game_id', 'SIM'); // only our own feed, never real ESPN plays
  const live = matchups.map((m) => ({ ...m, status: 'live' }));

  const playerIndex = await buildPlayerIndex();

  // Self-contained lineups: honor a roster's real LOCKED picks if it set any,
  // otherwise auto-build from its synced Sleeper starters — so both sides resolve
  // with full metric effects and nobody has to set a lineup to watch a real duel.
  const rosterIds = [...new Set(live.flatMap((m) => [m.home_roster_id, m.away_roster_id]))];
  const { data: members } = await db().from('league_membership')
    .select('sleeper_roster_id,app_user_id,enrolled,controller').eq('league_id', leagueId).in('sleeper_roster_id', rosterIds);
  const memByRoster = new Map((members ?? []).map((m) => [m.sleeper_roster_id, m]));
  const { data: lineupRows } = await db().from('sleeper_lineup').select('roster_id,starters_json').eq('league_id', leagueId).eq('week', week);
  const startersByRoster = new Map((lineupRows ?? []).map((r) => [r.roster_id, r.starters_json]));

  const sealedPicks = async (matchupId, appUserId) => {
    const { data } = await db().from('sealed_pick').select('game_window,roster_slot,player_slug,metric_id')
      .eq('matchup_id', matchupId).eq('app_user_id', appUserId).eq('locked', true);
    return data && data.length ? data.map((p) => ({ win: p.game_window, slot: p.roster_slot, slug: p.player_slug, metric: p.metric_id })) : null;
  };
  const sideFor = async (matchupId, rosterId) => {
    const mem = memByRoster.get(rosterId);
    // AI-controlled teams skip any human picks and auto-lineup.
    if (mem?.controller !== 'ai' && mem?.enrolled && mem.app_user_id) { const sp = await sealedPicks(matchupId, mem.app_user_id); if (sp) return sp; }
    return autoLineup(startersByRoster.get(rosterId));
  };
  const lineups = new Map();
  let autoCount = 0;
  for (const m of live) {
    const home = await sideFor(m.id, m.home_roster_id);
    const away = await sideFor(m.id, m.away_roster_id);
    lineups.set(m.id, { home, away });
    if (!home.length || !away.length) log(`  ⚠ ${m.home_roster_id}v${m.away_roster_id}: ${[!home.length && 'home', !away.length && 'away'].filter(Boolean).join('+')} has no synced lineup → scores 0 (run sync-week)`);
    autoCount += [home, away].filter((s) => s.length).length;
  }
  log(`lineups ready for ${live.length} matchups (${autoCount} sides, default metric per position) — full metric duel, no enrollment needed`);

  const feed = buildFeed(pbp, week, jitter, corrections, Math.max(60, speed * 3));
  const nCorr = feed.filter((f) => f.corr === 'fix').length;
  const maxAt = feed.length ? feed[feed.length - 1].at : 0;
  log(`feed: ${feed.length} deliveries over ${fmtClock(maxAt)} game-time · speed ${speed}×${jitter ? ` · latency ≤${jitter}s` : ''}${nCorr ? ` · ${nCorr} plays self-correct (watch the board)` : ''} · open the live board now\n`);

  let i = 0;
  for (let clk = 0; ; clk += speed) {
    const batch = [];
    while (i < feed.length && feed[i].at <= clk) batch.push(feed[i++]);
    // Dedupe within the batch by key (keep the latest delivery), then upsert — so a
    // provisional + its later fix never collide in one write, and corrections
    // reconcile by key exactly like poll/plays.js.
    const byKey = new Map();
    for (const b of batch) byKey.set(keyOf(b.row), b);
    const rows = [...byKey.values()].map((b) => b.row);
    if (rows.length) await db().from('live_play').upsert(rows, { onConflict: 'week,game_id,pid,player_slug,k' });
    for (const m of live) { try { await resolveMatchup(m, playerIndex, lineups.get(m.id)); } catch (e) { log('resolve', m.id, e.message); } }
    const { data: st } = await db().from('matchup_state').select('matchup_id,home_score,away_score').in('matchup_id', ids);
    const totals = new Map();
    for (const s of st ?? []) { const t = totals.get(s.matchup_id) ?? { h: 0, a: 0 }; t.h += s.home_score; t.a += s.away_score; totals.set(s.matchup_id, t); }
    const line = live.map((m) => { const t = totals.get(m.id) ?? { h: 0, a: 0 }; return `${round(t.h)}–${round(t.a)}`; }).join('  ');
    const fixes = [...new Set(batch.filter((b) => b.corr === 'fix').map((b) => b.row.player_slug.split('-')[0]))];
    log(`  ${fmtClock(Math.min(clk, maxAt)).padStart(5)}  +${rows.length} plays${fixes.length ? ` · ↻ ${fixes.slice(0, 3).join(',')}${fixes.length > 3 ? '…' : ''} corrected` : ''}  ·  ${line}`);
    if (i >= feed.length) break;
    await sleep(tickMs);
  }

  log('\nfeed complete — finalizing matchups…');
  await db().from('matchup').update({ status: 'final' }).in('id', ids);
  for (const m of live) await resolveMatchup({ ...m, status: 'final' }, playerIndex, lineups.get(m.id));
  log('done. Matchups are FINAL with the full baked game resolved through the live path.');
}

// ── CHECK: read-only. Confirm the secret + DB are reachable; write nothing. ──────
async function simulateCheck(leagueId) {
  const { db } = await import('./supabase.js');
  let q = db().from('matchup').select('id,week,status', { count: 'exact' });
  if (leagueId) q = q.eq('league_id', leagueId);
  const { data, count, error } = await q;
  if (error) throw error;
  const byStatus = {};
  for (const m of data ?? []) byStatus[m.status] = (byStatus[m.status] ?? 0) + 1;
  log(`DB OK · ${count ?? data?.length ?? 0} matchups${leagueId ? ` for league ${leagueId}` : ''} · by status ${JSON.stringify(byStatus)}`);
  loadBaked(1); // confirm baked data + engine imports resolve in this runtime
  log('PASS — service-role secret + DB reachable, baked data loads. No writes made.');
}

// ── RESET: fully revert a sim'd week → scheduled, picks unlocked, scores wiped. ──
async function simulateReset(leagueId, week) {
  if (!leagueId || !week) throw new Error('usage: simulate --reset <leagueId> <week>');
  const { db } = await import('./supabase.js');
  const { data: matchups } = await db().from('matchup').select('id').eq('league_id', leagueId).eq('week', week);
  const ids = (matchups ?? []).map((m) => m.id);
  if (!ids.length) { log(`no matchups for league ${leagueId} week ${week} — nothing to reset`); return; }
  await db().from('matchup_state').delete().in('matchup_id', ids);
  await db().from('sealed_pick').update({ locked: false, revealed_at: null }).in('matchup_id', ids);
  await db().from('live_play').delete().eq('week', week).eq('game_id', 'SIM'); // only our own feed
  await db().from('matchup').update({ status: 'scheduled', home_final: null, away_final: null, home_coin: null, away_coin: null }).in('id', ids);
  log(`reset ${ids.length} matchups (week ${week}) → scheduled · picks unlocked · SIM feed + matchup_state cleared`);
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
  const jitter = Number(flags.jitter ?? 0);    // seconds of random per-play delivery delay (latency)
  const corrections = Number(flags.corrections ?? 0) / 100; // % of scoring plays that arrive provisional then self-correct
  if (flags.dry) {
    await simulateDry({ week: Number(flags.week ?? pos[1] ?? 1), speed, tickMs, jitter });
    return;
  }
  if (flags.check) {
    await simulateCheck(pos[0]);
    return;
  }
  if (flags.reset) {
    await simulateReset(pos[0], Number(pos[1]));
    return;
  }
  const [leagueId, week] = pos;
  if (!leagueId || !week) throw new Error('usage: simulate <leagueId> <week> [--src=<wk>] [--speed=600] [--tick=1000]  |  simulate --dry [--week=1]');
  await simulateLive(leagueId, Number(week), { srcWeek: Number(flags.src ?? week), speed, tickMs, jitter, corrections });
}
