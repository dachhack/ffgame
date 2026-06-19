import type { Player, WindowId, Pick, PbpEvent } from '../types';
import { WINDOWS, METRICS } from '../data/metrics';
import { teamRoster, getPlayer } from '../data/league';
import { hashStr } from '../data/players';

/** A real-time swap on a slot, effective from `atClock` (Player/Metric Swap). */
export interface SlotSwap { atClock: number; toMetricId?: string; toPlayerId?: string; }
export type SlotSwaps = Record<string, SlotSwap>; // slotKey -> swap
import { resolveSlot, projectedPoints, windowFgMult, teTdNukeClocks, defEarnScore, EMPTY_PLAYER, type SlotInput } from './sim';
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

export function slotKey(win: WindowId, idx: number): string {
  return `${win}#${idx}`;
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
    const ranked = real
      ? pools[w.id].filter((p) => healthy(p) && pts[p.id] !== undefined).sort((a, b) => (pts[b.id] || 0) - (pts[a.id] || 0))
      : pools[w.id].filter(healthy); // already projection-sorted
    for (let i = 0; i < slotsFor(w.id, extra); i++) {
      const p = ranked[i];
      if (p) picks[slotKey(w.id, i)] = { playerId: p.id, metricId: pickMetric(p, week) };
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
  trickBonus?: { player: string; points: number }; // Trick Play hit: a non-QB starter threw a TD
}

export const TRICK_PLAY_BONUS = 50;
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
  trickPlay = false,
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
    const youMult = windowFgMult(youIns, week);
    const theirMult = windowFgMult(theirIns, week);
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
        const opts = { youMult, theirMult, youDripNukeClocks: theirTeTd, theirDripNukeClocks: youTeTd };
        let res = resolveSlot(yIn, tIn, week, gameLabel, opts);

        // Real-time swap (Player/Metric Swap): keep your pre-swap banked points,
        // then add only the new config's gains after the swap clock. Both sides'
        // pre-swap banks come from the original config; post-swap from the new.
        const swap = you ? swaps[key] : undefined;
        if (swap) {
          const swapped = getPlayer(swap.toPlayerId ?? '') ?? you!.player;
          const newYIn: SlotInput = { player: swap.toPlayerId ? swapped : you!.player, metricId: swap.toMetricId ?? you!.metricId };
          const sres = resolveSlot(newYIn, tIn, week, gameLabel, opts);
          const C = swap.atClock;
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
        // A suppress DST scores its earn in the log, but banks 0 itself — those
        // points are spent as the halving threshold (suppressSpent), not kept.
        if (suppressSpentYou != null) yF = 0;
        if (suppressSpentTheir != null) tF = 0;
      }

      slots.push({ win: w.id, slotIndex: i, you: displayYou, their, events, youFinal: yF, theirFinal: tF, gameLabel, real, suppressSpentYou, suppressSpentTheir, youNegated: youNegated || undefined, theirNegated: theirNegated || undefined });
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

  // Trick Play: a flat +50 if any non-QB in your starting spots threw a TD pass.
  let trickBonus: { player: string; points: number } | undefined;
  if (trickPlay) {
    for (const w of windows) {
      for (const s of w.slots) {
        if (s.you && s.you.player.pos !== 'QB' && threwTrickTd(s.you.player.id, week)) {
          trickBonus = { player: s.you.player.name, points: TRICK_PLAY_BONUS };
          break;
        }
      }
      if (trickBonus) break;
    }
    if (trickBonus) youFinal += trickBonus.points;
  }

  return {
    windows,
    youFinal: Math.round(youFinal * 10) / 10,
    theirFinal: Math.round(theirFinal * 10) / 10,
    real: anyReal,
    maxClock,
    trickBonus,
  };
}

export const COIN_PER_SIG = 5;
/** Drip coin earned by a side: +5 for every signature play its lineup makes. */
export function signatureCoins(m: ResolvedMatchup, side: 'you' | 'their'): number {
  let n = 0;
  for (const w of m.windows) for (const s of w.slots) for (const e of s.events) if (e.side === side && e.sig) n++;
  return n * COIN_PER_SIG;
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
  if (!auto) return;
  const remStarters = starters.filter((s) => !used.has(s)).sort((a, b) => getF(a) - getF(b));
  autoBackups.sort((a, b) => (b.backupScore ?? 0) - (a.backupScore ?? 0));
  let si = 0;
  for (const b of autoBackups) {
    if (si >= remStarters.length) break;
    const st = remStarters[si];
    if ((b.backupScore ?? 0) > getF(st)) { sub(b, st); si++; }
    else break;
  }
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
