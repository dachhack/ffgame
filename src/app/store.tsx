import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThemeName } from '../theme';
import { LEAGUE, YOU_TEAM_ID } from '../data/league';
import { powerupById } from '../data/powerups';

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
  inventory: Record<string, number>; // consumable powerup id -> qty owned
  unlocks: string[];                  // permanently-unlocked powerup ids
  /** Buy a powerup with coins. Returns false if unaffordable / already owned. */
  buyPowerup: (id: string) => boolean;
  /** Consume one of a held consumable powerup. Returns false if none held. */
  useConsumable: (id: string) => boolean;
}

const Ctx = createContext<Store | null>(null);

const THEME_KEY = 'gc-theme';
const SAVE_KEY = 'gc-coins';

interface SaveState { coins: number; weeks: number[]; inv: Record<string, number>; unlocks: string[]; }
function loadState(): SaveState {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return {
      coins: raw.coins ?? 0,
      weeks: Array.isArray(raw.weeks) ? raw.weeks : [],
      inv: raw.inv && typeof raw.inv === 'object' ? raw.inv : {},
      unlocks: Array.isArray(raw.unlocks) ? raw.unlocks : [],
    };
  } catch { return { coins: 0, weeks: [], inv: {}, unlocks: [] }; }
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
  const [unlocks, setUnlocks] = useState<string[]>(initial.current.unlocks);
  const creditedWeeks = useRef<Set<number>>(new Set(initial.current.weeks));

  // Persist coins + inventory + unlocks together. Pass next values explicitly so
  // we don't race React's async state.
  const persist = (next: { coins?: number; inv?: Record<string, number>; unlocks?: string[] }) => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        coins: next.coins ?? coins,
        weeks: [...creditedWeeks.current],
        inv: next.inv ?? inventory,
        unlocks: next.unlocks ?? unlocks,
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
    if (pu.kind === 'unlock' && unlocks.includes(id)) return false;
    const nextCoins = coins - pu.price;
    if (pu.kind === 'unlock') {
      const nextUnlocks = [...unlocks, id];
      setUnlocks(nextUnlocks); setCoins(nextCoins); persist({ coins: nextCoins, unlocks: nextUnlocks });
    } else {
      const nextInv = { ...inventory, [id]: (inventory[id] ?? 0) + 1 };
      setInventory(nextInv); setCoins(nextCoins); persist({ coins: nextCoins, inv: nextInv });
    }
    return true;
  };

  const useConsumable = (id: string): boolean => {
    if ((inventory[id] ?? 0) <= 0) return false;
    const nextInv = { ...inventory, [id]: inventory[id] - 1 };
    setInventory(nextInv); persist({ inv: nextInv });
    return true;
  };

  const value = useMemo<Store>(
    () => ({ theme, setTheme, route, navigate: setRoute, youTeamId: YOU_TEAM_ID, coins, creditWeek, inventory, unlocks, buyPowerup, useConsumable }),
    [theme, route, coins, inventory, unlocks],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

export const LEAGUE_REF = LEAGUE;
