import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../app/store';
import type { Phase } from '../app/store';
import { Brand, SiteSettings, PlayerImg, Avatar, Img, InjuryBadge, useIsMobile, ModalBackdrop } from '../app/ui';
import { FieldView, SlotFieldViews, FieldBoard, type FieldBoardEntry } from '../app/FieldView';
import { setLiveGameFeed, feedRowsToWeek, hasGameFeed } from '../data/gameFeed';
import { avatarUrl, teamLogo } from '../data/media';
import { nflGameForTeam, gamesInWindow, windowDateLabel, weekDateRange, weekLockLabel, windowTimeLabel, windowKickoffSod, windowKickoffMs, kickoffLabel, windowsForWeek, setTestTimeline, testTimelineOn, TEST_LOCK_LEAD_MS, TEST_GAME_MS, isPreseasonWeek, preseasonWeekNum } from '../data/nflSlate';
import { METRICS, metricById } from '../data/metrics';
import { POWERUPS, powerupById, isAmplifier, ampCapacity, type Powerup } from '../data/powerups';
import { getTeam, getPlayer, gameForTeam, getActiveLeague } from '../data/league';
import { buildLiveLeague } from '../data/liveBoard';
import {
  windowPools, defaultLineup, aiLineup, slotKey, buildMatchup, banksAtClock, weekEarnings, metricCoin, coinRisk, slotCoin, WEEKLY_STIPEND, UNOPPOSED_COIN, slotsFor, totalSlotsWith, byePlayers,
} from '../engine/matchup';
import { fmtClock, statlineAt, realTimeAt, clockAtRealTime, projectedPoints, GAME_SECONDS, type StatLine } from '../engine/sim';
import { REAL_WEEKS, loadRealWeek, isRealWeekLoaded, realPbpFor, realGameEndClock, setLivePlays, liveRowsToPbp } from '../data/realPbp';
import { ShopModal } from './LeagueOverview';
import { buildBeats, type Beat } from '../data/demoNarration';
import { myPicks, savePicks, getRevealedPicks, revealedOppBuffs, weekLivePlays, weekGameFeeds, ensureWallet, walletBuyPowerup, applyTargeted, clearTargeted, useSpy as spyRevealRpc, leagueWeeklyBudget, leagueTestLiveAt, leagueCardTheme, myMatchup, type PickRow } from '../data/liveApi';
import { CardTableCss, PowerupHand } from '../app/cardTable';
import { DemoOverlay, DemoViewToggle } from './DemoOverlay';
import { Rulebook } from './Rulebook';
import { PuIcon, GameIcon, Emoji, DripCoin, UI_ART } from '../app/gameIcons';
import type { Pick, Player, Pos, WindowId, PbpEvent, BuffFx, Metric } from '../types';

const TICK_MS = 700;
const TICK_SECONDS = 20;

