import type { Player, WindowId, Pick, PbpEvent } from '../types';
import { WINDOWS, METRICS, TOTAL_SLOTS } from '../data/metrics';
import { teamRoster } from '../data/league';
import { hashStr } from '../data/players';
import { resolveSlot, projectedPoints, type SlotInput } from './sim';
import { REAL_WEEKS, realPointsFor } from '../data/realPbp';

// Deterministic per-week assignment of a roster across the 5 windows. The
// wheel distributes players roughly in proportion to each window's slot count,
// guaranteeing every window has enough bodies to fill its slots.
const WHEEL: WindowId[] = [
  'tnf', 'early', 'early', 'early', 'late', 'late', 'snf', 'mnf',
  'early', 'late', 'tnf', 'snf', 'mnf', 'early', 'late', 'mnf',
];

export function windowPools(teamId: string, week: number): Record<WindowId, Player[]> {
  const players = teamRoster(teamId);
  const sorted = [...players].sort(
    (a, b) => hashStr(`${a.id}|w${week}`) - hashStr(`${b.id}|w${week}`),
  );
  const pools: Record<WindowId, Player[]> = { tnf: [], early: [], late: [], snf: [], mnf: [] };
  sorted.forEach((p, i) => pools[WHEEL[i % WHEEL.length]].push(p));
  return pools;
}

/** A deterministic hidden metric for an auto/opponent pick. */
export function pickMetric(p: Player, week: number): string {
  const list = METRICS[p.pos] || METRICS.WR;
  const idx = hashStr(`${p.id}|m${week}`) % list.length;
  return list[idx].id;
}

export function slotKey(win: WindowId, idx: number): string {
  return `${win}#${idx}`;
}

/**
 * When real play-by-play is baked for the week, field the roster's real top-8
 * performers (benching anyone who didn't play) into the 8 slots in order.
 */
function realLineup(teamId: string, week: number): Record<string, Pick> {
  const pts = realPointsFor(week);
  const ranked = teamRoster(teamId)
    .filter((p) => pts[p.id] !== undefined)
    .sort((a, b) => (pts[b.id] || 0) - (pts[a.id] || 0));
  const picks: Record<string, Pick> = {};
  let idx = 0;
  for (const w of WINDOWS) {
    for (let i = 0; i < w.slots; i++) {
      const p = ranked[idx++];
      if (p) picks[slotKey(w.id, i)] = { playerId: p.id, metricId: pickMetric(p, week) };
    }
  }
  return picks;
}

/** Best available player per slot, with a hidden metric — used to seed lineups. */
export function defaultLineup(teamId: string, week: number): Record<string, Pick> {
  if (REAL_WEEKS.has(week)) {
    const rl = realLineup(teamId, week);
    if (Object.keys(rl).length >= TOTAL_SLOTS) return rl;
  }
  const pools = windowPools(teamId, week);
  const picks: Record<string, Pick> = {};
  for (const w of WINDOWS) {
    const ranked = [...pools[w.id]].sort((a, b) => projectedPoints(b, week) - projectedPoints(a, week));
    for (let i = 0; i < w.slots; i++) {
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
): ResolvedMatchup {
  const youPools = windowPools(youTeamId, week);
  const oppPools = windowPools(oppTeamId, week);

  const windows: ResolvedWindow[] = [];
  let youFinal = 0;
  let theirFinal = 0;
  let anyReal = false;
  let maxClock = 3300;

  for (const w of WINDOWS) {
    const slots: ResolvedSlot[] = [];
    for (let i = 0; i < w.slots; i++) {
      const key = slotKey(w.id, i);
      const you = lookup(youPools, youPicks, key);
      const their = lookup(oppPools, oppPicks, key);

      let events: PbpEvent[] = [];
      let yF = 0;
      let tF = 0;
      let gameLabel = w.label;
      let real = false;

      if (you && their) {
        const yIn: SlotInput = { player: you.player, metricId: you.metricId };
        const tIn: SlotInput = { player: their.player, metricId: their.metricId };
        gameLabel = `${you.player.team || 'NFL'} · ${their.player.team || 'NFL'}`;
        const res = resolveSlot(yIn, tIn, week, gameLabel);
        events = res.events;
        yF = res.youFinal;
        tF = res.theirFinal;
        real = res.real;
        if (real) anyReal = true;
        if (res.maxClock > maxClock) maxClock = res.maxClock;
      }

      youFinal += yF;
      theirFinal += tF;
      slots.push({ win: w.id, slotIndex: i, you, their, events, youFinal: yF, theirFinal: tF, gameLabel, real });
    }
    windows.push({ window: w, slots });
  }

  return {
    windows,
    youFinal: Math.round(youFinal * 10) / 10,
    theirFinal: Math.round(theirFinal * 10) / 10,
    real: anyReal,
    maxClock,
  };
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
