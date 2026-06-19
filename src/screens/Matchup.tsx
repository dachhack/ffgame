import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from '../app/store';
import type { Phase } from '../app/store';
import { Brand, ThemeSwitcher, PlayerImg, Avatar, Img, InjuryBadge, fonts } from '../app/ui';
import { avatarUrl, teamLogo } from '../data/media';
import { nflGameForTeam, gamesInWindow, windowDateLabel, weekDateRange } from '../data/nflSlate';
import { WINDOWS, METRICS, metricById } from '../data/metrics';
import { POWERUPS, powerupById } from '../data/powerups';
import { getTeam, getPlayer, gameForTeam } from '../data/league';
import {
  windowPools, defaultLineup, slotKey, buildMatchup, banksAtClock, weekEarnings, metricCoin, coinRisk, WEEKLY_STIPEND, UNOPPOSED_COIN, slotsFor, totalSlotsWith, byePlayers,
} from '../engine/matchup';
import { fmtClock, statlineAt, GAME_SECONDS, type StatLine } from '../engine/sim';
import { REAL_WEEKS, loadRealWeek, isRealWeekLoaded } from '../data/realPbp';
import type { Pick, Player, Pos, WindowId, PbpEvent } from '../types';

const YOU = 'happy-campers';
const TICK_MS = 700;
const TICK_SECONDS = 20;

