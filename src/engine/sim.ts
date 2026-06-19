import type { Player, PlayerStats, Pos, PbpEvent, SlotResolution, EffectType } from '../types';
import { hashStr } from '../data/players';
import { metricById } from '../data/metrics';
import { realPbpFor, realPossFor, type RealPlayKind } from '../data/realPbp';

// ─────────────────────────────────────────────────────────────────────────
// Deterministic simulation. Everything is seeded off (playerId, week) so a
// given matchup always plays out identically — no server, no randomness at
// runtime. Real 2025 season totals set each player's baseline; weekly
// variance gives boom/bust texture; metric effects (NUKE / ERASE / HOT
// STREAK) resolve over a merged play-by-play timeline.
//
// Simplifications for the demo (documented honestly):
//   • Field General (QB MULTIPLIER) scores a light direct drip instead of a
//     true cross-slot window multiplier — keeps each slot self-contained.
//   • RATE RESET / CLOCK STOP / COMPRESSION render as flavor badges plus a
//     mild denial rather than full mechanical models.
// NUKE, ERASE and HOT STREAK are modeled for real.
// ─────────────────────────────────────────────────────────────────────────

const GAME_SECONDS = 3300; // clock caps at 55:00, matching the prototype

/** mulberry32 PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface WeekLine {
  passYds: number; passTds: number;
  carries: number; rushYds: number; rushTds: number;
  targets: number; receptions: number; recYds: number; recTds: number;
}

/** Sample a small count from an expected per-game rate. */
function sampleCount(expected: number, r: () => number): number {
  // simple thinned Poisson-ish: each "slot" hits with prob
  let n = 0;
  let p = expected;
  while (p > 0) {
    if (r() < Math.min(1, p)) n++;
    p -= 1;
  }
  return n;
}

/** Per-week box line for a player, from season averages + seeded variance. */
export function weekLine(p: Player, week: number): WeekLine {
  const s: PlayerStats = p.stats;
  const g = Math.max(1, s.games);
  const r = rng(hashStr(`${p.id}|wk${week}`));
  // volume multiplier: centered ~1, occasional boom/bust
  const v = 0.55 + r() * 1.0 + (r() < 0.12 ? 0.35 : 0); // ~0.55..1.9
  const yv = (base: number) => Math.round((base / g) * v);
  return {
    passYds: yv(s.passYds),
    passTds: sampleCount((s.passTds / g) * v, r),
    carries: yv(s.carries),
    rushYds: yv(s.rushYds),
    rushTds: sampleCount((s.rushTds / g) * v, r),
    targets: yv(s.targets),
    receptions: Math.min(yv(s.receptions), yv(s.targets)),
    recYds: yv(s.recYds),
    recTds: sampleCount((s.recTds / g) * v, r),
  };
}

/** Projected fantasy-ish weekly points (used for default lineup ranking). */
export function projectedPoints(p: Player, week: number): number {
  const l = weekLine(p, week);
  return (
    l.passYds * 0.04 + l.passTds * 4 +
    l.rushYds * 0.1 + l.rushTds * 6 +
    l.recYds * 0.1 + l.recTds * 6 + l.receptions * 1 +
    l.rushYds * 0 // noop, keeps formatting
  );
}

interface RawPlay {
  clock: number;
  kind: RealPlayKind;
  yards: number;
  td: boolean;
  catch: boolean;   // a reception happened
  target: boolean;  // the player was targeted
}

function spreadClocks(n: number, r: () => number): number[] {
  const cs: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = (GAME_SECONDS * (i + 0.5)) / n;
    cs.push(Math.round(Math.max(60, Math.min(GAME_SECONDS - 30, base + (r() - 0.5) * (GAME_SECONDS / n) * 0.8))));
  }
  return cs.sort((a, b) => a - b);
}

