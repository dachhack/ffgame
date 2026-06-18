import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
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
  /** Real-time Metric Swap on a slot, effective from `atClock` (consumes one). */
  applyMetricSwap: (week: number, slotKey: string, atClock: number, toMetricId: string) => boolean;
  /** Real-time Player Swap on a slot, effective from `atClock` (consumes one). */
  applyPlayerSwap: (week: number, slotKey: string, atClock: number, toPlayerId: string) => boolean;
  /** Manually point a backup slot at a starter to replace (empty target = auto). */
  setBackupTarget: (week: number, backupKey: string, targetKey: string | null) => void;
}

const Ctx = createContext<Store | null>(null);

const THEME_KEY = 'gc-theme';
const SAVE_KEY = 'gc-coins';

interface SaveState { coins: number; weeks: number[]; inv: Record<string, number>; applied: Record<number, AppliedWeek>; }
function loadState(): SaveState {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return {
      coins: raw.coins ?? 0,
      weeks: Array.isArray(raw.weeks) ? raw.weeks : [],
      inv: raw.inv && typeof raw.inv === 'object' ? raw.inv : {},
      applied: raw.applied && typeof raw.applied === 'object' ? raw.applied : {},
    };
  } catch { return { coins: 0, weeks: [], inv: {}, applied: {} }; }
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
      }));
    } catch { /* ignore */ }
  };

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
    const nextApplied = { ...applied, [week]: patch({ extraSlots: cur.extraSlots ?? {}, swaps: cur.swaps ?? {}, backups: cur.backups ?? {} }) };
    setInventory(nextInv); setApplied(nextApplied); persist({ inv: nextInv, applied: nextApplied });
    return true;
  };

  const applyExtraSlot = (week: number, win: WindowId): boolean =>
    consumeAndApply('extra-slot', week, (cur) => ({ ...cur, extraSlots: { ...cur.extraSlots, [win]: (cur.extraSlots[win] ?? 0) + 1 } }));

  const applyMetricSwap = (week: number, slotKey: string, atClock: number, toMetricId: string): boolean =>
    consumeAndApply('metric-swap', week, (cur) => ({ ...cur, swaps: { ...cur.swaps, [slotKey]: { ...cur.swaps[slotKey], atClock, toMetricId } } }));

  const applyPlayerSwap = (week: number, slotKey: string, atClock: number, toPlayerId: string): boolean =>
    consumeAndApply('player-swap', week, (cur) => ({ ...cur, swaps: { ...cur.swaps, [slotKey]: { ...cur.swaps[slotKey], atClock, toPlayerId } } }));

  const setBackupTarget = (week: number, backupKey: string, targetKey: string | null): void => {
    const cur: AppliedWeek = applied[week] ?? { extraSlots: {}, swaps: {}, backups: {} };
    const backups = { ...(cur.backups ?? {}) };
    if (targetKey) backups[backupKey] = targetKey; else delete backups[backupKey];
    const nextApplied = { ...applied, [week]: { extraSlots: cur.extraSlots ?? {}, swaps: cur.swaps ?? {}, backups } };
    setApplied(nextApplied); persist({ applied: nextApplied });
  };

  const value = useMemo<Store>(
    () => ({ theme, setTheme, route, navigate: setRoute, youTeamId: YOU_TEAM_ID, coins, creditWeek, inventory, buyPowerup, useConsumable, applied, applyExtraSlot, applyMetricSwap, applyPlayerSwap, setBackupTarget }),
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
