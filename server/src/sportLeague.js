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
//   BEST BALL (0436). A spot flagged `bb` has no sealed pick: every pass,
//   for each day of a live period up to today, the fill ranks the seat's
//   rostered players who played that day by their points under the league's
//   table and seats the most valuable legal arrangement (the NFL engine's
//   assignByValue — fill every spot you can, then maximize), one player one
//   spot, writing the result into sport_slot_lock in place of a manager's
//   lock. The night's fill is provisional (it moves as box scores land) and
//   the board shows it as it stands; a day older than yesterday is settled
//   and only filled where it was never filled (the worker was down).
//
// Pure functions first (tested in test/sports-league.mjs); the I/O at the
// bottom is thin.
import { db, allRows } from './supabase.js';
import { SPORTS } from '../../packages/core/src/sports/index.ts';
import { linePoints, normalizeScoring, categoryTotals, compareCategories, rotoStandings, sumLines } from '../../packages/core/src/sports/score.ts';
import { sportPeriod, sportWeekOf, sportSettingsOf, addDays } from '../../packages/core/src/sports/league.ts';
import { assignByValue } from '../../packages/core/src/engine/classic.ts';
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
 *  the platform never shaped. A SCOPED spot (0436) also wants the player's
 *  team among its `teams` and his tenure inside min_exp..max_exp; `metaOf`
 *  gives {team, exp} and, as on the NFL board, a scoped spot refuses a
 *  player whose team or tenure is unknown rather than guess. */
export function slotAllowsFor(rosterSlots, eligibleOf, metaOf = () => null) {
  const specs = Array.isArray(rosterSlots) ? rosterSlots : [];
  return (slot, slug) => {
    const m = /^S(\d+)$/.exec(String(slot ?? ''));
    const spec = m ? specs[Number(m[1]) - 1] : null;
    if (!spec || !Array.isArray(spec.pos) || !spec.pos.length) return true;
    const elig = eligibleOf(slug);
    if (elig && elig.length && !elig.some((p) => spec.pos.includes(p))) return false;
    const scoped = (Array.isArray(spec.teams) && spec.teams.length) || spec.min_exp != null || spec.max_exp != null;
    if (!scoped) return true;
    const meta = metaOf(slug) ?? {};
    if (Array.isArray(spec.teams) && spec.teams.length && !spec.teams.some((t) => String(t).toUpperCase() === String(meta.team ?? '').toUpperCase())) return false;
    if (spec.min_exp != null || spec.max_exp != null) {
      if (meta.exp == null) return false;
      if (spec.min_exp != null && meta.exp < spec.min_exp) return false;
      if (spec.max_exp != null && meta.exp > spec.max_exp) return false;
    }
    return true;
  };
}

/** The best-ball slot names of a spec: 'S<i>' for every spot flagged bb. */
export const bbSlotsOf = (rosterSlots) =>
  new Set((Array.isArray(rosterSlots) ? rosterSlots : []).flatMap((s, i) => (s?.bb ? [`S${i + 1}`] : [])));

/** A seat's best-ball candidates for one day from its day-lines rows (0436
 *  sport_league_day_lines_svc, filtered to the seat and the date): every
 *  player with a line he PLAYED in — a man on the bench in street clothes
 *  (played false) and a game yet to post are not candidates — valued at his
 *  points over the day's games (a doubleheader sums), minus the players
 *  `taken` elsewhere in the lineup that day. */
export function dayCandidates(def, scoring, rows, taken = new Set()) {
  const by = new Map();
  for (const r of rows) {
    if (!r.player_slug || taken.has(r.player_slug) || !r.line || r.played === false) continue;
    const c = by.get(r.player_slug) ?? { slug: r.player_slug, value: 0, games: [] };
    c.value = Math.round((c.value + linePoints(def, r.line, scoring)) * 100) / 100;
    if (!c.games.includes(r.game_id)) c.games.push(r.game_id);
    by.set(r.player_slug, c);
  }
  return [...by.values()].sort((a, b) => b.value - a.value || a.slug.localeCompare(b.slug));
}

/** Seat the candidates into the best-ball spots: the most valuable legal
 *  arrangement that fills every spot it can (assignByValue, the NFL fill's
 *  own matching), one player one spot. `bbSlots` are the slot names; `allows`
 *  is slotAllowsFor's. Returns lock rows, one per game the player had. */
