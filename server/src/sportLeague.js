// SPORT LEAGUES ON THE WORKER (phase 3, v0.565.0) — locking and resolving.
//
// Two jobs, both run from the sports loop (index.js) after each poll:
//
//   LOCK. When a game starts, every seat in every league of that sport whose
//   period covers today has its starting slots holding players on the two
//   teams snapshotted into sport_slot_lock for the day. The DB trigger
//   (0398 enforce_sport_pick_lock) has refused edits to those players since
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
import { db } from './supabase.js';
import { SPORTS } from '../../packages/core/src/sports/index.ts';
import { linePoints, normalizeScoring, categoryTotals, compareCategories, rotoStandings } from '../../packages/core/src/sports/score.ts';
import { sportPeriod, sportWeekOf, sportSettingsOf } from '../../packages/core/src/sports/league.ts';
import { easternDate } from './poll/sportGames.js';

const log = (...a) => console.log('[sport-league]', ...a);

/** Games that have started: live, final, or past their start time. */
export const startedGames = (games, now = Date.now()) =>
  games.filter((g) => g.status === 'live' || g.status === 'final' || (g.startUtc && Date.parse(g.startUtc) <= now));

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
    const key = `${p.matchup_id}|${p.app_user_id}|${game.gameDate}|${p.roster_slot}`;
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

/** ROTO (0399): every seat's season totals → the ranking. `rows` are
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

/** Is the period over, with nothing left to count? */
export const periodDone = (period, today, liveGameDates) =>
  today > period.to && !liveGameDates.some((d) => d <= period.to);

// ── I/O ──────────────────────────────────────────────────────────────────────

/** Native leagues in this sport, with their sport settings. */
export async function sportLeagues(sport) {
  const { data, error } = await db().from('league').select('id, sport, season, settings_json')
    .eq('sport', sport).eq('provider', 'native');
  if (error) throw new Error(`league read: ${error.message}`);
  return (data ?? []).map((l) => ({ ...l, sportSettings: sportSettingsOf(l.settings_json) })).filter((l) => l.sportSettings);
}

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
export async function lockStartedGames(sport, games, now = Date.now()) {
  const started = startedGames(games, now);
  if (!started.length) return 0;
  const leagues = await sportLeagues(sport);
  let locked = 0;
  for (const lg of leagues) {
    for (const g of started) {
      const week = sportWeekOf(g.gameDate, lg.sportSettings.period_start);
      if (week == null) continue;
      const { data: matchups } = await db().from('matchup').select('id, status, home_roster_id, away_roster_id')
        .eq('league_id', lg.id).eq('week', week);
      if (!matchups?.length) continue;
      const ids = matchups.map((m) => m.id);
      const [{ data: picks }, { data: pool }, { data: existing }] = await Promise.all([
        db().from('sealed_pick').select('matchup_id, app_user_id, game_window, roster_slot, player_slug').in('matchup_id', ids).eq('game_window', 'wk'),
        db().from('league_pool').select('slug, team, pos, eligible').eq('league_id', lg.id).in('team', [g.home, g.away]),
        db().from('sport_slot_lock').select('matchup_id, app_user_id, game_date, roster_slot').in('matchup_id', ids).eq('game_date', g.gameDate),
      ]);
      const teamOf = new Map((pool ?? []).map((p) => [p.slug, p.team]));
      const eligOf = new Map((pool ?? []).map((p) => [p.slug, p.eligible?.length ? p.eligible : (p.pos ? [p.pos] : [])]));
      const have = new Set((existing ?? []).map((k) => `${k.matchup_id}|${k.app_user_id}|${k.game_date}|${k.roster_slot}`));
      const rows = locksFor(g, picks ?? [], (slug) => teamOf.get(slug), have, slotAllowsFor(lg.settings_json?.roster_slots, (slug) => eligOf.get(slug)));
      if (rows.length) {
        const { error } = await db().from('sport_slot_lock').upsert(rows, { onConflict: 'matchup_id,app_user_id,game_date,roster_slot', ignoreDuplicates: true });
        if (error) log(`${sport} lock ${g.gameId}: ${error.message}`);
        else locked += rows.length;
      }
      // The period is live once any of its games has started.
      const toLive = matchups.filter((m) => m.status === 'scheduled').map((m) => m.id);
      if (toLive.length) await db().from('matchup').update({ status: 'live', lock_at: g.startUtc ?? new Date(now).toISOString() }).in('id', toLive).eq('status', 'scheduled');
    }
  }
  return locked;
}

/** Resolve every live matchup in every league of the sport; finalize the
 *  ones whose period is over. Returns counts. */
export async function resolveSportLeagues(sport, now = new Date()) {
  const today = easternDate(now);
  const leagues = await sportLeagues(sport);
  const counts = { sport, matchups: 0, finals: 0 };
  if (!leagues.length) return counts;
  const def = SPORTS[sport];
  const { data: liveGames } = await db().from('sport_game').select('game_date').eq('sport', sport).eq('status', 'live');
  const liveDates = (liveGames ?? []).map((g) => g.game_date);
  for (const lg of leagues) {
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
    // ROTO (0399): the season table, from every locked slot-day so far.
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
