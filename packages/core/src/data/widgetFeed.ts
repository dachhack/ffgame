// THE HOME-SCREEN WIDGET'S FEED (v0.421.0) — one matchup, summarised.
//
// Founder: "Let's do the Android live matchup widget."
//
// A widget is a picture the app repaints: it cannot subscribe, cannot tick a
// clock, and on Android it is repainted by a headless JS task with no screen
// behind it. So what it needs from core is ONE call that answers, for a seat,
// "who am I playing, what's the score, and what state is the week in" — and a
// PURE function that turns those rows into the three lines the picture shows,
// so the parity check can pin the words without a network.
//
// The rows come from the same reads every board uses (myEnrollments, the
// matchup row, matchup_state, the slate) — nothing new server-side, and the
// worker's silent push (kind 'widget') only says "repaint", never carries a
// score, so a stale push can never draw a stale number.

import { myEnrollments, myMatchupFrom, getMatchupState, matchupTeams, defaultOpenWeek, liveSlate, type Enrollment, type LiveMatchup, type WindowScore } from './liveApi';
import { windowsForWeek, windowPhase, windowLockMs, windowDateLabel, windowTimeLabel, weekLabel, setRuntimeSlate } from './nflSlate';
import type { WindowId } from '../types';

export type WidgetPhase = 'pre' | 'live' | 'final' | 'bye';

export interface WidgetSnapshot {
  leagueId: string;
  leagueName: string;
  rosterId: number;
  week: number;
  /** "WEEK 3", or the preseason label the slate gives. */
  weekLabel: string;
  me: { name: string; score: number };
  /** Null on a bye. */
  them: { name: string; score: number } | null;
  phase: WidgetPhase;
  /** The state line: "LIVE · SUN 1PM", "Locks Sun, Sep 21 1:00 PM", "FINAL · W". */
  line: string;
  /** ms since epoch, when this picture was drawn. */
  at: number;
}

/** A league the widget can show — the seats you hold, minus what a home
 *  screen has no business showing (mocks, archived, commissioner-only). */
export interface WidgetLeague { id: string; name: string; rosterId: number }

export function widgetLeagues(enr: Enrollment[]): WidgetLeague[] {
  return enr
    .filter((e) => !e.archived && !e.league?.is_mock && e.sleeper_roster_id != null)
    .map((e) => ({ id: e.league_id, name: e.league?.name ?? 'League', rosterId: e.sleeper_roster_id }));
}

/** Which league a widget shows: the stored choice when it is still one you're
 *  in, else the first. A widget that outlived its league falls forward rather
 *  than drawing a hole. */
export function pickWidgetLeague(leagues: WidgetLeague[], wantId: string | null | undefined): WidgetLeague | null {
  if (!leagues.length) return null;
  return leagues.find((l) => l.id === wantId) ?? leagues[0];
}

/** The league after this one, wrapping — the ▸ tap on the widget. */
export function nextWidgetLeague(leagues: WidgetLeague[], currentId: string | null | undefined): WidgetLeague | null {
  if (!leagues.length) return null;
  const i = leagues.findIndex((l) => l.id === currentId);
  return leagues[(i + 1) % leagues.length];
}

// The nudge: 3.9 + 41.05 is 44.949999999999996 in floating point, and a widget
// that prints 44.9 under a board that prints 45.0 is a bug report. A tenth of
// a millionth of a point is below anything the engine scores.
const round1 = (n: number) => Math.round(n * 10 + 1e-7) / 10;

/** The PURE half: rows in, the picture's words out. `nowMs` is a parameter
 *  so the check can stand at any moment of a week. */