/** Turn a week line into discrete plays for a player. */
function buildPlays(p: Player, l: WeekLine, week: number): RawPlay[] {
  const r = rng(hashStr(`${p.id}|plays${week}`));
  const plays: RawPlay[] = [];

  if (p.pos === 'QB') {
    const n = Math.max(5, Math.min(12, Math.round(l.passYds / 26)));
    const clocks = spreadClocks(n, r);
    let remaining = l.passYds;
    let tdsLeft = l.passTds;
    for (let i = 0; i < n; i++) {
      const share = i === n - 1 ? remaining : Math.round((remaining / (n - i)) * (0.6 + r() * 0.8));
      remaining = Math.max(0, remaining - share);
      const td = tdsLeft > 0 && (r() < tdsLeft / (n - i));
      if (td) tdsLeft--;
      plays.push({ clock: clocks[i], kind: 'pass', yards: share, td, catch: false, target: false });
    }
    // QB scrambles
    if (l.rushYds > 15) {
      const rn = Math.min(3, Math.max(1, Math.round(l.rushYds / 30)));
      const rc = spreadClocks(rn, r);
      let rem = l.rushYds; let rtd = l.rushTds;
      for (let i = 0; i < rn; i++) {
        const y = i === rn - 1 ? rem : Math.round(rem / (rn - i));
        rem = Math.max(0, rem - y);
        const td = rtd > 0 && r() < 0.5; if (td) rtd--;
        plays.push({ clock: rc[i], kind: 'rush', yards: y, td, catch: false, target: false });
      }
    }
  } else if (p.pos === 'RB') {
    const carryChunks = Math.max(3, Math.min(8, Math.round(l.carries / 4)));
    const cc = spreadClocks(carryChunks, r);
    let rem = l.rushYds; let rtd = l.rushTds;
    for (let i = 0; i < carryChunks; i++) {
      const y = i === carryChunks - 1 ? rem : Math.round((rem / (carryChunks - i)) * (0.5 + r()));
      rem = Math.max(0, rem - y);
      const td = rtd > 0 && r() < rtd / (carryChunks - i); if (td) rtd--;
      plays.push({ clock: cc[i], kind: 'rush', yards: y, td, catch: false, target: false });
    }
    // receptions
    const rec = l.receptions;
    if (rec > 0) {
      const rcc = spreadClocks(rec, r);
      let remr = l.recYds; let rectd = l.recTds;
      for (let i = 0; i < rec; i++) {
        const y = i === rec - 1 ? remr : Math.round(remr / (rec - i));
        remr = Math.max(0, remr - y);
        const td = rectd > 0 && r() < 0.4; if (td) rectd--;
        plays.push({ clock: rcc[i], kind: 'rec', yards: y, td, catch: true, target: true });
      }
    }
  } else if (p.pos === 'K') {
    // Fallback only (real weeks supply actual kicks): a few FGs + XPs.
    for (const c of spreadClocks(3, r)) plays.push({ clock: c, kind: 'fg', yards: 28 + Math.round(r() * 27), td: false, catch: false, target: false });
    for (const c of spreadClocks(2, r)) plays.push({ clock: c, kind: 'xp', yards: 0, td: false, catch: false, target: false });
  } else if (p.pos === 'DEF') {
    // Fallback only: a couple sacks and a takeaway.
    for (const c of spreadClocks(2, r)) plays.push({ clock: c, kind: 'sack', yards: 0, td: false, catch: false, target: false });
    if (r() < 0.6) plays.push({ clock: spreadClocks(1, r)[0], kind: 'int', yards: 0, td: false, catch: false, target: false });
  } else {
    // WR / TE / other receivers
    const rec = Math.max(1, l.receptions);
    const rcc = spreadClocks(rec, r);
    let remr = l.recYds; let rectd = l.recTds;
    for (let i = 0; i < rec; i++) {
      const y = i === rec - 1 ? remr : Math.round((remr / (rec - i)) * (0.5 + r()));
      remr = Math.max(0, remr - y);
      const td = rectd > 0 && r() < rectd / (rec - i); if (td) rectd--;
      plays.push({ clock: rcc[i], kind: 'rec', yards: Math.max(0, y), td, catch: true, target: true });
    }
    // incompletions (targets without a catch)
    const incompletions = Math.max(0, l.targets - rec);
    if (incompletions > 0) {
      const ic = spreadClocks(incompletions, r);
      for (let i = 0; i < incompletions; i++) {
        plays.push({ clock: ic[i], kind: 'incomplete', yards: 0, td: false, catch: false, target: true });
      }
    }
  }
  return plays.sort((a, b) => a.clock - b.clock);
}