export function bestBallFill(bbSlots, cands, allows) {
  const order = [...bbSlots];
  if (!order.length || !cands.length) return [];
  const w = order.map((slot) => cands.map((c) => (allows(slot, c.slug) ? c.value : -Infinity)));
  const held = assignByValue(order.length, cands.length, w);
  const out = [];
  held.forEach((ci, si) => {
    if (ci < 0) return;
    const c = cands[ci];
    for (const g of c.games) out.push({ roster_slot: order[si], player_slug: c.slug, game_id: g });
  });
  return out;
}

/** The season-points table (format 'season', 0436): every seat's total over
 *  its locked slot-days, written to sport_roto with no categories. Seats with
 *  no line yet still appear, at 0. */
export function seasonTable(def, settings, rows, rosterIds) {
  const scoring = normalizeScoring(def, settings?.scoring);
  const by = new Map(rosterIds.map((id) => [id, []]));
  for (const r of rows) {
    if (r.roster_id == null || !r.line) continue;
    if (!by.has(r.roster_id)) by.set(r.roster_id, []);
    by.get(r.roster_id).push(r.line);
  }
  return [...by.entries()].map(([id, lines]) => ({
    league_id: null, roster_id: Number(id),
    points: Math.round(lines.reduce((t, l) => t + linePoints(def, l, scoring), 0) * 100) / 100,
    totals: sumLines(lines), cats: {},
  })).sort((a, b) => b.points - a.points || a.roster_id - b.roster_id);
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
      allRows((from, to) => db().from('league_pool').select('slug, team, pos, eligible, exp').eq('league_id', lg.id).in('team', teams).order('slug').range(from, to)).then((rows) => ({ data: rows })),
      db().from('sport_slot_lock').select('matchup_id, app_user_id, game_date, roster_slot, game_id').in('matchup_id', ids).in('game_date', dates),
    ]);
    const teamOf = new Map((pool ?? []).map((p) => [p.slug, p.team]));
    const eligOf = new Map((pool ?? []).map((p) => [p.slug, p.eligible?.length ? p.eligible : (p.pos ? [p.pos] : [])]));
    const metaOf = new Map((pool ?? []).map((p) => [p.slug, { team: p.team, exp: p.exp ?? null }]));
    const have = new Set((existing ?? []).map((k) => `${k.matchup_id}|${k.app_user_id}|${k.game_date}|${k.roster_slot}|${k.game_id}`));
    const allows = slotAllowsFor(lg.settings_json?.roster_slots, (slug) => eligOf.get(slug), (slug) => metaOf.get(slug));
    // A best-ball spot has no pick to lock: the fill seats it (0436). A pick
    // left in one (the spot was flagged after it was set) is ignored.
    const bb = bbSlotsOf(lg.settings_json?.roster_slots);
    const rows = [];
    const toLive = new Set();
    for (const g of started) {
      const week = sportWeekOf(g.gameDate, lg.sportSettings.period_start);
      const weekIds = new Set(matchups.filter((m) => m.week === week).map((m) => m.id));
      if (!weekIds.size) continue;
      const mine = (picks ?? []).filter((p) => weekIds.has(p.matchup_id) && !bb.has(p.roster_slot));
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

/** Which days of the live periods the fill (re)computes: yesterday and
 *  today always (the night moves; yesterday's late game may still be
 *  posting), and any older day of a live period that was never filled. */
export function bbDaysFor(periods, today, filledDates = new Set()) {
  const out = new Set();
  for (const p of periods) {
    for (let d = p.from; d <= p.to && d <= today; d = addDays(d, 1)) {
      if (d >= addDays(today, -1) || !filledDates.has(d)) out.add(d);
    }
  }
  return [...out].sort();
}

/** BEST BALL (0436), one league: for each live matchup, each seat and each
 *  day to fill, seat the day's candidates into the best-ball spots and write
 *  the locks — only when they differ from what is held. Returns the number
 *  of seat-days written. */
export async function fillBestBall(lg, def, matchups, today) {
  const specs = lg.settings_json?.roster_slots;
  const bb = bbSlotsOf(specs);
  if (!bb.size) return 0;
  const periods = matchups.map((m) => ({ m, period: sportPeriod(m.week, lg.sportSettings.period_start) })).filter((x) => x.period);
  if (!periods.length) return 0;
  const from = periods.map((x) => x.period.from).sort()[0];
  const to = periods.map((x) => x.period.to).sort().reverse()[0];
  const upTo = to < today ? to : today;
  if (from > upTo) return 0;
  const scoring = normalizeScoring(def, lg.sportSettings?.scoring);
  const ids = matchups.map((m) => m.id);
  const [{ data: days, error }, { data: locks }, { data: picks }] = await Promise.all([
    db().rpc('sport_league_day_lines_svc', { p_league_id: lg.id, p_from: from, p_to: upTo }),
    db().from('sport_slot_lock').select('matchup_id, app_user_id, game_date, roster_slot, player_slug, game_id').in('matchup_id', ids).gte('game_date', from).lte('game_date', upTo),
    db().from('sealed_pick').select('matchup_id, app_user_id, roster_slot, player_slug').in('matchup_id', ids).eq('game_window', 'wk'),
  ]);
  if (error) throw new Error(`day lines: ${error.message}`);
  const eligOf = new Map(), metaOf = new Map();
  for (const r of days ?? []) { eligOf.set(r.player_slug, r.eligible ?? []); metaOf.set(r.player_slug, { team: r.team, exp: r.exp ?? null }); }
  const allows = slotAllowsFor(specs, (slug) => eligOf.get(slug), (slug) => metaOf.get(slug));
  let written = 0;
  for (const { m, period } of periods) {
    for (const [rid, uid] of [[m.home_roster_id, null], [m.away_roster_id, null]]) {
      // The seat's manager comes off the day rows (the RPC resolves it); a
      // seat nobody has claimed has nothing to lock under.
      const seatRows = (days ?? []).filter((r) => r.roster_id === rid);
      const user = uid ?? seatRows.find((r) => r.app_user_id)?.app_user_id ?? null;
      if (!user) continue;
      const held = (locks ?? []).filter((k) => k.matchup_id === m.id && k.app_user_id === user);
      const filled = new Set(held.filter((k) => bb.has(k.roster_slot)).map((k) => k.game_date));
      const manualPicked = new Set((picks ?? []).filter((p) => p.matchup_id === m.id && p.app_user_id === user && !bb.has(p.roster_slot) && p.player_slug).map((p) => p.player_slug));
      for (const date of bbDaysFor([period], today, filled)) {
        // One player, one spot a day: a man a manager started (or who locked
        // in a manual spot today) is not the fill's to take.
        const taken = new Set([...manualPicked, ...held.filter((k) => k.game_date === date && !bb.has(k.roster_slot)).map((k) => k.player_slug)]);
        const cands = dayCandidates(def, scoring, seatRows.filter((r) => r.game_date === date), taken);
        const rows = bestBallFill(bb, cands, allows);
        const want = rows.map((r) => `${r.roster_slot}|${r.player_slug}|${r.game_id}`).sort().join(';');
        const have = held.filter((k) => k.game_date === date && bb.has(k.roster_slot)).map((k) => `${k.roster_slot}|${k.player_slug}|${k.game_id}`).sort().join(';');
        if (want === have) continue;
        const { error: wErr } = await db().rpc('sport_bb_write_svc', { p_matchup: m.id, p_user: user, p_date: date, p_slots: [...bb], p_rows: rows });
        if (wErr) { log(`${lg.sport} ${m.id} ${date}: best ball write: ${wErr.message}`); continue; }
        written++;
      }
    }
  }
  return written;
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
    // BEST BALL (0436): seat the fills before the lines are read.
    if (bbSlotsOf(lg.settings_json?.roster_slots).size && matchups?.length) {
      try { counts.filled = (counts.filled ?? 0) + await fillBestBall(lg, def, matchups, today); }
      catch (e) { log(`${sport} ${lg.id}: best ball: ${e.message}`); }
    }
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
    // ROTO (0427) and SEASON POINTS (0436): the season table, from every
    // locked slot-day so far.
    if (lg.sportSettings.format === 'roto' || lg.sportSettings.format === 'season') {
      const [{ data: rows, error: rErr }, { data: seats }] = await Promise.all([
        db().rpc('sport_league_lines_svc', { p_league_id: lg.id }),
        db().from('league_membership').select('sleeper_roster_id').eq('league_id', lg.id),
      ]);
      if (rErr) log(`${sport} ${lg.id}: ${lg.sportSettings.format} lines: ${rErr.message}`);
      else {
        const ids = (seats ?? []).map((m) => m.sleeper_roster_id);
        const table = lg.sportSettings.format === 'season' ? seasonTable(def, lg.sportSettings, rows ?? [], ids) : rotoTable(def, lg.sportSettings, rows ?? [], ids);
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
