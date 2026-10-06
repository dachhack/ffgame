// THE LIVE GAME LOG (v0.641.0). Founder: "Game logs on the player cards?"
//
// The card's log read the baked 2025 season (v0.285.0): the right source
// while the app was playtested on last year's games, the wrong one from the
// first 2026 kickoff — the web card has been showing a 2026 league last
// year's weeks, and the app dropped the tab with the bake (v0.502.0). The
// season itself is in live_play: every broadcast play, by week and player,
// the same rows the board scores from. This reads one player's season out
// of it and hands buildGameLog the game each week's plays came from, so the
// opponent is the game's own.
//
// Both hosts call this and nothing else, so the two cards cannot disagree
// about a week.
import { playerLivePlays, gameFeedTeams } from './liveApi';
import { liveRowsToPbp, type RealPlay } from './realPbp';
import type { LogGame } from './gameLog';

export interface LiveSeasonLog {
  /** week → his plays that week. Weeks with no plays are absent. */
  weeks: Record<number, RealPlay[]>;
  /** week → the game those plays came from, where the feed knows it. */
  games: Record<number, LogGame | undefined>;
}

/** Group a player's live rows by week, and name each week's game. Pure. */
export function groupSeasonRows<R extends { week: number; game_id?: string | null }>(
  rows: R[],
  teams: Record<string, { away: string; home: string }>,
): { byWeek: Record<number, R[]>; games: Record<number, LogGame | undefined> } {
  const byWeek: Record<number, R[]> = {};
  const games: Record<number, LogGame | undefined> = {};
  for (const r of rows) {
    if (!Number.isFinite(r.week)) continue;
    (byWeek[r.week] ||= []).push(r);
    const g = r.game_id ? teams[r.game_id] : undefined;
    if (g && !games[r.week]) games[r.week] = { away: g.away, home: g.home };
  }
  return { byWeek, games };
}

export async function liveSeasonLog(slug: string): Promise<LiveSeasonLog> {
  const rows = await playerLivePlays(slug);
  const teams = await gameFeedTeams(rows.map((r) => r.game_id ?? '')).catch(() => ({}));
  const { byWeek, games } = groupSeasonRows(rows, teams);
  const weeks: Record<number, RealPlay[]> = {};
  for (const [w, list] of Object.entries(byWeek)) {
    // liveRowsToPbp is the board's own row → RealPlay step, so a log decodes
    // a play exactly as the matchup that scored it did.
    const plays = liveRowsToPbp(list)[slug] ?? [];
    if (plays.length) weeks[Number(w)] = plays;
  }
  return { weeks, games };
}
