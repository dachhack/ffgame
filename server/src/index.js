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
import { pollRosters } from './poll/rosters.js';
import { pollMarket } from './poll/market.js';
import { lockDueMatchups, lockDueWindows, finalizeMatchups, backfillLockAt, materializeAutoLineups, sealDueClassicPicks, teamKickoffs, autoSlotClassicLineups } from './lock.js';
import { ensureSeatAgents } from './agents.js';
import { resolveMatchup, injectWeekPlays, prefetchTick } from './resolve.js';
import { syncAllLeagues, syncWeek } from './sync.js';
import { syncCadenceAt } from '../../packages/core/src/data/syncCadence.ts';
import { regularWeekFrom } from '../../packages/core/src/data/seasonWeek.ts';
import { sweepNative } from './native.js';
import { sweepSeatWire } from './seatWire.js';
import { sweepPots } from './pot.js';
import { sweepPush } from './push.js';
import { trueupTick } from './poll/trueup.js';
import { db } from './supabase.js';
import { ensurePods } from './pods.js';
import { PRESEASON, REGULAR_SEASON } from './seasonType.js';
import { setRuntimeSlate, PRESEASON_BASE, PRESEASON_WEEKS } from '../../packages/core/src/data/nflSlate.ts';

let playerIndex = null;
let lastInjuryPoll = 0;
// The roster sweep's own clock. Zero means "never run", so the first tick after
// boot takes a census — a deploy is exactly when the table is most likely stale.
let lastRosterPoll = 0;
let lastMarketPoll = 0;
let lastSyncedWeek = null;
let lastSyncAt = 0;
let syncing = false;
let manualSyncing = false;

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

/** First kickoff of regular-season week 1, cached for the process. ESPN answers
 *  correctly when asked with an EXPLICIT `week=1`; it is only the
 *  un-parameterised call whose week number drifts through August. Week 1's
 *  fixtures do not move, so this is fetched once and kept. */
let week1KickoffMs;
async function week1Kickoff(season) {
  if (week1KickoffMs !== undefined) return week1KickoffMs;
  try {
    const g = await getGames(season, 1, REGULAR_SEASON, 24 * 3600e3);
    const ks = g.map((x) => x.kickoffMs).filter(Number.isFinite);
    week1KickoffMs = ks.length ? Math.min(...ks) : null;
  } catch { week1KickoffMs = null; }   // unknown, not zero — the rule handles null
  return week1KickoffMs;
}

/** The regular-season week everything non-preseason keys off.
 *
 *  v0.320.0: this used to be "Sleeper's week, else ESPN's, else 1", and the
 *  middle term is wrong for the six weeks of every year when it is the only
 *  term available. Sleeper sits at 0 all August, and ESPN's regular-season
 *  scoreboard called WITHOUT a `week` parameter reports a number that drifts
 *  forward with the calendar (2 on 19 Aug, 3 on 20 Aug) over a 100-event bag
 *  spanning January playoffs to September. The worker was mirroring rosters
 *  into weeks 2, 3, 4 — weeks nobody can open — while WEEK 1 went unwritten.
 *  See `regularWeekFrom` (core) for the rule and its tests. */
async function regularWeek(season) {
  let sleeperWeek = null, sleeperSeasonType = null;
  // BOTH FIELDS, ALWAYS. `week` alone is the preseason week during August and
  // reading it as a regular-season week is the bug this replaced.
  try { const st = await getState(); sleeperWeek = Number(st.week); sleeperSeasonType = st.season_type ?? null; }
  catch { /* Sleeper down — the rules below cover it */ }
  // Only reach for the kickoff when Sleeper cannot answer — in season the first
  // rule wins and this costs nothing.
  const needGuard = !((sleeperSeasonType === 'regular' || sleeperSeasonType === 'post')
                      && Number.isFinite(sleeperWeek) && sleeperWeek >= 1);
  const [espnWeek, k1] = await Promise.all([
    needGuard ? espnWeekFor(season, REGULAR_SEASON) : Promise.resolve(null),
    needGuard ? week1Kickoff(season) : Promise.resolve(null),
  ]);
  const choice = regularWeekFrom({ sleeperWeek, sleeperSeasonType, espnWeek, week1KickoffMs: k1, nowMs: Date.now() });
  if (choice.reason !== lastWeekReason) {
    log('regular week:', choice.week, `(${choice.reason})`);
    lastWeekReason = choice.reason;
  }
  return choice.week;
}
let lastWeekReason = null;

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
 *  boot and thereafter on the cadence below (to catch lineup changes before lock). Guarded against overlap — at ~100 leagues a sync can run
 *  longer than one play tick, so it lives on its own (slower) interval.
 *
 *  Always the REGULAR-season week, and no preseason early-return. Sleeper has no
 *  preseason pairings, so there is nothing to mirror at an offset week — but the
 *  old version turned that into "skip the sync entirely while preseason is on",
 *  which meant a league that DRAFTED in August got no rosters until someone ran
 *  the CLI by hand. Syncing the regular-season week is both correct and the thing
 *  that fixes that.
 *
 *  v0.319.0: the gap between syncs is no longer a constant. See
 *  `syncCadenceAt` — 20 minutes through the overnight waiver window, hourly
 *  otherwise, and tightening from two hours before each kickoff to one minute
 *  at lock.
 *
 *  WEEK ROLLOVER IS NO LONGER ITS OWN TRIGGER, and does not need to be. It used
 *  to force a sync so a new week's pairings landed promptly; now the cadence
 *  itself is at worst hourly, and a rolled week self-corrects on the first due
 *  tick — every kickoff for the previous week is in the past, so the ramp goes
 *  quiet and the hourly rung fires. Rollover happens midweek, far from any
 *  kickoff, which is precisely when an hour of lag costs nothing. */
