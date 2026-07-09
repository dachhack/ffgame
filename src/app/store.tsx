import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ThemeName } from '../theme';
import type { WindowId, Pick } from '../types';
import { LEAGUE, YOU_TEAM_ID, setActiveLeague, resetToDemoLeague, type BuiltLeague } from '../data/league';
import { clearSyntheticWeeks, clearLivePlays } from '../data/realPbp';
import { clearLiveGameFeeds } from '../data/gameFeed';
import { clearRuntimeHeadshots } from '../data/media';
import type { League } from '../types';
import { powerupById, isAmplifier, ampCapacity, capAmplifiers } from '../data/powerups';
import { DEMO_WEEK } from '../config';
import { type ProviderUser, type ProviderId } from '../data/providers';
import { track, identify, Ev } from './analytics';
import { myInventory, consumeInventory, refundInventory, myBuffs, heroSetBuffs, myHeroApplied, heroSetApplied, myTargeted, type TargetedState } from '../data/liveApi';

import type { SlotSwap } from '../engine/matchup';
export type { SlotSwap };

/** Powerups applied to a given week (their effects, not the inventory). */
export interface AppliedWeek {
  extraSlots: Partial<Record<WindowId, number>>; // bonus slots per window (mirrored to opponent)
  swaps: Record<string, SlotSwap>;               // slotKey -> real-time swap (metric and/or player)
  backups: Record<string, string>;               // backup slotKey -> target starter slotKey (manual best-ball)
  buffs?: Record<string, true>;                  // armed pre-match team buffs, keyed by powerup id
  doubleOrNothing?: string;                      // your slotKey staked (×2 if it wins, 0 if it loses)
  spy?: { slotKey: string; reveal: 'player' | 'metric'; value?: string | null }; // a slate slot peeked pre-kickoff; `value` = the server's live reveal (use_spy)
  byeSteal?: { slotKey: string; playerId: string }; // a bye player fielded for a flat projected score
  emp?: Partial<Record<WindowId, number>>;       // window -> clock at which opponent drips froze (10 min)
  rivalry?: Partial<Record<WindowId, boolean>>;  // windows armed with Rivalry (siphon 50% of same-position opponents at window-end)
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

// ── URL routing ──────────────────────────────────────────────────────────────
// Routes are mirrored into the URL hash (works on GitHub Pages with no server
// config) so the back button and refresh work and screens are shareable. The
// Sleeper session isn't persisted (the demo re-asks each visit), so a cold load
// of a sim/pilot-backed route can't rebuild its in-memory league — those fall
// back to the returning-user default rather than showing stale data.
function routeToHash(r: Route): string {
  switch (r.name) {
    case 'splash': return '#/';
    case 'leagues': return '#/leagues';
    case 'live': return '#/live';
    case 'demo': return r.view === 'board' ? '#/demo/board' : '#/demo';
    case 'sleeperLeague': return `#/sleeper/${encodeURIComponent(r.leagueId)}`;
    case 'connect': return `#/connect/${encodeURIComponent(r.provider)}`;
    case 'hub': return '#/hub';
    case 'league': return '#/league';
    case 'matchup': return `#/matchup/${r.week}/${r.phase}`;
    case 'final': return `#/final/${r.week}`;
  }
}
/** URL hash → Route, or null when the hash carries no (valid) route so the caller
 *  can fall back to its default (e.g. a first visit with no hash). Board/sim
 *  routes are intentionally not restored here — they need in-memory league state
 *  a cold load doesn't have — so they resolve to the default instead. */
function hashToRoute(hash: string): Route | null {
  const h = (hash || '').replace(/^#/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  if (h === '') return null;
  const seg = h.split('/');
  switch (seg[0]) {
    case 'leagues': return { name: 'leagues' };
    case 'live': return { name: 'live' };
    case 'demo': return { name: 'demo', view: seg[1] === 'board' ? 'board' : 'clean' };
    case 'connect': return seg[1] ? { name: 'connect', provider: decodeURIComponent(seg[1]) as ProviderId } : null;
    default: return null;
  }
}
/** Boot route: the URL hash if it names a self-contained screen (refresh keeps
 *  your place, screens are shareable), else the returning-user default — a
 *  signed-in live user to their pilot, everyone else to the playable demo. */
function bootRoute(): Route {
  const r = hashToRoute(typeof window !== 'undefined' ? window.location.hash : '');
  if (r) return r;
  try { if (localStorage.getItem('dripLive') === '1') return { name: 'live' }; } catch { /* ignore */ }
  return { name: 'demo' };
}

/** The three switchable icon skins: classic emoji, the Football Factory art
 *  set, and the retro Pixel Bowl sprites. */
export type IconSetName = 'emoji' | 'factory' | 'pixel';

/** Card-table deck skins — the table felt + sealed card backs. Personal choice,
 *  saved per browser. Player card faces stay cream across all skins (a deck
 *  swaps its table + backs, not its faces). */
export type CardSkin = 'emerald' | 'playbook' | 'blitz' | 'rivalry' | 'allstar' | 'heritage' | 'gilded' | 'cosmic' | 'fireworks' | 'battalion';
export const CARD_SKINS: CardSkin[] = ['emerald', 'playbook', 'blitz', 'rivalry', 'allstar', 'heritage', 'gilded', 'cosmic', 'fireworks', 'battalion'];
/** Skins whose back is a full photographic card image (vs a generated pattern).
 *  These hide the ◆ gem and show only a small SCOUT chip (see PHOTO_SKINS use in
 *  Matchup SetupRow). All the image decks under public/cardbacks/. */
export const PHOTO_SKINS: CardSkin[] = ['playbook', 'blitz', 'rivalry', 'allstar', 'heritage', 'gilded', 'cosmic', 'fireworks', 'battalion'];

interface Store {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  iconSet: IconSetName;
  setIconSet: (s: IconSetName) => void;
  /** The card-table deck/felt skin (personal, saved in localStorage). */
  cardSkin: CardSkin;
  setCardSkin: (s: CardSkin) => void;
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
  /** Add a powerup to inventory WITHOUT touching the coin ledger (the hero board
   *  charges the real DB wallet separately, then grants the item). */
  grantPowerup: (id: string) => void;
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
  setSpyRevealed: (week: number, slotKey: string, reveal: 'player' | 'metric', value: string | null) => void;
  /** Field a bye player in a slot via Bye Steal (consumes one). */
  applyByeSteal: (week: number, slotKey: string, playerId: string) => boolean;
  /** Free mid-game metric re-roll via Mulligan — writes a swap, spends a Mulligan. */
  applyMulligan: (week: number, slotKey: string, atClock: number, atRt: number, toMetricId: string) => boolean;
  /** Fire EMP on a live window: freeze opponent drips from `clock` for 10 min. */
  applyEmp: (week: number, win: WindowId, clock: number) => boolean;
  /** Arm Rivalry on a window (blind, pre-kickoff): siphon 50% of same-position opponents at window-end. */
  applyRivalry: (week: number, win: WindowId) => boolean;
  /** Remove Rivalry from a window (refund). */
  removeRivalry: (week: number, win: WindowId) => void;
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
const ICONSET_KEY = 'gc-iconset';
const CARDSKIN_KEY = 'gc-cardskin';
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
  // The Sleeper username is session-only on purpose: every visit to the demo
  // requires re-entering it to reach its leagues, so nothing is remembered
  // across loads. (Purge the key older builds persisted.)
  const [sleeperUser, setSleeperUserState] = useState<ProviderUser | null>(() => {
    try { localStorage.removeItem(SLEEPER_KEY); } catch { /* ignore */ }
    return null;
  });
  const setSleeperUser = (u: ProviderUser | null) => {
    setSleeperUserState(u);
    if (u) { identify(u.userId, { username: u.username }); track(Ev.sleeperConnected); }
  };
  // Boot from the URL hash (refresh keeps your place; screens are shareable), else
  // the returning-user default: a signed-in live user to their pilot, everyone
  // else to the playable demo. The ?live=1 / OAuth deep links in App.tsx still
  // override this after mount.
  const [route, setRoute] = useState<Route>(() => bootRoute());
  // Each navigate pushes the route into the URL hash so back/forward step between
  // screens and every screen has a real, bookmarkable URL.
  const navigate = (r: Route) => {
    setRoute(r);
    track(Ev.screenView, { screen: r.name });
    try { window.history.pushState({ __route: r }, '', routeToHash(r)); } catch { /* ignore */ }
  };
  useEffect(() => {
    // Normalize the URL to the resolved boot route (a first visit, or a hash that
    // named a non-restorable board route, may differ from what's in the address).
    try { window.history.replaceState({ __route: route }, '', routeToHash(route)); } catch { /* ignore */ }
    // Back/forward: re-read the route from the (now-updated) hash; a hash that
    // doesn't name a restorable screen falls back to the demo landing.
    const onPop = () => { setRoute(hashToRoute(window.location.hash) ?? { name: 'demo' }); };
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
    clearLivePlays(); clearLiveGameFeeds(); // drop any prior league's live overlays
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
    resetToDemoLeague(); clearSyntheticWeeks(); clearLivePlays(); clearLiveGameFeeds(); clearRuntimeHeadshots();
    setActiveLeagueState(LEAGUE); setIsSimLeague(false); setYouTeam(YOU_TEAM_ID); setLiveCtx(null);
  };
  const [iconSet, setIconSetState] = useState<IconSetName>(() => {
    try {
      // 'pixel' is parked — anyone who saved it drops back to the default.
      const saved = localStorage.getItem(ICONSET_KEY) as IconSetName | null;
      return saved === 'emoji' || saved === 'factory' ? saved : 'factory';
    } catch { return 'factory'; }
  });
  const setIconSet = (s: IconSetName) => {
    setIconSetState(s);
    try { localStorage.setItem(ICONSET_KEY, s); } catch { /* ignore */ }
  };
  const [cardSkin, setCardSkinState] = useState<CardSkin>(() => {
    try {
      const saved = localStorage.getItem(CARDSKIN_KEY) as CardSkin | null;
      return saved && CARD_SKINS.includes(saved) ? saved : 'blitz';
    } catch { return 'blitz'; }
  });
  const setCardSkin = (s: CardSkin) => {
    setCardSkinState(s);
    try { localStorage.setItem(CARDSKIN_KEY, s); } catch { /* ignore */ }
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
    if (liveCtx) return; // live coins/inventory are server-backed — don't clobber the demo save
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

  // Entering a live pilot board: load the team's server-backed inventory (owned
  // power-ups persist across devices) and start applied clean (armed powerups
  // aren't server-backed yet). Leaving it: restore the demo save from localStorage.
  const wasLive = useRef(false);
  const appliedHydrated = useRef(false);
  useEffect(() => {
    if (liveCtx) {
      wasLive.current = true;
      appliedHydrated.current = false;
      myInventory(liveCtx.matchupId).then((inv) => setInventory(inv ?? {})).catch(() => setInventory({}));
      // Restore the full working applied-state: armed buffs (scored, from
      // applied_state) + the working blob (extra slots, swaps, backups, targeted).
      const wk = liveCtx.week;
      Promise.all([
        myBuffs(liveCtx.matchupId).catch(() => [] as string[]),
        myHeroApplied(liveCtx.matchupId).catch(() => ({})),
        myTargeted(liveCtx.matchupId, liveCtx.userId).catch(() => ({} as TargetedState)),
      ])
        .then(([buffs, blob, tgt]) => {
          const b = (blob ?? {}) as Partial<AppliedWeek>;
          // The server's targeted record (applied_state, what the worker scores)
          // wins over the pre-lock working blob — it's the only store live-phase
          // applications (EMP, swaps) can reach after hero_applied freezes.
          const sk = (e: { win: string; slot: string }) => `${e.win}#${e.slot}`;
          const swaps = { ...(b.swaps ?? {}) };
          for (const [k, s] of Object.entries(tgt.swaps ?? {})) {
            const [w, i] = k.split('|');
            swaps[`${w}#${i}`] = { atClock: s.atClock, atRt: s.atRt, toMetricId: s.toMetric, toPlayerId: s.toPlayer };
          }
          const lastSpy = tgt.spy?.length ? tgt.spy[tgt.spy.length - 1] : undefined;
          setApplied({ [wk]: {
            extraSlots: b.extraSlots ?? {}, swaps, backups: b.backups ?? {},
            doubleOrNothing: tgt.don ? sk(tgt.don) : b.doubleOrNothing,
            spy: lastSpy ? { slotKey: sk(lastSpy), reveal: lastSpy.reveal } : b.spy,
            byeSteal: tgt.byeSteal ? { slotKey: sk(tgt.byeSteal), playerId: tgt.byeSteal.slug } : b.byeSteal,
            emp: (tgt.emp && Object.keys(tgt.emp).length ? tgt.emp : b.emp) as AppliedWeek['emp'],
            rivalry: b.rivalry,
            buffs: Object.fromEntries((buffs ?? []).map((x) => [x, true as const])),
          } });
        })
        .catch(() => setApplied({}))
        .finally(() => { appliedHydrated.current = true; });
    } else if (wasLive.current) {
      wasLive.current = false;
      appliedHydrated.current = false;
      const s = loadState();
      creditedWeeks.current = new Set(s.weeks);
      setCoins(s.coins); setInventory(s.inv); setApplied(s.applied);
    }
  }, [liveCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live: persist the working applied blob (minus buffs → applied_state, and
  // lineup → sealed_pick) on every change, once hydrated, so it restores anywhere.
  useEffect(() => {
    if (!liveCtx || !appliedHydrated.current) return;
    const cur = applied[liveCtx.week];
    if (!cur) return;
    const rest: Record<string, unknown> = { ...cur };
    delete rest.lineup; delete rest.buffs;
    heroSetApplied(liveCtx.matchupId, rest).catch(() => {});
  }, [applied, liveCtx]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Grant an owned powerup without spending store coin — the hero board charges
  // the real DB wallet, then calls this to add the item to inventory.
  const grantPowerup = (id: string): void => {
    setInventory((prev) => { const next = { ...prev, [id]: (prev[id] ?? 0) + 1 }; persist({ inv: next }); return next; });
  };

  // Live leagues: keep owned inventory server-backed. Buys are recorded by
  // wallet_buy_powerup; here we mirror consumes (arm/apply) and refunds (disarm/
  // back-out) so ownership persists across devices. Fire-and-forget.
  const syncInv = (id: string, delta: number): void => {
    if (!liveCtx) return;
    (delta < 0 ? consumeInventory : refundInventory)(liveCtx.matchupId, id).catch(() => {});
  };
  // The armed buff ids for a week (pre-mutation snapshot from `applied`).
  const armedBuffs = (week: number): string[] => { const b = applied[week]?.buffs ?? {}; return Object.keys(b).filter((k) => b[k]); };
  // Persist the armed buff set server-side on the hero board (survives reload).
  const pushBuffs = (buffs: string[]): void => { if (liveCtx) heroSetBuffs(liveCtx.matchupId, buffs).catch(() => {}); };

  const useConsumable = (id: string): boolean => {
    if ((inventory[id] ?? 0) <= 0) return false;
    const nextInv = { ...inventory, [id]: inventory[id] - 1 };
    setInventory(nextInv); persist({ inv: nextInv }); syncInv(id, -1);
    return true;
  };

  // Consume one powerup and merge a patch into applied[week], preserving the
  // week's other applied effects. Returns false if none held.
  const consumeAndApply = (id: string, week: number, patch: (cur: AppliedWeek) => AppliedWeek): boolean => {
    if ((inventory[id] ?? 0) <= 0) return false;
    const nextInv = { ...inventory, [id]: inventory[id] - 1 };
    const cur: AppliedWeek = applied[week] ?? { extraSlots: {}, swaps: {}, backups: {} };
    const nextApplied = { ...applied, [week]: patch({ ...cur, extraSlots: cur.extraSlots ?? {}, swaps: cur.swaps ?? {}, backups: cur.backups ?? {} }) };
    setInventory(nextInv); setApplied(nextApplied); persist({ inv: nextInv, applied: nextApplied }); syncInv(id, -1);
    return true;
  };

  const applyExtraSlot = (week: number, win: WindowId): boolean =>
    consumeAndApply('extra-slot', week, (cur) => ({ ...cur, extraSlots: { ...cur.extraSlots, [win]: (cur.extraSlots[win] ?? 0) + 1 } }));

  const armBuff = (week: number, id: string): boolean => {
    if (applied[week]?.buffs?.[id]) return false;
    // Amplifier capacity: at most 1 + Second Amp + Third Amp armed amplifiers,
    // and Third Amp only on top of Second — same gates as arm_buff server-side.
    const armed = new Set(armedBuffs(week));
    if (id === 'amp-3' && !armed.has('amp-2')) return false;
    if (isAmplifier(id) && [...armed].filter(isAmplifier).length >= ampCapacity(armed)) return false;
    const ok = consumeAndApply(id, week, (cur) => ({ ...cur, buffs: { ...cur.buffs, [id]: true } }));
    if (ok) pushBuffs([...armedBuffs(week), id]);
    return ok;
  };

  // Disarm a previously-armed buff: clear the flag and refund the consumable.
  // Functional setters so several disarms in one tick compose (persist via effect).
  // Removing amp capacity (Second/Third Amp) cascades: Third Amp goes with
  // Second, and amplifiers beyond the reduced cap disarm too — everything is
  // refunded, so the engine's capAmplifiers never silently drops a paid buff.
  const disarmBuff = (week: number, id: string): void => {
    if (!applied[week]?.buffs?.[id]) return;
    const drop = new Set([id]);
    const armed = new Set(armedBuffs(week));
    if (id === 'amp-2' && armed.has('amp-3')) drop.add('amp-3');
    if (id === 'amp-2' || id === 'amp-3') {
      const left = new Set([...armed].filter((b) => !drop.has(b)));
      const keep = capAmplifiers(left);
      for (const b of left) if (isAmplifier(b) && !keep.has(b)) drop.add(b);
    }
    setApplied((prev) => {
      const cur = prev[week]; if (!cur?.buffs?.[id]) return prev;
      const buffs = { ...cur.buffs }; for (const b of drop) delete buffs[b];
      return { ...prev, [week]: { ...cur, buffs } };
    });
    setInventory((prev) => { const next = { ...prev }; for (const b of drop) next[b] = (next[b] ?? 0) + 1; return next; });
    for (const b of drop) syncInv(b, 1);
    pushBuffs(armedBuffs(week).filter((b) => !drop.has(b)));
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
  // Live pilot: record a Spy the SERVER already consumed (use_spy, migration
  // 0060) with its revealed value — local inventory mirrors the decrement but
  // no consume/refund RPC fires (that would double-spend the item).
  const setSpyRevealed = (week: number, slotKey: string, reveal: 'player' | 'metric', value: string | null): void => {
    setInventory((prev) => ({ ...prev, spy: Math.max(0, (prev.spy ?? 0) - 1) }));
    setApplied((prev) => {
      const cur = prev[week] ?? { extraSlots: {}, swaps: {}, backups: {} };
      return { ...prev, [week]: { ...cur, spy: { slotKey, reveal, value } } };
    });
  };
  const applyByeSteal = (week: number, slotKey: string, playerId: string): boolean =>
    consumeAndApply('bye-steal', week, (cur) => ({ ...cur, byeSteal: { slotKey, playerId } }));
  const applyMulligan = (week: number, slotKey: string, atClock: number, atRt: number, toMetricId: string): boolean =>
    consumeAndApply('mulligan', week, (cur) => ({ ...cur, swaps: { ...cur.swaps, [slotKey]: { ...cur.swaps[slotKey], atClock, atRt, toMetricId } } }));
  const applyEmp = (week: number, win: WindowId, clock: number): boolean =>
    applied[week]?.emp?.[win] != null ? false : consumeAndApply('emp', week, (cur) => ({ ...cur, emp: { ...cur.emp, [win]: clock } }));
  const applyRivalry = (week: number, win: WindowId): boolean =>
    applied[week]?.rivalry?.[win] ? false : consumeAndApply('rivalry', week, (cur) => ({ ...cur, rivalry: { ...cur.rivalry, [win]: true } }));

  // ── Back-outs: clear an applied targeted powerup and refund the consumable. ──
  const clearApplied = (week: number, refundId: string, mutate: (cur: AppliedWeek) => void): void => {
    if (!applied[week]) return;
    setApplied((prev) => {
      const cur = prev[week]; if (!cur) return prev;
      const nc: AppliedWeek = { ...cur, extraSlots: { ...cur.extraSlots }, swaps: { ...cur.swaps }, backups: { ...cur.backups } };
      mutate(nc);
      return { ...prev, [week]: nc };
    });
    setInventory((prev) => ({ ...prev, [refundId]: (prev[refundId] ?? 0) + 1 })); syncInv(refundId, 1);
  };
  const clearDoubleOrNothing = (week: number): void => { if (applied[week]?.doubleOrNothing) clearApplied(week, 'double-or-nothing', (c) => { delete c.doubleOrNothing; }); };
  const clearSpy = (week: number): void => { if (applied[week]?.spy) clearApplied(week, 'spy', (c) => { delete c.spy; }); };
  const clearByeSteal = (week: number): void => { if (applied[week]?.byeSteal) clearApplied(week, 'bye-steal', (c) => { delete c.byeSteal; }); };
  const removeExtraSlot = (week: number, win: WindowId): void => {
    const n = applied[week]?.extraSlots?.[win] ?? 0; if (n <= 0) return;
    clearApplied(week, 'extra-slot', (c) => { if (n - 1 > 0) c.extraSlots[win] = n - 1; else delete c.extraSlots[win]; });
  };
  const removeRivalry = (week: number, win: WindowId): void => {
    if (!applied[week]?.rivalry?.[win]) return;
    clearApplied(week, 'rivalry', (c) => { const r = { ...c.rivalry }; delete r[win]; c.rivalry = Object.keys(r).length ? r : undefined; });
  };
  // Refund an unlock-metric powerup (when a player swaps off / clears that metric).
  const refundUnlock = (id: string): void => { setInventory((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 })); syncInv(id, 1); };

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
    () => ({ theme, setTheme, iconSet, setIconSet, cardSkin, setCardSkin, bigText, setBigText, fullStats, setFullStats, route, navigate, sleeperUser, setSleeperUser, activeLeague, isSimLeague, liveCtx, loadSimLeague, exitSimLeague, youTeamId, setYouTeam, demoWeek, setDemoWeek, coins, creditWeek, inventory, buyPowerup, grantPowerup, useConsumable, applied, applyExtraSlot, applyMetricSwap, applyPlayerSwap, setBackupTarget, setLineup, armBuff, disarmBuff, setDoubleOrNothing, remapDoubleOrNothing, setSpy, setSpyRevealed, applyByeSteal, applyMulligan, applyEmp, applyRivalry, removeRivalry, clearDoubleOrNothing, clearSpy, clearByeSteal, removeExtraSlot, refundUnlock, resetDripCoin }),
    [theme, iconSet, cardSkin, bigText, fullStats, route, sleeperUser, activeLeague, isSimLeague, liveCtx, youTeamId, demoWeek, coins, inventory, applied],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside provider');
  return s;
}

export const LEAGUE_REF = LEAGUE;
