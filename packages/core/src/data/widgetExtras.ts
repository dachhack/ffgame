// THE OTHER TWO HOME-SCREEN WIDGETS (v0.505.0) — what they say, as pure
// functions the check can pin, plus the one read the fields widget needs.
//
// Founder: "Can you also make a 1 by 1 widget that give you just line up
// warnings for all your selected leagues and a widget the same size as the
// current but with all fields view so you can track games and stats."
//
//   ALERTS (1×1) — every league the widget may show (Settings' picker), each
//     one's lineup warnings counted off the same snapshot the matchup widget
//     draws, summed into one number and the soonest lock among them.
//   FIELDS (4×2) — the app's ▦ All fields, as a list: every game this week,
//     live ones first, each with its score, clock, who has the ball and
//     where, the last play, and which of MY players are in it.
//
// Both read what the matchup widget's feed already reads (widgetFeed), and
// the fields read is the All fields sheet's (AllFieldsSheet.tsx) without the
// plays table: a widget shows the drive, not the box score.
import type { WidgetSnapshot, WidgetCard } from './widgetFeed';
import { liveSlate, slateWeeks, weekGameFeeds } from './liveApi';
import { setRuntimeSlate } from './nflSlate';
import { setLiveGameFeed, feedRowsToWeek, weekBoxGames, latestPlay, fmtQuarterClock, type WeekBoxGame, type GamePlay } from './gameFeed';
import { fieldsWeekFrom } from './fieldsWeek';
import { LIVE_SEASON } from './realPbp';
import { normTeam } from './slugMeta';
import type { WindowId } from '../types';

// ── ALERTS ──────────────────────────────────────────────────────────────────

/** One league's lineup warnings, in the words the 1×1 can afford. */
export interface LeagueAlert { leagueId: string; rosterId: number; name: string; n: number; lockMs: number | null }

/** How many things want fixing in one snapshot. A WARNING is something that
 *  costs points if left alone: an empty slot (fixable, or with nobody to put
 *  there), a drip pick with no metric, a starter ruled out or on bye. A bench
 *  UPGRADE (classic `swap`) is advice, not a warning, and is not counted. */
export function alertCount(snap: WidgetSnapshot): number {
  const cards = snap.cards ?? [];
  if (snap.projected) {
    // Classic: the fixes are per spot, one each.
    return snap.fixes.filter((f) => f.kind === 'empty' || f.kind === 'injury' || f.kind === 'bye').length;
  }
  // Drip: slots off the cards (one per slot, not per window), and the out/bye
  // starters off the fixes, which name them one at a time.
  const slots = cards.filter((c) => c.status === 'empty' || c.status === 'none' || c.status === 'unsealed').length;
  return slots + snap.fixes.filter((f) => f.kind === 'injury' || f.kind === 'bye').length;
}

export interface AlertsSummary {
  /** Warnings across every league. */
  total: number;
  /** The leagues that have any, most first. */
  leagues: LeagueAlert[];
  /** The soonest lock among the leagues with warnings — the deadline. */
  lockMs: number | null;
}
export function alertsSummary(snaps: WidgetSnapshot[]): AlertsSummary {
  const leagues: LeagueAlert[] = [];
  for (const s of snaps) {
    const n = alertCount(s);
    if (n > 0) leagues.push({ leagueId: s.leagueId, rosterId: s.rosterId, name: s.leagueName, n, lockMs: s.alarm?.lockMs ?? null });
  }
  leagues.sort((a, b) => b.n - a.n || (a.lockMs ?? Infinity) - (b.lockMs ?? Infinity));
  const locks = leagues.map((l) => l.lockMs).filter((x): x is number => x != null);
  return { total: leagues.reduce((n, l) => n + l.n, 0), leagues, lockMs: locks.length ? Math.min(...locks) : null };
}

// ── FIELDS ──────────────────────────────────────────────────────────────────

/** One of MY players in a game, from a league's remembered snapshot. */
export interface FieldMine { name: string; pts: number | null; proj: number | null; live: boolean }

