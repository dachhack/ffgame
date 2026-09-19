// THE HOME-SCREEN WIDGET'S FEED (v0.421.0, v0.422.0) — one matchup, summarised.
//
// Founder: "Let's do the Android live matchup widget." Then: "We can include
// a lot more info in that widget… a lineup assessment widget would be a
// second add or make it a selection in the current widget."
//
// A widget is a picture the app repaints: it cannot subscribe, cannot tick a
// clock, and on Android it is repainted by a headless JS task with no screen
// behind it. So what it needs from core is ONE call that answers, for a seat,
// "who am I playing, what's the score, what state is the week in, and is my
// lineup ready" — and a PURE function that turns those rows into the words
// the picture shows, so the parity check can pin them without a network.
//
// v0.422.0 adds the second view. The card leads with the LINEUP when there is
// something to fix and a window still open to fix it in, else with the SCORE;
// the manager can flip it. The lineup view is the assessment: empty slots,
// metrics not yet sealed, starters tagged out, starters on bye — each one a
// fix with the window it lives in. The score view gains the window strip
// (who is winning each of the week's windows), who is still to play, and how
// many of my slots are hot. Assessment and yet-to-play read the SEALED picks,
// so they are drip-league features; a classic league gets the strip and the
// score, and its lineup lives on the board.
//
// The rows come from the same reads every board uses — nothing new server-
// side — and the worker's silent push (kind 'widget') only says "repaint",
// never carries a score, so a stale push can never draw a stale number.

import {
  myEnrollments, myMatchupFrom, getMatchupState, matchupTeams, defaultOpenWeek, liveSlate, myPicks, myPool, injuryTags,
  type Enrollment, type LiveMatchup, type WindowScore, type PickRow, type PoolPlayer,
} from './liveApi';
import { windowsForWeek, windowPhase, windowLockMs, windowDateLabel, windowTimeLabel, weekLabel, setRuntimeSlate, windowForTeam, gamesInWindow, type WindowPhase } from './nflSlate';
import { slotsFor } from '../engine/matchup';
import { platform } from '../platform';
import type { WindowId } from '../types';

export type WidgetPhase = 'pre' | 'live' | 'final' | 'bye';
export type WidgetView = 'score' | 'lineup';

export interface WidgetWindow {
  id: string;
  /** "TNF", "SUN 1PM" — the slate's own label. */
  label: string;
  phase: WindowPhase;
  me: number;
  them: number;
}

/** One thing to fix before a window locks, in the words the card prints. */
export interface WidgetFix {
  win: string;
  winLabel: string;
  kind: 'empty' | 'metric' | 'injury' | 'bye';
  text: string;
}

export interface WidgetSnapshot {
  leagueId: string;
  leagueName: string;
  rosterId: number;
  week: number;
  /** "WK 3", or the preseason label the slate gives. */
  weekLabel: string;
  me: { name: string; score: number };
  /** Null on a bye. */
  them: { name: string; score: number } | null;
  phase: WidgetPhase;
  /** The state line: "LIVE · SUN 1PM", "Locks Sun, Sep 21 1:00 PM", "FINAL · W". */
  line: string;
  /** ms since epoch, when this picture was drawn. */
  at: number;
  // ── v0.422.0 ──
  /** The week's windows in kickoff order, each with who leads it. */
  windows: WidgetWindow[];
  /** Starters still to play (sealed windows not yet kicked) and in play now,
   *  per side. Null when the seat's picks aren't readable (a classic league). */
  left: { me: { waiting: number; playing: number }; them: { waiting: number; playing: number } } | null;
  /** My slots currently on a hot streak. */
  hot: number;
  /** The next window still open, with how many of my slots are empty in it. */
  alarm: { win: string; winLabel: string; lockMs: number; empty: number } | null;
  /** Everything wrong with the lineup in windows still open. Empty = READY. */
  fixes: WidgetFix[];
  /** Whether the lineup can be assessed at all (drip seat with picks read). */
  assessable: boolean;
  /** What the card leads with, by phase and by whether anything needs fixing. */
  lead: WidgetView;
}

/** A league the widget can show — the seats you hold, minus what a home
 *  screen has no business showing (mocks, archived, commissioner-only). */
