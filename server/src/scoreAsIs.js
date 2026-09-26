// SCORE A WEEK AS IT STANDS (0378) — the worker's half.
//
// The commissioner of a new league files a `score_request` for a week that
// has already kicked off (the week being played, or an earlier one the season
// was backdated to). This drains the queue on the tick:
//
//   1. PLAYS. The worker only follows college schools somebody rosters, so a
//      new league's schools may never have been polled. Every game of the week
//      involving this league's rostered teams/schools with no stored plays is
//      polled now (ESPN keeps finished games) — college ones mirrored into the
//      NFL week in a mixed league, as the live tick does (0372).
//   2. LINEUPS. Each managed seat keeps what it saved for the week; a seat
//      that saved nothing takes its saved lineup from the week it plays next,
//      kept only where the player is still on its active roster; every empty
//      spot is then filled by the auto-slot planner (projections, byes, the
//      injury report). AI and unclaimed seats are left to the resolver, which
//      fields them from the roster as always.
//   3. SCORE. A week whose games are all over is finalized, stamped and
//      written up. A week still being played is left live: the games already
//      over count, and the rest play out on the normal tick.
//   4. CHAT. One house line either way.
import { db } from './supabase.js';
import { stampFinals, injectWeekPlays, modeOfSettings } from './resolve.js';
import { buildLeagueReport, postReport } from './report.js';
import { installWeekSlate } from './rescore.js';
import { pollGame, nflWeekWindows } from './poll/plays.js';
import { ruledOutSlugs, injuryStatusMap } from './injuries.js';
import { autoSlotPlan, leagueSlotDefs, leagueBestball, leagueGolfZeroPtsOf, slateAwareProj, CLASSIC_WIN } from '../../packages/core/src/engine/classic.ts';
import { setLeagueGolf } from '../../packages/core/src/engine/golf.ts';
import { playRisk } from '../../packages/core/src/engine/golfFloor.ts';
import { setLeagueProjScoring, leagueCatalogOf, setCollegeProjections } from '../../packages/core/src/engine/projScoring.ts';

const ok = ({ data, error }, what) => { if (error) throw new Error(`${what}: ${error.message}`); return data; };
const wkName = (w) => (w > 215 ? `Bowl week ${w - 215}` : w > 200 ? `Week ${w - 200}` : `Week ${w}`);
// A week is over once its last game kicked off more than this long ago.
const GAME_SPAN_MS = 5 * 3600e3;

/** PURE: one seat's lineup for the week, as it stands.
 *  `stored` — slot → slug it saved for this week (null = cleared on purpose);
 *  `saved`  — slot → slug from the week it plays next, used only when it saved
 *             nothing for this one, and only for players still on `roster`.
 *  Returns the rows to write: kept + copied + planned. */
export function asIsLineup({ slots, bestball, stored, saved, roster, valueOf }) {
  const onRoster = new Set(roster.map((p) => p.id));
  const known = new Set(slots.map((d) => d.slot));
  let base = { ...(stored ?? {}) };
  const copied = [];
  if (!Object.keys(base).length && saved) {
    const used = new Set();
    for (const [slot, slug] of Object.entries(saved)) {
      if (!slug || !known.has(slot) || !onRoster.has(slug) || used.has(slug)) continue;
      base[slot] = slug; used.add(slug); copied.push({ slot, player: slug });
    }
  }
  // A cleared spot (null) is filled too: "as it stands" is a full lineup.
  const decided = Object.fromEntries(Object.entries(base).filter(([, v]) => v));
  const planned = autoSlotPlan(slots, bestball, decided, roster, valueOf);
  return { copied, planned, rows: [...Object.entries(decided).map(([slot, player]) => ({ slot, player })), ...planned] };
}

/** PURE: is this week over, from its slate kickoffs? */
export function weekIsOver(kickoffsMs, nowMs) {
  const ks = kickoffsMs.filter(Number.isFinite);
  return ks.length > 0 && Math.max(...ks) + GAME_SPAN_MS < nowMs;
}

async function slateOf(season, weeks) {
  return ok(await db().from('nfl_slate').select('week, home, away, kickoff, game_id')
    .eq('season', String(season)).in('week', weeks).limit(2000), 'slate');
}