// Effect family of a metric → how it scores a single play and what it does.
function scorePlay(play: RawPlay, pos: Pos, metricId: string, hot: boolean): number {
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
    if (metricId === 'carries') return play.kind === 'rush' ? 1 : 0; // WIPE (the wipe is applied in resolveSlot)
  }
  if (pos === 'TE') {
    if (metricId === 'tgt') return play.target ? 1 : 0;
    if (metricId === 'rec') return play.catch ? 1.5 : 0;
    if (metricId === 'td') return play.td ? 8 : 0; // NUKE
    if (metricId === 'carries') return play.kind === 'rush' ? 1 : 0; // WIPE
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
}

interface MergedPlay extends RawPlay {
  side: 'you' | 'their';
}

const TEAM_ABBR = (p: Player) => p.team || 'NFL';

function playText(p: Player, play: RawPlay): string {
  const t = TEAM_ABBR(p);
  if (play.td) {
    if (play.kind === 'rush') return `${t} TD: ${p.name} ${play.yards}yd rush`;
    if (play.kind === 'rec') return `${t} TD: ${p.name} ${play.yards}yd catch`;
    return `${t} TD: ${p.name} ${play.yards}yd`;
  }
  if (play.kind === 'pass') return `${t}: ${p.name} ${play.yards}yd pass`;
  if (play.kind === 'rush') return `${t}: ${p.name} +${play.yards} rush`;
  if (play.kind === 'rec') return `${t}: ${p.name} +${play.yards} catch`;
  if (play.kind === 'fg') return `${t}: ${p.name} ${play.yards}yd FG good`;
  if (play.kind === 'fgmiss') return `${t}: ${p.name} ${play.yards}yd FG miss`;
  if (play.kind === 'xp') return `${t}: ${p.name} XP good`;
  if (play.kind === 'xpmiss') return `${t}: ${p.name} XP miss`;
  if (play.kind === 'sack') return `${t} D: sack`;
  if (play.kind === 'int') return `${t} D: interception`;
  if (play.kind === 'fumrec') return `${t} D: fumble recovered`;
  if (play.kind === 'dst_td') return `${t} D: TD`;
  if (play.kind === 'safety') return `${t} D: safety`;
  return `${t}: ${p.name} incomplete`;
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
    .map((p) => ({ clock: p.c, kind: p.k, yards: p.y, td: !!p.td, catch: !!p.ca, target: !!p.tg }))
    .sort((a, b) => a.clock - b.clock);
}

export function hasRealPbp(playerId: string, week: number): boolean {
  return realRawPlays(playerId, week) !== null;
}

/** Did this DST return an interception/fumble for a touchdown this week? (Pick Six) */
export function hadDefTd(player: Player, week: number): boolean {
  return playsForPlayer(player, week).plays.some((p) => p.kind === 'dst_td');
}
/** Did this QB throw a touchdown pass of at least `minYds` yards? (Hail Mary) */
export function hadLongPassTd(player: Player, week: number, minYds = 40): boolean {
  return playsForPlayer(player, week).plays.some((p) => p.kind === 'pass' && p.td && p.yards >= minYds);
}

/** A sentinel "no opponent" player — an unopposed slot resolves against it. */
export const EMPTY_PLAYER: Player = {
  id: '__empty__', name: '—', full: 'No opponent', pos: 'WR', team: '',
  stats: { games: 1, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 0 },
};

/** Real plays when available, otherwise the deterministic simulation. */
function playsForPlayer(player: Player, week: number): { plays: RawPlay[]; real: boolean } {
  if (player.id === EMPTY_PLAYER.id) return { plays: [], real: false };
  const r = realRawPlays(player.id, week);
  if (r) return { plays: r, real: true };
  return { plays: buildPlays(player, weekLine(player, week), week), real: false };
}

