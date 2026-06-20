import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThemeName } from '../theme';
import type { WindowId } from '../types';
import { LEAGUE, YOU_TEAM_ID } from '../data/league';
import { powerupById } from '../data/powerups';

import type { SlotSwap } from '../engine/matchup';
export type { SlotSwap };

/** Powerups applied to a given week (their effects, not the inventory). */
export interface AppliedWeek {
  extraSlots: Partial<Record<WindowId, number>>; // bonus slots per window (mirrored to opponent)
  swaps: Record<string, SlotSwap>;               // slotKey -> real-time swap (metric and/or player)
  backups: Record<string, string>;               // backup slotKey -> target starter slotKey (manual best-ball)
  buffs?: Record<string, true>;                  // armed pre-match team buffs, keyed by powerup id
  doubleOrNothing?: string;                      // your slotKey staked (×2 if it wins, 0 if it loses)
  spy?: { slotKey: string; reveal: 'player' | 'metric' }; // a slate slot peeked pre-kickoff (player OR metric)
  byeSteal?: { slotKey: string; playerId: string }; // a bye player fielded for a flat projected score
  emp?: Partial<Record<WindowId, number>>;       // window -> clock at which opponent drips froze (10 min)
}

export type Phase = 'setup' | 'live' | 'final';

export type Route =
  | { name: 'hub' }
  | { name: 'league' }
  | { name: 'matchup'; week: number; phase: Phase }
  | { name: 'final'; week: number };

interface Store {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  route: Route;
  navigate: (r: Route) => void;
  youTeamId: string;
  coins: number;
  /** Credit a week's drip coin once (no-op if that week was already credited). */
  creditWeek: (week: number, amount: number) => void;
  inventory: Record<string, number>; // powerup id -> qty owned
  /** Buy a powerup with coins. Returns false if unaffordable. */
  buyPowerup: (id: string) => boolean;
  /** Consume one of a held powerup. Returns false if none held. */
  useConsumable: (id: string) => boolean;
  applied: Record<number, AppliedWeek>; // week -> applied powerup effects
  /** Apply an Extra Slot to a window for a week (consumes one). Returns success. */
  applyExtraSlot: (week: number, win: WindowId) => boolean;
  /** Real-time Metric Swap on a slot, effective from real time `atRt` (consumes one). */
  applyMetricSwap: (week: number, slotKey: string, atClock: number, atRt: number, toMetricId: string) => boolean;
  /** Real-time Player Swap on a slot, effective from real time `atRt` (consumes one). */
  applyPlayerSwap: (week: number, slotKey: string, atClock: number, atRt: number, toPlayerId: string) => boolean;
  /** Manually point a backup slot at a starter to replace (empty target = auto). */
  setBackupTarget: (week: number, backupKey: string, targetKey: string | null) => void;
  /** Arm a pre-match team buff (by powerup id) for a week (consumes one). */
  armBuff: (week: number, id: string) => boolean;
  /** Disarm an armed buff for a week (refunds the consumable). */
  disarmBuff: (week: number, id: string) => void;
  /** Stake one of your slots for Double or Nothing (consumes one). */
  setDoubleOrNothing: (week: number, slotKey: string) => boolean;
  /** Move the Double-or-Nothing stake to a new slot (no consume) — follows its
   *  player when the lineup compacts. */
  remapDoubleOrNothing: (week: number, slotKey: string) => void;
  /** Peek one slate slot's player OR metric via Spy (consumes one). */
  setSpy: (week: number, slotKey: string, reveal: 'player' | 'metric') => boolean;
  /** Field a bye player in a slot via Bye Steal (consumes one). */
  applyByeSteal: (week: number, slotKey: string, playerId: string) => boolean;
  /** Free mid-game metric re-roll via Mulligan — writes a swap, spends a Mulligan. */
  applyMulligan: (week: number, slotKey: string, atClock: number, atRt: number, toMetricId: string) => boolean;
  /** Fire EMP on a live window: freeze opponent drips from `clock` for 10 min. */
  applyEmp: (week: number, win: WindowId, clock: number) => boolean;
  /** Back-outs (refund the consumable) before lock-in / kickoff. */
  clearDoubleOrNothing: (week: number) => void;
  clearSpy: (week: number) => void;
  clearByeSteal: (week: number) => void;
  removeExtraSlot: (week: number, win: WindowId) => void;
  /** Refund an unlock-metric powerup when its spot drops the metric. */
  refundUnlock: (id: string) => void;
  /** Dev/testing: top drip coin back up to the demo grant and clear all owned +
   *  applied powerups. */
  resetDripCoin: () => void;
}

const Ctx = createContext<Store | null>(null);

const THEME_KEY = 'gc-theme';
const SAVE_KEY = 'gc-coins';

// One-time demo grant so the powerup shop is testable. Applied once per browser
// (existing testers get topped up too); spend it down freely after that.
const DEMO_GRANT = 2500;

