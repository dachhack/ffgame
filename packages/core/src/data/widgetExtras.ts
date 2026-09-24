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
import { fieldsWeekFrom, slateWeekOrder } from './fieldsWeek';
import { LIVE_SEASON } from './realPbp';
import { normTeam, stripSlugTag } from './slugMeta';
import { projectedStarters } from '../engine/projectedBox';
import { withPprProjections } from '../engine/projScoring';
import { shortName } from './players';
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

/** A DRIP LINEUP AT A GLANCE (v0.509.0) — the app's league list. Founder:
 *  "Let's have projected totals in the leagues view or a report of slots you
 *  have set/unset for drip Leagues." Every slot of the week, counted by what
 *  it needs: `set` has a player and a metric (or is sealed / playing / done);
 *  `unset` is empty with someone on the roster who could fill it; `none` is
 *  empty with nobody who can; `noMetric` has a player but no metric; `missed`
 *  locked empty. `lockMs` is the next lock while anything is still open. */
export interface LineupReport { total: number; set: number; unset: number; none: number; noMetric: number; missed: number; lockMs: number | null;
  /** Of `set`, the slots a Ghost / Bye Steal holds (v0.520.0) — filled, and noted. */
  ghost: number }
export function lineupReport(snap: WidgetSnapshot): LineupReport | null {
  const cards = snap.cards ?? [];
  if (!snap.assessable || !cards.length || snap.projected) return null;
  const n = (st: WidgetCard['status'][]) => cards.filter((c) => st.includes(c.status)).length;
  return {
    total: cards.length,
    // A GHOSTED slot is filled (v0.520.0): it counts toward `set`, and the
    // line notes it rather than warning about it.
    set: n(['set', 'sealed', 'live', 'final', 'ghost']),
    unset: n(['empty']), none: n(['none']), noMetric: n(['unsealed']), missed: n(['missed']),
    ghost: n(['ghost']),
    lockMs: snap.alarm?.lockMs ?? null,
  };
}

/** The report as one line, in the words both league lists print (v0.510.0):
 *  "✓ 9/9 set", "✓ 9/9 set · 1 👻 ghost", or "⚠ 5/9 set · 2 unset · 1 no one available · 1 no metric ·
 *  locks Sun 1:00 PM". `open` says whether anything still needs a hand —
 *  the warn colour. */
export function lineupReportLine(r: LineupReport): { text: string; open: boolean } {
  const open = r.unset + r.none + r.noMetric > 0;
  const bits = [
    r.ghost ? `${r.ghost} 👻 ghost${r.ghost === 1 ? '' : 's'}` : null,
    r.unset ? `${r.unset} unset` : null,
    r.none ? `${r.none} no one available` : null,
    r.noMetric ? `${r.noMetric} no metric` : null,
    r.missed ? `${r.missed} missed` : null,
  ].filter(Boolean);
  const lock = open && r.lockMs != null
    ? ` · locks ${new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(r.lockMs))}`
    : '';
  return { text: `${open ? '⚠' : '✓'} ${r.set}/${r.total} set${bits.length ? ` · ${bits.join(' · ')}` : ''}${lock}`, open };
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

/** One of MY players in a game, from a league's remembered snapshot.
 *  `state` (v0.506.0) colours his number — projected grey, live, final blue —
 *  and `injury` tags him. */
export interface FieldMine { name: string; pts: number | null; proj: number | null; live: boolean; state?: 'pre' | 'live' | 'final'; injury?: string | null }

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
  // ── v0.508.0 ──
  /** Down and distance now — "2nd & 7" — ESPN's own when the worker sent it,
   *  else worked out from the last play. Live games only. */
  dd?: string | null;
  /** The ball's spot in ESPN's words ("BUF 34"), when the worker sent it. */
  spot?: string | null;
  /** The last few plays, newest first — what an opened game lists. */
  recent?: { clock: string; txt: string; big: 'score' | 'turnover' | null }[];
  /** Each team's passing / rushing / receiving leader. */
  leaders?: { team: string; cat: 'pass' | 'rush' | 'rec'; name: string; line: string }[];
  /** Before kickoff (v0.514.0): both teams' projected starters, slot by
   *  slot, in stock PPR. */
  projSheet?: ProjSlot[];
}