/** Step 1: poll the week's games for this league's teams and schools that
 *  have no plays stored. Returns how many games it polled. */
async function fetchMissingPlays(league, week, rosterSlugs, playerIndex, log) {
  const season = league.season;
  const college = league.settings_json?.calendar === 'college';
  const pool = ok(await db().from('league_pool').select('slug, team, level').eq('league_id', league.id).in('slug', rosterSlugs), 'pool');
  const nflTeams = new Set(pool.filter((p) => p.level !== 'college' && p.team).map((p) => p.team.toUpperCase()));
  const espnIds = pool.filter((p) => p.level === 'college').map((p) => p.slug.slice(2));
  const schools = new Set();
  if (espnIds.length) {
    const cps = ok(await db().from('college_player').select('school_abbr').in('espn_id', espnIds), 'schools');
    for (const c of cps) if (c.school_abbr) schools.add(c.school_abbr);
  }
  const jobs = [];   // { eventId, week, sport, mirrorWeek }
  if (college) {
    for (const g of await slateOf(season, [week])) {
      if (g.game_id && (schools.has(g.home) || schools.has(g.away))) jobs.push({ eventId: g.game_id, week, sport: 'college' });
    }
  } else {
    const nfl = await slateOf(season, [week - 1, week]);
    for (const g of nfl.filter((x) => x.week === week)) {
      if (g.game_id && (nflTeams.has(g.home) || nflTeams.has(g.away))) jobs.push({ eventId: g.game_id, week, sport: 'nfl' });
    }
    if (schools.size) {
      // A mixed league: college games inside this NFL week's window (0372).
      const spans = [week - 1, week].map((w) => {
        const ks = nfl.filter((x) => x.week === w).map((x) => Date.parse(x.kickoff)).filter(Number.isFinite);
        return ks.length ? { week: w, first: Math.min(...ks), last: Math.max(...ks) } : null;
      }).filter(Boolean);
      const win = nflWeekWindows(spans).find((x) => x.week === week);
      if (win) {
        const cfb = ok(await db().from('nfl_slate').select('week, home, away, kickoff, game_id').eq('season', String(season))
          .gte('week', 201).lte('week', 223).gte('kickoff', new Date(win.lo).toISOString()).lt('kickoff', new Date(win.hi).toISOString()), 'college slate');
        for (const g of cfb) {
          if (g.game_id && (schools.has(g.home) || schools.has(g.away))) jobs.push({ eventId: g.game_id, week: g.week, sport: 'college', mirrorWeek: week });
        }
      }
    }
  }
  let polled = 0;
  for (const j of jobs) {
    const target = j.mirrorWeek ?? j.week;
    const have = ok(await db().from('live_play').select('id').eq('week', target).eq('game_id', j.eventId).limit(1), 'plays');
    if (have.length) continue;
    try { await pollGame(j.eventId, j.week, playerIndex, j.sport, j.mirrorWeek ? { mirrorWeek: j.mirrorWeek } : {}); polled++; }
    catch (e) { log('score-as-is poll', j.eventId, e.message); }
  }
  return polled;
}

