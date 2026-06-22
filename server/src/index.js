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
import { getGames, gamesToPoll } from './poll/scoreboard.js';
import { pollGame } from './poll/plays.js';
import { pollInjuries } from './poll/injuries.js';
import { lockDueMatchups, finalizeMatchups } from './lock.js';
import { resolveMatchup } from './resolve.js';
import { db } from './supabase.js';

let playerIndex = null;
let lastInjuryPoll = 0;

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
  const games = await getGames(season, week);

  // Injuries: daily, or hourly on game days.
  const injEvery = gameDay(games) ? config.injuryPollGamedayMs : config.injuryPollDailyMs;
  if (Date.now() - lastInjuryPoll >= injEvery) {
    try { const r = await pollInjuries(playerIndex); lastInjuryPoll = Date.now(); log('injuries', r.count, '@', r.feedTimestamp); }
    catch (e) { log('injury poll error', e.message); }
  }

  // Lock any matchups whose kickoff has passed (reveals sealed picks).
  const locked = await lockDueMatchups();
  if (locked) log('locked', locked, 'matchups');

  // Poll live games → persist plays.
  const toPoll = await gamesToPoll(season, week);
  let wrote = 0;
  for (const eventId of toPoll) { try { wrote += await pollGame(eventId, week, playerIndex); } catch (e) { log('poll game', eventId, e.message); } }
  if (toPoll.length) log('polled', toPoll.length, 'games,', wrote, 'play rows');

  // Resolve every live matchup for the week.
  const { data: live } = await db().from('matchup').select('*').eq('week', week).in('status', ['live', 'final']);
  for (const m of live ?? []) { try { await resolveMatchup(m); } catch (e) { log('resolve', m.id, e.message); } }

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
}

main().catch((e) => { console.error(e); process.exit(1); });
