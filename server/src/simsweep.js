// ▶ SIM FROM THE BOARD (0251): the dress rehearsal, driven by the worker.
//
// simulate.js proves the whole live path from a CLI; this sweep runs the SAME
// rehearsal — same baked feed, same lineups, same resolver — but steered from
// the matchup board: an admin's ▶ writes a sim_run row (admin_sim_start), and
// every worker tick this sweep advances each running row's feed clock,
// releases the due plays into live_play + game_feed, and resolves the
// league's matchups. When the feed is exhausted it finalizes through the same
// resolveMatchup-at-final path (finals + banked coin) and marks the run done.
//
// Everything with judgement in it is IMPORTED from simulate.js (buildFeed,
// simLineups, keyOf) — a second implementation of the feed would eventually
// disagree with the CLI about what a rehearsal is. What is new here is only
// the shape of the clock: the CLI owns a private loop and sleeps; the sweep
// owns no loop, so the clock is derived (wall-elapsed × speed) and a cursor
// on the row remembers what was already released — a restarted worker resumes
// mid-game instead of re-playing the past.
import { db } from './supabase.js';
import { resolveMatchup } from './resolve.js';
import { loadBaked, loadBakedFeeds, buildFeed, simLineups, keyOf } from './simulate.js';
import { setLiveGameFeed, feedRowsToWeek } from '../../packages/core/src/data/gameFeed.ts';

/** The feed position implied by the wall clock: seconds since start × speed. */
export function simClock(startedAtMs, nowMs, speed) {
  return Math.max(0, ((nowMs - startedAtMs) / 1000) * speed);
}

/** The deliveries due in (fromAt, toAt], deduped by the live_play conflict key
 *  keeping the LATEST delivery — so a provisional stat and its later fix
 *  released in the same sweep collide into one honest write, exactly like the
 *  CLI's per-batch dedupe. Pure, so the test can pin the windowing. */
export function dueRows(feed, fromAt, toAt) {
  const byKey = new Map();
  for (const f of feed) {
    if (f.at <= fromAt || f.at > toAt) continue;
    byKey.set(keyOf(f.row), f.row);
  }
  return [...byKey.values()];
}

// Per-run working set, rebuilt lazily and keyed by (league, started_at) so a
// reset-and-restart never inherits a stale feed or lineup map. Bounded by the
// number of running sims (in practice: one).
const cache = new Map();
async function runCtx(run) {
  const key = `${run.league_id}:${run.started_at}`;
  if (cache.has(key)) return cache.get(key);
  const { pbp } = loadBaked(run.src_week);
  // Deterministic feed (no jitter/corrections from the board — the CLI keeps
  // those knobs): the cursor windowing must see the same `at`s every rebuild,
  // or a worker restart would drop or double plays.
  const feed = buildFeed(pbp, run.week, 0, 0);
  const maxAt = feed.length ? feed[feed.length - 1].at : 0;
  const bakedFeeds = loadBakedFeeds(run.src_week);
  const { data: matchups } = await db().from('matchup').select('*').eq('league_id', run.league_id).eq('week', run.week);
  const live = (matchups ?? []).map((m) => ({ ...m, status: 'live' }));
  const { lineups } = await simLineups(db, run.league_id, run.week, live);
  const ctx = { feed, maxAt, bakedFeeds, live, lineups };
  cache.set(key, ctx);
  // Drop stale entries (finished or reset runs) so the map can't grow.
  for (const k of cache.keys()) if (k !== key && k.startsWith(`${run.league_id}:`)) cache.delete(k);
  return ctx;
}

/** One sweep pass: advance every running board-driven sim. Called from the
 *  worker tick; a quiet pass (no runs) costs one SELECT. */
export async function sweepSim(log, playerIndex) {
  const { data: runsRows, error } = await db().from('sim_run').select('*').eq('status', 'running');
  if (error) { log('sim sweep', error.message); return { runs: 0, released: 0, finished: 0 }; }
  const running = runsRows ?? [];
  if (!running.length) { cache.clear(); return { runs: 0, released: 0, finished: 0 }; }

  let released = 0, finished = 0;
  for (const run of running) {
    try {
      const ctx = await runCtx(run);
      const clk = simClock(Date.parse(run.started_at), Date.now(), Number(run.speed));
      const cursor = Number(run.cursor_at ?? 0);

      // Release the due plays. Idempotent upsert on the reconcile key, so a
      // crashed sweep that wrote but never moved the cursor just rewrites.
      const rows = dueRows(ctx.feed, cursor, clk);
      if (rows.length) {
        const { error: pe } = await db().from('live_play').upsert(rows, { onConflict: 'week,game_id,pid,player_slug,k' });
        if (pe) { log('sim plays', run.league_id, pe.message); continue; } // cursor stays — retry next tick
        released += rows.length;
      }

      // Field-visual feeds at the same position — whole-doc replacement, the
      // shape the real poller writes — and installed in-process so the drips
      // this sweep resolves are possession-gated exactly like the worker's.
      if (ctx.bakedFeeds) {
        const feedRows = Object.entries(ctx.bakedFeeds.games).map(([key, plays]) => {
          const [away, home] = key.split('@');
          return { week: run.week, game_id: `SIM:${key}`, key, away, home, plays: plays.filter((p) => p.c <= clk), updated_at: new Date().toISOString() };
        }).filter((r) => r.plays.length);
        if (feedRows.length) await db().from('game_feed').upsert(feedRows, { onConflict: 'week,game_id' });
        setLiveGameFeed(run.week, feedRowsToWeek(feedRows));
      }

      for (const m of ctx.live) {
        try { await resolveMatchup(m, playerIndex, ctx.lineups.get(m.id)); }
        catch (e) { log('sim resolve', m.id, e.message); }
      }

      if (clk >= ctx.maxAt) {
        // Feed exhausted → the same ending the CLI performs: status final in
        // the DB, then a final resolve, which stamps finals and banks coin.
        const ids = ctx.live.map((m) => m.id);
        await db().from('matchup').update({ status: 'final' }).in('id', ids);
        for (const m of ctx.live) {
          try { await resolveMatchup({ ...m, status: 'final' }, playerIndex, ctx.lineups.get(m.id)); }
          catch (e) { log('sim finalize', m.id, e.message); }
        }
        await db().from('sim_run').update({ status: 'done', cursor_at: ctx.maxAt }).eq('league_id', run.league_id);
        finished += 1;
        log(`sim done · league ${run.league_id} week ${run.week} — feed exhausted, matchups FINAL`);
      } else {
        await db().from('sim_run').update({ cursor_at: clk }).eq('league_id', run.league_id);
      }
    } catch (e) { log('sim run', run.league_id, e.message); }
  }
  return { runs: running.length, released, finished };
}