export interface WidgetLeague {
  id: string;
  name: string;
  rosterId: number;
  /** Which game the league plays; unset reads as drip, matching the boards. */
  gameMode: 'drip' | 'classic';
  /** The app_user_id sealed picks are written AS — the seat owner's, which
   *  differs from the session user on a co-managed seat. */
  pickUserId?: string;
}

export function widgetLeagues(enr: Enrollment[]): WidgetLeague[] {
  return enr
    .filter((e) => !e.archived && !e.league?.is_mock && e.sleeper_roster_id != null)
    .map((e) => ({
      id: e.league_id, name: e.league?.name ?? 'League', rosterId: e.sleeper_roster_id,
      gameMode: e.league?.game_mode === 'classic' ? 'classic' : 'drip',
      pickUserId: e.pick_user_id,
    }));
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

const INJURY_WORD: Record<string, string> = { O: 'OUT', IR: 'IR', D: 'DOUBTFUL', Q: 'QUESTIONABLE' };
/** "J. Jacobs" from "Josh Jacobs" — a card has one line per fix. */
const shortName = (full: string) => {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : full;
};

export interface SummarizeInput {
  league: WidgetLeague;
  week: number;
  matchup: LiveMatchup | null;
  state: WindowScore[];
  teams: Record<number, { team_name: string | null }>;
  nowMs: number;
  /** The seat's sealed picks (drip). Undefined = not readable → no assessment. */
  picks?: PickRow[];
  /** The seat's roster, for names, teams (bye) and positions. */
  pool?: Pick<PoolPlayer, 'slug' | 'full' | 'team'>[];
  /** slug → injury designation, from the hourly sync. */
  injuries?: Record<string, string>;
}

/** The PURE half: rows in, the picture's words out. `nowMs` is a parameter
 *  so the check can stand at any moment of a week. */
export function summarize(input: SummarizeInput): WidgetSnapshot {
  const { league, week, matchup, state, teams, nowMs, picks, pool, injuries } = input;
  const wl = weekLabel(week);
  const wins = windowsForWeek(week);
  const base = {
    leagueId: league.id, leagueName: league.name, rosterId: league.rosterId, week, weekLabel: wl, at: nowMs,
    windows: [] as WidgetWindow[], left: null, hot: 0, alarm: null, fixes: [] as WidgetFix[], assessable: false, lead: 'score' as WidgetView,
  };
  const myName = teams[league.rosterId]?.team_name || 'Your team';
  if (!matchup) {
    return { ...base, me: { name: myName, score: 0 }, them: null, phase: 'bye', line: `BYE · ${wl}` };
  }
  const home = matchup.home_roster_id === league.rosterId;
  const mySide: 'home' | 'away' = home ? 'home' : 'away';
  const oppId = home ? matchup.away_roster_id : matchup.home_roster_id;
  const oppName = teams[oppId]?.team_name || 'Opponent';

  // ── the windows, and the totals they sum to ──
  const byWin = new Map(state.map((s) => [String(s.game_window), s]));
  const windows: WidgetWindow[] = wins.map((w) => {
    const s = byWin.get(String(w.id));
    const h = Number(s?.home_score) || 0, a = Number(s?.away_score) || 0;
    return { id: String(w.id), label: w.label, phase: windowPhase(week, w.id as WindowId, nowMs, { matchupFinal: matchup.status === 'final' }), me: round1(home ? h : a), them: round1(home ? a : h) };
  });
  let mine = 0, theirs = 0;
  for (const s of state) {
    mine += home ? Number(s.home_score) || 0 : Number(s.away_score) || 0;
    theirs += home ? Number(s.away_score) || 0 : Number(s.home_score) || 0;
  }
  const me = { name: myName, score: round1(mine) };
  const them = { name: oppName, score: round1(theirs) };
  const hot = state.reduce((n, s) => n + (s.slot_scores ?? []).filter((r) => r.side === mySide && r.hot).length, 0);

  // ── the assessment (sealed picks: drip) ──
  const assessable = Array.isArray(picks);
  const fixes: WidgetFix[] = [];
  let alarm: WidgetSnapshot['alarm'] = null;
  let left: WidgetSnapshot['left'] = null;
  if (assessable) {
    const poolBySlug = new Map((pool ?? []).map((p) => [p.slug, p]));
    const slateHasGames = wins.some((w) => gamesInWindow(week, w.id as WindowId).length > 0);
    const meLeft = { waiting: 0, playing: 0 }, themLeft = { waiting: 0, playing: 0 };
    for (const w of windows) {
      const winId = w.id;
      const inWin = (picks ?? []).filter((p) => String(p.game_window) === winId);
      const filled = inWin.filter((p) => p.player_slug);
      const cap = slotsFor(winId as WindowId, week);
      const s = byWin.get(winId);
      const theirRevealed = (s?.slot_scores ?? []).filter((r) => r.side !== mySide && r.slug).length;
      if (w.phase === 'setup' || w.phase === 'locked') {
        meLeft.waiting += filled.length;
        // Theirs are sealed until kickoff: assume the window's full complement.
        themLeft.waiting += cap;
      } else if (w.phase === 'live') {
        meLeft.playing += filled.length;
        themLeft.playing += theirRevealed;
      }
      if (w.phase !== 'setup') continue; // locked windows can't be fixed
      const empty = Math.max(0, cap - filled.length);
      const lockMs = windowLockMs(week, winId as WindowId);
      if (!alarm && lockMs != null) alarm = { win: winId, winLabel: w.label, lockMs, empty };
      if (empty > 0) fixes.push({ win: winId, winLabel: w.label, kind: 'empty', text: `${empty} empty slot${empty === 1 ? '' : 's'}` });
      const unsealed = filled.filter((p) => !p.metric_id).length;
      if (unsealed > 0) fixes.push({ win: winId, winLabel: w.label, kind: 'metric', text: `${unsealed} metric${unsealed === 1 ? '' : 's'} not sealed` });
      for (const p of filled) {
        const pl = poolBySlug.get(p.player_slug as string);
        const name = pl ? shortName(pl.full) : (p.player_slug as string);
        const tag = injuries?.[p.player_slug as string];
        if (tag && (tag === 'O' || tag === 'IR' || tag === 'D')) fixes.push({ win: winId, winLabel: w.label, kind: 'injury', text: `${name} is ${INJURY_WORD[tag] ?? tag}` });
        if (pl && slateHasGames && pl.team && !windowForTeam(week, pl.team)) fixes.push({ win: winId, winLabel: w.label, kind: 'bye', text: `${name} is on BYE` });
      }
    }
    left = { me: meLeft, them: themLeft };
  }

  // ── the state line, and which view leads ──
  const final = matchup.status === 'final';
  const openWindow = windows.some((w) => w.phase === 'setup');
  const lead: WidgetView = assessable && openWindow && (fixes.length > 0 || !windows.some((w) => w.phase !== 'setup')) ? 'lineup' : 'score';
  const common = { ...base, me, them, windows, left, hot, alarm, fixes, assessable, lead };
  if (final) {
    const r = me.score > them.score ? 'W' : me.score < them.score ? 'L' : 'T';
    return { ...common, phase: 'final', line: `FINAL · ${r} ${me.score}–${them.score}`, lead: 'score' };
  }
  const live = windows.find((w) => w.phase === 'live');
  if (live) return { ...common, phase: 'live', line: `LIVE · ${live.label}` };
  // Pre-kickoff: the next window still to lock. After the last window is
  // final but the matchup row isn't yet, say so rather than promising a lock.
  const next = wins.find((w) => { const l = windowLockMs(week, w.id as WindowId); return l != null && l > nowMs; });
  if (next) {
    const locked = windows.some((w) => w.phase !== 'setup');
    const when = `${windowDateLabel(week, next.id as WindowId)} ${windowTimeLabel(week, next.id as WindowId)}`;
    return { ...common, phase: locked ? 'live' : 'pre', line: locked ? `${next.label} locks ${when}` : `Locks ${when}` };
  }
  return { ...common, phase: 'live', line: 'Settling…', lead: 'score' };
}

// ── THE CACHE (v0.422.1) ────────────────────────────────────────────────────
// Founder: "There's a lot of lag when you press the buttons. Almost unusable."
// Every tap woke a cold headless task that made nine network reads before it
// could draw anything. Most of those answers change on the order of hours —
// the seats you hold, the week the league is on, the roster, the slate, the
// injury sheet, the team names — so they are remembered in the app's storage
// with a lifetime each, and only the two that move on a Sunday (the matchup
// row and its state, plus the picks) are always read fresh. The last drawn
// picture is remembered too, so a wake can PAINT FIRST and fetch second.
const CACHE = (k: string) => `widget:cache:${k}`;
const MIN = 60_000;

export function cacheGet<T>(key: string, maxAgeMs: number, nowMs: number = Date.now()): T | null {
  try {
    const raw = platform().storage.get(CACHE(key));
    if (!raw) return null;
    const j = JSON.parse(raw) as { at?: unknown; v?: T };
    if (!j || typeof j.at !== 'number' || nowMs - j.at > maxAgeMs || nowMs < j.at - MIN) return null;
    return j.v === undefined ? null : j.v;
  } catch { return null; }
}
export function cacheSet<T>(key: string, v: T, nowMs: number = Date.now()): void {
  try { platform().storage.set(CACHE(key), JSON.stringify({ at: nowMs, v })); } catch { /* storage is best-effort */ }
}
async function cached<T>(key: string, maxAgeMs: number, fresh: boolean, load: () => Promise<T>): Promise<T> {
  if (!fresh) { const hit = cacheGet<T>(key, maxAgeMs); if (hit !== null) return hit; }
  const v = await load();
  cacheSet(key, v);
  return v;
}

export interface RememberedSnapshot { leagues: WidgetLeague[]; snapshot: WidgetSnapshot }
/** The last picture drawn for a league, for the instant first paint. A day
 *  old is still worth a frame while the fresh one loads; the card says when
 *  it was drawn. */
export const recallSnapshot = (leagueId: string): RememberedSnapshot | null => cacheGet<RememberedSnapshot>(`snap:${leagueId}`, 24 * 60 * MIN);
export const rememberSnapshot = (r: RememberedSnapshot): void => cacheSet(`snap:${r.snapshot.leagueId}`, r);
/** The leagues list as last read, so ▸ can pick the next league without a
 *  network round-trip. */
export const recallLeagues = (): WidgetLeague[] | null => cacheGet<WidgetLeague[]>('leagues', 24 * 60 * MIN);

/** The whole feed for one widget: the leagues it could show, and the picture
 *  for the one it does. Null snapshot with an empty list means "signed in,
 *  no seats"; the caller decides what a signed-OUT widget says. `userId` is
 *  the session user, for the picks of a seat that has no owner override.
 *  `fresh` bypasses every cache (the app in the foreground knows things
 *  first: a league just joined, a lineup just saved). */
export async function widgetSnapshot(wantLeagueId?: string | null, userId?: string | null, fresh = false): Promise<{ leagues: WidgetLeague[]; snapshot: WidgetSnapshot | null }> {
  const leagues = await cached('leagues', 5 * MIN, fresh, async () => widgetLeagues(await myEnrollments('')));
  const league = pickWidgetLeague(leagues, wantLeagueId);
  if (!league) return { leagues, snapshot: null };
  const openWeek = await cached(`week:${league.id}`, 10 * MIN, fresh, () => defaultOpenWeek(league.id));
  const matchup = await myMatchupFrom(league.id, league.rosterId, openWeek);
  const week = matchup?.week ?? openWeek;
  const pickUser = league.pickUserId ?? userId ?? null;
  const drip = league.gameMode === 'drip' && !!matchup && !!pickUser;
  const teamIds = matchup ? [matchup.home_roster_id, matchup.away_roster_id] : [league.rosterId];
  const [state, teams, slate, picks, pool, injuries] = await Promise.all([
    matchup ? getMatchupState(matchup.id) : Promise.resolve([] as WindowScore[]),
    cached(`teams:${league.id}:${teamIds.join(',')}`, 60 * MIN, fresh, () => matchupTeams(league.id, teamIds)),
    cached(`slate:${week}`, 60 * MIN, fresh, () => liveSlate(week).catch(() => [])),
    drip ? myPicks(matchup!.id, pickUser as string).catch(() => undefined) : Promise.resolve(undefined),
    drip ? cached(`pool:${league.id}:${week}:${league.rosterId}`, 30 * MIN, fresh, () => myPool(league.id, week, league.rosterId).catch(() => [])) : Promise.resolve([]),
    drip ? cached('injuries', 30 * MIN, fresh, () => injuryTags().catch(() => ({}))) : Promise.resolve({}),
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
  const snapshot = summarize({ league, week, matchup, state, teams, nowMs: Date.now(), picks, pool, injuries });
  rememberSnapshot({ leagues, snapshot });
  return { leagues, snapshot };
}