// Running box-score line for a player up to a clock — drives the live statline
// shown under each score card (real stats, independent of the metric scoring).
export interface StatLine {
  passYds: number; passTds: number;
  carries: number; rushYds: number; rushTds: number;
  targets: number; rec: number; recYds: number; recTds: number;
  fg: number; xp: number;
  sacks: number; ints: number; fumrec: number; dtd: number; safety: number;
}
export function statlineAt(player: Player, week: number, clock: number): StatLine {
  const { plays } = playsForPlayer(player, week);
  const s: StatLine = { passYds: 0, passTds: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, rec: 0, recYds: 0, recTds: 0, fg: 0, xp: 0, sacks: 0, ints: 0, fumrec: 0, dtd: 0, safety: 0 };
  for (const p of plays) {
    if (p.clock > clock) break; // plays are sorted ascending by clock
    switch (p.kind) {
      case 'pass': s.passYds += p.yards; if (p.td) s.passTds++; break;
      case 'rush': s.carries++; s.rushYds += p.yards; if (p.td) s.rushTds++; break;
      case 'rec': s.rec++; s.targets++; s.recYds += p.yards; if (p.td) s.recTds++; break;
      case 'incomplete': s.targets++; break;
      case 'fg': s.fg++; break;
      case 'xp': s.xp++; break;
      case 'sack': s.sacks++; break;
      case 'int': s.ints++; break;
      case 'fumrec': s.fumrec++; break;
      case 'dst_td': s.dtd++; break;
      case 'safety': s.safety++; break;
    }
  }
  return s;
}

// Field General (QB): passing yards build a live, window-wide multiplier on
// your OTHER players in the window — 1 + 0.003·(cumulative passing yds), so
// 300 yds ≈ 1.9×. Given the window's slot inputs for one side, returns a
// clock→multiplier function (or undefined if no FG QB is in the window).
const FG_RATE = 0.006;
export function windowFgMult(players: SlotInput[], week: number): ((clock: number) => number) | undefined {
  const timelines: RawPlay[][] = [];
  for (const p of players) {
    if (p.player.pos === 'QB' && p.metricId === 'fg') {
      const plays = realRawPlays(p.player.id, week) ?? buildPlays(p.player, weekLine(p.player, week), week);
      const passes = plays.filter((x) => x.kind === 'pass').sort((a, b) => a.clock - b.clock);
      if (passes.length) timelines.push(passes);
    }
  }
  if (!timelines.length) return undefined;
  return (clock: number) => {
    let m = 1;
    for (const passes of timelines) {
      let cum = 0;
      for (const x of passes) { if (x.clock <= clock) cum += x.yards; else break; }
      m *= 1 + FG_RATE * cum;
    }
    return m;
  };
}

