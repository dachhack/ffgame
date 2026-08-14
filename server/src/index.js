// Worker entrypoint: the scheduler that drives sync → lock → poll → resolve.
//
// Sized for a few testers over a season. Three cadences:
//   • injuries   — daily, hourly on game days (pre-lock decision support)
//   • scoreboard — game-state + lock detection (each tick)
//   • plays      — live PBP during game windows → resolve live matchups
//
// Run: `node src/index.js` (needs server/.env with the Supabase service key).
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { getState } from './sleeper.js';
import { buildPlayerIndex } from './playerIndex.js';
import { getGames, gamesToPollFrom, slateFromGames, espnCurrentWeek } from './poll/scoreboard.js';
import { pollGame } from './poll/plays.js';
import { pollInjuries } from './poll/injuries.js';
import { sweepMembers } from './poll/members.js';
import { syncTeamOverrides } from './poll/teamOverrides.js';
import { lockDueMatchups, lockDueWindows, finalizeMatchups, backfillLockAt, materializeAutoLineups } from './lock.js';
import { resolveMatchup, injectWeekPlays, prefetchTick } from './resolve.js';
import { syncAllLeagues } from './sync.js';
import { sweepNative } from './native.js';
import { sweepPots } from './pot.js';
import { db } from './supabase.js';
import { ensurePods } from './pods.js';
import { PRESEASON, REGULAR_SEASON } from './seasonType.js';
import { setRuntimeSlate, PRESEASON_BASE, PRESEASON_WEEKS } from '../../packages/core/src/data/nflSlate.ts';

let playerIndex = null;
let lastInjuryPoll = 0;
let lastSyncedWeek = null;
let lastSyncAt = 0;
let syncing = false;

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ── Week contexts ────────────────────────────────────────────────────────────
// The scheduler used to hold exactly ONE current week, with preseason bolted on
// as a process-wide MODE of it (PILOT_SEASON_TYPE=1 → every DB read/write shifted
// by 100). That made the two seasons mutually exclusive: turning preseason on
// silently stopped the Sleeper sync and the pod tick, and leaving the flag set
// past the opener would have stopped Week 1 from ever locking or resolving —
// while the logs looked perfectly healthy.
//
// A CONTEXT is now { seasonType, offset, espnWeek }: which ESPN scoreboard to
// ask for, and what to add to its week number to get the BOARD week. Preseason
// keeps its +100 namespace so it can never collide with the loaded regular
// season. Each tick runs every context that currently has games, so no flag —
// and no deadline to remember — is involved.
const OFFSET_OF = { [PRESEASON]: PRESEASON_BASE, [REGULAR_SEASON]: 0, 3: 0 };

// ESPN's current week per season type, cached 30 min. Sleeper's /state/nfl week
// sits at 0 all August, so it can't drive preseason rollover; keyed by type
// because the two seasons advance independently.
const espnWeekCache = new Map();
async function espnWeekFor(season, seasonType) {
  const hit = espnWeekCache.get(seasonType);
  if (hit && Date.now() - hit.at < 30 * 60e3) return hit.week;
  const week = await espnCurrentWeek(season, seasonType).catch(() => null);
  // A failed lookup keeps the previous value rather than dropping the context.
  const next = week ?? hit?.week ?? null;
  espnWeekCache.set(seasonType, { week: next, at: Date.now() });
  return next;
}

/** The regular-season week everything non-preseason keys off: Sleeper's own
 *  notion when it has one (it's authoritative in season), else ESPN's, else 1. */
async function regularWeek(season) {
  try { const s = await getState(); const w = Number(s.week); if (w >= 1) return w; } catch { /* fall through */ }
  return (await espnWeekFor(season, REGULAR_SEASON)) ?? 1;
}

/** PURE: which contexts to run, given the two week numbers already looked up.
 *  Split out from the I/O so the policy is testable without a network — the
 *  scheduler's whole "which season am I in" decision lives here.
 *
 *  The regular season is always in (it needs lock_at backfill and pod pairing
 *  long before its first kickoff). Preseason joins while ESPN reports a preseason
 *  week in range, and is listed FIRST because in August it's the one with live
 *  games. A forced season type collapses to exactly that one context. */
