import type { Player, Pos, PbpEvent, SlotResolution, EffectType, BuffFx } from '../types';
import { metricById } from '../data/metrics';
import { realPbpFor, realPossFor, realWallFor, REAL_WEEKS, type RealPlayKind } from '../data/realPbp';
import { returnPlaysFor } from '../data/returns';

// ─────────────────────────────────────────────────────────────────────────
// Real-data resolution. Every player's week is driven by baked real 2025
// play-by-play (game clock, real wall-clock time, yards, TDs). A player with
// no baked plays that week genuinely did not produce (DNP -> zero) — there is
// no synthetic generation. Metric effects (NUKE / ERASE / HOT STREAK) resolve
// over a merged play-by-play timeline.
//
// Simplifications for the demo (documented honestly):
//   • Field General (QB MULTIPLIER) scores a light direct drip instead of a
//     true cross-slot window multiplier — keeps each slot self-contained.
//   • RATE RESET / CLOCK STOP / COMPRESSION render as flavor badges plus a
//     mild denial rather than full mechanical models.
// NUKE, ERASE and HOT STREAK are modeled for real.
// ─────────────────────────────────────────────────────────────────────────

const GAME_SECONDS = 3300; // clock caps at 55:00, matching the prototype

/** Projected weekly points from REAL season production (per-game average) —
 *  deterministic, no synthetic variance. Ranks the default lineup and prices
 *  a bye-steal's flat score. */
export function projectedPoints(p: Player, _week: number): number {
  const s = p.stats;
  const g = Math.max(1, s.games);
  return (
    s.passYds * 0.04 + s.passTds * 4 +
    s.rushYds * 0.1 + s.rushTds * 6 +
    s.recYds * 0.1 + s.recTds * 6 + s.receptions * 1
  ) / g;
}

interface RawPlay {
  clock: number;
  t?: number;       // real wall-clock time of the play, in seconds since the
                    // game's first snap (from MCP time_of_day). Absent on
                    // synthesized/return plays → callers fall back to `clock`.
  kind: RealPlayKind;
  yards: number;
  td: boolean;
  catch: boolean;   // a reception happened
  target: boolean;  // the player was targeted
  turnover?: boolean; // the player committed a turnover on this play (INT thrown / fumble lost)
}

// Effect family of a metric → how it scores a single play and what it does.
function scorePlay(play: RawPlay, pos: Pos, metricId: string, hot: boolean): number {
  // Return Yards (retyd) is a drip — it scores via rate accrual, never here.
  if (pos === 'QB') {
    if (metricId === 'fg') return 0; // Field General scores nothing — it multiplies your other window players (see windowFgMult / resolveSlot opts)
    if (metricId === 'pass') return play.kind === 'pass' ? play.yards * 0.04 + (play.td ? 4 : 0) : 0; // yards + TD points, but no nuke/erase (flat family)
    if (metricId === 'passbig') return play.kind === 'pass' ? play.yards * 0.04 + (play.td ? 10 : 0) : 0; // Air Raid unlock: 10 pts / passing TD
    if (metricId === 'rush') return play.kind === 'rush' ? play.yards * 0.1 + (play.td ? 6 : 0) : 0;  // yards + TD points, flat
  }
  if (pos === 'RB') {
    if (metricId === 'rush') return play.kind === 'rush' ? play.yards * 0.1 : 0; // drip, no TD
    if (metricId === 'carries') return play.kind === 'rush' ? 0.5 : 0; // COMPRESSION
    if (metricId === 'rec') return play.catch ? 1 : 0;
    if (metricId === 'td') return play.td ? 6 : 0; // NUKE
  }
  if (pos === 'WR') {
    if (metricId === 'recyd') return play.catch ? play.yards * 0.1 * (hot ? 2 : 1) : 0;
    if (metricId === 'rec') return play.catch ? 1 : 0;
    if (metricId === 'tgt') return play.target ? 0.5 : 0;
    if (metricId === 'td') return play.td ? 6 : 0;
  }
  if (pos === 'TE') {
    if (metricId === 'tgt') return play.target ? 1 : 0;
    if (metricId === 'rec') return play.catch ? 1.5 : 0;
    if (metricId === 'td') return play.td ? 8 : 0; // NUKE
  }
  if (pos === 'K') {
    // 'neg' (SHUTDOWN) scores 0 directly — it's a pure effect. 'banker' scores
    // FG by distance + XP (the XP→TD bonus is applied as flavor, not here).
    if (metricId === 'neg') return 0;
    if (play.kind === 'fg') return play.yards < 40 ? 3 : play.yards < 50 ? 4 : 5;
    if (play.kind === 'xp') return 1;
    return 0;
  }
  if (pos === 'DEF') {
    // Both 'earn' and 'suppress' score flat: sk1 / int3 / fr2, def/ST TD 6,
    // safety 2. A suppress DST's points are zeroed out later (spent as the
    // halving threshold) in buildMatchup — but they still show in its log.
    if (play.kind === 'sack') return 1;
    if (play.kind === 'int') return 3;
    if (play.kind === 'fumrec') return 2;
    if (play.kind === 'dst_td') return 6;
    if (play.kind === 'safety') return 2;
    return 0;
  }
  if (pos === 'DL' || pos === 'LB' || pos === 'DB') {
    // IDP (Phase 1, flat). 'idp_splash' weights game-wrecking plays; the default
    // 'idp_tackles' is a steady box-score line.
    if (metricId === 'idp_splash') {
      if (play.kind === 'sack') return 4;
      if (play.kind === 'int') return 6;
      if (play.kind === 'fumrec') return 4;
      if (play.kind === 'dst_td') return 6;
      if (play.kind === 'safety') return 2;
      if (play.kind === 'tackle') return 0.5;
      return 0;
    }
    if (play.kind === 'tackle') return 1;
    if (play.kind === 'sack') return 2;
    if (play.kind === 'int') return 3;
    if (play.kind === 'fumrec') return 2;
    if (play.kind === 'dst_td') return 6;
    if (play.kind === 'safety') return 2;
    return 0;
  }
  // Every valid (position, metric) pair is handled above (drip metrics resolve
  // on their own path and never reach here). Anything else scores nothing,
  // rather than silently bundling multiple stat types into one metric.
  return 0;
}

type Family = 'nuke' | 'erase' | 'streak' | 'mult' | 'compression' | 'reset' | 'stop' | 'flat';
function familyOf(pos: Pos, metricId: string): Family {
  const m = metricById(pos, metricId);
  if (!m) return 'flat';
  if (m.fx === 'nuke') return 'nuke';
  if (m.fx === 'erase') return 'erase';
  if (m.fx === 'streak') return 'streak';
  if (m.fx === 'mult') return 'mult';
  if (m.fx === 'compression') return 'compression';
  if (m.fx === 'reset') return 'reset';
  if (m.fx === 'stop') return 'stop';
  return 'flat';
}

