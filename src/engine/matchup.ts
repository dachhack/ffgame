import type { Player, WindowId, Pick, PbpEvent, Pos, BuffFx } from '../types';
import { WINDOWS, METRICS, metricById } from '../data/metrics';
import { teamRoster, getPlayer } from '../data/league';
import { hashStr } from '../data/players';

/** A real-time swap on a slot (Player/Metric Swap/Mulligan). It takes effect
 *  from `atRt` — the REAL wall-clock time of activation (seconds from the
 *  player's first snap) — so plays already final in real time stay on the old
 *  config even if the feed clock lagged. `atClock` is the game-clock the feed
 *  showed at activation, kept for display and as a fallback when a player has
 *  no real timestamps baked. */
export interface SlotSwap { atClock: number; atRt?: number; toMetricId?: string; toPlayerId?: string; }
export type SlotSwaps = Record<string, SlotSwap>; // slotKey -> swap
import { resolveSlot, projectedPoints, windowFgMult, teTdNukeClocks, defEarnScore, hadDefTd, hadLongPassTd, turnoversCommitted, clockAtRealTime, EMPTY_PLAYER, type SlotInput } from './sim';
import { REAL_WEEKS, realPointsFor } from '../data/realPbp';
import { windowForTeam } from '../data/nflSlate';
import { injuryFor } from '../data/injuries';

// A roster grouped into the 5 windows by each player's REAL NFL game time slot
// that week (their team's kickoff). A player only appears in — and can only be
// assigned to — the window their game falls in. Players on bye don't appear.
export function windowPools(teamId: string, week: number): Record<WindowId, Player[]> {
  const pools: Record<WindowId, Player[]> = { tnf: [], early: [], late: [], snf: [], mnf: [] };
  for (const p of teamRoster(teamId)) {
    const win = windowForTeam(week, p.team);
    if (win) pools[win].push(p);
  }
  for (const w of Object.keys(pools) as WindowId[]) pools[w].sort((a, b) => projectedPoints(b, week) - projectedPoints(a, week));
  return pools;
}

/** Roster players whose NFL team is on bye this week (not assignable anywhere). */
export function byePlayers(teamId: string, week: number): Player[] {
  return teamRoster(teamId).filter((p) => !windowForTeam(week, p.team));
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
  return projectedPoints(p, week);
}

export function slotKey(win: WindowId, idx: number): string {
  return `${win}#${idx}`;
}