export function contextsFor(forcedSeasonType, regWeek, preWeek) {
  if (forcedSeasonType != null) {
    const st = forcedSeasonType;
    const week = st === REGULAR_SEASON ? regWeek : preWeek ?? 1;
    return [{ seasonType: st, offset: OFFSET_OF[st] ?? 0, espnWeek: week }];
  }
  const ctxs = [{ seasonType: REGULAR_SEASON, offset: 0, espnWeek: regWeek }];
  if (preWeek != null && preWeek >= 1 && preWeek <= PRESEASON_WEEKS) {
    ctxs.unshift({ seasonType: PRESEASON, offset: PRESEASON_BASE, espnWeek: preWeek });
  }
  return ctxs;
}

/** Every week context worth polling right now. A context whose games are all
 *  complete does no work inside the tick, so the set narrows on its own as
 *  August ends — there is nothing to switch off. */
async function activeContexts(season) {
  const forced = config.forcedSeasonType;
  const [regW, preW] = await Promise.all([
    forced != null && forced !== REGULAR_SEASON ? Promise.resolve(1) : regularWeek(season),
    forced === REGULAR_SEASON ? Promise.resolve(null) : espnWeekFor(season, forced ?? PRESEASON),
  ]);
  return contextsFor(forced, regW, preW);
}

/** Is any game in the tick's pooled slate live, or within ~24h of kickoff? Drives
 *  the injury cadence (hourly near games, daily otherwise). */
function gameDay(games, now = Date.now()) {
  return games.some((g) => g.state === 'in' || (g.kickoffMs && g.kickoffMs - now < 24 * 3600e3 && g.kickoffMs - now > -6 * 3600e3));
}

/** Auto weekly sync: mirror every configured league's schedule + lineups. Fires on
 *  boot, on NFL week rollover, and every config.weeklySyncRefreshMs (to catch lineup
 *  changes before lock). Guarded against overlap — at ~100 leagues a sync can run
 *  longer than one play tick, so it lives on its own (slower) interval.
 *
 *  Always the REGULAR-season week, and no preseason early-return. Sleeper has no
 *  preseason pairings, so there is nothing to mirror at an offset week — but the
 *  old version turned that into "skip the sync entirely while preseason is on",
 *  which meant a league that DRAFTED in August got no rosters until someone ran
 *  the CLI by hand. Syncing the regular-season week is both correct and the thing
 *  that fixes that. */
async function syncTick() {
  if (syncing || !config.leagueIds.length) return;
  const season = config.season;
  const week = await regularWeek(season);
  const due = week !== lastSyncedWeek || Date.now() - lastSyncAt >= config.weeklySyncRefreshMs;
  if (!due) return;
  syncing = true;
  try {
    const r = await syncAllLeagues(week, season, playerIndex, config.leagueIds);
    lastSyncedWeek = week; lastSyncAt = Date.now();
    log('weekly sync: week', week, '—', `${r.ok}/${r.total} leagues`);
  } catch (e) { log('weekly sync error', e.message); }
  finally { syncing = false; }
}

/** One context's pass: fetch its scoreboard, then lock → poll → resolve →
 *  finalize at its BOARD week. Returns the games it saw (the caller pools them
 *  for the injury cadence) — or null when the context has nothing live. */