/** One man on a projected sheet. `pts` is null for a man the chart names
 *  and the projection does not value. */
export interface ProjCell { name: string; pts: number | null; injury: string | null }
/** One row of the pregame sheet: the slot, the away team's man and the home
 *  team's, side by side. A side with nobody for the slot has null. */
export interface ProjSlot { pos: string; away: ProjCell | null; home: ProjCell | null }

/** The sheet's rows, in the order the founder asked for: QB, RB, RB, WR,
 *  WR, WR, TE, K, DST — projectedStarters' own order, one lineup deep. */
const SHEET: [string, string][] = [['QB', 'QB'], ['RB', 'RB'], ['RB', 'RB'], ['WR', 'WR'], ['WR', 'WR'], ['WR', 'WR'], ['TE', 'TE'], ['K', 'K'], ['DEF', 'DST']];

/** "josh-allen" → "J. Allen", the way the live leaders read. A team unit
 *  (`kc-k`, `kc-dst`) reads as its team. */
const sheetName = (slug: string, team: string): string =>
  /-(k|dst)$/.test(slug) ? team
    : shortName(stripSlugTag(slug).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' '));

/** Both sides' projected starters before kickoff (v0.514.0), slot by slot:
 *  the same sheet the app's pregame box score lists, so an OUT or IR man is
 *  already off it. STOCK PPR, whatever league was read last — the widget
 *  speaks for no league. Empty when neither side can be projected. */
export function projectedSheet(away: string, home: string, week: number): ProjSlot[] {
  return withPprProjections(() => {
    const side = (team: string) => {
      const rows = projectedStarters(team, week);
      const used = new Set<string>();
      return SHEET.map(([pos]): ProjCell | null => {
        const r = rows.find((x) => x.pos === pos && !used.has(x.slug));
        if (!r) return null;
        used.add(r.slug);
        return { name: sheetName(r.slug, team), pts: r.proj != null ? Math.round(r.proj * 10) / 10 : null, injury: r.injury ?? null };
      });
    };
    const a = side(away), h = side(home);
    const slots = SHEET.map(([, label], i) => ({ pos: label, away: a[i], home: h[i] }));
    return slots.some((x) => x.away || x.home) ? slots : [];
  });
}

const ORD = ['', '1st', '2nd', '3rd', '4th'];
/** Down and distance after the last play, from the play itself — the fallback
 *  when the worker's status has no situation (an older row, the simulator).
 *  A change of possession, a kickoff or a first down is 1st & 10 (1st & Goal
 *  inside the ten); otherwise the next down with what is left to go. A score
 *  has no next snap to describe. */
