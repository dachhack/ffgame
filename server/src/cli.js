// Manual ops for the pilot. Run from server/:
//   node src/cli.js sync <leagueId>            import league + memberships/enrollment
//   node src/cli.js sync-week <leagueId> <wk>  mirror a week's schedule + lineups
//   node src/cli.js poll-once                  one scoreboard+plays pass (current week)
//   node src/cli.js inj-once                   one injury poll
//   node src/cli.js simulate <lg> <wk> [..]    replay baked plays through the live feed
//   node src/cli.js simulate --dry [--week=1]  feed round-trip check, no DB
//   node src/cli.js simulate --check [lg]      read-only DB connectivity probe
//   node src/cli.js simulate --reset <lg> <wk> revert a sim'd week (scheduled, cleared)
//   node src/cli.js leagues                    list leagues (id + sleeper id) + matchup weeks
import { config } from './config.js';
import { importLeague, syncWeek, syncAllLeagues, cloneWeek } from './sync.js';
import { buildPlayerIndex } from './playerIndex.js';
import { pollInjuries } from './poll/injuries.js';
import { gamesToPoll } from './poll/scoreboard.js';
import { pollGame } from './poll/plays.js';
import { getState } from './sleeper.js';
import { simulate } from './simulate.js';
import { seedTestUsers } from './seedTestUsers.js';

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
    case 'sync-week-all': {
      // Mirror a week's schedule + lineups for EVERY configured league (PILOT_LEAGUE_IDS),
      // or an explicit list after the week. Throttled to stay under Sleeper's rate limit.
      //   node src/cli.js sync-week-all <wk> [leagueId ...]
      const week = Number(args[0] || (await getState()).week);
      const ids = args.slice(1).length ? args.slice(1) : config.leagueIds;
      if (!ids.length) { console.error('no leagues — set PILOT_LEAGUE_IDS or pass ids'); break; }
      const idx = await buildPlayerIndex();
      const r = await syncAllLeagues(week, config.season, idx, ids);
      console.log(`sync-week-all: week ${week} — ${r.ok}/${r.total} leagues synced`);
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
      const ids = await gamesToPoll(config.season, week, config.seasonType);
      let wrote = 0;
      for (const id of ids) wrote += await pollGame(id, week, idx);
      console.log('polled', ids.length, 'games,', wrote, 'rows');
      break;
    }
    case 'leagues': {
      // Read-only: list leagues (internal id + sleeper id) with a per-week matchup
      // status summary — so you can pick a (league-id, week) to simulate/rehearse.
      const { db } = await import('./supabase.js');
      const [{ data: leagues }, { data: ms }] = await Promise.all([
        db().from('league').select('id,name,sleeper_league_id,season'),
        db().from('matchup').select('league_id,week,status'),
      ]);
      const wk = new Map(); // leagueId -> Map(week -> {status: count})
      for (const m of ms ?? []) {
        if (!wk.has(m.league_id)) wk.set(m.league_id, new Map());
        const wm = wk.get(m.league_id);
        if (!wm.has(m.week)) wm.set(m.week, {});
        const c = wm.get(m.week); c[m.status] = (c[m.status] ?? 0) + 1;
      }
      if (!leagues?.length) { console.log('no leagues — import one first (cli sync <sleeperLeagueId>)'); break; }
      for (const l of leagues.sort((a, b) => (a.name > b.name ? 1 : -1))) {
        console.log(`\n${l.id}  ${l.name}  (sleeper ${l.sleeper_league_id} · ${l.season})`);
        const wm = wk.get(l.id);
        if (!wm?.size) { console.log('    (no matchups)'); continue; }
        for (const week of [...wm.keys()].sort((a, b) => a - b)) {
          const c = wm.get(week);
          console.log(`    week ${week}: ${Object.entries(c).map(([s, n]) => `${n} ${s}`).join(', ')}`);
        }
      }
      console.log('\nrehearse:  npx tsx src/cli.js simulate <league-id> <week> --speed=1200 --tick=1500 --jitter=10 --corrections=20');
      break;
    }
    case 'simulate': {
      await simulate(args);
      break;
    }
    case 'clone-week': {
      // Schedule a league's matchups + lineups at another week (e.g. a real
      // preseason week the worker will poll). Idempotent.
      //   node src/cli.js clone-week <sleeperLeagueId> <fromWeek> <toWeek>
      const [leagueId, fromW, toW] = args;
      if (!leagueId || !fromW || !toW) { console.error('usage: clone-week <sleeperLeagueId> <fromWeek> <toWeek>'); break; }
      const r = await cloneWeek(leagueId, Number(fromW), Number(toW));
      console.log(`clone-week: ${leagueId} wk${fromW} → wk${toW} — ${r.matchups} matchups, ${r.lineups} lineups`);
      break;
    }
    case 'pods': {
      const { buildPlayerIndex } = await import('./playerIndex.js');
      const { ensurePods } = await import('./pods.js');
      const idx = await buildPlayerIndex();
      const week = Number(args[0]);
      const season = args[1] ?? config.season;
      console.log(JSON.stringify(await ensurePods(week, season, idx)));
      break;
    }
    case 'seed-test-users': {
      const rows = await seedTestUsers(args[0], args[1]);
      console.log(`seeded ${rows.length} test users (log in with these on the live site):`);
      for (const r of rows) console.log(`  ${r.email}  /  ${r.password}   → roster ${r.roster} (${r.name})${r.commish ? '  [COMMISSIONER]' : ''}`);
      break;
    }
    default:
      console.log('commands: leagues | sync <leagueId> | sync-week <leagueId> <wk> | poll-once | inj-once | simulate <lg> <wk> [--dry] | pods <wk> [season]');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