async function syncTick() {
  if (syncing || !config.leagueIds.length) return;
  const now = Date.now();

  // ── THE CADENCE DECISION (v0.319.0), BEFORE ANY NETWORK CALL ────────────
  // Fixtures come from the opt-in scoreboard cache, so this runs every 30s for
  // the price of some arithmetic. Keyed on the LAST SYNCED WEEK rather than a
  // fresh `regularWeek()` — that is an ESPN round trip, and the week is only
  // needed here to say which kickoffs to read. Before the first sync there is
  // no week yet, and none is needed: `lastSyncAt` is 0, so the boot sync fires
  // unconditionally and establishes it.
  let cadence = { intervalMs: config.syncFloorMs, reason: 'boot' };
  if (lastSyncAt) {
    let kickoffs = [];
    if (lastSyncedWeek != null) {
      try {
        const fixtures = await getGames(config.season, lastSyncedWeek, config.seasonType, config.fixtureCacheMs);
        kickoffs = fixtures.map((g) => g.kickoffMs).filter(Number.isFinite);
      } catch (e) {
        // Fixtures unavailable is not a reason to stop syncing — it is a reason
        // to fall back to the schedule that needs no fixtures at all.
        log('sync cadence: fixtures unavailable —', e.message);
      }
    }
    cadence = syncCadenceAt(now, kickoffs);
    // WEEKLY_SYNC_MS pins the pre-v0.319.0 flat behaviour if it is ever needed;
    // the floor stops a mis-set ramp from hammering Sleeper.
    const pinned = config.weeklySyncRefreshMs;
    const intervalMs = Math.max(config.syncFloorMs, pinned || cadence.intervalMs);
    if (now - lastSyncAt < intervalMs) return;
    cadence = pinned ? { intervalMs, reason: 'pinned by WEEKLY_SYNC_MS' } : { ...cadence, intervalMs };
  }

  const season = config.season;
  const week = await regularWeek(season);
  syncing = true;
  try {
    const r = await syncAllLeagues(week, season, playerIndex, config.leagueIds);
    const took = Date.now() - now;
    lastSyncedWeek = week; lastSyncAt = Date.now();
    log('weekly sync: week', week, '—', `${r.ok}/${r.total} leagues`,
      `(${cadence.reason}, every ${Math.round(cadence.intervalMs / 60_000)}m, took ${(took / 1000).toFixed(1)}s)`);
    // A pass that outruns its own cadence is not broken — the non-reentrancy
    // guard absorbs the next firing — but it means the schedule above is
    // aspirational rather than real, and that should be visible in the log
    // rather than inferred from timestamps weeks later.
    if (took > cadence.intervalMs) {
      log(`weekly sync WARNING: pass took ${(took / 1000).toFixed(1)}s but the cadence asks for one every`,
        `${Math.round(cadence.intervalMs / 60_000)}m — raise SYNC_FLOOR_MS or reduce league count`);
    }
  } catch (e) { log('weekly sync error', e.message); }
  finally { syncing = false; }
}