interface SideState {
  bank: number;
  hist: { clock: number; pts: number }[];
  streak: number;
  hot: boolean;
  kicks: number;   // made kicks (for K neg shutdown)
  dead: boolean;   // negated by an opponent K-neg shutdown → scores 0
  rate: number;    // WR drip rate (pts/min), grows per catch
  paused: boolean; // drip paused until the WR's next catch
  nukedUntil: number; // game-clock (s) through which a TD nuke suppresses ALL scoring here
}

interface MergedPlay extends RawPlay {
  side: 'you' | 'their';
}

const TEAM_ABBR = (p: Player) => p.team || 'NFL';

function playText(p: Player, play: RawPlay): string {
  const t = TEAM_ABBR(p);
  // The player is named on the score card right above the log, so play rows omit
  // the name and show just the action (the team prefix is stripped by actionText).
  if (play.td) {
    if (play.kind === 'rush') return `${t}: ${play.yards}yd rush TD`;
    if (play.kind === 'rec') return `${t}: ${play.yards}yd catch TD`;
    if (play.kind === 'return') return `${t}: ${play.yards}yd return TD`;
    return `${t}: ${play.yards}yd TD`;
  }
  if (play.kind === 'pass') return `${t}: ${play.yards}yd pass`;
  if (play.kind === 'rush') return `${t}: +${play.yards} rush`;
  if (play.kind === 'rec') return `${t}: +${play.yards} catch`;
  if (play.kind === 'return') return `${t}: +${play.yards} return`;
  if (play.kind === 'fg') return `${t}: ${play.yards}yd FG good`;
  if (play.kind === 'fgmiss') return `${t}: ${play.yards}yd FG miss`;
  if (play.kind === 'xp') return `${t}: XP good`;
  if (play.kind === 'xpmiss') return `${t}: XP miss`;
  if (play.kind === 'sack') return `${t} D: sack`;
  if (play.kind === 'int') return `${t} D: interception`;
  if (play.kind === 'fumrec') return `${t} D: fumble recovered`;
  if (play.kind === 'dst_td') return `${t} D: defensive TD`;
  if (play.kind === 'safety') return `${t} D: safety`;
  if (play.kind === 'tackle') return `${t} D: tackle`;
  return `${t}: incomplete`;
}

function fmtClock(s: number): string {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

export interface SlotInput {
  player: Player;
  metricId: string;
}

/** Real play-by-play for a player/week, if we've baked it; else null. */
export function realRawPlays(playerId: string, week: number): RawPlay[] | null {
  const ps = realPbpFor(week, playerId);
  if (!ps) return null;
  return ps
    .map((p) => ({ clock: p.c, t: p.t, kind: p.k, yards: p.y, td: !!p.td, catch: !!p.ca, target: !!p.tg, turnover: !!p.to }))
    .sort((a, b) => a.clock - b.clock);
}


// A projected "average game" play sequence built from a player's SEASON per-game
// stats — historical performance, with no knowledge of the actual week. The AI
// opponent evaluates its lineup against these (never the week's real box score),
// so it plans on expectation and the game then plays out on the real data.
export function projectedPlays(player: Player): RawPlay[] {
  const s = player.stats;
  const g = Math.max(1, s.games);
  const per = (x: number) => x / g;
  const pass: RawPlay[] = [], rush: RawPlay[] = [], rec: RawPlay[] = [];
  const mk = (kind: RealPlayKind, yards: number, td: boolean, catch_: boolean, target: boolean, turnover?: boolean): RawPlay =>
    ({ clock: 0, kind, yards, td, catch: catch_, target, ...(turnover ? { turnover } : {}) });
  // Passing: spread projected yards over ~completions; first N are TDs, then INTs.
  const passYds = per(s.passYds), passTds = Math.round(per(s.passTds)), ints = Math.round(per(s.ints));
  if (passYds > 0) {
    const n = Math.max(passTds + 1, Math.round(passYds / 9));
    for (let i = 0; i < n; i++) pass.push(mk('pass', passYds / n, i < passTds, false, false));
    for (let i = 0; i < ints; i++) pass.push(mk('pass', 0, false, false, false, true));
  }
  // Rushing.
  const carries = Math.round(per(s.carries)), rushYds = per(s.rushYds), rushTds = Math.round(per(s.rushTds));
  if (carries > 0 || rushYds > 0) {
    const n = Math.max(rushTds + 1, carries || 1);
    for (let i = 0; i < n; i++) rush.push(mk('rush', rushYds / n, i < rushTds, false, false));
  }
  // Receiving: catches carry yards; the rest of the targets are incompletions.
  const tgts = Math.round(per(s.targets)), recs = Math.round(per(s.receptions)), recYds = per(s.recYds), recTds = Math.round(per(s.recTds));
  for (let i = 0; i < tgts; i++) {
    const isCatch = i < recs;
    rec.push(mk(isCatch ? 'rec' : 'incomplete', isCatch ? recYds / Math.max(1, recs) : 0, isCatch && i < recTds, isCatch, true));
  }
  // Round-robin interleave the three kinds, then spread evenly across regulation
  // so drips build gradually over the game.
  const out: RawPlay[] = [];
  for (let i = 0; out.length < pass.length + rush.length + rec.length; i++) {
    if (i < pass.length) out.push(pass[i]);
    if (i < rush.length) out.push(rush[i]);
    if (i < rec.length) out.push(rec[i]);
  }
  const N = out.length || 1;
  out.forEach((pl, i) => { pl.clock = Math.round(150 + ((3100 - 150) * (i + 1)) / (N + 1)); });
  return out;
}

/** Did this DST return an interception/fumble for a touchdown this week? (Pick Six) */
export function hadDefTd(player: Player, week: number): boolean {
  return playsForPlayer(player, week).plays.some((p) => p.kind === 'dst_td');
}
/** Did this QB throw a touchdown pass of at least `minYds` yards? (Hail Mary) */
export function hadLongPassTd(player: Player, week: number, minYds = 40): boolean {
  return playsForPlayer(player, week).plays.some((p) => p.kind === 'pass' && p.td && p.yards >= minYds);
}
/**
 * Turnovers COMMITTED by this player this week (interception thrown / fumble
 * lost) — for the turnover coin penalty. Read from baked real PBP (INT → passer,
 * fumble lost → rusher/receiver/passer by play role).
 */
export function turnoversCommitted(player: Player, week: number): number {
  return playsForPlayer(player, week).plays.filter((p) => p.turnover).length;
}

/** A sentinel "no opponent" player — an unopposed slot resolves against it. */
export const EMPTY_PLAYER: Player = {
  id: '__empty__', name: '—', full: 'No opponent', pos: 'WR', team: '',
  stats: { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 },
};

/** Real kick/punt returns (from baked 2025 play-by-play) — each at its EXACT
 *  game-elapsed second. Feeds the Return Yards metric. No synthesized timing. */
function returnPlays(player: Player, week: number): RawPlay[] {
  if (player.pos !== 'WR' && player.pos !== 'RB' && player.pos !== 'TE') return [];
  return returnPlaysFor(player.id, week).map(([clock, yards, td, t]) => ({
    clock, t, kind: 'return' as RealPlayKind, yards, td: td === 1, catch: false, target: false,
  }));
}

/** Real plays when available, otherwise the deterministic simulation. Return
 *  plays are folded in only when the player is actually scoring Return Yards —
 *  otherwise they must not perturb another metric's mechanics. */
function playsForPlayer(player: Player, week: number, metricId?: string, projection = false): { plays: RawPlay[]; real: boolean } {
  if (player.id === EMPTY_PLAYER.id) return { plays: [], real: false };
  if (projection) return { plays: projectedPlays(player), real: false }; // historical expectation, not the week's box score
  const r = realRawPlays(player.id, week);
  const base = r ?? []; // real week w/ no entry = genuine DNP (zero); no synthesis
  const ret = metricId === 'retyd' ? returnPlays(player, week) : [];
  const plays = ret.length ? [...base, ...ret].sort((a, b) => a.clock - b.clock) : base;
  return { plays, real: REAL_WEEKS.has(week) || !!r };
}

// ── Real-time ↔ game-clock mapping ────────────────────────────────────────────
// Real-time power-ups (Metric/Player Swap, Mulligan) are gated on the REAL
// wall-clock time a play happened — not the game clock the feed displays — so a
// delayed feed can't be used to scoop a play you already saw on TV. Each play
// carries `t` (real seconds since the first snap); these two helpers convert
// between a game-clock position and its real-time position along a player's
// own timeline, interpolating between plays. When real timestamps are absent
// (`t` falls back to `clock`) both functions are the identity, so behavior is
// unchanged until real play time is baked.
function clockRtPoints(player: Player, week: number, metricId?: string): { c: number; t: number }[] {
  return playsForPlayer(player, week, metricId).plays.map((p) => ({ c: p.clock, t: p.t ?? p.clock }));
}
function interp(pts: { c: number; t: number }[], x: number, from: 'c' | 't'): number {
  const to = from === 'c' ? 't' : 'c';
  if (!pts.length) return x;
  if (x <= pts[0][from]) return pts[0][from] > 0 ? (x / pts[0][from]) * pts[0][to] : 0;
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][from]) {
      const a = pts[i - 1], b = pts[i];
      const span = b[from] - a[from];
      return span > 0 ? a[to] + ((x - a[from]) / span) * (b[to] - a[to]) : a[to];
    }
  }
  const last = pts[pts.length - 1];
  return last[to] + (x - last[from]); // 1:1 past the final play
}
/** The real wall-clock time (seconds from first snap) at a game-clock position. */
export function realTimeAt(player: Player, week: number, clock: number, metricId?: string): number {
  return Math.round(interp(clockRtPoints(player, week, metricId), clock, 'c'));
}
/** The game-clock position corresponding to a real wall-clock time. */
export function clockAtRealTime(player: Player, week: number, rt: number, metricId?: string): number {
  return Math.round(interp(clockRtPoints(player, week, metricId), rt, 't'));
}