export function nextDownFrom(p: GamePlay | null): string | null {
  if (!p || p.sc) return null;
  const toGo = Number(p.yl2);
  const firstAt = (yl: number) => (yl <= 10 ? '1st & Goal' : '1st & 10');
  if (p.tm2 && normTeam(p.tm2) !== normTeam(p.tm)) return firstAt(toGo);
  if (!p.dn) return firstAt(toGo);
  const gained = Number(p.yl) - toGo;
  const left = Number(p.dist) - gained;
  if (left <= 0) return firstAt(toGo);
  if (p.dn >= 4) return firstAt(100 - toGo);   // turned over on downs: theirs, from the other end
  return `${ORD[p.dn + 1]} & ${toGo <= left ? 'Goal' : left}`;
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
      const sit = g.feed?.status?.sit ?? null;
      const live = g.state === 'live';
      // The last three plays, newest first, for an opened game.
      const recent = [...(g.feed?.plays ?? [])]
        .filter((p) => p && Number.isFinite(Number(p.c)))
        .sort((a, b) => Number(b.c) - Number(a.c)).slice(0, 3)
        .map((p) => ({ clock: fmtQuarterClock(Number(p.c)), txt: p.txt, big: (p.sc ? 'score' : p.to ? 'turnover' : null) as FieldGame['big'] }));
      const turnedOver = !!last && ((last.dn >= 4 && !last.sc && Number(last.yl) - Number(last.yl2) < Number(last.dist)) || (!!last.tm2 && normTeam(last.tm2) !== normTeam(last.tm)));
      return {
        dd: live ? sit?.dd ?? nextDownFrom(last) : null,
        spot: live ? sit?.spot ?? null : null,
        recent: g.state === 'pre' ? [] : recent,
        leaders: g.feed?.status?.leaders ?? [],
        projSheet: g.state === 'pre' ? projectedSheet(g.away, g.home, week) : [],
        key: g.key, away: g.away, home: g.home, state: g.state,
        as: last ? Number(last.as) || 0 : 0, hs: last ? Number(last.hs) || 0 : 0,
        clock: clockOf(g, last), kickoff: g.kickoff,
        poss: live ? (sit?.poss ? normTeam(sit.poss) : turnedOver && last && !last.tm2 ? (normTeam(last.tm) === g.home ? g.away : g.home) : poss) : null,
        toGo: live ? (sit?.ytg != null ? sit.ytg : turnedOver && last && !last.tm2 && toGo != null ? 100 - toGo : toGo) : null,
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
 *  leagues is listed once.
 *
 *  ONLY THE WEEK ON SHOW (v0.506.0). Founder: "Looks like the all fields
 *  widget is showing week 2 and 'P' for projected points?" A snapshot is one
 *  league's CURRENT matchup week; laid over another week's games it starred
 *  this week's lineup on last week's box scores, projections and all. Now a
 *  snapshot counts only for its own week, and `leagueId` narrows it to the
 *  one league the manager picked (null = every league). */
export function minesByTeam(snaps: WidgetSnapshot[], opts: { week?: number | null; leagueId?: string | null } = {}): Map<string, FieldMine[]> {
  const out = new Map<string, FieldMine[]>();
  const seen = new Set<string>();
  for (const s of snaps) {
    if (opts.week != null && s.week !== opts.week) continue;
    if (opts.leagueId && s.leagueId !== opts.leagueId) continue;
    for (const c of (s.cards ?? []) as WidgetCard[]) {
      if (!c.slug || !c.team || seen.has(c.slug)) continue;
      seen.add(c.slug);
      const t = normTeam(c.team);
      const list = out.get(t) ?? [];
      const state = c.status === 'live' ? 'live' : c.status === 'final' ? 'final' : 'pre';
      list.push({ name: c.name, pts: c.points ?? null, proj: c.proj ?? null, live: state === 'live', state, injury: c.injury ?? null });
      out.set(t, list);
    }
  }
  return out;
}

/** The fields read: which week, its slate, and its game feeds installed
 *  where weekBoxGames reads them. The week is the current one (fieldsWeekFrom
 *  — it turns over Wednesday 3 AM ET) moved `offset` weeks along the slate's
 *  order by the widget's ‹ › (v0.506.0), clamped to the weeks the slate
 *  knows. Null when the slate knows no week. Throws on a failed read — the
 *  task keeps its last picture. */
export async function loadFieldsWeek(offset = 0, nowMs: number = Date.now()): Promise<{ week: number; current: number; hasPrev: boolean; hasNext: boolean } | null> {
  const rows = await slateWeeks(String(LIVE_SEASON));
  const current = fieldsWeekFrom(rows, nowMs);
  if (current == null) return null;
  const order = slateWeekOrder(rows);
  const at = Math.max(0, order.indexOf(current));
  const i = Math.max(0, Math.min(order.length - 1, at + offset));
  const week = order[i] ?? current;
  const [slate, feeds] = await Promise.all([liveSlate(week, String(LIVE_SEASON)), weekGameFeeds(week)]);
  setRuntimeSlate(week, slate.map((g) => ({ away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId, kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined })));
  setLiveGameFeed(week, feedRowsToWeek(feeds));
  return { week, current, hasPrev: i > 0, hasNext: i < order.length - 1 };
}