export function Matchup({ week, initialPhase }: { week: number; initialPhase: Phase }) {
  const { navigate, coins, creditWeek, inventory, useConsumable, applied, applyExtraSlot, applyMetricSwap, applyPlayerSwap, setBackupTarget, armBuff, setDoubleOrNothing, setSpy, applyByeSteal, applyMulligan, applyEmp } = useStore();
  const buffs = applied[week]?.buffs ?? {};
  const buffsKey = JSON.stringify(buffs);
  const extraSlots = applied[week]?.extraSlots ?? {};
  const swaps = applied[week]?.swaps ?? {};
  const backupAssign = applied[week]?.backups ?? {};
  const aw = applied[week];
  const extras = { doubleOrNothing: aw?.doubleOrNothing, byeSteal: aw?.byeSteal, emp: aw?.emp };
  const extrasKey = JSON.stringify(extras);
  const byes = useMemo(() => byePlayers(YOU, week), [week]);
  const oppId = gameForTeam(YOU, week)?.oppId ?? 'rock-tunnel';
  const you = getTeam(YOU)!;
  const opp = getTeam(oppId)!;

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [selSlot, setSelSlot] = useState<string | null>(null);
  // Per-window playback: each window runs its own clock + play/pause.
  const [winClocks, setWinClocks] = useState<Record<string, number>>({});
  const [winPlaying, setWinPlaying] = useState<Record<string, boolean>>({});
  const [openPBP, setOpenPBP] = useState<Record<string, boolean>>({});
  const [swapTarget, setSwapTarget] = useState<{ key: string; win: WindowId } | null>(null);
  const [backupMenu, setBackupMenu] = useState<{ key: string } | null>(null);
  // Rosters expand in setup (you need them to set lineups), collapse otherwise.
  const [rosterOpen, setRosterOpen] = useState<{ you: boolean; their: boolean }>(() => ({ you: initialPhase === 'setup', their: initialPhase === 'setup' }));
  const toggleRoster = (side: 'you' | 'their') => setRosterOpen((o) => ({ ...o, [side]: !o[side] }));

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
    () => buildMatchup(YOU, oppId, week, effYouPicks, oppPicks, extraSlots, swaps, backupAssign, buffs, extras),
    [oppId, week, effYouPicks, oppPicks, ready, extraKey, swapsKey, backupsKey, buffsKey, extrasKey],
  );

  // Drip coin: weekly stipend + unopposed bounty + events of note + turnover swing.
  const earnings = useMemo(() => weekEarnings(resolved, 'you', week, buffs['turnover-boost'] ? 25 : 10), [resolved, week, buffsKey]); // eslint-disable-line react-hooks/exhaustive-deps
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

  // On entering live/final, seed each window's clock + play state.
  useEffect(() => {
    if (phase === 'setup') return;
    const clocks: Record<string, number> = {};
    const playing: Record<string, boolean> = {};
    for (const id of Object.keys(winMax)) {
      clocks[id] = phase === 'final' ? winMax[id] : 0;
      playing[id] = false; // live starts paused — hit ▶ per window or RUN ALL
    }
    setWinClocks(clocks);
    setWinPlaying(playing);
  }, [phase, winMax]);

  // Single ticker advances every playing window toward its own max.
  useEffect(() => {
    if (phase !== 'live') return;
    const id = setInterval(() => {
      setWinClocks((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const wid of Object.keys(winMax)) {
          if (winPlaying[wid] && (prev[wid] ?? 0) < winMax[wid]) {
            next[wid] = Math.min(winMax[wid], (prev[wid] ?? 0) + TICK_SECONDS);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, winPlaying, winMax]);

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
        const active = phase === 'live' && c > 0 && c < (winMax[id] ?? Infinity);
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
        const b = banksAtClock(s.events, c);
        // A suppress DST's earn shows in its log but banks 0 (spent on halving).
        y += s.suppressSpentYou != null ? 0 : b.you;
        t += s.suppressSpentTheir != null ? 0 : b.their;
      }
    }
    for (const b of resolved.bonuses ?? []) y += b.points; // armed-buff payouts
    return { youTotal: Math.round(y * 10) / 10, themTotal: Math.round(t * 10) / 10 };
  }, [resolved, winClocks, phase]);

  const filledCount = Object.values(picks).filter((p) => p.metricId).length;
  const totalSlots = totalSlotsWith(extraSlots);
  const anyPlaying = Object.values(winPlaying).some(Boolean);
  const extraSlotQty = inventory['extra-slot'] ?? 0;
  const canSwap = phase === 'live' && ((inventory['metric-swap'] ?? 0) > 0 || (inventory['player-swap'] ?? 0) > 0);

  // ── setup interactions ──
  function assignFromRoster(playerId: string) {
    if (phase !== 'setup') return;
    const win = playerWindow.get(playerId);
    if (!win) return;
    const nSlots = slotsFor(win, extraSlots);
    for (let i = 0; i < nSlots; i++) {
      const k = slotKey(win, i);
      if (picks[k]?.playerId === playerId) { setSelSlot(k); return; }
    }
    let target: string | null = null;
    if (selSlot && selSlot.startsWith(win + '#') && !picks[selSlot]) target = selSlot;
    if (!target) {
      for (let i = 0; i < nSlots; i++) {
        const k = slotKey(win, i);
        if (!picks[k]) { target = k; break; }
      }
    }
    if (!target) target = slotKey(win, 0);
    setPicks((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) if (next[k].playerId === playerId) delete next[k];
      next[target!] = { playerId, metricId: null };
      return next;
    });
    setSelSlot(target);
  }

  function pickMetricFor(key: string, metricId: string) {
    const pk = picks[key];
    const player = pk ? getPlayer(pk.playerId) : null;
    const m = player ? metricById(player.pos, metricId) : null;
    // A locked (unlock) metric consumes one of its powerup the first time it's set.
    if (m?.lock && pk?.metricId !== metricId && !useConsumable(m.lock)) return;
    setPicks((prev) => prev[key] ? { ...prev, [key]: { ...prev[key], metricId } } : prev);
    setSelSlot(null);
  }
  function clearSlot(key: string) {
    setPicks((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setSelSlot(key);
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
      <header style={{ height: 60, flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px', position: 'sticky', top: 0, zIndex: 40, gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap' }}>
          <button onClick={() => setEarnOpen(true)} title="Drip Coin — tap for earning opportunities" className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 9px', cursor: 'pointer' }}>
            <span style={{ color: 'var(--fx-mult)', fontSize: 12 }}>◈</span>
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
                <div className="mono" style={{ fontSize: 16, fontWeight: 600, color: 'var(--warn)' }}>47:12:00</div>
              </div>
              <button onClick={lockIn} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--bg)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4, boxShadow: '0 0 20px color-mix(in srgb, var(--you) 30%, transparent)' }}>
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
            </div>
          )}
          {phase === 'final' && (
            <button onClick={() => navigate({ name: 'final', week })} className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--bg)', background: 'var(--you)', border: 'none', padding: '9px 14px', borderRadius: 4 }}>
              WEEK RESULT →
            </button>
          )}
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', gap: 14, padding: 14, overflow: 'hidden', minHeight: 0 }}>
        <RosterAside side="you" pools={youPools} picks={picks} onPlayer={assignFromRoster} phase={phase} collapsed={!rosterOpen.you} onToggle={() => toggleRoster('you')} bye={byeYou} week={week} />

        <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, marginBottom: 10 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5, flexWrap: 'wrap' }}>
                <span className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--bg)', background: 'var(--you)', borderRadius: 4, padding: '4px 9px' }}>NFL WEEK {week}</span>
                <span className="mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)' }}>{weekDateRange(week)}</span>
                <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--faint)' }}>2025 SEASON</span>
              </div>
              <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>{headline}</div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4, maxWidth: 520, lineHeight: 1.5 }}>{subhead}</div>
              <BuffStrip phase={phase} inventory={inventory} armed={buffs} bonuses={resolved.bonuses} onArm={(id) => armBuff(week, id)} />
              <TargetPanel
                phase={phase} week={week} inventory={inventory} aw={aw} windows={resolved.windows} oppPicks={oppPicks}
                byes={byes} winClocks={winClocks}
                onStake={(k) => setDoubleOrNothing(week, k)} onSpy={(k) => setSpy(week, k)} onByeSteal={(k, pid) => applyByeSteal(week, k, pid)}
                onMulligan={(k, c, m) => applyMulligan(week, k, c, m)} onEmp={(w, c) => applyEmp(week, w, c)}
              />
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
                maxClock={winMax[rw.window.id] ?? GAME_SECONDS}
                playing={!!winPlaying[rw.window.id]}
                onTogglePlay={() => setWinPlay(rw.window.id, !winPlaying[rw.window.id])}
                onReplay={() => replayWin(rw.window.id)}
                canApplyExtra={phase === 'setup' && extraSlotQty > 0}
                extraSlotQty={extraSlotQty}
                onApplyExtra={() => applyExtraSlot(week, rw.window.id)}
                canSwap={canSwap}
                onPowerup={(key) => setSwapTarget({ key, win: rw.window.id })}
                onAssignBackup={(key) => setBackupMenu({ key })}
                picks={picks}
                selSlot={selSlot}
                setSelSlot={setSelSlot}
                pickMetricFor={pickMetricFor}
                clearSlot={clearSlot}
                openPBP={openPBP}
                togglePBP={(k) => setOpenPBP((o) => ({ ...o, [k]: !o[k] }))}
                youPools={youPools}
                inventory={inventory}
                onAssign={assignFromRoster}
              />
            ))}
          </div>
          <div style={{ height: 40 }} />
        </main>

        <RosterAside side="their" pools={oppPools} picks={oppPicks} phase={phase} sealed={phase === 'setup'} collapsed={!rosterOpen.their} onToggle={() => toggleRoster('their')} bye={byeTheir} week={week} />
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
        return (
          <SwapMenu
            player={curPlayer}
            metricId={cur!.metricId}
            atClock={atClock}
            bench={bench}
            metricQty={inventory['metric-swap'] ?? 0}
            playerQty={inventory['player-swap'] ?? 0}
            onMetric={(m) => { applyMetricSwap(week, swapTarget.key, atClock, m); setSwapTarget(null); }}
            onPlayer={(pid) => { applyPlayerSwap(week, swapTarget.key, atClock, pid); setSwapTarget(null); }}
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
            current={backupAssign[backupMenu.key]}
            starters={starters}
            onPick={(target) => { setBackupTarget(week, backupMenu.key, target); setBackupMenu(null); }}
            onClose={() => setBackupMenu(null)}
          />
        );
      })()}

      {earnOpen && <EarningsModal earnings={earnings} onClose={() => setEarnOpen(false)} />}
    </>
  );
}

