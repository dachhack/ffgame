import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThemeName } from '../theme';
import type { WindowId, Pick } from '../types';
import { LEAGUE, YOU_TEAM_ID, setActiveLeague, resetToDemoLeague, type BuiltLeague } from '../data/league';
import { clearSyntheticWeeks, clearLivePlays } from '../data/realPbp';
import { clearRuntimeHeadshots } from '../data/media';
import type { League } from '../types';
import { powerupById } from '../data/powerups';
import { DEMO_WEEK } from '../config';
import { DEFAULT_PROVIDER_ID, type ProviderUser, type ProviderId } from '../data/providers';
import { track, identify, Ev } from './analytics';

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
  lineup?: Record<string, Pick>;                 // your lineup edits (deltas over the default) — so FINAL replays your actual lineup
}

export type Phase = 'setup' | 'live' | 'final';

export type Route =
  | { name: 'splash' }
  | { name: 'live'; view?: 'admin' } // authenticated live-H2H pilot (separate from the demo); `view:'admin'` deep-links straight to the super-admin panel
  | { name: 'demo'; view?: 'clean' | 'board' } // narrated guided demo: 'clean' explainer (default) or the real in-game board
  | { name: 'leagues' }
  | { name: 'sleeperLeague'; leagueId: string; leagueName: string }
  | { name: 'connect'; provider: ProviderId }
  | { name: 'hub' }
  | { name: 'league' }
  | { name: 'matchup'; week: number; phase: Phase }
  | { name: 'final'; week: number };

/** Identifies the user's real pilot matchup behind a sim board, so the board can
 *  persist its lineup to sealed_pick and align with the worker's scoring. */
export interface LiveCtx { matchupId: string; userId: string; leagueId: string; rosterId: number; week: number; }

