// Manual ops for the pilot. Run from server/:
//   node src/cli.js sync <leagueId>            import league + memberships/enrollment
//   node src/cli.js sync-week <leagueId> <wk>  mirror a week's schedule + lineups
//   node src/cli.js poll-once                  one scoreboard+plays pass (current week)
//   node src/cli.js inj-once                   one injury poll
//   node src/cli.js simulate <lg> <wk> [..]    replay baked plays through the live feed
//   node src/cli.js simulate --dry [--week=1]  feed round-trip check, no DB
import { config } from './config.js';
import { importLeague, syncWeek } from './sync.js';
import { buildPlayerIndex } from './playerIndex.js';
import { pollInjuries } from './poll/injuries.js';
import { gamesToPoll } from './poll/scoreboard.js';
import { pollGame } from './poll/plays.js';
import { getState } from './sleeper.js';
import { simulate } from './simulate.js';

const [cmd, ...args] = process.argv.slice(2);

async function main() {
  switch (cmd) {
    case 'sync': {
      const ids = args.length ? args : config.leagueIds;
      for (const id of ids) {
        const r = await importLeague(id);
        console.log('imported', id, r);
        console.log(`  ➜ invite code: ${r.inviteCode}  (share with the league — players redeem it to enroll)`);
      }
      break;
    }
    case 'sync-week': {
      const [leagueId, week] = args;
      const idx = await buildPlayerIndex();
      console.log('synced week', week, await syncWeek(leagueId, Number(week), config.season, idx));
      break;
    }
    case 'inj-once': {
      const idx = await buildPlayerIndex();
      console.log('injuries', await pollInjuries(idx));
      break;
    }
    case 'poll-once': {
      const idx = await buildPlayerIndex();
      const s = await getState();
      const week = Number(s.week) || 1;
      const ids = await gamesToPoll(config.season, week);
      let wrote = 0;
      for (const id of ids) wrote += await pollGame(id, week, idx);
      console.log('polled', ids.length, 'games,', wrote, 'rows');
      break;
    }
    case 'simulate': {
      await simulate(args);
      break;
    }
    default:
      console.log('commands: sync <leagueId> | sync-week <leagueId> <wk> | poll-once | inj-once | simulate <lg> <wk> [--dry]');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