// ── Drip-coin earning opportunities, by position (risk pays more) ──
function EarningsModal({ earnings, onClose }: { earnings: { stipend: number; unopposed: number; signature: number; turnover: number; total: number }; onClose: () => void }) {
  const order: Pos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const riskColor = (r: string) => (r === 'HIGH' ? 'var(--fx-nuke)' : r === 'MED' ? 'var(--warn)' : 'var(--dim)');
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '50px 16px', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}><span style={{ color: 'var(--fx-mult)' }}>◈</span> Drip Coin — Earning</div>
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
            <div style={{ marginTop: 5 }}>◈ <b style={{ color: 'var(--opp)' }}>−10</b> to the opponent for each INT thrown / fumble lost by your players (their giveaways pay you). <span style={{ color: 'var(--faint)' }}>Awaiting per-player turnover data from Stathead.</span></div>
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
        </div>
      </div>
    </div>
  );
}

// ── Backup assignment menu (manual best-ball) ──
function BackupMenu({ backupName, backupScore, live, current, starters, onPick, onClose }: {
  backupName: string; backupScore: number; live: boolean; current?: string;
  starters: { key: string; name: string; score: number; win: WindowId }[];
  onPick: (target: string | null) => void; onClose: () => void;
}) {
  const scoreTag = live ? 'so far' : 'final';
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '60px 16px', overflow: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 8, boxShadow: '0 24px 70px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '14px 16px', borderBottom: '1px solid var(--bd)' }}>
          <div>
            <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Backup · {backupName} <span style={{ color: 'var(--warn)' }}>{backupScore.toFixed(1)}</span> <span className="mono" style={{ fontSize: 8, color: 'var(--faint)', fontWeight: 400 }}>{scoreTag}</span></div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>CHALLENGE A STARTER — SUBS IN AT FINAL ONLY IF IT OUTSCORES THEM</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 18 }}>✕</button>
        </div>
        <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflow: 'auto' }}>
          <div className="mono" style={{ fontSize: 9, lineHeight: 1.55, color: 'var(--dim)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', marginBottom: 4 }}>
            It's a blind bet — you won't know final scores yet. Numbers below are points {scoreTag}. Pick the starter you think {backupName} will beat; the swap only happens at FINAL if it actually does.
          </div>
          <button onClick={() => onPick(null)} className="mono" style={{ display: 'flex', justifyContent: 'space-between', gap: 8, background: !current ? 'var(--sh)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px', color: 'var(--text)' }}>
            <span style={{ fontSize: 11, fontWeight: 700 }}>Keep on bench — don't sub</span>
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
            <div className="mono" style={{ fontSize: 9, color: 'var(--dim)', marginTop: 3, letterSpacing: '0.06em' }}>APPLIES FROM {fmtClock(atClock)} · NOT RETROACTIVE</div>
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
function RosterAside({ side, pools, picks, onPlayer, phase, sealed, collapsed, onToggle, bye = [], week }: {
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
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const assignedIds = new Set(Object.values(picks).map((p) => p.playerId));
  const total = (Object.values(pools) as Player[][]).reduce((n, a) => n + a.length, 0);

  if (collapsed) {
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
    <aside style={{ width: side === 'you' ? 170 : 196, flex: 'none', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }} className="hide-narrow">
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

// Apply-by-target powerups (Double or Nothing, Spy, Bye Steal, Mulligan, EMP):
// a compact panel of selectors, shown in the phase where each is usable.
function TargetPanel(props: {
  phase: Phase; week: number; inventory: Record<string, number>;
  aw?: { doubleOrNothing?: string; spy?: string; byeSteal?: { slotKey: string; playerId: string }; emp?: Partial<Record<WindowId, number>> };
  windows: ReturnType<typeof buildMatchup>['windows']; oppPicks: Record<string, Pick>; byes: Player[]; winClocks: Record<string, number>;
  onStake: (k: string) => void; onSpy: (k: string) => void; onByeSteal: (k: string, pid: string) => void;
  onMulligan: (k: string, atClock: number, m: string) => void; onEmp: (w: WindowId, clock: number) => void;
}) {
  const { phase, inventory, aw, windows, oppPicks, byes, winClocks, onStake, onSpy, onByeSteal, onMulligan, onEmp } = props;
  const [byePid, setByePid] = useState(''); const [byeKey, setByeKey] = useState('');
  const [mulKey, setMulKey] = useState(''); const [mulMet, setMulMet] = useState('');
  const flat = windows.flatMap((w) => w.slots);
  const has = (id: string) => (inventory[id] ?? 0) > 0;
  const yourH2H = flat.filter((s) => s.you && s.their).map((s) => ({ key: slotKey(s.win, s.slotIndex), name: s.you!.player.name, win: s.win, pos: s.you!.player.pos }));
  const oppSlots = flat.filter((s) => s.their).map((s) => ({ key: slotKey(s.win, s.slotIndex), name: s.their!.player.name, win: s.win }));
  const emptySlots = flat.filter((s) => !s.you).map((s) => ({ key: slotKey(s.win, s.slotIndex), win: s.win }));
  const rows: ReactNode[] = [];
  const Row = (label: string, body: ReactNode) => (
    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', minWidth: 96 }}>{label}</span>
      {body}
    </div>
  );
  const sel: React.CSSProperties = { background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--bd)', borderRadius: 4, fontSize: 10, padding: '4px 6px', fontFamily: fonts.MONO };
  const btn: React.CSSProperties = { background: 'var(--surface)', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 4, fontSize: 9, fontWeight: 700, padding: '4px 8px' };

  if (phase === 'setup') {
    if (aw?.doubleOrNothing) rows.push(Row('⚖️ Double/Nothing', <span className="mono" style={{ fontSize: 9.5, color: 'var(--you)' }}>staked {yourH2H.find((s) => s.key === aw.doubleOrNothing)?.name ?? '—'}</span>));
    else if (has('double-or-nothing')) rows.push(Row('⚖️ Double/Nothing', <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{yourH2H.map((s) => <button key={s.key} style={btn} onClick={() => onStake(s.key)}>{s.name}</button>)}</div>));
    if (aw?.spy) { const m = metricById(getPlayer(oppPicks[aw.spy]?.playerId ?? '')?.pos ?? 'WR', oppPicks[aw.spy]?.metricId); rows.push(Row('👁️ Spy', <span className="mono" style={{ fontSize: 9.5, color: 'var(--opp)' }}>{oppSlots.find((s) => s.key === aw.spy)?.name ?? '—'} runs {m?.name ?? '—'}</span>)); }
    else if (has('spy')) rows.push(Row('👁️ Spy', <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{oppSlots.map((s) => <button key={s.key} style={btn} onClick={() => onSpy(s.key)}>{s.win.toUpperCase()} {s.name}</button>)}</div>));
    if (aw?.byeSteal) rows.push(Row('🪂 Bye Steal', <span className="mono" style={{ fontSize: 9.5, color: 'var(--you)' }}>fielded {getPlayer(aw.byeSteal.playerId)?.name ?? '—'}</span>));
    else if (has('bye-steal') && byes.length > 0 && emptySlots.length > 0) rows.push(Row('🪂 Bye Steal', <>
      <select style={sel} value={byePid} onChange={(e) => setByePid(e.target.value)}><option value="">player…</option>{byes.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.pos})</option>)}</select>
      <select style={sel} value={byeKey} onChange={(e) => setByeKey(e.target.value)}><option value="">slot…</option>{emptySlots.map((s) => <option key={s.key} value={s.key}>{s.win.toUpperCase()} open</option>)}</select>
      <button style={btn} disabled={!byePid || !byeKey} onClick={() => { onByeSteal(byeKey, byePid); setByePid(''); setByeKey(''); }}>FIELD</button>
    </>));
  }
  if (phase === 'live') {
    if (has('emp')) rows.push(Row('💥 EMP', <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{WINDOWS.map((w) => {
      const fired = aw?.emp?.[w.id] != null;
      return <button key={w.id} style={{ ...btn, opacity: fired ? 0.5 : 1 }} disabled={fired} onClick={() => onEmp(w.id, winClocks[w.id] ?? 0)}>{w.label}{fired ? ' ✓' : ''}</button>;
    })}</div>));
    if (has('mulligan')) { const slot = yourH2H.find((s) => s.key === mulKey); rows.push(Row('🎲 Mulligan', <>
      <select style={sel} value={mulKey} onChange={(e) => { setMulKey(e.target.value); setMulMet(''); }}><option value="">slot…</option>{yourH2H.map((s) => <option key={s.key} value={s.key}>{s.win.toUpperCase()} {s.name}</option>)}</select>
      <select style={sel} value={mulMet} onChange={(e) => setMulMet(e.target.value)} disabled={!slot}><option value="">metric…</option>{slot && METRICS[slot.pos].filter((m) => !m.lock || (inventory[m.lock] ?? 0) > 0).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <button style={btn} disabled={!mulKey || !mulMet} onClick={() => { onMulligan(mulKey, winClocks[slot!.win] ?? 0, mulMet); setMulKey(''); setMulMet(''); }}>RE-ROLL</button>
    </>)); }
  }
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 11px' }}>
      <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)' }}>POWER-UPS</span>
      {rows}
    </div>
  );
}