// Window kickoff time-of-day, parsed from a window's `time` string ("Sun 1:00p")
// to seconds-since-midnight (ET) — the base for the wall-clock header.
// Seconds-of-day → "1:14 PM" (wraps past midnight).
function fmtTimeOfDay(secOfDay: number): string {
  const t = ((Math.floor(secOfDay) % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}
// Compact time-of-day for the narrow log clock column — "1:14p".
function fmtTimeShort(secOfDay: number): string {
  const t = ((Math.floor(secOfDay) % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600);
  const mm = Math.floor((t % 3600) / 60);
  const ap = h >= 12 ? 'p' : 'a';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(mm).padStart(2, '0')}${ap}`;
}

// Real game clock from game-elapsed seconds (0..3600): "Q2 4:58", "HALF",
// "FINAL". Quarters are 15:00 each; halftime sits at the end of Q2.
function fmtGameClock(c: number): string {
  if (c >= 3600) {
    // Overtime: 10-minute period(s) past 60:00 (OT, 2OT, …).
    const into = c - 3600;
    const per = Math.floor(into / 600);
    const rem = Math.max(0, 600 - (into - per * 600)); // seconds left in the OT period
    const m = Math.floor(rem / 60), s = Math.round(rem % 60);
    return `${per === 0 ? 'OT' : `${per + 1}OT`} ${m}:${String(s).padStart(2, '0')}`;
  }
  const q = Math.min(4, Math.floor(c / 900) + 1);
  const rem = 900 - (c - (q - 1) * 900); // seconds left in the quarter
  if (q === 2 && rem <= 1) return 'HALF';
  const m = Math.floor(rem / 60);
  const s = Math.round(rem % 60);
  return `Q${q} ${m}:${String(s).padStart(2, '0')}`;
}

// Drip coin — the active icon set's coin artwork (minted-coin SVG on the
// emoji set), so coin reads as currency wherever it appears.
const CoinIcon = DripCoin;

// A prominent coin-earn pill for the play-by-play log.
function CoinPill({ amt }: { amt: number }) {
  return (
    <span className="mono" title="drip coin earned" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, fontWeight: 700, color: '#F2C14E', background: 'color-mix(in srgb, #F2C14E 16%, transparent)', border: '1px solid color-mix(in srgb, #F2C14E 50%, transparent)', borderRadius: 4, padding: '0 4px', marginLeft: 5, verticalAlign: 'middle' }}>
      <CoinIcon size={10} /> +{amt}
    </span>
  );
}

// Power-ups the interactive board demo lets a viewer arm pre-kick (real engine
// buffs). The chosen one surfaces on the authentic board — e.g. Garbage Time's
// "×2" notes in the play log.
const DEMO_POWERUPS = [
  { id: 'garbage-time', icon: '🗑️', name: 'Garbage Time', blurb: 'Every point you score in the final 5 minutes counts double.' },
  { id: 'momentum', icon: '📈', name: 'Momentum', blurb: 'When your drip goes hot, it runs 3× instead of 2×.' },
  { id: 'floodgates', icon: '🌊', name: 'Floodgates', blurb: 'Your drips ignore the opponent’s pauses and erases all game.' },
];

// Stable empty record so props that fall back to "nothing" keep a constant
// identity — lets the memoized WindowSection skip re-renders on every clock tick
// (a fresh {} each render would look like a changed prop and defeat the memo).
const EMPTY_REC: Record<string, never> = {};

export function Matchup({ week, initialPhase, demo = false }: { week: number; initialPhase: Phase; demo?: boolean }) {
  const { youTeamId: YOU, navigate, liveCtx, loadSimLeague, coins, creditWeek, inventory, grantPowerup, useConsumable, applied, applyExtraSlot, applyMetricSwap, applyPlayerSwap, setBackupTarget, setLineup, armBuff, disarmBuff, setDoubleOrNothing, remapDoubleOrNothing, setSpy, setSpyRevealed, applyByeSteal, applyMulligan, applyEmp, clearDoubleOrNothing, clearSpy, clearByeSteal, removeExtraSlot, refundUnlock, resetDripCoin } = useStore();
  const [demoBuff, setDemoBuff] = useState('garbage-time'); // the power-up the demo viewer armed
  const buffs = useMemo(() => (demo ? { [demoBuff]: true } : (applied[week]?.buffs ?? EMPTY_REC)), [demo, demoBuff, applied, week]);
  const buffsKey = JSON.stringify(buffs);
  const extraSlots = applied[week]?.extraSlots ?? {};
  const swaps = applied[week]?.swaps ?? {};
  const backupAssign = applied[week]?.backups ?? EMPTY_REC;
  const aw = applied[week];
  const extras = demo ? {} : { doubleOrNothing: aw?.doubleOrNothing, byeSteal: aw?.byeSteal, emp: aw?.emp };
  const extrasKey = JSON.stringify(extras);
  const oppId = gameForTeam(YOU, week)?.oppId ?? 'rock-tunnel';
  const you = getTeam(YOU)!;
  const opp = getTeam(oppId)!;

  const isMobile = useIsMobile();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  // Seed from any persisted lineup edits so the FINAL screen replays the exact
  // lineup you fielded (Matchup remounts per week, so this initializer is fresh).
  // Demo mode plays the canonical default lineup and never writes to the store.
  const [picks, setPicks] = useState<Record<string, Pick>>(() => (demo ? {} : applied[week]?.lineup ?? {}));
  useEffect(() => { if (!demo) setLineup(week, picks); }, [picks]); // eslint-disable-line react-hooks/exhaustive-deps -- persist lineup edits; setLineup isn't memoized

  // Live pilot: hydrate this matchup's saved sealed picks from Supabase once, so a
  // returning manager sees the lineup they sealed. Won't clobber in-progress edits.
  const hydratedRef = useRef(false);
  const [heroHydrated, setHeroHydrated] = useState(false); // saved picks loaded → safe to auto-save
  useEffect(() => {
    if (!liveCtx || hydratedRef.current) return;
    hydratedRef.current = true;
    myPicks(liveCtx.matchupId, liveCtx.userId).then((rows) => {
      const lineup: Record<string, Pick> = {};
      for (const r of rows) {
        if (!r.player_slug) continue;
        lineup[`${r.game_window}#${r.roster_slot}`] = { playerId: r.player_slug, metricId: r.metric_id };
      }
      if (Object.keys(lineup).length) setPicks((prev) => (Object.keys(prev).length ? prev : lineup));
    }).catch(() => {}).finally(() => setHeroHydrated(true));
  }, [liveCtx]); // eslint-disable-line react-hooks/exhaustive-deps
  // Live board: auto-save the working lineup (debounced) so each window's picks
  // are sealed by its own lock — there's no manual LOCK IN. Only after the saved
  // lineup has hydrated, so we never clobber a returning manager's sealed picks.
  useEffect(() => {
    if (!liveCtx || !heroHydrated) return;
    const t = setTimeout(() => {
      const rows: PickRow[] = [];
      for (const [key, p] of Object.entries(picks)) {
        if (!p?.playerId) continue;
        const [win, slot] = key.split('#');
        if (win == null || slot == null) continue;
        rows.push({ game_window: win, roster_slot: slot, player_slug: p.playerId, metric_id: p.metricId ?? null });
      }
      savePicks(liveCtx.matchupId, liveCtx.userId, rows).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [picks, liveCtx, heroHydrated]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selSlot, setSelSlot] = useState<string | null>(null);
  // Per-window playback: each window runs its own clock + play/pause. The clock
  // is game-elapsed seconds by default, or REAL wall-clock seconds since kickoff
  // when wallClock is on — then each game in the window advances at its own real
  // pace (one game can pull minutes ahead of another), keyed off each play's `t`.
  const [winClocks, setWinClocks] = useState<Record<string, number>>({});
  const [winPlaying, setWinPlaying] = useState<Record<string, boolean>>({});
  const [speed, setSpeed] = useState(1); // playback speed multiplier (1/2/4/8)
  const [fieldsOpen, setFieldsOpen] = useState(false); // ▦ ALL GAMES field board overlay
  // Playback clock mode: 'game' = all games lockstep on game clock; 'feed' =
  // real-time reveal but scoring still resolves on game clock; 'real' = real-time
  // reveal AND cross-game effects (TE-TD drip nuke) resolve in real-time order.
  const [clockMode, setClockMode] = useState<'game' | 'feed' | 'real'>('game');
  const wallClock = clockMode !== 'game';   // real wall-clock reveal (each game its own pace)
  const realResolve = clockMode === 'real'; // resolve cross-game effects by real time
  const [openPBP, setOpenPBP] = useState<Record<string, boolean>>({});
  const [swapTarget, setSwapTarget] = useState<{ key: string; win: WindowId } | null>(null);
  const [backupMenu, setBackupMenu] = useState<{ key: string; required?: boolean } | null>(null);
  const [pickerSlot, setPickerSlot] = useState<{ key: string; win: WindowId } | null>(null);
  const [puView, setPuView] = useState<'active' | 'apply' | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [scoutWin, setScoutWin] = useState<WindowId | null>(null); // sealed opponent spot tapped — show candidate pool
  const [pendingApply, setPendingApply] = useState<string | null>(null); // a targeted powerup awaiting a spot tap
  const [byeStealSlot, setByeStealSlot] = useState<string | null>(null); // empty slot chosen for Bye Steal, awaiting a player
  const [spySlot, setSpySlot] = useState<string | null>(null); // slate slot tapped for Spy, awaiting reveal choice
  const [mulliganSlot, setMulliganSlot] = useState<string | null>(null); // your slot tapped for Mulligan, awaiting metric
  // Live pilot: mirror targeted power-ups into the server scoring record
  // (apply_targeted / clear_targeted / use_spy, migration 0060) — the worker
  // resolves from applied_state.targeted; the local store stays the board's
  // display source. Rejections are logged, not blocking (the board already
  // shows the local application; the server is authoritative at FINAL).
  const keyParts = (k: string) => ({ win: k.split('#')[0], slot: k.split('#')[1] });
  const liveTargeted = (id: string, payload: Record<string, unknown>) => {
    if (!liveCtx) return;
    applyTargeted(liveCtx.matchupId, id, payload)
      .then((r) => { if (!r.ok) console.warn('[live] apply_targeted', id, r.error); })
      .catch((e) => console.warn('[live] apply_targeted', id, e));
  };
  const liveClearTargeted = (id: string) => {
    if (!liveCtx) return;
    clearTargeted(liveCtx.matchupId, id).catch((e) => console.warn('[live] clear_targeted', id, e));
  };
  function applyToSpot(key: string) {
    if (pendingApply === 'double-or-nothing') { if (setDoubleOrNothing(week, key)) liveTargeted('double-or-nothing', keyParts(key)); setPendingApply(null); }
    else if (pendingApply === 'bye-steal') setByeStealSlot(key); // keep pending until a bye player is chosen
    else if (pendingApply === 'spy') setSpySlot(key); // keep pending until a reveal is chosen
    else if (pendingApply === 'mulligan') setMulliganSlot(key); // keep pending until a metric is chosen
    else if (pendingApply === 'metric-swap' || pendingApply === 'player-swap') { setSwapTarget({ key, win: key.split('#')[0] as WindowId }); setPendingApply(null); } // open the swap menu on the tapped live spot
  }
  function applyToWindow(win: WindowId) {
    // On the live board a live window's "now" is its latest ingested play (winMax
    // via effWinClock); the sim board uses the manual playback clock. Either way
    // EMP freezes forward from the current position, never retroactively.
    if (pendingApply === 'emp') { const clock = effWinClock(win); if (applyEmp(week, win, clock)) liveTargeted('emp', { win, clock }); setPendingApply(null); }
  }
  // Rosters expand in setup (you need them to set lineups), collapse otherwise.
  const [rosterOpen, setRosterOpen] = useState<{ you: boolean; their: boolean }>(() => ({ you: initialPhase === 'setup', their: initialPhase === 'setup' }));
  const toggleRoster = (side: 'you' | 'their') => setRosterOpen((o) => ({ ...o, [side]: !o[side] }));
  // On mobile the rosters are full-width blocks above the board, and selection is
  // done by tapping a spot — so keep both collapsed by default.
  useEffect(() => { if (isMobile) setRosterOpen({ you: false, their: false }); }, [isMobile]);

  // Lazy-load this week's real play-by-play (per-week JSON) before resolving.
  const [ready, setReady] = useState(() => !REAL_WEEKS.has(week) || isRealWeekLoaded(week));
  // Non-null → the week's plays failed to load; without this the board would
  // silently render every player at 0.0 (a broken-looking game) on a fetch error.
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  // In-board Rulebook (the hidden-metric mechanic is otherwise only explained in
  // the settings-gear modal — undiscoverable at the moment you must commit metrics).
  const [showRules, setShowRules] = useState(false);
  useEffect(() => {
    if (!REAL_WEEKS.has(week) || isRealWeekLoaded(week)) { setReady(true); setLoadFailed(false); return; }
    setReady(false); setLoadFailed(false);
    let alive = true;
    loadRealWeek(week).then((ok) => { if (alive) { if (ok) setReady(true); else setLoadFailed(true); } });
    return () => { alive = false; };
  }, [week, loadAttempt]);

  const extraKey = JSON.stringify(extraSlots);
  const youPools = useMemo(() => windowPools(YOU, week), [week]);
  const oppPools = useMemo(() => windowPools(oppId, week), [week, oppId]);
  const youDefault = useMemo(() => defaultLineup(YOU, week, extraSlots), [week, ready, extraKey]);
  // Live pilot: the opponent's REAL sealed lineup, revealed at lock (RLS hides it
  // until then). Polls so a reveal lands without a reload. Null → fall back to AI.
  const [liveOppPicks, setLiveOppPicks] = useState<Record<string, Pick> | null>(null);
  // The opponent's REAL armed buffs, revealed at lock (null → keep AI buffs).
  const [liveOppBuffs, setLiveOppBuffs] = useState<string[] | null>(null);
  useEffect(() => {
    if (!liveCtx) { setLiveOppPicks(null); setLiveOppBuffs(null); return; }
    let alive = true;
    let t: ReturnType<typeof setInterval> | undefined;
    let slow = false;
    const stop = () => { if (t) { clearInterval(t); t = undefined; } };
    const load = async () => {
      if (document.hidden) return; // don't poll a backgrounded tab
      try {
        const [rows, oppBuffs] = await Promise.all([
          getRevealedPicks(liveCtx.matchupId),
          revealedOppBuffs(liveCtx.matchupId, liveCtx.userId).catch(() => null),
        ]);
        const opp: Record<string, Pick> = {};
        for (const r of rows) {
          if (r.app_user_id === liveCtx.userId || !r.player_slug) continue; // skip mine / empty
          opp[`${r.game_window}#${r.roster_slot}`] = { playerId: r.player_slug, metricId: r.metric_id };
        }
        if (alive) {
          setLiveOppPicks(Object.keys(opp).length ? opp : null);
          setLiveOppBuffs(oppBuffs);
          // Windows reveal one at a time (each seals at its OWN kickoff), so keep
          // polling all week — but back off once the first reveal lands: later
          // reveals arrive at window kickoffs, hours apart, not seconds.
          if (Object.keys(opp).length && !slow) { slow = true; stop(); t = setInterval(load, 60_000); }
        }
      } catch { /* keep prior */ }
    };
    load();
    t = setInterval(load, 8000);
    return () => { alive = false; stop(); };
  }, [liveCtx]);

  // Live pilot scoring: install the worker's ingested plays for the week so the
  // board resolves the REAL game (DNP 0 pre-kickoff, accruing as plays land).
  // Bumps livePbpVer so the resolution memo recomputes on each refresh.
  const [livePbpVer, setLivePbpVer] = useState(0);
  useEffect(() => {
    if (!liveCtx) return;
    let alive = true;
    // Claim the week's game-feed slot up front (empty) so a 2026 live week can
    // never fall back to the baked 2025 week of the same number mid-fetch.
    setLiveGameFeed(liveCtx.week, { games: {}, teams: {} });
    const load = async () => {
      if (document.hidden) return; // don't refetch the week's plays in a background tab
      try {
        const [rows, feeds] = await Promise.all([weekLivePlays(liveCtx.week), weekGameFeeds(liveCtx.week)]);
        setLivePlays(liveCtx.week, liveRowsToPbp(rows));
        setLiveGameFeed(liveCtx.week, feedRowsToWeek(feeds));
        if (alive) setLivePbpVer((v) => v + 1);
      } catch { /* keep prior */ }
    };
    load();
    const t = setInterval(load, 15000); // ~worker poll cadence
    // Refresh immediately when the tab returns to the foreground (a hidden-tab
    // interval tick was skipped, so pull the latest right away).
    const onVis = () => { if (!document.hidden) load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [liveCtx]); // eslint-disable-line react-hooks/exhaustive-deps

  // The AI scouts which players you CAN field each window (the pool, not your spot
  // assignments — those stay sealed) and defends each window accordingly. What the
  // opponent has armed is hidden, exactly as your loadout is hidden from it. In a
  // live matchup, the opponent's revealed sealed lineup wins over the AI.
  const oppPicks = useMemo(() => liveOppPicks ?? aiLineup(oppId, YOU, week, extraSlots), [liveOppPicks, oppId, week, ready, extraKey]);
  const byeYou = useMemo(() => byePlayers(YOU, week), [week]);
  const byeTheir = useMemo(() => byePlayers(oppId, week), [week, oppId]);

  const playerWindow = useMemo(() => {
    const m = new Map<string, WindowId>();
    (Object.keys(youPools) as WindowId[]).forEach((w) => youPools[w].forEach((p) => m.set(p.id, w)));
    return m;
  }, [youPools]);

  const effYouPicks = useMemo<Record<string, Pick>>(() => {
    // Live board: score EXACTLY the lineup you saved — the worker resolves the
    // sealed picks, so the board must not silently inject a default lineup.
    if (liveCtx) return picks;
    // The demo always shows the seeded lineup (even in setup) so a viewer can edit
    // a metric on a real, populated board; the live game keeps setup hidden.
    if (phase === 'setup' && !demo) return picks;
    return { ...youDefault, ...picks };
  }, [phase, picks, youDefault, demo, liveCtx]);

  // Seed the demo's local lineup once so its setup board is populated and metric
  // edits (pickMetricFor needs picks[key]) take hold — never touches the store.
  useEffect(() => { if (demo && ready && Object.keys(picks).length === 0) setPicks(youDefault); }, [demo, ready, youDefault]); // eslint-disable-line react-hooks/exhaustive-deps

  const swapsKey = JSON.stringify(swaps);
  const backupsKey = JSON.stringify(backupAssign);
  const resolved = useMemo(
    () => buildMatchup(YOU, oppId, week, effYouPicks, oppPicks, extraSlots, swaps, backupAssign, buffs, extras, realResolve, liveOppBuffs ?? undefined),
    [oppId, week, effYouPicks, oppPicks, ready, extraKey, swapsKey, backupsKey, buffsKey, extrasKey, realResolve, liveOppBuffs, livePbpVer],
  );

  // Your player's name at each slot key — for showing a backup's chosen target
  // (and the targeted starter's incoming backup) in both spots.
  const slotName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const w of resolved.windows) for (const s of w.slots) if (s.you) m[slotKey(s.win, s.slotIndex)] = s.you.player.name;
    return m;
  }, [resolved]);

  // Drip coin: weekly stipend + unopposed bounty + events of note + turnover swing.
  const turnoverCoin = buffs['turnover-boost'] ? 25 : 10;
  const earnings = useMemo(() => weekEarnings(resolved, 'you', week, turnoverCoin), [resolved, week, buffsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const weekCoins = earnings.total;
  const [earnOpen, setEarnOpen] = useState(false);
  // Live board: page to another week's matchup — rebuild this league's board for
  // the new week (its rosters, opponent + matchup ctx) and open it, exactly like
  // entering the hero board fresh. Null unless a switch is in flight.
  const [switchingWeek, setSwitchingWeek] = useState<number | null>(null);
  const preseason = isPreseasonWeek(week);
  // The selector pages the league's whole matchup timeline as ONE continuous
  // range — preseason (offset) weeks first, then the regular season — so a
  // preseason-enabled league flips PRE 1 → … → PRE 3 → WK 1 → … in one stride.
  // Driven by the schedule the league actually has, so it only offers real weeks.
  const orderedWeeks = (() => {
    const ws = new Set(getActiveLeague().schedule.map((g) => g.week));
    ws.add(week);
    return [...ws].sort((a, b) => (isPreseasonWeek(a) ? 0 : 1) - (isPreseasonWeek(b) ? 0 : 1) || a - b);
  })();
  const wIdx = orderedWeeks.indexOf(week);
  const prevWeek = wIdx > 0 ? orderedWeeks[wIdx - 1] : null;
  const nextWeek = wIdx >= 0 && wIdx < orderedWeeks.length - 1 ? orderedWeeks[wIdx + 1] : null;
  async function goToWeek(target: number | null) {
    if (!liveCtx || switchingWeek != null || target == null) return;
    if (!orderedWeeks.includes(target) || target === week) return;
    setSwitchingWeek(target);
    try {
      const m = await myMatchup(liveCtx.leagueId, liveCtx.rosterId, target).catch(() => null);
      const { built, youTeamId } = await buildLiveLeague(liveCtx.leagueId, liveCtx.rosterId, target);
      const ctx = m ? { matchupId: m.id, userId: liveCtx.userId, leagueId: liveCtx.leagueId, rosterId: liveCtx.rosterId, week: m.week } : null;
      loadSimLeague(built, youTeamId, ctx);
      navigate({ name: 'matchup', week: target, phase: 'setup' });
    } catch {
      setSwitchingWeek(null); // stay put on failure
    }
  }
  // Live board: the league's own weekly coin budget (set by the commissioner)
  // replaces the generic flat-stipend copy in the earnings sheet.
  const [leagueBudget, setLeagueBudget] = useState<number | null>(null);
  useEffect(() => {
    if (!liveCtx) { setLeagueBudget(null); return; }
    leagueWeeklyBudget(liveCtx.leagueId).then(setLeagueBudget).catch(() => setLeagueBudget(null));
  }, [liveCtx]); // eslint-disable-line react-hooks/exhaustive-deps
  // Super-admin live-test mode: when the league has a test anchor, install the
  // compressed slate timeline so this board runs Setup→Locked→Live→Final in real
  // minutes. `testAnchor` drives the state memo; cleared when leaving the board.
  const [testAnchor, setTestAnchor] = useState<number | null>(null);
  useEffect(() => {
    if (!liveCtx) { setTestTimeline(null); setTestAnchor(null); return; }
    leagueTestLiveAt(liveCtx.leagueId).then((ms) => { setTestTimeline(ms); setTestAnchor(ms); }).catch(() => { setTestTimeline(null); setTestAnchor(null); });
    return () => setTestTimeline(null);
  }, [liveCtx]); // eslint-disable-line react-hooks/exhaustive-deps
  // Hero board: the coin balance is the REAL team wallet (starts at 0, seeded by
  // the commissioner). Load it once; the worker credits earnings in-season, so the
  // board doesn't run the demo weekly-credit here.
  const [liveWallet, setLiveWallet] = useState<number | null>(null);
  useEffect(() => {
    if (!liveCtx) { setLiveWallet(null); return; }
    ensureWallet(liveCtx.matchupId).then((b) => setLiveWallet(Number(b ?? 0))).catch(() => setLiveWallet(0));
  }, [liveCtx]); // eslint-disable-line react-hooks/exhaustive-deps
  const coinBal = liveCtx ? (liveWallet ?? 0) : coins;
  // Card-table theme (league_pref.card_theme): on flagged leagues the owned
  // power-ups also render as a hand of cards pinned to the bottom of the board.
  const [cardHand, setCardHand] = useState(false);
  useEffect(() => {
    if (!liveCtx) { setCardHand(false); return; }
    leagueCardTheme(liveCtx.leagueId).then((v) => setCardHand(!!v)).catch(() => setCardHand(false));
  }, [liveCtx]); // eslint-disable-line react-hooks/exhaustive-deps
  // Buy a power-up into inventory, charged against the real wallet (hero board).
  const buyFromWallet = async (id: string): Promise<boolean> => {
    if (!liveCtx) return false;
    const r = await walletBuyPowerup(liveCtx.matchupId, id).catch(() => null);
    if (!r?.ok) return false;
    grantPowerup(id); setLiveWallet(Number(r.balance ?? 0));
    return true;
  };
  useEffect(() => {
    if (demo || liveCtx) return; // demo/hero board never touch the store's coin ledger
    if (phase === 'live' || phase === 'final') creditWeek(week, weekCoins);
  }, [phase, week, weekCoins]);

  // Each window's own end-of-game clock (latest event among its slots).
  const winMax = useMemo(() => {
    const m: Record<string, number> = {};
    for (const rw of resolved.windows) {
      let mx = 0;
      for (const s of rw.slots) for (const e of s.events) if (e.clock > mx) mx = e.clock;
      m[rw.window.id] = mx || GAME_SECONDS;
    }
    return m;
  }, [resolved]);

  // Each window's real-time length: the latest real `t` (seconds since kickoff)
  // reached by any of its games — the wall-clock counterpart of winMax.
  const winRealMax = useMemo(() => {
    const m: Record<string, number> = {};
    for (const rw of resolved.windows) {
      const cap = winMax[rw.window.id] ?? GAME_SECONDS;
      let mx = 0;
      for (const s of rw.slots) for (const p of [s.you, s.their]) {
        if (!p) continue;
        const r = realTimeAt(p.player, week, cap, p.metricId ?? undefined);
        if (r > mx) mx = r;
      }
      m[rw.window.id] = mx || cap;
    }
    return m;
  }, [resolved, winMax, week]);
  // The playback ceiling for the active mode (game-elapsed vs real wall-clock).
  const winTarget = wallClock ? winRealMax : winMax;

  // ── Real-time live board driver ─────────────────────────────────────────────
  // The live board advances on the real clock: each window locks 1h before its
  // real kickoff, goes LIVE at kickoff, and reads FINAL once its game window has
  // elapsed. The play-by-play log fills in from the worker feed — which only
  // carries plays that have already happened — so a LIVE window simply reveals
  // everything ingested so far. No manual LOCK IN / ▶: the wall clock drives it.
  const LOCK_LEAD_MS = 3_600_000;        // lineups lock 1h before kickoff
  const GAME_WINDOW_MS = 4 * 3_600_000;  // a game reads "in progress" for ~4h after kickoff
  type WinState = 'setup' | 'locked' | 'live' | 'final';
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!liveCtx) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [liveCtx]);
  const liveWinState = useMemo(() => {
    // Live-test mode compresses both the lock lead and the live duration so the
    // whole flow plays out in minutes (windowKickoffMs already returns the
    // compressed anchor-relative kickoff).
    const lockLead = testTimelineOn() ? TEST_LOCK_LEAD_MS : LOCK_LEAD_MS;
    const gameDur = testTimelineOn() ? TEST_GAME_MS : GAME_WINDOW_MS;
    const out: Record<string, WinState> = {};
    for (const w of windowsForWeek(week)) {
      const k = windowKickoffMs(week, w.id);
      let s: WinState = 'setup';
      if (k != null) {
        if (nowMs >= k + gameDur) s = 'final';
        else if (nowMs >= k) s = 'live';
        else if (nowMs >= k - lockLead) s = 'locked';
      }
      out[w.id] = s;
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, nowMs, livePbpVer, testAnchor]);
  // Overall live-board phase, derived from its windows (all setup → setup, all
  // final → final, else live). Drives the header + board-level gating; a manual
  // phase tab is disabled on the live board.
  const liveBoardPhase: Phase | null = useMemo(() => {
    if (!liveCtx) return null;
    const states = windowsForWeek(week).map((w) => liveWinState[w.id]);
    if (!states.length) return 'setup';
    if (states.every((s) => s === 'setup')) return 'setup';
    if (states.every((s) => s === 'final')) return 'final';
    return 'live';
  }, [liveCtx, liveWinState, week]);
  useEffect(() => { if (liveBoardPhase) setPhase(liveBoardPhase); }, [liveBoardPhase]);
  const winRt = (wid: string): WinState | null => (liveCtx ? liveWinState[wid] ?? 'setup' : null);
  const winPhaseFor = (wid: string): Phase => {
    const s = winRt(wid);
    if (!s) return phase;                              // sim/demo board: single global phase
    return s === 'setup' ? 'setup' : s === 'final' ? 'final' : 'live'; // locked & live both render live
  };
  // A LIVE/FINAL window reveals every play ingested so far (winMax); locked/setup
  // reveal nothing. The sim/demo board keeps its manual playback clock.
  const effWinClock = (wid: string): number => {
    if (!liveCtx) return winClocks[wid] ?? 0;
    const s = winRt(wid);
    return s === 'live' || s === 'final' ? (winMax[wid] ?? GAME_SECONDS) : 0;
  };

  // On entering live/final — or switching clock mode — seed each window's
  // position + play state. (Toggling modes re-seeds to 0 so playback replays
  // cleanly on the new axis rather than mixing units.) Sim/demo only — the live
  // board is driven by the real clock above.
  useEffect(() => {
    if (liveCtx) return;
    if (phase === 'setup') return;
    const clocks: Record<string, number> = {};
    const playing: Record<string, boolean> = {};
    for (const id of Object.keys(winTarget)) {
      clocks[id] = phase === 'final' ? winTarget[id] : 0;
      playing[id] = false; // live starts paused — hit ▶ per window or RUN ALL
    }
    setWinClocks(clocks);
    setWinPlaying(playing);
  }, [phase, winTarget]);

  // Single ticker advances every playing window toward its own (mode) max.
  // Sim/demo only — the live board reveals plays on the real clock, not playback.
  useEffect(() => {
    if (liveCtx || phase !== 'live') return;
    const id = setInterval(() => {
      setWinClocks((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const wid of Object.keys(winTarget)) {
          if (winPlaying[wid] && (prev[wid] ?? 0) < winTarget[wid]) {
            next[wid] = Math.min(winTarget[wid], (prev[wid] ?? 0) + TICK_SECONDS * speed);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, winPlaying, winTarget, speed]);

  // ── guided-demo mode: feature one window and auto-play it on the real board ──
  // Pick the most EXCITING head-to-head window — the most back-and-forth duels
  // (lead changes, tight margins) plus on-field action — so the 60-second
  // highlight always lands on a thriller. The board carries the armed demo
  // power-up (Garbage Time), so its "×2" notes surface live in the play log.
  // Lock the featured window from a scout of the DEFAULT lineup, so the viewer's
  // metric edits don't make the spotlight jump windows mid-setup.
  const demoWinId = useMemo<WindowId | null>(() => {
    if (!demo) return null;
    const scout = buildMatchup(YOU, oppId, week, youDefault, oppPicks, extraSlots, swaps, backupAssign, {}, {}, realResolve);
    let bestId: WindowId | null = null, bestScore = -Infinity;
    for (const rw of scout.windows) {
      let action = 0, exc = 0;
      for (const s of rw.slots) {
        for (const e of s.events) action += (e.effect ? 3 : 0) + (e.coin ? 2 : 0) + (e.sig ? 1 : 0);
        if (s.you && s.their) {
          let flips = 0, prev = 0;
          for (const e of s.events) { const d = (e.youBank ?? 0) - (e.theirBank ?? 0); if (Math.sign(d) && prev && Math.sign(d) !== prev) flips++; if (Math.sign(d)) prev = Math.sign(d); }
          const last = s.events[s.events.length - 1];
          exc += flips * 8 - (last ? Math.abs((last.youBank ?? 0) - (last.theirBank ?? 0)) : 0) * 0.3;
        }
      }
      const score = exc + action;
      if (score > bestScore) { bestScore = score; bestId = rw.window.id; }
    }
    return bestId;
  }, [demo, oppId, week, youDefault, oppPicks, extraKey, swapsKey, backupsKey, realResolve]); // eslint-disable-line react-hooks/exhaustive-deps
  // The featured window from the LIVE resolve, so it reflects the viewer's picks.
  const demoWin = useMemo(() => (demo && demoWinId ? (resolved.windows.find((w) => w.window.id === demoWinId) ?? null) : null), [demo, resolved, demoWinId]);
  const demoBeats = useMemo<Beat[]>(() => (demoWin ? buildBeats(demoWin.slots.flatMap((s) => s.events)) : []), [demoWin]);
  // Auto-start the featured window once the viewer kicks off (phase → live), at
  // ~2× ⇒ ~60s through a full game.
  const demoStarted = useRef(false);
  useEffect(() => {
    if (!demo || phase !== 'live' || !demoWin || demoStarted.current) return;
    if (!(demoWin.window.id in winTarget)) return;
    demoStarted.current = true;
    setSpeed(2);
    setWinPlay(demoWin.window.id, true);
  }, [demo, phase, demoWin, winTarget]); // eslint-disable-line react-hooks/exhaustive-deps -- setWinPlay is a stable hoisted fn

  // Auto-open a window's slot logs while it's in progress, auto-collapse them
  // when it finishes (or the board goes FINAL). Fires only on the transition,
  // so a manual toggle in between is respected until the next state change.
  const prevActive = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (phase === 'setup') { prevActive.current = {}; return; }
    setOpenPBP((prev) => {
      let next = prev; let changed = false;
      for (const rw of resolved.windows) {
        const id = rw.window.id;
        // Live board: a window's log is "active" while it's LIVE on the real
        // clock; sim/demo uses the playback position.
        const active = liveCtx ? winRt(id) === 'live' : (() => { const c = winClocks[id] ?? 0; return phase === 'live' && c > 0 && c < (winTarget[id] ?? Infinity); })();
        if (active !== (prevActive.current[id] ?? false)) {
          if (!changed) { next = { ...prev }; changed = true; }
          for (const s of rw.slots) next[slotKey(id, s.slotIndex)] = active;
        }
        prevActive.current[id] = active;
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, winClocks, winMax, resolved, liveCtx, liveWinState]);

  // ── totals at each window's own clock ──
  const { youTotal, themTotal } = useMemo(() => {
    if (phase === 'final') return { youTotal: resolved.youFinal, themTotal: resolved.theirFinal };
    if (phase === 'setup') return { youTotal: 0, themTotal: 0 };
    let y = 0; let t = 0;
    for (const rw of resolved.windows) {
      // Live board: each window is sampled at its real-time position (all plays
      // ingested so far for a live/final window, none for locked/setup).
      const c = effWinClock(rw.window.id);
      for (const s of rw.slots) {
        if (!s.you || !s.their) continue;
        // In wall-clock mode each side is sampled at ITS game's clock for the
        // window's real-time position; in game mode both share the one clock.
        const yc = wallClock ? clockAtRealTime(s.you.player, week, c, s.you.metricId ?? undefined) : c;
        const tc = wallClock ? clockAtRealTime(s.their.player, week, c, s.their.metricId ?? undefined) : c;
        // A suppress DST's earn shows in its log but banks 0 (spent on halving).
        y += s.suppressSpentYou != null ? 0 : banksAtClock(s.events, yc).you;
        t += s.suppressSpentTheir != null ? 0 : banksAtClock(s.events, tc).their;
      }
    }
    for (const b of resolved.bonuses ?? []) y += b.points; // armed-buff payouts
    return { youTotal: Math.round(y * 10) / 10, themTotal: Math.round(t * 10) / 10 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved, winClocks, phase, wallClock, week, liveCtx, liveWinState, winMax]);

  // Every window has played out to its own end — the board is effectively final.
  const allWindowsDone = useMemo(() => {
    const ids = Object.keys(winTarget);
    return ids.length > 0 && ids.every((id) => (winClocks[id] ?? 0) >= (winTarget[id] ?? Infinity));
  }, [winClocks, winTarget]);
  // Live board is final only when the real clock has retired every window.
  const boardFinal = liveCtx ? phase === 'final' : (phase === 'final' || (phase === 'live' && allWindowsDone));

  // Count slots that have a player placed (the visible action). Previously this
  // counted only metric-complete picks, so the "SLOTS SET" tally appeared frozen
  // after placing a player but before choosing the hidden metric.
  const filledCount = Object.values(picks).filter((p) => p.playerId).length;
  // Placed players still missing their (required) hidden metric — those slots
  // score 0 until a metric is chosen, so surface them as an interim step.
  const metriclessCount = Object.values(picks).filter((p) => p.playerId && !p.metricId).length;
  const totalSlots = totalSlotsWith(week, extraSlots);
  const anyPlaying = Object.values(winPlaying).some(Boolean);
  const extraSlotQty = inventory['extra-slot'] ?? 0;

  // ── Power-up windows: every window has its own lock/live timeline. A 'pre'
  // power-up can be applied until the first window starts; a 'live' one only
  // while a window is still running (not yet closed). ──
  const winLife = useMemo(() => {
    const out: Record<string, 'pending' | 'live' | 'closed'> = {};
    for (const id of Object.keys(winTarget)) {
      if (liveCtx) {
        // Live board: the timeline is the real clock, not playback.
        const s = liveWinState[id] ?? 'setup';
        out[id] = s === 'live' ? 'live' : s === 'final' ? 'closed' : 'pending';
      } else {
        const c = winClocks[id] ?? 0;
        out[id] = c <= 0 ? 'pending' : c >= winTarget[id] ? 'closed' : 'live';
      }
    }
    return out;
  }, [winClocks, winTarget, liveCtx, liveWinState]);
  const anyStarted = Object.values(winLife).some((s) => s !== 'pending');
  const liveWins = windowsForWeek(week).filter((w) => winLife[w.id] === 'live');
  const preKickPhase = phase === 'live' && !anyStarted; // locked in, no game kicked yet

  // On lock-in, walk through EVERY UNOPPOSED player (your player with no
  // head-to-head opponent) — they're best-ball backups that can sub in. The
  // prompt is a REQUIRED interrupt: it can't be dismissed, so you can't reach
  // the live screen without making a call (challenge a starter, or take the 0).
  // Every sub-capable unopposed spot is prompted once per lock-in —
  // even ones with a saved assignment (the card pre-selects it to confirm or
  // change) — so you never have to hunt for the spot's reassign button.
  const backupPrompted = useRef<Set<string>>(new Set());
  useEffect(() => { if (phase !== 'live') backupPrompted.current = new Set(); }, [phase]);
  useEffect(() => {
    // Sim/demo only — the live board doesn't force a lock-in interrupt (backups
    // stay assignable from each spot). Its clock is real, not a manual kickoff.
    if (liveCtx || phase !== 'live' || anyStarted || backupMenu) return;
    const next = resolved.windows.flatMap((w) => w.slots).find((s) => {
      if (!s.backup || !s.you) return false;
      const k = slotKey(s.win, s.slotIndex);
      if (ZERO_BANK_METRICS.has(`${s.you.player.pos}:${s.you.metricId}`)) return false; // can't sub (scores 0)
      return !backupPrompted.current.has(k);
    });
    if (next) { const k = slotKey(next.win, next.slotIndex); backupPrompted.current.add(k); setBackupMenu({ key: k, required: true }); }
  }, [phase, anyStarted, backupMenu, resolved, backupAssign]);

  // Unopposed best-ball backups (your player, no head-to-head opponent, a scoring
  // metric) that haven't yet been assigned to sub for a starter. On the live board
  // these surface as a CTA during the locked/live period instead of a forced modal.
  const pendingBackups = useMemo(() => resolved.windows.flatMap((w) => w.slots).filter((s) => {
    if (!s.backup || !s.you) return false;
    if (ZERO_BANK_METRICS.has(`${s.you.player.pos}:${s.you.metricId}`)) return false;
    return !backupAssign[slotKey(s.win, s.slotIndex)];
  }), [resolved, backupAssign]);

  // Everything currently in effect, with a back-out where the store supports it.
  const activeEffects: { key: string; id?: string; icon: string; name: string; detail: string; onRemove?: () => void }[] = [];
  for (const id of Object.keys(buffs)) if (buffs[id]) { const p = powerupById(id); if (p) activeEffects.push({ key: 'b-' + id, id, icon: p.icon, name: p.name, detail: 'Armed · whole field', onRemove: phase === 'setup' ? () => disarmBuff(week, id) : undefined }); }
  if (aw?.doubleOrNothing) { const s = resolved.windows.flatMap((w) => w.slots).find((s) => slotKey(s.win, s.slotIndex) === aw.doubleOrNothing); activeEffects.push({ key: 'don', id: 'double-or-nothing', icon: '⚖️', name: 'Double or Nothing', detail: 'Staked ' + (s?.you?.player.name ?? '—'), onRemove: phase === 'setup' ? () => { clearDoubleOrNothing(week); liveClearTargeted('double-or-nothing'); } : undefined }); }
  if (aw?.byeSteal) activeEffects.push({ key: 'bye', id: 'bye-steal', icon: '🪂', name: 'Bye Steal', detail: 'Fielded ' + (getPlayer(aw.byeSteal.playerId)?.name ?? '—'), onRemove: phase === 'setup' ? () => { clearByeSteal(week); liveClearTargeted('bye-steal'); } : undefined });
  if (aw?.spy) { const sp = aw.spy; activeEffects.push({ key: 'spy', id: 'spy', icon: '👁️', name: 'Spy', detail: `Revealed a slot’s ${sp.reveal}`, onRemove: preKickPhase && !liveCtx ? () => clearSpy(week) : undefined }); } // live: use_spy already consumed the item — no undo
  for (const [win, n] of Object.entries(aw?.extraSlots ?? {})) if ((n ?? 0) > 0) { const wl = windowsForWeek(week).find((w) => w.id === win)?.label ?? win; activeEffects.push({ key: 'x-' + win, id: 'extra-slot', icon: '➕', name: 'Extra Slot', detail: `+${n} on ${wl}`, onRemove: phase === 'setup' ? () => removeExtraSlot(week, win as WindowId) : undefined }); }
  for (const [win, c] of Object.entries(aw?.emp ?? {})) if (c != null) { const wl = windowsForWeek(week).find((w) => w.id === win)?.label ?? win; activeEffects.push({ key: 'emp-' + win, id: 'emp', icon: '💥', name: 'EMP', detail: `Fired on ${wl}` }); }

  // Owned power-ups you can still apply right now, scoped to open windows. 'pre'
  // power-ups lock at the first kickoff; 'live' ones need a running window.
  const armedSet = new Set(Object.keys(buffs).filter((k) => buffs[k]));
  const appliable = POWERUPS.filter((p) => (inventory[p.id] ?? 0) > 0).map((p) => {
    const buff = isTeamBuff(p.id);
    let ok = false; let deadline = '';
    if (p.timing === 'pre') {
      if (p.id === 'spy') { ok = preKickPhase; deadline = 'After lock, before kickoff'; }
      else { ok = phase === 'setup'; deadline = 'Before lock-in'; }
    } else {
      ok = liveWins.length > 0;
      deadline = liveWins.length ? `Live now: ${liveWins.map((w) => w.label).join(', ')}` : 'When a window goes live';
    }
    if (buff && buffs[p.id]) ok = false; // already armed → lives in Active
    const action: 'arm' | 'apply' | 'hint' = buff ? 'arm' : SPOT_APPLY.has(p.id) ? 'apply' : 'hint';
    // Amplifier capacity (mirrors store.armBuff / server arm_buff gates).
    let blocked: string | undefined;
    if (p.id === 'amp-3' && !armedSet.has('amp-2')) blocked = 'Arm Second Amp first';
    else if (isAmplifier(p.id) && [...armedSet].filter(isAmplifier).length >= ampCapacity(armedSet)) {
      blocked = `Amp limit ${ampCapacity(armedSet)} — arm ${armedSet.has('amp-2') ? 'Third' : 'Second'} Amp to run more`;
    }
    return { p, ok, deadline, action, blocked };
  }).filter((x) => x.ok);

  // ── setup interactions ──
  // Keep each window's spots filled top-down: collapse any gap so a filled spot
  // never sits below an empty one.
  function compactPicks(p: Record<string, Pick>): Record<string, Pick> {
    const out: Record<string, Pick> = {};
    for (const w of windowsForWeek(week)) {
      const n = slotsFor(w.id, week, extraSlots);
      let idx = 0;
      for (let i = 0; i < n; i++) {
        const pk = p[slotKey(w.id, i)];
        if (pk) out[slotKey(w.id, idx++)] = pk;
      }
    }
    return out;
  }

  // Double or Nothing is staked on a slot but conceptually on a PLAYER. After a
  // pick change, keep the stake on that player: follow them to their new slot
  // when the lineup compacts, or refund the powerup if they were removed.
  function reconcileDoN(prev: Record<string, Pick>, next: Record<string, Pick>) {
    const key = aw?.doubleOrNothing;
    if (!key) return;
    const stakedId = prev[key]?.playerId;
    if (!stakedId) return; // unknown / already orphaned
    const newKey = Object.keys(next).find((k) => next[k].playerId === stakedId);
    if (!newKey) { clearDoubleOrNothing(week); liveClearTargeted('double-or-nothing'); } // staked player removed → refund
    else if (newKey !== key) { remapDoubleOrNothing(week, newKey); liveTargeted('double-or-nothing', keyParts(newKey)); } // shifted by compaction → follow
  }

  // Position-based armed buffs (Hail Mary→QB, Pick Six→DST, WR/TE Carries→WR/TE,
  // Trick Play→non-QB) are wasted if the lineup no longer starts an eligible
  // position. After a pick change, refund any that lost their last eligible spot.
  function reconcileBuffs(next: Record<string, Pick>) {
    const armed = Object.keys(buffs).filter((id) => buffs[id] && POSITION_REFUND_BUFFS.has(id));
    if (!armed.length) return;
    const positions = Object.values(next).map((pk) => getPlayer(pk.playerId)?.pos).filter(Boolean) as Pos[];
    for (const id of armed) {
      if (!positions.some((pos) => buffAppliesToSpot(id, pos, null))) disarmBuff(week, id); // no eligible starter → refund
    }
  }

  // Refund an unlock-metric powerup if this pick was using one (dropped a spot).
  function refundUnlockFor(pk?: Pick) {
    if (!pk?.metricId) return;
    const pl = getPlayer(pk.playerId);
    const m = pl ? metricById(pl.pos, pk.metricId) : null;
    if (m?.lock) refundUnlock(m.lock);
  }

  function assignFromRoster(playerId: string) {
    const win = playerWindow.get(playerId);
    if (!win) return;
    // Live board: a window is editable only until its own lock (1h pre-kick).
    // Sim/demo board: editable while the single board phase is setup.
    if (liveCtx ? winRt(win) !== 'setup' : phase !== 'setup') return;
    const nSlots = slotsFor(win, week, extraSlots);
    // Already slotted in this window → just (re)select it.
    for (let i = 0; i < nSlots; i++) {
      const k = slotKey(win, i);
      if (picks[k]?.playerId === playerId) { setSelSlot(k); return; }
    }
    const n = { ...picks };
    for (const k of Object.keys(n)) if (n[k].playerId === playerId) delete n[k];
    // Always take the first open spot top-down (a full window replaces spot 0).
    let target = slotKey(win, 0);
    for (let i = 0; i < nSlots; i++) { const k = slotKey(win, i); if (!n[k]) { target = k; break; } }
    n[target] = { playerId, metricId: null };
    const next = compactPicks(n);
    reconcileDoN(picks, next);
    reconcileBuffs(next);
    setPicks(next);
    setSelSlot(null);
  }

  function pickMetricFor(key: string, metricId: string) {
    const pk = picks[key];
    const player = pk ? getPlayer(pk.playerId) : null;
    const m = player ? metricById(player.pos, metricId) : null;
    // A locked (unlock) metric consumes one of its powerup the first time it's set.
    if (m?.lock && pk?.metricId !== metricId && !useConsumable(m.lock)) return;
    // Switching off a previously-picked unlock metric refunds it.
    const prevM = player && pk?.metricId ? metricById(player.pos, pk.metricId) : null;
    if (prevM?.lock && prevM.id !== metricId) refundUnlock(prevM.lock);
    setPicks((prev) => prev[key] ? { ...prev, [key]: { ...prev[key], metricId } } : prev);
    setSelSlot(null);
  }
  function clearSlot(key: string) {
    refundUnlockFor(picks[key]);
    const n = { ...picks }; delete n[key];
    const next = compactPicks(n);
    reconcileDoN(picks, next);
    reconcileBuffs(next);
    setPicks(next);
    setSelSlot(null);
  }
  // Assign a specific player to a specific spot (tap-a-spot picker), de-duped and
  // compacted so the window stays filled top-down.
  function assignToSlot(key: string, playerId: string) {
    if (picks[key]?.playerId !== playerId) refundUnlockFor(picks[key]); // replacing a spot's player drops its unlock
    const n = { ...picks };
    for (const k of Object.keys(n)) if (n[k].playerId === playerId) delete n[k];
    n[key] = { playerId, metricId: null };
    const next = compactPicks(n);
    reconcileDoN(picks, next);
    reconcileBuffs(next);
    setPicks(next);
    setSelSlot(null);
  }

  function lockIn() {
    // Sim/demo only — the live board has no LOCK IN button (it auto-saves the
    // lineup and locks each window on the real clock; see the auto-save effect).
    setPhase('live'); setSelSlot(null); setRosterOpen({ you: false, their: false });
  }
  // Demo kickoff (setup → live auto-play) and a way back to re-pick.
  function demoKick() { setSelSlot(null); setPhase('live'); }
  function demoBackToSetup() { demoStarted.current = false; setWinClocks({}); setWinPlaying({}); setSelSlot(null); setPhase('setup'); }
  function changePhase(p: Phase) { setPhase(p); setSelSlot(null); setRosterOpen({ you: p === 'setup', their: p === 'setup' }); }
  function toggleAll() {
    const v = !anyPlaying;
    setWinPlaying(() => { const n: Record<string, boolean> = {}; for (const k of Object.keys(winMax)) n[k] = v; return n; });
  }
  function setWinPlay(wid: string, v: boolean) { setWinPlaying((p) => ({ ...p, [wid]: v })); }
  function replayWin(wid: string) { setWinClocks((c) => ({ ...c, [wid]: 0 })); setWinPlaying((p) => ({ ...p, [wid]: true })); }

  const headline = phase === 'setup' ? 'Set Your Windows' : phase === 'live' ? 'Live Resolution' : `Week ${week} — Final`;
  // The real live board advances on real time (no manual per-window playback), so
  // it drops the "hit ▶ / run them all" copy; the sim/demo replay keeps it.
  const subhead = liveCtx
    ? `${you.name} vs ${opp.name}`
    : `${you.name} vs ${opp.name} · each window plays on its own clock — hit ▶ on any window, or run them all.`;

  if (loadFailed) {
    return (
      <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, color: 'var(--dim)', fontSize: 12, letterSpacing: '0.06em', textAlign: 'center', padding: 20 }}>
        <div>COULDN'T LOAD WEEK {week}'S PLAYS.</div>
        <div style={{ color: 'var(--faint)', fontSize: 10, maxWidth: 320, lineHeight: 1.6 }}>
          Check your connection — without this data the board can't score. Nothing was lost.
        </div>
        <button
          onClick={() => setLoadAttempt((n) => n + 1)}
          style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 6, padding: '8px 18px', cursor: 'pointer' }}
        >
          RETRY
        </button>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, color: 'var(--dim)', fontSize: 12, letterSpacing: '0.08em' }}>
        LOADING WEEK {week}…
      </div>
    );
  }

  // ── REAL-BOARD guided demo: the AUTHENTIC board. First the real setup — the
  // viewer edits a hidden metric and arms a power-up on the featured window —
  // then they kick off and it auto-plays + narrates. A slim render path so the
  // full setup/live/final UI below is untouched; it reuses WindowSection.
  if (demo) {
    const fid = demoWin?.window.id;
    if (!demoWin || !fid) {
      return (
        <div className="mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, color: 'var(--dim)', fontSize: 12 }}>
          Demo unavailable. <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ marginLeft: 6, background: 'none', border: 'none', color: 'var(--you)', cursor: 'pointer' }}>← back</button>
        </div>
      );
    }
    const demoHeader = (
      <header style={{ flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 8, padding: isMobile ? '8px 10px' : '8px 16px', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <Brand onClick={() => navigate({ name: 'splash' })} />
          <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ fontSize: 10, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '10px 12px', cursor: 'pointer' }}>← back</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate({ name: 'live' })} className="mono" title="See the real live head-to-head board"
            style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--you) 40%, var(--bd))', borderRadius: 4, padding: '5px 9px', cursor: 'pointer' }}>◫ live board →</button>
          <DemoViewToggle view="board" onSwitch={(v) => v === 'clean' && navigate({ name: 'demo', view: 'clean' })} />
          <SiteSettings />
        </div>
      </header>
    );

    // ── interactive setup: real metric pickers + arm a power-up, then kick off ──
    if (phase === 'setup') {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
          {demoHeader}
          <main style={{ flex: 1, overflow: 'auto', padding: isMobile ? '14px 10px 40px' : '18px 16px 48px' }}>
            <div style={{ maxWidth: 560, margin: '0 auto' }}>
              <div style={{ textAlign: 'center', marginBottom: 14 }}>
                <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Set your window</div>
                <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, lineHeight: 1.45 }}>This is the real board. Tap a player’s metric to change how he scores — it’s hidden from your opponent — then arm a power-up and kick off.</div>
              </div>
              <WindowSection
                rw={demoWin} week={week} phase="setup" clock={0} maxClock={winTarget[fid] ?? GAME_SECONDS}
                wallClock={wallClock} realClock={realResolve} wallSeconds={0} playing={false}
                onTogglePlay={() => {}} onReplay={() => {}}
                canApplyExtra={false} extraSlotQty={0} onApplyExtra={() => {}} onRemoveExtra={() => {}} onAssignBackup={() => {}}
                picks={effYouPicks} selSlot={selSlot} pickMetricFor={pickMetricFor}
                onClearSlot={() => {}} onOpenPicker={() => {}}
                openPBP={openPBP} togglePBP={(k) => setOpenPBP((o) => ({ ...o, [k]: !o[k] }))}
                youPools={youPools} inventory={inventory} onAssign={() => {}} turnoverCoin={turnoverCoin}
                backups={backupAssign} slotName={slotName} armed={buffs} aw={aw}
                applyMode={null} onApplyToSpot={() => {}} onApplyToWindow={() => {}} onScout={() => {}}
                lockPlayer
              />
              {/* arm a power-up */}
              <div style={{ marginTop: 16 }}>
                <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 8 }}>ARM A POWER-UP</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {DEMO_POWERUPS.map((pu) => {
                    const on = demoBuff === pu.id;
                    return (
                      <button key={pu.id} onClick={() => setDemoBuff(pu.id)} style={{ display: 'flex', alignItems: 'flex-start', gap: 11, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', background: on ? 'color-mix(in srgb, var(--you) 9%, var(--surface))' : 'var(--surface)', border: `1.5px solid ${on ? 'var(--you)' : 'var(--bd)'}`, boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--you) 14%, transparent)' : 'none' }}>
                        <span style={{ fontSize: 22, lineHeight: 1 }}><PuIcon id={pu.id} emoji={pu.icon} size={26} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="grotesk" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{pu.name}</div>
                          <div style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 3, lineHeight: 1.4 }}>{pu.blurb}</div>
                        </div>
                        {on && <span style={{ flex: 'none', fontSize: 13, fontWeight: 700, color: 'var(--you)' }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
              <button onClick={demoKick} className="mono" style={{ width: '100%', marginTop: 18, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '13px 0', cursor: 'pointer', boxShadow: '0 0 20px color-mix(in srgb, var(--you) 30%, transparent)' }}>▶ KICK OFF — watch it play</button>
            </div>
          </main>
        </div>
      );
    }

    // ── live/final: the featured window auto-plays, narrated ──
    const dClock = winClocks[fid] ?? 0;
    const dMax = winTarget[fid] ?? GAME_SECONDS;
    const dPlaying = !!winPlaying[fid];
    const dEnded = dClock > 0 && dClock >= dMax;
    const activeBeat = demoBeats.reduce<Beat | null>((acc, b) => (b.clock <= dClock ? b : acc), null);
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {demoHeader}
        <main style={{ flex: 1, overflow: 'auto', padding: isMobile ? '14px 10px 40px' : '18px 16px 48px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 14 }}>
              <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Your window, live</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6 }}>{you.name} vs {opp.name}, auto-playing off real NFL plays. The captions explain each swing — and <button onClick={demoBackToSetup} className="mono" style={{ background: 'none', border: 'none', padding: 0, color: 'var(--you)', cursor: 'pointer', fontSize: 12 }}>↩ change your picks</button>.</div>
            </div>
            <WindowSection
              rw={demoWin}
              week={week}
              phase={phase}
              clock={dClock}
              maxClock={dMax}
              wallClock={wallClock}
              realClock={realResolve}
              wallSeconds={wallClock ? dClock : ((winMax[fid] ? dClock / winMax[fid] : 0) * (winRealMax[fid] ?? 0))}
              playing={dPlaying}
              onTogglePlay={() => setWinPlay(fid, !dPlaying)}
              onReplay={() => replayWin(fid)}
              canApplyExtra={false}
              extraSlotQty={0}
              onApplyExtra={() => {}}
              onRemoveExtra={() => {}}
              onAssignBackup={() => {}}
              picks={effYouPicks}
              selSlot={null}
              pickMetricFor={() => {}}
              onClearSlot={() => {}}
              onOpenPicker={() => {}}
              openPBP={openPBP}
              togglePBP={(k) => setOpenPBP((o) => ({ ...o, [k]: !o[k] }))}
              youPools={youPools}
              inventory={inventory}
              onAssign={() => {}}
              turnoverCoin={turnoverCoin}
              backups={backupAssign}
              slotName={slotName}
              armed={buffs}
              aw={aw}
              applyMode={null}
              onApplyToSpot={() => {}}
              onApplyToWindow={() => {}}
              onScout={() => {}}
            />
            <DemoOverlay
              beat={activeBeat}
              clock={dClock}
              maxClock={dMax}
              playing={dPlaying}
              ended={dEnded}
              speed={speed}
              onToggle={() => (dEnded ? replayWin(fid) : setWinPlay(fid, !dPlaying))}
              onReplay={() => replayWin(fid)}
              onCycleSpeed={() => setSpeed((s) => (s >= 4 ? 1 : s * 2))}
              onSeeLeague={() => navigate({ name: 'splash' })}
              onJoinPilot={() => navigate({ name: 'live' })}
            />
          </div>
        </main>
      </div>
    );
  }

  // A signed-in live user (reached the board through their leagues) — they're
  // already "in", so the sim/demo board gives them a way back to their leagues and
  // drops the "get a league code" invite CTA.
  const loggedIn = (() => { try { return localStorage.getItem('dripLive') === '1'; } catch { return false; } })();
  // ── Live-board header pieces (shared between the desktop single row and the
  // mobile two-row layout so nothing overlaps on a narrow screen). ──
  const liveLeaguesChip = (
    <button onClick={() => navigate({ name: 'live' })} className="mono" title="Back to your leagues" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 10%, var(--surface))', border: '1px solid color-mix(in srgb, var(--you) 35%, var(--bd))', borderRadius: 4, padding: '5px 8px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>← my leagues</button>
  );
  // Super-admin live-test badge — makes it obvious the board is on a compressed
  // test clock, not the real slate.
  const liveTestChip = testAnchor != null ? (
    <span className="mono" title="Live-test mode: this league's windows run on a compressed schedule (super-admin toggle)." style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', border: '1px solid var(--warn)', borderRadius: 4, padding: '5px 7px', whiteSpace: 'nowrap', flexShrink: 0 }}>🧪 TEST</span>
  ) : null;
  // Preseason badge — makes it obvious this board is a real 2026 preseason matchup,
  // not a regular-season week.
  const livePreseasonChip = preseason ? (
    <span className="mono" title="Preseason: this league is playing a real 2026 NFL preseason matchup (super-admin toggle)." style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 12%, var(--surface))', border: '1px solid var(--you)', borderRadius: 4, padding: '5px 7px', whiteSpace: 'nowrap', flexShrink: 0 }}>🏈 PRESEASON</span>
  ) : null;
  const weekLabel = (w: number) => (isPreseasonWeek(w) ? `PRE ${preseasonWeekNum(w)}` : `WK ${w}`);
  const liveWeekSel = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <button onClick={() => goToWeek(prevWeek)} disabled={prevWeek == null || switchingWeek != null} title="previous week" className="mono" style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--dim)', fontSize: 12, lineHeight: 1, padding: '4px 7px', cursor: prevWeek == null || switchingWeek != null ? 'default' : 'pointer', opacity: prevWeek == null ? 0.35 : 1 }}>‹</button>
      <span className="mono" title="Week — page through the season" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', minWidth: 36, textAlign: 'center' }}>{switchingWeek != null ? `${weekLabel(switchingWeek)}…` : weekLabel(week)}</span>
      <button onClick={() => goToWeek(nextWeek)} disabled={nextWeek == null || switchingWeek != null} title="next week" className="mono" style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, color: 'var(--dim)', fontSize: 12, lineHeight: 1, padding: '4px 7px', cursor: nextWeek == null || switchingWeek != null ? 'default' : 'pointer', opacity: nextWeek == null ? 0.35 : 1 }}>›</button>
    </div>
  );
  const liveScore = (
    <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16 }}>
      <Avatar name={you.name} accent="var(--you)" size={isMobile ? 22 : 30} src={avatarUrl(you.ownerId)} />
      <span className="mono" style={{ color: 'var(--text)', fontSize: isMobile ? 20 : 28, fontWeight: 700, lineHeight: 1 }}>{youTotal.toFixed(1)}</span>
      <span className="mono" style={{ color: 'var(--faint)', fontSize: isMobile ? 10 : 13, fontWeight: 700, letterSpacing: '0.12em' }}>VS</span>
      <span className="mono" style={{ color: 'var(--text)', fontSize: isMobile ? 20 : 28, fontWeight: 700, lineHeight: 1 }}>{themTotal.toFixed(1)}</span>
      <Avatar name={opp.name} accent="var(--opp)" size={isMobile ? 22 : 30} src={avatarUrl(opp.ownerId)} />
    </div>
  );
  const liveCoin = (
    <button onClick={() => setEarnOpen(true)} title="Drip Coin — tap for earning opportunities" className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer', flexShrink: 0 }}>
      <CoinIcon size={13} />
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{Math.round(coinBal)}</span>
      {phase === 'final' && weekCoins > 0 && <span style={{ fontSize: 8.5, color: 'var(--fx-streak)' }}>+{weekCoins}</span>}
    </button>
  );
  const liveWeekResult = phase === 'final' ? (
    <button onClick={() => navigate({ name: 'final', week })} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4, flexShrink: 0 }}>WEEK RESULT →</button>
  ) : null;

  return (
    <>
      <header style={{ height: 'auto', minHeight: isMobile ? 52 : 60, flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 8, padding: isMobile ? '7px 10px' : '8px 16px', position: 'sticky', top: 0, zIndex: 40, gap: isMobile ? 12 : 10 }}>
        {liveCtx ? (
          isMobile ? (
            // Mobile: two stacked rows so the chips/score/coin never collide.
            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <Brand onClick={() => navigate({ name: 'league' })} hideDataSource />
                  {liveLeaguesChip}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {liveCoin}
                  {liveWeekResult}
                  <SiteSettings />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>{liveWeekSel}{livePreseasonChip}{liveTestChip}</div>
                {liveScore}
              </div>
            </div>
          ) : (
          // Desktop: minimal single row — Brand · big centered score · coin + gear.
          // No phase tabs (status) or lock time; each window carries its own state.
          <>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
              <Brand onClick={() => navigate({ name: 'league' })} hideDataSource />
              {liveLeaguesChip}
              {liveWeekSel}
              {livePreseasonChip}
              {liveTestChip}
            </div>
            {liveScore}
            <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
              {liveCoin}
              {liveWeekResult}
              <SiteSettings />
            </div>
          </>
          )
        ) : (
          <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <Brand onClick={() => navigate({ name: 'league' })} hideDataSource={!!liveCtx} />
          {loggedIn && !liveCtx && liveLeaguesChip}
          <div style={{ display: 'flex', gap: 2, padding: 3, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4 }}>
            {/* On the live board the phase follows the real clock — the tabs are a
                read-only progress indicator, not a switcher. */}
            {(['setup', 'live', 'final'] as Phase[]).map((p) => (
              <button key={p} onClick={() => { if (!liveCtx) changePhase(p); }} className="mono" title={liveCtx ? 'The live board advances on real time' : undefined} style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', padding: '9px 11px', borderRadius: 3, border: 'none', cursor: liveCtx ? 'default' : 'pointer', background: phase === p ? 'var(--sh)' : 'transparent', color: phase === p ? 'var(--you)' : 'var(--dim)' }}>
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          {!liveCtx && (
            <span className="mono" title="A deterministic replay of real 2025 games — Setup builds a lineup, Live watches it play, Final jumps to the result. Switch freely; nothing here is a live game in progress." style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--dim)', border: '1px solid var(--bd)', borderRadius: 3, padding: '3px 6px' }}>
              ⟳ REPLAY
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 10, whiteSpace: 'nowrap', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>
          <button onClick={() => setEarnOpen(true)} title="Drip Coin — tap for earning opportunities" className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer' }}>
            <CoinIcon size={13} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{Math.round(coinBal)}</span>
            {phase === 'final' && weekCoins > 0 && <span style={{ fontSize: 8.5, color: 'var(--fx-streak)' }}>+{weekCoins}</span>}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <Avatar name={you.name} accent="var(--you)" size={20} src={avatarUrl(you.ownerId)} />
            <span className="mono" style={{ color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>{youTotal.toFixed(1)}</span>
            <span className="mono" style={{ color: 'var(--faint)', fontSize: 9 }}>VS</span>
            <span className="mono" style={{ color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>{themTotal.toFixed(1)}</span>
            <Avatar name={opp.name} accent="var(--opp)" size={20} src={avatarUrl(opp.ownerId)} />
          </div>
          <div style={{ height: 30, width: 1, background: 'var(--bd)' }} />
          {phase === 'setup' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {/* Seed the ranked default lineup so a new user isn't forced to fill
                  all eight slots by hand before they can lock in. */}
              <button onClick={() => { setPicks(youDefault); setSelSlot(null); }} title="Fill every slot with your best available lineup" className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                ✨ Auto-fill
              </button>
              {/* Teach the hidden-metric mechanic right where the user commits it. */}
              <button onClick={() => setShowRules(true)} title="How scoring works" className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 11px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                📖 Rules
              </button>
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--faint)' }}>LOCKS IN</div>
                <div className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--warn)' }}>{weekLockLabel(week)}</div>
              </div>
              {/* Live board: no LOCK IN button — each window locks on the real clock
                  and the lineup auto-saves. Sim/demo keeps the manual lock. */}
              {liveCtx ? (
                <span className="mono" title="Your lineup saves automatically and locks 1h before each window's kickoff." style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', border: '1px solid color-mix(in srgb, var(--you) 40%, var(--bd))', background: 'color-mix(in srgb, var(--you) 10%, var(--surface))', borderRadius: 4, padding: '6px 10px' }}>✓ AUTO-SAVES</span>
              ) : (
                <button onClick={lockIn} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4, boxShadow: '0 0 20px color-mix(in srgb, var(--you) 30%, transparent)' }}>
                  LOCK IN →
                </button>
              )}
            </div>
          )}
          {phase === 'live' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: '#FF4F62', borderRadius: '50%', animation: 'lpulse 1.2s ease infinite' }} />
              <span className="mono" style={{ color: '#FF4F62', fontWeight: 700, letterSpacing: '0.14em', fontSize: 11 }}>LIVE</span>
              {/* Live board plays on the real clock — no manual RUN ALL / clock-mode
                  / speed controls. Those stay on the sim/demo replay only. */}
              {!liveCtx && <>
              <button onClick={toggleAll} title="Play — or pause — every game window at once" className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '6px 10px' }}>
                {anyPlaying ? '❚❚ PAUSE ALL' : '▶ RUN ALL'}
              </button>
              <button
                onClick={() => setClockMode((m) => (m === 'game' ? 'feed' : m === 'feed' ? 'real' : 'game'))}
                title={'Playback clock (tap to cycle):\n• GAME CLOCK — every game in a window moves in lockstep on game time\n• REAL FEED — plays reveal on the real wall clock (games desync), but the log orders/interleaves and effects resolve on the game clock\n• REAL CLOCK — plays order/interleave and effects resolve on the real clock (cross-game effects land in real-time order)'}
                className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: wallClock ? 'var(--on-accent)' : 'var(--dim)', background: clockMode === 'real' ? 'var(--warn)' : clockMode === 'feed' ? 'var(--you)' : 'var(--surface)', border: `1px solid ${clockMode === 'real' ? 'var(--warn)' : clockMode === 'feed' ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '6px 10px' }}>
                ⏱ {clockMode === 'real' ? 'REAL CLOCK' : clockMode === 'feed' ? 'REAL FEED' : 'GAME CLOCK'}
              </button>
              <button
                onClick={() => setSpeed((s) => (s >= 8 ? 1 : s * 2))}
                title="Playback speed — tap to cycle 1× / 2× / 4× / 8× (speeds up the whole season run)"
                className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: speed > 1 ? 'var(--on-accent)' : 'var(--dim)', background: speed > 1 ? 'var(--you)' : 'var(--surface)', border: `1px solid ${speed > 1 ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '6px 10px' }}>
                ⏩ {speed}×
              </button>
              </>}
              {hasGameFeed(week) && (
                <button onClick={() => setFieldsOpen(true)} title="Every game with a slotted player, as live field visuals — your plays vs your opponent's" className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '6px 10px' }}>
                  ▦ FIELDS
                </button>
              )}
            </div>
          )}
          {phase === 'final' && (
            <button onClick={() => navigate({ name: 'final', week })} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4 }}>
              WEEK RESULT →
            </button>
          )}
          <SiteSettings />
        </div>
          </>
        )}
      </header>

      <div className={cardHand ? 'ctable mx-felt' : undefined} style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? undefined : 'flex-start', gap: isMobile ? 10 : 14, padding: isMobile ? 10 : 14, overflow: isMobile ? 'auto' : 'visible', minHeight: 0 }}>
        {cardHand && <div className="ct-feltlayers" aria-hidden />}
        {!isMobile && <RosterAside side="you" pools={youPools} picks={picks} onPlayer={assignFromRoster} phase={phase} collapsed={!rosterOpen.you} onToggle={() => toggleRoster('you')} bye={byeYou} week={week} />}

        {isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => toggleRoster('you')} className="mono" style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '8px', borderRadius: 4, background: 'var(--surface)', border: `1px solid ${rosterOpen.you ? 'var(--you)' : 'var(--bd)'}`, color: rosterOpen.you ? 'var(--you)' : 'var(--dim)' }}>{rosterOpen.you ? '▾' : '▸'} YOUR ROSTER</button>
              <button onClick={() => toggleRoster('their')} className="mono" style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '8px', borderRadius: 4, background: 'var(--surface)', border: `1px solid ${rosterOpen.their ? 'var(--opp)' : 'var(--bd)'}`, color: rosterOpen.their ? 'var(--opp)' : 'var(--dim)' }}>{rosterOpen.their ? '▾' : '▸'} OPPONENT ROSTER</button>
            </div>
            {rosterOpen.you && <RosterAside side="you" pools={youPools} picks={picks} onPlayer={assignFromRoster} phase={phase} collapsed={false} onToggle={() => toggleRoster('you')} bye={byeYou} week={week} fluid />}
            {rosterOpen.their && <RosterAside side="their" pools={oppPools} picks={oppPicks} phase={phase} sealed={phase === 'setup'} collapsed={false} onToggle={() => toggleRoster('their')} bye={byeTheir} week={week} fluid />}
          </div>
        )}

        <main style={{ flex: 1, overflow: isMobile ? 'visible' : 'auto', minWidth: 0 }}>
          {boardFinal && (() => {
            const won = youTotal > themTotal, tie = Math.abs(youTotal - themTotal) < 0.1;
            const c = tie ? 'var(--dim)' : won ? 'var(--you)' : 'var(--opp)';
            return (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--bd)', borderTop: `3px solid ${c}`, borderRadius: 6, padding: '14px 18px', marginBottom: 14 }}>
                <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', color: c }}>WEEK {week} {tie ? 'TIED' : won ? '— YOU WON' : '— YOU LOST'}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
                  <div style={{ textAlign: 'center' }}>
                    <div className="grotesk" style={{ fontSize: 38, fontWeight: 700, lineHeight: 1, color: 'var(--you)' }}>{youTotal.toFixed(1)}</div>
                    <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--faint)', marginTop: 4 }}>{you.name.toUpperCase()}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>VS</span>
                  <div style={{ textAlign: 'center' }}>
                    <div className="grotesk" style={{ fontSize: 38, fontWeight: 700, lineHeight: 1, color: 'var(--opp)' }}>{themTotal.toFixed(1)}</div>
                    <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--faint)', marginTop: 4 }}>{opp.name.slice(0, 16).toUpperCase()}</div>
                  </div>
                </div>
                <button onClick={() => navigate({ name: 'final', week })} className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', padding: '7px 12px', borderRadius: 4, marginTop: 2 }}>
                  WEEK RESULT →
                </button>
              </div>
            );
          })()}
          <div style={{ marginBottom: 10 }}>
            {/* Top line: week identity on the left, slot tally on the right. */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--on-accent)', background: 'var(--you)', borderRadius: 4, padding: '4px 9px' }}>NFL WEEK {week}</span>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>{weekDateRange(week)}</span>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--faint)' }}>{getActiveLeague().season} SEASON</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flex: 'none' }}>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--faint)' }}>{phase === 'setup' ? 'SLOTS SET' : phase.toUpperCase()}</span>
                {phase === 'setup' && <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{filledCount}/{totalSlots}</span>}
                {phase === 'setup' && metriclessCount > 0 && <span className="mono" title="Each placed player needs a hidden metric to score." style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--warn)', letterSpacing: '0.04em' }}>· {metriclessCount} need a metric</span>}
              </div>
            </div>
            {/* Headline + subhead on the left; power-ups fill the right instead of
                stacking below (shorter, no dead space). Wraps on narrow screens. */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div className="grotesk" style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>{headline}</div>
                <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 2, maxWidth: 520, lineHeight: 1.4 }}>{subhead}</div>
              </div>
              {pendingApply ? (
                <div className="mono" style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', border: '1px solid var(--warn)', borderRadius: 6, padding: '7px 11px' }}>
                  <span><PuIcon id={pendingApply} emoji={powerupById(pendingApply)?.icon} size="1.4em" /> Tap a {powerupById(pendingApply)?.target === 'window' ? 'window' : 'spot'} to apply {powerupById(pendingApply)?.name}</span>
                  <button onClick={() => setPendingApply(null)} className="mono" style={{ background: 'none', border: 'none', color: 'var(--dim)', fontWeight: 700, fontSize: 9, letterSpacing: '0.1em' }}>CANCEL</button>
                </div>
              ) : (
                <div style={{ flex: 'none' }}>
                  <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 4 }}><Emoji e="⚡" size="1.25em" /> POWER-UPS</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setPuView('active')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', color: 'var(--you)', background: 'var(--surface)', border: '1px solid var(--you)', borderRadius: 6, padding: '7px 11px' }}>
                      ◈ ACTIVE{activeEffects.length > 0 ? ` · ${activeEffects.length}` : ''}
                    </button>
                    <button onClick={() => setPuView('apply')} className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 6, padding: '7px 11px' }}>
                      ✦ APPLY{appliable.length > 0 ? ` · ${appliable.length}` : ''}
                    </button>
                    <button onClick={() => setShopOpen(true)} className="mono" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 11px' }}>
                      <Emoji e="🛒" size="1.3em" /> SHOP
                    </button>
                  </div>
                </div>
              )}
            </div>
            {/* Conditional, full-width status lines below the headline row. */}
            {preKickPhase && !liveCtx && (
              <div className="mono" style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', border: '1px solid var(--warn)', borderRadius: 6, padding: '6px 10px' }}>
                ▶ Nothing's kicked yet — press <span style={{ color: 'var(--text)' }}>RUN ALL</span> (or ▶ on a window) to play the week out.
              </div>
            )}
            {/* Live board: a nudge (not a forced modal) to assign best-ball backups. */}
            {liveCtx && phase === 'live' && pendingBackups.length > 0 && (
              <button
                onClick={() => { const s0 = pendingBackups[0]; setBackupMenu({ key: slotKey(s0.win, s0.slotIndex) }); }}
                className="mono" style={{ marginTop: 7, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 10, fontWeight: 700, letterSpacing: '0.03em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 12%, var(--surface))', border: '1px solid var(--you)', borderRadius: 6, padding: '7px 11px', cursor: 'pointer' }}>
                🔁 {pendingBackups.length} unopposed {pendingBackups.length === 1 ? 'player' : 'players'} can sub in — assign {pendingBackups.length === 1 ? 'a backup' : 'backups'} →
              </button>
            )}
            {phase === 'live' && !liveCtx && (
              <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontSize: 10, color: 'var(--dim)' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: clockMode === 'real' ? 'var(--warn)' : clockMode === 'feed' ? 'var(--you)' : 'var(--faint)' }} />
                <span style={{ fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>{clockMode === 'real' ? 'REAL CLOCK' : clockMode === 'feed' ? 'REAL FEED' : 'GAME CLOCK'}</span>
                <span>· {clockMode === 'real' ? 'log order & effects resolve by real time' : clockMode === 'feed' ? 'reveals live; order & effects on game clock' : 'all games lockstep on game time'}</span>
              </div>
            )}
            <TargetPanel aw={aw} oppPicks={oppPicks} preKick={preKickPhase && !liveCtx} onClearSpy={() => clearSpy(week)} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {resolved.windows.map((rw) => (
              <WindowSection
                key={rw.window.id}
                rw={rw}
                week={week}
                phase={winPhaseFor(rw.window.id)}
                realtime={winRt(rw.window.id)}
                clock={effWinClock(rw.window.id)}
                maxClock={winTarget[rw.window.id] ?? GAME_SECONDS}
                wallClock={wallClock}
                realClock={realResolve}
                wallSeconds={(() => {
                  const c = effWinClock(rw.window.id);
                  // Real seconds elapsed at the current feed position: direct in
                  // wall modes; in game mode, scale the game position into the
                  // window's real-time span so the wall clock still advances.
                  return wallClock ? c : ((winMax[rw.window.id] ? c / winMax[rw.window.id] : 0) * (winRealMax[rw.window.id] ?? 0));
                })()}
                playing={liveCtx ? false : !!winPlaying[rw.window.id]}
                onTogglePlay={() => setWinPlay(rw.window.id, !winPlaying[rw.window.id])}
                onReplay={() => replayWin(rw.window.id)}
                canApplyExtra={phase === 'setup' && extraSlotQty > 0}
                extraSlotQty={extraSlotQty}
                onApplyExtra={() => applyExtraSlot(week, rw.window.id)}
                onRemoveExtra={() => removeExtraSlot(week, rw.window.id)}
                onAssignBackup={(key) => setBackupMenu({ key, required: true })}
                picks={picks}
                selSlot={selSlot}
                pickMetricFor={pickMetricFor}
                onClearSlot={clearSlot}
                onOpenPicker={(key, win) => { setPickerSlot({ key, win }); setSelSlot(key); }}
                openPBP={openPBP}
                togglePBP={(k) => setOpenPBP((o) => ({ ...o, [k]: !o[k] }))}
                youPools={youPools}
                inventory={inventory}
                onAssign={assignFromRoster}
                turnoverCoin={turnoverCoin}
                backups={backupAssign}
                slotName={slotName}
                armed={buffs}
                aw={aw}
                applyMode={pendingApply}
                onApplyToSpot={applyToSpot}
                onApplyToWindow={applyToWindow}
                onScout={(win) => setScoutWin(win)}
              />
            ))}
          </div>
          <div style={{ height: 40 }} />
        </main>

        {!isMobile && <RosterAside side="their" pools={oppPools} picks={oppPicks} phase={phase} sealed={phase === 'setup'} collapsed={!rosterOpen.their} onToggle={() => toggleRoster('their')} bye={byeTheir} week={week} />}
      </div>

      {swapTarget && (() => {
        const cur = effYouPicks[swapTarget.key];
        const curPlayer = cur ? getPlayer(cur.playerId) : null;
        if (!curPlayer) return null;
        const slottedIds = new Set(
          Array.from({ length: slotsFor(swapTarget.win, week, extraSlots) }, (_, i) => effYouPicks[slotKey(swapTarget.win, i)]?.playerId).filter(Boolean) as string[],
        );
        const bench = (youPools[swapTarget.win] || []).filter((p) => !slottedIds.has(p.id));
        const atClock = effWinClock(swapTarget.win); // live board: the window's current real position
        // Stamp activation with the REAL time at the feed's current position, so
        // the swap can't retroactively grab a play already final in real time.
        const atRt = realTimeAt(curPlayer, week, atClock, cur!.metricId ?? undefined);
        return (
          <SwapMenu
            player={curPlayer}
            metricId={cur!.metricId}
            atClock={atClock}
            bench={bench}
            metricQty={inventory['metric-swap'] ?? 0}
            playerQty={inventory['player-swap'] ?? 0}
            onMetric={(m) => { if (applyMetricSwap(week, swapTarget.key, atClock, atRt, m)) liveTargeted('metric-swap', { ...keyParts(swapTarget.key), toMetric: m, atClock, atRt }); setSwapTarget(null); }}
            onPlayer={(pid) => { if (applyPlayerSwap(week, swapTarget.key, atClock, atRt, pid)) liveTargeted('player-swap', { ...keyParts(swapTarget.key), toPlayer: pid, atClock, atRt }); setSwapTarget(null); }}
            onClose={() => setSwapTarget(null)}
          />
        );
      })()}

      {backupMenu && (() => {
        const all = resolved.windows.flatMap((w) => w.slots);
        const b = all.find((s) => slotKey(s.win, s.slotIndex) === backupMenu.key);
        if (!b) return null;
        // Only what's legitimately known when you sub: live points so far (not
        // the finals). At kickoff these are all 0 — it's a blind commitment.
        const liveOf = (s: typeof b) => banksAtClock(s.events, effWinClock(s.win)).you;
        const starters = all
          .filter((s) => s.you && s.their)
          .map((s) => ({ key: slotKey(s.win, s.slotIndex), name: s.you!.player.name, score: liveOf(s), win: s.win }));
        return (
          <BackupMenu
            backupName={b.you?.player.name ?? '—'}
            backupScore={liveOf(b)}
            live={phase !== 'final'}
            required={backupMenu.required}
            current={backupAssign[backupMenu.key]}
            starters={starters}
            onPick={(target) => { setBackupTarget(week, backupMenu.key, target); setBackupMenu(null); }}
            onClose={() => setBackupMenu(null)}
          />
        );
      })()}

      {pickerSlot && (() => {
        const { key, win } = pickerSlot;
        const n = slotsFor(win, week, extraSlots);
        const slotted = new Set<string>();
        for (let i = 0; i < n; i++) { const pid = picks[slotKey(win, i)]?.playerId; if (pid) slotted.add(pid); }
        const current = picks[key]?.playerId;
        const avail = (youPools[win] || []).filter((p) => !slotted.has(p.id) || p.id === current);
        return (
          <PlayerPicker
            win={win} week={week} players={avail} currentId={current}
            onPick={(pid) => { assignToSlot(key, pid); setPickerSlot(null); }}
            onRemove={() => { clearSlot(key); setPickerSlot(null); }}
            onClose={() => setPickerSlot(null)}
          />
        );
      })()}

      {byeStealSlot && (
        <PlayerPicker
          win={byeStealSlot.split('#')[0] as WindowId} week={week} players={byeYou}
          title="Field a bye player" subtitle="ON BYE — FIELD ONE FOR A FLAT PROJECTED SCORE"
          onPick={(pid) => {
            if (applyByeSteal(week, byeStealSlot, pid)) {
              const bp = getPlayer(pid);
              liveTargeted('bye-steal', { ...keyParts(byeStealSlot), slug: pid, pts: bp ? Math.round(projectedPoints(bp, week) * 10) / 10 : 0 });
            }
            setByeStealSlot(null); setPendingApply(null);
          }}
          onRemove={() => {}}
          onClose={() => { setByeStealSlot(null); setPendingApply(null); }}
        />
      )}

      {spySlot && (
        <SpyRevealModal
          onPick={(reveal) => {
            const key = spySlot;
            if (liveCtx) {
              // Live: the server reads the REAL sealed pick (RLS hides it from
              // the client) and consumes the Spy itself — see use_spy (0060).
              const { win, slot } = keyParts(key);
              spyRevealRpc(liveCtx.matchupId, win, slot, reveal)
                .then((r) => { if (r.ok) setSpyRevealed(week, key, reveal, (r.reveal as string | null) ?? null); else console.warn('[live] use_spy', r.error); })
                .catch((e) => console.warn('[live] use_spy', e));
            } else setSpy(week, key, reveal);
            setSpySlot(null); setPendingApply(null);
          }}
          onClose={() => { setSpySlot(null); setPendingApply(null); }}
        />
      )}

      {mulliganSlot && (() => {
        const slot = resolved.windows.flatMap((w) => w.slots).find((s) => slotKey(s.win, s.slotIndex) === mulliganSlot);
        const p = slot?.you?.player;
        if (!p) return null;
        const atClock = effWinClock(slot!.win); // live board: the window's current real position
        const atRt = realTimeAt(p, week, atClock, slot!.you!.metricId ?? undefined);
        return (
          <MulliganModal
            player={p} curMetric={slot!.you!.metricId} inventory={inventory}
            onPick={(m) => { if (applyMulligan(week, mulliganSlot, atClock, atRt, m)) liveTargeted('mulligan', { ...keyParts(mulliganSlot), toMetric: m, atClock, atRt }); setMulliganSlot(null); setPendingApply(null); }}
            onClose={() => { setMulliganSlot(null); setPendingApply(null); }}
          />
        );
      })()}

      {scoutWin && <ScoutModal win={scoutWin} week={week} pool={oppPools[scoutWin] ?? []} oppName={opp.name} onClose={() => setScoutWin(null)} />}

      {puView === 'active' && <ActivePowerupsModal effects={activeEffects} onClose={() => setPuView(null)} />}
      {puView === 'apply' && <ApplyPowerupsModal items={appliable} inventory={inventory} onArm={(id) => armBuff(week, id)} onApply={(id) => { setPendingApply(id); setPuView(null); }} onClose={() => setPuView(null)} />}
      {shopOpen && <ShopModal onClose={() => setShopOpen(false)} coinsOverride={liveCtx ? Math.round(coinBal) : undefined} onBuy={liveCtx ? buyFromWallet : undefined} />}
      {/* Card-table hand: the same owned/usable power-ups as the Apply modal,
          fanned at the bottom. Tap a card → tip → ARM fires the buff, APPLY
          enters the existing tap-a-target flow (pendingApply); tapping the
          pending card cancels. Shop purchases land here as new cards. */}
      {cardHand && <CardTableCss />}
      {cardHand && liveCtx && appliable.length > 0 && (
        <>
          <div style={{ height: 104 }} />
          <PowerupHand
            cards={appliable.map(({ p, deadline, action, blocked }) => ({
              id: p.id, name: p.name, icon: p.icon, qty: inventory[p.id] ?? 0,
              action, deadline, blurb: p.blurb, note: blocked ?? (action === 'hint' ? POWERUP_HINT[p.id] : undefined),
            }))}
            pendingId={pendingApply}
            onArm={(id) => armBuff(week, id)}
            onApply={(id) => { setPendingApply(id); setPuView(null); }}
            onCancel={() => setPendingApply(null)}
          />
        </>
      )}
      {showRules && <Rulebook onClose={() => setShowRules(false)} />}
      {fieldsOpen && (
        <FieldBoard week={week} onClose={() => setFieldsOpen(false)} entries={(() => {
          // One entry per slotted player: its team locates the NFL game, its
          // side drives the play tinting, and its clock mirrors the slot rows
          // (per-game real-time position in wall modes, shared window clock in
          // game mode) so the board shows exactly what the board rows show.
          //
          // Tinting is by OUTCOME: an event helps its side when it banked
          // points (delta) or fired an effect. Denial effects (nuke/erase/…)
          // are logged on the VICTIM's side, so their benefit flips to the
          // opponent — whose player's play at that clock is the pid we tint.
          const DENIAL = new Set(['nuke', 'erase', 'stop', 'reset', 'compression', 'cold']);
          const list: FieldBoardEntry[] = [];
          for (const rw of resolved.windows) {
            const c = effWinClock(rw.window.id);
            for (const s of rw.slots) {
              const side = { you: s.you, their: s.their };
              const plays = {
                you: s.you ? realPbpFor(week, s.you.player.id) ?? [] : [],
                their: s.their ? realPbpFor(week, s.their.player.id) ?? [] : [],
              };
              const pids: Record<'you' | 'their', number[]> = { you: [], their: [] };
              for (const ev of s.events) {
                if (ev.drip) continue;
                if (!(ev.delta > 0) && !ev.effect) continue;
                const benefit = ev.effect && DENIAL.has(ev.effect.type) ? (ev.side === 'you' ? 'their' : 'you') : ev.side;
                const pid = plays[benefit].find((rp) => rp.c === ev.clock)?.pid;
                if (pid != null) pids[benefit].push(pid);
              }
              for (const sd of ['you', 'their'] as const) {
                const p = side[sd];
                if (p) list.push({ playerId: p.player.id, team: p.player.team, side: sd, pids: pids[sd], clock: wallClock ? clockAtRealTime(p.player, week, c, p.metricId ?? undefined) : c });
              }
            }
          }
          return list;
        })()} />
      )}

      {earnOpen && <EarningsModal earnings={earnings} weeklyBudget={liveCtx && leagueBudget != null && leagueBudget !== WEEKLY_STIPEND ? leagueBudget : null} onReset={liveCtx ? undefined : () => { resetDripCoin(); setEarnOpen(false); }} onClose={() => setEarnOpen(false)} />}
    </>
  );
}

