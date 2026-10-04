// SPORT LEAGUES ON THE WORKER (phase 3, v0.617.0) — locking and resolving.
//
// Two jobs, both run from the sports loop (index.js) after each poll:
//
//   LOCK. When a game starts, every seat in every league of that sport whose
//   period covers today has its starting slots holding players on the two
//   teams snapshotted into sport_slot_lock for the day. The DB trigger
//   (0426 enforce_sport_pick_lock) has refused edits to those players since
//   the start, so the snapshot IS the lineup as the manager left it. A slot
//   is locked once per day; a player with no game today is never locked.
//
//   RESOLVE. A matchup's score is the sum of its locked slot-days' points
//   (or the category verdict over their summed lines), read straight from
//   game_stat_line — cumulative, so re-running is idempotent. Written the
//   way every other league's result is: matchup_state('wk') while the
//   period runs, matchup.home_final/away_final + status final once the
//   period is over and no game in it is still live. Standings then read it
//   exactly as they read an NFL week.
//
// Pure functions first (tested in test/sports-league.mjs); the I/O at the
// bottom is thin.
import { db, allRows } from './supabase.js';
import { SPORTS } from '../../packages/core/src/sports/index.ts';
import { linePoints, normalizeScoring, categoryTotals, compareCategories, rotoStandings } from '../../packages/core/src/sports/score.ts';
import { sportPeriod, sportWeekOf, sportSettingsOf } from '../../packages/core/src/sports/league.ts';
import { easternDate } from './poll/sportGames.js';

const log = (...a) => console.log('[sport-league]', ...a);

/** Games that have started: live, final, or still listed 'pre' past their
 *  start (feed lag). A postponement or cancellation is never a start,
 *  whatever its clock says. */
export const startedGames = (games, now = Date.now()) =>
  games.filter((g) => g.status === 'live' || g.status === 'final' || (g.status === 'pre' && g.startUtc && Date.parse(g.startUtc) <= now));

/** Which sealed picks to lock for a started game: the seat's 'wk' rows
 *  whose player is on either team and has no lock for the day yet. */
export function locksFor(game, picks, poolTeamOf, existing, allows = () => true) {
  const teams = new Set([game.home, game.away]);
  const out = [];
  for (const p of picks) {
    if (p.game_window !== 'wk' || !p.player_slug) continue;
    if (!teams.has(poolTeamOf(p.player_slug))) continue;
    // A player in a slot he is not eligible for (a centre at guard) never
    // locks, so he never scores — the same 0 the NFL resolver gives an
    // illegal spot, decided here once rather than at every read.
    if (!allows(p.roster_slot, p.player_slug)) { log(`illegal lineup spot skipped: ${p.player_slug} in ${p.roster_slot}`); continue; }
    // One lock per slot per GAME: a doubleheader's second game locks the
    // slot again for the day, under its own game id (0430).
    const key = `${p.matchup_id}|${p.app_user_id}|${game.gameDate}|${p.roster_slot}|${game.gameId}`;
    if (existing.has(key)) continue;
    out.push({ matchup_id: p.matchup_id, app_user_id: p.app_user_id, game_date: game.gameDate, roster_slot: p.roster_slot, player_slug: p.player_slug, game_id: game.gameId });
  }
  return out;
}

/** Score one side from its locked slot-days. `rows` are sport_matchup_lines
 *  rows for that seat; a slot-day with no line (a scratch after lock) is 0. */
export function sideScore(def, settings, rows) {
  const scoring = normalizeScoring(def, settings?.scoring);
  const slots = {};
  let total = 0;
  const lines = [];
  for (const r of rows) {
    const line = r.line ?? null;
    const pts = line ? linePoints(def, line, scoring) : 0;
    total = Math.round((total + pts) * 100) / 100;
    slots[r.roster_slot] = Math.round(((slots[r.roster_slot] ?? 0) + pts) * 100) / 100;
    if (line) lines.push(line);
  }
  return { total, slots, lines };
}