function BuffStrip({ phase, inventory, armed, bonuses, onArm }: {
  phase: Phase; inventory: Record<string, number>; armed: Record<string, true | boolean>;
  bonuses?: { id: string; label: string; points: number }[]; onArm: (id: string) => void;
}) {
  const armable = phase === 'setup' ? TEAM_BUFFS.filter((p) => (inventory[p.id] ?? 0) > 0 && !armed[p.id]) : [];
  // Show armed team buffs plus any bonus that paid out (e.g. Double or Nothing,
  // which isn't a one-click buff but still produces a result chip).
  const armedIds = Object.keys(armed).filter((id) => armed[id] && powerupById(id));
  const showIds = [...new Set([...armedIds, ...(bonuses ?? []).map((b) => b.id).filter((id) => powerupById(id))])];
  if (!armable.length && !showIds.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {armable.map((p) => (
        <button key={p.id} onClick={() => onArm(p.id)} title={p.blurb} className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.05em', color: 'var(--warn)', background: 'var(--surface)', border: '1px dashed var(--warn)', borderRadius: 4, padding: '5px 9px' }}>
          {p.icon} ARM {p.name.toUpperCase()}
        </button>
      ))}
      {showIds.map((id) => {
        const pu = powerupById(id)!;
        const hit = bonuses?.find((b) => b.id === id);
        const c = hit ? (hit.points < 0 ? 'var(--opp)' : 'var(--fx-streak)') : 'var(--warn)';
        const sign = hit ? (hit.points < 0 ? '' : '+') : '';
        return (
          <span key={id} className="mono" title={pu.blurb} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', color: c, background: 'var(--surface)', border: `1px solid ${c}`, borderRadius: 4, padding: '5px 9px' }}>
            {pu.icon} {hit ? `${hit.label.toUpperCase()} ${sign}${hit.points}` : `${pu.name.toUpperCase()} ARMED`}
          </span>
        );
      })}
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
  playing: boolean;
  onTogglePlay: () => void;
  onReplay: () => void;
  canApplyExtra: boolean;
  extraSlotQty: number;
  onApplyExtra: () => void;
  canSwap: boolean;
  onPowerup: (key: string) => void;
  onAssignBackup: (key: string) => void;
  picks: Record<string, Pick>;
  selSlot: string | null;
  setSelSlot: (k: string | null) => void;
  pickMetricFor: (k: string, m: string) => void;
  clearSlot: (k: string) => void;
  openPBP: Record<string, boolean>;
  togglePBP: (k: string) => void;
  youPools: Record<WindowId, Player[]>;
  inventory: Record<string, number>;
  onAssign: (id: string) => void;
}) {
  const { rw, week, phase, clock, maxClock, playing, onTogglePlay, onReplay, canApplyExtra, extraSlotQty, onApplyExtra, canSwap, onPowerup, onAssignBackup, picks, selSlot, setSelSlot, pickMetricFor, clearSlot, openPBP, togglePBP, onAssign, inventory } = props;
  const w = rw.window;
  const setN = rw.slots.filter((s) => picks[slotKey(w.id, s.slotIndex)]?.metricId).length;
  const done = clock >= maxClock;
  const pct = Math.round((Math.min(clock, maxClock) / maxClock) * 100);
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
            <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--dim)' }}>{setN}/{rw.slots.length} SET</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            {/* per-window clock */}
            <div style={{ width: 70, height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: done ? 'var(--you)' : '#FF4F62', transition: 'width .3s linear' }} />
            </div>
            <span className="mono" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{fmtClock(Math.min(clock, maxClock))}</span>
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>/ {fmtClock(maxClock)}</span>
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
                key={key} slotKeyStr={key} winId={w.id} week={week} pick={picks[key]} selected={selSlot === key} inventory={inventory}
                onSelect={() => setSelSlot(key)} onPickMetric={(m) => pickMetricFor(key, m)} onClear={() => clearSlot(key)}
                onDropPlayer={(id) => onAssign(id)}
              />
            );
          }
          return (
            <ScoreRow key={key} slot={s} week={week} clock={clock} open={!!openPBP[key]} onToggle={() => togglePBP(key)} phase={phase} done={done} canSwap={canSwap && !!s.you} onPowerup={() => onPowerup(key)} onAssignBackup={() => onAssignBackup(key)} />
          );
        })}
      </div>
    </div>
  );
}

