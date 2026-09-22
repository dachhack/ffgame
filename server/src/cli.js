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
//   node src/cli.js diff-week <wk> [season] [--league=<uuid>] [--seat=<n>]  read-only per-slot scoring
import { config } from './config.js';
import { importLeague, syncWeek, syncAllLeagues, cloneWeek, seedPreseasonPool } from './sync.js';
import { buildPlayerIndex } from './playerIndex.js';
import { pollInjuries } from './poll/injuries.js';
import { gamesToPoll, espnCurrentWeek } from './poll/scoreboard.js';
import { pollGame } from './poll/plays.js';
import { getState } from './sleeper.js';
import { simulate } from './simulate.js';
import { seedTestUsers } from './seedTestUsers.js';
import { setRuntimeSlate } from '../../packages/core/src/data/nflSlate.ts';

/** THE WEEK'S SLATE, FROM THE DATABASE (v0.476.0) — what the tick installs
 *  from ESPN before it stamps anything, and what the CLI never installed.
 *
 *  Without a runtime slate every window lookup — windowForTeam, windowKickoffMs,
 *  windowsForWeek — answers from the BAKED 2025 SCHEDULE. Classic never asks
 *  (one weekly lineup, no windows), which is why its re-stamps came out exactly
 *  right. Drip asks for every pick: which window a player's game is in, when
 *  that window locks, whether a buff armed in time, whether a slot is
 *  unopposed. A 2026 week resolved against 2025's windows is a different week,
 *  and that is the shape of the week-1 drip drop — not a scoring bug, a
 *  calendar from the wrong year.
 *
 *  Reads nfl_slate for the season-week and hands setRuntimeSlate the same
 *  shape closeWeek does. Returns the game count so the caller can say what it
 *  installed, and ZERO — loudly — when there is nothing to install. */
