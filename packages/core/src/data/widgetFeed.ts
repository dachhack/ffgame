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
import { windowsForWeek, windowPhase, windowLockMs, windowKickoffMs, windowDateLabel, windowTimeLabel, weekLabel, setRuntimeSlate, windowForTeam, gamesInWindow, type WindowPhase } from './nflSlate';
import { slotsFor } from '../engine/matchup';
import { metricById } from './metrics';
import { headshot, espnHeadshot } from './media';
import type { Pos } from '../types';
import { CLASSIC_WIN, slotAllows, slotDisplayNames, slotBadgeLabel, optimalLineup, leagueSlotDefs, leagueBestball, leagueGolfZeroPtsOf, slateAwareProj, type ClassicSlotDef, type SpotPlayer } from '../engine/classic';
import { zeroFill, setLeagueGolf, clearLeagueGolf } from '../engine/golf';
import { setLeagueProjScoring, clearLeagueProjScoring } from '../engine/projScoring';
import { playRisk } from '../engine/golfFloor';
import { setSlugSleeperIds } from './slugMeta';
import { getRevealedPicks, leagueGameMode, leaguePoolIds, leaguePoolExp, nativeRosters, weekMatchups, leaguePool } from './liveApi';
import { platform } from '../platform';
import type { WindowId } from '../types';

/** `idle` (v0.433.6): no matchup row for the seat AND no proof the week is
 *  scheduled — the schedule not built yet, a week past it, a league that
 *  plays elsewhere. Founder: "Looks like it assumes your team is on a bye if
 *  there is no data. Let's not do that." A BYE is a claim with evidence:
 *  the league has matchups this week and this seat is in none of them. */
export type WidgetPhase = 'pre' | 'live' | 'final' | 'bye' | 'idle';
export type WidgetView = 'score' | 'lineup';

export interface WidgetWindow {
  id: string;
  /** "TNF", "SUN 1PM" — the slate's own label. */
  label: string;
  phase: WindowPhase;
  me: number;
  them: number;
}

/** One thing to fix before a window locks, in the words the card prints.
 *  In a classic league (v0.433.2) `win` is the SPOT (its slot id) and
 *  `winLabel` its name — "RB 2", "FLEX" — and `swap` is a bench player who
 *  projects SWAP_MIN_GAIN or more over the starter he could replace. */
export interface WidgetFix {
  win: string;
  winLabel: string;
  kind: 'empty' | 'metric' | 'injury' | 'bye' | 'swap';
  text: string;
}

/** ONE CARD ON THE HOME SCREEN (v0.433.9) — a drip seat's pick in one slot
 *  of one window, as the widget draws it: the headshot, the name, the metric,
 *  and a status chip. Founder: "show the images of the cards of your players
 *  picked in the widget for drip scoring leagues. Have a status chip and a
 *  warning for any unfilled slots." An EMPTY slot is a card too — the
 *  warning — and a slot left empty in a window already locked is MISSED. */
export interface WidgetCard {
  win: string;
  winLabel: string;
  /** The window's phase, so a row can be coloured as a whole. */
  phase: WindowPhase;
  slot: string;
  slug: string | null;
  /** "J. Jacobs", or "" for an empty slot. */
  name: string;
  pos: string | null;
  team: string | null;
  /** The sealed metric's name ("Rush Yards"), or null when none is sealed. */
  metric: string | null;
  /** Headshot URL when one is known (baked or the league pool's ESPN id), else null. */
  image: string | null;
  /** empty — nothing picked, window still open (THE WARNING);
   *  missed — nothing picked and the window has locked;
   *  unsealed — a player without a metric, window open;
   *  set — player and metric in, window open;
   *  sealed — locked, not yet kicked off;
   *  live — on the field, `points` so far;
   *  final — done, `points` banked. */
  status: 'empty' | 'missed' | 'unsealed' | 'set' | 'sealed' | 'live' | 'final';
  points: number | null;
  hot: boolean;
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
  // ── v0.433.2 ──
  /** CLASSIC: `me.score` and `them.score` are PROJECTED FINALS — each starter's
   *  points if his game is done, his projection if it hasn't started, the
   *  larger of the two while he plays (the board's projectEntry blend) — and
   *  `fixes` names the spots that want attention, drawn on the score card
   *  itself. Absent or false: the scores are the live totals. */
  projected?: boolean;
  /** CLASSIC: the opponent's lineup could not be read (or they have nobody),
   *  so `them.score` is their live total, not a projection. */
  themLive?: boolean;
  // ── v0.433.9 ──
  /** DRIP: my picks as cards, every slot of every window in kickoff order,
   *  empty slots included. Empty when the seat is not assessable. */
  cards?: WidgetCard[];
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
  pool?: Pick<PoolPlayer, 'slug' | 'full' | 'team'>[] | Pick<PoolPlayer, 'slug' | 'full' | 'team' | 'pos'>[];
  /** slug → injury designation, from the hourly sync. */
  injuries?: Record<string, string>;
  /** slug → headshot URL (v0.433.9), for the cards. Absent = no photos. */
  images?: Record<string, string>;
  /** CLASSIC (v0.433.2): the lineup, the roster, and how to value a player. */
  classic?: ClassicWidgetInput;
  /** Whether the league HAS matchups this week (v0.433.6) — read only when
   *  the seat has none. True proves a bye; false or absent is no claim, and
   *  the card says there is no matchup rather than inventing a bye. */
  weekScheduled?: boolean;
}