// ── Drip-coin earning opportunities, by position (risk pays more) ──
function EarningsModal({ earnings, weeklyBudget, onReset, onClose }: { earnings: { stipend: number; unopposed: number; signature: number; turnover: number; total: number }; weeklyBudget?: number | null; onReset?: () => void; onClose: () => void }) {
  const order: Pos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const riskColor = (r: string) => (r === 'HIGH' ? 'var(--fx-nuke)' : r === 'MED' ? 'var(--warn)' : 'var(--dim)');
  // A league with its own weekly budget replaces the flat sim stipend everywhere
  // in this sheet — the tally line + total and the always-on explainer.
  const budgetMode = weeklyBudget != null;
  const stipendLabel = budgetMode ? 'Weekly budget' : 'Weekly stipend';
  const stipendVal = budgetMode ? weeklyBudget! : earnings.stipend;
  const shownTotal = budgetMode ? (earnings.total - earnings.stipend + weeklyBudget!) : earnings.total;
  return (
    <ModalBackdrop onClick={onClose} padTop={50}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 6 }}><CoinIcon size={15} /> Drip Coin — Earning</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>COIN IS EARNED ON EVENTS OF NOTE — RISKIER PLAYS PAY MORE</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 520, overflow: 'auto' }}>
          {/* this week's running tally */}
          <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px' }}>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 6 }}>THIS WEEK</div>
            {([[stipendLabel, stipendVal], ['Unopposed players', earnings.unopposed], ['Events of note', earnings.signature], ['Turnovers', earnings.turnover]] as [string, number][]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--dim)', padding: '2px 0' }}>
                <span>{k}</span><span className="mono" style={{ color: v < 0 ? 'var(--opp)' : 'var(--fx-streak)', fontWeight: 700 }}>{v < 0 ? '' : '+'}{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--text)', padding: '5px 0 0', marginTop: 4, borderTop: '1px solid var(--bd)' }}>
              <span>Total</span><span className="mono" style={{ color: 'var(--fx-mult)' }}>+{shownTotal}</span>
            </div>
          </div>
          {/* always-on */}
          <div className="mono" style={{ fontSize: 9.5, lineHeight: 1.6, color: 'var(--dim)' }}>
            {budgetMode
              ? (weeklyBudget! > 0
                ? <div><CoinIcon size={11} /> <b style={{ color: 'var(--text)' }}>+{weeklyBudget}</b> weekly budget from your commissioner.</div>
                : <div><CoinIcon size={11} /> Coin is earned in-game — your commissioner hasn’t set a weekly budget.</div>)
              : <div><CoinIcon size={11} /> <b style={{ color: 'var(--text)' }}>+{WEEKLY_STIPEND}</b> flat every week, just for playing.</div>}
            <div><CoinIcon size={11} /> <b style={{ color: 'var(--text)' }}>+{UNOPPOSED_COIN}</b> for each unopposed player you field.</div>
            <div style={{ marginTop: 5 }}>Then coin only on <b style={{ color: 'var(--text)' }}>events of note</b> — a nuke / shutdown / wipe, a drip going HOT, or a DST suppress firing. Routine yards, catches and carries don't pay.</div>
            <div style={{ marginTop: 5 }}><CoinIcon size={11} /> <b style={{ color: 'var(--opp)' }}>−10</b> to the opponent for each INT thrown / fumble lost by your players (their giveaways pay you). <b style={{ color: 'var(--text)' }}><PuIcon id="turnover-boost" emoji="🦅" size="1.2em" /> Ball Hawk</b> raises it to 25.</div>
          </div>
          {/* per-position signature rates */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {order.map((pos) => (
              <div key={pos}>
                <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', marginBottom: 3 }}>{pos}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {METRICS[pos].map((m) => {
                    const coin = metricCoin(pos, m.id);
                    const risk = coinRisk(coin);
                    const trigger = m.id === 'suppress' ? 'on suppress' : m.fx === 'nuke' ? 'on nuke' : coin > 0 ? 'on HOT' : '';
                    return (
                      <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: coin > 0 ? 'var(--text)' : 'var(--faint)', padding: '2px 0' }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.lock ? '◈ ' : ''}{m.name}</span>
                        {coin > 0 ? (
                          <>
                            <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: riskColor(risk), border: `1px solid ${riskColor(risk)}`, borderRadius: 2, padding: '0 4px' }}>{risk}</span>
                            <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', width: 58, textAlign: 'right' }}>{trigger}</span>
                            <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--fx-streak)', width: 30, textAlign: 'right' }}>+{coin}</span>
                          </>
                        ) : (
                          <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', width: 96, textAlign: 'right' }}>— no coin —</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {/* Dev/testing reset: top coin back to the grant and wipe owned + applied
              powerups. Demo-only — hidden on the hero board (real wallet). */}
          {onReset && <button onClick={onReset} title="Reset drip coin to the demo grant and clear all owned + applied powerups" className="mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2, padding: '9px 12px', background: 'var(--bg)', border: '1px dashed var(--warn)', borderRadius: 6, color: 'var(--warn)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
            ↻ REFRESH DRIP COIN & CLEAR POWERUPS
          </button>}
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ── Backup assignment menu (manual best-ball) ──
function BackupMenu({ backupName, backupScore, live, required, current, starters, onPick, onClose }: {
  backupName: string; backupScore: number; live: boolean; required?: boolean; current?: string;
  starters: { key: string; name: string; score: number; win: WindowId }[];
  onPick: (target: string | null) => void; onClose: () => void;
}) {
  const scoreTag = live ? 'so far' : 'final';
  return (
    <ModalBackdrop onClick={required ? undefined : onClose} padTop={60}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Backup · {backupName} <span style={{ color: 'var(--warn)' }}>{backupScore.toFixed(1)}</span> <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400 }}>{scoreTag}</span></div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>{required ? 'UNOPPOSED — BANKS 0 UNLESS IT SUBS IN. CHALLENGE A STARTER, OR TAKE THE 0.' : 'CHALLENGE A STARTER — SUBS IN AT FINAL ONLY IF IT OUTSCORES THEM'}</div>
          </div>
          {!required && <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>}
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflow: 'auto' }}>
          <div className="mono" style={{ fontSize: 9, lineHeight: 1.55, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', marginBottom: 4 }}>
            <><b style={{ color: 'var(--warn)' }}>{backupName} banks 0 on its own</b> — unopposed points don't count. Point it at a starter and it'll <b style={{ color: 'var(--text)' }}>replace</b> that starter's score at FINAL, but only if it outscores them. It's a blind bet: numbers below are points {scoreTag}, not finals.</>
          </div>
          <button onClick={() => onPick(null)} className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: !current ? 'var(--sh)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', color: 'var(--text)' }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{`Take the 0 — ${backupName} doesn't sub`}</span>
            {!current && <span style={{ fontSize: 9, color: 'var(--dim)' }}>✓</span>}
          </button>
          {starters.map((s) => {
            const sel = current === s.key;
            return (
              <button key={s.key} onClick={() => onPick(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: sel ? 'var(--sh)' : 'var(--bg)', border: `1px solid ${sel ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '8px 10px', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
                <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', width: 34 }}>{s.win.toUpperCase()}</span>
                <span className="grotesk" style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{s.name}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--dim)' }} title={`points ${scoreTag}`}>{s.score.toFixed(1)}</span>
                {sel && <span style={{ fontSize: 9, color: 'var(--you)' }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ── Real-time swap menu (Metric Swap / Player Swap during live) ──
function SwapMenu({ player, metricId, atClock, bench, metricQty, playerQty, onMetric, onPlayer, onClose }: {
  player: Player; metricId: string | null; atClock: number; bench: Player[];
  metricQty: number; playerQty: number; onMetric: (m: string) => void; onPlayer: (pid: string) => void; onClose: () => void;
}) {
  return (
    <ModalBackdrop onClick={onClose} padTop={60}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>⚡ Power-Up · {player.name}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>LOCKS IN AT {fmtClock(atClock)} (REAL TIME) · PLAYS ALREADY FINAL DON’T COUNT</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 7 }}><PuIcon id="metric-swap" emoji="🔀" size="1.4em" /> METRIC SWAP {metricQty > 0 ? `· ×${metricQty}` : '· NONE OWNED'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: metricQty > 0 ? 1 : 0.4, pointerEvents: metricQty > 0 ? 'auto' : 'none' }}>
              {METRICS[player.pos].filter((m) => m.id !== metricId).map((m) => (
                <button key={m.id} onClick={() => onMetric(m.id)} title={m.ef} className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '7px 9px', color: 'var(--text)', textAlign: 'left' }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{m.name}</span>
                  <span style={{ fontSize: 8, color: 'var(--faint)' }}>{m.tag}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 7 }}><PuIcon id="player-swap" emoji="🔁" size="1.4em" /> PLAYER SWAP {playerQty > 0 ? `· ×${playerQty}` : '· NONE OWNED'}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto', opacity: playerQty > 0 ? 1 : 0.4, pointerEvents: playerQty > 0 ? 'auto' : 'none' }}>
              {bench.length === 0 && <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>No bench players in this window.</span>}
              {bench.map((p) => (
                <button key={p.id} onClick={() => onPlayer(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '7px 9px', color: 'var(--text)', textAlign: 'left' }}>
                  <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={18} />
                  <span className="grotesk" style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>{p.name}</span>
                  <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p.team}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ── Roster aside ──────────────────────────────────────────────────────────
// Exported: the demo landing (DemoBoard) mounts the same rails so its setup
// reads exactly like the hero board.
export function RosterAside({ side, pools, picks, onPlayer, phase, sealed, collapsed, onToggle, bye = [], week, fluid }: {
  side: 'you' | 'their';
  pools: Record<WindowId, Player[]>;
  picks: Record<string, Pick>;
  onPlayer?: (id: string) => void;
  phase: Phase;
  sealed?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  bye?: Player[];
  week: number;
  fluid?: boolean; // mobile: full-width block instead of a fixed side rail
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const assignedIds = new Set(Object.values(picks).map((p) => p.playerId));
  const total = (Object.values(pools) as Player[][]).reduce((n, a) => n + a.length, 0);

  if (collapsed && !fluid) {
    return (
      <aside style={{ width: 26, flex: 'none', position: 'sticky', top: 68, alignSelf: 'flex-start' }} className="hide-narrow">
        <button onClick={onToggle} title={`Show ${side === 'you' ? 'your' : 'the opponent'} roster`} className="mono" style={{ width: 26, minHeight: 160, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '8px 0', background: 'var(--surface)', border: '1px solid var(--bd)', [side === 'you' ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, color: accent, cursor: 'pointer' } as React.CSSProperties}>
          <span style={{ fontSize: 11 }}>{side === 'you' ? '▸' : '◂'}</span>
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.18em', writingMode: 'vertical-rl', textOrientation: 'mixed' }}>{side === 'you' ? 'YOUR' : 'OPPONENT'} ROSTER · {total}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside style={fluid
      ? { width: '100%', flex: 'none', overflow: 'auto', maxHeight: '44vh', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: 10 }
      // Desktop: pin the rail below the sticky header so you can grab a player from
      // anywhere on the board without scrolling back up; the rail scrolls on its own
      // when the roster is long.
      : { width: side === 'you' ? 170 : 196, flex: 'none', position: 'sticky', top: 68, alignSelf: 'flex-start', maxHeight: 'calc(100vh - 80px)', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }} className={fluid ? undefined : 'hide-narrow'}>
      <button onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: accent, fontWeight: 700 }}>{side === 'you' ? '◂' : '▸'} {side === 'you' ? 'YOUR' : 'OPPONENT'} ROSTER</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{total}</span>
      </button>
      {windowsForWeek(week).map((w) => (
        <div key={w.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>{w.label}</span>
            <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{w.time}</span>
          </div>
          {(pools[w.id] ?? []).length === 0 && <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', padding: '0 4px' }}>— none playing —</span>}
          {(pools[w.id] ?? []).map((p) => {
            // Never reveal which players the opponent has selected during setup.
            const assigned = assignedIds.has(p.id) && (side === 'you' || phase !== 'setup');
            const interactive = side === 'you' && phase === 'setup';
            return (
              <button
                key={p.id}
                onClick={interactive ? () => onPlayer?.(p.id) : undefined}
                draggable={interactive}
                onDragStart={(e) => e.dataTransfer.setData('text/plain', p.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)',
                  border: `1px solid ${assigned ? accent : 'var(--bd)'}`, borderRadius: 3, padding: '7px 9px',
                  cursor: interactive ? 'pointer' : 'default', textAlign: 'left', opacity: sealed && side === 'their' ? 0.92 : 1,
                }}
              >
                <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={18} />
                <span className="grotesk" style={{ fontSize: 11.5, fontWeight: 700, color: side === 'you' ? 'var(--text)' : 'var(--dimstrong)', flex: 1, textDecoration: assigned ? 'line-through' : 'none', opacity: assigned ? 0.55 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <InjuryBadge week={week} slug={p.id} />
                <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p.team}</span>
              </button>
            );
          })}
        </div>
      ))}
      {bye.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.5 }}>
          <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--faint)', fontWeight: 700, padding: '0 4px' }}>ON BYE · {bye.length}</span>
          {bye.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 3, padding: '6px 9px' }}>
              <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={16} />
              <span className="grotesk" style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>BYE</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

// Pre-match team buffs (armed bonuses like Trick Play / Pick Six / Hail Mary):
// any 'pre' action powerup that isn't the per-window Extra Slot — and not a
// targeted powerup (those are applied via the TargetPanel, not one-click armed).
const TEAM_BUFFS = POWERUPS.filter((p) => p.timing === 'pre' && p.kind === 'action' && p.id !== 'extra-slot' && !p.target);
const isTeamBuff = (id: string) => TEAM_BUFFS.some((b) => b.id === id);

// Which armed team buffs are relevant to a given spot — drives the on-spot
// highlight so you can see what a powerup applies to in your lineup.
function buffAppliesToSpot(id: string, pos: Pos, metricId: string | null): boolean {
  const drip = metricId === 'combodrip' || metricId === 'recyd' || (pos === 'RB' && metricId === 'rush');
  switch (id) {
    case 'unlock-carries-wipe': return pos === 'WR' || pos === 'TE';
    case 'hail-mary': return pos === 'QB';
    case 'pick-six': return pos === 'DEF';
    case 'trick-play': return pos !== 'QB';
    case 'momentum': case 'floodgates': case 'overtime': return drip;
    case 'garbage-time': case 'counter-nuke': case 'insurance': case 'turnover-boost': return true;
    default: return false;
  }
}

// Armed buffs whose eligibility is purely POSITIONAL (independent of the metric,
// which is chosen later in setup): if removing a player leaves no started spot
// of the needed position, the buff is wasted and should refund. Drip buffs
// (momentum/floodgates/overtime) are metric-dependent and the always-on buffs
// never go to waste, so neither auto-refunds.
const POSITION_REFUND_BUFFS = new Set(['unlock-carries-wipe', 'hail-mary', 'pick-six', 'trick-play']);

// Short "how to use" hints for the non-armable powerups in the inventory card.
const POWERUP_HINT: Record<string, string> = {
  'extra-slot': 'Tap ➕ ADD SLOT on a window header.',
  'metric-swap': 'Tap ✦ APPLY, then a live spot.',
  'player-swap': 'Tap ✦ APPLY, then a live spot.',
  'unlock-return': 'Pick the ◈ metric on a spot.',
  'unlock-combo-drip': 'Pick the ◈ metric on a spot.',
  'unlock-pass-td10': 'Pick the ◈ metric on a spot.',
  'double-or-nothing': 'Stake a spot in the panel below.',
  'spy': 'Reveal a slot after lock-in, before kickoff.',
  'bye-steal': 'Field a bye player in the panel below.',
  'mulligan': 'Re-roll a spot’s metric during LIVE.',
  'emp': 'Fire on a window during LIVE.',
};

// Targeted power-ups applied by tapping a spot/window (vs. whole-field buffs
// that just arm). Each enters apply-mode, then the tap finishes it.
const SPOT_APPLY = new Set(['double-or-nothing', 'bye-steal', 'spy', 'mulligan', 'emp', 'metric-swap', 'player-swap']);

// Shared modal shell for the two power-up cards.
function PuShell({ title, subtitle, accent, onClose, children }: { title: ReactNode; subtitle: string; accent: string; onClose: () => void; children: ReactNode }) {
  return (
    <ModalBackdrop onClick={onClose} padTop={44}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)', borderTop: `3px solid ${accent}`, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{title}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>{subtitle}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: '70vh', overflow: 'auto' }}>{children}</div>
      </div>
    </ModalBackdrop>
  );
}

// ACTIVE: everything currently in effect this week, with a back-out where the
// power-up can still be unwound (before its window locks / kicks off).
function ActivePowerupsModal({ effects, onClose }: {
  effects: { key: string; id?: string; icon: string; name: string; detail: string; onRemove?: () => void }[]; onClose: () => void;
}) {
  return (
    <PuShell title="◈ Active Power-Ups" subtitle="WHAT'S CURRENTLY IN EFFECT — BACK ANY OUT BEFORE IT LOCKS" accent="var(--you)" onClose={onClose}>
      {effects.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', textAlign: 'center', padding: '18px 0', lineHeight: 1.5 }}>— nothing active —<br />arm or apply power-ups from ✦ APPLY</div>}
      {effects.map((e) => (
        <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 5, background: 'color-mix(in srgb, var(--you) 9%, var(--bg))', border: '1px solid color-mix(in srgb, var(--you) 45%, var(--bd))' }}>
          <span style={{ fontSize: 22, flex: 'none', lineHeight: 1.1 }}><PuIcon id={e.id} emoji={e.icon} size={30} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{e.name}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 2 }}>{e.detail}</div>
          </div>
          {e.onRemove ? (
            <button onClick={e.onRemove} className="mono" style={{ flex: 'none', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', borderRadius: 4, padding: '6px 10px', cursor: 'pointer', border: '1px solid var(--opp)', color: 'var(--opp)', background: 'var(--surface)' }}>REMOVE</button>
          ) : (
            <span className="mono" style={{ flex: 'none', fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)', border: '1px solid var(--bd)', borderRadius: 3, padding: '3px 5px' }}>LOCKED</span>
          )}
        </div>
      ))}
    </PuShell>
  );
}

// APPLY: only the power-ups you can still use right now, per the open windows.
function ApplyPowerupsModal({ items, inventory, onArm, onApply, onClose }: {
  items: { p: Powerup; deadline: string; action: 'arm' | 'apply' | 'hint'; blocked?: string }[]; inventory: Record<string, number>;
  onArm: (id: string) => void; onApply: (id: string) => void; onClose: () => void;
}) {
  return (
    <PuShell title="✦ Apply Power-Ups" subtitle="USABLE NOW — APPLY EACH BEFORE ITS WINDOW CLOSES" accent="var(--warn)" onClose={onClose}>
      {items.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', textAlign: 'center', padding: '18px 0', lineHeight: 1.5 }}>— nothing to apply right now —<br />power-ups appear here while their window is open</div>}
      {items.map(({ p, deadline, action, blocked }) => {
        const qty = inventory[p.id] ?? 0;
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 8px', borderRadius: 5, background: 'var(--bg)', border: '1px solid var(--bd)' }}>
            <span style={{ fontSize: 22, flex: 'none', lineHeight: 1.1 }}><PuIcon id={p.id} emoji={p.icon} size={30} /></span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
                {qty > 0 && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--dim)' }}>×{qty}</span>}
                <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', border: '1px solid color-mix(in srgb, var(--warn) 50%, transparent)', borderRadius: 3, padding: '1px 4px' }}>{deadline}</span>
              </div>
              <div style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--dim)', marginTop: 2 }}>{p.blurb}</div>
              {action === 'hint' && POWERUP_HINT[p.id] && <div className="mono" style={{ fontSize: 8.5, color: 'var(--warn)', marginTop: 3 }}>↳ {POWERUP_HINT[p.id]}</div>}
              {action === 'arm' && blocked && <div className="mono" style={{ fontSize: 8.5, color: 'var(--warn)', marginTop: 3 }}>↳ {blocked}</div>}
            </div>
            {action === 'arm' ? (
              <button onClick={() => onArm(p.id)} disabled={qty <= 0 || !!blocked} className="mono" style={{ flex: 'none', alignSelf: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', borderRadius: 4, padding: '6px 10px', cursor: blocked ? 'not-allowed' : 'pointer', border: '1px solid var(--you)', color: 'var(--on-accent)', background: 'var(--you)', opacity: blocked ? 0.45 : 1 }}>ARM</button>
            ) : action === 'apply' ? (
              <button onClick={() => onApply(p.id)} disabled={qty <= 0} className="mono" style={{ flex: 'none', alignSelf: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', borderRadius: 4, padding: '6px 10px', cursor: 'pointer', border: '1px solid var(--warn)', color: 'var(--on-accent)', background: 'var(--warn)' }}>APPLY</button>
            ) : (
              <span className="mono" title="No arming needed — ready to use" style={{ flex: 'none', alignSelf: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', borderRadius: 4, padding: '6px 10px', border: '1px solid var(--ok, #3fb950)', color: 'var(--ok, #3fb950)', background: 'transparent' }}>READY</span>
            )}
          </div>
        );
      })}
    </PuShell>
  );
}


// Spy: after tapping a slate slot, choose what to reveal about the opponent there.
function SpyRevealModal({ onPick, onClose }: { onPick: (r: 'player' | 'metric') => void; onClose: () => void }) {
  return (
    <PuShell title={<><PuIcon id="spy" emoji="👁️" size="1.2em" /> Spy — Reveal</>} subtitle="UNCOVER ONE THING ABOUT THE OPPONENT IN THIS SLOT" accent="var(--warn)" onClose={onClose}>
      {([['player', 'Reveal Player', 'See who the opponent slotted here.'], ['metric', 'Reveal Metric', 'See which metric the opponent chose here.']] as const).map(([r, label, blurb]) => (
        <button key={r} onClick={() => onPick(r)} className="mono" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 3, padding: '10px 12px', borderRadius: 5, border: '1px solid var(--warn)', background: 'var(--bg)', cursor: 'pointer' }}>
          <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{label}</span>
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>{blurb}</span>
        </button>
      ))}
    </PuShell>
  );
}

// Mulligan: after tapping your slot, pick the metric to re-roll into (free swap).
function MulliganModal({ player, curMetric, inventory, onPick, onClose }: {
  player: Player; curMetric: string; inventory: Record<string, number>; onPick: (m: string) => void; onClose: () => void;
}) {
  const options = METRICS[player.pos].filter((m) => !m.lock || (inventory[m.lock] ?? 0) > 0 || m.id === curMetric);
  return (
    <PuShell title={<><PuIcon id="mulligan" emoji="🎲" size="1.2em" /> Mulligan — Re-roll</>} subtitle={`PICK A NEW METRIC FOR ${player.name.toUpperCase()} · COUNTS ONLY PLAYS AFTER NOW (REAL TIME)`} accent="var(--warn)" onClose={onClose}>
      {options.map((m) => {
        const cur = m.id === curMetric;
        return (
          <button key={m.id} onClick={() => onPick(m.id)} disabled={cur} className="mono" style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 11px', borderRadius: 5, border: `1px solid ${cur ? 'var(--bd)' : 'var(--warn)'}`, background: cur ? 'color-mix(in srgb, var(--text) 4%, var(--bg))' : 'var(--bg)', cursor: cur ? 'default' : 'pointer', opacity: cur ? 0.6 : 1 }}>
            <span className="grotesk" style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: 'var(--text)' }}>{m.lock ? '◈ ' : ''}{m.name}</span>
            {cur && <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--faint)' }}>CURRENT</span>}
          </button>
        );
      })}
    </PuShell>
  );
}

// Spy intel: once a Spy reveal lands, surface what it uncovered (the opponent's
// player or chosen metric in that slot). Applying Spy now happens by tapping a
// slot in apply-mode; this panel is just the payoff readout.
function TargetPanel({ aw, oppPicks, preKick, onClearSpy }: {
  aw?: { spy?: { slotKey: string; reveal: 'player' | 'metric'; value?: string | null } };
  oppPicks: Record<string, Pick>; preKick: boolean; onClearSpy: () => void;
}) {
  if (!aw?.spy) return null;
  const sp = aw.spy;
  const op = oppPicks[sp.slotKey];
  const oppPlayer = op ? getPlayer(op.playerId) : null;
  const [win, idx] = sp.slotKey.split('#');
  const label = `${win.toUpperCase()} #${Number(idx) + 1}`;
  // Live pilot: `value` is the SERVER's reveal of the real sealed pick (use_spy,
  // a player slug or metric id) — the local oppPicks are only the AI's guess
  // there, so the server value always wins when present.
  const pretty = (s: string) => s.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
  const metricName = (id: string) => { for (const list of Object.values(METRICS)) { const m = list.find((x) => x.id === id); if (m) return m.name; } return id; };
  const val = sp.value !== undefined
    ? (sp.value === null ? '— no pick sealed yet —' : sp.reveal === 'player' ? pretty(sp.value) : metricName(sp.value))
    : sp.reveal === 'player'
      ? (oppPlayer ? `${oppPlayer.name} (${oppPlayer.pos} · ${oppPlayer.team})` : '— no player —')
      : (oppPlayer ? (metricById(oppPlayer.pos, op!.metricId)?.name ?? '—') : '— no player —');
  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 11px' }}>
      <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)' }}>👁️ SPY INTEL</span>
      <span className="mono" style={{ fontSize: 9.5, color: 'var(--opp)' }}>{label} {sp.reveal}: <b style={{ color: 'var(--text)' }}>{val}</b></span>
      {preKick && <button style={{ background: 'none', border: 'none', color: 'var(--opp)', fontWeight: 700, fontSize: 11, cursor: 'pointer', padding: '0 4px' }} title="Undo (refund)" onClick={onClearSpy}>✕</button>}
    </div>
  );
}

// ── Window section ──────────────────────────────────────────────────────────
function WindowSectionInner(props: {
  rw: ReturnType<typeof buildMatchup>['windows'][number];
  week: number;
  phase: Phase;
  realtime?: 'setup' | 'locked' | 'live' | 'final' | null; // live board: real-clock window state (no manual playback)
  clock: number;
  maxClock: number;
  wallClock: boolean;
  realClock: boolean;
  wallSeconds: number;
  playing: boolean;
  onTogglePlay: () => void;
  onReplay: () => void;
  canApplyExtra: boolean;
  extraSlotQty: number;
  onApplyExtra: () => void;
  onRemoveExtra: () => void;
  armed: Record<string, boolean>;
  onAssignBackup: (key: string) => void;
  picks: Record<string, Pick>;
  selSlot: string | null;
  pickMetricFor: (k: string, m: string) => void;
  onClearSlot: (key: string) => void;
  onOpenPicker: (key: string, win: WindowId) => void;
  openPBP: Record<string, boolean>;
  togglePBP: (k: string) => void;
  youPools: Record<WindowId, Player[]>;
  inventory: Record<string, number>;
  onAssign: (id: string) => void;
  turnoverCoin: number;
  backups: Record<string, string>;
  slotName: Record<string, string>;
  aw?: { doubleOrNothing?: string; byeSteal?: { slotKey: string; playerId: string }; emp?: Partial<Record<WindowId, number>> };
  applyMode: string | null;
  onApplyToSpot: (key: string) => void;
  onApplyToWindow: (win: WindowId) => void;
  onScout: (win: WindowId) => void;
  lockPlayer?: boolean; // demo setup: metric is editable, but the player is fixed
}) {
  const { rw, week, phase, realtime, clock, maxClock, wallClock, realClock, wallSeconds, playing, onTogglePlay, onReplay, canApplyExtra, extraSlotQty, onApplyExtra, onRemoveExtra, onAssignBackup, picks, selSlot, pickMetricFor, onClearSlot, onOpenPicker, openPBP, togglePBP, onAssign, inventory, turnoverCoin, backups, slotName, armed, aw, applyMode, onApplyToSpot, onApplyToWindow, onScout, lockPlayer } = props;
  const w = rw.window;
  // Twin Generals: with the buff armed and ≥2 of your Field General QBs in this
  // window, the top two multipliers stack — link those QB spots so you can see
  // which two are paired.
  const twinLinked = new Set<string>();
  if (armed['fg-stack']) {
    const fgKeys = rw.slots.filter((s) => s.you && s.you.player.pos === 'QB' && s.you.metricId === 'fg').map((s) => slotKey(w.id, s.slotIndex));
    if (fgKeys.length >= 2) fgKeys.forEach((k) => twinLinked.add(k));
  }
  const setN = rw.slots.filter((s) => picks[slotKey(w.id, s.slotIndex)]?.metricId).length;
  const { bigText } = useStore();
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the header's fine print
  // On the live board, "done" tracks the real-clock state (a LIVE window reveals
  // all ingested plays but isn't over); otherwise it's the playback position.
  const done = realtime ? realtime === 'final' : clock >= maxClock;
  const pct = Math.round((Math.min(clock, maxClock) / maxClock) * 100);
  // Live apply-mode: EMP targets the whole live window; Spy/Mulligan target a
  // single spot. Highlight what's eligible and dim the rest.
  // Live-timing power-ups only apply to a genuinely LIVE window. On the live board
  // a LOCKED window renders in the same 'live' phase (sealed, pre-kick), so gate
  // on the real-clock state so a swap/mulligan/EMP can't land on a locked window.
  // Sim/demo has no `realtime`, so this is a no-op there.
  const liveNow = !realtime || realtime === 'live';
  const empEligible = applyMode === 'emp' && liveNow && phase === 'live' && clock > 0 && !done && aw?.emp?.[w.id] == null;
  const spotEligible = (s: typeof rw.slots[number]) => {
    if (applyMode === 'spy') return !!s.their;                          // reveal the opponent here (locked period)
    if (applyMode === 'mulligan') return liveNow && !!s.you && !done;   // re-roll your metric
    if (applyMode === 'metric-swap' || applyMode === 'player-swap') return liveNow && !!s.you && !done; // swap this live spot
    return false;
  };
  const spotApplyMode = applyMode === 'spy' || applyMode === 'mulligan' || applyMode === 'metric-swap' || applyMode === 'player-swap';
  const [slateOpen, setSlateOpen] = useState(false);
  // The real NFL games feeding this window: map each window player's team to its
  // actual away@home matchup that week, and list the players involved.
  interface SlateGame { away: string; home: string; kickoff?: number; you: string[]; their: string[] }
  const slate: SlateGame[] = (() => {
    // Seed with every real NFL game in this window — so the chip shows even
    // before anyone is assigned (e.g. a lone TNF game).
    const games = new Map<string, SlateGame>();
    for (const g of gamesInWindow(week, w.id)) {
      games.set(`${g.away}@${g.home}`, { away: g.away, home: g.home, kickoff: g.kickoff, you: [], their: [] });
    }
    const add = (team: string | undefined, name: string, side: 'you' | 'their') => {
      const g = nflGameForTeam(week, team);
      if (!g || g.win !== w.id) return;
      const e = games.get(`${g.away}@${g.home}`);
      if (e) e[side].push(`${name} · ${team}`);
    };
    for (const s of rw.slots) {
      if (s.you?.player.team) add(s.you.player.team, s.you.player.name, 'you');
      // Don't reveal the opponent's lineup during setup.
      if (phase !== 'setup' && s.their?.player.team) add(s.their.player.team, s.their.player.name, 'their');
    }
    return [...games.values()];
  })();
  const slateTeams = [...new Set(slate.flatMap((g) => [g.away, g.home]))];

  // This window's own real-clock timeline (live board): locks 1h before its
  // kickoff, goes live at kickoff. Shown per-window so each window carries its
  // own Setup → Locked → Live → Final states + times, not just the board header.
  const winKickSod = windowKickoffSod(week, w.id);
  const lockLabel = fmtTimeOfDay(winKickSod - (testTimelineOn() ? TEST_LOCK_LEAD_MS / 1000 : 3600));
  const kickLabel = fmtTimeOfDay(winKickSod);
  // The state chip for this window's real-clock state.
  const stateChip = !realtime ? null : realtime === 'setup' ? (
    <span className="mono" title="Open — edit this window until it locks 1h before kickoff." style={{ fontSize: fs(9), fontWeight: 700, letterSpacing: '0.12em', color: 'var(--you)', border: '1px solid color-mix(in srgb, var(--you) 45%, var(--bd))', borderRadius: 4, padding: '3px 8px' }}>SETUP</span>
  ) : realtime === 'locked' ? (
    <span className="mono" title="Lineups are locked for this window — kickoff is within the hour." style={{ fontSize: fs(9), fontWeight: 700, letterSpacing: '0.12em', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '3px 8px' }}><Emoji e="🔒" size="1.25em" /> LOCKED</span>
  ) : realtime === 'final' ? (
    <span className="mono" style={{ fontSize: fs(9), fontWeight: 700, letterSpacing: '0.12em', color: 'var(--you)', border: '1px solid color-mix(in srgb, var(--you) 45%, var(--bd))', borderRadius: 4, padding: '3px 8px' }}>FINAL</span>
  ) : (
    <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: fs(9), fontWeight: 700, letterSpacing: '0.12em', color: '#FF4F62', border: '1px solid #FF4F62', borderRadius: 4, padding: '3px 8px' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#FF4F62', animation: 'lpulse 1.2s ease infinite' }} /> LIVE
    </span>
  );
  // The time hint that pairs with the state: what's next on this window's clock.
  const timeHint = !realtime ? null
    : realtime === 'setup' ? `🔒 locks ${lockLabel} ET`
    : realtime === 'locked' ? `▶ kicks ${kickLabel} ET`
    : realtime === 'live' ? `kicked ${kickLabel} ET`
    : null;

  return (
    <div className="mx-winsec">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bd)', paddingBottom: 7, marginBottom: 9, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)' }}>{w.label}</span>
          <span style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{w.sub}</span>
          <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--dimstrong)' }}>{windowDateLabel(week, w.id)}</span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{windowTimeLabel(week, w.id)}</span>
          {slate.length > 0 && (
            <button onClick={() => setSlateOpen((o) => !o)} title="NFL game slate for this window" className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: slateOpen ? 'var(--text)' : 'var(--dim)', background: 'var(--surface)', border: `1px solid ${slateOpen ? 'var(--bdh)' : 'var(--bd)'}`, borderRadius: 11, padding: '3px 8px' }}>
              <span style={{ display: 'flex', gap: 1 }}>{slateTeams.slice(0, 8).map((t) => <Img key={t} src={teamLogo(t)} size={13} radius={2} fallback={<span />} />)}</span>
              SLATE · {slate.length} {slate.length === 1 ? 'GAME' : 'GAMES'} {slateOpen ? '▴' : '▾'}
            </button>
          )}
        </div>

        {phase === 'setup' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* Live board: this window's own state + lock time, right in its header. */}
            {stateChip}
            {timeHint && <span className="mono" style={{ fontSize: fs(9), fontWeight: 700, color: 'var(--warn)', letterSpacing: '0.04em' }}>{timeHint}</span>}
            {canApplyExtra && (
              <button
                onClick={onApplyExtra}
                title="Add a slot to this window — for you AND your opponent. Locks once any window starts."
                className="mono"
                style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', background: 'var(--surface)', border: '1px dashed var(--warn)', borderRadius: 4, padding: '4px 8px' }}
              >
                ➕ ADD SLOT (◈ ×{extraSlotQty})
              </button>
            )}
            {rw.slots.length > w.slots && (
              <button onClick={onRemoveExtra} title="Remove the added slot (refund)" className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--opp)', background: 'var(--surface)', border: '1px solid var(--opp)', borderRadius: 4, padding: '4px 8px' }}>
                ➖ REMOVE SLOT
              </button>
            )}
            <span className="mono" style={{ fontSize: fs(9), fontWeight: 700, letterSpacing: '0.12em', color: 'var(--dim)' }}>{setN}/{rw.slots.length} SET</span>
          </div>
        ) : realtime ? (
          // Live board: the window's state comes from the real clock — no manual
          // playback. Show its state chip + the next milestone on its own clock.
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {timeHint && <span className="mono" style={{ fontSize: fs(9), color: realtime === 'live' ? 'var(--faint)' : 'var(--warn)', fontWeight: 700, letterSpacing: '0.04em' }}>{timeHint}</span>}
            {stateChip}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* per-window clock */}
            <div style={{ width: 70, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: done ? 'var(--you)' : '#FF4F62', transition: 'width .3s linear' }} />
            </div>
            <span className="mono" title="Wall-clock time of day (ET) at the current feed position" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{fmtTimeOfDay(windowKickoffSod(week, w.id) + wallSeconds)}</span>
            <span className="mono" style={{ fontSize: 8, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.08em' }}>ET</span>
            {phase === 'live' && (
              done ? (
                <button onClick={onReplay} className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 8px' }}>↺ REPLAY</button>
              ) : (
                <button onClick={onTogglePlay} title={playing ? 'Pause this window' : 'Play this window'} className="mono" style={{ fontSize: 11, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 9px' }}>{playing ? '❚❚' : '▶'}</button>
              )
            )}
            <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: phase === 'final' || done ? 'var(--you)' : '#FF4F62' }}>
              {phase === 'final' || done ? 'FINAL' : playing ? '● LIVE' : 'PAUSED'}
            </span>
            {empEligible && (
              <button onClick={() => onApplyToWindow(w.id)} className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, padding: '4px 9px', boxShadow: '0 0 12px color-mix(in srgb, var(--warn) 55%, transparent)', animation: 'bpulse 1.5s ease infinite' }}>💥 TAP TO EMP</button>
            )}
          </div>
        )}
      </div>

      {slateOpen && (
        <ModalBackdrop onClick={() => setSlateOpen(false)} padTop={60}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
              <div>
                <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{w.label} · Game Slate</div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>{slate.length} {slate.length === 1 ? 'GAME' : 'GAMES'} · {windowDateLabel(week, w.id).toUpperCase()} · {windowTimeLabel(week, w.id).toUpperCase()}</div>
              </div>
              <button onClick={() => setSlateOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 7, maxHeight: 460, overflow: 'auto' }}>
              {slate.map((g) => {
                const teamLine = (abbr: string) => (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flex: 1, minWidth: 0 }}>
                    <Img src={teamLogo(abbr)} size={22} radius={4} fallback={<span className="mono" style={{ fontSize: 9 }}>{abbr}</span>} />
                    <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{abbr}</span>
                  </div>
                );
                return (
                  <div key={`${g.away}@${g.home}`} style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {teamLine(g.away)}
                      <span className="mono" style={{ fontSize: 10, fontWeight: 700, color: 'var(--faint)', flex: 'none' }}>@</span>
                      {teamLine(g.home)}
                      <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--dim)', flex: 'none', marginLeft: 6 }}>{g.kickoff ? kickoffLabel(g.kickoff) : windowTimeLabel(week, w.id)}</span>
                    </div>
                    {(g.you.length > 0 || g.their.length > 0) && (
                      <div style={{ fontSize: 9.5, lineHeight: 1.5, marginTop: 6, paddingTop: 6, borderTop: '1px solid color-mix(in srgb, var(--bd) 60%, transparent)' }}>
                        {g.you.map((p) => <span key={p} style={{ color: 'var(--you)', marginRight: 8 }}>● {p}</span>)}
                        {g.their.map((p) => <span key={p} style={{ color: 'var(--opp)', marginRight: 8 }}>● {p}</span>)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </ModalBackdrop>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rw.slots.map((s) => {
          const key = slotKey(w.id, s.slotIndex);
          if (phase === 'setup') {
            return (
              <SetupRow
                key={key} slotKeyStr={key} winId={w.id} week={week} pick={picks[key]} selected={selSlot === key} inventory={inventory} armed={armed} twinLink={twinLinked.has(key)}
                appliedPu={[...(aw?.doubleOrNothing === key ? ['double-or-nothing'] : []), ...(aw?.byeSteal?.slotKey === key ? ['bye-steal'] : [])]}
                applyMode={applyMode} onApplyToSpot={() => onApplyToSpot(key)}
                onOpenPicker={() => onOpenPicker(key, w.id)} onPickMetric={(m) => pickMetricFor(key, m)}
                onClearSlot={() => onClearSlot(key)}
                onDropPlayer={(id) => onAssign(id)} onScout={() => onScout(w.id)} lockPlayer={lockPlayer}
              />
            );
          }
          // Per-side clocks: in wall-clock mode `clock` is the window's real
          // position, mapped back to each player's own game clock; in game mode
          // both sides share it.
          const youClock = wallClock && s.you ? clockAtRealTime(s.you.player, week, clock, s.you.metricId ?? undefined) : clock;
          const theirClock = wallClock && s.their ? clockAtRealTime(s.their.player, week, clock, s.their.metricId ?? undefined) : clock;
          const row = <ScoreRow key={key} slot={s} week={week} youClock={youClock} theirClock={theirClock} open={!!openPBP[key]} onToggle={() => togglePBP(key)} phase={phase} done={done} onAssignBackup={() => onAssignBackup(key)} turnoverCoin={turnoverCoin} backups={backups} slotName={slotName} realClock={realClock} kickoffSec={windowKickoffSod(week, w.id)} youTwin={twinLinked.has(key)} />;
          if (!spotApplyMode) return row;
          const elig = spotEligible(s);
          return (
            <div key={key} style={{ position: 'relative', opacity: elig ? 1 : 0.4, borderRadius: 4 }}>
              {row}
              {elig && (
                <div onClick={() => onApplyToSpot(key)} style={{ position: 'absolute', inset: 0, zIndex: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--warn) 14%, transparent)', border: '1px dashed var(--warn)', borderRadius: 4, cursor: 'pointer' }}>
                  <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 4, padding: '5px 9px' }}>{powerupById(applyMode!)?.icon} TAP TO {applyMode === 'spy' ? 'SPY' : applyMode === 'mulligan' ? 'MULLIGAN' : 'SWAP'}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The live board re-renders Matchup every ~700ms tick (winClocks advances), which
// would re-render all five WindowSections even though only the playing window's
// clock changed. Skip the re-render when every DATA prop is unchanged: idle and
// finished windows have identical data tick-to-tick, so only the advancing window
// (whose `clock`/`wallSeconds` change) re-renders. Function props are treated as
// always-equal (Matchup rebuilds these handler closures every render, but that's
// irrelevant here) — SAFE because every piece of state a handler reads (picks,
// phase, playing, applyMode, inventory, backups, armed, aw, …) is itself a compared
// prop, so any change that would alter a handler's behavior also changes a data
// prop and forces the re-render. A skipped window therefore never fires a handler
// against stale state. (Verified: with one window live, toggling a second — idle,
// memo-skipped — window still starts it, and scores resolve byte-identically.)
const WindowSection = memo(WindowSectionInner, (a, b) => {
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const av = (a as Record<string, unknown>)[k], bv = (b as Record<string, unknown>)[k];
    if (typeof av === 'function' && typeof bv === 'function') continue; // handler identity is irrelevant (see note above)
    if (!Object.is(av, bv)) return false;
  }
  return true;
});

// ── Setup row ──
// Marks the two Field General QBs that are paired under the Twin Generals power-up
// (their multipliers stack — the top two multiply together).
function TwinChip() {
  return (
    <span className="mono" title="Twin Generals: this Field General is paired with your other Field General QB in this window — the top two multipliers stack (multiply)" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--fx-mult)', border: '1px solid color-mix(in srgb, var(--fx-mult) 55%, transparent)', background: 'color-mix(in srgb, var(--fx-mult) 14%, transparent)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>🎖️ TWIN ×2</span>
  );
}

export function SetupRow(props: {
  slotKeyStr: string; winId: WindowId; week: number; pick?: Pick; selected: boolean; inventory: Record<string, number>; armed: Record<string, boolean>; twinLink?: boolean;
  appliedPu: string[];
  applyMode: string | null; onApplyToSpot: () => void;
  onOpenPicker: () => void; onPickMetric: (m: string) => void; onClearSlot: () => void; onDropPlayer: (id: string) => void; onScout: () => void;
  lockPlayer?: boolean;
  // Player lookup — defaults to the baked demo registry; the live pilot injects
  // its own (so the same card renders against live roster data). `hideScout`
  // drops the SCOUT affordance where there's no opponent pool to scout (live pre-lock).
  resolve?: (id: string) => Player | undefined;
  hideScout?: boolean;
}) {
  const { winId, week, pick, selected, inventory, armed, twinLink, appliedPu, applyMode, onApplyToSpot, onOpenPicker, onPickMetric, onClearSlot, onDropPlayer, onScout, lockPlayer, resolve, hideScout } = props;
  const isMobile = useIsMobile();
  const { bigText } = useStore();
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the card's fine print
  const gridCols = '1fr 1fr'; // no center gutter — your spot vs the sealed opponent
  const rowGap = isMobile ? 5 : 8;
  const player = pick ? ((resolve ?? getPlayer)(pick.playerId) ?? null) : null;
  const metric = player && pick?.metricId ? metricById(player.pos, pick.metricId) : null;
  // Power-ups acting on THIS spot: armed team buffs that apply here, plus any
  // spot-specific applied powerup (Double or Nothing / Bye Steal).
  const spotBuffs = [
    ...(player ? Object.keys(armed).filter((id) => armed[id] && buffAppliesToSpot(id, player.pos, pick?.metricId ?? null)) : []),
    ...appliedPu,
  ];
  const buffChips = spotBuffs.map((id) => { const pu = powerupById(id); return (
    <span key={id} title={pu?.blurb} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: fs(8), fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--you) 40%, transparent)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>{pu?.icon} {pu?.name}</span>
  ); });
  // Apply mode: a targeted powerup is awaiting a spot. Double or Nothing → a
  // filled spot; Bye Steal → an empty spot.
  const fillEligible = applyMode === 'double-or-nothing' && !!player;
  const emptyEligible = applyMode === 'bye-steal' && !player;
  const applyHi = fillEligible;
  const applyDim = !!applyMode && !fillEligible && !emptyEligible;
  const cardTap = lockPlayer ? () => {} : applyMode ? (fillEligible ? onApplyToSpot : () => {}) : onOpenPicker;
  const applyPu = applyMode ? powerupById(applyMode) : null;
  // "Change metric" re-opens the picker for an already-set spot without dropping
  // the player. Reset whenever the slot's player changes (incl. top-down shifts).
  const [editing, setEditing] = useState(false);
  const [infoMetric, setInfoMetric] = useState<Metric | null>(null);
  useEffect(() => { setEditing(false); }, [pick?.playerId]);
  const showPicker = !!player && (!pick?.metricId || editing);
  const link: React.CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: fs(8.5), fontWeight: 700, letterSpacing: '0.1em' };

  return (
    <>
    <div style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'stretch', gap: rowGap }}>
      {player ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          className={`mx-spot${applyHi || applyDim || selected ? ' mx-state' : ''}`}
          style={{ position: 'relative', minWidth: 0, background: applyHi ? 'color-mix(in srgb, var(--warn) 12%, var(--surface))' : selected ? 'var(--sh)' : 'var(--surface)', border: `1px ${applyHi ? 'dashed var(--warn)' : `solid ${selected ? 'var(--you)' : 'var(--bd)'}`}`, borderLeft: applyHi ? '3px dashed var(--warn)' : '3px solid var(--you)', borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7, opacity: applyDim ? 0.45 : 1 }}
        >
          {applyHi && (
            <div onClick={onApplyToSpot} style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--warn) 14%, transparent)', borderRadius: 4, cursor: 'pointer' }}>
              <span className="mono" style={{ fontSize: fs(9.5), fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 4, padding: '5px 9px' }}>{applyPu?.icon} TAP TO APPLY</span>
            </div>
          )}
          {/* Remove the player from this spot — compact red ✕ pinned top-right,
              clear of the metric list below. */}
          {!applyMode && !lockPlayer && (
            <button
              onClick={(e) => { e.stopPropagation(); onClearSlot(); }}
              title="Remove player from this spot"
              className="mono"
              style={{ position: 'absolute', top: 6, right: 6, zIndex: 3, width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, lineHeight: 1, color: 'var(--opp)', background: 'var(--surface)', border: '1px solid var(--opp)', borderRadius: 4, cursor: 'pointer' }}
            >✕</button>
          )}
          {/* identity row — tap to swap the player; on desktop the spot's
              power-ups sit to the right of the headshot (below it on mobile). */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, paddingRight: 22 }}>
            <div onClick={cardTap} style={{ cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'center', minWidth: 0, flex: 1 }}>
              <PlayerImg playerId={player.id} team={player.team} pos={player.pos} size={isMobile ? 40 : 48} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
                  <InjuryBadge week={week} slug={player.id} />
                </div>
                <span className="mono" style={{ fontSize: fs(8.5), color: 'var(--faint)' }}>{player.pos} · {player.team}</span>
              </div>
            </div>
            {!isMobile && spotBuffs.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4, flexWrap: 'wrap', flex: 'none', maxWidth: '48%' }}>
                {buffChips}
              </div>
            )}
          </div>

          {/* mobile: armed power-ups acting on this spot, below the headshot */}
          {isMobile && spotBuffs.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              {buffChips}
            </div>
          )}

          {/* sealed: the chosen metric (kept hidden from the opponent) */}
          {!showPicker && (
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--you)' }}>{metric?.name}</span>
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: fs(7), letterSpacing: '0.12em', color: 'var(--faint)' }}>
                <span style={{ width: 5, height: 5, background: 'var(--you)', borderRadius: '50%', display: 'inline-block', animation: 'bpulse 2s ease infinite' }} /> HIDDEN
              </span>
              {twinLink && <TwinChip />}
            </div>
          )}

          {/* metric picker — full card width, stacks cleanly */}
          {showPicker && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {!pick?.metricId && !editing && (
                <div className="mono" style={{ fontSize: fs(8), fontWeight: 700, letterSpacing: '0.14em', color: 'var(--warn)' }}>② PICK A METRIC ↓</div>
              )}
              {editing && (
                <button onClick={() => setEditing(false)} className="mono" style={{ width: '100%', textAlign: 'center', background: 'none', border: '1px dashed var(--bd)', borderRadius: 3, padding: '3px', fontSize: fs(8), letterSpacing: '0.1em', color: 'var(--faint)' }}>✕ KEEP {metric?.name?.toUpperCase()}</button>
              )}
              {METRICS[player.pos].filter((m) => !m.lock || (inventory[m.lock] ?? 0) > 0 || m.id === pick?.metricId).map((m) => {
                const cur = m.id === pick?.metricId;
                return (
                  <button key={m.id} onClick={() => { onPickMetric(m.id); setEditing(false); }} style={{ width: '100%', minHeight: 30, textAlign: 'left', background: cur ? 'color-mix(in srgb, var(--you) 14%, var(--bg))' : m.lock ? 'color-mix(in srgb, var(--warn) 12%, var(--bg))' : 'var(--bg)', border: `1px solid ${cur ? 'var(--you)' : m.lock ? 'var(--warn)' : 'var(--bd)'}`, borderRadius: 3, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.lock ? '◈ ' : ''}{m.name}</span>
                    {/* mobile: icon-only so the longest names ("Receiving Yards") never ellipsize */}
                    <span role="button" title="What does this metric do?" onClick={(e) => { e.stopPropagation(); setInfoMetric(m); }} className="mono" style={{ flex: 'none', fontSize: isMobile ? 12 : 10, fontWeight: 700, color: 'var(--faint)', padding: '0 2px', cursor: 'help' }}>{isMobile ? 'ⓘ' : 'ⓘ info'}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* change controls — pinned to the bottom of the spot */}
          {!showPicker && (
            <div style={{ display: 'flex', gap: 14, marginTop: 'auto', paddingTop: 4 }}>
              <button onClick={() => setEditing(true)} className="mono" style={{ ...link, color: 'var(--warn)' }}>↻ METRIC</button>
              {!lockPlayer && <button onClick={onOpenPicker} className="mono" style={{ ...link, color: 'var(--opp)' }}>⇄ PLAYER</button>}
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={applyMode ? (emptyEligible ? onApplyToSpot : undefined) : onOpenPicker}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          className={`mx-empty${emptyEligible || applyDim || selected ? ' mx-state' : ''}`}
          style={{ minWidth: 0, minHeight: 78, background: emptyEligible ? 'color-mix(in srgb, var(--warn) 12%, transparent)' : selected ? 'var(--surface)' : 'transparent', border: `1px dashed ${emptyEligible ? 'var(--warn)' : selected ? 'var(--you)' : 'var(--bdh)'}`, borderLeft: `3px dashed ${emptyEligible ? 'var(--warn)' : selected ? 'var(--you)' : 'var(--bdh)'}`, borderRadius: 4, padding: '16px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', opacity: applyDim ? 0.4 : 1 }}
        >
          <span className="grotesk" style={{ fontSize: 20, color: emptyEligible ? 'var(--warn)' : 'var(--faint)' }}>{emptyEligible ? <PuIcon id={applyPu?.id} emoji={applyPu?.icon} size={22} /> : '+'}</span>
          <span className="mono" style={{ fontSize: bigText ? 10.5 : 10, color: emptyEligible ? 'var(--warn)' : 'var(--faint)', letterSpacing: '0.08em', fontWeight: emptyEligible ? 700 : 400, whiteSpace: 'nowrap' }}>{emptyEligible ? 'TAP TO FIELD BYE' : 'TAP TO PICK PLAYER'}</span>
        </div>
      )}
      <div className="mx-sealed" onClick={hideScout ? undefined : onScout} title={hideScout ? 'Your opponent’s lineup is sealed until kickoff' : "Scout the opponent's possible players for this window"} style={{ minWidth: 0, minHeight: 78, background: 'color-mix(in srgb, var(--text) 3%, var(--surface))', border: '1px dashed var(--bdh)', borderRight: '3px dashed var(--bdh)', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: hideScout ? 'default' : 'pointer' }}>
        <span className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--dim)' }}>◆</span>
        <span className="mono" style={{ fontSize: fs(9), letterSpacing: '0.16em', color: 'var(--faint)', fontWeight: 700 }}>SEALED · {winId.toUpperCase()}</span>
        {!hideScout && <span className="mono" style={{ fontSize: fs(7.5), letterSpacing: '0.12em', color: 'var(--opp)', fontWeight: 700 }}><GameIcon name={UI_ART.scout} emoji="🔍" size="1.6em" /> SCOUT</span>}
      </div>
    </div>
    {infoMetric && <MetricInfo metric={infoMetric} onClose={() => setInfoMetric(null)} />}
    </>
  );
}

// Definition + mechanics card for a metric (the "?" on each pick).
function MetricInfo({ metric, onClose }: { metric: Metric; onClose: () => void }) {
  const c = FX_COLOR[metric.fx] ?? 'var(--you)';
  return (
    <ModalBackdrop onClick={onClose} zIndex={75} padTop={50}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div style={{ minWidth: 0 }}>
            <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{metric.lock ? '◈ ' : ''}{metric.name}</div>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: c, marginTop: 4 }}>{metric.tag}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 4 }}>SCORING</div>
            <div className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{metric.sc}</div>
          </div>
          <div>
            <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 4 }}>MECHANICS</div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--dim)' }}>{metric.ef}</div>
          </div>
          {metric.lock && <div className="mono" style={{ fontSize: 9.5, color: 'var(--warn)', fontWeight: 700 }}>◈ Unlock metric — requires the matching power-up.</div>}
        </div>
      </div>
    </ModalBackdrop>
  );
}