export interface FieldGame {
  key: string;
  away: string;
  home: string;
  state: 'pre' | 'live' | 'final';
  as: number;
  hs: number;
  /** "Q3 2:35", "Halftime", "FINAL", or the kickoff ms for a game not started. */
  clock: string | null;
  kickoff: number | null;
  /** Who has the ball after the last play, and his yards to the end zone. */
  poss: string | null;
  toGo: number | null;
  /** The last play, as ESPN wrote it. */
  last: string | null;
  /** A scoring play or a turnover, so the row can flash it. */
  big: 'score' | 'turnover' | null;
  mine: FieldMine[];
}

/** "DEN 34" / "KC 20" / "50" — the ball's spot, from the team in possession
 *  and his yards to the end zone. */
export function spotLabel(poss: string, opp: string, toGo: number): string {
  if (toGo === 50) return '50';
  return toGo > 50 ? `${poss} ${100 - toGo}` : `${opp} ${toGo}`;
}

/** What the clock says: ESPN's own words while it has them (halftime, end of
 *  a quarter, the live clock), else the last play's position. */
function clockOf(g: WeekBoxGame, last: GamePlay | null): string | null {
  if (g.state === 'final') return 'FINAL';
  if (g.state === 'pre') return null;
  const st = g.feed?.status;
  if (st?.name === 'STATUS_HALFTIME') return 'Half';
  if (st?.short) return st.short;
  if (st?.detail) return st.detail;
  return last ? fmtQuarterClock(Number(last.c)) : 'LIVE';
}

/** The week's games as the widget lists them: live first (the ones to
 *  watch), then the ones to come in kickoff order, then the finals. `mine`
 *  maps a team to my players on it. */
export function fieldGames(week: number, mine: Map<string, FieldMine[]> = new Map()): FieldGame[] {
  const rank = { live: 0, pre: 1, final: 2 } as const;
  return weekBoxGames(week)
    .map((g): FieldGame => {
      const last = latestPlay(g.feed?.plays);
      const poss = last ? normTeam(last.tm2 ?? last.tm) : null;
      const toGo = last && Number.isFinite(Number(last.yl2)) ? Math.max(0, Math.min(100, Number(last.yl2))) : null;
      return {
        key: g.key, away: g.away, home: g.home, state: g.state,
        as: last ? Number(last.as) || 0 : 0, hs: last ? Number(last.hs) || 0 : 0,
        clock: clockOf(g, last), kickoff: g.kickoff,
        poss: g.state === 'live' ? poss : null, toGo: g.state === 'live' ? toGo : null,
        last: g.state === 'pre' ? null : last?.txt ?? null,
        big: last?.sc ? 'score' : last?.to ? 'turnover' : null,
        mine: [...(mine.get(g.away) ?? []), ...(mine.get(g.home) ?? [])],
      };
    })
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank[a.g.state] - rank[b.g.state]
      || (a.g.state === 'pre' ? (a.g.kickoff ?? Infinity) - (b.g.kickoff ?? Infinity) : 0) || a.i - b.i)
    .map(({ g }) => g);
}

/** My players by team, off the leagues' remembered snapshots — the cards the
 *  matchup widget already drew, so this costs no read. A player in two
 *  leagues is listed once. */
export function minesByTeam(snaps: WidgetSnapshot[]): Map<string, FieldMine[]> {
  const out = new Map<string, FieldMine[]>();
  const seen = new Set<string>();
  for (const s of snaps) {
    for (const c of (s.cards ?? []) as WidgetCard[]) {
      if (!c.slug || !c.team || seen.has(c.slug)) continue;
      seen.add(c.slug);
      const t = normTeam(c.team);
      const list = out.get(t) ?? [];
      list.push({ name: c.name, pts: c.points ?? null, proj: c.proj ?? null, live: c.status === 'live' });
      out.set(t, list);
    }
  }
  return out;
}

/** The fields read: which week (what's on now, or what just happened), its
 *  slate, and its game feeds installed where weekBoxGames reads them. Null
 *  when the slate knows no week. Throws on a failed read — the task keeps
 *  its last picture. */
export async function loadFieldsWeek(nowMs: number = Date.now()): Promise<number | null> {
  const rows = await slateWeeks(String(LIVE_SEASON));
  const week = fieldsWeekFrom(rows, nowMs);
  if (week == null) return null;
  const [slate, feeds] = await Promise.all([liveSlate(week, String(LIVE_SEASON)), weekGameFeeds(week)]);
  setRuntimeSlate(week, slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId, kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined })));
  setLiveGameFeed(week, feedRowsToWeek(feeds));
  return week;
}
