import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../app/store';
import type { Phase } from '../app/store';
import { Brand, ThemeSwitcher, PlayerImg, Avatar, Img, InjuryBadge, useIsMobile } from '../app/ui';
import { avatarUrl, teamLogo } from '../data/media';
import { nflGameForTeam, gamesInWindow, windowDateLabel, weekDateRange, weekLockLabel } from '../data/nflSlate';
import { WINDOWS, METRICS, metricById } from '../data/metrics';
import { POWERUPS, powerupById, type Powerup } from '../data/powerups';
import { getTeam, getPlayer, gameForTeam } from '../data/league';
import {
  windowPools, defaultLineup, slotKey, buildMatchup, banksAtClock, weekEarnings, metricCoin, coinRisk, slotCoin, WEEKLY_STIPEND, UNOPPOSED_COIN, slotsFor, totalSlotsWith, byePlayers,
} from '../engine/matchup';
import { fmtClock, statlineAt, realTimeAt, clockAtRealTime, GAME_SECONDS, type StatLine } from '../engine/sim';
import { REAL_WEEKS, loadRealWeek, isRealWeekLoaded, realPbpFor } from '../data/realPbp';
import { ShopModal } from './LeagueOverview';
import type { Pick, Player, Pos, WindowId, PbpEvent, BuffFx, Metric } from '../types';

const YOU = 'happy-campers';
const TICK_MS = 700;
const TICK_SECONDS = 20;

// Window kickoff time-of-day, parsed from a window's `time` string ("Sun 1:00p")
// to seconds-since-midnight (ET) — the base for the wall-clock header.
function kickoffSecOfDay(timeStr: string): number {
  const t = timeStr.split(' ')[1] ?? timeStr;
  const m = /(\d+):(\d+)\s*([ap])/i.exec(t);
  if (!m) return 13 * 3600;
  let h = (+m[1]) % 12;
  if (m[3].toLowerCase() === 'p') h += 12;
  return h * 3600 + (+m[2]) * 60;
}
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
  if (c >= 3595) return 'FINAL';
  const q = Math.min(4, Math.floor(c / 900) + 1);
  const rem = 900 - (c - (q - 1) * 900); // seconds left in the quarter
  if (q === 2 && rem <= 1) return 'HALF';
  const m = Math.floor(rem / 60);
  const s = Math.round(rem % 60);
  return `Q${q} ${m}:${String(s).padStart(2, '0')}`;
}

// Drip coin — an actual minted-coin glyph (gold disc with the ◈ house mark),
// so coin reads as currency wherever it appears instead of a bare symbol.
function CoinIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ display: 'inline-block', verticalAlign: 'text-bottom', flex: 'none' }}>
      <circle cx="8" cy="8" r="7" fill="#F2C14E" stroke="#9A6B12" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="5.1" fill="none" stroke="#C9952B" strokeWidth="0.9" />
      <path d="M8 4.6 L10.4 8 L8 11.4 L5.6 8 Z" fill="#9A6B12" />
    </svg>
  );
}

// A prominent coin-earn pill for the play-by-play log.
function CoinPill({ amt }: { amt: number }) {
  return (
    <span className="mono" title="drip coin earned" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 9.5, fontWeight: 700, color: '#F2C14E', background: 'color-mix(in srgb, #F2C14E 16%, transparent)', border: '1px solid color-mix(in srgb, #F2C14E 50%, transparent)', borderRadius: 4, padding: '0 4px', marginLeft: 5, verticalAlign: 'middle' }}>
      <CoinIcon size={10} /> +{amt}
    </span>
  );
}

