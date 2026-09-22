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
//   node src/cli.js seed-preseason-pool [lg] [wk=101]  deep slate-team pick pool for a preseason week
//   node src/cli.js restamp <wk> [season] [--league=<uuid>]  ⚠ re-resolve a CLOSED week's stored finals
import { config } from './config.js';
import { importLeague, syncWeek, syncAllLeagues, cloneWeek, seedPreseasonPool } from './sync.js';
import { buildPlayerIndex } from './playerIndex.js';
import { pollInjuries } from './poll/injuries.js';
import { gamesToPoll, espnCurrentWeek } from './poll/scoreboard.js';
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
      let espnWeek = Number(s.week) || 1;
      // Preseason (weekOffset set): Sleeper's week is 0 all August — use ESPN's
      // current preseason week, like the worker's tick does.
      if (config.weekOffset) espnWeek = (await espnCurrentWeek(config.season, config.seasonType)) ?? espnWeek;
      // ESPN is queried at the real week; DB writes land at the offset BOARD week
      // (101-103 in preseason), matching the worker — writing at the raw week
      // would drop preseason plays onto the loaded regular-season week.
      const week = espnWeek + config.weekOffset;
      const ids = await gamesToPoll(config.season, espnWeek, config.seasonType);
      let wrote = 0;
      for (const id of ids) wrote += await pollGame(id, week, idx);
      console.log('polled', ids.length, 'games,', wrote, 'rows at board week', week);
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
    case 'seed-preseason-pool': {
      // Replace every seat's lineup at a preseason board week with the DEEP
      // slate-team pool: every active skill player on the week's teams (depth-
      // chart ordered) + team K/DST. Preseason is played by the 3rd/4th string,
      // so the Week-1 clones would field starters who sit — this makes the
      // backups pickable. Run AFTER the 🏈 preseason toggle. Idempotent.
      // With no league id, targets the one league whose 🏈 preseason toggle is on.
      //   node src/cli.js seed-preseason-pool [sleeperLeagueId] [boardWeek=101]
      const [leagueId, wk] = args;
      const r = await seedPreseasonPool(leagueId || null, Number(wk || 101));
      console.log('seed-preseason-pool:', JSON.stringify(r, null, 1));
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
    case 'audit': {
      // THE WEEKLY MATCHUP AUDIT (0302, v0.430.0): who actually played the
      // week — per league and seat, slots a person set vs the computer vs an
      // AI seat, empties, OUT/bye starters, and whose moves the transactions
      // were. Same RPC the admin console's SYSTEM panel calls; printed as text.
      //   node src/cli.js audit [week] [season] [--json]
      const { db } = await import('./supabase.js');
      const { auditText } = await import('../../packages/core/src/data/weekAudit.ts');
      const pos = args.filter((a) => !a.startsWith('--'));
      const { data, error } = await db().rpc('admin_week_audit', {
        p_week: pos[0] ? Number(pos[0]) : null, p_season: pos[1] ?? config.season, p_from: null, p_to: null,
      });
      if (error) throw new Error(error.message);
      console.log(args.includes('--json') ? JSON.stringify(data, null, 1) : auditText(data));
      break;
    }
    case 'restamp': {
      // ⚠ RE-STAMP A CLOSED WEEK'S FINALS (v0.470.0).
      //   node src/cli.js restamp <week> [season] [--league=<uuid>] [--no-report]
      //
      // Founder, over the week-2 report, the league page and the live board:
      // "A lot of discrepancy across the weekly report and the matchup results
      // and summary views." All three disagreements are ONE number. The report
      // and the standings read matchup.home_final/away_final; the board reads
      // the live engine. v0.457.0 found those columns frozen mid-Monday-night
      // and fixed the freeze going forward — it did not thaw the week that was
      // already frozen, and a stamped final can never revisit itself.
      //
      // This is the thaw: re-resolve the week against the plays that exist NOW
      // and write what comes out. It prints every matchup it moved, before and
      // after, because it is rewriting results people have already read — and
      // then rebuilds each affected league's weekly report from the corrected
      // finals and replaces the chat line, since a right scoreboard under a
      // wrong write-up is still a league arguing about the score.
      const { stampFinals } = await import('./resolve.js');
      const { buildLeagueReport, postReport } = await import('./report.js');
      const { db } = await import('./supabase.js');
      const week = Number(args.find((a) => !a.startsWith('--')));
      if (!Number.isFinite(week)) { console.error('usage: restamp <week> [season] [--league=<uuid>] [--no-report]'); break; }
      const season = args.filter((a) => !a.startsWith('--'))[1] ?? config.season;
      const leagueId = (args.find((a) => a.startsWith('--league=')) ?? '').slice(9) || null;
      const idx = await buildPlayerIndex();
      let moved = [];
      const n = await stampFinals(week, idx, { restamp: true, leagueId, report: (m) => { moved = m; } });
      // Seats, not team names: this runs in a PUBLIC workflow log.
      const shift = (a, b) => (a == null || b == null ? '  (was unstamped)' : `  ${(b - a) >= 0 ? '+' : ''}${(b - a).toFixed(2)}`);
      console.log(`restamp: week ${week} (${season})${leagueId ? ` · league ${leagueId.slice(0, 8)}` : ' · every league'} — re-resolved ${n} matchup(s)`);
      let changed = 0;
      for (const m of moved.sort((x, y) => String(x.league_id).localeCompare(String(y.league_id)) || x.home_roster_id - y.home_roster_id)) {
        const same = m.was.home != null && m.was.away != null
          && Math.abs(m.was.home - m.now.home) < 0.005 && Math.abs(m.was.away - m.now.away) < 0.005;
        if (same) continue;
        changed++;
        console.log(`  ${m.league_id.slice(0, 8)} wk${m.week} seat ${m.home_roster_id} vs seat ${m.away_roster_id}`);
        console.log(`      home ${String(m.was.home ?? '—').padStart(7)} → ${String(m.now.home).padStart(7)}${shift(m.was.home, m.now.home)}`);
        console.log(`      away ${String(m.was.away ?? '—').padStart(7)} → ${String(m.now.away).padStart(7)}${shift(m.was.away, m.now.away)}`);
      }
      console.log(`restamp: ${changed} matchup(s) moved, ${n - changed} unchanged`);
      if (args.includes('--no-report')) { console.log('restamp: reports left alone (--no-report)'); break; }
      // Only leagues whose numbers actually MOVED get their write-up replaced:
      // deleting and re-posting an identical report would ping a league's chat
      // to tell it nothing.
      const lids = [...new Set(moved.filter((m) => !(m.was.home != null && m.was.away != null
        && Math.abs(m.was.home - m.now.home) < 0.005 && Math.abs(m.was.away - m.now.away) < 0.005))
        .map((m) => m.league_id))];
      if (!lids.length) { console.log('restamp: nothing moved — no report to rebuild'); break; }
      for (const lid of lids) {
        try {
          const [{ data: ls }, { data: rows }] = await Promise.all([
            db().from('league').select('id, name, season, settings_json').eq('id', lid),
            db().from('matchup').select('id, league_id, week, home_roster_id, away_roster_id, home_final, away_final, status')
              .eq('league_id', lid).eq('week', week),
          ]);
          if (!ls?.[0] || !rows?.length) { console.log(`  ${lid.slice(0, 8)}: no league/matchups — skipped`); continue; }
          const report = await buildLeagueReport(ls[0], week, rows);
          await postReport(ls[0], week, report, { force: true });
          console.log(`  ${lid.slice(0, 8)}: report rebuilt — ${report.headline}`);
        } catch (e) { console.log(`  ${lid.slice(0, 8)}: report FAILED — ${e.message}`); }
      }
      break;
    }
    case 'seed-test-users': {
      const rows = await seedTestUsers(args[0], args[1]);
      console.log(`seeded ${rows.length} test users (log in with these on the live site):`);
      for (const r of rows) console.log(`  ${r.email}  /  ${r.password}   → roster ${r.roster} (${r.name})${r.commish ? '  [COMMISSIONER]' : ''}`);
      break;
    }
    default:
      console.log('commands: leagues | sync <leagueId> | sync-week <leagueId> <wk> | poll-once | inj-once | simulate <lg> <wk> [--dry] | pods <wk> [season] | audit [wk] [season] [--json] | restamp <wk> [season] [--league=<uuid>]');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