/** Step 2: write each managed seat's lineup. Returns { seats, copied, planned }. */
async function setLineups(league, week, matchups, over) {
  const mode = modeOfSettings(league.settings_json);
  setLeagueGolf(mode?.golf === true, leagueGolfZeroPtsOf(mode));
  setLeagueProjScoring(leagueCatalogOf(mode));
  const slots = leagueSlotDefs(mode);
  const bestball = leagueBestball(mode);
  // College projections for the week (0373), so the planner can rank them.
  try {
    const { data } = await db().rpc('college_proj_lines', { p_week: week });
    setCollegeProjections(Array.isArray(data) ? data : [], week);
  } catch { /* ranked at zero, as before 0373 */ }
  const slate = (await slateOf(league.season, [week])).map((g) => ({ home: g.home, away: g.away, kickoff: g.kickoff }));
  const outs = await ruledOutSlugs();
  const statuses = await injuryStatusMap();
  const valueOf = slateAwareProj(week, slate, (slug) => (outs.has(slug) ? true : playRisk(statuses.get(slug))));

  const pool = ok(await db().from('league_pool').select('slug, pos, team, exp, sleeper_id').eq('league_id', league.id).range(0, 2999), 'pool');
  const meta = new Map(pool.map((p) => [p.slug, p]));
  const flags = ok(await db().from('player_flag').select('slug, rules').eq('league_id', league.id), 'flags');
  const noStart = new Set(flags.filter((f) => f.rules?.no_start === true).map((f) => f.slug));
  const ros = ok(await db().from('native_roster').select('roster_id, slug').eq('league_id', league.id).eq('spot', 'active'), 'roster');
  const rosterOf = new Map();
  for (const r of ros) {
    const p = meta.get(r.slug);
    if (!p || noStart.has(r.slug)) continue;
    if (!rosterOf.has(r.roster_id)) rosterOf.set(r.roster_id, []);
    rosterOf.get(r.roster_id).push({ id: r.slug, pos: p.pos, team: p.team, exp: p.exp ?? null, sleeperId: p.sleeper_id ?? null });
  }
  const mems = ok(await db().from('league_membership').select('sleeper_roster_id, app_user_id, controller').eq('league_id', league.id), 'members');
  const humanOf = new Map(mems.filter((m) => m.app_user_id && m.controller !== 'ai').map((m) => [m.sleeper_roster_id, m.app_user_id]));

  // This week's rows, and every other unplayed week's (for "the week it plays next").
  const others = ok(await db().from('matchup').select('id, week').eq('league_id', league.id).neq('status', 'final').neq('week', week), 'other weeks');
  const ids = [...matchups.map((m) => m.id), ...others.map((m) => m.id)];
  const rows = ids.length ? ok(await db().from('sealed_pick').select('matchup_id, app_user_id, roster_slot, player_slug')
    .in('matchup_id', ids).eq('game_window', CLASSIC_WIN), 'picks') : [];
  const byKey = new Map();   // `${matchup}#${uid}` → { slot: slug }
  for (const r of rows) {
    const k = `${r.matchup_id}#${r.app_user_id}`;
    if (!byKey.has(k)) byKey.set(k, {});
    byKey.get(k)[r.roster_slot] = r.player_slug;
  }
  // The seat's saved lineup from the week it plays next — or, with nothing
  // ahead, the nearest week behind.
  const savedFor = (uid) => {
    const withRows = others.map((m) => ({ w: m.week, s: byKey.get(`${m.id}#${uid}`) }))
      .filter((c) => c.s && Object.values(c.s).some(Boolean));
    const ahead = withRows.filter((c) => c.w > week).sort((a, b) => a.w - b.w);
    const behind = withRows.filter((c) => c.w < week).sort((a, b) => b.w - a.w);
    return (ahead[0] ?? behind[0])?.s ?? null;
  };

  let seats = 0, copied = 0, planned = 0;
  const payload = [];
  for (const m of matchups) {
    for (const rid of new Set([m.home_roster_id, m.away_roster_id])) {
      const uid = humanOf.get(rid);
      const roster = rosterOf.get(rid);
      if (!uid || !roster?.length) continue;
      const stored = byKey.get(`${m.id}#${uid}`) ?? {};
      const plan = asIsLineup({ slots, bestball, stored, saved: savedFor(uid), roster, valueOf });
      seats++; copied += plan.copied.length; planned += plan.planned.length;
      for (const r of plan.rows) {
        payload.push({ matchup_id: m.id, app_user_id: uid, game_window: CLASSIC_WIN, roster_slot: r.slot,
          player_slug: r.player, metric_id: null, locked: over });
      }
    }
  }
  if (payload.length) {
    ok(await db().from('sealed_pick').upsert(payload, { onConflict: 'matchup_id,app_user_id,game_window,roster_slot' }), 'write lineups');
  }
  return { seats, copied, planned };
}