export function summarize(input: {
  league: WidgetLeague;
  week: number;
  matchup: LiveMatchup | null;
  state: WindowScore[];
  teams: Record<number, { team_name: string | null }>;
  nowMs: number;
}): WidgetSnapshot {
  const { league, week, matchup, state, teams, nowMs } = input;
  const wl = weekLabel(week);
  const base = { leagueId: league.id, leagueName: league.name, rosterId: league.rosterId, week, weekLabel: wl, at: nowMs };
  const myName = teams[league.rosterId]?.team_name || 'Your team';
  if (!matchup) {
    return { ...base, me: { name: myName, score: 0 }, them: null, phase: 'bye', line: `BYE · ${wl}` };
  }
  const home = matchup.home_roster_id === league.rosterId;
  const oppId = home ? matchup.away_roster_id : matchup.home_roster_id;
  const oppName = teams[oppId]?.team_name || 'Opponent';
  let mine = 0, theirs = 0;
  for (const w of state) {
    mine += home ? Number(w.home_score) || 0 : Number(w.away_score) || 0;
    theirs += home ? Number(w.away_score) || 0 : Number(w.home_score) || 0;
  }
  const me = { name: myName, score: round1(mine) };
  const them = { name: oppName, score: round1(theirs) };

  const wins = windowsForWeek(week);
  const final = matchup.status === 'final';
  if (final) {
    const r = me.score > them.score ? 'W' : me.score < them.score ? 'L' : 'T';
    return { ...base, me, them, phase: 'final', line: `FINAL · ${r} ${me.score}–${them.score}` };
  }
  const live = wins.find((w) => windowPhase(week, w.id as WindowId, nowMs) === 'live');
  if (live) return { ...base, me, them, phase: 'live', line: `LIVE · ${live.label}` };
  // Pre-kickoff: the next window still to lock. After the last window is
  // final but the matchup row isn't yet, say so rather than promising a lock.
  const next = wins.find((w) => { const l = windowLockMs(week, w.id as WindowId); return l != null && l > nowMs; });
  if (next) {
    const locked = wins.some((w) => windowPhase(week, w.id as WindowId, nowMs) !== 'setup');
    const when = `${windowDateLabel(week, next.id as WindowId)} ${windowTimeLabel(week, next.id as WindowId)}`;
    return { ...base, me, them, phase: locked ? 'live' : 'pre', line: locked ? `${next.label} locks ${when}` : `Locks ${when}` };
  }
  return { ...base, me, them, phase: 'live', line: 'Settling…' };
}

/** The whole feed for one widget: the leagues it could show, and the picture
 *  for the one it does. Null snapshot with an empty list means "signed in,
 *  no seats"; the caller decides what a signed-OUT widget says. */
export async function widgetSnapshot(wantLeagueId?: string | null): Promise<{ leagues: WidgetLeague[]; snapshot: WidgetSnapshot | null }> {
  const leagues = widgetLeagues(await myEnrollments(''));
  const league = pickWidgetLeague(leagues, wantLeagueId);
  if (!league) return { leagues, snapshot: null };
  const openWeek = await defaultOpenWeek(league.id);
  const matchup = await myMatchupFrom(league.id, league.rosterId, openWeek);
  const week = matchup?.week ?? openWeek;
  const [state, teams, slate] = await Promise.all([
    matchup ? getMatchupState(matchup.id) : Promise.resolve([] as WindowScore[]),
    matchupTeams(league.id, matchup ? [matchup.home_roster_id, matchup.away_roster_id] : [league.rosterId]),
    liveSlate(week).catch(() => []),
  ]);
  // The baked slate has no kickoff clocks; the headless task starts from a
  // cold module, so the week's real kickoffs are installed here exactly as
  // the boards and the lineup alarm install them. Without this every window
  // reads as never-kicking and the card would say "Settling…" all Sunday.
  if (slate.length) {
    setRuntimeSlate(week, slate.map((g) => ({
      away: g.away, home: g.home, aScore: 0, hScore: 0, win: g.win as WindowId,
      kickoff: g.kickoff ? Date.parse(g.kickoff) : undefined,
    })));
  }
  return { leagues, snapshot: summarize({ league, week, matchup, state, teams, nowMs: Date.now() }) };
}