async function tickContext(ctx, season) {
  const week = ctx.espnWeek + ctx.offset;
  const games = await getGames(season, ctx.espnWeek, ctx.seasonType);
  // A context whose week is over contributes nothing and is skipped rather than
  // switched off: once the last preseason game finishes, preseason simply stops
  // doing work, and it resumes by itself if ESPN rolls to another week.
  if (!games.length || games.every((g) => g.completed)) {
    // Still finalize once — a week that completed between ticks needs its close.
    if (games.length) {
      const f = await finalizeMatchups(week, true);
      if (f) log(`[${ctx.tag}] finalized`, f, 'matchups');
    }
    return games;
  }

  // Keep the live slate fresh (overrides baked 2025) so lock/resolve slate-gate
  // the AI lineup against the real current windows + byes.
  const slate = slateFromGames(games);
  setRuntimeSlate(week, slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win, kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined })));
  // Persist the preseason slate at the offset week so the client can load it. The
  // regular-season slate arrives via migration + the weekly sync instead.
  if (ctx.offset && slate.length) {
    try {
      await db().from('nfl_slate').upsert(
        slate.map((g) => ({ season, week, home: g.home, away: g.away, win: g.win, kickoff: g.kickoff })),
        { onConflict: 'season,week,home' },
      );
    } catch (e) { log(`[${ctx.tag}] slate upsert`, e.message); }
  }

  // Fill lock_at on scheduled matchups created without it (in-app "sync week",
  // the practice build) from this week's first kickoff — already in `games`.
  const kicks = games.map((g) => g.kickoffMs).filter(Number.isFinite);
  if (kicks.length) {
    const filled = await backfillLockAt(week, Math.min(...kicks) - config.lockLeadMs);
    if (filled) log(`[${ctx.tag}] backfilled lock_at on`, filled, 'matchups');
  }

  // First kickoff per window (ms) — drives per-window pick sealing.
  const winKicks = {};
  for (const g of slate) {
    const ms = g.kickoff ? Date.parse(g.kickoff) : NaN;
    if (Number.isFinite(ms)) winKicks[g.win] = Math.min(winKicks[g.win] ?? Infinity, ms);
  }
  const wk = Object.keys(winKicks).length ? winKicks : null;

  const locked = await lockDueMatchups(new Date(), wk, week);
  if (locked) log(`[${ctx.tag}] locked`, locked, 'matchups');
  const sealed = await lockDueWindows(week, wk);
  if (sealed) log(`[${ctx.tag}] sealed`, sealed, 'window picks');

  // Poll live games → plays, keyed at the board week. Reuses the scoreboard above.
  const toPoll = gamesToPollFrom(games);
  let wrote = 0;
  for (const eventId of toPoll) { try { wrote += await pollGame(eventId, week, playerIndex); } catch (e) { log(`[${ctx.tag}] poll game`, eventId, e.message); } }
  if (toPoll.length) log(`[${ctx.tag}] polled`, toPoll.length, 'games,', wrote, 'play rows');

  const { data: live } = await db().from('matchup').select('*').eq('week', week).in('status', ['live', 'final']);
  if (live?.length) {
    await injectWeekPlays(week);
    const rctx = await prefetchTick(live, week);
    const nowMs = Date.now();
    const startedWins = wk ? new Set(Object.keys(wk).filter((w) => wk[w] <= nowMs)) : null;
    // Fill-only auto-lineups (0170.8): later windows of an ALREADY-live week
    // come due long after the scheduled→live pass ran, so empty slots (a
    // partial human, an AI seat's later windows) fill here as the week runs.
    // Idempotent — a seat with no empty slots writes nothing.
    try { await materializeAutoLineups(live.map((m) => m.id), new Date(nowMs).toISOString(), startedWins, true); }
    catch (e) { log(`[${ctx.tag}] window fill`, e.message); }
    let done = 0;
    for (let i = 0; i < live.length; i += 20) {
      await Promise.all(live.slice(i, i + 20).map((m) =>
        resolveMatchup(m, playerIndex, undefined, { playsInjected: true, ctx: rctx, startedWins }).then(() => { done++; }).catch((e) => log(`[${ctx.tag}] resolve`, m.id, e.message))));
    }
    log(`[${ctx.tag}] resolved`, done, '/', live.length, 'matchups');
  }

  if (games.every((g) => g.completed)) {
    const f = await finalizeMatchups(week, true);
    if (f) log(`[${ctx.tag}] finalized`, f, 'matchups');
  }
  return games;
}