interface SaveState { coins: number; weeks: number[]; inv: Record<string, number>; applied: Record<number, AppliedWeek>; granted: boolean; }
function loadState(): SaveState {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    const granted = raw.granted === true;
    return {
      coins: (raw.coins ?? 0) + (granted ? 0 : DEMO_GRANT),
      weeks: Array.isArray(raw.weeks) ? raw.weeks : [],
      inv: raw.inv && typeof raw.inv === 'object' ? raw.inv : {},
      applied: raw.applied && typeof raw.applied === 'object' ? raw.applied : {},
      granted: true,
    };
  } catch { return { coins: DEMO_GRANT, weeks: [], inv: {}, applied: {}, granted: true }; }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = typeof localStorage !== 'undefined' ? (localStorage.getItem(THEME_KEY) as ThemeName | null) : null;
    return saved ?? 'prime';
  });
  const [route, setRoute] = useState<Route>({ name: 'hub' });

  const initial = useRef(loadState());
  const [coins, setCoins] = useState<number>(initial.current.coins);
  const [inventory, setInventory] = useState<Record<string, number>>(initial.current.inv);
  const [applied, setApplied] = useState<Record<number, AppliedWeek>>(initial.current.applied);
  const creditedWeeks = useRef<Set<number>>(new Set(initial.current.weeks));

  // Persist coins + inventory + applied together. Pass next values explicitly so
  // we don't race React's async state.
  const persist = (next: { coins?: number; inv?: Record<string, number>; applied?: Record<number, AppliedWeek> }) => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        coins: next.coins ?? coins,
        weeks: [...creditedWeeks.current],
        inv: next.inv ?? inventory,
        applied: next.applied ?? applied,
        granted: true,
      }));
    } catch { /* ignore */ }
  };

  // Persist the one-time demo grant on first mount so a reload doesn't re-grant.
  useEffect(() => { persist({ coins: initial.current.coins }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  };

  const creditWeek = (week: number, amount: number) => {
    if (creditedWeeks.current.has(week)) return;
    creditedWeeks.current.add(week);
    setCoins((c) => { const next = c + amount; persist({ coins: next }); return next; });
  };

  const buyPowerup = (id: string): boolean => {
    const pu = powerupById(id);
    if (!pu || coins < pu.price) return false;
    const nextCoins = coins - pu.price;
    const nextInv = { ...inventory, [id]: (inventory[id] ?? 0) + 1 };
    setInventory(nextInv); setCoins(nextCoins); persist({ coins: nextCoins, inv: nextInv });
    return true;
  };

  const useConsumable = (id: string): boolean => {
    if ((inventory[id] ?? 0) <= 0) return false;
    const nextInv = { ...inventory, [id]: inventory[id] - 1 };
    setInventory(nextInv); persist({ inv: nextInv });
    return true;
  };

  // Consume one powerup and merge a patch into applied[week], preserving the
  // week's other applied effects. Returns false if none held.
  const consumeAndApply = (id: string, week: number, patch: (cur: AppliedWeek) => AppliedWeek): boolean => {
    if ((inventory[id] ?? 0) <= 0) return false;
    const nextInv = { ...inventory, [id]: inventory[id] - 1 };
    const cur: AppliedWeek = applied[week] ?? { extraSlots: {}, swaps: {}, backups: {} };
    const nextApplied = { ...applied, [week]: patch({ ...cur, extraSlots: cur.extraSlots ?? {}, swaps: cur.swaps ?? {}, backups: cur.backups ?? {} }) };
    setInventory(nextInv); setApplied(nextApplied); persist({ inv: nextInv, applied: nextApplied });
    return true;
  };

  const applyExtraSlot = (week: number, win: WindowId): boolean =>
    consumeAndApply('extra-slot', week, (cur) => ({ ...cur, extraSlots: { ...cur.extraSlots, [win]: (cur.extraSlots[win] ?? 0) + 1 } }));

  const armBuff = (week: number, id: string): boolean =>
    applied[week]?.buffs?.[id] ? false : consumeAndApply(id, week, (cur) => ({ ...cur, buffs: { ...cur.buffs, [id]: true } }));

  // Disarm a previously-armed buff: clear the flag and refund the consumable.
  const disarmBuff = (week: number, id: string): void => {
    const cur = applied[week];
    if (!cur?.buffs?.[id]) return;
    const buffs = { ...cur.buffs }; delete buffs[id];
    const nextApplied = { ...applied, [week]: { ...cur, buffs } };
    const nextInv = { ...inventory, [id]: (inventory[id] ?? 0) + 1 };
    setApplied(nextApplied); setInventory(nextInv); persist({ applied: nextApplied, inv: nextInv });
  };

  const setDoubleOrNothing = (week: number, slotKey: string): boolean =>
    consumeAndApply('double-or-nothing', week, (cur) => ({ ...cur, doubleOrNothing: slotKey }));
  const remapDoubleOrNothing = (week: number, slotKey: string): void => {
    const cur = applied[week];
    if (!cur?.doubleOrNothing || cur.doubleOrNothing === slotKey) return;
    const nextApplied = { ...applied, [week]: { ...cur, doubleOrNothing: slotKey } };
    setApplied(nextApplied); persist({ applied: nextApplied });
  };
  const setSpy = (week: number, slotKey: string, reveal: 'player' | 'metric'): boolean =>
    consumeAndApply('spy', week, (cur) => ({ ...cur, spy: { slotKey, reveal } }));
  const applyByeSteal = (week: number, slotKey: string, playerId: string): boolean =>
    consumeAndApply('bye-steal', week, (cur) => ({ ...cur, byeSteal: { slotKey, playerId } }));
  const applyMulligan = (week: number, slotKey: string, atClock: number, atRt: number, toMetricId: string): boolean =>
    consumeAndApply('mulligan', week, (cur) => ({ ...cur, swaps: { ...cur.swaps, [slotKey]: { ...cur.swaps[slotKey], atClock, atRt, toMetricId } } }));
  const applyEmp = (week: number, win: WindowId, clock: number): boolean =>
    applied[week]?.emp?.[win] != null ? false : consumeAndApply('emp', week, (cur) => ({ ...cur, emp: { ...cur.emp, [win]: clock } }));

  // ── Back-outs: clear an applied targeted powerup and refund the consumable. ──
  const clearApplied = (week: number, refundId: string, mutate: (cur: AppliedWeek) => void): void => {
    const cur = applied[week]; if (!cur) return;
    const nc: AppliedWeek = { ...cur, extraSlots: { ...cur.extraSlots }, swaps: { ...cur.swaps }, backups: { ...cur.backups } };
    mutate(nc);
    const nextApplied = { ...applied, [week]: nc };
    const nextInv = { ...inventory, [refundId]: (inventory[refundId] ?? 0) + 1 };
    setApplied(nextApplied); setInventory(nextInv); persist({ applied: nextApplied, inv: nextInv });
  };
  const clearDoubleOrNothing = (week: number): void => { if (applied[week]?.doubleOrNothing) clearApplied(week, 'double-or-nothing', (c) => { delete c.doubleOrNothing; }); };
  const clearSpy = (week: number): void => { if (applied[week]?.spy) clearApplied(week, 'spy', (c) => { delete c.spy; }); };
  const clearByeSteal = (week: number): void => { if (applied[week]?.byeSteal) clearApplied(week, 'bye-steal', (c) => { delete c.byeSteal; }); };
  const removeExtraSlot = (week: number, win: WindowId): void => {
    const n = applied[week]?.extraSlots?.[win] ?? 0; if (n <= 0) return;
    clearApplied(week, 'extra-slot', (c) => { if (n - 1 > 0) c.extraSlots[win] = n - 1; else delete c.extraSlots[win]; });
  };
  // Refund an unlock-metric powerup (when a player swaps off / clears that metric).
  const refundUnlock = (id: string): void => { const nextInv = { ...inventory, [id]: (inventory[id] ?? 0) + 1 }; setInventory(nextInv); persist({ inv: nextInv }); };

  const applyMetricSwap = (week: number, slotKey: string, atClock: number, atRt: number, toMetricId: string): boolean =>
    consumeAndApply('metric-swap', week, (cur) => ({ ...cur, swaps: { ...cur.swaps, [slotKey]: { ...cur.swaps[slotKey], atClock, atRt, toMetricId } } }));

  const applyPlayerSwap = (week: number, slotKey: string, atClock: number, atRt: number, toPlayerId: string): boolean =>
    consumeAndApply('player-swap', week, (cur) => ({ ...cur, swaps: { ...cur.swaps, [slotKey]: { ...cur.swaps[slotKey], atClock, atRt, toPlayerId } } }));

  const setBackupTarget = (week: number, backupKey: string, targetKey: string | null): void => {
    const cur: AppliedWeek = applied[week] ?? { extraSlots: {}, swaps: {}, backups: {} };
    const backups = { ...(cur.backups ?? {}) };
    if (targetKey) backups[backupKey] = targetKey; else delete backups[backupKey];
    const nextApplied = { ...applied, [week]: { extraSlots: cur.extraSlots ?? {}, swaps: cur.swaps ?? {}, backups } };
    setApplied(nextApplied); persist({ applied: nextApplied });
  };

  const resetDripCoin = (): void => {
    setCoins(DEMO_GRANT); setInventory({}); setApplied({});
    persist({ coins: DEMO_GRANT, inv: {}, applied: {} });
  };

  const value = useMemo<Store>(
    () => ({ theme, setTheme, route, navigate: setRoute, youTeamId: YOU_TEAM_ID, coins, creditWeek, inventory, buyPowerup, useConsumable, applied, applyExtraSlot, applyMetricSwap, applyPlayerSwap, setBackupTarget, armBuff, disarmBuff, setDoubleOrNothing, remapDoubleOrNothing, setSpy, applyByeSteal, applyMulligan, applyEmp, clearDoubleOrNothing, clearSpy, clearByeSteal, removeExtraSlot, refundUnlock, resetDripCoin }),
    [theme, route, coins, inventory, applied],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

export const LEAGUE_REF = LEAGUE;
