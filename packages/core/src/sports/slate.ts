// A SPORT LEAGUE'S SLATE ON THE BOARD (v0.625.0). The classic board used to
// read every row's game off the NFL week slate, so a hockey league's rows all
// said "no game listed" under a chip called COLLEGE SLATE (the week was over
// 200). A daily sport's games come from sport_game over the period; a row
// shows TODAY's game for the player's team, or the team's next game in the
// period when there is none today.
import type { SportVocab } from './types';

export interface SportSlateGame {
  game_id: string; game_date: string; start_utc: string | null; status: string;
  away: string; home: string; away_score: number | null; home_score: number | null; clock: string | null;
}

export interface SportBoardGame {
  gameId: string; date: string; today: boolean; home: boolean; opponent: string;
  /** ISO start, when the feed had one */
  kickoff: string | null;
  status: 'pre' | 'live' | 'final' | 'postponed' | 'cancelled';
  awayScore: number | null; homeScore: number | null; clock: string | null;
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Today's date in the league's clock — the sports run on Eastern dates,
 *  the way the feeds and the worker stamp them. */
export function sportToday(now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

const normStatus = (s: string): SportBoardGame['status'] =>
  s === 'live' || s === 'final' || s === 'postponed' || s === 'cancelled' ? s : 'pre';

/** The game a team plays today, else its next game in `games` on or after
 *  today, else null. `games` is the period's rows from sport_league_games. */
export function sportGameFor(team: string | null | undefined, games: SportSlateGame[], today: string): SportBoardGame | null {
  if (!team) return null;
  const t = team.toUpperCase();
  let pick: SportSlateGame | null = null;
  for (const g of games) {
    if (g.home !== t && g.away !== t) continue;
    if (g.status === 'postponed' || g.status === 'cancelled') continue;
    if (g.game_date === today) {
      // Two games on one day (an MLB doubleheader): the one not yet final
      // is the one the board should talk about.
      if (!pick || pick.game_date !== today || (pick.status === 'final' && g.status !== 'final')) pick = g;
      continue;
    }
    if (g.game_date > today && (!pick || pick.game_date !== today) && (!pick || g.game_date < pick.game_date)) pick = g;
  }
  if (!pick) return null;
  const home = pick.home === t;
  return {
    gameId: pick.game_id, date: pick.game_date, today: pick.game_date === today, home,
    opponent: home ? pick.away : pick.home, kickoff: pick.start_utc, status: normStatus(pick.status),
    awayScore: pick.away_score, homeScore: pick.home_score, clock: pick.clock,
  };
}

/** pre / live / done for a board row, from the feed's status first and the
 *  clock second (a 'pre' game whose start has passed is under way for the
 *  lock, so the row says so even before the next poll lands). */
export function sportEntryState(g: SportBoardGame | null, now: number): 'pre' | 'live' | 'done' {
  if (!g || !g.today) return 'pre';
  if (g.status === 'final') return 'done';
  if (g.status === 'live') return 'live';
  if (g.kickoff && Date.parse(g.kickoff) <= now) return 'live';
  return 'pre';
}

/** "7:30p" for today's game, "Tue 7:30p" for a later one in the period. */
export function sportKickLabel(g: SportBoardGame | null): string | null {
  if (!g) return null;
  const time = g.kickoff
    ? new Date(g.kickoff).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })
        .replace(' AM', 'a').replace(' PM', 'p').replace(':00', '')
    : null;
  if (g.today) return time;
  const d = new Date(`${g.date}T12:00:00Z`);
  return `${WEEKDAY[d.getUTCDay()]}${time ? ` ${time}` : ''}`;
}

/** "vs BOS" / "@ BOS". */
export const sportOpponentLabel = (g: SportBoardGame | null): string | null =>
  g ? `${g.home ? 'vs' : '@'} ${g.opponent}` : null;

/** The sentence the board's "open lineups" strip and empty spots use. */
export const lockLine = (v: SportVocab): string => `open lineups · each spot locks at its own ${v.start}`;