/** The matchup's verdict: points totals, or category wins as the score. */
export function scoreMatchup(def, settings, homeRows, awayRows) {
  const home = sideScore(def, settings, homeRows), away = sideScore(def, settings, awayRows);
  if (settings?.format === 'cats' && settings.categories?.length) {
    const v = compareCategories(def, categoryTotals(def, home.lines), categoryTotals(def, away.lines), settings.categories);
    return {
      homeScore: v.wins, awayScore: v.losses,
      slotScores: { format: 'cats', cats: v.cats, ties: v.ties, home: home.slots, away: away.slots, homePts: home.total, awayPts: away.total },
    };
  }
  return { homeScore: home.total, awayScore: away.total, slotScores: { format: 'points', home: home.slots, away: away.slots } };
}

/** ROTO (0427): every seat's season totals → the ranking. `rows` are
 *  sport_league_lines_svc rows; seats with no line yet still appear (at the
 *  bottom of every category). */
export function rotoTable(def, settings, rows, rosterIds) {
  const by = new Map(rosterIds.map((id) => [id, []]));
  for (const r of rows) {
    if (r.roster_id == null || !r.line) continue;
    if (!by.has(r.roster_id)) by.set(r.roster_id, []);
    by.get(r.roster_id).push(r.line);
  }
  const teams = [...by.entries()].map(([id, lines]) => ({ id: String(id), totals: categoryTotals(def, lines) }));
  const cats = settings.categories?.length ? settings.categories : def.categoriesDefault;
  return rotoStandings(def, teams, cats).map((row) => ({
    league_id: null, roster_id: Number(row.id), points: row.total,
    totals: teams.find((t) => t.id === row.id)?.totals ?? {}, cats: row.cats,
  }));
}

/** Is the period over, with nothing left to count? A game of the period
 *  still live holds it — but only a game FROM the period, and only for two
 *  days: a suspended game the feed never closes must not hold every later
 *  period hostage (repollStaleLive keeps trying it regardless). */
export const periodDone = (period, today, liveGameDates) => {
  if (today <= period.to) return false;
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - 2 * 86400e3;
  return !liveGameDates.some((d) => d >= period.from && d <= period.to && new Date(`${d}T00:00:00Z`).getTime() >= cutoff);
};

// ── I/O ──────────────────────────────────────────────────────────────────────

/** Native leagues in this sport whose DRAFT IS COMPLETE, with their sport
 *  settings. A league still drafting has no lineups to lock and no week to
 *  score; going live by the calendar would freeze its schedule and stamp
 *  0–0 finals before anyone had a team. */
export async function sportLeagues(sport) {
  const { data, error } = await db().from('league').select('id, sport, season, settings_json')
    .eq('sport', sport).eq('provider', 'native');
  if (error) throw new Error(`league read: ${error.message}`);
  const all = (data ?? []).map((l) => ({ ...l, sportSettings: sportSettingsOf(l.settings_json) })).filter((l) => l.sportSettings);
  if (!all.length) return all;
  const { data: drafts } = await db().from('draft').select('league_id, status').in('league_id', all.map((l) => l.id));
  const done = new Set((drafts ?? []).filter((d) => d.status === 'complete').map((d) => d.league_id));
  return all.filter((l) => done.has(l.id));
}

/** REPLAY (v0.626.0): the distinct shifted clocks among this sport's replay
 *  leagues, drafted or not — a league still drafting still wants its board's
 *  slate to fill. Each is {season, offsetDays}. */
export async function sportReplayClocks(sport) {
  const { data, error } = await db().from('league').select('id, season, settings_json')
    .eq('sport', sport).eq('provider', 'native');
  if (error) throw new Error(`league read: ${error.message}`);
  const seen = new Map();
  for (const l of data ?? []) {
    const r = sportSettingsOf(l.settings_json)?.replay;
    if (!r || !r.offset_days) continue;
    seen.set(`${r.season}|${r.offset_days}`, { season: r.season, offsetDays: r.offset_days });
  }
  return [...seen.values()];
}

/** The league's clock (v0.626.0): the real one, or its replay's. */
export const leagueNow = (lg, now = Date.now()) => now - (lg.sportSettings?.replay?.offset_days ?? 0) * 86400e3;

