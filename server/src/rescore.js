// THE COMMISSIONER'S RE-SCORE (0353) — the worker's half.
//
// The console files a `rescore_request`; this drains the queue on the tick.
// A PREVIEW re-resolves the week with `resolveMatchup`'s dry run — the same
// code down to the last install, returning before every write — and records
// before/after for each matchup plus the seats that saved no lineup. An APPLY
// is `stampFinals(restamp)` for that one league and week, exactly what the
// operator's restamp.yml runs, then the week's report rebuilt from the
// corrected finals. `rescore_finish` closes the request and, for an apply
// that moved anything, tells the league in chat.
//
// Classic only, checked here as well as in the SQL that filed the request: a
// league flipped to drip between filing and running must still be refused.
import { db } from './supabase.js';
import { resolveMatchup, stampFinals, injectWeekPlays, prefetchTick } from './resolve.js';
import { buildLeagueReport, postReport } from './report.js';
import { setRuntimeSlate } from '../../packages/core/src/data/nflSlate.ts';
import { rescoreResult } from '../../packages/core/src/data/rescore.ts';

/** Install a week's real slate from nfl_slate (restamp's installWeekSlate):
 *  without it window lookups answer from the baked 2025 schedule. Returns how
 *  many games were installed; 0 means the week cannot be re-scored. */
export async function installWeekSlate(week, season) {
  const { data } = await db().from('nfl_slate').select('home,away,win,kickoff')
    .eq('season', String(season)).eq('week', week);
  const games = (data ?? []).map((g) => ({
    away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win,
    kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined,
  }));
  setRuntimeSlate(week, games);
  return games.length;
}

const DEPS = { resolveMatchup, stampFinals, injectWeekPlays, prefetchTick, installWeekSlate, buildLeagueReport, postReport };

/** Seats in these matchups whose owner stored no pick at all that week. */
async function autofilledSeats(leagueId, rows, names) {
  const ids = rows.map((m) => m.id);
  const [{ data: picks }, { data: mem }] = await Promise.all([
    db().from('sealed_pick').select('matchup_id, app_user_id').in('matchup_id', ids).not('player_slug', 'is', null),
    db().from('league_membership').select('sleeper_roster_id, app_user_id').eq('league_id', leagueId),
  ]);
  const owner = new Map((mem ?? []).map((m) => [m.sleeper_roster_id, m.app_user_id]));
  const has = new Set((picks ?? []).map((p) => `${p.matchup_id}:${p.app_user_id}`));
  const out = [];
  for (const m of rows) {
    for (const rid of [m.home_roster_id, m.away_roster_id]) {
      const u = owner.get(rid);
      if (!u || !has.has(`${m.id}:${u}`)) out.push({ roster_id: rid, team: names.get(rid) ?? null });
    }
  }
  return out;
}

/** Drain open re-score requests. Returns how many it closed. */
export async function sweepRescores(playerIndex, log = () => {}, deps = DEPS) {
  const { data: reqs, error } = await db().from('rescore_request')
    .select('id, league_id, week, apply').is('done_at', null).is('started_at', null).order('id').limit(5);
  if (error) throw new Error(error.message);
  let n = 0;
  for (const r of reqs ?? []) {
    const finish = (result, err) => db().rpc('rescore_finish', { p_id: r.id, p_result: result ?? null, p_error: err ?? null });
    await db().from('rescore_request').update({ started_at: new Date().toISOString() }).eq('id', r.id);
    try {
      const { data: ls } = await db().from('league').select('id, name, season, settings_json').eq('id', r.league_id);
      const league = ls?.[0];
      if (!league) { await finish(null, 'no such league'); n++; continue; }
      if ((league.settings_json?.game_mode ?? 'drip') !== 'classic') {
        await finish(null, 'a drip week can’t be re-scored'); n++; continue;
      }
      const { data: rows } = await db().from('matchup').select('*')
        .eq('league_id', r.league_id).eq('week', r.week).eq('status', 'final');
      if (!rows?.length) { await finish(null, `week ${r.week} has no final matchups`); n++; continue; }
      if (!(await deps.installWeekSlate(r.week, league.season))) {
        await finish(null, `no NFL slate stored for week ${r.week} — can’t re-score it`); n++; continue;
      }
      const { data: mem } = await db().from('league_membership').select('sleeper_roster_id, team_name').eq('league_id', r.league_id);
      const names = new Map((mem ?? []).map((m) => [m.sleeper_roster_id, m.team_name || null]));
      const num = (v) => (v == null ? null : Number(v));
      const pair = (m, now, was = { home: m.home_final, away: m.away_final }) => ({
        id: m.id, home_roster_id: m.home_roster_id, away_roster_id: m.away_roster_id,
        home_team: names.get(m.home_roster_id) ?? null, away_team: names.get(m.away_roster_id) ?? null,
        was: { home: num(was.home), away: num(was.away) },
        now,
      });
      await deps.injectWeekPlays(r.week);

      if (!r.apply) {
        const ctx = await deps.prefetchTick(rows, r.week);
        const out = [];
        for (const m of rows) {
          const res = await deps.resolveMatchup(m, playerIndex, undefined, { playsInjected: true, ctx, dryRun: true });
          out.push(pair(m, { home: res.home, away: res.away }));
        }
        const result = rescoreResult(out, await autofilledSeats(r.league_id, rows, names));
        await finish(result, null);
        log('rescore preview', league.name ?? r.league_id, 'wk', r.week, '—', result.changed, 'would move,', result.flipped, 'would flip');
      } else {
        let moved = [];
        await deps.stampFinals(r.week, playerIndex, {
          restamp: true, leagueId: r.league_id, playsInjected: true, report: (m) => { moved = m; },
        });
        const byId = new Map(rows.map((m) => [m.id, m]));
        // BEFORE is what stampFinals read on its way in, not what this sweep
        // read a moment earlier: the stamp's own pair is the audit trail.
        const result = rescoreResult(moved.filter((m) => byId.has(m.id)).map((m) => pair(byId.get(m.id), m.now, m.was)));
        // THE REPORT FOLLOWS THE FINALS. Only when something moved: re-posting
        // an identical write-up would ping the league to tell it nothing.
        if (result.changed) {
          try {
            const { data: fresh } = await db().from('matchup')
              .select('id, league_id, week, home_roster_id, away_roster_id, home_final, away_final, status')
              .eq('league_id', r.league_id).eq('week', r.week);
            const report = await deps.buildLeagueReport(league, r.week, fresh ?? []);
            await deps.postReport(league, r.week, report, { force: true });
            result.report = 'rebuilt';
          } catch (e) { result.report = 'failed'; log('rescore report', r.league_id, e.message); }
        }
        await finish(result, null);
        log('rescore APPLIED', league.name ?? r.league_id, 'wk', r.week, '—', result.changed, 'moved,', result.flipped, 'flipped');
      }
      n++;
    } catch (e) {
      log('rescore', r.id, e.message);
      await finish(null, e.message).catch(() => {});
      n++;
    }
  }
  return n;
}
