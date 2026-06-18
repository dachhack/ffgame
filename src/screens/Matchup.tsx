import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../app/store';
import type { Phase } from '../app/store';
import { Brand, ThemeSwitcher, PosPill } from '../app/ui';
import { WINDOWS, METRICS, metricById } from '../data/metrics';
import { getTeam, getPlayer, gameForTeam } from '../data/league';
import {
  windowPools, defaultLineup, slotKey, buildMatchup, banksAtClock, signatureCoins, slotsFor, totalSlotsWith,
} from '../engine/matchup';
import { fmtClock, statlineAt, GAME_SECONDS, type StatLine } from '../engine/sim';
import { REAL_WEEKS, loadRealWeek, isRealWeekLoaded } from '../data/realPbp';
import type { Pick, Player, Pos, WindowId, PbpEvent } from '../types';

const YOU = 'happy-campers';
const TICK_MS = 700;
const TICK_SECONDS = 20;

export function Matchup({ week, initialPhase }: { week: number; initialPhase: Phase }) {
  const { navigate, coins, creditWeek, inventory, applied, applyExtraSlot } = useStore();
  const extraSlots = applied[week]?.extraSlots ?? {};
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

  const playerWindow = useMemo(() => {
    const m = new Map<string, WindowId>();
    (Object.keys(youPools) as WindowId[]).forEach((w) => youPools[w].forEach((p) => m.set(p.id, w)));
    return m;
  }, [youPools]);

  const effYouPicks = useMemo<Record<string, Pick>>(() => {
    if (phase === 'setup') return picks;
    return { ...youDefault, ...picks };
  }, [phase, picks, youDefault]);

  const resolved = useMemo(
    () => buildMatchup(YOU, oppId, week, effYouPicks, oppPicks, extraSlots),
    [oppId, week, effYouPicks, oppPicks, ready, extraKey],
  );

  // Drip coin: +5 per signature play your lineup makes this week (credited once).
  const weekCoins = useMemo(() => signatureCoins(resolved, 'you'), [resolved]);
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
      playing[id] = phase === 'live';
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
        y += b.you; t += b.their;
      }
    }
    return { youTotal: Math.round(y * 10) / 10, themTotal: Math.round(t * 10) / 10 };
  }, [resolved, winClocks, phase]);

  const filledCount = Object.values(picks).filter((p) => p.metricId).length;
  const totalSlots = totalSlotsWith(extraSlots);
  const anyPlaying = Object.values(winPlaying).some(Boolean);
  const extraSlotQty = inventory['extra-slot'] ?? 0;

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
    setPicks((prev) => prev[key] ? { ...prev, [key]: { ...prev[key], metricId } } : prev);
    setSelSlot(null);
  }
  function clearSlot(key: string) {
    setPicks((prev) => { const n = { ...prev }; delete n[key]; return n; });
    setSelSlot(key);
  }

  function lockIn() { setPhase('live'); setSelSlot(null); }
  function changePhase(p: Phase) { setPhase(p); setSelSlot(null); }
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
          <div title={`Drip Coin — +5 per signature play your lineup makes${weekCoins > 0 ? ` (+${weekCoins} this week)` : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 9px' }}>
            <span style={{ color: 'var(--fx-mult)', fontSize: 12 }}>◈</span>
            <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{coins}</span>
            {weekCoins > 0 && <span className="mono" style={{ fontSize: 8.5, color: 'var(--fx-streak)' }}>+{weekCoins}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ color: 'var(--you)', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em' }}>YOU</span>
            <span className="mono" style={{ color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>{youTotal.toFixed(1)}</span>
            <span className="mono" style={{ color: 'var(--faint)', fontSize: 9 }}>VS</span>
            <span className="mono" style={{ color: 'var(--opp)', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em' }}>{opp.name.slice(0, 14).toUpperCase()}</span>
            <span className="mono" style={{ color: 'var(--text)', fontSize: 14, fontWeight: 700 }}>{themTotal.toFixed(1)}</span>
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
        <RosterAside side="you" pools={youPools} picks={picks} onPlayer={assignFromRoster} phase={phase} />

        <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, marginBottom: 10 }}>
            <div>
              <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>{headline}</div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4, maxWidth: 520, lineHeight: 1.5 }}>{subhead}</div>
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
                picks={picks}
                selSlot={selSlot}
                setSelSlot={setSelSlot}
                pickMetricFor={pickMetricFor}
                clearSlot={clearSlot}
                openPBP={openPBP}
                togglePBP={(k) => setOpenPBP((o) => ({ ...o, [k]: !o[k] }))}
                youPools={youPools}
                onAssign={assignFromRoster}
              />
            ))}
          </div>
          <div style={{ height: 40 }} />
        </main>

        <RosterAside side="their" pools={oppPools} picks={oppPicks} phase={phase} sealed={phase === 'setup'} />
      </div>
    </>
  );
}

// ── Roster aside ──────────────────────────────────────────────────────────
function RosterAside({ side, pools, picks, onPlayer, phase, sealed }: {
  side: 'you' | 'their';
  pools: Record<WindowId, Player[]>;
  picks: Record<string, Pick>;
  onPlayer?: (id: string) => void;
  phase: Phase;
  sealed?: boolean;
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const assignedIds = new Set(Object.values(picks).map((p) => p.playerId));
  const total = (Object.values(pools) as Player[][]).reduce((n, a) => n + a.length, 0);
  return (
    <aside style={{ width: side === 'you' ? 170 : 196, flex: 'none', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }} className="hide-narrow">
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
        <span className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', color: accent, fontWeight: 700 }}>▼ {side === 'you' ? 'YOUR' : 'THEIR'} ROSTER</span>
        <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{total}</span>
      </div>
      {WINDOWS.map((w) => (
        <div key={w.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
            <span className="mono" style={{ fontSize: 8.5, letterSpacing: '0.1em', color: 'var(--dim)', fontWeight: 700 }}>{w.label}</span>
            <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{w.time}</span>
          </div>
          {pools[w.id].map((p) => {
            const assigned = assignedIds.has(p.id);
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
                <PosPill pos={p.pos} />
                <span className="grotesk" style={{ fontSize: 11.5, fontWeight: 700, color: side === 'you' ? 'var(--text)' : 'var(--dimstrong)', flex: 1, textDecoration: assigned ? 'line-through' : 'none', opacity: assigned ? 0.55 : 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{p.team}</span>
              </button>
            );
          })}
        </div>
      ))}
    </aside>
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
  picks: Record<string, Pick>;
  selSlot: string | null;
  setSelSlot: (k: string | null) => void;
  pickMetricFor: (k: string, m: string) => void;
  clearSlot: (k: string) => void;
  openPBP: Record<string, boolean>;
  togglePBP: (k: string) => void;
  youPools: Record<WindowId, Player[]>;
  onAssign: (id: string) => void;
}) {
  const { rw, week, phase, clock, maxClock, playing, onTogglePlay, onReplay, canApplyExtra, extraSlotQty, onApplyExtra, picks, selSlot, setSelSlot, pickMetricFor, clearSlot, openPBP, togglePBP, onAssign } = props;
  const w = rw.window;
  const setN = rw.slots.filter((s) => picks[slotKey(w.id, s.slotIndex)]?.metricId).length;
  const done = clock >= maxClock;
  const pct = Math.round((Math.min(clock, maxClock) / maxClock) * 100);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--bd)', paddingBottom: 7, marginBottom: 9, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)' }}>{w.label}</span>
          <span style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{w.sub}</span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{w.time}</span>
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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rw.slots.map((s) => {
          const key = slotKey(w.id, s.slotIndex);
          if (phase === 'setup') {
            return (
              <SetupRow
                key={key} slotKeyStr={key} winId={w.id} pick={picks[key]} selected={selSlot === key}
                onSelect={() => setSelSlot(key)} onPickMetric={(m) => pickMetricFor(key, m)} onClear={() => clearSlot(key)}
                onDropPlayer={(id) => onAssign(id)}
              />
            );
          }
          return (
            <ScoreRow key={key} slot={s} week={week} clock={clock} open={!!openPBP[key]} onToggle={() => togglePBP(key)} phase={phase} done={done} />
          );
        })}
      </div>
    </div>
  );
}

// ── Setup row ──
function SetupRow(props: {
  slotKeyStr: string; winId: WindowId; pick?: Pick; selected: boolean;
  onSelect: () => void; onPickMetric: (m: string) => void; onClear: () => void; onDropPlayer: (id: string) => void;
}) {
  const { winId, pick, selected, onSelect, onPickMetric, onClear, onDropPlayer } = props;
  const player = pick ? getPlayer(pick.playerId) : null;
  const metric = player && pick?.metricId ? metricById(player.pos, pick.metricId) : null;
  const showPicker = !!player && !pick?.metricId;

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
      {player ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onDropPlayer(e.dataTransfer.getData('text/plain')); }}
          style={{ flex: 1, minWidth: 0, background: selected ? 'var(--sh)' : 'var(--surface)', border: `1px solid ${selected ? 'var(--you)' : 'var(--bd)'}`, borderLeft: '3px solid var(--you)', borderRadius: 4, padding: '8px 10px', display: 'flex', gap: 10 }}
        >
          <div onClick={onSelect} style={{ cursor: 'pointer', minWidth: 0 }}>
            <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>{player.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
              <PosPill pos={player.pos} />
              <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{player.team}</span>
            </div>
            {!showPicker && <button onClick={onClear} className="mono" style={{ background: 'none', border: 'none', fontSize: 8, letterSpacing: '0.14em', color: 'var(--opp)', padding: 0, marginTop: 4 }}>CHANGE ✕</button>}
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, alignItems: 'flex-end' }}>
            {showPicker ? (
              METRICS[player.pos].map((m) => (
                <button key={m.id} title={m.ef} onClick={() => onPickMetric(m.id)} style={{ width: '100%', textAlign: 'left', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 3, padding: '4px 7px', display: 'flex', justifyContent: 'space-between', gap: 6, color: 'var(--text)' }}>
                  <span style={{ fontSize: 11, fontWeight: 700 }}>{m.name}</span>
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

// ── Score row (live / final) ──
function ScoreRow({ slot, week, clock, open, onToggle, phase, done }: {
  slot: ReturnType<typeof buildMatchup>['windows'][number]['slots'][number];
  week: number; clock: number; open: boolean; onToggle: () => void; phase: Phase; done: boolean;
}) {
  if (!slot.you || !slot.their) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, border: '1px dashed var(--bd)', borderRadius: 4, color: 'var(--faint)', fontSize: 11 }} className="mono">
        — EMPTY SLOT —
      </div>
    );
  }
  const banks = banksAtClock(slot.events, clock);
  const lead = banks.you - banks.their;
  const final = phase === 'final' || done;
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
        <ScoreCard side="you" player={slot.you.player} week={week} clock={clock} metricName={yMet?.name ?? ''} tag={yMet?.tag ?? ''} bank={banks.you} onClick={onToggle} fx={lastEffect?.type} />
        <div style={{ width: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--bg)', background: verdict.c, padding: '4px 6px', borderRadius: 3, textAlign: 'center', lineHeight: 1.1 }}>{verdict.t}</span>
          {visibleEvents.length > 0 && (
            <button onClick={onToggle} className="mono" style={{ background: 'none', border: 'none', fontSize: 7, letterSpacing: '0.1em', color: 'var(--faint)', padding: 0 }}>{open ? 'HIDE ▲' : 'LOG ▾'}</button>
          )}
        </div>
        <ScoreCard side="their" player={slot.their.player} week={week} clock={clock} metricName={tMet?.name ?? ''} tag={tMet?.tag ?? ''} bank={banks.their} onClick={onToggle} fx={lastEffect?.type} />
      </div>
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

function ScoreCard({ side, player, week, clock, metricName, tag, bank, onClick, fx }: {
  side: 'you' | 'their'; player: Player; week: number; clock: number; metricName: string; tag: string; bank: number; onClick: () => void; fx?: string;
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const nuked = fx === 'nuke' && bank === 0;
  const stat = useMemo(() => fmtStat(player.pos, statlineAt(player, week, clock)), [player, week, clock]);
  return (
    <div onClick={onClick} style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--bd)', [side === 'you' ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, padding: '9px 11px', display: 'flex', flexDirection: side === 'you' ? 'row' : 'row-reverse', gap: 10, cursor: 'pointer', animation: nuked ? 'flash 1.4s ease-out' : undefined } as React.CSSProperties}>
      <div style={{ flex: 1, minWidth: 0, textAlign: side === 'you' ? 'left' : 'right' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: side === 'you' ? 'row' : 'row-reverse' }}>
          <PosPill pos={player.pos} />
          <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
          <span className="mono" style={{ fontSize: 8, color: 'var(--faint)' }}>{player.team}</span>
        </div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 3, letterSpacing: '0.04em' }}>{metricName} · {tag}</div>
        {/* running statline */}
        <div className="mono" style={{ fontSize: 9.5, color: 'var(--dimstrong)', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{stat}</div>
      </div>
      <div style={{ flex: 'none', alignSelf: 'center' }}>
        <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, color: accent, lineHeight: 1, letterSpacing: '-0.02em', animation: nuked ? 'shake .5s' : undefined }}>{bank.toFixed(1)}</div>
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
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28;
  };
  const rows = events.slice(-80); // chronological, last 80
  const cell = (ev: PbpEvent, mine: boolean) => (
    <div style={{ flex: 1, minWidth: 0, textAlign: mine ? 'right' : 'left' }}>
      {ev.side === (mine ? 'you' : 'their') && (
        <>
          <div style={{ fontSize: 10.5, lineHeight: 1.35, color: 'var(--text)' }}>
            {actionText(ev.play)}
            {ev.delta > 0 && <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: mine ? 'var(--you)' : 'var(--opp)', marginLeft: 5 }}>+{ev.delta.toFixed(1)}</span>}
          </div>
          {ev.effect && (
            <div className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.08em', color: FX_COLOR[ev.effect.type] ?? 'var(--dim)', marginTop: 1 }}>{ev.effect.text}</div>
          )}
        </>
      )}
    </div>
  );
  return (
    <div style={{ marginTop: 5, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span className="mono" style={{ flex: 1, textAlign: 'right', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{youName}</span>
        <span className="mono" style={{ width: 44, textAlign: 'center', fontSize: 7.5, color: 'var(--faint)', letterSpacing: '0.1em' }}>PBP</span>
        <span className="mono" style={{ flex: 1, textAlign: 'left', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--opp)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{theirName}</span>
      </div>
      <div ref={scroller} onScroll={onScroll} style={{ maxHeight: 210, overflow: 'auto' }}>
        {rows.map((ev, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '3px 0', borderTop: i === 0 ? undefined : '1px solid color-mix(in srgb, var(--bd) 45%, transparent)', animation: i === rows.length - 1 ? 'slidein .3s ease' : undefined }}>
            {cell(ev, true)}
            <span className="mono" style={{ width: 44, flex: 'none', textAlign: 'center', fontSize: 8.5, color: 'var(--faint)', paddingTop: 1 }}>{fmtClock(ev.clock)}</span>
            {cell(ev, false)}
          </div>
        ))}
      </div>
      <div className="mono" style={{ fontSize: 7.5, color: 'var(--faint)', letterSpacing: '0.12em', marginTop: 6, textAlign: 'center' }}>{gameLabel}</div>
    </div>
  );
}