interface Store {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  /** Larger-text mode (zooms the whole UI ~20% for readability). */
  bigText: boolean;
  setBigText: (v: boolean) => void;
  fullStats: boolean;
  setFullStats: (v: boolean) => void;
  route: Route;
  navigate: (r: Route) => void;
  /** The Sleeper account whose leagues we're browsing (null → welcome splash). */
  sleeperUser: ProviderUser | null;
  setSleeperUser: (u: ProviderUser | null) => void;
  /** The league the sim is currently running on (the baked DRIP demo by default). */
  activeLeague: League;
  /** True when a real Sleeper league is loaded (vs the baked DRIP demo). */
  isSimLeague: boolean;
  /** When the active sim is a REAL pilot league (e.g. the Drip Test League), the
   *  context needed to persist the lineup to Supabase sealed_pick + score it via
   *  the worker. Null for the plain demo/sim (client-only). */
  liveCtx: LiveCtx | null;
  /** Make a freshly-built league active and enter its sim as `youTeamId`. Pass a
   *  `liveCtx` to make it a real pilot league (sealed-pick persistence on). */
  loadSimLeague: (built: BuiltLeague, youTeamId: string, liveCtx?: LiveCtx | null) => void;
  /** Drop back to the baked demo league. */
  exitSimLeague: () => void;
  /** Demo: which league team you're playing as (any team in the league). */
  youTeamId: string;
  setYouTeam: (id: string) => void;
  /** Demo: which week the hub/overview/setup revolve around (the "open" week). */
  demoWeek: number;
  setDemoWeek: (w: number) => void;
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
  /** Persist your lineup edits for a week (deltas over the default) so the FINAL
   *  screen can replay the exact lineup you fielded. */
  setLineup: (week: number, lineup: Record<string, Pick>) => void;
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
const BIGTEXT_KEY = 'gc-bigtext';
const FULLSTATS_KEY = 'gc-fullstats';
const SLEEPER_KEY = 'gc-sleeper';
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
    return saved ?? 'neon';
  });
  const [sleeperUser, setSleeperUserState] = useState<ProviderUser | null>(() => {
    try {
      const s = localStorage.getItem(SLEEPER_KEY);
      if (!s) return null;
      const u = JSON.parse(s) as ProviderUser;
      // Backfill `provider` for accounts persisted before the provider seam.
      return u.provider ? u : { ...u, provider: DEFAULT_PROVIDER_ID };
    } catch { return null; }
  });
  const setSleeperUser = (u: ProviderUser | null) => {
    setSleeperUserState(u);
    if (u) { identify(u.userId, { username: u.username }); track(Ev.sleeperConnected); }
    try { if (u) localStorage.setItem(SLEEPER_KEY, JSON.stringify(u)); else localStorage.removeItem(SLEEPER_KEY); } catch { /* ignore */ }
  };
  // Boot to your leagues if a Sleeper user is remembered, else the welcome splash.
  const [route, setRoute] = useState<Route>(sleeperUser ? { name: 'leagues' } : { name: 'splash' });
  // Browser back/forward: mirror each route into history state (URL unchanged) so the
  // back button steps between in-app screens instead of dead-ending / leaving the site.
  const navigate = (r: Route) => {
    setRoute(r);
    track(Ev.screenView, { screen: r.name });
    try { window.history.pushState({ __route: r }, ''); } catch { /* ignore */ }
  };
  useEffect(() => {
    try { window.history.replaceState({ __route: route }, ''); } catch { /* ignore */ }
    const onPop = (e: PopStateEvent) => { setRoute(((e.state as { __route?: Route } | null)?.__route) ?? { name: 'splash' }); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The active league (baked DRIP demo by default; swapped when a sim is loaded).
  const [activeLeague, setActiveLeagueState] = useState<League>(LEAGUE);
  const [isSimLeague, setIsSimLeague] = useState(false);
  // Demo role/week: pick any team and any week before heading into setup.
  const [youTeamId, setYouTeam] = useState<string>(YOU_TEAM_ID);
  const [demoWeek, setDemoWeek] = useState<number>(DEMO_WEEK);
  const [liveCtx, setLiveCtx] = useState<LiveCtx | null>(null);
  const loadSimLeague = (built: BuiltLeague, youId: string, ctx: LiveCtx | null = null) => {
    track(Ev.leagueOpened, { live: !!ctx, teams: built.league.teams?.length ?? null });
    clearLivePlays();                   // drop any prior league's live overlay
    setActiveLeague(built);             // swap the engine registry (non-React reads)
    setActiveLeagueState(built.league); // re-render React consumers
    setIsSimLeague(true);
    setYouTeam(youId);
    setLiveCtx(ctx);
    setDemoWeek(ctx ? ctx.week : DEMO_WEEK); // a pilot board opens on its real matchup week
    // A fresh sim starts with a clean economy: reset drip coin to the grant and
    // wipe owned + applied powerups and the per-week credit ledger, so nothing
    // carries over from the demo or a previously-run league.
    creditedWeeks.current = new Set();
    setCoins(DEMO_GRANT); setInventory({}); setApplied({});
    persist({ coins: DEMO_GRANT, inv: {}, applied: {} });
  };
  const exitSimLeague = () => {
    resetToDemoLeague(); clearSyntheticWeeks(); clearLivePlays(); clearRuntimeHeadshots();
    setActiveLeagueState(LEAGUE); setIsSimLeague(false); setYouTeam(YOU_TEAM_ID); setLiveCtx(null);
  };
  const [bigText, setBigTextState] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(BIGTEXT_KEY);
      if (saved != null) return saved === '1';        // respect an explicit choice
      return window.matchMedia('(max-width:760px)').matches; // default ON for mobile
    } catch { return false; }
  });
  const setBigText = (v: boolean) => {
    setBigTextState(v);
    try { localStorage.setItem(BIGTEXT_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };
  const [fullStats, setFullStatsState] = useState<boolean>(() => {
    try { return localStorage.getItem(FULLSTATS_KEY) === '1'; } catch { return false; }
  });
  const setFullStats = (v: boolean) => {
    setFullStatsState(v);
    try { localStorage.setItem(FULLSTATS_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };

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

  // Persist whenever coins / inventory / applied change. This lets several state
  // updates in one handler (e.g. multiple power-up refunds from a single roster
  // change) compose via functional setters and still save the final result.
  useEffect(() => { persist({}); }, [coins, inventory, applied]); // eslint-disable-line react-hooks/exhaustive-deps

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
    track(Ev.powerupBought, { id, price: pu.price });
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
  // Functional setters so several disarms in one tick compose (persist via effect).
  const disarmBuff = (week: number, id: string): void => {
    if (!applied[week]?.buffs?.[id]) return;
    setApplied((prev) => {
      const cur = prev[week]; if (!cur?.buffs?.[id]) return prev;
      const buffs = { ...cur.buffs }; delete buffs[id];
      return { ...prev, [week]: { ...cur, buffs } };
    });
    setInventory((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  };

  const setDoubleOrNothing = (week: number, slotKey: string): boolean =>
    consumeAndApply('double-or-nothing', week, (cur) => ({ ...cur, doubleOrNothing: slotKey }));
  const remapDoubleOrNothing = (week: number, slotKey: string): void => {
    setApplied((prev) => {
      const cur = prev[week];
      if (!cur?.doubleOrNothing || cur.doubleOrNothing === slotKey) return prev;
      return { ...prev, [week]: { ...cur, doubleOrNothing: slotKey } };
    });
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
    if (!applied[week]) return;
    setApplied((prev) => {
      const cur = prev[week]; if (!cur) return prev;
      const nc: AppliedWeek = { ...cur, extraSlots: { ...cur.extraSlots }, swaps: { ...cur.swaps }, backups: { ...cur.backups } };
      mutate(nc);
      return { ...prev, [week]: nc };
    });
    setInventory((prev) => ({ ...prev, [refundId]: (prev[refundId] ?? 0) + 1 }));
  };
  const clearDoubleOrNothing = (week: number): void => { if (applied[week]?.doubleOrNothing) clearApplied(week, 'double-or-nothing', (c) => { delete c.doubleOrNothing; }); };
  const clearSpy = (week: number): void => { if (applied[week]?.spy) clearApplied(week, 'spy', (c) => { delete c.spy; }); };
  const clearByeSteal = (week: number): void => { if (applied[week]?.byeSteal) clearApplied(week, 'bye-steal', (c) => { delete c.byeSteal; }); };
  const removeExtraSlot = (week: number, win: WindowId): void => {
    const n = applied[week]?.extraSlots?.[win] ?? 0; if (n <= 0) return;
    clearApplied(week, 'extra-slot', (c) => { if (n - 1 > 0) c.extraSlots[win] = n - 1; else delete c.extraSlots[win]; });
  };
  // Refund an unlock-metric powerup (when a player swaps off / clears that metric).
  const refundUnlock = (id: string): void => { setInventory((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 })); };

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

  const setLineup = (week: number, lineup: Record<string, Pick>): void => {
    const cur: AppliedWeek = applied[week] ?? { extraSlots: {}, swaps: {}, backups: {} };
    const nextApplied = { ...applied, [week]: { ...cur, extraSlots: cur.extraSlots ?? {}, swaps: cur.swaps ?? {}, backups: cur.backups ?? {}, lineup } };
    setApplied(nextApplied); persist({ applied: nextApplied });
    track(Ev.lineupSet, { week, slots: Object.keys(lineup).length });
  };

  const resetDripCoin = (): void => {
    setCoins(DEMO_GRANT); setInventory({}); setApplied({});
    persist({ coins: DEMO_GRANT, inv: {}, applied: {} });
  };

  const value = useMemo<Store>(
    () => ({ theme, setTheme, bigText, setBigText, fullStats, setFullStats, route, navigate, sleeperUser, setSleeperUser, activeLeague, isSimLeague, liveCtx, loadSimLeague, exitSimLeague, youTeamId, setYouTeam, demoWeek, setDemoWeek, coins, creditWeek, inventory, buyPowerup, useConsumable, applied, applyExtraSlot, applyMetricSwap, applyPlayerSwap, setBackupTarget, setLineup, armBuff, disarmBuff, setDoubleOrNothing, remapDoubleOrNothing, setSpy, applyByeSteal, applyMulligan, applyEmp, clearDoubleOrNothing, clearSpy, clearByeSteal, removeExtraSlot, refundUnlock, resetDripCoin }),
    [theme, bigText, fullStats, route, sleeperUser, activeLeague, isSimLeague, liveCtx, youTeamId, demoWeek, coins, inventory, applied],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

export const LEAGUE_REF = LEAGUE;
