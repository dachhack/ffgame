// Worker entrypoint: the scheduler that drives sync → lock → poll → resolve.
//
// Sized for a few testers over a season. Three cadences:
//   • injuries   — daily, hourly on game days (pre-lock decision support)
//   • scoreboard — game-state + lock detection (each tick)
//   • plays      — live PBP during game windows → resolve live matchups
//
// Run: `node src/index.js` (needs server/.env with the Supabase service key).
import { config } from './config.js';
import { getState } from './sleeper.js';
import { buildPlayerIndex } from './playerIndex.js';
import { getGames, gamesToPollFrom, slateFromGames } from './poll/scoreboard.js';
import { pollGame } from './poll/plays.js';
import { pollInjuries } from './poll/injuries.js';
import { lockDueMatchups, finalizeMatchups } from './lock.js';
import { resolveMatchup, injectWeekPlays, prefetchTick } from './resolve.js';
import { syncAllLeagues } from './sync.js';
import { db } from './supabase.js';
import { setRuntimeSlate } from '../../src/data/nflSlate.ts';

let playerIndex = null;
let lastInjuryPoll = 0;
let lastSyncedWeek = null;
let lastSyncAt = 0;
let syncing = false;

/** Auto weekly sync: mirror every configured league's schedule + lineups. Fires on
 *  boot, on NFL week rollover, and every config.weeklySyncRefreshMs (to catch lineup
 *  changes before lock). Guarded against overlap — at ~100 leagues a sync can run
 *  longer than one play tick, so it lives on its own (slower) interval. */
async function syncTick() {
  if (syncing || !config.leagueIds.length) return;
  const { season, week } = await currentWeek();
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

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function currentWeek() {
  try { const s = await getState(); return { season: String(s.season), week: Number(s.week) || 1 }; }
  catch { return { season: config.season, week: 1 }; }
}

/** Is any game in this week's slate live or within ~24h of kickoff? */
function gameDay(games, now = Date.now()) {
  return games.some((g) => g.state === 'in' || (g.kickoffMs && g.kickoffMs - now < 24 * 3600e3 && g.kickoffMs - now > -6 * 3600e3));
}

async function tick() {
  const { season, week } = await currentWeek();
  const games = await getGames(season, week, config.seasonType);
  // Keep the live slate fresh (overrides baked 2025) so lock/resolve slate-gate
  // the AI lineup against the real current-season windows + byes.
  setRuntimeSlate(week, slateFromGames(games).map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win })));

  // Injuries: daily, or hourly on game days.
  const injEvery = gameDay(games) ? config.injuryPollGamedayMs : config.injuryPollDailyMs;
  if (Date.now() - lastInjuryPoll >= injEvery) {
    try { const r = await pollInjuries(playerIndex); lastInjuryPoll = Date.now(); log('injuries', r.count, '@', r.feedTimestamp); }
    catch (e) { log('injury poll error', e.message); }
  }

  // Lock any matchups whose kickoff has passed (reveals sealed picks).
  const locked = await lockDueMatchups();
  if (locked) log('locked', locked, 'matchups');

  // Poll live games → persist plays. Reuse the scoreboard fetched above instead
  // of fetching the identical URL again.
  const toPoll = gamesToPollFrom(games);
  let wrote = 0;
  for (const eventId of toPoll) { try { wrote += await pollGame(eventId, week, playerIndex); } catch (e) { log('poll game', eventId, e.message); } }
  if (toPoll.length) log('polled', toPoll.length, 'games,', wrote, 'play rows');

  // Resolve every live matchup for the week. Plays are fetched ONCE per tick (shared
  // across all matchups), then matchups resolve in parallel chunks so the loop stays
  // well under the tick interval even at ~100 leagues (~600 matchups).
  const { data: live } = await db().from('matchup').select('*').eq('week', week).in('status', ['live', 'final']);
  if (live?.length) {
    await injectWeekPlays(week);
    const ctx = await prefetchTick(live, week); // ~5 bulk reads instead of ~6/matchup
    let done = 0;
    for (let i = 0; i < live.length; i += 20) {
      await Promise.all(live.slice(i, i + 20).map((m) =>
        resolveMatchup(m, playerIndex, undefined, { playsInjected: true, ctx }).then(() => { done++; }).catch((e) => log('resolve', m.id, e.message))));
    }
    log('resolved', done, '/', live.length, 'matchups');
  }

  // Finalize when the slate is complete.
  if (games.length && games.every((g) => g.completed)) {
    const f = await finalizeMatchups(week, true);
    if (f) log('finalized', f, 'matchups');
  }
}

async function main() {
  log('worker starting; season', config.season);
  playerIndex = await buildPlayerIndex();
  log('player index built:', playerIndex.size, 'players');
  // Refresh the player directory daily.
  setInterval(async () => { try { playerIndex = await buildPlayerIndex(); log('player index refreshed'); } catch (e) { log('index refresh', e.message); } }, 86400e3);

  await tick().catch((e) => log('tick error', e.message));
  setInterval(() => tick().catch((e) => log('tick error', e.message)), config.playsPollMs);

  // Weekly schedule + lineup auto-sync for all configured leagues (separate, slower
  // loop — a 100-league sync can outlast one play tick).
  if (config.leagueIds.length) {
    await syncTick().catch((e) => log('sync tick error', e.message));
    setInterval(() => syncTick().catch((e) => log('sync tick error', e.message)), config.syncCheckMs);
  } else {
    log('no PILOT_LEAGUE_IDS set — weekly auto-sync disabled');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