// Running box-score line for a player up to a clock — drives the live statline
// shown under each score card (real stats, independent of the metric scoring).
export interface StatLine {
  passYds: number; passTds: number;
  carries: number; rushYds: number; rushTds: number;
  targets: number; rec: number; recYds: number; recTds: number;
  retYds: number; retTds: number;
  fg: number; xp: number;
  sacks: number; ints: number; fumrec: number; dtd: number; safety: number;
  tackles: number;
}
export function statlineAt(player: Player, week: number, clock: number, metricId?: string): StatLine {
  const { plays } = playsForPlayer(player, week, metricId);
  const s: StatLine = { passYds: 0, passTds: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, rec: 0, recYds: 0, recTds: 0, retYds: 0, retTds: 0, fg: 0, xp: 0, sacks: 0, ints: 0, fumrec: 0, dtd: 0, safety: 0, tackles: 0 };
  for (const p of plays) {
    if (p.clock > clock) break; // plays are sorted ascending by clock
    switch (p.kind) {
      case 'pass': s.passYds += p.yards; if (p.td) s.passTds++; break;
      case 'rush': s.carries++; s.rushYds += p.yards; if (p.td) s.rushTds++; break;
      case 'rec': s.rec++; s.targets++; s.recYds += p.yards; if (p.td) s.recTds++; break;
      case 'incomplete': s.targets++; break;
      case 'return': s.retYds += p.yards; if (p.td) s.retTds++; break;
      case 'fg': s.fg++; break;
      case 'xp': s.xp++; break;
      case 'sack': s.sacks++; break;
      case 'int': s.ints++; break;
      case 'fumrec': s.fumrec++; break;
      case 'dst_td': s.dtd++; break;
      case 'safety': s.safety++; break;
      case 'tackle': s.tackles++; break;
    }
  }
  return s;
}

// Field General (QB): passing yards build a live, window-wide multiplier on
// your OTHER players in the window — 1 + 0.003·(cumulative passing yds), so
// 300 yds ≈ 1.9×. Given the window's slot inputs for one side, returns a
// clock→multiplier function (or undefined if no FG QB is in the window).
const FG_RATE = 0.003;
export function windowFgMult(
  players: SlotInput[],
  week: number,
  opts: { reg?: number; carryOT?: boolean; stack?: boolean; projection?: boolean } = {},
): ((clock: number) => number) | undefined {
  const { reg = 3300, carryOT = false, stack = false, projection = false } = opts;
  const timelines: RawPlay[][] = [];
  for (const p of players) {
    if (p.player.pos === 'QB' && p.metricId === 'fg') {
      const plays = projection ? projectedPlays(p.player) : (realRawPlays(p.player.id, week) ?? []);
      const passes = plays.filter((x) => x.kind === 'pass').sort((a, b) => a.clock - b.clock);
      if (passes.length) timelines.push(passes);
    }
  }
  if (!timelines.length) return undefined;
  return (clock: number) => {
    // Field General resets when regulation ends — unless Overtime carries it over.
    if (clock >= reg && !carryOT) return 1;
    const mults = timelines.map((passes) => {
      let cum = 0;
      for (const x of passes) { if (x.clock <= clock) cum += x.yards; else break; }
      return 1 + FG_RATE * cum;
    }).sort((a, b) => b - a);
    // Default: multiple Field General QBs do NOT stack — you get the higher
    // multiplier at any moment. Twin Generals stacks the top two (multiplies).
    return stack ? mults[0] * (mults[1] ?? 1) : mults[0];
  };
}

// A DST's own defensive score for the week (sk1 / int3 / fr2 / def-TD6 /
// safety2) — used as the SUPPRESS kill-threshold. A suppress DST forgoes these
// points (it banks 0) and spends them as the bar every opponent slot must clear.
export function defEarnScore(player: Player, week: number): number {
  const plays = realRawPlays(player.id, week) ?? [];
  let s = 0;
  for (const p of plays) {
    if (p.kind === 'sack') s += 1;
    else if (p.kind === 'int') s += 3;
    else if (p.kind === 'fumrec') s += 2;
    else if (p.kind === 'dst_td') s += 6;
    else if (p.kind === 'safety') s += 2;
  }
  return s;
}

