import type { Player, WindowId, GameWindow, Pick, PbpEvent, BuffFx } from '../types';
import { METRICS } from '../data/metrics';
import { capAmplifiers, isAmplifier } from '../data/powerups';
import { teamRoster, getPlayer } from '../data/league';
import { hashStr } from '../data/players';
import {
  WEEKLY_STIPEND, UNOPPOSED_COIN, SUPPRESS_COIN, TURNOVER_COIN, WINDOW_WIN_BONUS, WINDOW_MVP_COIN_PER_SLOT,
  metricCoin, coinRisk, threwTrickTd, battleVerdict, coinBreakdown, BUFF_AWARDS, type SideLens,
} from './scoringRules';
import { applyPostSlotPipeline, RIVALRY_SIPHON, LEAD_CHANGE_BONUS, GRUDGE_MARGIN, GRUDGE_SWING } from './orchestrate';
export { RIVALRY_SIPHON, LEAD_CHANGE_BONUS, GRUDGE_MARGIN, GRUDGE_SWING };
// THE RULES LIVE IN scoringRules.ts (v0.340.0) — this engine and liveResolve
// both call the same functions now. Re-exported here because the web and the
// app have always imported the tuned numbers from this module.
export { WEEKLY_STIPEND, UNOPPOSED_COIN, SUPPRESS_COIN, TURNOVER_COIN, WINDOW_WIN_BONUS, WINDOW_MVP_COIN_PER_SLOT, metricCoin, coinRisk, threwTrickTd };

/** A real-time swap on a slot (Player/Metric Swap/Mulligan). It takes effect
 *  from `atRt` — the REAL wall-clock time of activation (seconds from the
 *  player's first snap) — so plays already final in real time stay on the old
 *  config even if the feed clock lagged. `atClock` is the game-clock the feed
 *  showed at activation, kept for display and as a fallback when a player has
 *  no real timestamps baked. */
export interface SlotSwap { atClock: number; atRt?: number; toMetricId?: string; toPlayerId?: string; }
export type SlotSwaps = Record<string, SlotSwap>; // slotKey -> swap
import { resolveSlot, projectedPoints, windowFgMult, windowShield, teTdNukeClocks, defSuppressScore, turnoversCommitted, clockAtRealTime, statlineAt, fmtClock, EMPTY_PLAYER, GHOST_PLAYER, GHOST_POINTS, type SlotInput } from './sim';
import { REAL_WEEKS } from '../data/realPbp';
import { windowForTeam, windowsForWeek, gamesInWindow, windowKickoffMs } from '../data/nflSlate';

/** Which of a side's armed buffs count for one WINDOW (v0.373.0): a buff armed
 *  mid-week only counts windows that kick off AFTER it was armed — arming Hail
 *  Mary after watching Thursday's TD land must not score Thursday. No arm-time
 *  map (legacy payloads, the opponent's set, demo pre-arm) = the full set. */
export function buffsForWindow(all: Set<string>, at: Record<string, number> | undefined, week: number, win: string): Set<string> {
  if (!at || all.size === 0) return all;
  const k = windowKickoffMs(week, win as WindowId);
  if (k == null) return all;
  const out = new Set([...all].filter((b) => at[b] == null || at[b] < k));
  return out.size === all.size ? all : out;
}
import { injuryFor } from '../data/injuries';

// A roster grouped into the 5 windows by each player's REAL NFL game time slot
// that week (their team's kickoff). A player only appears in — and can only be
// assigned to — the window their game falls in. Players on bye don't appear.
export function windowPools(teamId: string, week: number): Record<WindowId, Player[]> {
  const pools: Record<WindowId, Player[]> = {};
  for (const w of windowsForWeek(week)) pools[w.id] = [];
  for (const p of teamRoster(teamId)) {
    const win = windowForTeam(week, p.team);
    if (win && pools[win]) pools[win].push(p);
  }
  for (const w of Object.keys(pools)) pools[w].sort((a, b) => projectedPoints(b, week) - projectedPoints(a, week));
  return pools;
}

/** Roster players whose NFL team is on bye this week (not assignable anywhere).
 *  A bye is only asserted when the week's slate is actually loaded AND the
 *  player's team is known but genuinely absent from it — an unloaded slate or an
 *  unknown team code must never masquerade as a bye (e.g. Week 1, which has no
 *  real byes at all). */
export function byePlayers(teamId: string, week: number): Player[] {
  const anyGames = windowsForWeek(week).some((w) => gamesInWindow(week, w.id).length > 0);
  if (!anyGames) return [];
  return teamRoster(teamId).filter((p) => p.team && !windowForTeam(week, p.team));
}

/** A deterministic hidden metric for an auto/opponent pick. */
export function pickMetric(p: Player, week: number): string {
  // Unlock (locked) metrics are never auto-assigned — they require a powerup.
  const list = (METRICS[p.pos] || METRICS.WR).filter((m) => !m.lock);
  const idx = hashStr(`${p.id}|m${week}`) % list.length;
  return list[idx].id;
}

// Smart metric pick (used by the AI opponent and the default lineup): choose the
// metric that scores this player the most on the week, evaluated solo against an
// empty opponent. This makes the opponent field each player's best role — a
// rushing back on Rush Yards, a multi-TD receiver on the TD nuke, etc. — instead
// of a random metric. (Field General scores 0 solo, so it's never auto-picked;
// it's a coordination play left to the human.)
export function bestMetric(p: Player, week: number, projection = false): string {
  // Underdog is a paid unlock now (lock: 'unlock-underdog'), so the generic
  // lock filter keeps it out of the auto-pick — the tuned default/AI meta is
  // untouched (it scores flat solo, no trailing boost vs an empty opponent).
  const list = (METRICS[p.pos] || METRICS.WR).filter((m) => !m.lock);
  if (list.length <= 1) return list[0]?.id ?? pickMetric(p, week);
  let best = list[0].id, bestScore = -Infinity;
  for (const m of list) {
    const res = resolveSlot({ player: p, metricId: m.id }, { player: EMPTY_PLAYER, metricId: 'none' }, week, '', { projection });
    if (res.youFinal > bestScore) { bestScore = res.youFinal; best = m.id; }
  }
  return best;
}

// The AI ranks players by historical (per-game season) production — never the
// week's actual box score. K/DST have no projectable stat line, so they get a
// nominal baseline so they still get fielded at a sensible priority.
function projForRank(p: Player, week: number): number {
  if (p.pos === 'K') return 8;
  if (p.pos === 'DEF') return 7;
  if (p.pos === 'LB') return 8;            // tackle volume ≈ a reliable starter
  if (p.pos === 'DL' || p.pos === 'DB') return 7;
  return projectedPoints(p, week);
}

export function slotKey(win: WindowId, idx: number): string {
  return `${win}#${idx}`;
}