/** A rostered player as the classic summary sees him: the pool row plus what
 *  the fills need (tenure, Sleeper id for the bake). ACTIVE roster only — the
 *  caller strips IR/OUT/taxi, who can neither start nor be suggested. */
export interface ClassicRosterPlayer { slug: string; full: string; pos: string; team: string | null; exp?: number | null; sleeperId?: string | null }

export interface ClassicWidgetInput {
  /** The league's starting spots, in order (leagueSlotDefs). */
  slots: ClassicSlotDef[];
  /** Slot ids that fill themselves at scoring time (leagueBestball). */
  bestball: string[];
  /** My stored classic picks (the 'wk' window rows). A spot with no row and
   *  a spot holding null both read as EMPTY here — the widget reports what
   *  the roster will score, and neither scores. */
  picks: PickRow[];
  roster: ClassicRosterPlayer[];
  /** The opponent's revealed classic rows and roster, when readable. An
   *  EMPTY pick list with a roster is a seat nobody manages, which the
   *  resolver fields from its roster (classicLineup) — so do we. */
  theirPicks?: PickRow[] | null;
  theirRoster?: ClassicRosterPlayer[] | null;
  /** What a player is worth in a spot: the caller's slateAwareProj (bye → 0,
   *  ruled out → 0, the league's catalog, golf's expected score). */
  projOf: (p: SpotPlayer, d?: ClassicSlotDef) => number;
  /** Golf: lowest wins, so "better" is lower-but-not-zero. */
  golf?: boolean;
}

/** A bench player must project this many points over the starter before the
 *  card suggests the swap (founder: "projected to score 2+ more points"). */
export const SWAP_MIN_GAIN = 2;
/** How long after kickoff a game reads as DONE to the widget, which has no
 *  play feed to tell it (the boards use the feed's final teams). Three and
 *  three-quarter hours covers every game short of a marathon overtime. */
const GAME_MS = 3.75 * 60 * 60 * 1000;

/** The PURE half: rows in, the picture's words out. `nowMs` is a parameter
 *  so the check can stand at any moment of a week. */