// A DST's own defensive score for the week (sk1 / int3 / fr2 / def-TD6 /
// safety2) — used as the SUPPRESS kill-threshold. A suppress DST forgoes these
// points (it banks 0) and spends them as the bar every opponent slot must clear.
export function defEarnScore(player: Player, week: number): number {
  const plays = realRawPlays(player.id, week) ?? buildPlays(player, weekLine(player, week), week);
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
// such clock knocks every opposing drip rate down by 1.0 across the window.
export function teTdNukeClocks(players: SlotInput[], week: number): number[] {
  const clocks: number[] = [];
  for (const p of players) {
    if (p.player.pos === 'TE' && p.metricId === 'td') {
      const plays = realRawPlays(p.player.id, week) ?? buildPlays(p.player, weekLine(p.player, week), week);
      for (const x of plays) if (x.td) clocks.push(x.clock);
    }
  }
  return clocks.sort((a, b) => a - b);
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
export function resolveSlot(you: SlotInput, their: SlotInput, week: number, gameLabel: string, opts: { youMult?: (clock: number) => number; theirMult?: (clock: number) => number; youDripNukeClocks?: number[]; theirDripNukeClocks?: number[]; youBuffs?: Set<string>; theirBuffs?: Set<string> } = {}): SlotResolution & { gameLabel: string; real: boolean; maxClock: number; youTds: number; theirTds: number; youBankerXp: number; theirBankerXp: number; youDead: boolean; theirDead: boolean } {
  // Pre-match team buffs active on each side (Momentum / Garbage Time /
  // Floodgates / Overtime). Only the human side carries buffs in the demo.
  const youBuffs = opts.youBuffs ?? new Set<string>();
  const theirBuffs = opts.theirBuffs ?? new Set<string>();
  const GARBAGE_FROM = GAME_SECONDS - 300; // final 5 minutes
  const youOT = youBuffs.has('overtime') ? 300 : 0;
  const theirOT = theirBuffs.has('overtime') ? 300 : 0;
  const yp = playsForPlayer(you.player, week);
  const tp = playsForPlayer(their.player, week);
  const yPlays = yp.plays;
  const tPlays = tp.plays;
  const real = yp.real || tp.real;
  const merged: MergedPlay[] = [
    ...yPlays.map((p) => ({ ...p, side: 'you' as const })),
    ...tPlays.map((p) => ({ ...p, side: 'their' as const })),
  ].sort((a, b) => a.clock - b.clock);

  const Y: SideState = { bank: 0, hist: [], streak: 0, hot: false, kicks: 0, dead: false, rate: 0, paused: false };
  const T: SideState = { bank: 0, hist: [], streak: 0, hot: false, kicks: 0, dead: false, rate: 0, paused: false };
  const youFam = familyOf(you.player.pos, you.metricId);
  const theirFam = familyOf(their.player.pos, their.metricId);

  // Drip metrics: WR Receiving Yards (built by catches) and RB Rush Yards
  // (built by carries). A drip play raises a permanent rate (yds × 0.01
  // pts/min) that accrues over the player's team offensive time.
  const dripKindOf = (s: SlotInput): RealPlayKind[] | null =>
    (s.metricId === 'combodrip') ? ['rush', 'rec']                          // Combo Drip unlock: carries AND catches
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
  const youPoss = dripYou ? realPossFor(week, you.player.team) : [];
  const theirPoss = dripTheir ? realPossFor(week, their.player.team) : [];
  const events: PbpEvent[] = [];

  // TE Touchdowns (8-PT NUKE) reach across the whole window: each opposing TE
  // TD instantly knocks every one of your drip rates down by 1.0 pts/min (min
  // 0). The clocks of those TDs arrive via opts; we step through them during
  // accrual so the cut lands at the exact moment of the TD.
  const DRIP_NUKE = 1.0;
  const youNukeClocks = (opts.youDripNukeClocks ?? []).slice().sort((a, b) => a - b);
  const theirNukeClocks = (opts.theirDripNukeClocks ?? []).slice().sort((a, b) => a - b);
  let yNukeI = 0, tNukeI = 0;
  let lastClock = 0;
  // Per-minute gain for a side over (t0,t1] without mutating it.
  const minuteGain = (side: 'you' | 'their', t0: number, t1: number): number => {
    const s = side === 'you' ? Y : T;
    if (s.paused || s.dead || s.rate <= 0 || t1 <= t0) return 0;
    const poss = side === 'you' ? youPoss : theirPoss;
    const mult = side === 'you' ? opts.youMult : opts.theirMult;
    const buffs = side === 'you' ? youBuffs : theirBuffs;
    // Overtime: minutes past regulation count as full possession (no game clock
    // to gate them), so the drip keeps ticking for the bonus window.
    const secs = t0 >= GAME_SECONDS ? (buffs.has('overtime') ? t1 - t0 : 0) : offSecs(poss, t0, t1);
    if (secs <= 0) return 0;
    const hotMult = s.hot ? (buffs.has('momentum') ? 3 : 2) : 1; // Momentum: 3× when hot
    let add = s.rate * (secs / 60) * hotMult;
    if (buffs.has('garbage-time') && t1 > GARBAGE_FROM) add *= 2; // Garbage Time: final 5 min ×2
    const m = mult?.(t1); if (m && m !== 1) add *= m;
    return add;
  };
  // Accrue both drips across [from,to] one game-minute at a time, emitting a
  // tagged drip event (with running banks) each minute either side gains points
  // — so the log can show scoring tick up minute by minute.
  const accrueRange = (from: number, to: number) => {
    let t = from;
    while (t < to) {
      const next = Math.min(to, Math.floor(t / 60) * 60 + 60);
      const ya = dripYou ? minuteGain('you', t, next) : 0;
      const ta = dripTheir ? minuteGain('their', t, next) : 0;
      if (ya > 0) { Y.bank += ya; Y.hist.push({ clock: next, pts: ya }); }
      if (ta > 0) { T.bank += ta; T.hist.push({ clock: next, pts: ta }); }
      // Only surface a drip tick once it rounds to ≥0.1 — sub-0.1 still banks
      // silently and shows up in the next tick's cumulative.
      const yd = Math.round(ya * 10) / 10, td = Math.round(ta * 10) / 10;
      const ym = opts.youMult?.(next), tm = opts.theirMult?.(next);
      if (yd > 0) events.push({ clock: next, side: 'you', play: `${you.player.team || 'NFL'}: ${Y.hot ? 'HOT drip' : 'drip'}`, delta: yd, youBank: Math.round(Y.bank * 10) / 10, theirBank: Math.round(T.bank * 10) / 10, drip: true, mult: ym && ym !== 1 ? ym : undefined });
      if (td > 0) events.push({ clock: next, side: 'their', play: `${their.player.team || 'NFL'}: ${T.hot ? 'HOT drip' : 'drip'}`, delta: td, youBank: Math.round(Y.bank * 10) / 10, theirBank: Math.round(T.bank * 10) / 10, drip: true, mult: tm && tm !== 1 ? tm : undefined });
      t = next;
    }
  };
  const dripNuke = (s: SideState, side: 'you' | 'their', clock: number) => {
    if (s.rate <= 0) return;
    s.rate = Math.max(0, s.rate - DRIP_NUKE);
    events.push({ clock, side, play: `${(side === 'you' ? you : their).player.team || 'NFL'}: drip nuked`, delta: 0, youBank: Math.round(Y.bank * 10) / 10, theirBank: Math.round(T.bank * 10) / 10, effect: { type: 'nuke', text: `DRIP NUKED −${DRIP_NUKE.toFixed(1)}/min → ${s.rate.toFixed(2)}` } });
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
  // Counter-Nuke / Insurance fire once per slot, on the human side only.
  let cnUsed = false, insUsed = false;

  for (const play of merged) {
    accrue(play.clock);
    lastClock = play.clock;
    const mine = play.side === 'you' ? Y : T;
    const opp = play.side === 'you' ? T : Y;
    const oppSide: 'you' | 'their' = play.side === 'you' ? 'their' : 'you';
    // A big bank wipe of the victim (`opp`). Counter-Nuke (reflect onto the
    // attacker) and Insurance (keep half) protect YOUR slot the first time.
    const nukeWipe = (wiped: number): string => {
      if (oppSide === 'you' && youBuffs.has('counter-nuke') && !cnUsed) {
        cnUsed = true; const back = mine.bank; mine.bank = 0; mine.hist = [];
        return back > 0 ? ` · ↩ COUNTER-NUKE −${back.toFixed(1)}` : ' · ↩ COUNTER-NUKE';
      }
      if (oppSide === 'you' && youBuffs.has('insurance') && !insUsed) {
        insUsed = true; opp.bank = Math.round(wiped * 0.5 * 10) / 10; opp.hist = [];
        return ` · 🛟 INSURED ${opp.bank.toFixed(1)}`;
      }
      opp.bank = 0; opp.hist = [];
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
    let sig = false; // a signature play this tick → +5 drip coin to the acting side
    let evMult: number | undefined; // FG multiplier shown on this play in the log
    const sideMult = (play.side === 'you' ? opts.youMult?.(play.clock) : opts.theirMult?.(play.clock)) ?? 1;
    if (iAmDrip) {
      if (myDripKind?.includes(play.kind)) {
        mine.rate += play.yards * myDripRate;
        mine.paused = false;
        mine.streak += 1;
        if (mine.streak >= 3 && !mine.hot) { mine.hot = true; sig = true; } // drip goes HOT
      }
    } else {
      pts = scorePlay(play, myPlayer.player.pos, myPlayer.metricId, myFam === 'streak' && mine.hot);
      if (mine.dead) pts = 0;
      if (sideMult !== 1 && pts > 0) { pts *= sideMult; evMult = sideMult; }
      // Garbage Time: points scored in the final 5 game-minutes count double.
      if (pts > 0 && play.clock > GARBAGE_FROM && (play.side === 'you' ? youBuffs : theirBuffs).has('garbage-time')) pts *= 2;
    }
    // Field General QB: scores nothing itself, but each pass grows the window
    // multiplier — surface it in the QB's own log so you can watch it build.
    const isFG = myPlayer.player.pos === 'QB' && myPlayer.metricId === 'fg';
    if (isFG && play.kind === 'pass') evMult = sideMult;

    mine.bank += pts;
    if (pts > 0) mine.hist.push({ clock: play.clock, pts });

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

    // WR/TE Carries (WIPE, unlock): a carry instantly zeroes the opponent —
    // fires against any opponent (drip included), like compression.
    if ((myPlayer.player.pos === 'WR' || myPlayer.player.pos === 'TE') && myPlayer.metricId === 'carries' && play.kind === 'rush' && opp.bank > 0) {
      const wiped = opp.bank;
      const suffix = nukeWipe(wiped); opp.paused = true;
      if (!effect) effect = { type: 'nuke', text: `✕ CARRY WIPE −${wiped.toFixed(1)}${suffix}` };
      sig = true;
    }

    // streak / drip badges
    if (!effect && iAmDrip && myDripKind?.includes(play.kind)) effect = { type: 'streak', text: mine.hot ? `DRIP HOT 2× · ${mine.rate.toFixed(2)}/min` : `DRIP ↑ ${mine.rate.toFixed(2)}/min` };
    if (!effect && myFam === 'streak') {
      if (play.td) effect = { type: 'streak', text: 'TD → STREAK 2×' };
      else if (mine.hot && play.catch) effect = { type: 'streak', text: 'HOT STREAK · 2×' };
    }
    if (!effect && oppFam === 'streak' && pts > 0) {
      effect = { type: 'cold', text: 'STREAK COLD' };
    }
    if (!effect && isFG && play.kind === 'pass') effect = { type: 'mult', text: `FIELD GENERAL ×${sideMult.toFixed(2)}` };

    events.push({
      clock: play.clock,
      side: play.side,
      play: playText(myPlayer.player, play),
      mult: evMult,
      delta: Math.round(pts * 10) / 10,
      youBank: Math.round(Y.bank * 10) / 10,
      theirBank: Math.round(T.bank * 10) / 10,
      effect,
      sig,
    });
  }

  // Final drip accrual through the end of the game (per-minute, like the rest).
  // Overtime extends the window 5 minutes for whichever side armed it.
  accrue(GAME_SECONDS + Math.max(youOT, theirOT));

  // DEF SUPPRESS (HALVING) resolves globally in buildMatchup — it reaches every
  // opponent slot across every window — so it is not applied here.

  const maxClock = events.length ? Math.max(...events.map((e) => e.clock)) : GAME_SECONDS;
  return {
    events,
    youFinal: Math.round(Y.bank * 10) / 10,
    theirFinal: Math.round(T.bank * 10) / 10,
    gameLabel,
    real,
    maxClock,
    youTds, theirTds, youBankerXp, theirBankerXp,
    youDead: Y.dead, theirDead: T.dead,
  };
}

export { GAME_SECONDS, fmtClock };