/** MANUAL REFRESH (0204): service whatever a manager asked for.
 *
 *  The client cannot call Sleeper for us and this worker has no HTTP surface,
 *  so a button writes a `sync_request` row and this drains it on the tick that
 *  is already running. It calls the SAME `syncWeek` the scheduled path calls —
 *  one code path, two triggers — so the manual and automatic refreshes cannot
 *  drift apart.
 *
 *  Its own loop rather than a step inside `tick()`: a Sleeper round trip must
 *  never stretch a play tick, and a request that throws must not take the live
 *  board down with it. Every outcome is written back to the row, including the
 *  failures, because the button is showing a manager what happened.
 */
async function manualSyncTick() {
  if (manualSyncing) return;
  const { data: reqs } = await db().from('sync_request')
    .select('league_id, requested_at')
    .is('finished_at', null)
    .order('requested_at', { ascending: true })
    .limit(5);                                   // a burst is drained over a few ticks, not in one
  if (!reqs?.length) return;
  manualSyncing = true;
  try {
    const season = config.season;
    const week = await regularWeek(season);
    for (const r of reqs) {
      // Claim it first. A crash mid-sync then leaves a row with started_at set
      // and finished_at null, which reads as "in flight" rather than silently
      // re-running on every tick forever.
      await db().from('sync_request').update({ started_at: new Date().toISOString() })
        .eq('league_id', r.league_id).is('started_at', null);
      const { data: lg } = await db().from('league')
        .select('sleeper_league_id, provider').eq('id', r.league_id).single();
      let ok = false, note = null;
      if (!lg || lg.provider !== 'sleeper' || !lg.sleeper_league_id) {
        note = 'not a Sleeper league';           // the RPC guards this too; belt and braces
      } else {
        try {
          await syncWeek(lg.sleeper_league_id, week, season, playerIndex);
          ok = true; note = `week ${week}`;
        } catch (e) { note = String(e?.message ?? e).slice(0, 200); }
      }
      await db().from('sync_request')
        .update({ finished_at: new Date().toISOString(), ok, note })
        .eq('league_id', r.league_id);
      log('manual sync', r.league_id, ok ? 'ok' : `failed — ${note}`);
    }
  } catch (e) { log('manual sync tick error', e.message); }
  finally { manualSyncing = false; }
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

  // AUTO-SLOT (v0.247.0): a classic team starts the week with the best
  // projected lineup its roster can field, which the manager then adjusts.
  // BEFORE lockDueMatchups, so a week that comes due on this same tick seals a
  // real lineup rather than a blank card. Idempotent — it only writes spots
  // that have no row, so a set lineup costs one read and nothing else.
  try {
    // SEAT AGENTS (0180) first, so a just-created league's empty seats are
    // agented before the same tick's auto-slot writes lineups.
    const agents = await ensureSeatAgents();
    if (agents) log(`[${ctx.tag}] provisioned`, agents, 'seat agents');
  } catch (e) { log(`[${ctx.tag}] seat agents`, e.message); }
  try {
    // The tick's own slate rides along (v0.252.0) so the fill can prove byes;
    // injuries come from injury_status inside.
    const auto = await autoSlotClassicLineups(week, slate);
    if (auto) log(`[${ctx.tag}] auto-slotted`, auto, 'classic spots');
  } catch (e) { log(`[${ctx.tag}] auto-slot`, e.message); }
  try {
    // AFTER the lineup fill, deliberately. The wire's whole notion of a "hole"
    // is a starting spot the roster cannot answer, so it must read the lineup
    // the fill has already settled — running it first would have it transact
    // for holes auto-slot was about to close from the bench.
    const wired = await sweepSeatWire(week, slate, log);
    if (wired) log(`[${ctx.tag}] seat wire`, wired, 'agent transactions');
  } catch (e) { log(`[${ctx.tag}] seat wire`, e.message); }

  const locked = await lockDueMatchups(new Date(), wk, week);
  if (locked) log(`[${ctx.tag}] locked`, locked, 'matchups');
  const sealed = await lockDueWindows(week, wk);
  if (sealed) log(`[${ctx.tag}] sealed`, sealed, 'window picks');
  // CLASSIC late swap (0178): weekly picks seal one player at a time, at their
  // own team's kickoff — so a Thursday game no longer freezes Sunday's lineup.
  try {
    const swapped = await sealDueClassicPicks(week, teamKickoffs(slate));
    if (swapped) log(`[${ctx.tag}] sealed`, swapped, 'classic picks (per player)');
  } catch (e) { log(`[${ctx.tag}] classic seal`, e.message); }

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

  // WHERE EVERY PLAYER PLAYS (v0.305.0), on the tick rather than on the daily
  // directory refresh: 32 small ESPN fetches, so a cut, a signing or a
  // practice-squad elevation reaches the app the same afternoon it happens.
  if (Date.now() - lastRosterPoll >= config.rosterPollMs) {
    lastRosterPoll = Date.now();   // set BEFORE the await: a slow sweep must not queue a second one
    try {
      const r = await pollRosters(playerIndex);
      log(`rosters: ${r.teams}/32 teams, ${r.athletes} athletes — ${r.standing} standing (${r.changed} changed)`);
    } catch (e) { log('roster sweep error', e.message); }
  }

  // HOW WIDELY EACH PLAYER IS ROSTERED (0202): ESPN's ownership percentages,
  // which the wire and the draft board sort by. Cheap enough (105KB) to keep
  // current; the platform's own league-derived count stays the fallback.
  if (Date.now() - lastMarketPoll >= config.marketPollMs) {
    lastMarketPoll = Date.now();   // before the await, same reason as the sweep
    try {
      const r = await pollMarket(playerIndex, config.season);
      log(`market: ${r.rows} rows (${r.priced} with ADP) from ${r.seen} listed (${r.unresolved} unresolved)`);
    } catch (e) { log('market poll error', e.message); }
  }

  // Native leagues: advance live draft clocks, clear due waiver claims, and
  // drop each active week's coin allowance (idempotent — see native.js).
  try {
    const nat = await sweepNative(log, contexts.map((c) => c.espnWeek + c.offset));
    if (nat.autopicks || nat.claimsWon || nat.claimsLost || nat.allowance || nat.drafted) {
      log('native sweep:', nat.autopicks, 'autopicks,', nat.claimsWon, 'claims won,', nat.claimsLost, 'lost,', nat.allowance, 'allowances,', nat.drafted, 'drafts started');
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
  }, config.directoryRefreshMs);

  // NON-REENTRANT (0199.3). On a busy slate a tick (many games polled, ESPN
  // slow) can outlast playsPollMs; overlapping ticks interleave their contexts'
  // play injections and resolves against the shared engine store, which is how
  // the 8/15 Saturday windows resolved to zeros while their plays sat in the
  // database. A tick that's still running simply absorbs the next firing.
  let ticking = false;
  const guardedTick = async () => {
    if (ticking) { log('tick skipped — previous tick still running'); return; }
    ticking = true;
    try { await tick(); } catch (e) { log('tick error', e.message); } finally { ticking = false; }
  };
  await guardedTick();
  setInterval(() => { void guardedTick(); }, config.playsPollMs);

  // Manual refresh queue (0204) — its own loop at the play cadence, so a
  // manager's button answers in ~25s without a Sleeper round trip ever landing
  // inside a play tick.
  setInterval(() => manualSyncTick().catch((e) => log('manual sync error', e.message)), config.playsPollMs);

  // App push notifications (0150): detect + deliver on a 60s sweep, its own
  // loop — a slow FCM round must never stretch a play tick.
  await sweepPush().catch((e) => log('push sweep error', e.message));
  setInterval(() => sweepPush().catch((e) => log('push sweep error', e.message)), 60_000);

  // nflverse true-up (0169): QB hits + passes defended, ~a day behind the
  // games — ESPN's live text can't carry them; nflverse's nightly pbp can.
  // Sweeps the current regular-season week and the three before it (late
  // stat corrections), every 6h. A 404 before the season's first data drop
  // just logs — the regular season is the product this loop serves, and
  // nflverse doesn't publish preseason pbp at all.
  const trueup = async () => {
    const wk = await regularWeek(config.season);
    const weeks = []; for (let w = Math.max(1, wk - 3); w <= wk; w++) weeks.push(w);
    const r = await trueupTick(Number(config.season), weeks, playerIndex);
    if (r.rows) log(`true-up: ${r.rows} qbhit/pd rows current`);
  };
  await trueup().catch((e) => log('true-up error', e.message));
  setInterval(() => trueup().catch((e) => log('true-up error', e.message)), 6 * 3600e3);

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
    setInterval(() => podTick().catch((e) => log('pod tick error', e.message)), config.podCheckMs);
  } else {
    log('no PILOT_LEAGUE_IDS set — weekly auto-sync disabled');
  }
}

// Only when run as the entrypoint. `contextsFor` is exported for its test, and
// importing this module must not start a scheduler that polls ESPN and writes to
// Supabase as a side effect of loading it.
const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (import.meta.url === entry) main().catch((e) => { console.error(e); process.exit(1); });