async function tick() {
  const season = config.season;
  const contexts = (await activeContexts(season)).map((c) => ({
    ...c, tag: c.seasonType === PRESEASON ? `pre ${c.espnWeek}` : `wk ${c.espnWeek}`,
  }));

  // Every active context, in order (preseason first — it's the one with live
  // games in August). Sequential rather than parallel: they share the player
  // index and the ESPN budget, and a tick has seconds of headroom.
  const seen = [];
  for (const c of contexts) {
    try { const games = await tickContext(c, season); if (games) seen.push(...games); }
    catch (e) { log(`[${c.tag}] tick error`, e.message); }
  }

  // Week-agnostic work, once per tick regardless of how many contexts ran.
  const injEvery = gameDay(seen) ? config.injuryPollGamedayMs : config.injuryPollDailyMs;
  if (Date.now() - lastInjuryPoll >= injEvery) {
    try { const r = await pollInjuries(playerIndex); lastInjuryPoll = Date.now(); log('injuries', r.count, '@', r.feedTimestamp); }
    catch (e) { log('injury poll error', e.message); }
  }

  // Native leagues: advance live draft clocks, clear due waiver claims, and
  // drop each active week's coin allowance (idempotent — see native.js).
  try {
    const nat = await sweepNative(log, contexts.map((c) => c.espnWeek + c.offset));
    if (nat.autopicks || nat.claimsWon || nat.claimsLost || nat.allowance) {
      log('native sweep:', nat.autopicks, 'autopicks,', nat.claimsWon, 'claims won,', nat.claimsLost, 'lost,', nat.allowance, 'allowances');
    }
  } catch (e) { log('native sweep error', e.message); }

  // Members (0133): re-pull Sleeper users/rosters for poked leagues (a claimant
  // bounced off redeem_invite and asked) and, on a slow cadence, every
  // current-season sleeper league — so "refresh members" stops being a button
  // the commissioner has to remember during a join rush. Runs every tick
  // because the poked path is latency-sensitive: the claim screen is polling.
  try {
    const ms = await sweepMembers(log, season);
    if (ms.synced || ms.failed) log('member sweep:', ms.synced, 'synced,', ms.failed, 'failed');
  } catch (e) { log('member sweep error', e.message); }

  // Window Pot (0117): void offers nobody matched and freeze live ladders at
  // picks lock, then settle windows that have gone final. Week-agnostic like the
  // native sweep — pot_sweep(null) walks every open pot — and it runs after the
  // context loop above, so a window settling this tick pays out of the
  // matchup_state rows resolve just published. Idempotent; a no-op while every
  // league sits at pot_ante = 0, which is all of them until the flag is flipped.
  try { await sweepPots(log); } catch (e) { log('window pot sweep error', e.message); }
}

async function main() {
  log('worker starting; season', config.season);
  playerIndex = await buildPlayerIndex();
  log('player index built:', playerIndex.size, 'players');
  // Publish baked-vs-live team drift (0142) whenever the directory is fresh —
  // at boot (a deploy may carry a new bake that shrinks the table) and on the
  // daily refresh below. Failures only log: team display drift never blocks
  // game ops.
  const pushTeams = async () => {
    try {
      const r = await syncTeamOverrides(playerIndex);
      log(`team overrides: ${r.standing} standing (${r.changed} changed, ${r.cleared} cleared)`);
    } catch (e) { log('team override sync', e.message); }
  };
  await pushTeams();
  // Refresh the player directory daily.
  setInterval(async () => {
    try {
      playerIndex = await buildPlayerIndex();
      log('player index refreshed');
      await pushTeams();
    } catch (e) { log('index refresh', e.message); }
  }, 86400e3);

  await tick().catch((e) => log('tick error', e.message));
  setInterval(() => tick().catch((e) => log('tick error', e.message)), config.playsPollMs);

  // Weekly schedule + lineup auto-sync for all configured leagues (separate, slower
  // loop — a 100-league sync can outlast one play tick).
  if (config.leagueIds.length) {
    await syncTick().catch((e) => log('sync tick error', e.message));
    setInterval(() => syncTick().catch((e) => log('sync tick error', e.message)), config.syncCheckMs);
    // Public pods (0089): deal rosters + pair matchups for the current week.
    // Own cadence, independent of PILOT_LEAGUE_IDS. Always the REGULAR-season
    // week — pods are a regular-season product, and preseason no longer switches
    // them off (it used to, purely because both keyed off the same single week).
    const podTick = async () => {
      const season = config.season;
      const week = await regularWeek(season);
      const r = await ensurePods(week, season, playerIndex);
      if (r.dealt || r.matchups || r.tossed) log('pods:', JSON.stringify(r), 'week', week);
    };
    await podTick().catch((e) => log('pod tick error', e.message));
    setInterval(() => podTick().catch((e) => log('pod tick error', e.message)), config.syncCheckMs);
  } else {
    log('no PILOT_LEAGUE_IDS set — weekly auto-sync disabled');
  }
}

// Only when run as the entrypoint. `contextsFor` is exported for its test, and
// importing this module must not start a scheduler that polls ESPN and writes to
// Supabase as a side effect of loading it.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === entry) main().catch((e) => { console.error(e); process.exit(1); });
