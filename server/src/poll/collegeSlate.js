// THE COLLEGE SLATE (0371) — every FBS game of the college regular season,
// written into nfl_slate at board week 200 + N.
//
// A college-calendar league's schedule is laid from these rows the moment an
// admin switches the league over (native_generate_schedule reads lock_at from
// them), so the whole season is written ahead, daily, whether or not any league
// uses it yet: fifteen scoreboard requests a day. Kickoff times move (TV picks
// are set a week or two out), which is why it is refreshed rather than seeded.
import { db } from '../supabase.js';
import { getGames, slateFromGames } from './scoreboard.js';

export const COLLEGE_BASE = 200;
export const COLLEGE_WEEKS = 15;
// BOWLS (0375): ESPN files every bowl and CFP game under ONE postseason week,
// so bowl weeks are calendar weeks — Eastern Tuesday to Monday — counted from
// the one holding the first bowl, at board weeks 216.. (BOWL 1, 2, …).
export const BOWL_BASE = 215;
export const BOWL_LAST = 223;
const DAY = 86400000;
const EVERY_MS = Number(process.env.COLLEGE_SLATE_MS || 86400000);

/** Slate rows for one college week, at its board week. Pure. */
export function collegeSlateRows(season, espnWeek, games) {
  return slateFromGames(games).map((g) => ({
    season: String(season), week: COLLEGE_BASE + espnWeek, home: g.home, away: g.away,
    win: g.win, kickoff: g.kickoff, game_id: g.gameId ?? null,
  }));
}

// Midnight Eastern on the Tuesday that starts the week holding `ms`. Bowl
// season (Dec–Jan) crosses no DST change, so day arithmetic is exact there.
export function etTuesdayStart(ms) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false })
    .formatToParts(new Date(ms));
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const sinceMidnight = ((Number(get('hour')) % 24) * 60 + Number(get('minute'))) * 60 + Number(get('second'));
  const midnight = ms - sinceMidnight * 1000 - (ms % 1000);
  return midnight - ((dow - 2 + 7) % 7) * DAY;
}

/** A bowl's board week: 216 for the week of the first bowl, and so on. Null
 *  past BOWL_LAST. */
export function bowlBoardWeek(kickMs, firstKickMs) {
  const n = Math.round((etTuesdayStart(kickMs) - etTuesdayStart(firstKickMs)) / (7 * DAY)) + 1;
  const w = BOWL_BASE + n;
  return n >= 1 && w <= BOWL_LAST ? w : null;
}

/** Bowl games with their board weeks. Only real matchups by default (both
 *  teams known — bowls are set in December, the later CFP rounds later
 *  still); `withTbd` keeps the rest too, for the slate's calendar. */
export const isTbd = (g) => !g.home || !g.away || g.home === 'TBD' || g.away === 'TBD';
export function bowlSchedule(games, { withTbd = false } = {}) {
  const real = (games ?? []).filter((g) => (withTbd || !isTbd(g)) && Number.isFinite(g.kickoffMs));
  if (!real.length) return [];
  const first = Math.min(...(games ?? []).map((g) => g.kickoffMs).filter(Number.isFinite));
  return real.map((g) => ({ ...g, boardWeek: bowlBoardWeek(g.kickoffMs, first) })).filter((g) => g.boardWeek != null);
}

/** Slate rows for bowl season (0375). A game whose teams aren't set yet is
 *  written under a placeholder home code, TBD-<eventId>, which can never match
 *  a school — so the bowl weeks and their kickoffs are known in September,
 *  when a commissioner sets the playoffs, and no player is placed in them. */
export function bowlSlateRows(season, games) {
  const rows = [];
  for (const g of bowlSchedule(games, { withTbd: true })) {
    const [r] = slateFromGames([{ ...g, home: isTbd(g) ? `TBD-${g.eventId}` : g.home, away: isTbd(g) ? 'TBD' : g.away }]);
    if (r) rows.push({ season: String(season), week: g.boardWeek, home: r.home, away: r.away, win: r.win, kickoff: r.kickoff, game_id: r.gameId ?? null });
  }
  return rows;
}

let last = 0;
export async function sweepCollegeSlate(season, log = () => {}, fetchGames = getGames) {
  if (Date.now() - last < EVERY_MS) return { weeks: 0, rows: 0 };
  last = Date.now();
  let weeks = 0, rows = 0;
  for (let w = 1; w <= COLLEGE_WEEKS; w++) {
    try {
      const games = await fetchGames(season, w, 2, 0, 'college');
      const batch = collegeSlateRows(season, w, games);
      if (!batch.length) continue;
      const { error } = await db().from('nfl_slate').upsert(batch, { onConflict: 'season,week,home' });
      if (error) { log('college slate', w, error.message); continue; }
      weeks++; rows += batch.length;
    } catch (e) { log('college slate', w, e.message); }
  }
  // Bowl weeks (0375), from ESPN's single postseason week.
  try {
    const batch = bowlSlateRows(season, await fetchGames(season, 1, 3, 0, 'college'));
    if (batch.length) {
      // The whole bowl calendar is rewritten each day (≈47 rows): a bowl that
      // moved, or a TBD placeholder whose teams are now set, leaves nothing
      // behind in its old row.
      const { error: delErr } = await db().from('nfl_slate').delete().eq('season', String(season)).gte('week', BOWL_BASE + 1).lte('week', BOWL_LAST);
      if (delErr) throw new Error(delErr.message);
      const { error } = await db().from('nfl_slate').upsert(batch, { onConflict: 'season,week,home' });
      if (error) log('college slate bowls', error.message);
      else { weeks += new Set(batch.map((r) => r.week)).size; rows += batch.length; }
    }
  } catch (e) { log('college slate bowls', e.message); }
  return { weeks, rows };
}
