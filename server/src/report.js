// THE WEEKLY REPORT (v0.391.0) — posted into every league's chat when its
// week closes.
//
// Founder: "Can we get a weekly report for each league in the chat? Weekly
// report posts with a link you can click to open the report in a pop up."
//
// Runs on the completed-week branch of the tick, right after stampFinals.
// A league's report is built once its every matchup for the week carries a
// stamped final; the payload's shape is core data/weekReport.ts (the pop-up
// renders it), the row is league_report (0275), and the chat line is a
// league_message of kind 'report' with no author — the house speaks. The
// league_report primary key is the idempotency: an insert that hits it posts
// nothing, so a restart or a re-run never says the same week twice.
import { db } from './supabase.js';
import { buildWeekReport, reportBody } from '../../packages/core/src/data/weekReport.ts';

const log = (...a) => console.log(new Date().toISOString(), '[report]', ...a);

/** Ticks come every few seconds; a closed week only needs a look now and then. */
const REPORT_RECHECK_MS = 5 * 60_000;
const lastCheck = new Map();          // week → ms
const posted = new Set();             // `${league_id}:${week}` already reported

/** Post the week's reports for every league whose finals are all stamped.
 *  Returns how many were posted this pass. */
export async function postWeekReports(week, season, opts = {}) {
  const now = opts.now ?? Date.now();
  if (!opts.force && now - (lastCheck.get(week) ?? 0) < REPORT_RECHECK_MS) return 0;
  lastCheck.set(week, now);

  const { data: rows, error } = await db().from('matchup')
    .select('id, league_id, week, home_roster_id, away_roster_id, home_final, away_final, status')
    .eq('week', week);
  if (error) { log('matchups', error.message); return 0; }
  const byLeague = new Map();
  for (const m of rows ?? []) {
    if (!byLeague.has(m.league_id)) byLeague.set(m.league_id, []);
    byLeague.get(m.league_id).push(m);
  }
  // A league is ready when every matchup of the week is final AND stamped.
  const ready = [...byLeague].filter(([lid, ms]) =>
    !posted.has(`${lid}:${week}`) && ms.every((m) => m.status === 'final' && m.home_final != null && m.away_final != null));
  if (!ready.length) return 0;

  const { data: done } = await db().from('league_report').select('league_id').eq('week', week)
    .in('league_id', ready.map(([lid]) => lid));
  for (const d of done ?? []) posted.add(`${d.league_id}:${week}`);
  const pending = ready.filter(([lid]) => !posted.has(`${lid}:${week}`));
  if (!pending.length) return 0;

  const { data: leagues } = await db().from('league').select('id, name, season, settings_json')
    .in('id', pending.map(([lid]) => lid));
  const leagueOf = new Map((leagues ?? []).map((l) => [l.id, l]));

  let n = 0;
  for (const [lid, weekRows] of pending) {
    const league = leagueOf.get(lid);
    if (!league) continue;
    // Last season's leagues also own a "week N"; only this season reports.
    if (season != null && String(league.season) !== String(season)) continue;
    try {
      const report = await buildLeagueReport(league, week, weekRows);
      if (await postReport(league, week, report)) n++;
      posted.add(`${lid}:${week}`);
    } catch (e) { log(league.name ?? lid, 'wk', week, e.message); }
  }
  return n;
}

/** Everything the report needs for one league, read and built. Exported for
 *  the test harness; postWeekReports is the only production caller. */
export async function buildLeagueReport(league, week, weekRows) {
  const lid = league.id;
  const [{ data: members }, { data: finals }, { data: states }, { data: cuts }, { data: bites }] = await Promise.all([
    db().from('league_membership').select('sleeper_roster_id, team_name').eq('league_id', lid),
    db().from('matchup').select('week, home_roster_id, away_roster_id, home_final, away_final')
      .eq('league_id', lid).eq('status', 'final').lte('week', week),
    db().from('matchup_state').select('matchup_id, game_window, slot_scores')
      .in('matchup_id', weekRows.map((m) => m.id)),
    db().from('league_txn').select('roster_id, note').eq('league_id', lid).eq('kind', 'elimination')
      .like('note', `week ${week} —%`),
    db().from('vampire_steal').select('vampire, victim, take_slug, give_slug').eq('league_id', lid)
      .eq('week', week).eq('status', 'executed'),
  ]);
  const names = {};
  for (const m of members ?? []) names[m.sleeper_roster_id] = m.team_name || '';
  const sides = new Map(weekRows.map((m) => [m.id, m]));
  const slots = [];
  for (const s of states ?? []) {
    const m = sides.get(s.matchup_id);
    if (!m) continue;
    for (const r of s.slot_scores ?? []) {
      if (!r?.slug) continue;
      slots.push({ home_roster_id: m.home_roster_id, away_roster_id: m.away_roster_id, side: r.side, slug: r.slug, score: r.score, metric: r.metric ?? null });
    }
  }
  const format = league.settings_json?.format;
  return buildWeekReport({
    week, league: league.name ?? 'League', format, names,
    matchups: (finals ?? []).length ? finals : weekRows,
    slots,
    eliminated: (cuts ?? []).map((c) => c.roster_id),
    bites: (bites ?? []).map((b) => ({ vampire: b.vampire, victim: b.victim, take: b.take_slug, give: b.give_slug })),
  });
}

/** Store the payload and, only when this call is the one that stored it,
 *  post the chat line. Returns true when the message went out. */
export async function postReport(league, week, report) {
  const { data: ins, error } = await db().from('league_report')
    .upsert({ league_id: league.id, week, payload: report }, { onConflict: 'league_id,week', ignoreDuplicates: true })
    .select('league_id');
  if (error) throw new Error(`league_report: ${error.message}`);
  if (!ins?.length) return false;          // already reported by an earlier pass
  const { error: mErr } = await db().from('league_message').insert({
    league_id: league.id, author_id: null, kind: 'report', report_week: week,
    body: reportBody(report), mentions: [],
  });
  if (mErr) throw new Error(`league_message: ${mErr.message}`);
  log(league.name ?? league.id, 'wk', week, '—', report.headline);
  return true;
}

/** Test seam. */
export function __resetForTest() { lastCheck.clear(); posted.clear(); }