// Clocks at which a side's TE Touchdown (8-PT NUKE) players score a TD. Each
// such clock knocks every opposing drip rate down by 1.0 across the window. Each
// nuke carries both its game clock `c` and real wall-clock time `rt` (seconds
// since its game's first snap) so real-resolve can land it on the receiving
// player's timeline by real time rather than game clock.
export function teTdNukeClocks(players: SlotInput[], week: number): { c: number; rt: number }[] {
  const out: { c: number; rt: number }[] = [];
  for (const p of players) {
    if (p.player.pos === 'TE' && p.metricId === 'td') {
      const plays = realRawPlays(p.player.id, week) ?? [];
      for (const x of plays) if (x.td) out.push({ c: x.clock, rt: realTimeAt(p.player, week, x.clock, p.metricId) });
    }
  }
  return out.sort((a, b) => a.c - b.c);
}

// Offensive seconds within (t0, t1] given a team's possession intervals.
// No intervals (unknown) → full elapsed (drip ungated rather than dead).
function offSecs(intervals: number[][], t0: number, t1: number): number {
  if (t1 <= t0) return 0;
  if (!intervals.length) return t1 - t0;
  let s = 0;
  for (const [a, b] of intervals) { const lo = Math.max(a, t0), hi = Math.min(b, t1); if (hi > lo) s += hi - lo; }
  return s;
}

/**
 * Resolve one slot: your player+metric vs their player+metric over a merged
 * play-by-play timeline. Returns the full event feed plus final banks.
 * `opts.youMult` / `opts.theirMult` apply a per-clock multiplier to that
 * side's scoring (used by the QB Field General window multiplier).
 */