// ── Player picker (tap a spot in setup) — choose from this window's roster ──
export function PlayerPicker({ win, week, players, currentId, title = 'Pick a player', subtitle = 'YOUR PLAYERS WHOSE GAME FALLS IN THIS WINDOW', onPick, onRemove, onClose, gated, onGated }: {
  win: WindowId; week: number; players: Player[]; currentId?: string; title?: string; subtitle?: string;
  onPick: (id: string) => void; onRemove: () => void; onClose: () => void;
  gated?: (p: Player) => boolean; onGated?: (p: Player) => void; // opt-in premium lock (default: none)
}) {
  const label = windowsForWeek(week).find((w) => w.id === win)?.label ?? win.toUpperCase();
  const { bigText } = useStore();
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the list's fine print
  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{label} · {title}</div>
            <div className="mono" style={{ fontSize: fs(9), color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>{subtitle}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 440, overflow: 'auto' }}>
          {players.length === 0 && <div className="mono" style={{ fontSize: fs(10), color: 'var(--faint)', textAlign: 'center', padding: '16px 0' }}>— no eligible players in this window —</div>}
          {players.map((p) => {
            const sel = p.id === currentId;
            const isGated = !sel && !!gated?.(p); // premium position → locked
            return (
              <button key={p.id} onClick={() => (isGated ? onGated?.(p) : onPick(p.id))} style={{ display: 'flex', alignItems: 'center', gap: 10, background: sel ? 'var(--sh)' : 'var(--bg)', border: `1px solid ${sel ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '8px 10px', color: 'var(--text)', textAlign: 'left', cursor: 'pointer', opacity: isGated ? 0.6 : 1 }}>
                <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <InjuryBadge week={week} slug={p.id} />
                  </div>
                  <span className="mono" style={{ fontSize: fs(8.5), color: 'var(--faint)' }}>{p.pos} · {p.team}</span>
                </div>
                {sel ? <span className="mono" style={{ fontSize: fs(8), color: 'var(--you)', flex: 'none' }}>CURRENT ✓</span>
                  : isGated ? <span title="Premium position — unlock premium" style={{ fontSize: 14, flex: 'none' }}>🔒</span> : null}
              </button>
            );
          })}
        </div>
        {currentId && (
          <div style={{ padding: '0 12px 12px' }}>
            <button onClick={onRemove} className="mono" style={{ width: '100%', background: 'var(--bg)', border: '1px dashed var(--opp)', borderRadius: 4, padding: '8px', color: 'var(--opp)', fontSize: fs(9), fontWeight: 700, letterSpacing: '0.08em' }}>✕ REMOVE FROM SPOT</button>
          </div>
        )}
      </div>
    </ModalBackdrop>
  );
}

// ── Scout (tap a sealed opponent spot) — the candidate pool only ──
// Lists every opponent player whose game falls in this window: who they COULD
// field here. The actual pick stays sealed — the full pool is shown (no
// removal of slotted players), so nothing leaks by commission or omission.
export function ScoutModal({ win, week, pool, oppName, onClose }: {
  win: WindowId; week: number; pool: Player[]; oppName: string; onClose: () => void;
}) {
  const label = windowsForWeek(week).find((w) => w.id === win)?.label ?? win.toUpperCase();
  const posOrder: Pos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const sorted = [...pool].sort((a, b) => (posOrder.indexOf(a.pos) - posOrder.indexOf(b.pos)) || a.name.localeCompare(b.name));
  const { bigText } = useStore();
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the list's fine print
  return (
    <ModalBackdrop onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, borderTop: '3px solid var(--opp)', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}><GameIcon name={UI_ART.scout} emoji="🔍" size="1.2em" /> Scout · {label}</div>
            <div className="mono" style={{ fontSize: fs(9), color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>WHO {oppName.toUpperCase()} COULD FIELD HERE — PICK STAYS SEALED</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 440, overflow: 'auto' }}>
          {sorted.length === 0 && <div className="mono" style={{ fontSize: fs(10), color: 'var(--faint)', textAlign: 'center', padding: '16px 0' }}>— no opponent players in this window —</div>}
          {sorted.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px' }}>
              <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{p.name}</span>
                  <InjuryBadge week={week} slug={p.id} />
                </div>
                <span className="mono" style={{ fontSize: fs(8.5), color: 'var(--faint)' }}>{p.pos} · {p.team}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <div className="mono" style={{ fontSize: fs(8.5), color: 'var(--faint)', textAlign: 'center', lineHeight: 1.5 }}>
            ◆ {sorted.length} candidate{sorted.length === 1 ? '' : 's'} · any could be in any of {oppName}'s {label} spots
          </div>
        </div>
      </div>
    </ModalBackdrop>
  );
}

// Metrics that bank no direct points (their value is purely an effect) — so an
// unopposed player on one of these can never sub in as a best-ball backup.
const ZERO_BANK_METRICS = new Set(['QB:fg', 'K:neg', 'DEF:suppress']);

// At FINAL, the scoring changes a side's armed powerups made to this spot —
// each rendered as a chip. `vsOpp` entries (carry-wipe / counter-nuke) struck
// points off the opponent; the rest added to your own bank. Double or Nothing
// is a slot-level stake, surfaced here too.
function BuffFxRow({ side, fx, stake }: { side: 'you' | 'their'; fx?: BuffFx[]; stake?: 'won' | 'lost' }) {
  const items: ReactNode[] = [];
  for (const e of fx ?? []) {
    if (!(e.points > 0)) continue;
    const pu = powerupById(e.id);
    const c = e.vsOpp ? 'var(--fx-nuke)' : 'var(--fx-streak)';
    const txt = e.vsOpp ? `−${e.points.toFixed(1)} opp` : `+${e.points.toFixed(1)}`;
    items.push(
      <span key={e.id + (e.vsOpp ? '-o' : '')} className="mono" title={pu?.blurb} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', color: c, background: 'var(--surface)', border: `1px solid ${c}`, borderRadius: 3, padding: '2px 5px' }}>
        {pu?.icon} {pu?.name?.toUpperCase()} {txt}
      </span>,
    );
  }
  if (stake) {
    const c = stake === 'won' ? 'var(--fx-streak)' : 'var(--fx-nuke)';
    items.push(
      <span key="stake" className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', color: c, background: 'var(--surface)', border: `1px solid ${c}`, borderRadius: 3, padding: '2px 5px' }}>
        <PuIcon id="double-or-nothing" emoji="⚖️" size="1.5em" /> DOUBLE OR NOTHING {stake === 'won' ? 'WON ×2' : 'LOST → 0'}
      </span>,
    );
  }
  if (!items.length) return null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3, justifyContent: side === 'you' ? 'flex-start' : 'flex-end' }}>{items}</div>;
}

// ── Score row (live / final) ──
function ScoreRow({ slot, week, youClock, theirClock, open, onToggle, phase, done, onAssignBackup, turnoverCoin, backups, slotName, realClock, kickoffSec, youTwin }: {
  slot: ReturnType<typeof buildMatchup>['windows'][number]['slots'][number];
  week: number; youClock: number; theirClock: number; open: boolean; onToggle: () => void; phase: Phase; done: boolean;
  onAssignBackup: () => void; turnoverCoin: number;
  backups: Record<string, string>; slotName: Record<string, string>;
  realClock: boolean; kickoffSec: number; youTwin?: boolean;
}) {
  const ownKey = slotKey(slot.win, slot.slotIndex);
  const isMobile = useIsMobile();
  const gridCols = '1fr 1fr'; // no center gutter — cards fill the width; controls go below
  const rowGap = isMobile ? 5 : 8;
  // The log always shows BOTH the game clock and the real wall-clock time per
  // event (real time from each side's own player). REAL CLOCK additionally
  // orders/interleaves by real time (matching its effect axis); GAME CLOCK and
  // REAL FEED keep the natural game-clock order.
  const buildLog = (events: PbpEvent[]): { events: PbpEvent[]; realOf: (ev: PbpEvent) => string } => {
    const rt = new Map<PbpEvent, number>();
    for (const ev of events) {
      const p = ev.side === 'you' ? slot.you : slot.their;
      rt.set(ev, p ? realTimeAt(p.player, week, ev.clock, p.metricId ?? undefined) : ev.clock);
    }
    const ordered = realClock ? [...events].sort((a, b) => (rt.get(a) ?? 0) - (rt.get(b) ?? 0)) : events;
    return { events: ordered, realOf: (ev) => fmtTimeShort(kickoffSec + (rt.get(ev) ?? 0)) };
  };
  // Pre-kickoff (this window not yet started) is the only time the best-ball
  // backup target can be (re)assigned — it's a blind bet, locked once it's live.
  const preKick = phase === 'live' && youClock === 0 && theirClock === 0;
  // Unopposed slot: render like a head-to-head row but with a blank box on the
  // empty side. The present player is a best-ball backup — all the directions
  // live in its own card. A player whose metric banks no points can't ever sub,
  // so it isn't offered the backup option.
  if (slot.backup && (slot.you || slot.their)) {
    const mineBackup = !!slot.you;                 // your backup vs opponent's
    const be = (slot.you ?? slot.their)!;
    const bp = metricById(be.player.pos, be.metricId);
    const canSub = !ZERO_BANK_METRICS.has(`${be.player.pos}:${be.metricId}`);
    // A suppress DST is unopposed but not a useless backup — its earn score is a
    // field-wide halving threshold. Show that earn crossed out.
    const suppressSpent = mineBackup ? slot.suppressSpentYou : slot.suppressSpentTheir;
    const isSuppress = suppressSpent != null;
    // The unopposed slot renders with the SAME ScoreCard as a head-to-head slot
    // (headshot, metric chip, statline, big score) plus an UNOPPOSED chip — a
    // blank box sits on the empty side.
    const bclock = mineBackup ? youClock : theirClock; // unopposed: only the present side's clock matters
    const live = banksAtClock(slot.events, bclock);
    const isFinal = done || phase === 'final';
    const subbedIn = !!slot.backupUsed;
    const wouldBe = slot.backupScore ?? 0;           // full would-be score
    // Live: running points. Final: its would-be score — shown struck (0 counted)
    // when it didn't sub in, plain when it subbed in for full value.
    const liveBackup = !done ? (mineBackup ? live.you : live.their) : wouldBe;
    const bEvents = slot.events.filter((e) => e.clock <= bclock);
    const chip = canSub ? (mineBackup ? 'BACKUP' : 'OPP BACKUP') : (mineBackup ? 'UNOPPOSED' : 'OPP UNOPP');
    const showSuppress = isSuppress && (done || phase === 'final') ? (suppressSpent ?? undefined) : undefined;
    const bFg = (mineBackup ? slot.youFgMult : slot.theirFgMult) && !(be.player.pos === 'QB' && be.metricId === 'fg')
      ? (mineBackup ? slot.youFgMult : slot.theirFgMult)!(bclock) : undefined;
    const card = (
      <ScoreCard
        side={mineBackup ? 'you' : 'their'} player={be.player} week={week} clock={bclock} metricId={be.metricId}
        metricName={bp?.name ?? ''} tag={bp?.tag ?? ''} bank={liveBackup} onClick={onToggle}
        chip={chip} suppressSpent={showSuppress} coin={slotCoin(slot, mineBackup ? 'you' : 'their', week, turnoverCoin, bclock)}
        negated={canSub && isFinal && !subbedIn ? true : undefined} fgMult={bFg}
      />
    );
    const blankBox = (
      <div style={{ flex: 1, minWidth: 0, minHeight: 78, background: 'color-mix(in srgb, var(--text) 3%, var(--surface))', border: '1px dashed var(--bd)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)' }}>— NO OPPONENT —</span>
      </div>
    );

    const unoppCenter = (
      <>
        <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--faint)', border: '1px solid var(--bd)', borderRadius: 3, padding: '3px 5px' }}>UNOPP</span>
        {slot.events.length > 0 && (
          <button onClick={onToggle} className="mono" style={{ background: 'none', border: 'none', fontSize: 7, letterSpacing: '0.1em', color: 'var(--faint)', padding: 0 }}>{open ? 'HIDE ▲' : 'LOG ▾'}</button>
        )}
      </>
    );

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'stretch', gap: rowGap }}>
          {mineBackup ? card : blankBox}
          {mineBackup ? blankBox : card}
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 4 }}>{unoppCenter}</div>
        {/* Best-ball backup: assign (pre-kickoff) and/or show the chosen target, in this spot. */}
        {canSub && mineBackup && (preKick || backups[ownKey]) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            {preKick && (
              <button onClick={onAssignBackup} title="Choose which starter this backup challenges (locks at kickoff)" className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 3, padding: '3px 6px' }}>
                {backups[ownKey] ? '↻ REASSIGN' : '＋ ASSIGN BACKUP'}
              </button>
            )}
            {backups[ownKey] && slotName[backups[ownKey]] && (
              <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)' }}>⤴ backing up {slotName[backups[ownKey]]}</span>
            )}
          </div>
        )}
        {/* Make the unopposed rule explicit: sub in for full value, else score 0. */}
        {canSub && mineBackup && (() => {
          let txt: string; let col: string;
          if (isFinal) {
            if (subbedIn) { txt = '✓ subbed in — full points counted'; col = 'var(--you)'; }
            else { txt = '✕ scored 0 — did not sub in'; col = 'var(--fx-stop)'; }
          } else {
            const tgt = backups[ownKey] && slotName[backups[ownKey]];
            txt = tgt
              ? `subs into ${tgt} at final if it wins, else 0`
              : 'banks 0 unless you sub it in for a starter';
            col = 'var(--warn)';
          }
          return <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.03em', color: col, textAlign: 'center', marginTop: 4 }}>{txt}</div>;
        })()}
        {(phase === 'final' || done) && <BuffFxRow side={mineBackup ? 'you' : 'their'} fx={mineBackup ? slot.youBuffFx : slot.theirBuffFx} />}
        {open && slot.real && <FieldView week={week} team={be.player.team} clock={bclock} collapsible />}
        {open && (() => {
          const log = buildLog(bEvents);
          return (
            <TwoColLog events={log.events} realOf={log.realOf} realOrder={realClock} gameLabel={slot.gameLabel} youPlayer={mineBackup ? be.player : undefined} theirPlayer={mineBackup ? undefined : be.player} week={week} youCoin={mineBackup ? metricCoin(be.player.pos, be.metricId) : 0} theirCoin={mineBackup ? 0 : metricCoin(be.player.pos, be.metricId)} />
          );
        })()}
      </div>
    );
  }
  if (!slot.you || !slot.their) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, border: '1px dashed var(--bd)', borderRadius: 4, color: 'var(--faint)', fontSize: 11 }} className="mono">
        — EMPTY SLOT —
      </div>
    );
  }
  // Each side sampled at its own clock (equal in game mode; per-game in wall mode).
  const banks = { you: banksAtClock(slot.events, youClock).you, their: banksAtClock(slot.events, theirClock).their };
  const final = phase === 'final' || done;
  // Displayed score per side: a sub replaces it; at final, suppress-halving and
  // K-negation show the reduced value (with the original revealed below).
  const shownFor = (side: 'you' | 'their') => {
    // Best-ball subbing is an end-of-game decision — only resolve it at FINAL.
    // During live, the starter plays its own head-to-head; the backup accrues
    // in its own row.
    const sub = side === 'you' ? slot.youSub : slot.theirSub;
    if (final && sub) return sub.score;
    if (side === 'you' && slot.byeStolen) return slot.youFinal; // bye steal: flat projection
    // Negation/halving are end-of-game outcomes — only resolve them at FINAL;
    // during live the slot plays its own head-to-head (0 at kickoff).
    if (final && side === 'you' && slot.youNegated) return 0;
    if (final && side === 'their' && slot.theirNegated) return 0;
    if (final && side === 'you' && slot.youHalvedFrom != null) return slot.youFinal;
    if (final && side === 'their' && slot.theirHalvedFrom != null) return slot.theirFinal;
    return side === 'you' ? banks.you : banks.their;
  };
  const youShown = shownFor('you');
  const theirShown = shownFor('their');

  const visibleEvents = slot.events.filter((e) => e.clock <= (e.side === 'you' ? youClock : theirClock));
  const lastEffect = [...visibleEvents].reverse().find((e) => e.effect)?.effect;
  const yMet = metricById(slot.you.player.pos, slot.you.metricId);
  const tMet = metricById(slot.their.player.pos, slot.their.metricId);
  // A backup you've assigned to challenge THIS starter — shown in its spot too.
  const incomingKey = Object.keys(backups).find((k) => backups[k] === ownKey);
  const incomingName = incomingKey ? slotName[incomingKey] : undefined;

  // Live Field General boost on each side (skip the FG QB itself — it's the source).
  const isFgSrc = (p: { player: Player; metricId: string }) => p.player.pos === 'QB' && p.metricId === 'fg';
  const youFg = slot.youFgMult && !isFgSrc(slot.you) ? slot.youFgMult(youClock) : undefined;
  const theirFg = slot.theirFgMult && !isFgSrc(slot.their) ? slot.theirFgMult(theirClock) : undefined;
  const youCard = <ScoreCard side="you" player={slot.you.player} week={week} clock={youClock} metricId={slot.you.metricId} metricName={yMet?.name ?? ''} tag={yMet?.tag ?? ''} bank={youShown} onClick={onToggle} fx={lastEffect?.type} subName={final ? slot.youSub?.name : undefined} suppressSpent={final ? slot.suppressSpentYou : undefined} negated={final ? slot.youNegated : undefined} halvedFrom={final ? slot.youHalvedFrom : undefined} coin={slotCoin(slot, 'you', week, turnoverCoin, youClock)} fgMult={youFg} twin={youTwin} />;
  const theirCard = <ScoreCard side="their" player={slot.their.player} week={week} clock={theirClock} metricId={slot.their.metricId} metricName={tMet?.name ?? ''} tag={tMet?.tag ?? ''} bank={theirShown} onClick={onToggle} fx={lastEffect?.type} subName={final ? slot.theirSub?.name : undefined} suppressSpent={final ? slot.suppressSpentTheir : undefined} negated={final ? slot.theirNegated : undefined} halvedFrom={final ? slot.theirHalvedFrom : undefined} coin={slotCoin(slot, 'their', week, turnoverCoin, theirClock)} fgMult={theirFg} />;
  const centerKids = (
    <>
      {slot.events.length > 0 && (
        <button onClick={onToggle} className="mono" style={{ background: 'none', border: 'none', fontSize: 7, letterSpacing: '0.1em', color: 'var(--faint)', padding: 0 }}>{open ? 'HIDE ▲' : 'LOG ▾'}</button>
      )}
    </>
  );

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'stretch', gap: rowGap }}>
        {youCard}
        {theirCard}
      </div>
      {slot.events.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 14, marginTop: 4 }}>{centerKids}</div>
      )}
      {incomingName && !(final && slot.youSub) && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', marginTop: 3 }}>
          <PuIcon id="insurance" emoji="🛟" size="1.5em" /> backup {incomingName} on standby{final ? ' — did not sub in' : ''}
        </div>
      )}
      {final && slot.youSub && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', marginTop: 3 }}>
          ⤴ BACKUP {slot.youSub.name} subs in for {slot.you.player.name} · {slot.youSub.from.toFixed(1)} → {slot.youSub.score.toFixed(1)}
        </div>
      )}
      {final && slot.theirSub && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--opp)', marginTop: 3, textAlign: 'right' }}>
          {slot.their.player.name} ← BACKUP {slot.theirSub.name} ⤴ · {slot.theirSub.from.toFixed(1)} → {slot.theirSub.score.toFixed(1)}
        </div>
      )}
      {/* halving is shown in the big-number area of each ScoreCard above */}
      {final && slot.youNegated && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--fx-nuke)', marginTop: 3 }}>
          ✕ NEGATED by {slot.their.player.name}'s K SHUTDOWN — scored 0
        </div>
      )}
      {final && slot.theirNegated && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--fx-nuke)', marginTop: 3, textAlign: 'right' }}>
          {slot.their.player.name} ✕ NEGATED by K SHUTDOWN — scored 0
        </div>
      )}
      {final && <BuffFxRow side="you" fx={slot.youBuffFx} stake={slot.youStake} />}
      {final && <BuffFxRow side="their" fx={slot.theirBuffFx} />}
      {open && slot.real && (
        <SlotFieldViews week={week} youTeam={slot.you.player.team} theirTeam={slot.their.player.team} youClock={youClock} theirClock={theirClock} />
      )}
      {open && (() => {
        const log = buildLog(visibleEvents);
        return (
          <TwoColLog events={log.events} realOf={log.realOf} realOrder={realClock} gameLabel={slot.gameLabel} youPlayer={slot.you.player} theirPlayer={slot.their.player} week={week} youCoin={metricCoin(slot.you.player.pos, slot.you.metricId)} theirCoin={metricCoin(slot.their.player.pos, slot.their.metricId)} />
        );
      })()}
    </div>
  );
}

function fmtStat(pos: Pos, s: StatLine, compact = false): string {
  // Compact (mobile): collapse "N car · M rush yd" → "N-M ru" and
  // "R/T rec · Y rec yd" → "R/T-Y rec" so the line fits without ellipsing.
  if (compact) {
    if (pos === 'QB') {
      const p = [`${s.passYds} pass`, `${s.passTds} TD`];
      if (s.rushYds) p.push(`${s.rushYds} ru`);
      return p.join(' · ');
    }
    if (pos === 'RB') {
      const p = [`${s.carries}-${s.rushYds} ru`, `${s.rec}/${s.targets}-${s.recYds} rec`];
      const td = s.rushTds + s.recTds;
      if (td) p.push(s.rushTds && s.recTds ? `${s.rushTds}+${s.recTds} TD` : `${td} TD`);
      if (s.retYds) p.push(`${s.retYds} ret${s.retTds ? `·${s.retTds}TD` : ''}`);
      return p.join(' · ');
    }
    if (pos === 'WR' || pos === 'TE') {
      const p = [`${s.rec}/${s.targets}-${s.recYds} rec`];
      if (s.carries) p.push(`${s.carries}-${s.rushYds} ru`);
      const td = s.rushTds + s.recTds;
      if (td) p.push(s.rushTds && s.recTds ? `${s.rushTds}+${s.recTds} TD` : `${td} TD`);
      if (s.retYds) p.push(`${s.retYds} ret${s.retTds ? `·${s.retTds}TD` : ''}`);
      return p.join(' · ');
    }
    // K / DEF lines are already short — fall through to the full format.
  }
  if (pos === 'QB') {
    const p = [`${s.passYds} pass yd`, `${s.passTds} TD`];
    if (s.rushYds) p.push(`${s.rushYds} rush`);
    return p.join(' · ');
  }
  if (pos === 'RB') {
    // Full line: rushing AND receiving, every week. TDs split when both happen.
    const p = [`${s.carries} car`, `${s.rushYds} rush yd`, `${s.rec}/${s.targets} rec`, `${s.recYds} rec yd`];
    const td = s.rushTds + s.recTds;
    if (td) p.push(s.rushTds && s.recTds ? `${s.rushTds}+${s.recTds} TD` : `${td} TD`);
    if (s.retYds) p.push(`${s.retYds} ret yd${s.retTds ? ` · ${s.retTds} ret TD` : ''}`);
    return p.join(' · ');
  }
  if (pos === 'WR' || pos === 'TE') {
    const p = [`${s.rec}/${s.targets} rec`, `${s.recYds} rec yd`];
    if (s.carries) p.push(`${s.carries} car`, `${s.rushYds} rush yd`); // jet sweeps / end-arounds
    const td = s.rushTds + s.recTds;
    if (td) p.push(s.rushTds && s.recTds ? `${s.rushTds}+${s.recTds} TD` : `${td} TD`);
    if (s.retYds) p.push(`${s.retYds} ret yd${s.retTds ? ` · ${s.retTds} ret TD` : ''}`);
    return p.join(' · ');
  }
  if (pos === 'K') return `${s.fg} FG · ${s.xp} XP`;
  if (pos === 'DEF') {
    const p: string[] = [];
    if (s.sacks) p.push(`${s.sacks} sk`);
    if (s.ints) p.push(`${s.ints} INT`);
    if (s.fumrec) p.push(`${s.fumrec} FR`);
    if (s.dtd) p.push(`${s.dtd} TD`);
    if (s.safety) p.push(`${s.safety} SF`);
    return p.length ? p.join(' · ') : 'no splash';
  }
  if (pos === 'DL' || pos === 'LB' || pos === 'DB') {
    const p: string[] = [];
    if (s.tackles) p.push(`${s.tackles} tkl`);
    if (s.sacks) p.push(`${s.sacks} sk`);
    if (s.ints) p.push(`${s.ints} INT`);
    if (s.fumrec) p.push(`${s.fumrec} FR`);
    if (s.dtd) p.push(`${s.dtd} TD`);
    if (s.safety) p.push(`${s.safety} SF`);
    return p.length ? p.join(' · ') : '—';
  }
  return '—';
}

function ScoreCard({ side, player, week, clock, metricId, metricName, tag, bank, onClick, fx, subName, suppressSpent, negated, halvedFrom, chip, coin, fgMult, twin }: {
  side: 'you' | 'their'; player: Player; week: number; clock: number; metricId?: string; metricName: string; tag: string; bank: number; onClick: () => void; fx?: string; subName?: string; suppressSpent?: number; negated?: boolean; halvedFrom?: number; chip?: string; coin?: number; fgMult?: number; twin?: boolean;
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const isMobile = useIsMobile();
  // Plain-English explanation of the (often jargony) metric, for a hover tooltip
  // on the chip — the board otherwise shows only the tag (DRIP/NUKE/SUPPRESS…).
  const metricEf = metricId ? (metricById(player.pos, metricId)?.ef ?? '') : '';
  const { bigText, fullStats } = useStore();
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the small card labels
  const nuked = fx === 'nuke' && bank === 0 && !subName && suppressSpent == null;
  const stat = useMemo(() => fmtStat(player.pos, statlineAt(player, week, clock, metricId), isMobile), [player, week, clock, metricId, isMobile]);
  const edge = side === 'you' ? 'left' : 'right';
  const nameRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: side === 'you' ? 'row' : 'row-reverse' }}>
      <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
      {chip && <span className="mono" style={{ fontSize: fs(7.5), fontWeight: 700, letterSpacing: '0.1em', color: accent, border: `1px solid ${accent}`, borderRadius: 3, padding: '1px 4px', flex: 'none' }}>{chip}</span>}
      <InjuryBadge week={week} slug={player.id} />
      {twin && <TwinChip />}
      {!isMobile && <span className="mono" style={{ fontSize: fs(8), color: 'var(--faint)' }}>{player.team}</span>}
    </div>
  );
  // The player's REAL NFL game this week + its real game clock (quarter +
  // countdown, HALF / FINAL) — shown under the name on each card.
  const g = nflGameForTeam(week, player.team);
  // FINAL once the clock reaches this game's real end (its last play — including
  // overtime). Falls back to ~regulation when the real end isn't known (synthetic
  // weeks / not yet loaded), so a window's shared clock running into another
  // game's OT doesn't read "OT" on a game that already ended in regulation.
  const gEnd = realGameEndClock(week, player.team);
  const gameOver = gEnd > 0 ? clock >= gEnd - 1 : clock >= 3595;
  const gameLine = g ? (
    <div className="mono" title="real NFL game · real game clock" style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: side === 'you' ? 'row' : 'row-reverse', fontSize: fs(8.5), letterSpacing: '0.02em', marginTop: 2 }}>
      <Img src={teamLogo(g.away)} size={12} radius={2} fallback={<span />} />
      <span style={{ fontWeight: 700, color: 'var(--dimstrong)' }}>{g.away}@{g.home}</span>
      <Img src={teamLogo(g.home)} size={12} radius={2} fallback={<span />} />
      <span style={{ color: 'var(--faint)' }}>·</span>
      <span style={{ color: 'var(--faint)', fontWeight: 700 }}>{gameOver ? 'FINAL' : fmtGameClock(clock)}</span>
    </div>
  ) : null;
  // On mobile the chip is anchored to two lines (name over tag) so it's always
  // the same height regardless of label length; desktop keeps it inline.
  const metricChip = (
    <div title={metricEf || undefined} style={{ display: 'inline-flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? (side === 'you' ? 'flex-end' : 'flex-start') : 'baseline', maxWidth: '100%', gap: isMobile ? 0 : 5, marginTop: isMobile ? 2 : 0, padding: isMobile ? '2px 7px' : '3px 8px', borderRadius: 4, background: `color-mix(in srgb, ${accent} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)`, cursor: metricEf ? 'help' : undefined }}>
      <span className="grotesk" style={{ fontSize: isMobile ? 10.5 : 13, fontWeight: 700, color: accent, letterSpacing: '0.01em', lineHeight: 1.25, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metricName}</span>
      <span className="mono" style={{ fontSize: fs(7), fontWeight: 700, letterSpacing: '0.1em', color: accent, opacity: 0.85, whiteSpace: 'nowrap', lineHeight: 1.25 }}>{tag}</span>
    </div>
  );
  // Statline: justified to the card's outer edge. Mobile uses a small fixed size
  // (not bumped by bigText) and wraps rather than ellipsing — so it never truncates.
  const statLine = suppressSpent != null
    ? <div className="mono" title="Suppress (a DST metric): it spends its own points to halve the opponent's drip in this window." style={{ fontSize: fs(9), color: 'var(--fx-stop)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: edge, cursor: 'help' }}>✕ {suppressSpent.toFixed(1)} spent on SUPPRESS</div>
    : subName
      ? <div className="mono" style={{ fontSize: fs(9.5), color: accent, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: edge }}>⤴ {subName} scoring</div>
      : <div className="mono" style={isMobile
          ? { fontSize: 8.5, lineHeight: 1.3, color: 'var(--dimstrong)', whiteSpace: 'normal', textAlign: edge }
          : fullStats
            ? { fontSize: fs(9.5), lineHeight: 1.3, color: 'var(--dimstrong)', whiteSpace: 'normal', textAlign: edge } // full: wrap, never truncate
            : { fontSize: fs(9.5), color: 'var(--dimstrong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: edge }}>{stat}</div>;
  const bigNum = suppressSpent != null ? (
    <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, color: 'var(--dim)', lineHeight: 1, textDecoration: 'line-through' }}>{suppressSpent.toFixed(1)}</div>
  ) : halvedFrom != null ? (
    // Crossed-out original + ÷2 SUPPRESSED sit BESIDE the final number (toward
    // the card's center) so the chip stays the same height as a normal score.
    <div style={{ display: 'flex', flexDirection: side === 'you' ? 'row-reverse' : 'row', alignItems: 'center', gap: 6 }}>
      <div className="grotesk" style={{ fontSize: isMobile ? 24 : 26, fontWeight: 700, color: 'var(--fx-stop)', lineHeight: 1, letterSpacing: '-0.02em' }}>{bank.toFixed(1)}</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: side === 'you' ? 'flex-end' : 'flex-start', lineHeight: 1.15 }}>
        <span className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--faint)', textDecoration: 'line-through' }}>{halvedFrom.toFixed(1)}</span>
        <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--fx-stop)' }}>÷2 SUPPRESSED</span>
      </div>
    </div>
  ) : (
    <div className="grotesk" style={{ fontSize: isMobile ? 24 : 26, fontWeight: 700, color: negated ? 'var(--fx-nuke)' : accent, lineHeight: 1, letterSpacing: '-0.02em', textDecoration: negated ? 'line-through' : undefined, animation: nuked ? 'shake .5s' : undefined }}>{bank.toFixed(1)}</div>
  );
  const coinEl = coin == null ? null : (
    <div className="mono" title="drip coin earned so far this window" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: fs(9), fontWeight: 700, color: coin < 0 ? 'var(--opp)' : '#F2C14E' }}>
      <CoinIcon size={10} /> {coin < 0 ? '' : '+'}{coin}
    </div>
  );
  // A Field General QB in this slot's window multiplies this player's scoring —
  // surface the live ×N so the boost is visible (it otherwise only shows on the
  // hidden per-minute drip ticks). Suppressed on the FG QB itself (its metric
  // chip already says MULTIPLIER) and when the multiplier is still ~1.
  const fgEl = fgMult != null && fgMult > 1.005 ? (
    <span className="mono" title={`A Field General QB in this window is multiplying this slot's scoring ×${fgMult.toFixed(2)} right now`} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: fs(7.5), fontWeight: 700, letterSpacing: '0.08em', color: 'var(--fx-mult)', border: '1px solid color-mix(in srgb, var(--fx-mult) 55%, transparent)', background: 'color-mix(in srgb, var(--fx-mult) 14%, transparent)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>⚡ FIELD GEN ×{fgMult.toFixed(2)}</span>
  ) : null;

  if (isMobile) {
    // Name on top, headshot on the outer side, metric + coin/score stacked
    // beside it, statline pinned to the bottom (mirrored for the opponent). The
    // metric area reserves two lines so the coin/score and statline rows line up
    // across both cards regardless of how the metric label wraps.
    return (
      <div onClick={onClick} style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--bd)', [side === 'you' ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: 3, cursor: 'pointer', animation: nuked ? 'flash 1.4s ease-out' : undefined } as React.CSSProperties}>
        {nameRow}
        {gameLine}
        <div style={{ display: 'flex', flexDirection: side === 'you' ? 'row' : 'row-reverse', alignItems: 'center', gap: 8 }}>
          <PlayerImg playerId={player.id} team={player.team} pos={player.pos} size={46} />
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, alignItems: side === 'you' ? 'flex-end' : 'flex-start' }}>
            <div style={{ minHeight: 18, display: 'flex', alignItems: 'center', width: '100%', justifyContent: side === 'you' ? 'flex-end' : 'flex-start' }}>{metricChip}</div>
            {fgEl}
            <div style={{ display: 'flex', flexDirection: side === 'you' ? 'row' : 'row-reverse', alignItems: 'baseline', gap: 6 }}>
              {coinEl}
              {bigNum}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 'auto' }}>{statLine}</div>
      </div>
    );
  }

  return (
    <div onClick={onClick} style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--bd)', [side === 'you' ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, padding: '9px 11px', display: 'flex', flexDirection: side === 'you' ? 'row' : 'row-reverse', gap: 11, alignItems: 'center', cursor: 'pointer', animation: nuked ? 'flash 1.4s ease-out' : undefined } as React.CSSProperties}>
      <PlayerImg playerId={player.id} team={player.team} pos={player.pos} size={64} />
      <div style={{ flex: 1, minWidth: 0, textAlign: edge }}>
        {nameRow}
        {gameLine}
        <div style={{ marginTop: 5 }}>{statLine}</div>
      </div>
      <div style={{ flex: 'none', maxWidth: '48%', alignSelf: 'center', display: 'flex', flexDirection: 'column', alignItems: side === 'you' ? 'flex-end' : 'flex-start', gap: 5 }}>
        {metricChip}
        {fgEl}
        {bigNum}
        {coinEl}
      </div>
    </div>
  );
}