/** Slot 'S<i>' may hold a player whose eligibility meets roster_slots[i-1].pos.
 *  Unknown slot names and players allow — nothing here may lock a lineup
 *  the platform never shaped. */
export function slotAllowsFor(rosterSlots, eligibleOf) {
  const specs = Array.isArray(rosterSlots) ? rosterSlots : [];
  return (slot, slug) => {
    const m = /^S(\d+)$/.exec(String(slot ?? ''));
    const spec = m ? specs[Number(m[1]) - 1] : null;
    if (!spec || !Array.isArray(spec.pos) || !spec.pos.length) return true;
    const elig = eligibleOf(slug);
    if (!elig || !elig.length) return true;
    return elig.some((p) => spec.pos.includes(p));
  };
}

/** Lock the started games' players across every league of the sport.
 *  Returns the number of slot-days locked. */
export async function lockStartedGames(sport, games, now = Date.now(), offsetDays = 0) {
  const started = startedGames(games, now);
  if (!started.length) return 0;
  // The games are one clock's (real, or a replay's); only leagues on that
  // clock lock from them.
  const leagues = (await sportLeagues(sport)).filter((lg) => (lg.sportSettings.replay?.offset_days ?? 0) === offsetDays);
  let locked = 0;
  const teams = [...new Set(started.flatMap((g) => [g.home, g.away]))];
  const dates = [...new Set(started.map((g) => g.gameDate))];
  for (const lg of leagues) {
    // Four reads per league per pass, however many games started: the
    // weeks the started games fall in, their matchups, every 'wk' pick in
    // them, the pool rows on the started teams, and the locks already held.
    const weeks = [...new Set(dates.map((d) => sportWeekOf(d, lg.sportSettings.period_start)).filter((w) => w != null))];
    if (!weeks.length) continue;
    const { data: matchups } = await db().from('matchup').select('id, week, status, home_roster_id, away_roster_id')
      .eq('league_id', lg.id).in('week', weeks);
    if (!matchups?.length) continue;
    const ids = matchups.map((m) => m.id);
    const [{ data: picks }, { data: pool }, { data: existing }] = await Promise.all([
      db().from('sealed_pick').select('matchup_id, app_user_id, game_window, roster_slot, player_slug').in('matchup_id', ids).eq('game_window', 'wk'),
      // A 2000-player pool on a busy night can pass the 1000-row page (v0.627.3).
      allRows((from, to) => db().from('league_pool').select('slug, team, pos, eligible').eq('league_id', lg.id).in('team', teams).order('slug').range(from, to)).then((rows) => ({ data: rows })),
      db().from('sport_slot_lock').select('matchup_id, app_user_id, game_date, roster_slot, game_id').in('matchup_id', ids).in('game_date', dates),
    ]);
    const teamOf = new Map((pool ?? []).map((p) => [p.slug, p.team]));
    const eligOf = new Map((pool ?? []).map((p) => [p.slug, p.eligible?.length ? p.eligible : (p.pos ? [p.pos] : [])]));
    const have = new Set((existing ?? []).map((k) => `${k.matchup_id}|${k.app_user_id}|${k.game_date}|${k.roster_slot}|${k.game_id}`));
    const allows = slotAllowsFor(lg.settings_json?.roster_slots, (slug) => eligOf.get(slug));
    const rows = [];
    const toLive = new Set();
    for (const g of started) {
      const week = sportWeekOf(g.gameDate, lg.sportSettings.period_start);
      const weekIds = new Set(matchups.filter((m) => m.week === week).map((m) => m.id));
      if (!weekIds.size) continue;
      const mine = (picks ?? []).filter((p) => weekIds.has(p.matchup_id));
      for (const r of locksFor(g, mine, (slug) => teamOf.get(slug), have, allows)) { rows.push(r); have.add(`${r.matchup_id}|${r.app_user_id}|${r.game_date}|${r.roster_slot}|${r.game_id}`); }
      // The period is live once any of its games has started.
      for (const m of matchups) if (m.week === week && m.status === 'scheduled') toLive.add(JSON.stringify([m.id, g.startUtc ?? new Date(now).toISOString()]));
    }
    if (rows.length) {
      const { error } = await db().from('sport_slot_lock').upsert(rows, { onConflict: 'matchup_id,app_user_id,game_date,roster_slot,game_id', ignoreDuplicates: true });
      if (error) log(`${sport} lock: ${error.message}`);
      else locked += rows.length;
    }
    for (const j of toLive) {
      const [id, at] = JSON.parse(j);
      await db().from('matchup').update({ status: 'live', lock_at: at }).eq('id', id).eq('status', 'scheduled');
    }
  }
  return locked;
}