// Power-ups the AI opponent loads with. Limited to whole-lineup buffs that affect
// head-to-head scoring from the opponent's (their) side — so the AI always
// benefits from arming them (drip/OT buffs; reactive/bonus buffs are human-only).
const AI_BUFF_POOL = ['momentum', 'garbage-time', 'floodgates', 'overtime', 'ot-shield'];

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
  const list = (METRICS[aiPlayer.pos] || METRICS.WR).filter((m) => !m.lock && m.id !== 'fg');
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
  for (const w of WINDOWS) {
    const n = slotsFor(w.id, extra);
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

/** Extra-slot powerups: per-window count of bonus slots applied this week. */
export type ExtraSlots = Partial<Record<WindowId, number>>;
/** Slots in a window including any Extra Slot powerups applied this week. */
export function slotsFor(win: WindowId, extra?: ExtraSlots): number {
  const base = WINDOWS.find((w) => w.id === win)?.slots ?? 0;
  return base + (extra?.[win] ?? 0);
}
/** Total lineup slots across all windows including extras. */
export function totalSlotsWith(extra?: ExtraSlots): number {
  return WINDOWS.reduce((n, w) => n + slotsFor(w.id, extra), 0);
}

/**
 * Seed a lineup honoring the real time-slot windows: within each window, field
 * that window's eligible players (the ones whose NFL game falls in it), best
 * first — by real fantasy points on a baked week, else by projection. Windows
 * with no eligible roster player are left empty (realistic).
 */
export function defaultLineup(teamId: string, week: number, extra?: ExtraSlots): Record<string, Pick> {
  const pools = windowPools(teamId, week);
  const real = REAL_WEEKS.has(week);
  const pts = real ? realPointsFor(week) : {};
  // Never auto-field a player ruled Out or on IR (the AI opponent uses this too,
  // so it never starts an unavailable player). Questionable/Doubtful are fine.
  const healthy = (p: Player) => { const s = injuryFor(week, p.id); return s !== 'O' && s !== 'IR'; };
  const picks: Record<string, Pick> = {};
  for (const w of WINDOWS) {
    // Field every slot we can: rank healthy eligible players best-first, but don't
    // drop players who lack a box score — fielding a 0-point player still contests
    // the slot, which denies the opponent a free unopposed (best-ball) spot.
    const ranked = real
      ? pools[w.id].filter(healthy).sort((a, b) => (pts[b.id] || 0) - (pts[a.id] || 0))
      : pools[w.id].filter(healthy); // already projection-sorted
    for (let i = 0; i < slotsFor(w.id, extra); i++) {
      const p = ranked[i];
      if (p) picks[slotKey(w.id, i)] = { playerId: p.id, metricId: bestMetric(p, week) };
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
  backupHalf?: boolean;        // not subbed, but banked half its score (2+ unopposed)
  backupHalfEligible?: boolean; // this side has 2+ unopposed slots, so half-credit applies
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
  youStake?: 'won' | 'lost';    // Double or Nothing result on this slot (at FINAL)
  // Powerup-driven scoring changes on this slot, per side — shown in the spot at FINAL.
  youBuffFx?: BuffFx[];
  theirBuffFx?: BuffFx[];
  // The live Field General multiplier this side's window applies (product of every
  // same-side FG QB's ramp), as a function of game clock — undefined when no FG QB
  // is fielded in the window. Lets a boosted slot show its current ×N.
  youFgMult?: (clock: number) => number;
  theirFgMult?: (clock: number) => number;
}

export interface ResolvedWindow {
  window: typeof WINDOWS[number];
  slots: ResolvedSlot[];
}

export interface ResolvedMatchup {
  windows: ResolvedWindow[];
  youFinal: number;
  theirFinal: number;
  real: boolean;
  maxClock: number;
  bonuses?: { id: string; label: string; points: number }[]; // armed-buff payouts that hit
}

/** Deterministic ~6%/player-week chance a non-QB threw a TD pass (Trick Play). */
export function threwTrickTd(playerId: string, week: number): boolean {
  return hashStr(`${playerId}|trickpass|${week}`) % 100 < 6;
}

function lookup(pools: Record<WindowId, Player[]>, picks: Record<string, Pick>, key: string): { player: Player; metricId: string } | null {
  const pk = picks[key];
  if (!pk) return null;
  for (const w of Object.values(pools)) {
    const found = w.find((p) => p.id === pk.playerId);
    if (found) return { player: found, metricId: pk.metricId ?? pickMetric(found, 0) };
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
  extras: { doubleOrNothing?: string; byeSteal?: { slotKey: string; playerId: string }; emp?: Partial<Record<WindowId, number>> } = {},
  realResolve = false, // resolve cross-game effects (TE-TD drip nuke) in real-time order
): ResolvedMatchup {
  const youPools = windowPools(youTeamId, week);
  const oppPools = windowPools(oppTeamId, week);

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
  const youBuffSet = new Set(Object.keys(buffs).filter((k) => buffs[k]));
  // The AI opponent loads with its own three armed power-ups (deterministic per
  // team+week), so its side gets the same buff treatment the human's does.
  const theirBuffSet = new Set<string>(aiBuffs(oppTeamId, week));

  for (const w of WINDOWS) {
    const nSlots = slotsFor(w.id, extraSlots);
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
    const youMult = windowFgMult(youIns, week, { reg, carryOT: youBuffSet.has('overtime'), stack: youBuffSet.has('fg-stack') });
    const theirMult = windowFgMult(theirIns, week, { reg, carryOT: theirBuffSet.has('overtime'), stack: theirBuffSet.has('fg-stack') });
    // TE TD nukes reach across the window: your TEs' TD clocks knock down the
    // opponents' drips, and vice-versa.
    const youTeTd = teTdNukeClocks(youIns, week);
    const theirTeTd = teTdNukeClocks(theirIns, week);

    const slots: ResolvedSlot[] = [];
    for (let i = 0; i < nSlots; i++) {
      const key = slotKey(w.id, i);
      const you = lookup(youPools, youPicks, key);
      const their = lookup(oppPools, oppPicks, key);

      if (you && you.player.pos === 'DEF' && you.metricId === 'suppress') youSuppress = Math.max(youSuppress, defEarnScore(you.player, week));
      if (their && their.player.pos === 'DEF' && their.metricId === 'suppress') theirSuppress = Math.max(theirSuppress, defEarnScore(their.player, week));

      let events: PbpEvent[] = [];
      let yF = 0;
      let tF = 0;
      let gameLabel = w.label;
      let real = false;
      let displayYou = you; // may reflect a real-time swap
      let youNegated = false, theirNegated = false;
      let youBuffFx: BuffFx[] | undefined, theirBuffFx: BuffFx[] | undefined;
      // A suppress DST forgoes its earn points (spent as the kill-threshold).
      const suppressSpentYou = (you?.player.pos === 'DEF' && you.metricId === 'suppress') ? defEarnScore(you.player, week) : undefined;
      const suppressSpentTheir = (their?.player.pos === 'DEF' && their.metricId === 'suppress') ? defEarnScore(their.player, week) : undefined;

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
        const opts = { youMult, theirMult, youDripNukeClocks: nukeClocks(theirTeTd, yIn), theirDripNukeClocks: nukeClocks(youTeTd, tIn), youBuffs: youBuffSet, theirBuffs: theirBuffSet, theirEmpFreeze: empClock != null ? [empClock, empClock + 600] as [number, number] : undefined, realResolve };
        let res = resolveSlot(yIn, tIn, week, gameLabel, opts);

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
      let byeStolen = false;
      if (extras.byeSteal && extras.byeSteal.slotKey === key && !displayYou) {
        const bp = getPlayer(extras.byeSteal.playerId);
        if (bp) { displayYou = { player: bp, metricId: 'bye' }; yF = Math.round(projectedPoints(bp, week) * 10) / 10; byeStolen = true; }
      }

      slots.push({ win: w.id, slotIndex: i, you: displayYou, their, events, youFinal: yF, theirFinal: tF, gameLabel, real, suppressSpentYou, suppressSpentTheir, youNegated: youNegated || undefined, theirNegated: theirNegated || undefined, byeStolen: byeStolen || undefined, youBuffFx, theirBuffFx, youFgMult: youMult, theirFgMult: theirMult });
    }
    windows.push({ window: w, slots });
  }

  // Unopposed players are BACKUPS (best-ball insurance): a backup doesn't score
  // in its own slot, but its highest score can replace your lowest starter's
  // score when it beats it. Applied per side, before suppress/sum.
  applyBackups(windows, 'you', backupAssign, false); // your backups: manual only
  applyBackups(windows, 'their', {}, true);          // opponent: auto-maximize

  // DEF SUPPRESS (HALVING): your suppress DST halves every opposing slot (any
  // window) that scored at or below its threshold; their DST does the same to
  // your slots. Applied once per slot, after all in-slot scoring resolves.
  if (youSuppress > 0 || theirSuppress > 0) {
    for (const w of windows) for (const s of w.slots) {
      if (theirSuppress > 0 && s.youFinal > 0 && s.youFinal <= theirSuppress) { s.youHalvedFrom = s.youFinal; s.youFinal = Math.round(s.youFinal * 0.5 * 10) / 10; }
      if (youSuppress > 0 && s.theirFinal > 0 && s.theirFinal <= youSuppress) { s.theirHalvedFrom = s.theirFinal; s.theirFinal = Math.round(s.theirFinal * 0.5 * 10) / 10; }
    }
  }

  let youFinal = 0, theirFinal = 0;
  for (const w of windows) for (const s of w.slots) { youFinal += s.youFinal; theirFinal += s.theirFinal; }

  // K banker (XP BONUS): +1 per banker XP to each of your TDs that was scored
  // under a TD-counting metric (yardage metrics don't qualify).
  youFinal += youBankerXp * youTds;
  theirFinal += theirBankerXp * theirTds;

  // Armed pre-match team buffs: flat payouts when their condition hits among
  // your starting spots. Each scans your filled slots for a triggering player.
  const myPlayers = windows.flatMap((w) => w.slots).filter((s) => s.you).map((s) => s.you!.player);
  const bonuses: { id: string; label: string; points: number }[] = [];
  const award = (id: string, points: number, label: (name: string) => string, hit: (p: Player) => boolean) => {
    if (!buffs[id]) return;
    const p = myPlayers.find(hit);
    if (p) bonuses.push({ id, points, label: label(p.name) });
  };
  award('trick-play', 50, (n) => `Trick Play — ${n} threw a TD pass`, (p) => p.pos !== 'QB' && threwTrickTd(p.id, week));
  award('pick-six', 25, (n) => `Pick Six — ${n} returned a TD`, (p) => p.pos === 'DEF' && hadDefTd(p, week));
  award('hail-mary', 15, (n) => `Hail Mary — ${n} hit a 40+ yd TD`, (p) => p.pos === 'QB' && hadLongPassTd(p, week));

  // Double or Nothing: a staked head-to-head slot scores double if it wins, 0 if
  // it loses. Applied as a delta on top of the slot's own (already-summed) score.
  if (extras.doubleOrNothing) {
    for (const w of windows) for (const s of w.slots) {
      if (slotKey(s.win, s.slotIndex) !== extras.doubleOrNothing || !s.you || !s.their) continue;
      const won = s.youFinal > s.theirFinal;
      s.youStake = won ? 'won' : 'lost';
      bonuses.push({ id: 'double-or-nothing', points: won ? s.youFinal : -s.youFinal, label: won ? `Double or Nothing — ${s.you.player.name} WON ×2` : `Double or Nothing — ${s.you.player.name} LOST → 0` });
    }
  }
  for (const b of bonuses) youFinal += b.points;

  return {
    windows,
    youFinal: Math.round(youFinal * 10) / 10,
    theirFinal: Math.round(theirFinal * 10) / 10,
    real: anyReal,
    maxClock,
    bonuses: bonuses.length ? bonuses : undefined,
  };
}

export const COIN_PER_SIG = 5;
/** Drip coin earned by a side: +5 for every signature play its lineup makes. */
export function signatureCoins(m: ResolvedMatchup, side: 'you' | 'their'): number {
  let n = 0;
  for (const w of m.windows) for (const s of w.slots) for (const e of s.events) if (e.side === side && e.sig) n++;
  return n * COIN_PER_SIG;
}

// ── Drip-coin economy ────────────────────────────────────────────────────────
export const WEEKLY_STIPEND = 50;     // flat, just for playing the week
export const UNOPPOSED_COIN = 15;     // per unopposed player you field
export const SUPPRESS_COIN = 10;      // a DST's suppress firing (field-wide halving)
export const TURNOVER_COIN = 10;      // coin moved per turnover committed (25 with the powerup)
/**
 * Coin a metric earns PER EVENT OF NOTE (not per routine play). Only big-swing
 * metrics produce these — everything else earns 0 from signatures (the weekly
 * stipend + unopposed bounty carry the baseline).
 */
export function metricCoin(pos: Pos, metricId: string | null | undefined): number {
  const m = metricById(pos, metricId);
  if (!m) return 0;
  if (metricId === 'suppress') return SUPPRESS_COIN;                  // suppress firing
  if (metricId === 'neg') return 50;                                 // K SHUTDOWN — the big one
  if (m.fx === 'nuke') return 10;                                    // TD nuke
  // Accumulation drips earn when they go HOT (RB Rush, WR/TE Receiving, Combo).
  if (metricId === 'combodrip' || metricId === 'recyd' || (pos === 'RB' && metricId === 'rush')) return 5;
  return 0;                                                          // routine play — no coin
}
export function coinRisk(n: number): 'HIGH' | 'MED' | 'NONE' {
  return n >= 10 ? 'HIGH' : n > 0 ? 'MED' : 'NONE';
}

export interface WeekEarnings { stipend: number; unopposed: number; signature: number; turnover: number; total: number; }
/**
 * A side's full weekly drip-coin take: stipend + unopposed bounty + coin from
 * events of note + the turnover transfer. A player who throws an INT or loses a
 * fumble forfeits `turnoverCoin` to the opponent — so YOUR giveaways cost you
 * and the opponent's giveaways pay you. (Dormant until the MCP exposes
 * per-player turnovers — see turnoversCommitted.)
 */
export function weekEarnings(m: ResolvedMatchup, side: 'you' | 'their', week: number, turnoverCoin = TURNOVER_COIN): WeekEarnings {
  let unopposed = 0, signature = 0, turnover = 0;
  for (const w of m.windows) for (const s of w.slots) {
    const me = side === 'you' ? s.you : s.their;
    const opp = side === 'you' ? s.their : s.you;
    if (me) {
      if (!opp) unopposed += UNOPPOSED_COIN;
      if (me.metricId === 'suppress') signature += SUPPRESS_COIN;
      // Coin per event of note: the carry-wipe plus-up carries its own bounty
      // (e.coinAmt); everything else pays the primary metric's per-note rate.
      const rate = metricCoin(me.player.pos, me.metricId);
      for (const e of s.events) if (e.side === side && e.coin) signature += e.coinAmt ?? rate;
      turnover -= turnoverCoin * turnoversCommitted(me.player, week); // your giveaway → you lose
    }
    if (opp) turnover += turnoverCoin * turnoversCommitted(opp.player, week); // their giveaway → you gain
  }
  return { stipend: WEEKLY_STIPEND, unopposed, signature, turnover, total: WEEKLY_STIPEND + unopposed + signature + turnover };
}

/**
 * Drip coin a single spot earned for one side — everything weekEarnings counts
 * except the global weekly stipend (unopposed bounty + suppress + events of note
 * + the turnover swing). Surfaced as a per-spot stat at FINAL.
 */
export function slotCoin(slot: ResolvedSlot, side: 'you' | 'their', week: number, turnoverCoin = TURNOVER_COIN, upToClock = Infinity): number {
  const me = side === 'you' ? slot.you : slot.their;
  const opp = side === 'you' ? slot.their : slot.you;
  let c = 0;
  if (me) {
    if (!opp) c += UNOPPOSED_COIN;
    if (me.metricId === 'suppress') c += SUPPRESS_COIN;
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
function applyBackups(windows: ResolvedWindow[], side: 'you' | 'their', assign: Record<string, string>, auto: boolean): void {
  const all = windows.flatMap((w) => w.slots);
  const keyOf = (s: ResolvedSlot) => slotKey(s.win, s.slotIndex);
  const mine = (s: ResolvedSlot) => (side === 'you' ? s.you : s.their);
  const opp = (s: ResolvedSlot) => (side === 'you' ? s.their : s.you);
  const getF = (s: ResolvedSlot) => (side === 'you' ? s.youFinal : s.theirFinal);
  const setF = (s: ResolvedSlot, v: number) => { if (side === 'you') s.youFinal = v; else s.theirFinal = v; };
  const sub = (b: ResolvedSlot, st: ResolvedSlot) => {
    const info = { name: mine(b)!.player.name, score: b.backupScore ?? 0, from: getF(st) };
    if (side === 'you') st.youSub = info; else st.theirSub = info;
    setF(st, b.backupScore ?? 0); b.backupUsed = true;
  };

  const backups = all.filter((s) => mine(s) && !opp(s));
  if (!backups.length) return;
  // A backup doesn't score on its own — record its would-be score, zero it out.
  for (const b of backups) { b.backup = true; b.backupScore = getF(b); setF(b, 0); }

  // With 2+ unopposed slots you're not all-or-nothing: every unopposed slot that
  // doesn't sub in still banks HALF its score. (A single unopposed slot is a pure
  // best-ball backup — 0 unless it subs in.)
  const multi = backups.length >= 2;
  for (const b of backups) b.backupHalfEligible = multi || undefined;
  const halfCredit = () => {
    if (!multi) return;
    for (const b of backups) {
      if (b.backupUsed) continue; // it subbed in for full value — no double count
      setF(b, Math.round((b.backupScore ?? 0) * 0.5 * 10) / 10);
      b.backupHalf = true;
    }
  };

  const starters = all.filter((s) => mine(s) && opp(s));
  const used = new Set<ResolvedSlot>();

  // 1) Honor manual assignments (only valid when the backup outscores the target).
  const autoBackups: ResolvedSlot[] = [];
  for (const b of backups) {
    const targetKey = assign[keyOf(b)];
    const st = targetKey ? starters.find((s) => keyOf(s) === targetKey) : undefined;
    if (st && !used.has(st) && (b.backupScore ?? 0) > getF(st)) { sub(b, st); used.add(st); }
    else if (!targetKey) autoBackups.push(b); // unassigned → auto
    // an assigned-but-invalid backup is left unused (respect the explicit choice)
  }

  // 2) Auto-maximize the rest — only when auto (the AI opponent). Your own
  // backups stay benched until you assign them (it's your choice).
  if (!auto) { halfCredit(); return; }
  const remStarters = starters.filter((s) => !used.has(s)).sort((a, b) => getF(a) - getF(b));
  autoBackups.sort((a, b) => (b.backupScore ?? 0) - (a.backupScore ?? 0));
  let si = 0;
  for (const b of autoBackups) {
    if (si >= remStarters.length) break;
    const st = remStarters[si];
    if ((b.backupScore ?? 0) > getF(st)) { sub(b, st); si++; }
    else break;
  }
  halfCredit();
}

/** Running banks at a given clock (live phase) for one slot's event feed. */
export function banksAtClock(events: PbpEvent[], clock: number): { you: number; their: number } {
  let you = 0;
  let their = 0;
  for (const e of events) {
    if (e.clock > clock) break;
    you = e.youBank;
    their = e.theirBank;
  }
  return { you, their };
}