export function resolveSlot(you: SlotInput, their: SlotInput, week: number, gameLabel: string, opts: { youMult?: (clock: number) => number; theirMult?: (clock: number) => number; youDripNukeClocks?: number[]; theirDripNukeClocks?: number[]; youBuffs?: Set<string>; theirBuffs?: Set<string>; youEmpFreeze?: [number, number]; theirEmpFreeze?: [number, number]; realResolve?: boolean; projection?: boolean } = {}): SlotResolution & { gameLabel: string; real: boolean; maxClock: number; youTds: number; theirTds: number; youBankerXp: number; theirBankerXp: number; youDead: boolean; theirDead: boolean } {
  // Pre-match team buffs active on each side (Momentum / Garbage Time /
  // Floodgates / Overtime). Only the human side carries buffs in the demo.
  const youBuffs = opts.youBuffs ?? new Set<string>();
  const theirBuffs = opts.theirBuffs ?? new Set<string>();
  const youOT = youBuffs.has('overtime') ? 300 : 0;
  const theirOT = theirBuffs.has('overtime') ? 300 : 0;
  const proj = !!opts.projection;
  const yp = playsForPlayer(you.player, week, you.metricId, proj);
  const tp = playsForPlayer(their.player, week, their.metricId, proj);
  const yPlays = yp.plays;
  const tPlays = tp.plays;
  const real = yp.real || tp.real;
  // Real 2025 play-by-play runs a full 60:00; the synthetic prototype clock caps
  // at 55:00 (GAME_SECONDS). Pick the right regulation length so a real game's
  // final 5 minutes aren't mistaken for overtime — which would silently drop all
  // drip (and mistime Garbage Time) over that stretch.
  const REG = real ? 3600 : GAME_SECONDS;
  const GARBAGE_FROM = REG - 300; // final 5 minutes
  const merged: MergedPlay[] = [
    ...yPlays.map((p) => ({ ...p, side: 'you' as const })),
    ...tPlays.map((p) => ({ ...p, side: 'their' as const })),
  ].sort((a, b) => a.clock - b.clock);

  const Y: SideState = { bank: 0, hist: [], streak: 0, hot: false, kicks: 0, dead: false, rate: 0, paused: false, nukedUntil: 0 };
  const T: SideState = { bank: 0, hist: [], streak: 0, hot: false, kicks: 0, dead: false, rate: 0, paused: false, nukedUntil: 0 };
  const youFam = familyOf(you.player.pos, you.metricId);
  const theirFam = familyOf(their.player.pos, their.metricId);

  // Drip metrics: WR Receiving Yards (built by catches) and RB Rush Yards
  // (built by carries). A drip play raises a permanent rate (yds × 0.01
  // pts/min) that accrues over the player's team offensive time.
  const dripKindOf = (s: SlotInput): RealPlayKind[] | null =>
    (s.metricId === 'combodrip') ? ['rush', 'rec']                          // Combo Drip unlock: carries AND catches
      : (s.metricId === 'retyd') ? (s.player.pos === 'RB' ? ['rush', 'return'] : ['rec', 'return']) // Return Yards unlock: returns + the position's natural yardage
        : (s.player.pos === 'WR' && s.metricId === 'recyd') ? ['rec']
          : (s.player.pos === 'RB' && s.metricId === 'rush') ? ['rush']
            : (s.player.pos === 'TE' && s.metricId === 'recyd') ? ['rec']
              : null;
  // TE drip builds at half the rate (0.005/yd vs 0.01) but is immune to the
  // pauses and erases that WR/RB opponents lay on a drip (see oppIsDrip below).
  const dripRateOf = (s: SlotInput): number => (s.player.pos === 'TE' ? 0.005 : 0.01);
  const youDripRate = dripRateOf(you);
  const theirDripRate = dripRateOf(their);
  const youDripKind = dripKindOf(you);
  const theirDripKind = dripKindOf(their);
  const dripYou = youDripKind !== null;
  const dripTheir = theirDripKind !== null;
  // Projection mode has no real possession data — accrue drips over full game time.
  const youPoss = dripYou && !proj ? realPossFor(week, you.player.team) : [];
  const theirPoss = dripTheir && !proj ? realPossFor(week, their.player.team) : [];
  const events: PbpEvent[] = [];

  // REAL CLOCK: drip accrues per real wall-clock minute of ACTIVE play instead
  // of per game-clock minute (applied per segment in minuteGain). Each game has a
  // baked active-wall timeline (cumulative real wall-seconds in play vs game
  // clock, with quarter/half breaks excluded). activeWallAt(c) interpolates it,
  // so drip stretches with the real pace of each stretch and hard-pauses at every
  // quarter and the half — no estimates.
  const realResolve = !!opts.realResolve;
  const wallFn = (player: Player): ((c: number) => number) | null => {
    if (!realResolve) return null;
    const arr = realWallFor(week, player.team);
    if (!arr || arr.length < 2) return null;
    return (c: number) => {
      if (c <= 0) return arr[0];
      const i = Math.floor(c / 60);
      if (i >= arr.length - 1) return arr[arr.length - 1] + (c - (arr.length - 1) * 60); // extend ~1:1 past last sample
      return arr[i] + (arr[i + 1] - arr[i]) * ((c - i * 60) / 60);
    };
  };
  const yWallAt = dripYou ? wallFn(you.player) : null;
  const tWallAt = dripTheir ? wallFn(their.player) : null;

  // Per-side ledger of scoring changes caused by armed/active powerups — surfaced
  // at FINAL in each spot. `vsOpp` entries removed points from the opponent
  // (carry-wipe / counter-nuke); the rest added to this side's own bank.
  const youBuffFx: BuffFx[] = [];
  const theirBuffFx: BuffFx[] = [];
  const recBuff = (side: 'you' | 'their', id: string, points: number, vsOpp = false) => {
    if (!(points > 0)) return;
    const arr = side === 'you' ? youBuffFx : theirBuffFx;
    const ex = arr.find((e) => e.id === id && !!e.vsOpp === vsOpp);
    if (ex) ex.points = Math.round((ex.points + points) * 10) / 10;
    else arr.push({ id, points: Math.round(points * 10) / 10, vsOpp });
  };

  // TE Touchdowns (8-PT NUKE) reach across the whole window: each opposing TE
  // TD instantly knocks every one of your drip rates down by 1.0 pts/min (min
  // 0). The clocks of those TDs arrive via opts; we step through them during
  // accrual so the cut lands at the exact moment of the TD.
  const DRIP_NUKE = 1.0;
  const youNukeClocks = (opts.youDripNukeClocks ?? []).slice().sort((a, b) => a - b);
  const theirNukeClocks = (opts.theirDripNukeClocks ?? []).slice().sort((a, b) => a - b);
  let yNukeI = 0, tNukeI = 0;
  let lastClock = 0;
  // Per-minute gain for a side over (t0,t1] without mutating it. Returns the
  // total plus the portion of it attributable to each scoring powerup, so the
  // log can note it and the FINAL spot can tally it.
  interface MinuteGain { total: number; ot: number; momentum: number; garbage: number; }
  const ZERO_GAIN: MinuteGain = { total: 0, ot: 0, momentum: 0, garbage: 0 };
  const minuteGain = (side: 'you' | 'their', t0: number, t1: number): MinuteGain => {
    const s = side === 'you' ? Y : T;
    if (s.paused || s.dead || s.rate <= 0 || t1 <= t0) return ZERO_GAIN;
    const poss = side === 'you' ? youPoss : theirPoss;
    const mult = side === 'you' ? opts.youMult : opts.theirMult;
    const buffs = side === 'you' ? youBuffs : theirBuffs;
    // EMP: this side's drip is frozen for a 10-minute window.
    const emp = side === 'you' ? opts.youEmpFreeze : opts.theirEmpFreeze;
    if (emp && t0 < emp[1] && t1 > emp[0]) return ZERO_GAIN;
    // Overtime: minutes past regulation count as full possession (no game clock
    // to gate them), so the drip keeps ticking for the bonus window.
    const isOT = t0 >= REG;
    let secs = isOT ? (buffs.has('overtime') ? t1 - t0 : 0) : offSecs(poss, t0, t1);
    // REAL CLOCK: convert THIS game-minute's possession seconds into real
    // wall-clock-active seconds via the game's baked active-wall timeline (breaks
    // already excluded), so drip runs on the real clock and pauses at quarter/half.
    const wf = side === 'you' ? yWallAt : tWallAt;
    if (wf && secs > 0 && !isOT) secs *= Math.max(0, (wf(t1) - wf(t0)) / (t1 - t0));
    if (secs <= 0) return ZERO_GAIN;
    const hotMult = s.hot ? (buffs.has('momentum') ? 3 : 2) : 1; // Momentum: 3× when hot
    const base = s.rate * (secs / 60);
    let add = base * hotMult;
    const garbageOn = buffs.has('garbage-time') && t1 > GARBAGE_FROM; // Garbage Time: final 5 min ×2
    const garbagePre = garbageOn ? add : 0;
    if (garbageOn) add *= 2;
    const m = mult?.(t1); const fgm = m && m !== 1 ? m : 1; if (fgm !== 1) add *= fgm;
    // Everything accrued past regulation only exists because of Overtime, so credit
    // it wholly to OT; within regulation, split out Momentum's 3×-vs-2× and Garbage.
    if (isOT) return { total: add, ot: add, momentum: 0, garbage: 0 };
    // Sequential, non-overlapping split (baseline → +momentum → +garbage) so the
    // bonuses sum to exactly the powerup-driven portion of `total`. Momentum is
    // the extra 1× beyond a normal hot 2×; Garbage then doubles whatever's there.
    const momentum = (s.hot && buffs.has('momentum')) ? base * fgm : 0;
    return { total: add, ot: 0, momentum, garbage: garbagePre * fgm };
  };
  // Accrue both drips across [from,to] one game-minute at a time, emitting a
  // tagged drip event (with running banks) each minute either side gains points
  // — so the log can show scoring tick up minute by minute.
  // A drip tick's powerup note (Momentum / Garbage Time / Overtime).
  const dripBuffNote = (g: MinuteGain): string | undefined => {
    const n: string[] = [];
    if (g.momentum > 0) n.push('MOMENTUM 3×');
    if (g.garbage > 0) n.push('GARBAGE TIME ×2');
    if (g.ot > 0) n.push('OVERTIME');
    return n.length ? n.join(' · ') : undefined;
  };
  const accrueRange = (from: number, to: number) => {
    let t = from;
    while (t < to) {
      const next = Math.min(to, Math.floor(t / 60) * 60 + 60);
      const yg = dripYou ? minuteGain('you', t, next) : ZERO_GAIN;
      const tg = dripTheir ? minuteGain('their', t, next) : ZERO_GAIN;
      const ya = yg.total, ta = tg.total;
      if (ya > 0) { Y.bank += ya; Y.hist.push({ clock: next, pts: ya }); if (next >= REG) youOtPts += ya; recBuff('you', 'overtime', yg.ot); recBuff('you', 'momentum', yg.momentum); recBuff('you', 'garbage-time', yg.garbage); }
      if (ta > 0) { T.bank += ta; T.hist.push({ clock: next, pts: ta }); if (next >= REG) theirOtPts += ta; recBuff('their', 'overtime', tg.ot); recBuff('their', 'momentum', tg.momentum); recBuff('their', 'garbage-time', tg.garbage); }
      // Only surface a drip tick once it rounds to ≥0.1 — sub-0.1 still banks
      // silently and shows up in the next tick's cumulative.
      const yd = Math.round(ya * 10) / 10, td = Math.round(ta * 10) / 10;
      const ym = opts.youMult?.(next), tm = opts.theirMult?.(next);
      if (yd > 0) events.push({ clock: next, side: 'you', play: `${you.player.team || 'NFL'}: ${Y.hot ? 'HOT drip' : 'drip'}`, delta: yd, youBank: Math.round(Y.bank * 10) / 10, theirBank: Math.round(T.bank * 10) / 10, drip: true, mult: ym && ym !== 1 ? ym : undefined, buffNote: dripBuffNote(yg) });
      if (td > 0) events.push({ clock: next, side: 'their', play: `${their.player.team || 'NFL'}: ${T.hot ? 'HOT drip' : 'drip'}`, delta: td, youBank: Math.round(Y.bank * 10) / 10, theirBank: Math.round(T.bank * 10) / 10, drip: true, mult: tm && tm !== 1 ? tm : undefined, buffNote: dripBuffNote(tg) });
      t = next;
    }
  };
  const dripNuke = (s: SideState, side: 'you' | 'their', clock: number) => {
    if (s.rate <= 0 && !s.hot) return;
    s.rate = Math.max(0, s.rate - DRIP_NUKE);
    const killedHot = s.hot;
    s.streak = 0; s.hot = false; // a TE TD also KILLS the hot streak for every opposing drip in the window
    events.push({ clock, side, play: `${(side === 'you' ? you : their).player.team || 'NFL'}: drip nuked`, delta: 0, youBank: Math.round(Y.bank * 10) / 10, theirBank: Math.round(T.bank * 10) / 10, effect: { type: 'nuke', text: `DRIP NUKED −${DRIP_NUKE.toFixed(1)}/min → ${s.rate.toFixed(2)}${killedHot ? ' · HOT killed' : ''}` } });
  };
  const accrue = (to: number) => {
    // Gather this segment's drip-nuke clocks (a TE TD on the opposing side),
    // sorted, and accrue between them so each cut lands at its own clock.
    const stops: { clock: number; side: 'you' | 'their' }[] = [];
    while (yNukeI < youNukeClocks.length && youNukeClocks[yNukeI] <= to) stops.push({ clock: youNukeClocks[yNukeI++], side: 'you' });
    while (tNukeI < theirNukeClocks.length && theirNukeClocks[tNukeI] <= to) stops.push({ clock: theirNukeClocks[tNukeI++], side: 'their' });
    stops.sort((a, b) => a.clock - b.clock);
    let from = lastClock;
    for (const st of stops) {
      accrueRange(from, st.clock);
      if (st.side === 'you' && dripYou) dripNuke(Y, 'you', st.clock);
      if (st.side === 'their' && dripTheir) dripNuke(T, 'their', st.clock);
      from = st.clock;
    }
    accrueRange(from, to);
  };

  // TDs and banker-XPs per side, surfaced for the lineup-wide K banker bonus.
  let youTds = 0, theirTds = 0, youBankerXp = 0, theirBankerXp = 0;
  // Points each side banks in overtime (clock ≥ REG) — the Overtime Shield buff
  // negates the opponent's.
  let youOtPts = 0, theirOtPts = 0;
  // Counter-Nuke / Insurance fire once per slot, on the human side only.
  let cnUsed = false, insUsed = false;
  // A TD nuke RESETS the victim's drip AND suppresses ALL scoring in that slot for the
  // next 10 game-minutes. A bare rate-reset is rebuilt within a few catches (the reason
  // NUKE was dead), so the 10-minute blackout is what makes the wipe stick — the slot
  // banks/builds nothing until it lifts, then must rebuild the rate from scratch. (Also
  // nullifies any Field-General-boosted accrual meanwhile: 0 rate × any mult = 0.)
  const NUKE_SUPPRESS = 600; // 10 game-minutes, in seconds
  const nukeDrip = (s: SideState, clock: number) => { s.rate = 0; s.streak = 0; s.hot = false; s.paused = true; s.nukedUntil = Math.max(s.nukedUntil, clock + NUKE_SUPPRESS); };

  for (const play of merged) {
    accrue(play.clock);
    lastClock = play.clock;
    const mine = play.side === 'you' ? Y : T;
    const opp = play.side === 'you' ? T : Y;
    const oppSide: 'you' | 'their' = play.side === 'you' ? 'their' : 'you';
    // A nuke-suppressed slot is INERT until its 10-minute blackout lifts: this play
    // builds no drip rate, banks no points, and triggers no effects. The opponent's
    // drip accrual over [lastClock, play.clock] already ran in accrue() above, and the
    // slot's rate was zeroed at the nuke, so nothing accrues here either.
    if (play.clock < mine.nukedUntil) continue;
    // A big bank wipe of the victim (`opp`). Counter-Nuke (reflect onto the
    // attacker) and Insurance (keep half) protect YOUR slot the first time.
    const nukeWipe = (wiped: number): string => {
      if (oppSide === 'you' && youBuffs.has('counter-nuke') && !cnUsed) {
        cnUsed = true; const back = mine.bank; mine.bank = 0; mine.hist = []; nukeDrip(mine, play.clock); // reflected: the attacker is wiped + drip-suppressed instead
        recBuff('you', 'counter-nuke', back, true); // reflected the nuke back onto the attacker
        return back > 0 ? ` · ↩ COUNTER-NUKE −${back.toFixed(1)}` : ' · ↩ COUNTER-NUKE';
      }
      if (oppSide === 'you' && youBuffs.has('insurance') && !insUsed) {
        insUsed = true; opp.bank = Math.round(wiped * 0.5 * 10) / 10; opp.hist = []; // half the bank refunded AND the drip survives (no rate-reset/blackout) — the "soften" counter to counter-nuke's "reflect"
        recBuff('you', 'insurance', opp.bank); // half your bank refunded instead of zeroed
        return ` · 🛟 INSURED ${opp.bank.toFixed(1)}`;
      }
      opp.bank = 0; opp.hist = []; nukeDrip(opp, play.clock);
      return '';
    };
    const myFam = play.side === 'you' ? youFam : theirFam;
    const oppFam = play.side === 'you' ? theirFam : youFam;
    const myPlayer = play.side === 'you' ? you : their;
    const oppPlayer = play.side === 'you' ? their : you;
    const iAmDrip = play.side === 'you' ? dripYou : dripTheir;
    const oppIsDrip = play.side === 'you' ? dripTheir : dripYou;
    const myDripKind = play.side === 'you' ? youDripKind : theirDripKind;
    const myDripRate = play.side === 'you' ? youDripRate : theirDripRate;
    // TE Targets (WIDE ERASE) fires on every target — incompletions included —
    // unlike the catch-gated WR/TE Receptions erase.
    const eraseOnTarget = myPlayer.player.pos === 'TE' && myPlayer.metricId === 'tgt';
    const eraseTrigger = myFam === 'erase' && (eraseOnTarget ? play.target : play.catch);
    const eraseWindow = eraseOnTarget ? 900 : 600;

    // Scoring. Drip: a catch/carry raises the rate and resumes the drip but
    // scores nothing directly; 3 straight (no opponent score) goes hot → 2×
    // accrual. Otherwise the metric's per-play points (× FG mult).
    let pts = 0;
    let sig = false; // a signature play this tick (highlighted)
    let wentHot = false; // a drip crossed into HOT this tick — an event of note
    let coinAmt: number | undefined; // explicit coin bounty for this play (overrides the metric rate)
    let evMult: number | undefined; // FG multiplier shown on this play in the log
    let buffNote: string | undefined; // an active powerup changed this play's score
    const sideMult = (play.side === 'you' ? opts.youMult?.(play.clock) : opts.theirMult?.(play.clock)) ?? 1;
    if (iAmDrip) {
      if (myDripKind?.includes(play.kind)) {
        mine.rate += play.yards * myDripRate;
        mine.paused = false;
        // What counts toward the HOT streak: catches always do; a rush must gain
        // 3+ yards; a return must gain 10+. A stuffed run / short return builds
        // rate but breaks momentum — it resets the streak and cools the drip, so
        // HOT demands *sustained* production rather than latching all game (a
        // drip opponent never per-play scores, so it can't cool it for you).
        const advances = play.kind === 'rush' ? play.yards >= 3
          : play.kind === 'return' ? play.yards >= 10
            : true;
        // Combo drips (two touch streams: combodrip, retyd) heat faster, so they
        // need 4 straight productive touches to go HOT vs 3 for a single drip.
        const hotNeed = (myDripKind && myDripKind.length > 1) ? 4 : 3;
        if (advances) {
          mine.streak += 1;
          if (mine.streak >= hotNeed && !mine.hot) { mine.hot = true; sig = true; wentHot = true; } // drip goes HOT
        } else {
          mine.streak = 0; mine.hot = false;
        }
      } else if (play.kind === 'incomplete' && play.target && myDripKind?.includes('rec')) {
        // An incomplete target breaks a receiving drip's momentum, mirroring the
        // stuffed-run cool on rush drips: HOT needs sustained catches, not one
        // early burst that latches all game (a drip opponent never per-play
        // cools it for you).
        mine.streak = 0; mine.hot = false;
      }
    } else {
      pts = scorePlay(play, myPlayer.player.pos, myPlayer.metricId, myFam === 'streak' && mine.hot);
      if (mine.dead) pts = 0;
      if (sideMult !== 1 && pts > 0) { pts *= sideMult; evMult = sideMult; }
      // Garbage Time: points scored in the final 5 game-minutes count double.
      if (pts > 0 && play.clock > GARBAGE_FROM && (play.side === 'you' ? youBuffs : theirBuffs).has('garbage-time')) { recBuff(play.side, 'garbage-time', pts); pts *= 2; buffNote = 'GARBAGE TIME ×2'; }
    }
    // Field General QB: scores nothing itself, but each pass grows the window
    // multiplier — surface it in the QB's own log so you can watch it build.
    const isFG = myPlayer.player.pos === 'QB' && myPlayer.metricId === 'fg';
    if (isFG && play.kind === 'pass') evMult = sideMult;

    mine.bank += pts;
    if (pts > 0) mine.hist.push({ clock: play.clock, pts });
    if (pts > 0 && play.clock >= REG) { if (play.side === 'you') youOtPts += pts; else theirOtPts += pts; }

    // A scoring opponent cools a streak/drip/compression run — except a TE drip
    // shrugs off WR/RB scoring (its immunity covers the hot-streak break too).
    const teDripShrugsCool = oppIsDrip && oppPlayer.player.pos === 'TE'
      && (myPlayer.player.pos === 'WR' || myPlayer.player.pos === 'RB');
    if (pts > 0 && !teDripShrugsCool && (oppFam === 'streak' || oppIsDrip || oppFam === 'compression')) { opp.streak = 0; opp.hot = false; }

    if (myFam === 'streak') {
      if (play.td) { mine.streak = 3; mine.hot = true; }
      else if (play.catch) { mine.streak += 1; if (mine.streak >= 3) mine.hot = true; }
    }

    // COMPRESSION (RB Carries): each carry advances a grind streak. With no
    // opponent score breaking it (see reset above), a 3+ carry streak trims
    // the opponent's most-recent score by 25% per further carry.
    if (myFam === 'compression' && play.kind === 'rush') mine.streak += 1;

    if (play.td && myPlayer.metricId === 'td') { if (play.side === 'you') youTds++; else theirTds++; }
    if (myPlayer.player.pos === 'K' && myPlayer.metricId === 'banker' && play.kind === 'xp') {
      if (play.side === 'you') youBankerXp++; else theirBankerXp++;
    }

    let effect: { type: EffectType; text: string } | undefined;

    if (myPlayer.player.pos === 'K' && myPlayer.metricId === 'neg' && (play.kind === 'fg' || play.kind === 'xp')) {
      // K NEG (SHUTDOWN): 6th made kick zeroes + negates the matched opponent.
      mine.kicks++;
      if (mine.kicks >= 6 && !opp.dead) {
        const wiped = opp.bank;
        opp.bank = 0; opp.hist = []; opp.dead = true; opp.paused = true;
        effect = { type: 'nuke', text: `✕ SHUTDOWN — negated ${wiped.toFixed(1)}` }; sig = true;
      }
    } else if (oppIsDrip) {
      // Drip opponent: only a DENIAL metric pauses/erases it — ERASE wipes a
      // recent window, RATE RESET zeroes the rate (bank kept), CLOCK STOP just
      // pauses. A plain accumulation metric (Receiving/Rush Yards) does NOT
      // deny — the opponent's drip runs right through its catches. Any TD wipes
      // the entire drip bank (handled below).
      // A TE drip is immune to the pause/erase/reset that a WR or RB lays on it
      // (its rate and bank shrug off their catches/targets). TDs still wipe it.
      const teDripImmune = oppPlayer.player.pos === 'TE'
        && (myPlayer.player.pos === 'WR' || myPlayer.player.pos === 'RB');
      // Floodgates: the drip owner (the non-acting side) shrugs off all opponent
      // pauses/erases this week. The owner is `opp` here; its buffs gate immunity.
      const ownerFloodgates = (play.side === 'you' ? theirBuffs : youBuffs).has('floodgates');
      if (!teDripImmune && !ownerFloodgates && (play.kind === 'rec' || play.kind === 'incomplete')) {
        if (eraseTrigger) {
          opp.paused = true;
          const cutoff = play.clock - eraseWindow;
          let erased = 0;
          opp.hist = opp.hist.filter((h) => { if (h.clock >= cutoff) { erased += h.pts; return false; } return true; });
          if (erased > 0) { opp.bank = Math.max(0, opp.bank - erased); sig = true; }
          effect = { type: 'erase', text: erased > 0 ? `ERASE −${erased.toFixed(1)} · drip stop` : 'DRIP STOP' };
        } else if (play.kind === 'rec' && myFam === 'reset') {
          opp.paused = true;
          const had = opp.rate; opp.rate = 0; opp.streak = 0; opp.hot = false;
          effect = { type: 'reset', text: had > 0 ? `RATE RESET ${had.toFixed(2)}→0 · drip stop` : 'DRIP STOP' }; if (had > 0) sig = true;
        } else if (myFam === 'stop') {
          opp.paused = true;
          effect = { type: 'stop', text: 'DRIP STOP' };
        }
        // non-denial metric (accumulation drip / flat): no pause, no effect
      }
      // Only the dedicated TD (nuke) metric wipes a drip. A flat QB/RB TD under
      // a yardage metric scores its points but does not nuke the opponent.
      if (play.td && myFam === 'nuke') {
        const wiped = opp.bank;
        const suffix = nukeWipe(wiped); opp.paused = true;
        effect = { type: 'nuke', text: `✕ TD — wiped drip ${wiped.toFixed(1)}${suffix}` }; sig = true;
      }
    } else if (myFam === 'nuke' && play.td && opp.bank > 0) {
      const wiped = opp.bank;
      const suffix = nukeWipe(wiped);
      effect = { type: 'nuke', text: `✕ NUKE — wiped ${wiped.toFixed(1)}${suffix}` }; sig = true;
    } else if (eraseTrigger) {
      const cutoff = play.clock - eraseWindow;
      let erased = 0;
      opp.hist = opp.hist.filter((h) => {
        if (h.clock >= cutoff) { erased += h.pts; return false; }
        return true;
      });
      if (erased > 0) { opp.bank = Math.max(0, opp.bank - erased); effect = { type: 'erase', text: `ERASE −${erased.toFixed(1)}` }; sig = true; }
    } else if (myFam === 'reset' && play.catch) {
      const last = opp.hist[opp.hist.length - 1];
      if (last) { const cut = last.pts * 0.5; opp.bank = Math.max(0, opp.bank - cut); last.pts -= cut; effect = { type: 'reset', text: 'RATE RESET' }; sig = true; }
    } else if (myFam === 'stop' && play.target && opp.hist.length) {
      effect = { type: 'stop', text: 'CLOCK STOP' };
    }

    // COMPRESSION grind: fires regardless of the opponent's family (including a
    // drip opponent). A 3+ carry streak with no opponent score trims their
    // most-recent banked score by 25% per carry.
    if (myFam === 'compression' && play.kind === 'rush' && mine.streak >= 3 && opp.hist.length) {
      const last = opp.hist[opp.hist.length - 1];
      const cut = Math.round(last.pts * 0.25 * 10) / 10;
      if (cut > 0) {
        opp.bank = Math.max(0, opp.bank - cut);
        last.pts -= cut;
        if (!effect) effect = { type: 'reset', text: `COMPRESSION −${cut.toFixed(1)}` };
        sig = true;
      }
    }

    // WR/TE Carries (WIPE) — now an automatic PLUS-UP rather than a selectable
    // metric. When that side has armed the unlock, every WR/TE carry instantly
    // zeroes the opponent ON TOP of whatever metric the slot is scoring. Fires
    // against any opponent (drip included), like compression.
    const myBuffs = play.side === 'you' ? youBuffs : theirBuffs;
    if ((myPlayer.player.pos === 'WR' || myPlayer.player.pos === 'TE') && myBuffs.has('unlock-carries-wipe') && play.kind === 'rush' && opp.bank > 0) {
      const wiped = opp.bank;
      const suffix = nukeWipe(wiped); opp.paused = true;
      if (!effect) effect = { type: 'nuke', text: `✕ CARRY WIPE −${wiped.toFixed(1)}${suffix}` };
      recBuff(play.side, 'unlock-carries-wipe', wiped, true); // wiped the opponent's bank
      coinAmt = 25; // the carry wipe pays its own bounty regardless of the primary metric
      sig = true;
    }

    // streak / drip badges
    if (!effect && iAmDrip && myDripKind?.includes(play.kind)) effect = { type: 'streak', text: mine.hot ? `HOT 2× · ${mine.rate.toFixed(2)}/m` : `DRIP ↑ ${mine.rate.toFixed(2)}/m` };
    if (!effect && myFam === 'streak') {
      if (play.td) effect = { type: 'streak', text: 'TD → STREAK 2×' };
      else if (mine.hot && play.catch) effect = { type: 'streak', text: 'HOT STREAK · 2×' };
    }
    if (!effect && oppFam === 'streak' && pts > 0) {
      effect = { type: 'cold', text: 'STREAK COLD' };
    }
    if (!effect && isFG && play.kind === 'pass') effect = { type: 'mult', text: `FIELD GEN ×${sideMult.toFixed(2)}` }; // mult lives in the label; inline ×mult is suppressed
    if (play.turnover) effect = { type: 'nuke', text: '✕ TURNOVER → opp' }; // giveaway: coin to the opponent

    events.push({
      clock: play.clock,
      side: play.side,
      play: playText(myPlayer.player, play),
      mult: evMult,
      delta: Math.round(pts * 10) / 10,
      youBank: Math.round(Y.bank * 10) / 10,
      theirBank: Math.round(T.bank * 10) / 10,
      effect,
      buffNote,
      sig,
      // Event of note (earns drip coin): a bank-zeroing nuke/shutdown/wipe, or a drip going HOT.
      coin: effect?.type === 'nuke' || wentHot,
      coinAmt,
    });
  }

  // Final drip accrual through the end of the game (per-minute, like the rest).
  // Overtime extends the window 5 minutes for whichever side armed it.
  accrue(REG + Math.max(youOT, theirOT));

  // Overtime Shield: negate the points the OPPONENT banked in overtime. Yours
  // shields against their OT points; theirs against yours (only the human carries
  // buffs in the demo).
  if (youBuffs.has('ot-shield') && theirOtPts > 0 && T.bank > 0) {
    const cut = Math.min(theirOtPts, T.bank); T.bank = Math.round((T.bank - cut) * 10) / 10; recBuff('you', 'ot-shield', cut, true);
  }
  if (theirBuffs.has('ot-shield') && youOtPts > 0 && Y.bank > 0) {
    const cut = Math.min(youOtPts, Y.bank); Y.bank = Math.round((Y.bank - cut) * 10) / 10; recBuff('their', 'ot-shield', cut, true);
  }

  // DEF SUPPRESS (HALVING) resolves globally in buildMatchup — it reaches every
  // opponent slot across every window — so it is not applied here.

  const maxClock = events.length ? Math.max(...events.map((e) => e.clock)) : REG;
  return {
    events,
    youFinal: Math.round(Y.bank * 10) / 10,
    theirFinal: Math.round(T.bank * 10) / 10,
    youBuffFx: youBuffFx.length ? youBuffFx : undefined,
    theirBuffFx: theirBuffFx.length ? theirBuffFx : undefined,
    gameLabel,
    real,
    maxClock,
    youTds, theirTds, youBankerXp, theirBankerXp,
    youDead: Y.dead, theirDead: T.dead,
  };
}

export { GAME_SECONDS, fmtClock };