// ── Setup row ──
function SetupRow(props: {
  slotKeyStr: string; winId: WindowId; week: number; pick?: Pick; selected: boolean; inventory: Record<string, number>;
  onSelect: () => void; onPickMetric: (m: string) => void; onClear: () => void; onDropPlayer: (id: string) => void;
}) {
  const { winId, week, pick, selected, inventory, onSelect, onPickMetric, onClear, onDropPlayer } = props;
  const player = pick ? getPlayer(pick.playerId) : null;
  const metric = player && pick?.metricId ? metricById(player.pos, pick.metricId) : null;
  const showPicker = !!player && !pick?.metricId;

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
      {player ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          style={{ flex: 1, minWidth: 0, minHeight: showPicker ? 92 : 80, background: selected ? 'var(--sh)' : 'var(--surface)', border: `1px solid ${selected ? 'var(--you)' : 'var(--bd)'}`, borderLeft: '3px solid var(--you)', borderRadius: 4, padding: '8px 10px', display: 'flex', gap: 11, alignItems: 'stretch' }}
        >
          {/* Big player picture — fills the slot height once a metric is sealed. */}
          <div onClick={onSelect} style={{ cursor: 'pointer', flex: 'none', display: 'flex', alignItems: showPicker ? 'flex-start' : 'center' }}>
            <PlayerImg playerId={player.id} team={player.team} pos={player.pos} size={showPicker ? 46 : 64} />
          </div>
          <div onClick={onSelect} style={{ cursor: 'pointer', minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className="grotesk" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{player.name}</span>
              <InjuryBadge week={week} slug={player.id} />
            </div>
            <span className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 2 }}>{player.pos} · {player.team}</span>
            {!showPicker && <button onClick={onClear} className="mono" style={{ background: 'none', border: 'none', fontSize: 8, letterSpacing: '0.14em', color: 'var(--opp)', padding: 0, marginTop: 5, textAlign: 'left' }}>CHANGE ✕</button>}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, alignItems: 'flex-end', justifyContent: 'center' }}>
            {showPicker ? (
              METRICS[player.pos].filter((m) => !m.lock || (inventory[m.lock] ?? 0) > 0).map((m) => (
                <button key={m.id} title={m.ef} onClick={() => onPickMetric(m.id)} style={{ width: '100%', textAlign: 'left', background: m.lock ? 'color-mix(in srgb, var(--warn) 12%, var(--bg))' : 'var(--bg)', border: `1px solid ${m.lock ? 'var(--warn)' : 'var(--bd)'}`, borderRadius: 3, padding: '4px 7px', display: 'flex', justifyContent: 'space-between', gap: 6, color: 'var(--text)' }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{m.lock ? '◈ ' : ''}{m.name}</span>
                  <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{m.sc}</span>
                </button>
              ))
            ) : (
              <div onClick={onSelect} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', textAlign: 'right' }}>{metric?.name}</span>
                <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 7, letterSpacing: '0.14em', color: 'var(--faint)' }}>
                  <span style={{ width: 5, height: 5, background: 'var(--you)', borderRadius: '50%', display: 'inline-block', animation: 'bpulse 2s ease infinite' }} />
                  HIDDEN
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div
          onClick={onSelect}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          style={{ flex: 1, minHeight: 78, background: selected ? 'var(--surface)' : 'transparent', border: `1px dashed ${selected ? 'var(--you)' : 'var(--bdh)'}`, borderLeft: `3px dashed ${selected ? 'var(--you)' : 'var(--bdh)'}`, borderRadius: 4, padding: '16px 14px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: 'pointer' }}
        >
          <span className="grotesk" style={{ fontSize: 20, color: 'var(--faint)' }}>+</span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.12em' }}>DRAG / TAP PLAYER</span>
        </div>
      )}
      <div style={{ width: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="mono" style={{ fontSize: 10, color: 'var(--faint)', letterSpacing: '0.14em' }}>VS</span>
      </div>
      <div style={{ flex: 1, minHeight: 78, background: 'color-mix(in srgb, var(--text) 3%, var(--surface))', border: '1px dashed var(--bdh)', borderRight: '3px dashed var(--bdh)', borderRadius: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
        <span className="grotesk" style={{ fontSize: 17, fontWeight: 700, color: 'var(--dim)' }}>◆</span>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.16em', color: 'var(--faint)', fontWeight: 700 }}>SEALED · {winId.toUpperCase()}</span>
      </div>
    </div>
  );
}

// Metrics that bank no direct points (their value is purely an effect) — so an
// unopposed player on one of these can never sub in as a best-ball backup.
const ZERO_BANK_METRICS = new Set(['QB:fg', 'K:neg', 'DEF:suppress']);

// ── Score row (live / final) ──
function ScoreRow({ slot, week, clock, open, onToggle, phase, done, canSwap, onPowerup, onAssignBackup }: {
  slot: ReturnType<typeof buildMatchup>['windows'][number]['slots'][number];
  week: number; clock: number; open: boolean; onToggle: () => void; phase: Phase; done: boolean;
  canSwap: boolean; onPowerup: () => void; onAssignBackup: () => void;
}) {
  // Unopposed slot: render like a head-to-head row but with a blank box on the
  // empty side. The present player is a best-ball backup — all the directions
  // live in its own card. A player whose metric banks no points can't ever sub,
  // so it isn't offered the backup option.
  if (slot.backup && (slot.you || slot.their)) {
    const mineBackup = !!slot.you;                 // your backup vs opponent's
    const be = (slot.you ?? slot.their)!;
    const bp = metricById(be.player.pos, be.metricId);
    const accent = mineBackup ? 'var(--warn)' : 'var(--opp)';
    const canSub = !ZERO_BANK_METRICS.has(`${be.player.pos}:${be.metricId}`);
    // A suppress DST is unopposed but not a useless backup — its earn score is a
    // field-wide halving threshold. Show that earn crossed out.
    const suppressSpent = mineBackup ? slot.suppressSpentYou : slot.suppressSpentTheir;
    const isSuppress = suppressSpent != null;
    // Accrue live with this player's own game clock; lock to the exact final
    // once its game ends. Best-ball subbing only resolves in the Final view.
    const live = banksAtClock(slot.events, clock);
    const liveBackup = done ? (slot.backupScore ?? 0) : (mineBackup ? live.you : live.their);
    const resolved = phase === 'final';
    const status = canSub ? (resolved ? (slot.backupUsed ? '✓ SUBBED IN' : 'NOT USED') : '● LIVE') : '';
    const bEvents = slot.events.filter((e) => e.clock <= clock);
    const align: 'left' | 'right' = mineBackup ? 'left' : 'right';
    const badge = canSub ? (mineBackup ? 'BACKUP' : 'OPP BACKUP') : (mineBackup ? 'UNOPPOSED' : 'OPP UNOPP');
    const directions = isSuppress
      ? `Banks 0 itself — its ${(suppressSpent ?? 0).toFixed(1)} earn halves every opposing slot (any window) scoring at or below it.`
      : !canSub
        ? `${bp?.name} banks no direct points, so it can't sub for a starter.`
        : mineBackup
          ? 'Unopposed — best-ball backup. Assign a starter to challenge; it subs in at FINAL only if it outscores them.'
          : 'Unopposed — their best-ball backup.';

    // Mirror the head-to-head ScoreCard exactly so the score column lines up:
    // big headshot, content, then the score as a separate far-edge item.
    const playerCard = (
      <div style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: `1px dashed ${accent}`, [mineBackup ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, padding: '9px 11px', display: 'flex', flexDirection: mineBackup ? 'row' : 'row-reverse', gap: 11, alignItems: 'center' } as React.CSSProperties}>
        <PlayerImg playerId={be.player.id} team={be.player.team} pos={be.player.pos} size={64} />
        <div style={{ flex: 1, minWidth: 0, textAlign: align }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexDirection: mineBackup ? 'row' : 'row-reverse' }}>
            <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{be.player.name}</span>
            <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.1em', color: accent, border: `1px solid ${accent}`, borderRadius: 3, padding: '1px 4px', flex: 'none' }}>{badge}</span>
            <InjuryBadge week={week} slug={be.player.id} />
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, marginTop: 5, padding: '3px 8px', borderRadius: 4, background: `color-mix(in srgb, ${accent} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)` }}>
            <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: accent, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>{bp?.name}</span>
            <span className="mono" style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.1em', color: accent, opacity: 0.85, whiteSpace: 'nowrap' }}>{bp?.tag}</span>
          </div>
          <div className="mono" style={{ fontSize: 8.5, color: 'var(--dimstrong)', marginTop: 4, textAlign: align, lineHeight: 1.5 }}>{directions}</div>
          {(status || (canSub && mineBackup)) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 7, flexDirection: mineBackup ? 'row' : 'row-reverse' }}>
              {status && <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: resolved && slot.backupUsed ? 'var(--you)' : 'var(--faint)' }}>{status}</span>}
              {canSub && mineBackup && (
                <button onClick={onAssignBackup} title="Choose which starter this backup challenges" className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--warn)', background: 'var(--surface)', border: '1px solid var(--warn)', borderRadius: 4, padding: '4px 8px' }}>ASSIGN ▾</button>
              )}
            </div>
          )}
        </div>
        <div style={{ flex: 'none', alignSelf: 'center', textAlign: 'center' }}>
          {isSuppress ? (
            // Earn accrues live; it's only spent (crossed out) once the game ends.
            (done || phase === 'final') ? (
              <>
                <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, color: 'var(--dim)', lineHeight: 1, textDecoration: 'line-through' }}>{(suppressSpent ?? 0).toFixed(1)}</div>
                <div className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--fx-stop)', marginTop: 3 }}>SUPPRESS</div>
              </>
            ) : (
              <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, color: 'var(--dim)', lineHeight: 1, letterSpacing: '-0.02em' }}>{liveBackup.toFixed(1)}</div>
            )
          ) : (
            <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, color: accent, lineHeight: 1, letterSpacing: '-0.02em' }}>{liveBackup.toFixed(1)}</div>
          )}
        </div>
      </div>
    );
    const blankBox = (
      <div style={{ flex: 1, minHeight: 78, background: 'color-mix(in srgb, var(--text) 3%, var(--surface))', border: '1px dashed var(--bd)', borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)' }}>— NO OPPONENT —</span>
      </div>
    );

    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
          {mineBackup ? playerCard : blankBox}
          {/* center column — same 64px as head-to-head, with the LOG toggle */}
          <div style={{ width: 64, flex: '0 0 64px', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--faint)', border: '1px solid var(--bd)', borderRadius: 3, padding: '3px 5px' }}>UNOPP</span>
            {slot.events.length > 0 && (
              <button onClick={onToggle} className="mono" style={{ background: 'none', border: 'none', fontSize: 7, letterSpacing: '0.1em', color: 'var(--faint)', padding: 0 }}>{open ? 'HIDE ▲' : 'LOG ▾'}</button>
            )}
          </div>
          {mineBackup ? blankBox : playerCard}
        </div>
        {open && (
          <TwoColLog events={bEvents} youName={mineBackup ? be.player.name : '—'} theirName={mineBackup ? '—' : be.player.name} gameLabel={slot.gameLabel} />
        )}
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
  const banks = banksAtClock(slot.events, clock);
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
  const lead = youShown - theirShown;
  const verdict = final
    ? (lead > 0.1 ? { t: 'WON', c: 'var(--you)' } : lead < -0.1 ? { t: 'LOST', c: 'var(--opp)' } : { t: 'TIE', c: 'var(--dim)' })
    : (lead > 2 ? { t: 'EDGE YOU', c: 'var(--you)' } : lead < -2 ? { t: 'EDGE THEM', c: 'var(--opp)' } : Math.abs(lead) > 0.1 ? { t: 'CLOSE', c: 'var(--warn)' } : { t: 'EVEN', c: 'var(--dim)' });

  const visibleEvents = slot.events.filter((e) => e.clock <= clock);
  const lastEffect = [...visibleEvents].reverse().find((e) => e.effect)?.effect;
  const yMet = metricById(slot.you.player.pos, slot.you.metricId);
  const tMet = metricById(slot.their.player.pos, slot.their.metricId);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
        <ScoreCard side="you" player={slot.you.player} week={week} clock={clock} metricName={yMet?.name ?? ''} tag={yMet?.tag ?? ''} bank={youShown} onClick={onToggle} fx={lastEffect?.type} subName={phase === 'final' ? slot.youSub?.name : undefined} suppressSpent={final ? slot.suppressSpentYou : undefined} negated={final ? slot.youNegated : undefined} halvedFrom={final ? slot.youHalvedFrom : undefined} />
        <div style={{ width: 64, flex: '0 0 64px', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--bg)', background: verdict.c, padding: '4px 6px', borderRadius: 3, textAlign: 'center', lineHeight: 1.1 }}>{verdict.t}</span>
          {canSwap && !done && (
            <button onClick={onPowerup} title="Apply a real-time powerup (Metric / Player Swap)" className="mono" style={{ color: 'var(--bg)', background: 'var(--warn)', border: 'none', borderRadius: 4, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', padding: '5px 7px', boxShadow: '0 0 12px color-mix(in srgb, var(--warn) 55%, transparent)', animation: 'bpulse 1.5s ease infinite' }}>⚡ USE</button>
          )}
          {slot.events.length > 0 && (
            <button onClick={onToggle} className="mono" style={{ background: 'none', border: 'none', fontSize: 7, letterSpacing: '0.1em', color: 'var(--faint)', padding: 0 }}>{open ? 'HIDE ▲' : 'LOG ▾'}</button>
          )}
        </div>
        <ScoreCard side="their" player={slot.their.player} week={week} clock={clock} metricName={tMet?.name ?? ''} tag={tMet?.tag ?? ''} bank={theirShown} onClick={onToggle} fx={lastEffect?.type} subName={phase === 'final' ? slot.theirSub?.name : undefined} suppressSpent={final ? slot.suppressSpentTheir : undefined} negated={final ? slot.theirNegated : undefined} halvedFrom={final ? slot.theirHalvedFrom : undefined} />
      </div>
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
      {open && <TwoColLog events={visibleEvents} youName={slot.you.player.name} theirName={slot.their.player.name} gameLabel={slot.gameLabel} />}
    </div>
  );
}

function fmtStat(pos: Pos, s: StatLine): string {
  if (pos === 'QB') {
    const p = [`${s.passYds} pass yd`, `${s.passTds} TD`];
    if (s.rushYds) p.push(`${s.rushYds} rush`);
    return p.join(' · ');
  }
  if (pos === 'RB') {
    const p = [`${s.carries} car`, `${s.rushYds} yd`];
    if (s.rec) p.push(`${s.rec} rec`);
    const td = s.rushTds + s.recTds; if (td) p.push(`${td} TD`);
    return p.join(' · ');
  }
  if (pos === 'WR' || pos === 'TE') {
    const p = [`${s.rec}/${s.targets} rec`, `${s.recYds} yd`];
    if (s.recTds) p.push(`${s.recTds} TD`);
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

function ScoreCard({ side, player, week, clock, metricName, tag, bank, onClick, fx, subName, suppressSpent, negated, halvedFrom }: {
  side: 'you' | 'their'; player: Player; week: number; clock: number; metricName: string; tag: string; bank: number; onClick: () => void; fx?: string; subName?: string; suppressSpent?: number; negated?: boolean; halvedFrom?: number;
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const nuked = fx === 'nuke' && bank === 0 && !subName && suppressSpent == null;
  const stat = useMemo(() => fmtStat(player.pos, statlineAt(player, week, clock)), [player, week, clock]);
  return (
    <div onClick={onClick} style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--bd)', [side === 'you' ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, padding: '9px 11px', display: 'flex', flexDirection: side === 'you' ? 'row' : 'row-reverse', gap: 11, alignItems: 'center', cursor: 'pointer', animation: nuked ? 'flash 1.4s ease-out' : undefined } as React.CSSProperties}>
      {/* Big headshot — same size as the sealed setup slot, kept through live & final. */}
      <PlayerImg playerId={player.id} team={player.team} pos={player.pos} size={64} />
      <div style={{ flex: 1, minWidth: 0, textAlign: side === 'you' ? 'left' : 'right' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: side === 'you' ? 'row' : 'row-reverse' }}>
          <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
          <InjuryBadge week={week} slug={player.id} />
          <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{player.team}</span>
        </div>
        {/* The chosen metric — the key strategic call — made prominent. */}
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, marginTop: 5, padding: '3px 8px', borderRadius: 4, background: `color-mix(in srgb, ${accent} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)` }}>
          <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: accent, letterSpacing: '0.01em', whiteSpace: 'nowrap' }}>{metricName}</span>
          <span className="mono" style={{ fontSize: 7, fontWeight: 700, letterSpacing: '0.1em', color: accent, opacity: 0.85, whiteSpace: 'nowrap' }}>{tag}</span>
        </div>
        {/* running statline (or the backup that's scoring this slot) */}
        {suppressSpent != null
          ? <div className="mono" style={{ fontSize: 9, color: 'var(--fx-stop)', marginTop: 5, fontWeight: 700 }}>✕ {suppressSpent.toFixed(1)} spent on SUPPRESS</div>
          : subName
            ? <div className="mono" style={{ fontSize: 9.5, color: accent, marginTop: 5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>⤴ {subName} scoring</div>
            : <div className="mono" style={{ fontSize: 9.5, color: 'var(--dimstrong)', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat}</div>}
      </div>
      <div style={{ flex: 'none', alignSelf: 'center', textAlign: 'center' }}>
        {suppressSpent != null ? (
          // DEF on Suppress: show the earn points it forwent, struck through.
          <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, color: 'var(--dim)', lineHeight: 1, textDecoration: 'line-through' }}>{suppressSpent.toFixed(1)}</div>
        ) : halvedFrom != null ? (
          // Halved by an opposing Suppress DST: show the cut right in the total.
          <>
            <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--faint)', lineHeight: 1, textDecoration: 'line-through' }}>{halvedFrom.toFixed(1)}</div>
            <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, color: 'var(--fx-stop)', lineHeight: 1, letterSpacing: '-0.02em', marginTop: 2 }}>{bank.toFixed(1)}</div>
            <div className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--fx-stop)', marginTop: 3 }}>÷2 SUPPRESSED</div>
          </>
        ) : (
          <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, color: negated ? 'var(--fx-nuke)' : accent, lineHeight: 1, letterSpacing: '-0.02em', textDecoration: negated ? 'line-through' : undefined, animation: nuked ? 'shake .5s' : undefined }}>{bank.toFixed(1)}</div>
        )}
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
function TwoColLog({ events, youName, theirName, gameLabel }: { events: PbpEvent[]; youName: string; theirName: string; gameLabel: string }) {
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
    <span className="mono" style={{ width: 34, flex: 'none', textAlign: mine ? 'left' : 'right', fontSize: 9, fontWeight: 700, color: ev.side === (mine ? 'you' : 'their') ? (mine ? 'var(--you)' : 'var(--opp)') : 'var(--faint)', opacity: 0.85 }}>
      {(mine ? ev.youBank : ev.theirBank).toFixed(1)}
    </span>
  );
  const cell = (ev: PbpEvent, mine: boolean) => {
    if (ev.side !== (mine ? 'you' : 'their')) return <div style={{ flex: 1 }} />;
    return (
      <div style={{ flex: 1, minWidth: 0, textAlign: mine ? 'right' : 'left', opacity: ev.drip ? 0.62 : 1 }}>
        <div style={{ fontSize: 10.5, lineHeight: 1.35, color: 'var(--text)' }}>
          {actionText(ev.play)}
          {ev.delta > 0 && <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: mine ? 'var(--you)' : 'var(--opp)', marginLeft: 5 }}>+{ev.delta.toFixed(1)}</span>}
          {ev.mult && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--fx-mult)', marginLeft: 4 }}>×{ev.mult.toFixed(2)}</span>}
        </div>
        {ev.effect && (
          <div className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: FX_COLOR[ev.effect.type] ?? 'var(--dim)', marginTop: 1 }}>{ev.effect.text}</div>
        )}
      </div>
    );
  };
  const toggle = (on: boolean, label: string, onClick: () => void) => (
    <button onClick={onClick} className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.06em', color: on ? 'var(--you)' : 'var(--faint)', background: 'var(--surface)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 3, padding: '2px 6px' }}>{label}</button>
  );
  return (
    <div style={{ marginTop: 5, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="mono" style={{ flex: 1, textAlign: 'right', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{youName}</span>
        <div style={{ display: 'flex', gap: 4, flex: 'none' }}>
          {toggle(minutes, minutes ? 'MINUTES' : 'PLAYS', () => setMinutes((m) => !m))}
          {toggle(top, top ? 'NEWest ↑' : 'NEWest ↓', () => setTop((t) => !t))}
        </div>
        <span className="mono" style={{ flex: 1, textAlign: 'left', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--opp)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{theirName}</span>
      </div>
      <div ref={scroller} onScroll={onScroll} style={{ maxHeight: 210, overflow: 'auto', paddingRight: 10, scrollbarGutter: 'stable', scrollbarWidth: 'thin' }}>
        {rows.length === 0 && (
          <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.1em', textAlign: 'center', padding: '14px 0' }}>— no plays yet at this point —</div>
        )}
        {rows.map((ev, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, padding: '3px 0', borderTop: i === 0 ? undefined : '1px solid color-mix(in srgb, var(--bd) 45%, transparent)', animation: i === newestIdx ? 'slidein .3s ease' : undefined }}>
            {cum(ev, true)}
            {cell(ev, true)}
            <span className="mono" style={{ width: 42, flex: 'none', textAlign: 'center', fontSize: 8.5, color: 'var(--faint)', paddingTop: 1 }}>{fmtClock(ev.clock)}</span>
            {cell(ev, false)}
            {cum(ev, false)}
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 7.5, color: 'var(--faint)', letterSpacing: '0.12em', marginTop: 6, textAlign: 'center' }}>cumulative totals on the edges · {minutes ? 'minute-by-minute drip' : 'plays'} · {gameLabel}</div>
    </div>
  );
}