async function installWeekSlate(week, season) {
  const { db } = await import('./supabase.js');
  const { data } = await db().from('nfl_slate').select('home,away,win,kickoff')
    .eq('season', String(season)).eq('week', week);
  const games = (data ?? []).map((g) => ({
    away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win,
    kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined,
  }));
  setRuntimeSlate(week, games);
  return games.length;
}

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
      // ── CLASSIC ONLY, UNLESS SOMEBODY INSISTS (v0.475.0) ──────────────────
      // A DRIP week is not reproducible after the fact. It was resolved live
      // against power-ups that were bought and spent at the time, buffs armed
      // in-slot, per-window state and premium gating — none of which survives
      // in a form a later re-resolve can rebuild. So re-running one does not
      // recompute the week; it invents a different one. The week-1 run of
      // 2026-09-22 proved it on live data: two drip leagues moved by -69.1 and
      // +105.4 points on a fix that had nothing to do with them.
      //
      // Classic weeks ARE reproducible — sealed picks, a play store and a
      // scoring catalog — which is the entire reason the errand exists. So the
      // errand does classic, and says plainly what it skipped.
      const { db: dbOf } = await import('./supabase.js');
      const skip = new Set();
      if (!args.includes('--include-drip')) {
        const { data: lgs } = await dbOf().from('league').select('id, settings_json');
        for (const l of lgs ?? []) {
          if ((l.settings_json?.game_mode ?? 'drip') !== 'classic') skip.add(l.id);
        }
      }
      const slateN = await installWeekSlate(week, season);
      console.log(slateN
        ? `restamp: week ${week} slate installed — ${slateN} games (windows resolve against ${season}, not the baked 2025 schedule)`
        : `restamp: ⚠ NO nfl_slate rows for week ${week} (${season}) — windows would resolve against the baked 2025 schedule; refusing`);
      if (!slateN) break;
      const idx = await buildPlayerIndex();
      let moved = [];
      const n = await stampFinals(week, idx, { restamp: true, leagueId, skipLeagues: skip, report: (m) => { moved = m; } });
      // Seats, not team names: this runs in a PUBLIC workflow log.
      const shift = (a, b) => (a == null || b == null ? '  (was unstamped)' : `  ${(b - a) >= 0 ? '+' : ''}${(b - a).toFixed(2)}`);
      console.log(`restamp: week ${week} (${season})${leagueId ? ` · league ${leagueId.slice(0, 8)}` : ' · every league'} — re-resolved ${n} matchup(s)`);
      if (skip.size) console.log(`restamp: skipped ${skip.size} non-classic league(s) — a drip week cannot be re-resolved faithfully (--include-drip to override)`);
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
    case 'diff-week': {
      // 🔎 WHERE THE BOARD AND THE SERVER DISAGREE (v0.472.0). READ-ONLY.
      //   node src/cli.js diff-week <week> [season] [--league=<uuid>] [--seat=<n>]
      //
      // Founder, over the week-2 report and the live board: the two do not
      // agree, and the re-stamp proved the stored finals are exactly what the
      // resolver produces — which settles that the server agrees with ITSELF
      // and settles nothing about which of the two is right about the
      // football. Re-running a scorer reproduces its own bugs faithfully.
      //
      // So this prints the server's answer the way the board prints its own:
      // one line per starter, the slot it filled, and what the engine paid it.
      // Hold it beside the phone and the disagreement stops being a mystery —
      // either a player is missing from one side, or one of them is worth a
      // different number, and both are things you can see rather than argue
      // about.
      //
      // IT WRITES NOTHING (resolveMatchup's dryRun returns before every write),
      // so it is safe on live data mid-season, which is the only time anybody
      // wants it.
      const { resolveMatchup, injectWeekPlays, prefetchTick } = await import('./resolve.js');
      const { db } = await import('./supabase.js');
      const pos = args.filter((a) => !a.startsWith('--'));
      const week = Number(pos[0]);
      if (!Number.isFinite(week)) { console.error('usage: diff-week <week> [season] [--league=<uuid>] [--seat=<n>]'); break; }
      const season = pos[1] ?? config.season;
      const leagueId = (args.find((a) => a.startsWith('--league=')) ?? '').slice(9) || null;
      const seat = Number((args.find((a) => a.startsWith('--seat=')) ?? '').slice(7)) || null;
      let q = db().from('matchup').select('*').eq('week', week);
      if (leagueId) q = q.eq('league_id', leagueId);
      const { data: all } = await q;
      let rows = all ?? [];
      // A season filter needs the league, since `matchup` carries no season.
      const { data: lgs } = await db().from('league').select('id, season')
        .in('id', [...new Set(rows.map((m) => m.league_id))]);
      const seasonOf = new Map((lgs ?? []).map((l) => [l.id, String(l.season)]));
      rows = rows.filter((m) => seasonOf.get(m.league_id) === String(season));
      if (seat) rows = rows.filter((m) => m.home_roster_id === seat || m.away_roster_id === seat);
      if (!rows.length) { console.log(`diff-week: no matchups at week ${week} (${season})${leagueId ? ' in that league' : ''}${seat ? ` for seat ${seat}` : ''}`); break; }
      const slateN = await installWeekSlate(week, season);
      console.log(slateN
        ? `diff-week: week ${week} slate installed — ${slateN} games`
        : `diff-week: ⚠ NO nfl_slate rows for week ${week} (${season}) — window lookups fall back to the baked 2025 schedule, so a DRIP diff below is not meaningful`);
      // Which leagues are drip, so the slot-sum line can say what a gap IS
      // rather than flag it. Every league in `rows` is read once.
      const { data: modes } = await db().from('league').select('id, settings_json')
        .in('id', [...new Set(rows.map((m) => m.league_id))]);
      const isDrip = new Map((modes ?? []).map((l) => [l.id, (l.settings_json?.game_mode ?? 'drip') !== 'classic']));
      const idx = await buildPlayerIndex();
      await injectWeekPlays(week);
      const ctx = await prefetchTick(rows, week);
      console.log(`diff-week: week ${week} (${season}) — ${rows.length} matchup(s), READ-ONLY\n`);
      for (const m of rows.sort((a, b) => String(a.league_id).localeCompare(String(b.league_id)) || a.home_roster_id - b.home_roster_id)) {
        // A SCHEDULED matchup has no sealed rows to score (resolve.js gathers
        // them only once the status has moved on), so a re-resolve falls to
        // the auto-lineup and prints a number that means nothing. Say so
        // instead of printing it — the week-2 run did, and it was read as a
        // finding.
        if (m.status === 'scheduled') {
          console.log(`── ${m.league_id.slice(0, 8)} · week ${m.week} · seat ${m.home_roster_id} vs seat ${m.away_roster_id} (scheduled) — not played yet, nothing to compare\n`);
          continue;
        }
        let r;
        try { r = await resolveMatchup(m, idx, undefined, { playsInjected: true, ctx, dryRun: true }); }
        catch (e) { console.log(`  ${m.league_id.slice(0, 8)} seat ${m.home_roster_id} vs ${m.away_roster_id}: FAILED — ${e.message}\n`); continue; }
        // Seats and player slugs only — this runs in a PUBLIC workflow log, so
        // no team names and nothing that identifies an account.
        const f = (n) => (n == null ? '   —  ' : Number(n).toFixed(2).padStart(7));
        console.log(`── ${m.league_id.slice(0, 8)} · week ${m.week} · seat ${m.home_roster_id} vs seat ${m.away_roster_id} (${m.status})`);
        console.log(`   stored final   home ${f(m.home_final)}   away ${f(m.away_final)}`);
        console.log(`   resolves to    home ${f(r.home)}   away ${f(r.away)}`
          + (Math.abs((m.home_final ?? r.home) - r.home) > 0.005 || Math.abs((m.away_final ?? r.away) - r.away) > 0.005 ? '   ⚠ DIFFERS' : ''));
        for (const side of ['home', 'away']) {
          const mine = (r.slots ?? []).filter((x) => x.side === side)
            .sort((a, b) => String(a.slot).localeCompare(String(b.slot)));
          const sum = mine.reduce((n, x) => n + (Number(x.score) || 0), 0);
          console.log(`   ${side.toUpperCase()} — ${mine.length} slot(s), summing ${sum.toFixed(2)}`);
          for (const x of mine) {
            console.log(`      ${String(x.slot).padEnd(8)} ${String(x.slug ?? '—').padEnd(26)}`
              + `${x.metric ? String(x.metric).padEnd(8) : '        '}${f(x.score)}`);
          }
          // THE LINE THAT ANSWERS THE QUESTION. A side whose slots do not add
          // up to its own total is being paid for something that is not a
          // slot, and that gap is the whole investigation.
          const total = side === 'home' ? r.home : r.away;
          const gap = Math.round((total - sum) * 100) / 100;
          if (Math.abs(gap) > 0.005) {
            // In DRIP a side's total is its slots PLUS a flat bonus per contested
            // window it won (liveResolve's battleVerdict, WINDOW_WIN_BONUS = 5),
            // baked into the window state and never into a slot row. A gap that
            // is a whole multiple of 5 is that, and is the design working. Any
            // other gap — or any gap at all in classic — is still worth a ⚠.
            const bonusish = isDrip.get(m.league_id) && gap > 0 && Math.abs(gap / 5 - Math.round(gap / 5)) < 1e-9;
            console.log(bonusish
              ? `      + ${gap.toFixed(2)} window-battle bonus (${Math.round(gap / 5)} contested window${Math.round(gap / 5) === 1 ? '' : 's'} won) — slots ${sum.toFixed(2)}, side ${total.toFixed(2)}`
              : `      ⚠ slots sum ${sum.toFixed(2)} but the side totals ${total.toFixed(2)}`);
          }
        }
        console.log('');
      }
      console.log('diff-week: nothing was written.');
      break;
    }
    case 'restore-week': {
      // ↩ PUT BACK WHAT A RE-STAMP SHOULD NOT HAVE TOUCHED (v0.475.0). Writes
      // stored finals from a recorded file — it does not resolve anything.
      //   node src/cli.js restore-week <file.json> [--dry]
      //
      // The week-1 run of 2026-09-22 re-stamped two DRIP leagues along with
      // the classic ones it was aimed at, and a drip week does not re-resolve
      // faithfully: it was scored live against power-ups, armed buffs, window
      // state and premium gating that no later pass can rebuild. Those leagues
      // moved by -69.1 and +105.4 points on a fix that had nothing to do with
      // them.
      //
      // The numbers survived because the re-stamp prints before AND after for
      // every matchup it moves. That audit trail is what makes this possible,
      // and is the argument for printing it even when nobody is reading.
      //
      // Matchups are addressed by (league, week, home seat, away seat) rather
      // than by id, so the file is readable and checkable by a person — and a
      // row that does not match exactly one matchup is REFUSED rather than
      // guessed at.
      const { readFileSync } = await import('node:fs');
      const { db } = await import('./supabase.js');
      const file = args.find((a) => !a.startsWith('--'));
      if (!file) { console.error('usage: restore-week <file.json> [--dry]'); break; }
      const dry = args.includes('--dry');
      const doc = JSON.parse(readFileSync(file, 'utf8'));
      const week = Number(doc.week);
      console.log(`restore-week: ${file} — week ${week} (${doc.season ?? '?'})${dry ? '  [DRY RUN, writes nothing]' : ''}`);
      if (doc.note) console.log(`  note: ${doc.note}\n`);
      let done = 0, refused = 0;
      for (const lg of doc.leagues ?? []) {
        // The file carries an id PREFIX, not a full uuid: it is meant to be
        // read by a person, and the prefix is what the audit log printed.
        const { data: cand } = await db().from('league').select('id, name');
        const hit = (cand ?? []).filter((l) => l.id.startsWith(lg.league_id_prefix));
        if (hit.length !== 1) {
          console.log(`  ${lg.league_id_prefix} (${lg.name ?? '?'}): ${hit.length} leagues match that prefix — REFUSED`);
          refused += (lg.matchups ?? []).length; continue;
        }
        const lid = hit[0].id;
        console.log(`  ${lg.league_id_prefix} · ${lg.matchups.length} matchup(s)`);
        // `clear_report` (v0.476.0): a week put back to 0-0 because it was
        // never played has no business keeping the write-up a mistaken
        // re-stamp posted for it. Removes the stored report and its chat line
        // for THIS league-week only, before the finals are written, so a
        // failure here leaves the numbers untouched rather than half-done.
        if (lg.clear_report === true && !dry) {
          const { error: e1 } = await db().from('league_message').delete()
            .eq('league_id', lid).eq('kind', 'report').eq('report_week', week);
          const { error: e2 } = await db().from('league_report').delete()
            .eq('league_id', lid).eq('week', week);
          if (e1 || e2) { console.log(`      clear_report FAILED — ${(e1 ?? e2).message}; league skipped`); refused += lg.matchups.length; continue; }
          console.log(`      week ${week} report and chat line removed`);
        } else if (lg.clear_report === true) {
          console.log(`      would remove the week ${week} report and chat line`);
        }
        for (const m of lg.matchups ?? []) {
          const { data: rows } = await db().from('matchup')
            .select('id, home_final, away_final')
            .eq('league_id', lid).eq('week', week)
            .eq('home_roster_id', m.home_roster_id).eq('away_roster_id', m.away_roster_id);
          if ((rows ?? []).length !== 1) {
            console.log(`      seat ${m.home_roster_id} vs ${m.away_roster_id}: ${(rows ?? []).length} matches — REFUSED`);
            refused++; continue;
          }
          const cur = rows[0];
          const f = (n) => (n == null ? '   —  ' : Number(n).toFixed(2).padStart(7));
          console.log(`      seat ${m.home_roster_id} vs ${m.away_roster_id}   home ${f(cur.home_final)} → ${f(m.home)}   away ${f(cur.away_final)} → ${f(m.away)}`);
          if (dry) { done++; continue; }
          const { error } = await db().from('matchup')
            .update({ home_final: m.home, away_final: m.away }).eq('id', cur.id);
          if (error) { console.log(`        FAILED — ${error.message}`); refused++; continue; }
          done++;
        }
      }
      console.log(`\nrestore-week: ${done} matchup(s) ${dry ? 'would be restored' : 'restored'}, ${refused} refused.`);
      if (!dry && done) {
        console.log('restore-week: the weekly reports still hold the re-stamped numbers — rebuild them from');
        console.log('              the commissioner console (WEEKLY REPORT → ↻ REPOST) for each league.');
      }
      break;
    }
    case 'ops-run': {
      // ▶ RUN ONE COMMITTED REQUEST (v0.477.0) — the ops-run workflow's entry.
      //   node src/cli.js ops-run <ops/run/NNN-name.json>
      //
      // Translates a request file into EXACTLY the argv the Re-stamp form
      // produces, and runs it as a child of the same CLI — so a request cannot
      // reach a code path the form cannot, and the form's gates hold: restamp
      // still wants its RESTAMP, drip still wants include_drip. A non-zero exit
      // from the child fails this one, which stops the workflow's loop.
      const { readFileSync } = await import('node:fs');
      const { spawnSync } = await import('node:child_process');
      const file = args[0];
      if (!file) { console.error('usage: ops-run <request.json>'); process.exitCode = 1; break; }
      const req = JSON.parse(readFileSync(file, 'utf8'));
      const argv = [];
      const need = (k) => { if (req[k] == null || req[k] === '') throw new Error(`${req.mode} needs "${k}"`); return String(req[k]); };
      if (req.mode === 'diff') {
        argv.push('diff-week', need('week'));
        if (req.season) argv.push(String(req.season));
        if (req.league) argv.push(`--league=${req.league}`);
        if (req.seat) argv.push(`--seat=${req.seat}`);
      } else if (req.mode === 'restamp') {
        if (req.confirm !== 'RESTAMP') throw new Error('restamp needs "confirm": "RESTAMP" — this rewrites stored results');
        argv.push('restamp', need('week'));
        if (req.season) argv.push(String(req.season));
        if (req.league) argv.push(`--league=${req.league}`);
        if (req.report === false) argv.push('--no-report');
        if (req.include_drip === true) argv.push('--include-drip');
      } else if (req.mode === 'restore') {
        // Paths in a request are repo-relative, like everywhere else in the
        // repo; the CLI runs from server/, so they are resolved one level up.
        argv.push('restore-week', `../${need('file')}`);
      } else {
        throw new Error(`unknown mode ${JSON.stringify(req.mode)} — diff | restamp | restore`);
      }
      console.log(`ops-run: ${argv.join(' ')}`);
      const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], ...argv], { stdio: 'inherit' });
      if (r.status !== 0) { console.error(`ops-run: ${argv[0]} exited ${r.status}`); process.exitCode = r.status || 1; }
      break;
    }
    case 'seed-test-users': {
      const rows = await seedTestUsers(args[0], args[1]);
      console.log(`seeded ${rows.length} test users (log in with these on the live site):`);
      for (const r of rows) console.log(`  ${r.email}  /  ${r.password}   → roster ${r.roster} (${r.name})${r.commish ? '  [COMMISSIONER]' : ''}`);
      break;
    }
    default:
      console.log('commands: leagues | sync <leagueId> | sync-week <leagueId> <wk> | poll-once | inj-once | simulate <lg> <wk> [--dry] | pods <wk> [season] | audit [wk] [season] [--json] | restamp <wk> [season] [--league=<uuid>] | diff-week <wk> [season] [--league=<uuid>] [--seat=<n>] | restore-week <file.json> [--dry]');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