/** Resolve every live matchup in every league of the sport; finalize the
 *  ones whose period is over. Returns counts. */
export async function resolveSportLeagues(sport, now = new Date()) {
  const leagues = await sportLeagues(sport);
  const counts = { sport, matchups: 0, finals: 0 };
  if (!leagues.length) return counts;
  const def = SPORTS[sport];
  const { data: liveGames } = await db().from('sport_game').select('season, game_date').eq('sport', sport).eq('status', 'live');
  for (const lg of leagues) {
    // Each league on its own clock (v0.626.0): a replay's today is a past
    // date, and only its season's live games can hold its period open.
    const today = easternDate(new Date(leagueNow(lg, now.getTime())));
    const liveDates = (liveGames ?? []).filter((g) => g.season === lg.season).map((g) => g.game_date);
    const { data: matchups } = await db().from('matchup').select('id, week, status, home_roster_id, away_roster_id')
      .eq('league_id', lg.id).eq('status', 'live');
    for (const m of matchups ?? []) {
      const period = sportPeriod(m.week, lg.sportSettings.period_start);
      if (!period) continue;
      const { data: rows, error } = await db().rpc('sport_matchup_lines_svc', { p_matchup: m.id });
      if (error) { log(`${sport} ${m.id}: lines: ${error.message}`); continue; }
      const home = (rows ?? []).filter((r) => r.roster_id === m.home_roster_id);
      const away = (rows ?? []).filter((r) => r.roster_id === m.away_roster_id);
      const v = scoreMatchup(def, lg.sportSettings, home, away);
      await db().from('matchup_state').upsert({
        matchup_id: m.id, game_window: 'wk', home_score: v.homeScore, away_score: v.awayScore,
        slot_scores: v.slotScores, events_json: [], updated_at: new Date().toISOString(),
      }, { onConflict: 'matchup_id,game_window' });
      counts.matchups++;
      if (periodDone(period, today, liveDates)) {
        await db().from('matchup').update({ status: 'final', home_final: v.homeScore, away_final: v.awayScore }).eq('id', m.id);
        counts.finals++;
      }
    }
    // ROTO (0427): the season table, from every locked slot-day so far.
    if (lg.sportSettings.format === 'roto') {
      const [{ data: rows, error: rErr }, { data: seats }] = await Promise.all([
        db().rpc('sport_league_lines_svc', { p_league_id: lg.id }),
        db().from('league_membership').select('sleeper_roster_id').eq('league_id', lg.id),
      ]);
      if (rErr) log(`${sport} ${lg.id}: roto lines: ${rErr.message}`);
      else {
        const table = rotoTable(def, lg.sportSettings, rows ?? [], (seats ?? []).map((m) => m.sleeper_roster_id));
        const { error } = await db().from('sport_roto').upsert(table.map((t) => ({ ...t, league_id: lg.id, updated_at: new Date().toISOString() })), { onConflict: 'league_id,roster_id' });
        if (error) log(`${sport} ${lg.id}: roto: ${error.message}`);
        else counts.roto = (counts.roto ?? 0) + table.length;
      }
    }
    // A period whose first game was missed (worker down) still needs to go
    // live once its dates arrive, so its finals can be stamped.
    const wk = sportWeekOf(today, lg.sportSettings.period_start);
    if (wk != null) {
      await db().from('matchup').update({ status: 'live' }).eq('league_id', lg.id).eq('status', 'scheduled').lte('week', wk);
    }
  }
  return counts;
}
