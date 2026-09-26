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
const EVERY_MS = Number(process.env.COLLEGE_SLATE_MS || 86400000);

/** Slate rows for one college week, at its board week. Pure. */
export function collegeSlateRows(season, espnWeek, games) {
  return slateFromGames(games).map((g) => ({
    season: String(season), week: COLLEGE_BASE + espnWeek, home: g.home, away: g.away,
    win: g.win, kickoff: g.kickoff, game_id: g.gameId ?? null,
  }));
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
  return { weeks, rows };
}
