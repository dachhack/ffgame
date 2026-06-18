import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThemeName } from '../theme';
import { LEAGUE, YOU_TEAM_ID } from '../data/league';

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
}

const Ctx = createContext<Store | null>(null);

const THEME_KEY = 'gc-theme';
const COINS_KEY = 'gc-coins';

function loadCoins(): { coins: number; weeks: number[] } {
  try {
    const raw = JSON.parse(localStorage.getItem(COINS_KEY) || '{}');
    return { coins: raw.coins ?? 0, weeks: Array.isArray(raw.weeks) ? raw.weeks : [] };
  } catch { return { coins: 0, weeks: [] }; }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(() => {
    const saved = typeof localStorage !== 'undefined' ? (localStorage.getItem(THEME_KEY) as ThemeName | null) : null;
    return saved ?? 'prime';
  });
  const [route, setRoute] = useState<Route>({ name: 'hub' });

  const initial = useRef(loadCoins());
  const [coins, setCoins] = useState<number>(initial.current.coins);
  const creditedWeeks = useRef<Set<number>>(new Set(initial.current.weeks));

  const setTheme = (t: ThemeName) => {
    setThemeState(t);
    try { localStorage.setItem(THEME_KEY, t); } catch { /* ignore */ }
  };

  const creditWeek = (week: number, amount: number) => {
    if (creditedWeeks.current.has(week)) return;
    creditedWeeks.current.add(week);
    setCoins((c) => {
      const next = c + amount;
      try { localStorage.setItem(COINS_KEY, JSON.stringify({ coins: next, weeks: [...creditedWeeks.current] })); } catch { /* ignore */ }
      return next;
    });
  };

  const value = useMemo<Store>(
    () => ({ theme, setTheme, route, navigate: setRoute, youTeamId: YOU_TEAM_ID, coins, creditWeek }),
    [theme, route, coins],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

export const LEAGUE_REF = LEAGUE;