export function summarize(input: SummarizeInput): WidgetSnapshot {
  const { league, week, matchup, state, teams, nowMs, picks, pool, injuries, images } = input;
  const wl = weekLabel(week);
  const wins = windowsForWeek(week);
  const base = {
    leagueId: league.id, leagueName: league.name, rosterId: league.rosterId, week, weekLabel: wl, at: nowMs,
    windows: [] as WidgetWindow[], left: null, hot: 0, alarm: null, fixes: [] as WidgetFix[], assessable: false, lead: 'score' as WidgetView,
    cards: [] as WidgetCard[],
  };
  const myName = teams[league.rosterId]?.team_name || 'Your team';
  if (!matchup) {
    // A bye needs evidence (v0.433.6): the week is scheduled and this seat
    // is not in it. Otherwise there is simply no matchup to show — the
    // schedule isn't built, the week is past it, or nothing could be read —
    // and the card says that, not "nothing to sweat".
    if (input.weekScheduled === true) return { ...base, me: { name: myName, score: 0 }, them: null, phase: 'bye', line: `BYE · ${wl}` };
    return { ...base, me: { name: myName, score: 0 }, them: null, phase: 'idle', line: `NO MATCHUP · ${wl}` };
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
  const cards: WidgetCard[] = [];
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
      // ── THE CARDS (v0.433.9): one per slot, in slot order, empties included ──
      const mineScored = new Map((s?.slot_scores ?? []).filter((r) => r.side === mySide).map((r) => [String(r.slot), r]));
      const bySlot = new Map(inWin.map((p) => [String(p.roster_slot), p]));
      const slotIds = [...new Set([...bySlot.keys(), ...Array.from({ length: cap }, (_, i) => String(i + 1))])]
        .sort((a, b) => Number(a) - Number(b)).slice(0, cap);
      for (const slotId of slotIds) {
        const p = bySlot.get(slotId);
        const slug = p?.player_slug ?? null;
        const pl = slug ? poolBySlug.get(slug) : undefined;
        const sc = mineScored.get(slotId);
        const open = w.phase === 'setup';
        const status: WidgetCard['status'] = !slug ? (open ? 'empty' : 'missed')
          : open ? (p?.metric_id ? 'set' : 'unsealed')
          : w.phase === 'locked' ? 'sealed'
          : w.phase === 'live' ? 'live' : 'final';
        const pos = pl && 'pos' in pl ? (pl as { pos?: string }).pos ?? null : null;
        const metric = p?.metric_id && pos ? metricById(pos as Pos, p.metric_id)?.name ?? null : null;
        cards.push({
          win: winId, winLabel: w.label, phase: w.phase, slot: slotId, slug,
          name: slug ? (pl ? shortName(pl.full) : slug) : '',
          pos, team: pl?.team ?? null, metric,
          image: slug ? images?.[slug] ?? null : null,
          status,
          points: sc && (status === 'live' || status === 'final') ? round1(Number(sc.score) || 0) : null,
          hot: !!sc?.hot,
        });
      }
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

  // ── CLASSIC (v0.433.2): the projected finals, and the spots that want attention ──
  // Founder: "For classic leagues, let's show predicted score rather than
  // current. There's still a lot of room in the widget. We can show empty
  // starting spots, starting spots with out/bye players, and starters where
  // a player that is projected to score 2+ more points is on the bench and
  // could replace. No need to make this a separate view."
  const final = matchup.status === 'final';
  let projected = false;
  let themLive = false;
  const c = input.classic;
  if (c && league.gameMode === 'classic') {
    projected = true;
    // Golf's order, spelled out here rather than through golfValue: that
    // helper reads the module flag, which the check never installs and the
    // task may or may not have set — the input says which game this is.
    const gv = (v: number) => (c.golf ? (v > 0 ? 1e6 - v : 0) : v);
    const better = (a: number, b: number) => gv(a) > gv(b);
    const gainOver = (a: number, b: number) => gv(a) - gv(b);
    const stateOf = (team: string | null | undefined): 'pre' | 'live' | 'done' => {
      if (final) return 'done';
      const w = windowForTeam(week, team);
      const k = w ? windowKickoffMs(week, w) : null;
      if (k == null || k > nowMs) return 'pre';          // a bye never kicks: 'pre' at a value of 0
      return k + GAME_MS <= nowMs ? 'done' : 'live';
    };
    const wkRow = byWin.get(CLASSIC_WIN);
    const spot = (p: ClassicRosterPlayer): SpotPlayer => ({ id: p.slug, pos: p.pos, team: p.team, exp: p.exp ?? null, sleeperId: p.sleeperId ?? null });
    const bb = new Set(c.bestball);
    const names = slotDisplayNames(c.slots).map(slotBadgeLabel);

    /** One side's lineup and projected final. */
    const sideOf = (picks: PickRow[] | null | undefined, roster: ClassicRosterPlayer[], side: 'home' | 'away') => {
      const bySlug = new Map(roster.map((p) => [p.slug, p]));
      const liveOf = new Map<string, { slug: string | null; score: number }>();
      for (const r of wkRow?.slot_scores ?? []) if (r.side === side) liveOf.set(r.slot, { slug: r.slug, score: Number(r.score) || 0 });
      const lineup = new Map<string, ClassicRosterPlayer | null>();
      const stored = new Map((picks ?? []).filter((p) => String(p.game_window) === CLASSIC_WIN).map((p) => [p.roster_slot, p.player_slug]));
      // A seat with NO rows at all is fielded from its roster, as the
      // resolver does (classicLineup); a seat with rows stands as stored.
      const unmanaged = !(picks ?? []).length && roster.length > 0;
      if (unmanaged) {
        const opt = optimalLineup(c.slots, roster.map(spot), (p) => c.projOf(p));
        for (const r of opt.spots) lineup.set(r.def.slot, r.player ? bySlug.get(r.player.id) ?? null : null);
      } else {
        for (const d of c.slots) {
          if (bb.has(d.slot)) continue;
          const slug = stored.get(d.slot) ?? null;
          lineup.set(d.slot, slug ? bySlug.get(slug) ?? null : null);   // a stored man no longer rostered is an empty spot
        }
        // Best-ball spots: what the resolver has already filled (the slot
        // row's slug) once the week is scoring, else the best of the rest.
        const bbDefs = c.slots.filter((d) => bb.has(d.slot));
        if (bbDefs.length) {
          const taken = new Set([...lineup.values()].filter(Boolean).map((p) => (p as ClassicRosterPlayer).slug));
          for (const d of bbDefs) { const l = liveOf.get(d.slot); if (l?.slug && bySlug.has(l.slug)) { lineup.set(d.slot, bySlug.get(l.slug)!); taken.add(l.slug); } }
          const rest = roster.filter((p) => !taken.has(p.slug)).map(spot);
          const open = bbDefs.filter((d) => !lineup.has(d.slot));
          if (open.length && rest.length) {
            const opt = optimalLineup(open, rest, (p) => c.projOf(p));
            for (const r of opt.spots) lineup.set(r.def.slot, r.player ? bySlug.get(r.player.id) ?? null : null);
          }
        }
      }
      let total = 0;
      const left = { waiting: 0, playing: 0 };
      for (const d of c.slots) {
        const p = lineup.get(d.slot) ?? null;
        const live = liveOf.get(d.slot)?.score ?? 0;
        let v = 0;
        let settled = true;
        if (p) {
          const st = stateOf(p.team);
          const proj = c.projOf(spot(p), d);
          v = st === 'done' ? live : st === 'pre' ? proj : Math.max(live, proj);
          settled = st === 'done';
          if (st === 'pre' && windowForTeam(week, p.team)) left.waiting += 1;
          if (st === 'live') left.playing += 1;
        }
        // GOLF: an empty spot, or a settled zero, pays the spot's fill.
        total += c.golf ? zeroFill(v, d.zeroPts ?? null, settled) : v;
      }
      return { lineup, total: round1(total), left };
    };

    const mineSide = sideOf(c.picks, c.roster, mySide);
    me.score = mineSide.total;
    const theirs = c.theirRoster?.length ? sideOf(c.theirPicks, c.theirRoster, mySide === 'home' ? 'away' : 'home') : null;
    if (theirs) them.score = theirs.total; else themLive = true;
    left = { me: mineSide.left, them: theirs ? theirs.left : { waiting: 0, playing: 0 } };

    // ── the spots that want attention (mine) ──
    const starting = new Set([...mineSide.lineup.values()].filter(Boolean).map((p) => (p as ClassicRosterPlayer).slug));
    const slateHasGames = wins.some((w) => gamesInWindow(week, w.id as WindowId).length > 0);
    // The bench a swap can come from: rostered, not starting, game not yet
    // kicked off (a man on the field cannot be moved in), worth something.
    const bench = c.roster.filter((p) => !starting.has(p.slug) && stateOf(p.team) === 'pre');
    const used = new Set<string>();
    const bestFor = (d: ClassicSlotDef): { p: ClassicRosterPlayer; v: number } | null => {
      let best: { p: ClassicRosterPlayer; v: number } | null = null;
      for (const p of bench) {
        if (used.has(p.slug) || !slotAllows(d, spot(p))) continue;
        const v = c.projOf(spot(p), d);
        if (v <= 0) continue;
        if (!best || better(v, best.v)) best = { p, v };
      }
      return best;
    };
    const word = (tag: string) => INJURY_WORD[tag] ?? tag;
    const one = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));
    const startText = (b: { p: ClassicRosterPlayer; v: number } | null) => (b ? ` · start ${shortName(b.p.full)} ${one(round1(b.v))}` : '');
    // IN THE FOUNDER'S ORDER, as three passes over the spots: the EMPTY spots
    // take the best bench men first, then the spots whose starter cannot play
    // (out, on bye), and only then the upgrades — so the best back on the
    // bench fills the hole rather than displacing a starter who merely
    // projects less, and each bench man is promised to one spot.
    const rows = c.slots.map((d, i) => ({ d, label: names[i], p: mineSide.lineup.get(d.slot) ?? null })).filter((r) => !bb.has(r.d.slot));
    const found: WidgetFix[] = [];
    for (const { d, label, p } of rows) {
      if (p) continue;
      const b = bestFor(d);
      if (b) used.add(b.p.slug);
      found.push({ win: d.slot, winLabel: label, kind: 'empty', text: b ? `empty${startText(b)}` : 'empty' });
    }
    const movable = rows.filter((r) => r.p && stateOf(r.p.team) === 'pre');   // on the field or done: locked in
    const cannot = new Set<string>();
    for (const { d, label, p } of movable) {
      const tag = injuries?.[p!.slug];
      const bye = slateHasGames && !!p!.team && !windowForTeam(week, p!.team);
      if (tag && (tag === 'O' || tag === 'IR' || tag === 'D')) {
        const b = bestFor(d); if (b) used.add(b.p.slug); cannot.add(d.slot);
        found.push({ win: d.slot, winLabel: label, kind: 'injury', text: `${shortName(p!.full)} is ${word(tag)}${startText(b)}` });
      } else if (bye) {
        const b = bestFor(d); if (b) used.add(b.p.slug); cannot.add(d.slot);
        found.push({ win: d.slot, winLabel: label, kind: 'bye', text: `${shortName(p!.full)} is on BYE${startText(b)}` });
      }
    }
    for (const { d, label, p } of movable) {
      if (cannot.has(d.slot)) continue;
      const b = bestFor(d);
      const sv = c.projOf(spot(p!), d);
      if (b && gainOver(b.v, sv) >= SWAP_MIN_GAIN) {
        used.add(b.p.slug);
        found.push({ win: d.slot, winLabel: label, kind: 'swap', text: `${shortName(b.p.full)} ${one(round1(b.v))} over ${shortName(p!.full)} ${one(round1(sv))}` });
      }
    }
    // Printed in spot order, whatever pass found them.
    const order = new Map(c.slots.map((d, i) => [d.slot, i]));
    found.sort((a, b) => (order.get(a.win) ?? 0) - (order.get(b.win) ?? 0));
    fixes.push(...found);
  }

  // ── the state line, and which view leads ──
  const openWindow = windows.some((w) => w.phase === 'setup');
  const lead: WidgetView = assessable && openWindow && (fixes.length > 0 || !windows.some((w) => w.phase !== 'setup')) ? 'lineup' : 'score';
  const common = { ...base, me, them, windows, left, hot, alarm, fixes, assessable, lead, cards, ...(projected ? { projected, themLive } : {}) };
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
  // No row for the seat: is the week scheduled at all? Read only in that
  // case (v0.433.6), and a failed read is no claim.
  const weekScheduled = matchup ? undefined : await weekMatchups(league.id, week).then((rows) => rows.length > 0).catch(() => undefined);
  const pickUser = league.pickUserId ?? userId ?? null;
  const drip = league.gameMode === 'drip' && !!matchup && !!pickUser;
  // CLASSIC (v0.433.2): the card projects the finals and reads the lineup, so
  // it needs what the classic board needs — the league's spots and catalog,
  // my rows and the opponent's revealed ones (0178: league-readable), both
  // rosters, the shelf (IR/OUT/taxi can't start), tenure for a filtered spot,
  // and the pool's Sleeper ids so the bake answers for a "Kenny" (v0.432.4).
  const classic = league.gameMode === 'classic' && !!matchup;
  const oppId = matchup ? (matchup.home_roster_id === league.rosterId ? matchup.away_roster_id : matchup.home_roster_id) : null;
  const teamIds = matchup ? [matchup.home_roster_id, matchup.away_roster_id] : [league.rosterId];
  const [state, teams, slate, picks, pool, injuries, gm, revealed, spots, ids, oppPool, espnIds] = await Promise.all([
    matchup ? getMatchupState(matchup.id) : Promise.resolve([] as WindowScore[]),
    cached(`teams:${league.id}:${teamIds.join(',')}`, 60 * MIN, fresh, () => matchupTeams(league.id, teamIds)),
    cached(`slate:${week}`, 60 * MIN, fresh, () => liveSlate(week).catch(() => [])),
    (drip || classic) && pickUser ? myPicks(matchup!.id, pickUser).catch(() => undefined) : Promise.resolve(undefined),
    drip || classic ? cached(`pool:${league.id}:${week}:${league.rosterId}`, 30 * MIN, fresh, () => myPool(league.id, week, league.rosterId).catch(() => [])) : Promise.resolve([]),
    drip || classic ? cached('injuries', 30 * MIN, fresh, () => injuryTags().catch(() => ({}))) : Promise.resolve({}),
    classic ? cached(`mode:${league.id}`, 60 * MIN, fresh, () => leagueGameMode(league.id).catch(() => null)) : Promise.resolve(null),
    classic ? getRevealedPicks(matchup!.id).catch(() => []) : Promise.resolve([]),
    classic ? cached(`spots:${league.id}`, 30 * MIN, fresh, () => nativeRosters(league.id).catch(() => [])) : Promise.resolve([]),
    classic ? cached(`ids:${league.id}`, 60 * MIN, fresh, () => leaguePoolIds(league.id).then((r) => r?.ids ?? {}).catch(() => ({}))) : Promise.resolve({}),
    classic && oppId != null ? cached(`pool:${league.id}:${week}:${oppId}`, 30 * MIN, fresh, () => myPool(league.id, week, oppId).catch(() => [])) : Promise.resolve([]),
    // THE FACES (v0.433.9): the league pool's ESPN ids, for the headshots the
    // baked map lacks. A day is fine — a photo id does not change.
    drip ? cached(`espn:${league.id}`, 24 * 60 * MIN, fresh, () => leaguePool(league.id)
      .then((rows) => Object.fromEntries(rows.filter((r) => r.espn_id).map((r) => [r.slug, r.espn_id as string])))
      .catch(() => ({} as Record<string, string>))) : Promise.resolve({} as Record<string, string>),
  ]);
  let images: Record<string, string> | undefined;
  if (drip) {
    images = {};
    for (const p of pool) {
      const url = headshot(p.slug) ?? espnHeadshot((espnIds as Record<string, string>)[p.slug]);
      if (url) images[p.slug] = url;
    }
  }
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
  let classicIn: ClassicWidgetInput | undefined;
  if (classic && gm?.ok) {
    const slots = leagueSlotDefs({ roster: gm.roster ?? null, slots: gm.slots ?? null });
    const tenure = (gm.slots ?? []).some((x) => x.min_exp != null || x.max_exp != null);
    const exp = tenure ? await cached(`exp:${league.id}`, 60 * MIN, fresh, () => leaguePoolExp(league.id).catch(() => ({}))) : {};
    const stashed = new Set((spots ?? []).filter((r) => r.spot && r.spot !== 'active').map((r) => `${r.roster_id}:${r.slug}`));
    const rosterOf = (rows: PoolPlayer[], rosterId: number): ClassicRosterPlayer[] => rows
      .filter((p) => !stashed.has(`${rosterId}:${p.slug}`))
      .map((p) => ({ slug: p.slug, full: p.full, pos: p.pos, team: p.team || null, exp: (exp as Record<string, number>)[p.slug] ?? null, sleeperId: (ids as Record<string, string>)[p.slug] ?? null }));
    const oppUser = oppId != null ? teams[oppId]?.user_id ?? null : null;
    const theirPicks = oppUser ? (revealed ?? []).filter((r) => r.app_user_id === oppUser) : [];
    // The league's own rules, installed for the projection and cleared below
    // (the headless task shares a module with the next league's paint).
    setLeagueProjScoring(gm.scoring ?? {});
    setLeagueGolf(gm.golf === true, leagueGolfZeroPtsOf(gm));
    setSlugSleeperIds(ids as Record<string, string>);
    const tags = injuries as Record<string, string>;
    const projOf = slateAwareProj(week, slate, (slug) => {
      const st = tags[slug];
      return st === 'O' || st === 'IR' ? true : playRisk(st);
    });
    classicIn = {
      slots, bestball: leagueBestball(gm), picks: picks ?? [], roster: rosterOf(pool, league.rosterId),
      theirPicks, theirRoster: oppId != null ? rosterOf(oppPool, oppId) : null, projOf, golf: gm.golf === true,
    };
  }
  try {
    const snapshot = summarize({ league, week, matchup, state, teams, nowMs: Date.now(), picks: drip ? picks : undefined, pool, injuries, images, classic: classicIn, weekScheduled });
    rememberSnapshot({ leagues, snapshot });
    return { leagues, snapshot };
  } finally {
    if (classicIn) { clearLeagueProjScoring(); clearLeagueGolf(); }
  }
}