// Power-ups the AI opponent loads with. Limited to whole-lineup buffs that affect
// head-to-head scoring from the opponent's (their) side — so the AI always
// benefits from arming them. RETRAINED from the playtester lever sweep
// (tools/playtester/aggregate.mjs, findings §17): the three drip amplifiers are
// the only buffs with real honest-field lift (overtime +17.1 / momentum +18.1 /
// garbage-time +17.6 margin); floodgates and ot-shield measured DEAD vs an
// honest field (0 to +3 lift — nobody nukes blind) and only diluted the draw.
const AI_BUFF_POOL = ['momentum', 'garbage-time', 'overtime'];

/** The AI's three armed power-ups for the week — a deterministic random draw,
 *  seeded per team+week, from the buffs it can actually use. */
export function aiBuffs(teamId: string, week: number): string[] {
  const pool = [...AI_BUFF_POOL];
  const out: string[] = [];
  let seed = hashStr(`${teamId}|buffs|${week}`);
  for (let i = 0; i < 3 && pool.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; // LCG step for a varied draw
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  // The demo AI's buffs are free (no wallet), so grant the amp capacity its
  // draw needs — otherwise capAmplifiers would silently waste part of the draw.
  const amps = out.filter(isAmplifier).length;
  if (amps >= 2) out.push('amp-2');
  if (amps >= 3) out.push('amp-3');
  return out;
}

// Average net edge (AI score − opponent score) for an AI player+metric against a
// window's likely opponents. The AI knows only the POOL — which players the
// opponent CAN field this window — never which player is in which spot (sealed
// until the window goes live), so it defends against the threat SET, not a
// specific slot. An optional FG window multiplier applies when evaluating a
// Field General regime.
function edgeVsThreats(aiPlayer: Player, metricId: string, threats: SlotInput[], week: number, aiBuffSet: Set<string>, mult?: (c: number) => number): number {
  // The AI is the "their" side; the threat is "you". Always evaluated in
  // projection mode (historical expectation), never the week's real box score.
  const opts = { theirBuffs: aiBuffSet, theirMult: mult, projection: true } as const;
  if (!threats.length) {
    return resolveSlot({ player: EMPTY_PLAYER, metricId: 'none' }, { player: aiPlayer, metricId }, week, '', opts).theirFinal;
  }
  let sum = 0;
  for (const t of threats) {
    const r = resolveSlot(t, { player: aiPlayer, metricId }, week, '', opts);
    sum += r.theirFinal - r.youFinal;
  }
  return sum / threats.length;
}

// Best metric (and its edge) for an AI player vs the window's threats, optionally
// boosted by an FG multiplier. Field General is excluded here — it's decided at
// the window level (it scores the QB nothing and only pays off via teammates).
function bestVsThreats(aiPlayer: Player, threats: SlotInput[], week: number, aiBuffSet: Set<string>, mult?: (c: number) => number): { metricId: string; edge: number } {
  const list = (METRICS[aiPlayer.pos] || METRICS.WR).filter((m) => !m.lock && m.id !== 'fg'); // underdog is lock-gated now
  if (!list.length) return { metricId: pickMetric(aiPlayer, week), edge: 0 };
  let best = list[0].id, bestEdge = -Infinity;
  for (const m of list) {
    const e = edgeVsThreats(aiPlayer, m.id, threats, week, aiBuffSet, mult);
    if (e > bestEdge) { bestEdge = e; best = m.id; }
  }
  return { metricId: best, edge: bestEdge };
}

/**
 * AI opponent lineup. Per window it (1) fields its best eligible players in every
 * slot it can fill — never conceding a contestable slot unopposed — and (2) picks
 * metrics to maximize its NET edge against the window's THREAT SET: the opponent's
 * top eligible players. It only knows the pool (who CAN be fielded each window),
 * not which spot each is in. It runs a QB as Field General only when boosting its
 * window-mates beats the QB scoring for itself; otherwise it answers drips/big
 * scorers with denial metrics. Its own armed power-ups are used in the eval.
 */
export function aiLineup(aiTeamId: string, humanTeamId: string, week: number, extra?: ExtraSlots): Record<string, Pick> {
  const aiPools = windowPools(aiTeamId, week);
  const humanPools = windowPools(humanTeamId, week);
  const healthy = (p: Player) => { const s = injuryFor(week, p.id); return s !== 'O' && s !== 'IR'; };
  // Rank by historical (projected) production — the AI never sees the week's
  // actual results when setting its lineup.
  const rank = (ps: Player[]) => ps.filter(healthy).sort((a, b) => projForRank(b, week) - projForRank(a, week));
  const aiBuffSet = new Set(aiBuffs(aiTeamId, week));
  const reg = 3300; // projection runs regulation only (no actual-week overtime peek)
  const picks: Record<string, Pick> = {};
  for (const w of windowsForWeek(week)) {
    const n = slotsFor(w.id, week, extra);
    const aiPlayers = rank(aiPools[w.id]).slice(0, n);
    if (!aiPlayers.length) continue;
    // Threats: the opponent's likely fielded set this window (best n eligible by
    // projection), each on its own best projected self-metric.
    const threats: SlotInput[] = rank(humanPools[w.id]).slice(0, n).map((p) => ({ player: p, metricId: bestMetric(p, week, true) }));

    // Plan A — no Field General: each AI player on its best counter-metric.
    const planA = aiPlayers.map((p) => bestVsThreats(p, threats, week, aiBuffSet));
    let metrics = planA.map((x) => x.metricId);
    let bestTotal = planA.reduce((s, x) => s + x.edge, 0);

    // Plan B — Field General: the lead QB runs FG and the window multiplier boosts
    // every other slot. Taken only if its total net edge beats Plan A.
    const qbIdx = aiPlayers.findIndex((p) => p.pos === 'QB');
    if (qbIdx >= 0 && aiPlayers.length >= 2) {
      const fgMult = windowFgMult([{ player: aiPlayers[qbIdx], metricId: 'fg' }], week, { reg, stack: aiBuffSet.has('fg-stack'), projection: true });
      if (fgMult) {
        const planB = aiPlayers.map((p, i) => i === qbIdx
          ? { metricId: 'fg', edge: edgeVsThreats(p, 'fg', threats, week, aiBuffSet) } // scores 0; pays off via the boost
          : bestVsThreats(p, threats, week, aiBuffSet, fgMult));                        // boosted by the FG multiplier
        const totalB = planB.reduce((s, x) => s + x.edge, 0);
        if (totalB > bestTotal) { metrics = planB.map((x) => x.metricId); bestTotal = totalB; }
      }
    }

    aiPlayers.forEach((p, i) => { picks[slotKey(w.id, i)] = { playerId: p.id, metricId: metrics[i] }; });
  }
  return picks;
}

/** Bye Steal flat-score ceiling — one constant for BOTH engines (the demo path
 *  above and liveResolve, which re-exports it). RETUNED by the playtester
 *  sweep (findings §19): at the original 25 the play measured 66.3% / 4.45
 *  pts per ◎10 — the best coin in the game by a wide margin; at 16 it lands
 *  60.0% / 2.49 per ◎10, the amp neighborhood, while still beating Ghost
 *  (you earned the edge by rostering the bye stud). */
export const BYE_STEAL_CAP = 16;

// RIVALRY_SIPHON lives in engine/orchestrate.ts (re-exported below).

/** Extra-slot powerups: per-window count of bonus slots applied this week. */
export type ExtraSlots = Partial<Record<WindowId, number>>;
/** Slots in a window including any Extra Slot powerups applied this week. The
 *  window's base slot count is derived per week from the real slate. */
export function slotsFor(win: WindowId, week: number, extra?: ExtraSlots): number {
  const base = windowsForWeek(week).find((w) => w.id === win)?.slots ?? 0;
  return base + (extra?.[win] ?? 0);
}
/** Total lineup slots across all windows including extras. */
export function totalSlotsWith(week: number, extra?: ExtraSlots): number {
  return windowsForWeek(week).reduce((n, w) => n + slotsFor(w.id, week, extra), 0);
}

/**
 * Seed a lineup honoring the real time-slot windows: within each window, field
 * that window's eligible players (the ones whose NFL game falls in it), best
 * first — by real fantasy points on a baked week, else by projection. Windows
 * with no eligible roster player are left empty (realistic).
 */
export function defaultLineup(teamId: string, week: number, extra?: ExtraSlots): Record<string, Pick> {
  const pools = windowPools(teamId, week);
  // Never auto-field a player ruled Out or on IR (the AI opponent uses this too,
  // so it never starts an unavailable player). Questionable/Doubtful are fine.
  const healthy = (p: Player) => { const s = injuryFor(week, p.id); return s !== 'O' && s !== 'IR'; };
  const picks: Record<string, Pick> = {};
  for (const w of windowsForWeek(week)) {
    // Projection-based, like the AI: rank healthy eligible players by historical
    // per-game production and give each its best projected metric — no peeking at
    // the week's actual box score. Every slot we can field is filled (fielding a
    // low projection still contests the slot vs. conceding a free unopposed spot).
    const ranked = pools[w.id].filter(healthy).sort((a, b) => projForRank(b, week) - projForRank(a, week));
    for (let i = 0; i < slotsFor(w.id, week, extra); i++) {
      const p = ranked[i];
      if (p) picks[slotKey(w.id, i)] = { playerId: p.id, metricId: bestMetric(p, week, true) };
    }
  }
  return picks;
}

export interface ResolvedSlot {
  win: WindowId;
  slotIndex: number;
  you: { player: Player; metricId: string } | null;
  their: { player: Player; metricId: string } | null;
  events: PbpEvent[];
  youFinal: number;
  theirFinal: number;
  gameLabel: string;
  real: boolean;
  // Unopposed → BACKUP: this player doesn't score directly; its score can
  // replace a starter slot of the same side if higher.
  backup?: boolean;
  backupScore?: number;   // the score this backup would post
  backupUsed?: boolean;   // it was subbed into a starter slot
  // A backup subbed INTO this slot, per side (the backup's score replaces the
  // starter's). Side-aware so a yours-vs-theirs slot can show each correctly.
  youSub?: { name: string; score: number; from: number };
  theirSub?: { name: string; score: number; from: number };
  // A DEF on SUPPRESS scores 0 but forgoes this many earn points (spent as the
  // kill-threshold) — shown crossed out.
  suppressSpentYou?: number;
  suppressSpentTheir?: number;
  // Score reduced by an opposing DEF SUPPRESS (halved) — the value before it.
  youHalvedFrom?: number;
  theirHalvedFrom?: number;
  // Zeroed for the rest of the game by an opposing K SHUTDOWN (negated).
  youNegated?: boolean;
  theirNegated?: boolean;
  byeStolen?: boolean;          // a bye player fielded here for a flat projection
  ghostFielded?: boolean;       // a Ghost Player phantom conjured here for a flat set score
  youStake?: 'won' | 'lost';    // Double or Nothing result on this slot (at FINAL)
  youRivalry?: number;          // points siphoned TO you via the Rivalry power-up (same-position mirror)
  theirRivalry?: number;        // points siphoned to THEM via their Rivalry (live H2H)
  youLeadChange?: number;       // Lead Change bonus banked (you seized the lead N times → +2 each)
  youGrudge?: 'won' | 'lost' | 'push'; // Grudge Match stake outcome on this slot
  youGrudgePts?: number;        // the ± points the grudge paid/cost
  theirRedHerringFrom?: number; // this opponent slot was capped by your Red Herring — its score before
  theirJinxed?: boolean;        // the opponent's first TD here was negated by your Jinx
  youEncore?: boolean;          // your Encore fired (a post-arm TD banked the +12 bonus)
  youCounterWiped?: boolean;    // your Counter-Wipe negated an opponent nuke here
  youClutchStake?: 'won' | 'lost'; // Clutch (halftime) Double-or-Nothing outcome
  // Powerup-driven scoring changes on this slot, per side — shown in the spot at FINAL.
  youBuffFx?: BuffFx[];
  theirBuffFx?: BuffFx[];
  // The live Field General multiplier this side's window applies (product of every
  // same-side FG QB's ramp), as a function of game clock — undefined when no FG QB
  // is fielded in the window. Lets a boosted slot show its current ×N.
  youFgMult?: (clock: number) => number;
  theirFgMult?: (clock: number) => number;
}

// WINDOW BATTLE: each window is its own head-to-head. The side with the higher
// window total wins the window (+ a flat WINDOW_WIN_BONUS), and the single
// highest-scoring slot in the window earns its side the Window MVP drip-coin
// bounty (coin only — no points). Surfaced live and at FINAL so every window
// reads as a fought battle, not just a slice of the point total.
export interface WindowBattle {
  youTotal: number;
  theirTotal: number;
  youSlotsWon: number;
  theirSlotsWon: number;
  winner: 'you' | 'their' | 'push';
  bonus: number;                 // points awarded to the winner (0 on a push/uncontested window)
  mvp?: { side: 'you' | 'their'; slotIndex: number; score: number; name: string; coin: number };
}

export interface ResolvedWindow {
  window: GameWindow;
  slots: ResolvedSlot[];
  battle?: WindowBattle;
}

export interface ResolvedMatchup {
  windows: ResolvedWindow[];
  youFinal: number;
  theirFinal: number;
  real: boolean;
  maxClock: number;
  /** DISPLAY RECORD of the staked plays and armed awards that fired (labels +
   *  the delta each contributed). Their points are ALREADY inside the slot
   *  finals (the canonical pipeline bakes every stake and award into its slot
   *  before the window battles, v0.341.0) — never add these to a total. */
  bonuses?: { id: string; label: string; points: number }[];
  youWindowsWon: number;   // windows whose head-to-head you won
  theirWindowsWon: number;
}

// LEAD_CHANGE_BONUS / GRUDGE_* live in engine/orchestrate.ts (re-exported below).

/** Compute the head-to-head battle for one resolved window from its slots'
 *  final scores (call after backups + suppress so the tested scores are final).
 *  A window is only "contested" — and only awards a bonus — when both sides
 *  fielded at least one slot in it. */
export function computeWindowBattle(w: ResolvedWindow): WindowBattle {
  let youTotal = 0, theirTotal = 0, youSlotsWon = 0, theirSlotsWon = 0;
  let mvpScore = 0, mvpSide: 'you' | 'their' | null = null, mvpIdx = -1, mvpName = '';
  let anyYou = false, anyTheir = false;
  for (const s of w.slots) {
    youTotal += s.youFinal; theirTotal += s.theirFinal;
    if (s.you) anyYou = true;
    if (s.their) anyTheir = true;
    if (s.you && s.their) { if (s.youFinal > s.theirFinal) youSlotsWon++; else if (s.theirFinal > s.youFinal) theirSlotsWon++; }
    if (s.you && s.youFinal > mvpScore) { mvpScore = s.youFinal; mvpSide = 'you'; mvpIdx = s.slotIndex; mvpName = s.you.player.name; }
    if (s.their && s.theirFinal > mvpScore) { mvpScore = s.theirFinal; mvpSide = 'their'; mvpIdx = s.slotIndex; mvpName = s.their.player.name; }
  }
  // The verdict rule (margin, bonus) is shared with the live resolver.
  const v = battleVerdict(youTotal, theirTotal, anyYou && anyTheir);
  const winner: 'you' | 'their' | 'push' = v.winner === 'a' ? 'you' : v.winner === 'b' ? 'their' : 'push';
  const bonus = v.bonus;
  return {
    youTotal: Math.round(youTotal * 10) / 10,
    theirTotal: Math.round(theirTotal * 10) / 10,
    youSlotsWon, theirSlotsWon, winner, bonus,
    mvp: mvpSide && mvpScore > 0 ? { side: mvpSide, slotIndex: mvpIdx, score: Math.round(mvpScore * 10) / 10, name: mvpName, coin: WINDOW_MVP_COIN_PER_SLOT * w.slots.length } : undefined,
  };
}


function lookup(pools: Record<WindowId, Player[]>, picks: Record<string, Pick>, key: string): { player: Player; metricId: string } | null {
  const pk = picks[key];
  if (!pk) return null;
  for (const w of Object.values(pools)) {
    const found = w.find((p) => p.id === pk.playerId);
    // ── NEVER INVENT A METRIC (v0.336.0) ──────────────────────────────────
    // This was `pk.metricId ?? pickMetric(found, 0)` — the position's default,
    // substituted client-side whenever a pick arrived without one.
    //
    // That is a SECOND RULEBOOK. The server scores what is STORED: `scorePlay`
    // is a chain of `if (metricId === '…')` ending in `return 0`, so a pick
    // with no metric banks nothing all window. The web board meanwhile drew
    // "Rush Yards" over it and accrued a drip rate for a metric nobody
    // fielded — promising points that could never arrive.
    //
    // Found because the two clients disagreed in front of the founder: the
    // same pick, at the same moment, read "Rush Yards DRIP" on web and
    // "NO METRIC · scores 0" on the phone. The phone was right; the web was
    // defaulting. Two clients disagreeing is the only reason anyone looked —
    // on its own the web board was perfectly plausible and simply wrong.
    //
    // EMPTY STRING rather than null: `SlotInput.metricId` is `string` through
    // the whole resolver, and '' is already this engine's "no metric" value
    // (resolveSlot takes `metricId: ''` for the unopposed seat). `scorePlay('')`
    // matches no branch and returns 0 — the server's answer — and
    // `isMetricSet('')` is false, so both boards now say NO METRIC · scores 0.
    if (found) return { player: found, metricId: pk.metricId ?? '' };
  }
  return null;
}

/**
 * Resolve a full head-to-head week. `youPicks` may be partial (SETUP in
 * progress); unfilled slots resolve as empty. Opponent picks are always the
 * sealed default lineup.
 */
export function buildMatchup(
  youTeamId: string,
  oppTeamId: string,
  week: number,
  youPicks: Record<string, Pick>,
  oppPicks: Record<string, Pick>,
  extraSlots: ExtraSlots = {},
  swaps: SlotSwaps = {},
  backupAssign: Record<string, string> = {},
  buffs: Record<string, boolean> = {},
  extras: { doubleOrNothing?: string; byeSteal?: { slotKey: string; playerId: string }; ghost?: string[]; emp?: Partial<Record<WindowId, number>>; rivalry?: WindowId[]; leadChange?: string[]; grudge?: string[]; jinx?: string[]; redHerring?: string[]; underdog?: string[]; surge?: Record<string, number>; coldSnap?: Record<string, number>; napalm?: Record<string, number>; bunker?: Record<string, number>; clutchDon?: string[]; clutchEncore?: Record<string, number>; clutchCounter?: Record<string, number>; buffsAt?: Record<string, number> } = {},
  realResolve = false, // resolve cross-game effects (TE-TD drip nuke) in real-time order
  oppBuffs?: string[], // live H2H: the opponent's REAL armed buffs (revealed at lock); AI default when omitted
): ResolvedMatchup {
  const youPools = windowPools(youTeamId, week);
  const oppPools = windowPools(oppTeamId, week);

  // COMBO DRIP is one-for-one (one slot per unlock purchased). The demo/sim
  // board already enforces this at pick time — sealing a locked metric consumes
  // one unlock from inventory (Matchup.tsx useConsumable) — and the AI fields
  // at most one (aiLineup), so no engine-side cap is needed here. The live
  // resolver (resolveLiveMatchup) caps by purchased quantity.

  const windows: ResolvedWindow[] = [];
  let anyReal = false;
  let maxClock = 3300;
  // Lineup-wide tallies for the K banker bonus (each XP your banker kicker
  // makes adds +1 to each of your TDs scored under a TD-counting metric).
  let youTds = 0, theirTds = 0, youBankerXp = 0, theirBankerXp = 0;
  // DEF SUPPRESS (HALVING) threshold: a suppress DST's own defensive week score
  // is the bar — every OPPOSING slot (any window) scoring at or below it is
  // halved. The DST banks 0; it spends its points as the threshold. With more
  // than one suppress DST per side, the highest threshold applies.
  let youSuppress = 0, theirSuppress = 0;
  // Armed pre-match buffs that modify scoring (Momentum / Garbage Time /
  // Floodgates / Overtime). Only the human side carries buffs in the demo.
  // Drip AMPLIFIERS are capacity-limited (1 + Second Amp + Third Amp).
  const youBuffSet = capAmplifiers(new Set(Object.keys(buffs).filter((k) => buffs[k])));
  // The opponent's armed power-ups: their REAL revealed loadout in a live H2H
  // matchup, else the AI's deterministic three (demo / pre-reveal).
  const theirBuffSet = capAmplifiers(new Set<string>(oppBuffs ?? aiBuffs(oppTeamId, week)));

  for (const w of windowsForWeek(week)) {
    const nSlots = slotsFor(w.id, week, extraSlots);
    // Pre-pass: collect this window's filled slots per side, so a Field
    // General QB can build a window-wide multiplier on its own side.
    const youIns: SlotInput[] = [];
    const theirIns: SlotInput[] = [];
    for (let i = 0; i < nSlots; i++) {
      const y = lookup(youPools, youPicks, slotKey(w.id, i));
      const t = lookup(oppPools, oppPicks, slotKey(w.id, i));
      if (y) youIns.push({ player: y.player, metricId: y.metricId });
      if (t) theirIns.push({ player: t.player, metricId: t.metricId });
    }
    const reg = REAL_WEEKS.has(week) ? 3600 : 3300;
    // Buffs armed mid-week only count windows kicking after the arm (v0.373.0).
    const youWinBuffs = buffsForWindow(youBuffSet, extras.buffsAt, week, w.id);
    const youMult = windowFgMult(youIns, week, { reg, carryOT: youWinBuffs.has('overtime'), stack: youWinBuffs.has('fg-stack') });
    const theirMult = windowFgMult(theirIns, week, { reg, carryOT: theirBuffSet.has('overtime'), stack: theirBuffSet.has('fg-stack') });
    // Field Marshal (DEF): a defensive general builds a window-wide shield that
    // blunts opposing nukes/erases against this side's whole window.
    const youShield = windowShield(youIns, week, { reg, carryOT: youWinBuffs.has('overtime') });
    const theirShield = windowShield(theirIns, week, { reg, carryOT: theirBuffSet.has('overtime') });
    // TE TD nukes reach across the window: your TEs' TD clocks knock down the
    // opponents' drips, and vice-versa.
    const youTeTd = teTdNukeClocks(youIns, week);
    const theirTeTd = teTdNukeClocks(theirIns, week);

    const slots: ResolvedSlot[] = [];
    for (let i = 0; i < nSlots; i++) {
      const key = slotKey(w.id, i);
      const you = lookup(youPools, youPicks, key);
      const their = lookup(oppPools, oppPicks, key);

      if (you && you.player.pos === 'DEF' && you.metricId === 'suppress') youSuppress = Math.max(youSuppress, defSuppressScore(you.player, week));
      if (their && their.player.pos === 'DEF' && their.metricId === 'suppress') theirSuppress = Math.max(theirSuppress, defSuppressScore(their.player, week));

      let events: PbpEvent[] = [];
      let yF = 0;
      let tF = 0;
      let gameLabel = w.label;
      let real = false;
      let displayYou = you; // may reflect a real-time swap
      let youNegated = false, theirNegated = false;
      let theirJinxed = false, youEncore = false, youCounterWiped = false;
      let youBuffFx: BuffFx[] | undefined, theirBuffFx: BuffFx[] | undefined;
      // A suppress DST forgoes its earn points (spent as the kill-threshold).
      const suppressSpentYou = (you?.player.pos === 'DEF' && you.metricId === 'suppress') ? defSuppressScore(you.player, week) : undefined;
      const suppressSpentTheir = (their?.player.pos === 'DEF' && their.metricId === 'suppress') ? defSuppressScore(their.player, week) : undefined;

      // Resolve whenever at least one side is filled. An unopposed slot plays
      // against the empty sentinel — the present player banks points with no
      // opposing interactions (see EMPTY_PLAYER).
      if (you || their) {
        const yIn: SlotInput = you ? { player: you.player, metricId: you.metricId } : { player: EMPTY_PLAYER, metricId: 'none' };
        const tIn: SlotInput = their ? { player: their.player, metricId: their.metricId } : { player: EMPTY_PLAYER, metricId: 'none' };
        gameLabel = `${you?.player.team || 'BYE'} · ${their?.player.team || 'BYE'}`;
        const empClock = extras.emp?.[w.id];
        // Cross-game TE-TD drip nukes: game-resolve fires them at their own game
        // clock (window in lockstep); real-resolve lands each on the RECEIVING
        // player's game clock at the nuke's real time, so a nuke from a game
        // that's real-time ahead/behind hits at the right wall-clock moment.
        const nukeClocks = (nukes: { c: number; rt: number }[], recv: SlotInput) =>
          realResolve ? nukes.map((n) => clockAtRealTime(recv.player, week, n.rt, recv.metricId)) : nukes.map((n) => n.c);
        // JINX: you armed it blind on this slot → the opponent ('their') here
        // has their first TD negated.
        const theirJinx = extras.jinx?.includes(key);
        // Live tactical power-ups on this slot (10-min windows from the fire clock;
        // Bunker is from the fire clock onward). Surge/Bunker boost/protect YOUR
        // side; Cold Snap freezes the OPPONENT ('their') here.
        const win10 = (c: number | undefined): [number, number] | undefined => (c != null ? [c, c + 600] : undefined);
        const youSurge = win10(extras.surge?.[key]);
        const theirFreeze = win10(extras.coldSnap?.[key]);
        const theirNapalm = win10(extras.napalm?.[key]); // burns the opponent's hot drip here
        const youBunkerFrom = extras.bunker?.[key];
        // Clutch (conditional) power-ups armed on this slot: Encore (+12 on a
        // post-arm TD) and Counter-Wipe (negate a nuke at its recorded clock).
        const youDoubleTd = extras.clutchEncore?.[key];
        const youCounterWipe = extras.clutchCounter?.[key];
        // UNDERDOG modifier (0257): armed from the hand on YOUR slot — the slot
        // keeps its metric; trailing scores bank ×1.5 (resolveSlot applies it).
        const youUnderdog = extras.underdog?.includes(key);
        const opts = { youMult, theirMult, youShield, theirShield, youDripNukeClocks: nukeClocks(theirTeTd, yIn), theirDripNukeClocks: nukeClocks(youTeTd, tIn), youBuffs: youWinBuffs, theirBuffs: theirBuffSet, theirEmpFreeze: empClock != null ? [empClock, empClock + 600] as [number, number] : undefined, theirJinx, youSurge, theirFreeze, theirNapalm, youBunkerFrom, youDoubleTd, youCounterWipe, youUnderdog, realResolve };
        let res = resolveSlot(yIn, tIn, week, gameLabel, opts);
        if (theirJinx && their) theirJinxed = res.events.some((e) => e.effect?.text.includes('JINXED'));
        if (youDoubleTd != null && you) youEncore = res.events.some((e) => e.effect?.text.includes('ENCORE'));
        if (youCounterWipe != null && you) youCounterWiped = res.events.some((e) => e.effect?.text.includes('COUNTER-WIPE'));

        // Real-time swap (Player/Metric Swap): keep your pre-swap banked points,
        // then add only the new config's gains after the swap clock. Both sides'
        // pre-swap banks come from the original config; post-swap from the new.
        const swap = you ? swaps[key] : undefined;
        if (swap) {
          const swapped = getPlayer(swap.toPlayerId ?? '') ?? you!.player;
          const newYIn: SlotInput = { player: swap.toPlayerId ? swapped : you!.player, metricId: swap.toMetricId ?? you!.metricId };
          const sres = resolveSlot(newYIn, tIn, week, gameLabel, opts);
          // Cut over on the REAL-TIME stamp: map it back to this game's clock
          // along the pre-swap player's timeline. With no baked timestamps this
          // resolves to swap.atClock (identity), so behavior is unchanged.
          const C = swap.atRt != null ? clockAtRealTime(you!.player, week, swap.atRt, you!.metricId ?? undefined) : swap.atClock;
          const base = banksAtClock(res.events, C);
          const after = banksAtClock(sres.events, C);
          const youFinal = Math.max(0, base.you + Math.max(0, sres.youFinal - after.you));
          const theirFinal = Math.max(0, base.their + (sres.theirFinal - after.their));
          const mergedEvents = [...res.events.filter((e) => e.clock < C), ...sres.events.filter((e) => e.clock >= C)];
          res = { ...sres, events: mergedEvents, youFinal: Math.round(youFinal * 10) / 10, theirFinal: Math.round(theirFinal * 10) / 10 };
          displayYou = { player: newYIn.player, metricId: newYIn.metricId };
        }

        events = res.events;
        yF = res.youFinal;
        tF = res.theirFinal;
        real = res.real;
        if (real) anyReal = true;
        if (res.maxClock > maxClock) maxClock = res.maxClock;
        youTds += res.youTds; theirTds += res.theirTds;
        youBankerXp += res.youBankerXp; theirBankerXp += res.theirBankerXp;
        youNegated = res.youDead; theirNegated = res.theirDead;
        youBuffFx = res.youBuffFx; theirBuffFx = res.theirBuffFx;
        // A suppress DST scores its earn in the log, but banks 0 itself — those
        // points are spent as the halving threshold (suppressSpent), not kept.
        if (suppressSpentYou != null) yF = 0;
        if (suppressSpentTheir != null) tF = 0;
      }

      // Bye Steal: an empty slot can be filled with a benched bye player for a
      // flat projected score (no live game — it just banks its projection).
      // Clamped at BYE_STEAL_CAP — the same ceiling the live resolver applies
      // (a demo/live parity gap until v0.126.0: the demo banked the raw
      // projection while live clamped at 25).
      let byeStolen = false;
      if (extras.byeSteal && extras.byeSteal.slotKey === key && !displayYou) {
        const bp = getPlayer(extras.byeSteal.playerId);
        if (bp) { displayYou = { player: bp, metricId: 'bye' }; yF = Math.min(BYE_STEAL_CAP, Math.round(projectedPoints(bp, week) * 10) / 10); byeStolen = true; }
      }

      // Ghost Player: an empty slot can be filled with a phantom that banks a
      // flat set score (GHOST_POINTS) — no bench player needed, no live game.
      let ghostFielded = false;
      if (extras.ghost?.includes(key) && !displayYou) {
        displayYou = { player: GHOST_PLAYER, metricId: 'ghost' }; yF = GHOST_POINTS; ghostFielded = true;
      }

      slots.push({ win: w.id, slotIndex: i, you: displayYou, their, events, youFinal: yF, theirFinal: tF, gameLabel, real, suppressSpentYou, suppressSpentTheir, youNegated: youNegated || undefined, theirNegated: theirNegated || undefined, theirJinxed: theirJinxed || undefined, youEncore: youEncore || undefined, youCounterWiped: youCounterWiped || undefined, byeStolen: byeStolen || undefined, ghostFielded: ghostFielded || undefined, youBuffFx, theirBuffFx, youFgMult: youMult, theirFgMult: theirMult });
    }
    windows.push({ window: w, slots });
  }

  // ── THE CANONICAL POST-SLOT PIPELINE (engine/orchestrate.ts) ─────────────
  // backups → suppress → banker → DoN → clutch DoN → awards → rivalry →
  // red herring → lead change → grudge — shared verbatim with the live
  // resolver, so the board can no longer run these in its own order or leave
  // a stake outside the window battles (which is exactly what it did until
  // v0.341.0: DoN, the clutch stake, Grudge and the flat awards were
  // post-battle bonuses[] deltas here while the official resolver baked them
  // into the slot — grand totals agreed, window outcomes did not). The
  // bonuses[] list survives as the DISPLAY RECORD of what fired; its points
  // are already in the slot finals and are never re-added.
  const all = windows.flatMap((w) => w.slots);
  const bonuses: { id: string; label: string; points: number }[] = [];
  const awardsFor = (side: 'you' | 'their', buffSet: Set<string>): { key: string; pts: number }[] => {
    const out: { key: string; pts: number }[] = [];
    for (const a of BUFF_AWARDS) {
      if (!buffSet.has(a.id)) continue;
      const slot = all.find((sl) => {
        const p = side === 'you' ? sl.you : sl.their;
        // Mid-week arm: the award only pays from windows kicking after it
        // (only YOUR arm times are known here; the opponent's come from the
        // official resolver).
        if (side === 'you' && !buffsForWindow(buffSet, extras.buffsAt, week, sl.win).has(a.id)) return false;
        return p && a.hit(p.player, week);
      });
      if (!slot) continue;
      out.push({ key: slotKey(slot.win, slot.slotIndex), pts: a.pts });
      if (side === 'you') {
        const p = (slot.you)!.player;
        bonuses.push({ id: a.id, points: a.pts, label: a.label(p.name) });
      }
    }
    return out;
  };
  applyPostSlotPipeline(all, {
    week,
    a: {
      lens: sideLens('you'), evSide: 'you',
      backups: backupAssign,
      suppress: youSuppress, banker: youBankerXp * youTds,
      don: extras.doubleOrNothing, clutchDon: extras.clutchDon,
      awards: awardsFor('you', youBuffSet),
      rivalry: extras.rivalry, redHerring: extras.redHerring,
      leadChange: extras.leadChange, grudge: extras.grudge,
      hooks: {
        backupZeroed: (b, wouldBe) => { b.backup = true; b.backupScore = wouldBe; },
        backupSubbed: (b, st, score, from) => { st.youSub = { name: b.you!.player.name, score, from }; b.backupUsed = true; },
        suppressHalved: (sl, from) => { sl.youHalvedFrom = from; },
        staked: (sl, id, won, from) => {
          if (id === 'double-or-nothing') sl.youStake = won ? 'won' : 'lost';
          else sl.youClutchStake = won ? 'won' : 'lost';
          const nm = sl.you!.player.name;
          bonuses.push(id === 'double-or-nothing'
            ? { id, points: won ? from : -from, label: won ? `Double or Nothing — ${nm} WON ×2` : `Double or Nothing — ${nm} LOST → 0` }
            : { id, points: won ? from : -from, label: won ? `Clutch Double — ${nm} WON ×2` : `Clutch Double — ${nm} LOST → 0` });
        },
        rivalryTook: (sl, take) => { sl.youRivalry = Math.round(((sl.youRivalry ?? 0) + take) * 10) / 10; },
        herringCapped: (sl, from) => { sl.theirRedHerringFrom = from; },
        leadChanged: (sl, bonus) => { sl.youLeadChange = bonus; },
        grudged: (sl, verdict, diff) => {
          sl.youGrudge = verdict; sl.youGrudgePts = verdict === 'won' ? GRUDGE_SWING : verdict === 'lost' ? -GRUDGE_SWING : 0;
          if (verdict === 'push') return;
          const nm = sl.you!.player.name;
          bonuses.push(verdict === 'won'
            ? { id: 'grudge', points: GRUDGE_SWING, label: `Grudge Match — ${nm} WON by ${diff.toFixed(1)} → +${GRUDGE_SWING}` }
            : { id: 'grudge', points: -GRUDGE_SWING, label: `Grudge Match — ${nm} LOST → −${GRUDGE_SWING}` });
        },
      },
    },
    b: {
      lens: sideLens('their'), evSide: 'their',
      backups: {},
      suppress: theirSuppress, banker: theirBankerXp * theirTds,
      awards: awardsFor('their', theirBuffSet),
      hooks: {
        backupZeroed: (b, wouldBe) => { b.backup = true; b.backupScore = wouldBe; },
        backupSubbed: (b, st, score, from) => { st.theirSub = { name: b.their!.player.name, score, from }; b.backupUsed = true; },
        suppressHalved: (sl, from) => { sl.theirHalvedFrom = from; },
      },
    },
    eventsOf: (sl) => sl.events,
  });

  // WINDOW BATTLE: settle each window's head-to-head on its final slot scores.
  // The winner banks a flat bonus and the window MVP is tagged (coin only). Done
  // after backups + suppress (and the banker credit) so the tested per-slot
  // scores are final.
  let youWindowsWon = 0, theirWindowsWon = 0, youWindowBonus = 0, theirWindowBonus = 0;
  for (const w of windows) {
    const b = computeWindowBattle(w);
    w.battle = b;
    if (b.winner === 'you') { youWindowsWon++; youWindowBonus += b.bonus; }
    else if (b.winner === 'their') { theirWindowsWon++; theirWindowBonus += b.bonus; }
  }

  let youFinal = 0, theirFinal = 0;
  for (const w of windows) for (const s of w.slots) { youFinal += s.youFinal; theirFinal += s.theirFinal; }

  // Window-battle bonuses layer on top of the raw slot totals (both sides).
  youFinal += youWindowBonus;
  theirFinal += theirWindowBonus;

  // bonuses[] (built by the pipeline hooks above) is the display record of
  // the staked plays and awards that fired — their points are ALREADY in the
  // slot finals the sums above counted, so nothing is re-added here. Until
  // v0.341.0 this loop added them on top of the battles' totals, which kept
  // the deltas out of every window and out of the published rows.

  return {
    windows,
    youFinal: Math.round(youFinal * 10) / 10,
    theirFinal: Math.round(theirFinal * 10) / 10,
    real: anyReal,
    maxClock,
    bonuses: bonuses.length ? bonuses : undefined,
    youWindowsWon,
    theirWindowsWon,
  };
}

// ── Clutch plays (conditional, transient-availability power-ups) ─────────────
// A clutch offer unlocks from a LIVE game-state trigger on a slot and is only
// arm-able for a limited game-clock window. Detected from the slot's own resolved
// timeline so the live board can surface an offer while `armFrom ≤ clock < armUntil`.
export interface ClutchOffer { id: 'clutch-don' | 'clutch-encore' | 'clutch-counter'; slotKey: string; armFrom: number; armUntil: number; note: string; }
const CLUTCH_HALFTIME = 1800; // 30:00 game clock
const CLUTCH_WINDOW = 300;    // how long an offer stays open (game seconds)
export function clutchOffers(slot: ResolvedSlot, week: number): ClutchOffer[] {
  const out: ClutchOffer[] = [];
  if (!slot.you) return out;
  const key = slotKey(slot.win, slot.slotIndex);
  // Halftime lead ≥10 → conditional Double or Nothing (arm before Q3 develops).
  if (slot.their) {
    const half = banksAtClock(slot.events, CLUTCH_HALFTIME);
    if (half.you - half.their >= 10) out.push({ id: 'clutch-don', slotKey: key, armFrom: CLUTCH_HALFTIME, armUntil: CLUTCH_HALFTIME + CLUTCH_WINDOW, note: `Up ${(half.you - half.their).toFixed(1)} at half` });
  }
  // A first-half TD → Encore: the next TD banks +12 (arm any time before the end).
  const h1 = statlineAt(slot.you.player, week, CLUTCH_HALFTIME, slot.you.metricId ?? undefined);
  const h1tds = h1.passTds + h1.rushTds + h1.recTds + h1.retTds;
  if (h1tds > 0) out.push({ id: 'clutch-encore', slotKey: key, armFrom: CLUTCH_HALFTIME, armUntil: 3300, note: `${h1tds} first-half TD` });
  // An opponent nuke wiped you → Counter-Wipe, open for a short window after it.
  const wipe = [...slot.events].reverse().find((e) => e.side === 'their' && e.effect?.type === 'nuke' && /wiped|NUKE|WIPE/i.test(e.effect.text));
  if (wipe) out.push({ id: 'clutch-counter', slotKey: key, armFrom: wipe.clock, armUntil: wipe.clock + CLUTCH_WINDOW, note: `Nuked at ${fmtClock(wipe.clock)}` });
  return out;
}

// ── Drip-coin economy — the rules live in scoringRules.ts ────────────────────

export interface WeekEarnings { stipend: number; unopposed: number; signature: number; mvp: number; turnover: number; total: number; }
/**
 * A side's full weekly drip-coin take: stipend + unopposed bounty + coin from
 * events of note + the turnover transfer. A player who throws an INT or loses a
 * fumble forfeits `turnoverCoin` to the opponent — so YOUR giveaways cost you
 * and the opponent's giveaways pay you. (Dormant until the MCP exposes
 * per-player turnovers — see turnoversCommitted.)
 */
export function weekEarnings(m: ResolvedMatchup, side: 'you' | 'their', week: number, turnoverCoin = TURNOVER_COIN): WeekEarnings {
  // The itemized economy is the SHARED rule (scoringRules.coinBreakdown) — the
  // worker banks the same breakdown's total, so what this modal promises is
  // what the wallet receives by construction, not by hand-sync.
  const b = coinBreakdown(m.windows.flatMap((w) => w.slots).map((s) => ({
    player: (side === 'you' ? s.you : s.their)?.player,
    metricId: (side === 'you' ? s.you : s.their)?.metricId,
    opp: (side === 'you' ? s.their : s.you)?.player,
    events: s.events,
    evSide: side,
  })), week, turnoverCoin);
  // Window MVP bounty (coin only): the single highest-scoring slot per window.
  let mvp = 0;
  for (const w of m.windows) if (w.battle?.mvp && w.battle.mvp.side === side) mvp += w.battle.mvp.coin;
  return { stipend: b.stipend, unopposed: b.unopposed, signature: b.signature, mvp, turnover: b.turnover, total: b.subtotal + mvp };
}

/**
 * Drip coin a single spot earned for one side — everything weekEarnings counts
 * except the global weekly stipend (unopposed bounty + suppress + events of note
 * + the turnover swing). Surfaced as a per-spot stat at FINAL.
 */
export function slotCoin(slot: ResolvedSlot, side: 'you' | 'their', week: number, turnoverCoin = TURNOVER_COIN, upToClock = Infinity, battle?: WindowBattle): number {
  const me = side === 'you' ? slot.you : slot.their;
  const opp = side === 'you' ? slot.their : slot.you;
  let c = 0;
  if (me) {
    if (!opp) c += UNOPPOSED_COIN;
    if (me.metricId === 'suppress') c += SUPPRESS_COIN;
    // Window MVP bounty: this slot posted the window's top score (final only).
    if (battle?.mvp && battle.mvp.side === side && battle.mvp.slotIndex === slot.slotIndex && upToClock === Infinity) c += battle.mvp.coin;
    const rate = metricCoin(me.player.pos, me.metricId);
    for (const e of slot.events) if (e.side === side && e.coin && e.clock <= upToClock) c += e.coinAmt ?? rate;
    c -= turnoverCoin * turnoversCommitted(me.player, week); // your giveaway → you lose
  }
  if (opp) c += turnoverCoin * turnoversCommitted(opp.player, week); // their giveaway → you gain
  return Math.round(c);
}

/**
 * Best-ball backups: a side's unopposed slots (player present, no opponent)
 * don't score directly. Instead the highest backup replaces the side's lowest
 * starter score when it beats it — greedily pairing the biggest backups with
 * the smallest beatable starters to maximize the side's total.
 */
/** This engine's SideLens over ResolvedSlot — how the shared rules in
 *  scoringRules.ts read one side of the board's rows. */
function sideLens(side: 'you' | 'their'): SideLens<ResolvedSlot> {
  return {
    key: (s) => slotKey(s.win, s.slotIndex),
    win: (s) => s.win,
    player: (s) => (side === 'you' ? s.you : s.their)?.player,
    metric: (s) => (side === 'you' ? s.you : s.their)?.metricId ?? null,
    opp: (s) => (side === 'you' ? s.their : s.you)?.player,
    get: (s) => (side === 'you' ? s.youFinal : s.theirFinal),
    set: (s, v) => { if (side === 'you') s.youFinal = v; else s.theirFinal = v; },
  };
}


/** Running banks at a given clock (live phase) for one slot's event feed. The live
 *  totals recompute this for every slot on every ~700ms tick; it's a pure O(events)
 *  scan of an events array that only changes when the matchup re-resolves, so cache
 *  results keyed by the array's identity → clock. Idle/finished windows (clock
 *  unchanged tick-to-tick) become O(1); a re-resolution yields fresh arrays whose
 *  old cache entries are garbage-collected with them (WeakMap). */
const banksCache = new WeakMap<PbpEvent[], Map<number, { you: number; their: number }>>();
export function banksAtClock(events: PbpEvent[], clock: number): { you: number; their: number } {
  let byClock = banksCache.get(events);
  if (!byClock) { byClock = new Map(); banksCache.set(events, byClock); }
  const hit = byClock.get(clock);
  if (hit) return hit;
  let you = 0;
  let their = 0;
  for (const e of events) {
    if (e.clock > clock) break;
    you = e.youBank;
    their = e.theirBank;
  }
  const res = { you, their };
  byClock.set(clock, res);
  return res;
}

/** HOT / NUKED at a playback clock, from a slot's own play-by-play — the sim
 *  mirror of the worker's `flagsFor` (engine/liveResolve.ts), which feeds the
 *  same flags to LiveBoard's cards from published slot_scores. Attribution:
 *    • hot — the side's own drip/streak badges carry the state; the LATEST one
 *      before the clock wins (🔥 HOT / STREAK 2× turns it on, a plain DRIP ↑
 *      tick turns it off), and an opponent's STREAK COLD or a nuke cools it.
 *    • nuked — latches once a nuke lands on this side: TD/erasure nukes ride
 *      the ATTACKER's play (sig), TE-TD drip nukes sit on the VICTIM's own
 *      standalone event. */
export function liveCardFlags(events: PbpEvent[], side: 'you' | 'their', clock: number): { hot: boolean; nuked: boolean } {
  let hot = false, nuked = false;
  for (const e of events) {
    if (e.clock > clock) continue;
    const t = e.effect?.text ?? e.play ?? '';
    if (e.side === side) {
      if (e.effect?.type === 'streak' || e.drip) hot = t.includes('HOT') || t.includes('STREAK 2×');
    } else if (e.effect?.type === 'cold') hot = false;
    // Giveaways are typed 'nuke' for the log's red ✕ (they pay the opponent
    // coin) but wipe nothing — a pick-six thrower isn't a scorched card.
    if (e.effect?.type === 'nuke' && !t.includes('TURNOVER') && (e.sig ? e.side !== side : e.side === side)) { nuked = true; hot = false; }
  }
  return { hot, nuked };
}