export function Matchup({ week, initialPhase }: { week: number; initialPhase: Phase }) {
  const { navigate, coins, creditWeek, inventory, useConsumable, applied, applyExtraSlot, applyMetricSwap, applyPlayerSwap, setBackupTarget, armBuff, disarmBuff, setDoubleOrNothing, remapDoubleOrNothing, setSpy, applyByeSteal, applyMulligan, applyEmp, clearDoubleOrNothing, clearSpy, clearByeSteal, removeExtraSlot, refundUnlock, resetDripCoin } = useStore();
  const buffs = applied[week]?.buffs ?? {};
  const buffsKey = JSON.stringify(buffs);
  const extraSlots = applied[week]?.extraSlots ?? {};
  const swaps = applied[week]?.swaps ?? {};
  const backupAssign = applied[week]?.backups ?? {};
  const aw = applied[week];
  const extras = { doubleOrNothing: aw?.doubleOrNothing, byeSteal: aw?.byeSteal, emp: aw?.emp };
  const extrasKey = JSON.stringify(extras);
  const oppId = gameForTeam(YOU, week)?.oppId ?? 'rock-tunnel';
  const you = getTeam(YOU)!;
  const opp = getTeam(oppId)!;

  const isMobile = useIsMobile();
  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [selSlot, setSelSlot] = useState<string | null>(null);
  // Per-window playback: each window runs its own clock + play/pause. The clock
  // is game-elapsed seconds by default, or REAL wall-clock seconds since kickoff
  // when wallClock is on — then each game in the window advances at its own real
  // pace (one game can pull minutes ahead of another), keyed off each play's `t`.
  const [winClocks, setWinClocks] = useState<Record<string, number>>({});
  const [winPlaying, setWinPlaying] = useState<Record<string, boolean>>({});
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
  function applyToSpot(key: string) {
    if (pendingApply === 'double-or-nothing') { setDoubleOrNothing(week, key); setPendingApply(null); }
    else if (pendingApply === 'bye-steal') setByeStealSlot(key); // keep pending until a bye player is chosen
    else if (pendingApply === 'spy') setSpySlot(key); // keep pending until a reveal is chosen
    else if (pendingApply === 'mulligan') setMulliganSlot(key); // keep pending until a metric is chosen
    else if (pendingApply === 'metric-swap' || pendingApply === 'player-swap') { setSwapTarget({ key, win: key.split('#')[0] as WindowId }); setPendingApply(null); } // open the swap menu on the tapped live spot
  }
  function applyToWindow(win: WindowId) {
    if (pendingApply === 'emp') { applyEmp(week, win, winClocks[win] ?? 0); setPendingApply(null); }
  }
  // Rosters expand in setup (you need them to set lineups), collapse otherwise.
  const [rosterOpen, setRosterOpen] = useState<{ you: boolean; their: boolean }>(() => ({ you: initialPhase === 'setup', their: initialPhase === 'setup' }));
  const toggleRoster = (side: 'you' | 'their') => setRosterOpen((o) => ({ ...o, [side]: !o[side] }));
  // On mobile the rosters are full-width blocks above the board, and selection is
  // done by tapping a spot — so keep both collapsed by default.
  useEffect(() => { if (isMobile) setRosterOpen({ you: false, their: false }); }, [isMobile]);

  // Lazy-load this week's real play-by-play (per-week JSON) before resolving.
  const [ready, setReady] = useState(() => !REAL_WEEKS.has(week) || isRealWeekLoaded(week));
  useEffect(() => {
    if (!REAL_WEEKS.has(week) || isRealWeekLoaded(week)) { setReady(true); return; }
    setReady(false);
    let alive = true;
    loadRealWeek(week).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [week]);

  const extraKey = JSON.stringify(extraSlots);
  const youPools = useMemo(() => windowPools(YOU, week), [week]);
  const oppPools = useMemo(() => windowPools(oppId, week), [week, oppId]);
  const oppPicks = useMemo(() => defaultLineup(oppId, week, extraSlots), [oppId, week, ready, extraKey]);
  const youDefault = useMemo(() => defaultLineup(YOU, week, extraSlots), [week, ready, extraKey]);
  const byeYou = useMemo(() => byePlayers(YOU, week), [week]);
  const byeTheir = useMemo(() => byePlayers(oppId, week), [week, oppId]);

  const playerWindow = useMemo(() => {
    const m = new Map<string, WindowId>();
    (Object.keys(youPools) as WindowId[]).forEach((w) => youPools[w].forEach((p) => m.set(p.id, w)));
    return m;
  }, [youPools]);

  const effYouPicks = useMemo<Record<string, Pick>>(() => {
    if (phase === 'setup') return picks;
    return { ...youDefault, ...picks };
  }, [phase, picks, youDefault]);

  const swapsKey = JSON.stringify(swaps);
  const backupsKey = JSON.stringify(backupAssign);
  const resolved = useMemo(
    () => buildMatchup(YOU, oppId, week, effYouPicks, oppPicks, extraSlots, swaps, backupAssign, buffs, extras, realResolve),
    [oppId, week, effYouPicks, oppPicks, ready, extraKey, swapsKey, backupsKey, buffsKey, extrasKey, realResolve],
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
  useEffect(() => {
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

  // On entering live/final — or switching clock mode — seed each window's
  // position + play state. (Toggling modes re-seeds to 0 so playback replays
  // cleanly on the new axis rather than mixing units.)
  useEffect(() => {
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
  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => {
      setWinClocks((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const wid of Object.keys(winTarget)) {
          if (winPlaying[wid] && (prev[wid] ?? 0) < winTarget[wid]) {
            next[wid] = Math.min(winTarget[wid], (prev[wid] ?? 0) + TICK_SECONDS);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, winPlaying, winTarget]);

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
        const c = winClocks[id] ?? 0;
        const active = phase === 'live' && c > 0 && c < (winTarget[id] ?? Infinity);
        if (active !== (prevActive.current[id] ?? false)) {
          if (!changed) { next = { ...prev }; changed = true; }
          for (const s of rw.slots) next[slotKey(id, s.slotIndex)] = active;
        }
        prevActive.current[id] = active;
      }
      return changed ? next : prev;
    });
  }, [phase, winClocks, winMax, resolved]);

  // ── totals at each window's own clock ──
  const { youTotal, themTotal } = useMemo(() => {
    if (phase === 'final') return { youTotal: resolved.youFinal, themTotal: resolved.theirFinal };
    if (phase === 'setup') return { youTotal: 0, themTotal: 0 };
    let y = 0; let t = 0;
    for (const rw of resolved.windows) {
      const c = winClocks[rw.window.id] ?? 0;
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
  }, [resolved, winClocks, phase, wallClock, week]);

  // Every window has played out to its own end — the board is effectively final.
  const allWindowsDone = useMemo(() => {
    const ids = Object.keys(winTarget);
    return ids.length > 0 && ids.every((id) => (winClocks[id] ?? 0) >= (winTarget[id] ?? Infinity));
  }, [winClocks, winTarget]);
  const boardFinal = phase === 'final' || (phase === 'live' && allWindowsDone);

  const filledCount = Object.values(picks).filter((p) => p.metricId).length;
  const totalSlots = totalSlotsWith(extraSlots);
  const anyPlaying = Object.values(winPlaying).some(Boolean);
  const extraSlotQty = inventory['extra-slot'] ?? 0;

  // ── Power-up windows: every window has its own lock/live timeline. A 'pre'
  // power-up can be applied until the first window starts; a 'live' one only
  // while a window is still running (not yet closed). ──
  const winLife = useMemo(() => {
    const out: Record<string, 'pending' | 'live' | 'closed'> = {};
    for (const id of Object.keys(winTarget)) {
      const c = winClocks[id] ?? 0;
      out[id] = c <= 0 ? 'pending' : c >= winTarget[id] ? 'closed' : 'live';
    }
    return out;
  }, [winClocks, winTarget]);
  const anyStarted = Object.values(winLife).some((s) => s !== 'pending');
  const liveWins = WINDOWS.filter((w) => winLife[w.id] === 'live');
  const preKickPhase = phase === 'live' && !anyStarted; // locked in, no game kicked yet

  // On lock-in, walk through EVERY UNOPPOSED player (your player with no
  // head-to-head opponent) — they're best-ball backups that can sub in. The
  // prompt is a REQUIRED interrupt: it can't be dismissed, so you can't reach
  // the live screen without making a call (challenge a starter, or take the 0 /
  // bank half). Every sub-capable unopposed spot is prompted once per lock-in —
  // even ones with a saved assignment (the card pre-selects it to confirm or
  // change) — so you never have to hunt for the spot's reassign button.
  const backupPrompted = useRef<Set<string>>(new Set());
  useEffect(() => { if (phase !== 'live') backupPrompted.current = new Set(); }, [phase]);
  useEffect(() => {
    if (phase !== 'live' || anyStarted || backupMenu) return;
    const next = resolved.windows.flatMap((w) => w.slots).find((s) => {
      if (!s.backup || !s.you) return false;
      const k = slotKey(s.win, s.slotIndex);
      if (ZERO_BANK_METRICS.has(`${s.you.player.pos}:${s.you.metricId}`)) return false; // can't sub (scores 0)
      return !backupPrompted.current.has(k);
    });
    if (next) { const k = slotKey(next.win, next.slotIndex); backupPrompted.current.add(k); setBackupMenu({ key: k, required: true }); }
  }, [phase, anyStarted, backupMenu, resolved, backupAssign]);

  // Everything currently in effect, with a back-out where the store supports it.
  const activeEffects: { key: string; icon: string; name: string; detail: string; onRemove?: () => void }[] = [];
  for (const id of Object.keys(buffs)) if (buffs[id]) { const p = powerupById(id); if (p) activeEffects.push({ key: 'b-' + id, icon: p.icon, name: p.name, detail: 'Armed · whole field', onRemove: phase === 'setup' ? () => disarmBuff(week, id) : undefined }); }
  if (aw?.doubleOrNothing) { const s = resolved.windows.flatMap((w) => w.slots).find((s) => slotKey(s.win, s.slotIndex) === aw.doubleOrNothing); activeEffects.push({ key: 'don', icon: '⚖️', name: 'Double or Nothing', detail: 'Staked ' + (s?.you?.player.name ?? '—'), onRemove: phase === 'setup' ? () => clearDoubleOrNothing(week) : undefined }); }
  if (aw?.byeSteal) activeEffects.push({ key: 'bye', icon: '🪂', name: 'Bye Steal', detail: 'Fielded ' + (getPlayer(aw.byeSteal.playerId)?.name ?? '—'), onRemove: phase === 'setup' ? () => clearByeSteal(week) : undefined });
  if (aw?.spy) { const sp = aw.spy; activeEffects.push({ key: 'spy', icon: '👁️', name: 'Spy', detail: `Revealed a slot’s ${sp.reveal}`, onRemove: preKickPhase ? () => clearSpy(week) : undefined }); }
  for (const [win, n] of Object.entries(aw?.extraSlots ?? {})) if ((n ?? 0) > 0) { const wl = WINDOWS.find((w) => w.id === win)?.label ?? win; activeEffects.push({ key: 'x-' + win, icon: '➕', name: 'Extra Slot', detail: `+${n} on ${wl}`, onRemove: phase === 'setup' ? () => removeExtraSlot(week, win as WindowId) : undefined }); }
  for (const [win, c] of Object.entries(aw?.emp ?? {})) if (c != null) { const wl = WINDOWS.find((w) => w.id === win)?.label ?? win; activeEffects.push({ key: 'emp-' + win, icon: '💥', name: 'EMP', detail: `Fired on ${wl}` }); }

  // Owned power-ups you can still apply right now, scoped to open windows. 'pre'
  // power-ups lock at the first kickoff; 'live' ones need a running window.
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
    return { p, ok, deadline, action };
  }).filter((x) => x.ok);

  // ── setup interactions ──
  // Keep each window's spots filled top-down: collapse any gap so a filled spot
  // never sits below an empty one.
  function compactPicks(p: Record<string, Pick>): Record<string, Pick> {
    const out: Record<string, Pick> = {};
    for (const w of WINDOWS) {
      const n = slotsFor(w.id, extraSlots);
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
    if (!newKey) clearDoubleOrNothing(week);                 // staked player removed → refund
    else if (newKey !== key) remapDoubleOrNothing(week, newKey); // shifted by compaction → follow
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
    if (phase !== 'setup') return;
    const win = playerWindow.get(playerId);
    if (!win) return;
    const nSlots = slotsFor(win, extraSlots);
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

  function lockIn() { setPhase('live'); setSelSlot(null); setRosterOpen({ you: false, their: false }); }
  function changePhase(p: Phase) { setPhase(p); setSelSlot(null); setRosterOpen({ you: p === 'setup', their: p === 'setup' }); }
  function toggleAll() {
    const v = !anyPlaying;
    setWinPlaying(() => { const n: Record<string, boolean> = {}; for (const k of Object.keys(winMax)) n[k] = v; return n; });
  }
  function setWinPlay(wid: string, v: boolean) { setWinPlaying((p) => ({ ...p, [wid]: v })); }
  function replayWin(wid: string) { setWinClocks((c) => ({ ...c, [wid]: 0 })); setWinPlaying((p) => ({ ...p, [wid]: true })); }

  const headline = phase === 'setup' ? 'Set Your Windows' : phase === 'live' ? 'Live Resolution' : `Week ${week} — Final`;
  const subhead = `${you.name} vs ${opp.name} · each window plays on its own clock — hit ▶ on any window, or run them all.`;

  if (!ready) {
    return (
      <div className="mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, color: 'var(--dim)', fontSize: 12, letterSpacing: '0.08em' }}>
        LOADING WEEK {week}…
      </div>
    );
  }

  return (
    <>
      <header style={{ height: isMobile ? 'auto' : 60, minHeight: 52, flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6, padding: isMobile ? '7px 10px' : '0 18px', position: 'sticky', top: 0, zIndex: 40, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
          <Brand onClick={() => navigate({ name: 'league' })} />
          <div style={{ display: 'flex', gap: 2, padding: 3, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4 }}>
            {(['setup', 'live', 'final'] as Phase[]).map((p) => (
              <button key={p} onClick={() => changePhase(p)} className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', padding: '5px 9px', borderRadius: 3, border: 'none', background: phase === p ? 'var(--sh)' : 'transparent', color: phase === p ? 'var(--you)' : 'var(--dim)' }}>
                {p.toUpperCase()}
              </button>
            ))}
          </div>
          <ThemeSwitcher />
          {resolved.real && (
            <span className="mono" title="This week resolves off real 2025 NFL play-by-play" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--you)', border: '1px solid var(--you)', borderRadius: 3, padding: '3px 6px' }}>
              ● REAL PBP
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 14, whiteSpace: 'nowrap', flexWrap: 'wrap' }}>
          <button onClick={() => setEarnOpen(true)} title="Drip Coin — tap for earning opportunities" className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer' }}>
            <CoinIcon size={13} />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{coins}</span>
            {weekCoins > 0 && <span style={{ fontSize: 8.5, color: 'var(--fx-streak)' }}>+{weekCoins}</span>}
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
              <div style={{ textAlign: 'right' }}>
                <div className="mono" style={{ fontSize: 8, letterSpacing: '0.2em', color: 'var(--faint)' }}>LOCKS IN</div>
                <div className="mono" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--warn)' }}>{weekLockLabel(week)}</div>
              </div>
              <button onClick={lockIn} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4, boxShadow: '0 0 20px color-mix(in srgb, var(--you) 30%, transparent)' }}>
                LOCK IN →
              </button>
            </div>
          )}
          {phase === 'live' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ display: 'inline-block', width: 8, height: 8, background: '#FF4F62', borderRadius: '50%', animation: 'lpulse 1.2s ease infinite' }} />
              <span className="mono" style={{ color: '#FF4F62', fontWeight: 700, letterSpacing: '0.14em', fontSize: 11 }}>LIVE</span>
              <button onClick={toggleAll} className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '6px 10px' }}>
                {anyPlaying ? '❚❚ PAUSE ALL' : '▶ RUN ALL'}
              </button>
              <button
                onClick={() => setClockMode((m) => (m === 'game' ? 'feed' : m === 'feed' ? 'real' : 'game'))}
                title={'Playback clock (tap to cycle):\n• GAME CLOCK — every game in a window moves in lockstep on game time\n• REAL FEED — plays reveal on the real wall clock (games desync), but the log orders/interleaves and effects resolve on the game clock\n• REAL CLOCK — plays order/interleave and effects resolve on the real clock (cross-game effects land in real-time order)'}
                className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: wallClock ? 'var(--on-accent)' : 'var(--dim)', background: clockMode === 'real' ? 'var(--warn)' : clockMode === 'feed' ? 'var(--you)' : 'var(--surface)', border: `1px solid ${clockMode === 'real' ? 'var(--warn)' : clockMode === 'feed' ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '6px 10px' }}>
                ⏱ {clockMode === 'real' ? 'REAL CLOCK' : clockMode === 'feed' ? 'REAL FEED' : 'GAME CLOCK'}
              </button>
            </div>
          )}
          {phase === 'final' && (
            <button onClick={() => navigate({ name: 'final', week })} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4 }}>
              WEEK RESULT →
            </button>
          )}
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 10 : 14, padding: isMobile ? 10 : 14, overflow: isMobile ? 'auto' : 'hidden', minHeight: 0 }}>
        {!isMobile && <RosterAside side="you" pools={youPools} picks={picks} onPlayer={assignFromRoster} phase={phase} collapsed={!rosterOpen.you} onToggle={() => toggleRoster('you')} bye={byeYou} week={week} />}

        {isMobile && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => toggleRoster('you')} className="mono" style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '8px', borderRadius: 4, background: 'var(--surface)', border: `1px solid ${rosterOpen.you ? 'var(--you)' : 'var(--bd)'}`, color: rosterOpen.you ? 'var(--you)' : 'var(--dim)' }}>{rosterOpen.you ? '▾' : '▸'} YOUR ROSTER</button>
              <button onClick={() => toggleRoster('their')} className="mono" style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '8px', borderRadius: 4, background: 'var(--surface)', border: `1px solid ${rosterOpen.their ? 'var(--opp)' : 'var(--bd)'}`, color: rosterOpen.their ? 'var(--opp)' : 'var(--dim)' }}>{rosterOpen.their ? '▾' : '▸'} THEIR ROSTER</button>
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, marginBottom: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--on-accent)', background: 'var(--you)', borderRadius: 4, padding: '4px 9px' }}>NFL WEEK {week}</span>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>{weekDateRange(week)}</span>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--faint)' }}>2025 SEASON</span>
              </div>
              <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>{headline}</div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4, maxWidth: 520, lineHeight: 1.5 }}>{subhead}</div>
              {phase === 'live' && (
                <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, fontSize: 10, color: 'var(--dim)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', flex: 'none', background: clockMode === 'real' ? 'var(--warn)' : clockMode === 'feed' ? 'var(--you)' : 'var(--faint)' }} />
                  <span style={{ fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>{clockMode === 'real' ? 'REAL CLOCK' : clockMode === 'feed' ? 'REAL FEED' : 'GAME CLOCK'}</span>
                  <span>· {clockMode === 'real' ? 'log order & effects resolve by real time' : clockMode === 'feed' ? 'reveals live; order & effects on game clock' : 'all games lockstep on game time'}</span>
                </div>
              )}
              {pendingApply ? (
                <div className="mono" style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--warn)', background: 'color-mix(in srgb, var(--warn) 12%, var(--surface))', border: '1px solid var(--warn)', borderRadius: 6, padding: '7px 11px' }}>
                  <span>{powerupById(pendingApply)?.icon} Tap a {powerupById(pendingApply)?.target === 'window' ? 'window' : 'spot'} to apply {powerupById(pendingApply)?.name}</span>
                  <button onClick={() => setPendingApply(null)} className="mono" style={{ background: 'none', border: 'none', color: 'var(--dim)', fontWeight: 700, fontSize: 9, letterSpacing: '0.1em' }}>CANCEL</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'nowrap' }}>
                  <button onClick={() => setPuView('active')} className="mono" style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', color: 'var(--you)', background: 'var(--surface)', border: '1px solid var(--you)', borderRadius: 6, padding: '7px 9px' }}>
                    ◈ ACTIVE{activeEffects.length > 0 ? ` · ${activeEffects.length}` : ''}
                  </button>
                  <button onClick={() => setPuView('apply')} className="mono" style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 6, padding: '7px 9px' }}>
                    ✦ APPLY{appliable.length > 0 ? ` · ${appliable.length}` : ''}
                  </button>
                  <button onClick={() => setShopOpen(true)} className="mono" style={{ flex: 1, minWidth: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', whiteSpace: 'nowrap', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 9px' }}>
                    🛒 SHOP
                  </button>
                </div>
              )}
              <TargetPanel aw={aw} oppPicks={oppPicks} preKick={preKickPhase} onClearSpy={() => clearSpy(week)} />
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{phase === 'setup' ? 'SLOTS SET' : 'WEEK ' + week}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{phase === 'setup' ? `${filledCount}/${totalSlots}` : phase.toUpperCase()}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {resolved.windows.map((rw) => (
              <WindowSection
                key={rw.window.id}
                rw={rw}
                week={week}
                phase={phase}
                clock={winClocks[rw.window.id] ?? 0}
                maxClock={winTarget[rw.window.id] ?? GAME_SECONDS}
                wallClock={wallClock}
                realClock={realResolve}
                wallSeconds={(() => {
                  const c = winClocks[rw.window.id] ?? 0;
                  // Real seconds elapsed at the current feed position: direct in
                  // wall modes; in game mode, scale the game position into the
                  // window's real-time span so the wall clock still advances.
                  return wallClock ? c : ((winMax[rw.window.id] ? c / winMax[rw.window.id] : 0) * (winRealMax[rw.window.id] ?? 0));
                })()}
                playing={!!winPlaying[rw.window.id]}
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
          Array.from({ length: slotsFor(swapTarget.win, extraSlots) }, (_, i) => effYouPicks[slotKey(swapTarget.win, i)]?.playerId).filter(Boolean) as string[],
        );
        const bench = (youPools[swapTarget.win] || []).filter((p) => !slottedIds.has(p.id));
        const atClock = winClocks[swapTarget.win] ?? 0;
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
            onMetric={(m) => { applyMetricSwap(week, swapTarget.key, atClock, atRt, m); setSwapTarget(null); }}
            onPlayer={(pid) => { applyPlayerSwap(week, swapTarget.key, atClock, atRt, pid); setSwapTarget(null); }}
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
        const liveOf = (s: typeof b) => banksAtClock(s.events, winClocks[s.win] ?? 0).you;
        const starters = all
          .filter((s) => s.you && s.their)
          .map((s) => ({ key: slotKey(s.win, s.slotIndex), name: s.you!.player.name, score: liveOf(s), win: s.win }));
        return (
          <BackupMenu
            backupName={b.you?.player.name ?? '—'}
            backupScore={liveOf(b)}
            live={phase !== 'final'}
            required={backupMenu.required}
            half={!!b.backupHalfEligible}
            current={backupAssign[backupMenu.key]}
            starters={starters}
            onPick={(target) => { setBackupTarget(week, backupMenu.key, target); setBackupMenu(null); }}
            onClose={() => setBackupMenu(null)}
          />
        );
      })()}

      {pickerSlot && (() => {
        const { key, win } = pickerSlot;
        const n = slotsFor(win, extraSlots);
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
          onPick={(pid) => { applyByeSteal(week, byeStealSlot, pid); setByeStealSlot(null); setPendingApply(null); }}
          onRemove={() => {}}
          onClose={() => { setByeStealSlot(null); setPendingApply(null); }}
        />
      )}

      {spySlot && (
        <SpyRevealModal
          onPick={(reveal) => { setSpy(week, spySlot, reveal); setSpySlot(null); setPendingApply(null); }}
          onClose={() => { setSpySlot(null); setPendingApply(null); }}
        />
      )}

      {mulliganSlot && (() => {
        const slot = resolved.windows.flatMap((w) => w.slots).find((s) => slotKey(s.win, s.slotIndex) === mulliganSlot);
        const p = slot?.you?.player;
        if (!p) return null;
        const atClock = winClocks[slot!.win] ?? 0;
        const atRt = realTimeAt(p, week, atClock, slot!.you!.metricId ?? undefined);
        return (
          <MulliganModal
            player={p} curMetric={slot!.you!.metricId} inventory={inventory}
            onPick={(m) => { applyMulligan(week, mulliganSlot, atClock, atRt, m); setMulliganSlot(null); setPendingApply(null); }}
            onClose={() => { setMulliganSlot(null); setPendingApply(null); }}
          />
        );
      })()}

      {scoutWin && <ScoutModal win={scoutWin} week={week} pool={oppPools[scoutWin] ?? []} oppName={opp.name} onClose={() => setScoutWin(null)} />}

      {puView === 'active' && <ActivePowerupsModal effects={activeEffects} onClose={() => setPuView(null)} />}
      {puView === 'apply' && <ApplyPowerupsModal items={appliable} inventory={inventory} onArm={(id) => armBuff(week, id)} onApply={(id) => { setPendingApply(id); setPuView(null); }} onClose={() => setPuView(null)} />}
      {shopOpen && <ShopModal onClose={() => setShopOpen(false)} />}

      {earnOpen && <EarningsModal earnings={earnings} onReset={() => { resetDripCoin(); setEarnOpen(false); }} onClose={() => setEarnOpen(false)} />}
    </>
  );
}

// ── Drip-coin earning opportunities, by position (risk pays more) ──
function EarningsModal({ earnings, onReset, onClose }: { earnings: { stipend: number; unopposed: number; signature: number; turnover: number; total: number }; onReset: () => void; onClose: () => void }) {
  const order: Pos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const riskColor = (r: string) => (r === 'HIGH' ? 'var(--fx-nuke)' : r === 'MED' ? 'var(--warn)' : 'var(--dim)');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '50px 16px', overflow: 'auto' }}>
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
            {([['Weekly stipend', earnings.stipend], ['Unopposed players', earnings.unopposed], ['Events of note', earnings.signature], ['Turnovers', earnings.turnover]] as [string, number][]).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--dim)', padding: '2px 0' }}>
                <span>{k}</span><span className="mono" style={{ color: v < 0 ? 'var(--opp)' : 'var(--fx-streak)', fontWeight: 700 }}>{v < 0 ? '' : '+'}{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: 'var(--text)', padding: '5px 0 0', marginTop: 4, borderTop: '1px solid var(--bd)' }}>
              <span>Total</span><span className="mono" style={{ color: 'var(--fx-mult)' }}>+{earnings.total}</span>
            </div>
          </div>
          {/* always-on */}
          <div className="mono" style={{ fontSize: 9.5, lineHeight: 1.6, color: 'var(--dim)' }}>
            <div>◈ <b style={{ color: 'var(--text)' }}>+{WEEKLY_STIPEND}</b> flat every week, just for playing.</div>
            <div>◈ <b style={{ color: 'var(--text)' }}>+{UNOPPOSED_COIN}</b> for each unopposed player you field.</div>
            <div style={{ marginTop: 5 }}>Then coin only on <b style={{ color: 'var(--text)' }}>events of note</b> — a nuke / shutdown / wipe, a drip going HOT, or a DST suppress firing. Routine yards, catches and carries don't pay.</div>
            <div style={{ marginTop: 5 }}>◈ <b style={{ color: 'var(--opp)' }}>−10</b> to the opponent for each INT thrown / fumble lost by your players (their giveaways pay you). <b style={{ color: 'var(--text)' }}>🦅 Ball Hawk</b> raises it to 25.</div>
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
          {/* Dev/testing reset: top coin back to the grant and wipe owned + applied powerups. */}
          <button onClick={onReset} title="Reset drip coin to the demo grant and clear all owned + applied powerups" className="mono" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2, padding: '9px 12px', background: 'var(--bg)', border: '1px dashed var(--warn)', borderRadius: 6, color: 'var(--warn)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
            ↻ REFRESH DRIP COIN & CLEAR POWERUPS
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Backup assignment menu (manual best-ball) ──
function BackupMenu({ backupName, backupScore, live, required, half, current, starters, onPick, onClose }: {
  backupName: string; backupScore: number; live: boolean; required?: boolean; half?: boolean; current?: string;
  starters: { key: string; name: string; score: number; win: WindowId }[];
  onPick: (target: string | null) => void; onClose: () => void;
}) {
  const scoreTag = live ? 'so far' : 'final';
  return (
    <div onClick={required ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Backup · {backupName} <span style={{ color: 'var(--warn)' }}>{backupScore.toFixed(1)}</span> <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400 }}>{scoreTag}</span></div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>{half ? 'UNOPPOSED — BANKS HALF UNLESS IT SUBS IN. CHALLENGE A STARTER FOR FULL VALUE.' : (required ? 'UNOPPOSED — BANKS 0 UNLESS IT SUBS IN. CHALLENGE A STARTER, OR TAKE THE 0.' : 'CHALLENGE A STARTER — SUBS IN AT FINAL ONLY IF IT OUTSCORES THEM')}</div>
          </div>
          {!required && <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>}
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflow: 'auto' }}>
          <div className="mono" style={{ fontSize: 9, lineHeight: 1.55, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', marginBottom: 4 }}>
            {half
              ? <><b style={{ color: 'var(--warn)' }}>{backupName} banks half its score</b> if it sits — unopposed slots only pay full when they sub in. Point it at a starter and it'll <b style={{ color: 'var(--text)' }}>replace</b> that starter's score at FINAL, but only if it outscores them. It's a blind bet: numbers below are points {scoreTag}, not finals.</>
              : <><b style={{ color: 'var(--warn)' }}>{backupName} banks 0 on its own</b> — unopposed points don't count. Point it at a starter and it'll <b style={{ color: 'var(--text)' }}>replace</b> that starter's score at FINAL, but only if it outscores them. It's a blind bet: numbers below are points {scoreTag}, not finals.</>}
          </div>
          <button onClick={() => onPick(null)} className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: !current ? 'var(--sh)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', color: 'var(--text)' }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>{half ? `Bank half — ${backupName} doesn't sub` : `Take the 0 — ${backupName} doesn't sub`}</span>
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
    </div>
  );
}

// ── Real-time swap menu (Metric Swap / Player Swap during live) ──
function SwapMenu({ player, metricId, atClock, bench, metricQty, playerQty, onMetric, onPlayer, onClose }: {
  player: Player; metricId: string | null; atClock: number; bench: Player[];
  metricQty: number; playerQty: number; onMetric: (m: string) => void; onPlayer: (pid: string) => void; onClose: () => void;
}) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflow: 'auto' }}>
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
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 7 }}>🔀 METRIC SWAP {metricQty > 0 ? `· ×${metricQty}` : '· NONE OWNED'}</div>
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
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.12em', color: 'var(--faint)', marginBottom: 7 }}>🔁 PLAYER SWAP {playerQty > 0 ? `· ×${playerQty}` : '· NONE OWNED'}</div>
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
    </div>
  );
}

// ── Roster aside ──────────────────────────────────────────────────────────
function RosterAside({ side, pools, picks, onPlayer, phase, sealed, collapsed, onToggle, bye = [], week, fluid }: {
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
      <aside style={{ width: 26, flex: 'none' }} className="hide-narrow">
        <button onClick={onToggle} title={`Show ${side === 'you' ? 'your' : 'their'} roster`} className="mono" style={{ width: 26, height: '100%', minHeight: 120, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '8px 0', background: 'var(--surface)', border: '1px solid var(--bd)', [side === 'you' ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, color: accent, cursor: 'pointer' } as React.CSSProperties}>
          <span style={{ fontSize: 11 }}>{side === 'you' ? '▸' : '◂'}</span>
          <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.18em', writingMode: 'vertical-rl', textOrientation: 'mixed' }}>{side === 'you' ? 'YOUR' : 'THEIR'} ROSTER · {total}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside style={fluid
      ? { width: '100%', flex: 'none', overflow: 'auto', maxHeight: '44vh', display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: 10 }
      : { width: side === 'you' ? 170 : 196, flex: 'none', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }} className={fluid ? undefined : 'hide-narrow'}>
      <button onClick={onToggle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: accent, fontWeight: 700 }}>{side === 'you' ? '◂' : '▸'} {side === 'you' ? 'YOUR' : 'THEIR'} ROSTER</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{total}</span>
      </button>
      {WINDOWS.map((w) => (
        <div key={w.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>{w.label}</span>
            <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{w.time}</span>
          </div>
          {pools[w.id].length === 0 && <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', padding: '0 4px' }}>— none playing —</span>}
          {pools[w.id].map((p) => {
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
function PuShell({ title, subtitle, accent, onClose, children }: { title: string; subtitle: string; accent: string; onClose: () => void; children: ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '44px 16px', overflow: 'auto' }}>
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
    </div>
  );
}

// ACTIVE: everything currently in effect this week, with a back-out where the
// power-up can still be unwound (before its window locks / kicks off).
function ActivePowerupsModal({ effects, onClose }: {
  effects: { key: string; icon: string; name: string; detail: string; onRemove?: () => void }[]; onClose: () => void;
}) {
  return (
    <PuShell title="◈ Active Power-Ups" subtitle="WHAT'S CURRENTLY IN EFFECT — BACK ANY OUT BEFORE IT LOCKS" accent="var(--you)" onClose={onClose}>
      {effects.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', textAlign: 'center', padding: '18px 0', lineHeight: 1.5 }}>— nothing active —<br />arm or apply power-ups from ✦ APPLY</div>}
      {effects.map((e) => (
        <div key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 8px', borderRadius: 5, background: 'color-mix(in srgb, var(--you) 9%, var(--bg))', border: '1px solid color-mix(in srgb, var(--you) 45%, var(--bd))' }}>
          <span style={{ fontSize: 17, flex: 'none', lineHeight: 1.1 }}>{e.icon}</span>
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
  items: { p: Powerup; deadline: string; action: 'arm' | 'apply' | 'hint' }[]; inventory: Record<string, number>;
  onArm: (id: string) => void; onApply: (id: string) => void; onClose: () => void;
}) {
  return (
    <PuShell title="✦ Apply Power-Ups" subtitle="USABLE NOW — APPLY EACH BEFORE ITS WINDOW CLOSES" accent="var(--warn)" onClose={onClose}>
      {items.length === 0 && <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', textAlign: 'center', padding: '18px 0', lineHeight: 1.5 }}>— nothing to apply right now —<br />power-ups appear here while their window is open</div>}
      {items.map(({ p, deadline, action }) => {
        const qty = inventory[p.id] ?? 0;
        return (
          <div key={p.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '7px 8px', borderRadius: 5, background: 'var(--bg)', border: '1px solid var(--bd)' }}>
            <span style={{ fontSize: 17, flex: 'none', lineHeight: 1.1 }}>{p.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{p.name}</span>
                {qty > 0 && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--dim)' }}>×{qty}</span>}
                <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', border: '1px solid color-mix(in srgb, var(--warn) 50%, transparent)', borderRadius: 3, padding: '1px 4px' }}>{deadline}</span>
              </div>
              <div style={{ fontSize: 10, lineHeight: 1.45, color: 'var(--dim)', marginTop: 2 }}>{p.blurb}</div>
              {action === 'hint' && POWERUP_HINT[p.id] && <div className="mono" style={{ fontSize: 8.5, color: 'var(--warn)', marginTop: 3 }}>↳ {POWERUP_HINT[p.id]}</div>}
            </div>
            {action === 'arm' ? (
              <button onClick={() => onArm(p.id)} disabled={qty <= 0} className="mono" style={{ flex: 'none', alignSelf: 'center', fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', borderRadius: 4, padding: '6px 10px', cursor: 'pointer', border: '1px solid var(--you)', color: 'var(--on-accent)', background: 'var(--you)' }}>ARM</button>
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
    <PuShell title="👁️ Spy — Reveal" subtitle="UNCOVER ONE THING ABOUT THE OPPONENT IN THIS SLOT" accent="var(--warn)" onClose={onClose}>
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
    <PuShell title="🎲 Mulligan — Re-roll" subtitle={`PICK A NEW METRIC FOR ${player.name.toUpperCase()} · COUNTS ONLY PLAYS AFTER NOW (REAL TIME)`} accent="var(--warn)" onClose={onClose}>
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
  aw?: { spy?: { slotKey: string; reveal: 'player' | 'metric' } };
  oppPicks: Record<string, Pick>; preKick: boolean; onClearSpy: () => void;
}) {
  if (!aw?.spy) return null;
  const sp = aw.spy;
  const op = oppPicks[sp.slotKey];
  const oppPlayer = op ? getPlayer(op.playerId) : null;
  const [win, idx] = sp.slotKey.split('#');
  const label = `${win.toUpperCase()} #${Number(idx) + 1}`;
  const val = sp.reveal === 'player'
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
function WindowSection(props: {
  rw: ReturnType<typeof buildMatchup>['windows'][number];
  week: number;
  phase: Phase;
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
}) {
  const { rw, week, phase, clock, maxClock, wallClock, realClock, wallSeconds, playing, onTogglePlay, onReplay, canApplyExtra, extraSlotQty, onApplyExtra, onRemoveExtra, onAssignBackup, picks, selSlot, pickMetricFor, onClearSlot, onOpenPicker, openPBP, togglePBP, onAssign, inventory, turnoverCoin, backups, slotName, armed, aw, applyMode, onApplyToSpot, onApplyToWindow, onScout } = props;
  const w = rw.window;
  const setN = rw.slots.filter((s) => picks[slotKey(w.id, s.slotIndex)]?.metricId).length;
  const done = clock >= maxClock;
  const pct = Math.round((Math.min(clock, maxClock) / maxClock) * 100);
  // Live apply-mode: EMP targets the whole live window; Spy/Mulligan target a
  // single spot. Highlight what's eligible and dim the rest.
  const empEligible = applyMode === 'emp' && phase === 'live' && clock > 0 && !done && aw?.emp?.[w.id] == null;
  const spotEligible = (s: typeof rw.slots[number]) => {
    if (applyMode === 'spy') return !!s.their;             // reveal the opponent here
    if (applyMode === 'mulligan') return !!s.you && !done; // re-roll your metric
    if (applyMode === 'metric-swap' || applyMode === 'player-swap') return !!s.you && !done; // swap this live spot
    return false;
  };
  const spotApplyMode = applyMode === 'spy' || applyMode === 'mulligan' || applyMode === 'metric-swap' || applyMode === 'player-swap';
  const [slateOpen, setSlateOpen] = useState(false);
  // The real NFL games feeding this window: map each window player's team to its
  // actual away@home matchup that week, and list the players involved.
  interface SlateGame { away: string; home: string; you: string[]; their: string[] }
  const slate: SlateGame[] = (() => {
    // Seed with every real NFL game in this window — so the chip shows even
    // before anyone is assigned (e.g. a lone TNF game).
    const games = new Map<string, SlateGame>();
    for (const g of gamesInWindow(week, w.id)) {
      games.set(`${g.away}@${g.home}`, { away: g.away, home: g.home, you: [], their: [] });
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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bd)', paddingBottom: 7, marginBottom: 9, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)' }}>{w.label}</span>
          <span style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{w.sub}</span>
          <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--dimstrong)' }}>{windowDateLabel(week, w.id)}</span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{w.time.split(' ').slice(1).join(' ')}</span>
          {slate.length > 0 && (
            <button onClick={() => setSlateOpen((o) => !o)} title="NFL game slate for this window" className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: slateOpen ? 'var(--text)' : 'var(--dim)', background: 'var(--surface)', border: `1px solid ${slateOpen ? 'var(--bdh)' : 'var(--bd)'}`, borderRadius: 11, padding: '3px 8px' }}>
              <span style={{ display: 'flex', gap: 1 }}>{slateTeams.slice(0, 8).map((t) => <Img key={t} src={teamLogo(t)} size={13} radius={2} fallback={<span />} />)}</span>
              SLATE · {slate.length} {slate.length === 1 ? 'GAME' : 'GAMES'} {slateOpen ? '▴' : '▾'}
            </button>
          )}
        </div>

        {phase === 'setup' ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
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
            <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--dim)' }}>{setN}/{rw.slots.length} SET</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* per-window clock */}
            <div style={{ width: 70, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: done ? 'var(--you)' : '#FF4F62', transition: 'width .3s linear' }} />
            </div>
            <span className="mono" title="Wall-clock time of day (ET) at the current feed position" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{fmtTimeOfDay(kickoffSecOfDay(w.time) + wallSeconds)}</span>
            <span className="mono" style={{ fontSize: 8, fontWeight: 700, color: 'var(--faint)', letterSpacing: '0.08em' }}>ET</span>
            {phase === 'live' && (
              done ? (
                <button onClick={onReplay} className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 8px' }}>↺ REPLAY</button>
              ) : (
                <button onClick={onTogglePlay} className="mono" style={{ fontSize: 11, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '3px 9px' }}>{playing ? '❚❚' : '▶'}</button>
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
        <div onClick={() => setSlateOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflow: 'auto' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
              <div>
                <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{w.label} · Game Slate</div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>{slate.length} {slate.length === 1 ? 'GAME' : 'GAMES'} · {windowDateLabel(week, w.id).toUpperCase()} · {w.time.split(' ').slice(1).join(' ').toUpperCase()}</div>
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
                      <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--dim)', flex: 'none', marginLeft: 6 }}>{w.time.split(' ').slice(1).join(' ')}</span>
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
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rw.slots.map((s) => {
          const key = slotKey(w.id, s.slotIndex);
          if (phase === 'setup') {
            return (
              <SetupRow
                key={key} slotKeyStr={key} winId={w.id} week={week} pick={picks[key]} selected={selSlot === key} inventory={inventory} armed={armed}
                appliedPu={[...(aw?.doubleOrNothing === key ? ['double-or-nothing'] : []), ...(aw?.byeSteal?.slotKey === key ? ['bye-steal'] : [])]}
                applyMode={applyMode} onApplyToSpot={() => onApplyToSpot(key)}
                onOpenPicker={() => onOpenPicker(key, w.id)} onPickMetric={(m) => pickMetricFor(key, m)}
                onClearSlot={() => onClearSlot(key)}
                onDropPlayer={(id) => onAssign(id)} onScout={() => onScout(w.id)}
              />
            );
          }
          // Per-side clocks: in wall-clock mode `clock` is the window's real
          // position, mapped back to each player's own game clock; in game mode
          // both sides share it.
          const youClock = wallClock && s.you ? clockAtRealTime(s.you.player, week, clock, s.you.metricId ?? undefined) : clock;
          const theirClock = wallClock && s.their ? clockAtRealTime(s.their.player, week, clock, s.their.metricId ?? undefined) : clock;
          const row = <ScoreRow key={key} slot={s} week={week} youClock={youClock} theirClock={theirClock} open={!!openPBP[key]} onToggle={() => togglePBP(key)} phase={phase} done={done} onAssignBackup={() => onAssignBackup(key)} turnoverCoin={turnoverCoin} backups={backups} slotName={slotName} realClock={realClock} kickoffSec={kickoffSecOfDay(w.time)} />;
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

// ── Setup row ──
function SetupRow(props: {
  slotKeyStr: string; winId: WindowId; week: number; pick?: Pick; selected: boolean; inventory: Record<string, number>; armed: Record<string, boolean>;
  appliedPu: string[];
  applyMode: string | null; onApplyToSpot: () => void;
  onOpenPicker: () => void; onPickMetric: (m: string) => void; onClearSlot: () => void; onDropPlayer: (id: string) => void; onScout: () => void;
}) {
  const { winId, week, pick, selected, inventory, armed, appliedPu, applyMode, onApplyToSpot, onOpenPicker, onPickMetric, onClearSlot, onDropPlayer, onScout } = props;
  const isMobile = useIsMobile();
  const gridCols = '1fr 1fr'; // no center gutter — your spot vs the sealed opponent
  const rowGap = isMobile ? 5 : 8;
  const player = pick ? getPlayer(pick.playerId) : null;
  const metric = player && pick?.metricId ? metricById(player.pos, pick.metricId) : null;
  // Power-ups acting on THIS spot: armed team buffs that apply here, plus any
  // spot-specific applied powerup (Double or Nothing / Bye Steal).
  const spotBuffs = [
    ...(player ? Object.keys(armed).filter((id) => armed[id] && buffAppliesToSpot(id, player.pos, pick?.metricId ?? null)) : []),
    ...appliedPu,
  ];
  const buffChips = spotBuffs.map((id) => { const pu = powerupById(id); return (
    <span key={id} title={pu?.blurb} className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--you)', background: 'color-mix(in srgb, var(--you) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--you) 40%, transparent)', borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>{pu?.icon} {pu?.name}</span>
  ); });
  // Apply mode: a targeted powerup is awaiting a spot. Double or Nothing → a
  // filled spot; Bye Steal → an empty spot.
  const fillEligible = applyMode === 'double-or-nothing' && !!player;
  const emptyEligible = applyMode === 'bye-steal' && !player;
  const applyHi = fillEligible;
  const applyDim = !!applyMode && !fillEligible && !emptyEligible;
  const cardTap = applyMode ? (fillEligible ? onApplyToSpot : () => {}) : onOpenPicker;
  const applyPu = applyMode ? powerupById(applyMode) : null;
  // "Change metric" re-opens the picker for an already-set spot without dropping
  // the player. Reset whenever the slot's player changes (incl. top-down shifts).
  const [editing, setEditing] = useState(false);
  const [infoMetric, setInfoMetric] = useState<Metric | null>(null);
  useEffect(() => { setEditing(false); }, [pick?.playerId]);
  const showPicker = !!player && (!pick?.metricId || editing);
  const link: React.CSSProperties = { background: 'none', border: 'none', padding: 0, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em' };

  return (
    <>
    <div style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'stretch', gap: rowGap }}>
      {player ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          style={{ position: 'relative', minWidth: 0, background: applyHi ? 'color-mix(in srgb, var(--warn) 12%, var(--surface))' : selected ? 'var(--sh)' : 'var(--surface)', border: `1px ${applyHi ? 'dashed var(--warn)' : `solid ${selected ? 'var(--you)' : 'var(--bd)'}`}`, borderLeft: applyHi ? '3px dashed var(--warn)' : '3px solid var(--you)', borderRadius: 4, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 7, opacity: applyDim ? 0.45 : 1 }}
        >
          {applyHi && (
            <div onClick={onApplyToSpot} style={{ position: 'absolute', inset: 0, zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'color-mix(in srgb, var(--warn) 14%, transparent)', borderRadius: 4, cursor: 'pointer' }}>
              <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 4, padding: '5px 9px' }}>{applyPu?.icon} TAP TO APPLY</span>
            </div>
          )}
          {/* Remove the player from this spot — compact red ✕ pinned top-right,
              clear of the metric list below. */}
          {!applyMode && (
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
                <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{player.pos} · {player.team}</span>
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
              <span className="mono" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 7, letterSpacing: '0.12em', color: 'var(--faint)' }}>
                <span style={{ width: 5, height: 5, background: 'var(--you)', borderRadius: '50%', display: 'inline-block', animation: 'bpulse 2s ease infinite' }} /> HIDDEN
              </span>
            </div>
          )}

          {/* metric picker — full card width, stacks cleanly */}
          {showPicker && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {editing && (
                <button onClick={() => setEditing(false)} className="mono" style={{ width: '100%', textAlign: 'center', background: 'none', border: '1px dashed var(--bd)', borderRadius: 3, padding: '3px', fontSize: 8, letterSpacing: '0.1em', color: 'var(--faint)' }}>✕ KEEP {metric?.name?.toUpperCase()}</button>
              )}
              {METRICS[player.pos].filter((m) => !m.lock || (inventory[m.lock] ?? 0) > 0 || m.id === pick?.metricId).map((m) => {
                const cur = m.id === pick?.metricId;
                return (
                  <button key={m.id} onClick={() => { onPickMetric(m.id); setEditing(false); }} style={{ width: '100%', minHeight: 30, textAlign: 'left', background: cur ? 'color-mix(in srgb, var(--you) 14%, var(--bg))' : m.lock ? 'color-mix(in srgb, var(--warn) 12%, var(--bg))' : 'var(--bg)', border: `1px solid ${cur ? 'var(--you)' : m.lock ? 'var(--warn)' : 'var(--bd)'}`, borderRadius: 3, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.lock ? '◈ ' : ''}{m.name}</span>
                    <span role="button" title="What does this metric do?" onClick={(e) => { e.stopPropagation(); setInfoMetric(m); }} className="mono" style={{ flex: 'none', fontSize: 10, fontWeight: 700, color: 'var(--faint)', padding: '0 2px', cursor: 'help' }}>ⓘ info</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* change controls — pinned to the bottom of the spot */}
          {!showPicker && (
            <div style={{ display: 'flex', gap: 14, marginTop: 'auto', paddingTop: 4 }}>
              <button onClick={() => setEditing(true)} className="mono" style={{ ...link, color: 'var(--warn)' }}>↻ METRIC</button>
              <button onClick={onOpenPicker} className="mono" style={{ ...link, color: 'var(--opp)' }}>⇄ PLAYER</button>
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={applyMode ? (emptyEligible ? onApplyToSpot : undefined) : onOpenPicker}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          style={{ minWidth: 0, minHeight: 78, background: emptyEligible ? 'color-mix(in srgb, var(--warn) 12%, transparent)' : selected ? 'var(--surface)' : 'transparent', border: `1px dashed ${emptyEligible ? 'var(--warn)' : selected ? 'var(--you)' : 'var(--bdh)'}`, borderLeft: `3px dashed ${emptyEligible ? 'var(--warn)' : selected ? 'var(--you)' : 'var(--bdh)'}`, borderRadius: 4, padding: '16px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer', opacity: applyDim ? 0.4 : 1 }}
        >
          <span className="grotesk" style={{ fontSize: 20, color: emptyEligible ? 'var(--warn)' : 'var(--faint)' }}>{emptyEligible ? applyPu?.icon : '+'}</span>
          <span className="mono" style={{ fontSize: 10, color: emptyEligible ? 'var(--warn)' : 'var(--faint)', letterSpacing: '0.12em', fontWeight: emptyEligible ? 700 : 400 }}>{emptyEligible ? 'TAP TO FIELD BYE' : 'TAP TO PICK PLAYER'}</span>
        </div>
      )}
      <div onClick={onScout} title="Scout the opponent's possible players for this window" style={{ minWidth: 0, minHeight: 78, background: 'color-mix(in srgb, var(--text) 3%, var(--surface))', border: '1px dashed var(--bdh)', borderRight: '3px dashed var(--bdh)', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' }}>
        <span className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--dim)' }}>◆</span>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--faint)', fontWeight: 700 }}>SEALED · {winId.toUpperCase()}</span>
        <span className="mono" style={{ fontSize: 7.5, letterSpacing: '0.12em', color: 'var(--opp)', fontWeight: 700 }}>🔍 SCOUT</span>
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 75, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '50px 16px', overflow: 'auto' }}>
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
    </div>
  );
}

// ── Player picker (tap a spot in setup) — choose from this window's roster ──
function PlayerPicker({ win, week, players, currentId, title = 'Pick a player', subtitle = 'YOUR PLAYERS WHOSE GAME FALLS IN THIS WINDOW', onPick, onRemove, onClose }: {
  win: WindowId; week: number; players: Player[]; currentId?: string; title?: string; subtitle?: string;
  onPick: (id: string) => void; onRemove: () => void; onClose: () => void;
}) {
  const label = WINDOWS.find((w) => w.id === win)?.label ?? win.toUpperCase();
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>{label} · {title}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>{subtitle}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 440, overflow: 'auto' }}>
          {players.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', padding: '16px 0' }}>— no eligible players in this window —</div>}
          {players.map((p) => {
            const sel = p.id === currentId;
            return (
              <button key={p.id} onClick={() => onPick(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, background: sel ? 'var(--sh)' : 'var(--bg)', border: `1px solid ${sel ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 4, padding: '8px 10px', color: 'var(--text)', textAlign: 'left', cursor: 'pointer' }}>
                <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                    <InjuryBadge week={week} slug={p.id} />
                  </div>
                  <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p.pos} · {p.team}</span>
                </div>
                {sel && <span className="mono" style={{ fontSize: 8, color: 'var(--you)', flex: 'none' }}>CURRENT ✓</span>}
              </button>
            );
          })}
        </div>
        {currentId && (
          <div style={{ padding: '0 12px 12px' }}>
            <button onClick={onRemove} className="mono" style={{ width: '100%', background: 'var(--bg)', border: '1px dashed var(--opp)', borderRadius: 4, padding: '8px', color: 'var(--opp)', fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>✕ REMOVE FROM SPOT</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scout (tap a sealed opponent spot) — the candidate pool only ──
// Lists every opponent player whose game falls in this window: who they COULD
// field here. The actual pick stays sealed — the full pool is shown (no
// removal of slotted players), so nothing leaks by commission or omission.
function ScoutModal({ win, week, pool, oppName, onClose }: {
  win: WindowId; week: number; pool: Player[]; oppName: string; onClose: () => void;
}) {
  const label = WINDOWS.find((w) => w.id === win)?.label ?? win.toUpperCase();
  const posOrder: Pos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const sorted = [...pool].sort((a, b) => (posOrder.indexOf(a.pos) - posOrder.indexOf(b.pos)) || a.name.localeCompare(b.name));
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, borderTop: '3px solid var(--opp)', boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>🔍 Scout · {label}</div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>WHO {oppName.toUpperCase()} COULD FIELD HERE — PICK STAYS SEALED</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 440, overflow: 'auto' }}>
          {sorted.length === 0 && <div className="mono" style={{ fontSize: 10, color: 'var(--faint)', textAlign: 'center', padding: '16px 0' }}>— no opponent players in this window —</div>}
          {sorted.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px' }}>
              <PlayerImg playerId={p.id} team={p.team} pos={p.pos} size={34} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{p.name}</span>
                  <InjuryBadge week={week} slug={p.id} />
                </div>
                <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p.pos} · {p.team}</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '0 12px 12px' }}>
          <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', textAlign: 'center', lineHeight: 1.5 }}>
            ◆ {sorted.length} candidate{sorted.length === 1 ? '' : 's'} · any could be in any of {oppName}'s {label} spots
          </div>
        </div>
      </div>
    </div>
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
        ⚖️ DOUBLE OR NOTHING {stake === 'won' ? 'WON ×2' : 'LOST → 0'}
      </span>,
    );
  }
  if (!items.length) return null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3, justifyContent: side === 'you' ? 'flex-start' : 'flex-end' }}>{items}</div>;
}

// ── Score row (live / final) ──
function ScoreRow({ slot, week, youClock, theirClock, open, onToggle, phase, done, onAssignBackup, turnoverCoin, backups, slotName, realClock, kickoffSec }: {
  slot: ReturnType<typeof buildMatchup>['windows'][number]['slots'][number];
  week: number; youClock: number; theirClock: number; open: boolean; onToggle: () => void; phase: Phase; done: boolean;
  onAssignBackup: () => void; turnoverCoin: number;
  backups: Record<string, string>; slotName: Record<string, string>;
  realClock: boolean; kickoffSec: number;
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
    const halfCredit = !!slot.backupHalf;            // banked half (2+ unopposed, didn't sub)
    const halfEligible = !!slot.backupHalfEligible;  // side has 2+ unopposed → half-credit applies
    const wouldBe = slot.backupScore ?? 0;           // full would-be score
    const mineFinal = mineBackup ? slot.youFinal : slot.theirFinal; // what actually counted
    // Live: running full points. Final: the half it banked, else its would-be
    // (shown struck when benched, plain when it subbed in).
    const liveBackup = !done ? (mineBackup ? live.you : live.their) : halfCredit ? mineFinal : wouldBe;
    const bEvents = slot.events.filter((e) => e.clock <= bclock);
    const chip = canSub ? (mineBackup ? 'BACKUP' : 'OPP BACKUP') : (mineBackup ? 'UNOPPOSED' : 'OPP UNOPP');
    const showSuppress = isSuppress && (done || phase === 'final') ? (suppressSpent ?? undefined) : undefined;
    const card = (
      <ScoreCard
        side={mineBackup ? 'you' : 'their'} player={be.player} week={week} clock={bclock} metricId={be.metricId}
        metricName={bp?.name ?? ''} tag={bp?.tag ?? ''} bank={liveBackup} onClick={onToggle}
        chip={chip} suppressSpent={showSuppress} coin={slotCoin(slot, mineBackup ? 'you' : 'their', week, turnoverCoin, bclock)}
        negated={canSub && isFinal && !subbedIn && !halfCredit ? true : undefined}
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
        {/* Make the unopposed rule explicit: sub in for full value, else bank half
            (when 2+ unopposed) or 0 (a lone unopposed slot). */}
        {canSub && mineBackup && (() => {
          let txt: string; let col: string;
          if (isFinal) {
            if (subbedIn) { txt = '✓ subbed in — full points counted'; col = 'var(--you)'; }
            else if (halfCredit) { txt = `½ unopposed credit — banked ${mineFinal.toFixed(1)} of ${wouldBe.toFixed(1)}`; col = 'var(--warn)'; }
            else { txt = '✕ scored 0 — did not sub in'; col = 'var(--fx-stop)'; }
          } else {
            const tgt = backups[ownKey] && slotName[backups[ownKey]];
            txt = tgt
              ? `subs into ${tgt} at final if it wins${halfEligible ? ', else banks half' : ''}`
              : (halfEligible ? 'banks half unless you sub it in for a starter' : 'banks 0 unless you sub it in for a starter');
            col = 'var(--warn)';
          }
          return <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.03em', color: col, textAlign: 'center', marginTop: 4 }}>{txt}</div>;
        })()}
        {(phase === 'final' || done) && <BuffFxRow side={mineBackup ? 'you' : 'their'} fx={mineBackup ? slot.youBuffFx : slot.theirBuffFx} />}
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
    if (phase === 'final' && sub) return sub.score;
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

  const youCard = <ScoreCard side="you" player={slot.you.player} week={week} clock={youClock} metricId={slot.you.metricId} metricName={yMet?.name ?? ''} tag={yMet?.tag ?? ''} bank={youShown} onClick={onToggle} fx={lastEffect?.type} subName={phase === 'final' ? slot.youSub?.name : undefined} suppressSpent={final ? slot.suppressSpentYou : undefined} negated={final ? slot.youNegated : undefined} halvedFrom={final ? slot.youHalvedFrom : undefined} coin={slotCoin(slot, 'you', week, turnoverCoin, youClock)} />;
  const theirCard = <ScoreCard side="their" player={slot.their.player} week={week} clock={theirClock} metricId={slot.their.metricId} metricName={tMet?.name ?? ''} tag={tMet?.tag ?? ''} bank={theirShown} onClick={onToggle} fx={lastEffect?.type} subName={phase === 'final' ? slot.theirSub?.name : undefined} suppressSpent={final ? slot.suppressSpentTheir : undefined} negated={final ? slot.theirNegated : undefined} halvedFrom={final ? slot.theirHalvedFrom : undefined} coin={slotCoin(slot, 'their', week, turnoverCoin, theirClock)} />;
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
      {incomingName && !(phase === 'final' && slot.youSub) && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', marginTop: 3 }}>
          🛟 backup {incomingName} on standby{final ? ' — did not sub in' : ''}
        </div>
      )}
      {phase === 'final' && slot.youSub && (
        <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', marginTop: 3 }}>
          ⤴ BACKUP {slot.youSub.name} subs in for {slot.you.player.name} · {slot.youSub.from.toFixed(1)} → {slot.youSub.score.toFixed(1)}
        </div>
      )}
      {phase === 'final' && slot.theirSub && (
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
  return '—';
}

function ScoreCard({ side, player, week, clock, metricId, metricName, tag, bank, onClick, fx, subName, suppressSpent, negated, halvedFrom, chip, coin }: {
  side: 'you' | 'their'; player: Player; week: number; clock: number; metricId?: string; metricName: string; tag: string; bank: number; onClick: () => void; fx?: string; subName?: string; suppressSpent?: number; negated?: boolean; halvedFrom?: number; chip?: string; coin?: number;
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const isMobile = useIsMobile();
  const { bigText } = useStore();
  const fs = (n: number) => bigText ? Math.round(n * 1.3 * 10) / 10 : n; // larger-text mode bumps the small card labels
  const nuked = fx === 'nuke' && bank === 0 && !subName && suppressSpent == null;
  const stat = useMemo(() => fmtStat(player.pos, statlineAt(player, week, clock, metricId), isMobile), [player, week, clock, metricId, isMobile]);
  const edge = side === 'you' ? 'left' : 'right';
  const nameRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: side === 'you' ? 'row' : 'row-reverse' }}>
      <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
      {chip && <span className="mono" style={{ fontSize: fs(7.5), fontWeight: 700, letterSpacing: '0.1em', color: accent, border: `1px solid ${accent}`, borderRadius: 3, padding: '1px 4px', flex: 'none' }}>{chip}</span>}
      <InjuryBadge week={week} slug={player.id} />
      {!isMobile && <span className="mono" style={{ fontSize: fs(8), color: 'var(--faint)' }}>{player.team}</span>}
    </div>
  );
  // The player's REAL NFL game this week + its real game clock (quarter +
  // countdown, HALF / FINAL) — shown under the name on each card.
  const g = nflGameForTeam(week, player.team);
  const gameLine = g ? (
    <div className="mono" title="real NFL game · real game clock" style={{ display: 'flex', alignItems: 'center', gap: 5, flexDirection: side === 'you' ? 'row' : 'row-reverse', fontSize: fs(8.5), letterSpacing: '0.02em', marginTop: 2 }}>
      <Img src={teamLogo(g.away)} size={12} radius={2} fallback={<span />} />
      <span style={{ fontWeight: 700, color: 'var(--dimstrong)' }}>{g.away}@{g.home}</span>
      <Img src={teamLogo(g.home)} size={12} radius={2} fallback={<span />} />
      <span style={{ color: 'var(--faint)' }}>·</span>
      <span style={{ color: 'var(--faint)', fontWeight: 700 }}>{fmtGameClock(clock)}</span>
    </div>
  ) : null;
  // On mobile the chip is anchored to two lines (name over tag) so it's always
  // the same height regardless of label length; desktop keeps it inline.
  const metricChip = (
    <div style={{ display: 'inline-flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? (side === 'you' ? 'flex-end' : 'flex-start') : 'baseline', maxWidth: '100%', gap: isMobile ? 0 : 5, marginTop: isMobile ? 2 : 0, padding: isMobile ? '2px 7px' : '3px 8px', borderRadius: 4, background: `color-mix(in srgb, ${accent} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)` }}>
      <span className="grotesk" style={{ fontSize: isMobile ? 10.5 : 13, fontWeight: 700, color: accent, letterSpacing: '0.01em', lineHeight: 1.25, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{metricName}</span>
      <span className="mono" style={{ fontSize: fs(7), fontWeight: 700, letterSpacing: '0.1em', color: accent, opacity: 0.85, whiteSpace: 'nowrap', lineHeight: 1.25 }}>{tag}</span>
    </div>
  );
  // Statline: single line, justified to the card's outer edge, ellipsis if long.
  const statLine = suppressSpent != null
    ? <div className="mono" style={{ fontSize: fs(9), color: 'var(--fx-stop)', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: edge }}>✕ {suppressSpent.toFixed(1)} spent on SUPPRESS</div>
    : subName
      ? <div className="mono" style={{ fontSize: fs(9.5), color: accent, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: edge }}>⤴ {subName} scoring</div>
      : <div className="mono" style={{ fontSize: fs(9.5), color: 'var(--dimstrong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: edge }}>{stat}</div>;
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
  const [detail, setDetail] = useState<PbpEvent | null>(null); // a play tapped for its PBP details
  const fs = (n: number) => bigText ? Math.round(n * 1.35 * 10) / 10 : n; // font size
  const fw = (n: number) => bigText ? Math.round(n * 1.35) : n;            // fixed widths/heights
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
    <span className="mono" style={{ width: fw(34), flex: 'none', textAlign: mine ? 'left' : 'right', fontSize: fs(9), fontWeight: 700, color: ev.side === (mine ? 'you' : 'their') ? (mine ? 'var(--you)' : 'var(--opp)') : 'var(--faint)', opacity: 0.85 }}>
      {(mine ? ev.youBank : ev.theirBank).toFixed(1)}
    </span>
  );
  const cell = (ev: PbpEvent, mine: boolean) => {
    if (ev.side !== (mine ? 'you' : 'their')) return <div style={{ flex: 1 }} />;
    return (
      <div style={{ flex: 1, minWidth: 0, textAlign: mine ? 'right' : 'left', opacity: ev.drip ? 0.62 : 1 }}>
        <div style={{ fontSize: fs(10.5), lineHeight: 1.35, color: 'var(--text)' }}>
          {actionText(ev.play)}
          {ev.delta > 0 && <span className="mono" style={{ fontSize: fs(9.5), fontWeight: 700, color: mine ? 'var(--you)' : 'var(--opp)', marginLeft: 5 }}>+{ev.delta.toFixed(1)}</span>}
          {ev.mult && <span className="mono" style={{ fontSize: fs(8.5), fontWeight: 700, color: 'var(--fx-mult)', marginLeft: 4 }}>×{ev.mult.toFixed(2)}</span>}
          {ev.coin && (ev.coinAmt ?? (mine ? youCoin : theirCoin)) > 0 && <CoinPill amt={ev.coinAmt ?? (mine ? youCoin : theirCoin)} />}
        </div>
        {ev.effect && (
          <div className="mono" style={{ fontSize: fs(8), fontWeight: 700, letterSpacing: '0.08em', color: FX_COLOR[ev.effect.type] ?? 'var(--dim)', marginTop: 1 }}>{ev.effect.text}</div>
        )}
        {ev.buffNote && (
          <div className="mono" style={{ fontSize: fs(8), fontWeight: 700, letterSpacing: '0.08em', color: 'var(--warn)', marginTop: 1 }}>⚡ {ev.buffNote}</div>
        )}
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
      <div ref={scroller} onScroll={onScroll} style={{ maxHeight: fw(210), overflow: 'auto', paddingRight: 10, scrollbarGutter: 'stable', scrollbarWidth: 'thin' }}>
        {rows.length === 0 && (
          <div className="mono" style={{ fontSize: fs(9), color: 'var(--faint)', letterSpacing: '0.1em', textAlign: 'center', padding: '14px 0' }}>— no plays yet at this point —</div>
        )}
        {rows.map((ev, i) => (
          <div key={i} onClick={() => setDetail(ev)} title="tap for play details" style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0', borderTop: i === 0 ? undefined : '1px solid color-mix(in srgb, var(--bd) 45%, transparent)', animation: i === newestIdx ? 'slidein .3s ease' : undefined, cursor: 'pointer' }}>
            {cum(ev, true)}
            {cell(ev, true)}
            <div className="mono" title="game clock · real wall-clock time" style={{ width: fw(50), flex: 'none', textAlign: 'center', paddingTop: 1, lineHeight: 1.15 }}>
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
  sack: 'Sack', int: 'Interception', fumrec: 'Fumble recovery', dst_td: 'Defensive TD', safety: 'Safety',
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
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflow: 'auto' }}>
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
    </div>
  );
}