/** Drain open score-as-is requests. Returns how many it closed. */
export async function sweepScoreAsIs(playerIndex, log = () => {}) {
  const { data: reqs, error } = await db().from('score_request')
    .select('id, league_id, week').is('done_at', null).is('started_at', null).order('id').limit(3);
  if (error) throw new Error(error.message);
  let n = 0;
  for (const r of reqs ?? []) {
    const finish = (result, err) => db().from('score_request')
      .update({ done_at: new Date().toISOString(), result: result ?? null, error: err ?? null }).eq('id', r.id);
    await db().from('score_request').update({ started_at: new Date().toISOString() }).eq('id', r.id);
    try {
      const league = ok(await db().from('league').select('id, name, season, settings_json').eq('id', r.league_id), 'league')?.[0];
      if (!league) { await finish(null, 'no such league'); n++; continue; }
      if ((league.settings_json?.game_mode ?? 'drip') !== 'classic') { await finish(null, 'a drip week can’t be scored after the fact'); n++; continue; }
      const matchups = ok(await db().from('matchup').select('*').eq('league_id', r.league_id).eq('week', r.week), 'matchups');
      if (!matchups.length) { await finish(null, `no matchups in ${wkName(r.week)}`); n++; continue; }
      if (matchups.some((m) => m.status === 'final')) { await finish(null, `${wkName(r.week)} is already final — use re-score`); n++; continue; }

      const ros = ok(await db().from('native_roster').select('slug').eq('league_id', r.league_id), 'roster');
      const polled = await fetchMissingPlays(league, r.week, [...new Set(ros.map((x) => x.slug))], playerIndex, log);
      const kicks = (await slateOf(league.season, [r.week])).map((g) => Date.parse(g.kickoff));
      const over = weekIsOver(kicks, Date.now());
      const lineups = await setLineups(league, r.week, matchups, over);

      const names = new Map(ok(await db().from('league_membership').select('sleeper_roster_id, team_name').eq('league_id', r.league_id), 'names')
        .map((m) => [m.sleeper_roster_id, m.team_name || `Team ${m.sleeper_roster_id}`]));
      let line, finals = [];
      if (over) {
        ok(await db().from('matchup').update({ status: 'final' }).eq('league_id', r.league_id).eq('week', r.week), 'finalize');
        if (!(await installWeekSlate(r.week, league.season))) throw new Error(`no slate stored for ${wkName(r.week)}`);
        await injectWeekPlays(r.week);
        await stampFinals(r.week, playerIndex, { restamp: true, leagueId: r.league_id, playsInjected: true });
        const fresh = ok(await db().from('matchup').select('id, league_id, week, home_roster_id, away_roster_id, home_final, away_final, status')
          .eq('league_id', r.league_id).eq('week', r.week), 'finals');
        finals = fresh.map((m) => ({ home: names.get(m.home_roster_id), away: names.get(m.away_roster_id), home_final: m.home_final, away_final: m.away_final }));
        try { await postReport(league, r.week, await buildLeagueReport(league, r.week, fresh), { force: true }); }
        catch (e) { log('score-as-is report', r.league_id, e.message); }
        const f1 = (v) => (v == null ? '—' : Number(v).toFixed(1));
        line = `${wkName(r.week)} scored by the commissioner, with the rosters as they stand: `
          + finals.map((m) => `${m.home} ${f1(m.home_final)} – ${f1(m.away_final)} ${m.away}`).join(' · ') + '.';
      } else {
        line = `${wkName(r.week)} lineups set by the commissioner, with the rosters as they stand. Games already played count; the rest of the week plays out as usual — lineups can still change for players who haven't played.`;
      }
      ok(await db().from('league_message').insert({ league_id: r.league_id, author_id: null, kind: 'txn', body: line.slice(0, 500),
        txn: { kind: 'score_as_is', week: r.week, over }, mentions: [] }), 'chat');
      const result = { over, polled, ...lineups, finals };
      await finish(result, null);
      log('score-as-is', league.name ?? r.league_id, wkName(r.week), over ? 'FINAL' : 'live', JSON.stringify({ polled, ...lineups }));
      n++;
    } catch (e) {
      log('score-as-is', r.id, e.message);
      await finish(null, e.message).catch(() => {});
      n++;
    }
  }
  return n;
}