const FX_COLOR: Record<string, string> = { nuke: 'var(--fx-nuke)', erase: 'var(--fx-erase)', streak: 'var(--fx-streak)', cold: 'var(--fx-stop)', mult: 'var(--fx-mult)', compression: 'var(--fx-compression)', reset: 'var(--fx-reset)', stop: 'var(--fx-stop)' };

// Strip the leading "TEAM:" / "TEAM TD:" / "TEAM D:" prefix — the column header
// already names the player, so the log only needs the action.
function actionText(play: string): string {
  return play.replace(/^[A-Z]{2,3}( D| TD)?:\s*/, '');
}

// Two-column play-by-play: your player's plays on the left, theirs on the
// right, the clock down the middle. Chronological (newest at the bottom) so it
// reads like a live ticker, auto-scrolling to keep the latest play in view.
function TwoColLog({ events, gameLabel, youCoin = 0, theirCoin = 0, realOf, realOrder, youPlayer, theirPlayer, week }: { events: PbpEvent[]; gameLabel: string; youCoin?: number; theirCoin?: number; realOf?: (ev: PbpEvent) => string; realOrder?: boolean; youPlayer?: Player; theirPlayer?: Player; week: number }) {
  // Larger-text mode enlarges this fine-print log (the smallest text in the app).
  const { bigText } = useStore();
  const isMobile = useIsMobile();
  const [detail, setDetail] = useState<PbpEvent | null>(null); // a play tapped for its PBP details
  const fs = (n: number) => bigText ? Math.round(n * 1.35 * 10) / 10 : n; // font size
  const fw = (n: number) => bigText ? Math.round(n * 1.35) : n;            // fixed widths/heights
  const badgeFs = bigText ? 9.5 : 8; // effect/power-up badge size — readable but tuned to fit one line
  const [minutes, setMinutes] = useState(false);
  const [top, setTop] = useState(false); // newest entries on top vs bottom
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Compact view hides the per-minute drip ticks; "minutes" shows scoring accrue.
  const filtered = minutes ? events : events.filter((e) => !e.drip);
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = top ? 0 : el.scrollHeight;
  }, [filtered.length, top]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = top ? el.scrollTop < 28 : el.scrollHeight - el.scrollTop - el.clientHeight < 28;
  };
  const slice = filtered.slice(minutes ? -220 : -90);
  const rows = top ? [...slice].reverse() : slice;
  const newestIdx = top ? 0 : rows.length - 1;

  // Running cumulative for a side at the far edge (outside the action column).
  const cum = (ev: PbpEvent, mine: boolean) => (
    <span className="mono" style={{ width: fw(26), flex: 'none', textAlign: mine ? 'left' : 'right', fontSize: fs(9), fontWeight: 700, color: ev.side === (mine ? 'you' : 'their') ? (mine ? 'var(--you)' : 'var(--opp)') : 'var(--faint)', opacity: 0.85 }}>
      {(mine ? ev.youBank : ev.theirBank).toFixed(1)}
    </span>
  );
  const cell = (ev: PbpEvent, mine: boolean) => {
    if (ev.side !== (mine ? 'you' : 'their')) return <div style={{ flex: 1 }} />;
    const accent = mine ? 'var(--you)' : 'var(--opp)';
    const coinAmt = ev.coin ? (ev.coinAmt ?? (mine ? youCoin : theirCoin)) : 0;
    const hasScore = ev.delta > 0 || !!ev.mult || coinAmt > 0;
    // The ×mult is suppressed when a 'mult' effect badge already carries it (FIELD GEN ×N).
    const delta = ev.delta > 0 ? <span className="mono" style={{ fontSize: fs(9.5), fontWeight: 700, color: accent }}>+{ev.delta.toFixed(1)}</span> : null;
    const mult = ev.mult && ev.effect?.type !== 'mult' ? <span className="mono" style={{ fontSize: fs(8.5), fontWeight: 700, color: 'var(--fx-mult)' }}>×{ev.mult.toFixed(2)}</span> : null;
    const coin = coinAmt > 0 ? <CoinPill amt={coinAmt} /> : null;
    const effect = ev.effect ? <span className="mono" style={{ fontSize: badgeFs, fontWeight: 700, letterSpacing: '0.02em', color: FX_COLOR[ev.effect.type] ?? 'var(--dim)' }}>{ev.effect.text}</span> : null;
    const buff = ev.buffNote ? <span className="mono" style={{ fontSize: badgeFs, fontWeight: 700, letterSpacing: '0.02em', color: 'var(--warn)' }}>⚡ {ev.buffNote}</span> : null;

    // Desktop has the width to keep the whole play on one line: action + scoring
    // + badges in a single nowrap row.
    if (!isMobile) {
      return (
        <div style={{ flex: 1, minWidth: 0, opacity: ev.drip ? 0.62 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, justifyContent: mine ? 'flex-end' : 'flex-start', whiteSpace: 'nowrap', overflow: 'hidden' }}>
            <span style={{ fontSize: fs(10.5), color: 'var(--text)' }}>{actionText(ev.play)}</span>
            {delta}{mult}{coin}{effect}{buff}
          </div>
        </div>
      );
    }

    // Mobile: play on line 1, scoring on line 2, badges below — wraps never spill
    // into the running totals.
    return (
      <div style={{ flex: 1, minWidth: 0, textAlign: mine ? 'right' : 'left', opacity: ev.drip ? 0.62 : 1 }}>
        <div style={{ fontSize: fs(10.5), lineHeight: 1.3, color: 'var(--text)', overflowWrap: 'anywhere' }}>{actionText(ev.play)}</div>
        {hasScore && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 4, marginTop: 1, justifyContent: mine ? 'flex-end' : 'flex-start' }}>
            {delta}{mult}{coin}
          </div>
        )}
        {effect && <div className="mono" style={{ marginTop: 1, overflowWrap: 'anywhere' }}>{effect}</div>}
        {buff && <div className="mono" style={{ marginTop: 1, overflowWrap: 'anywhere' }}>{buff}</div>}
      </div>
    );
  };
  const toggle = (on: boolean, label: string, onClick: () => void) => (
    <button onClick={onClick} className="mono" style={{ fontSize: fs(7.5), fontWeight: 700, letterSpacing: '0.06em', color: on ? 'var(--you)' : 'var(--faint)', background: 'var(--surface)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 3, padding: '2px 6px' }}>{label}</button>
  );
  return (
    <div style={{ marginTop: 5, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 6 }}>
        {toggle(minutes, minutes ? 'MINUTES' : 'PLAYS', () => setMinutes((m) => !m))}
        {toggle(top, top ? 'NEWest ↑' : 'NEWest ↓', () => setTop((t) => !t))}
      </div>
      <div ref={scroller} onScroll={onScroll} style={{ maxHeight: fw(210), overflow: 'auto', paddingRight: 6, scrollbarGutter: 'stable', scrollbarWidth: 'thin' }}>
        {rows.length === 0 && (
          <div className="mono" style={{ fontSize: fs(9), color: 'var(--faint)', letterSpacing: '0.1em', textAlign: 'center', padding: '14px 0' }}>— no plays yet at this point —</div>
        )}
        {rows.map((ev, i) => (
          <div key={i} onClick={() => setDetail(ev)} title="tap for play details" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0', borderTop: i === 0 ? undefined : '1px solid color-mix(in srgb, var(--bd) 45%, transparent)', animation: i === newestIdx ? 'slidein .3s ease' : undefined, cursor: 'pointer' }}>
            {cum(ev, true)}
            {cell(ev, true)}
            <div className="mono" title="game clock · real wall-clock time" style={{ width: fw(36), flex: 'none', textAlign: 'center', paddingTop: 1, lineHeight: 1.15 }}>
              <div style={{ fontSize: fs(8.5), color: 'var(--faint)' }}>{fmtClock(ev.clock)}</div>
              {realOf && <div style={{ fontSize: fs(8), fontWeight: 700, color: 'var(--dimstrong)' }}>{realOf(ev)}</div>}
            </div>
            {cell(ev, false)}
            {cum(ev, false)}
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: fs(7.5), color: 'var(--faint)', letterSpacing: '0.12em', marginTop: 6, textAlign: 'center' }}>cumulative totals on the edges · {minutes ? 'minute-by-minute drip' : 'plays'} · game + real clock · {realOrder ? 'real-time order' : 'game-clock order'} · {gameLabel} · tap a play for details</div>
      {detail && <PlayDetailModal ev={detail} player={detail.side === 'you' ? youPlayer : theirPlayer} week={week} realStamp={realOf?.(detail)} onClose={() => setDetail(null)} />}
    </div>
  );
}

// Detail card for a single play tapped in the log — surfaces the underlying real
// PBP record (kind, yards, TD, catch/target, turnover, nflverse play_id) plus the
// game/real clock and the points it banked.
const PLAY_KIND_LABEL: Record<string, string> = {
  pass: 'Pass', rush: 'Rush', rec: 'Reception', incomplete: 'Incompletion', return: 'Return',
  fg: 'Field goal', fgmiss: 'FG miss', xp: 'Extra point', xpmiss: 'XP miss',
  sack: 'Sack', int: 'Interception', fumrec: 'Fumble recovery', dst_td: 'Defensive TD', safety: 'Safety', tackle: 'Tackle',
};
function PlayDetailModal({ ev, player, week, realStamp, onClose }: { ev: PbpEvent; player?: Player; week: number; realStamp?: string; onClose: () => void }) {
  const raw = player ? (realPbpFor(week, player.id)?.find((p) => p.c === ev.clock) ?? null) : null;
  const g = player ? nflGameForTeam(week, player.team) : undefined;
  const accent = ev.side === 'you' ? 'var(--you)' : 'var(--opp)';
  const Row = ({ k, v }: { k: string; v: ReactNode }) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '5px 0', borderTop: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--faint)' }}>{k}</span>
      <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{v}</span>
    </div>
  );
  return (
    <ModalBackdrop onClick={onClose} zIndex={80} padTop={60}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380, background: 'var(--surface)', border: '1px solid var(--bdh)', borderTop: `3px solid ${accent}`, borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{player?.name ?? 'Play'}{player && <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', fontWeight: 400 }}> · {player.pos} {player.team}</span>}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.04em' }}>{actionText(ev.play)}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: '6px 16px 14px' }}>
          {g && <Row k="GAME" v={`${g.away} @ ${g.home}`} />}
          <Row k="GAME CLOCK" v={fmtGameClock(ev.clock)} />
          {realStamp && <Row k="REAL CLOCK" v={realStamp} />}
          {raw ? <>
            <Row k="PLAY" v={PLAY_KIND_LABEL[raw.k] ?? raw.k} />
            {(raw.k === 'pass' || raw.k === 'rush' || raw.k === 'rec' || raw.k === 'return' || raw.k === 'fg' || raw.k === 'fgmiss') && <Row k="YARDS" v={`${raw.y}`} />}
            {raw.td ? <Row k="TOUCHDOWN" v="yes" /> : null}
            {raw.ca ? <Row k="RECEPTION" v="caught" /> : null}
            {raw.tg && !raw.ca ? <Row k="TARGET" v="incomplete" /> : null}
            {raw.to ? <Row k="TURNOVER" v="lost" /> : null}
            {raw.pid != null && <Row k="NFLVERSE PLAY_ID" v={`${raw.pid}`} />}
          </> : <Row k="TYPE" v={ev.drip ? 'drip accrual (per-minute)' : 'scoring event'} />}
          <Row k="POINTS THIS PLAY" v={<span style={{ color: ev.delta > 0 ? accent : 'var(--dim)' }}>{ev.delta > 0 ? `+${ev.delta.toFixed(1)}` : ev.delta.toFixed(1)}{ev.mult ? ` ×${ev.mult.toFixed(2)}` : ''}</span>} />
          <Row k="RUNNING BANK" v={`${(ev.side === 'you' ? ev.youBank : ev.theirBank).toFixed(1)}`} />
          {ev.effect && <Row k="EFFECT" v={<span style={{ color: FX_COLOR[ev.effect.type] ?? 'var(--dim)' }}>{ev.effect.text}</span>} />}
          {ev.buffNote && <Row k="POWER-UP" v={<span style={{ color: 'var(--warn)' }}>{ev.buffNote}</span>} />}
        </div>
      </div>
    </ModalBackdrop>
  );
}
