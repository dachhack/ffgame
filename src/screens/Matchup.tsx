import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../app/store';
import type { Phase } from '../app/store';
import { Brand, ThemeSwitcher, PosPill } from '../app/ui';
import { WINDOWS, METRICS, TOTAL_SLOTS, metricById } from '../data/metrics';
import { getTeam, getPlayer, gameForTeam } from '../data/league';
import {
  windowPools, defaultLineup, slotKey, buildMatchup, banksAtClock,
} from '../engine/matchup';
import { GAME_SECONDS, fmtClock } from '../engine/sim';
import type { Pick, Player, WindowId, PbpEvent } from '../types';

const YOU = 'happy-campers';
const TICK_MS = 800;
const TICK_SECONDS = 18;

export function Matchup({ week, initialPhase }: { week: number; initialPhase: Phase }) {
  const { navigate } = useStore();
  const oppId = gameForTeam(YOU, week)?.oppId ?? 'rock-tunnel';
  const you = getTeam(YOU)!;
  const opp = getTeam(oppId)!;

  const [phase, setPhase] = useState<Phase>(initialPhase);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [selSlot, setSelSlot] = useState<string | null>(null);
  const [liveClock, setLiveClock] = useState(initialPhase === 'final' ? GAME_SECONDS : 1700);
  const [playing, setPlaying] = useState(true);
  const [openPBP, setOpenPBP] = useState<Record<string, boolean>>({});

  const youPools = useMemo(() => windowPools(YOU, week), [week]);
  const oppPools = useMemo(() => windowPools(oppId, week), [week, oppId]);
  const oppPicks = useMemo(() => defaultLineup(oppId, week), [oppId, week]);
  const youDefault = useMemo(() => defaultLineup(YOU, week), [week]);

  // player -> its eligible window (your roster)
  const playerWindow = useMemo(() => {
    const m = new Map<string, WindowId>();
    (Object.keys(youPools) as WindowId[]).forEach((w) => youPools[w].forEach((p) => m.set(p.id, w)));
    return m;
  }, [youPools]);

  // Effective picks: setup shows only what you've set; live/final fills empties
  // from your projected-best default lineup so the sim is always complete.
  const effYouPicks = useMemo<Record<string, Pick>>(() => {
    if (phase === 'setup') return picks;
    return { ...youDefault, ...picks };
  }, [phase, picks, youDefault]);

  const resolved = useMemo(
    () => buildMatchup(YOU, oppId, week, effYouPicks, oppPicks),
    [oppId, week, effYouPicks, oppPicks],
  );

  const effClock = phase === 'final' ? GAME_SECONDS : liveClock;

  // live ticker
  useEffect(() => {
    if (phase !== 'live' || !playing) return;
    const id = setInterval(() => {
      setLiveClock((c) => Math.min(GAME_SECONDS, c + TICK_SECONDS));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [phase, playing]);

  // ── derived totals (respecting live clock) ──
  const { youTotal, themTotal } = useMemo(() => {
    let y = 0; let t = 0;
    for (const w of resolved.windows) {
      for (const s of w.slots) {
        if (!s.you || !s.their) continue;
        if (phase === 'setup') continue;
        const b = banksAtClock(s.events, effClock);
        y += b.you; t += b.their;
      }
    }
    return { youTotal: Math.round(y * 10) / 10, themTotal: Math.round(t * 10) / 10 };
  }, [resolved, effClock, phase]);

  const filledCount = Object.values(picks).filter((p) => p.metricId).length;

  // ── setup interactions ──
  function assignFromRoster(playerId: string) {
    if (phase !== 'setup') return;
    const win = playerWindow.get(playerId);
    if (!win) return;
    const w = WINDOWS.find((x) => x.id === win)!;
    // already placed? select it
    for (let i = 0; i < w.slots; i++) {
      const k = slotKey(win, i);
      if (picks[k]?.playerId === playerId) { setSelSlot(k); return; }
    }
    // target = selected empty slot in window, else next open
    let target: string | null = null;
    if (selSlot && selSlot.startsWith(win + '#') && !picks[selSlot]) target = selSlot;
    if (!target) {
      for (let i = 0; i < w.slots; i++) {
        const k = slotKey(win, i);
        if (!picks[k]) { target = k; break; }
      }
    }
    if (!target) target = slotKey(win, 0);
    setPicks((prev) => {
      const next = { ...prev };
      // remove player from any existing slot
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

  function lockIn() { setPhase('live'); setSelSlot(null); setPlaying(true); setLiveClock(1700); }
  function changePhase(p: Phase) { setPhase(p); setSelSlot(null); if (p === 'final') setLiveClock(GAME_SECONDS); }

  const headline = phase === 'setup' ? 'Set Your Windows' : phase === 'live' ? 'Live Resolution' : `Week ${week} — Final`;
  const subhead = `${you.name} vs ${opp.name} · drag or tap players into the 5 game windows, then seal a hidden metric for each.`;

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
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap' }}>
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
              <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>{fmtClock(liveClock)}</span>
              <span className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>/ 55:00</span>
              <button onClick={() => setPlaying((p) => !p)} className="mono" style={{ fontSize: 12, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 10px' }}>
                {playing ? '❚❚' : '▶'}
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
        {/* left roster */}
        <RosterAside side="you" pools={youPools} picks={picks} onPlayer={assignFromRoster} phase={phase} />

        {/* center */}
        <main style={{ flex: 1, overflow: 'auto', minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 18, marginBottom: 10 }}>
            <div>
              <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>{headline}</div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4, maxWidth: 520, lineHeight: 1.5 }}>{subhead}</div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              <div className="mono" style={{ fontSize: 10, color: 'var(--faint)' }}>{phase === 'setup' ? 'SLOTS SET' : 'WEEK ' + week}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{phase === 'setup' ? `${filledCount}/${TOTAL_SLOTS}` : phase.toUpperCase()}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {resolved.windows.map((rw) => (
              <WindowSection
                key={rw.window.id}
                rw={rw}
                phase={phase}
                effClock={effClock}
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

        {/* right roster */}
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
  phase: Phase;
  effClock: number;
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
  const { rw, phase, effClock, picks, selSlot, setSelSlot, pickMetricFor, clearSlot, openPBP, togglePBP, onAssign } = props;
  const w = rw.window;
  const setN = rw.slots.filter((s) => picks[slotKey(w.id, s.slotIndex)]?.metricId).length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '1px solid var(--bd)', paddingBottom: 7, marginBottom: 9, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)' }}>{w.label}</span>
          <span style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{w.sub}</span>
          <span className="mono" style={{ fontSize: 9, color: 'var(--faint)' }}>{w.time}</span>
        </div>
        <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: phase === 'setup' ? 'var(--dim)' : phase === 'final' ? 'var(--you)' : '#FF4F62' }}>
          {phase === 'setup' ? `${setN}/${w.slots} SET` : phase === 'final' ? 'FINAL' : '● LIVE'}
        </span>
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
            <ScoreRow key={key} slot={s} effClock={effClock} open={!!openPBP[key]} onToggle={() => togglePBP(key)} phase={phase} />
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
function ScoreRow({ slot, effClock, open, onToggle, phase }: {
  slot: ReturnType<typeof buildMatchup>['windows'][number]['slots'][number];
  effClock: number; open: boolean; onToggle: () => void; phase: Phase;
}) {
  if (!slot.you || !slot.their) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, border: '1px dashed var(--bd)', borderRadius: 4, color: 'var(--faint)', fontSize: 11 }} className="mono">
        — EMPTY SLOT —
      </div>
    );
  }
  const banks = banksAtClock(slot.events, effClock);
  const lead = banks.you - banks.their;
  const verdict = phase === 'final'
    ? (lead > 0.1 ? { t: 'WON', c: 'var(--you)' } : lead < -0.1 ? { t: 'LOST', c: 'var(--opp)' } : { t: 'TIE', c: 'var(--dim)' })
    : (lead > 2 ? { t: 'EDGE YOU', c: 'var(--you)' } : lead < -2 ? { t: 'EDGE THEM', c: 'var(--opp)' } : Math.abs(lead) > 0.1 ? { t: 'CLOSE', c: 'var(--warn)' } : { t: 'EVEN', c: 'var(--dim)' });

  const visibleEvents = slot.events.filter((e) => e.clock <= effClock);
  const lastEffect = [...visibleEvents].reverse().find((e) => e.effect)?.effect;
  const yMet = metricById(slot.you.player.pos, slot.you.metricId);
  const tMet = metricById(slot.their.player.pos, slot.their.metricId);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
        <ScoreCard side="you" player={slot.you.player} metricName={yMet?.name ?? ''} tag={yMet?.tag ?? ''} bank={banks.you} onClick={onToggle} fx={lastEffect?.type} />
        <div style={{ width: 64, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
          <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--bg)', background: verdict.c, padding: '4px 6px', borderRadius: 3, textAlign: 'center', lineHeight: 1.1 }}>{verdict.t}</span>
          {visibleEvents.length > 0 && (
            <button onClick={onToggle} className="mono" style={{ background: 'none', border: 'none', fontSize: 7, letterSpacing: '0.1em', color: 'var(--faint)', padding: 0 }}>{open ? 'HIDE ▲' : 'PBP ▾'}</button>
          )}
        </div>
        <ScoreCard side="their" player={slot.their.player} metricName={tMet?.name ?? ''} tag={tMet?.tag ?? ''} bank={banks.their} onClick={onToggle} fx={lastEffect?.type} />
      </div>
      {open && <PbpDrawer events={visibleEvents} gameLabel={slot.gameLabel} />}
    </div>
  );
}

function ScoreCard({ side, player, metricName, tag, bank, onClick, fx }: {
  side: 'you' | 'their'; player: Player; metricName: string; tag: string; bank: number; onClick: () => void; fx?: string;
}) {
  const accent = side === 'you' ? 'var(--you)' : 'var(--opp)';
  const nuked = fx === 'nuke' && bank === 0;
  const pct = Math.max(6, Math.min(100, bank * 3));
  const card = (
    <div onClick={onClick} style={{ flex: 1, minWidth: 0, background: 'var(--surface)', border: '1px solid var(--bd)', [side === 'you' ? 'borderLeft' : 'borderRight']: `3px solid ${accent}`, borderRadius: 4, padding: '9px 11px', display: 'flex', flexDirection: side === 'you' ? 'row' : 'row-reverse', gap: 10, cursor: 'pointer', animation: nuked ? 'flash 1.4s ease-out' : undefined } as React.CSSProperties}>
      <div style={{ flex: 1, minWidth: 0, textAlign: side === 'you' ? 'left' : 'right' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexDirection: side === 'you' ? 'row' : 'row-reverse' }}>
          <PosPill pos={player.pos} />
          <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
        </div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 3, letterSpacing: '0.04em' }}>{metricName} · {tag}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 6, flexDirection: side === 'you' ? 'row' : 'row-reverse' }}>
          <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: accent, transition: 'width .4s ease', float: side === 'you' ? 'left' : 'right' }} />
          </div>
          <span className="mono" style={{ fontSize: 8, color: 'var(--dimstrong)' }}>{tag.split(' ')[0]}</span>
        </div>
      </div>
      <div style={{ flex: 'none' }}>
        <div className="grotesk" style={{ fontSize: 26, fontWeight: 700, color: accent, lineHeight: 1, letterSpacing: '-0.02em', animation: nuked ? 'shake .5s' : undefined }}>{bank.toFixed(1)}</div>
      </div>
    </div>
  );
  return card;
}

function PbpDrawer({ events, gameLabel }: { events: PbpEvent[]; gameLabel: string }) {
  const FX_COLOR: Record<string, string> = { nuke: 'var(--fx-nuke)', erase: 'var(--fx-erase)', streak: 'var(--fx-streak)', cold: 'var(--fx-stop)', mult: 'var(--fx-mult)', compression: 'var(--fx-compression)', reset: 'var(--fx-reset)', stop: 'var(--fx-stop)' };
  const recent = [...events].reverse().slice(0, 40);
  return (
    <div style={{ marginTop: 5, background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 4, padding: '9px 12px', maxHeight: 200, overflow: 'auto' }}>
      <div className="mono" style={{ fontSize: 8, color: 'var(--faint)', letterSpacing: '0.16em', fontWeight: 700, marginBottom: 5 }}>▼ PBP · {gameLabel}</div>
      {recent.map((ev, i) => (
        <div key={i} style={{ animation: i === 0 ? 'slidein .35s ease' : undefined, padding: '3px 0', borderBottom: '1px solid color-mix(in srgb, var(--bd) 50%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 7 }}>
            <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', minWidth: 34 }}>{fmtClock(ev.clock)}</span>
            <span style={{ fontSize: 10.5, lineHeight: 1.4, color: 'var(--text)', flex: 1 }}>{ev.play}</span>
            {ev.delta > 0 && <span className="mono" style={{ fontSize: 9.5, fontWeight: 700, color: ev.side === 'you' ? 'var(--you)' : 'var(--opp)' }}>{ev.side === 'you' ? '+' : '+'}{ev.delta.toFixed(1)}</span>}
          </div>
          {ev.effect && (
            <div className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', color: FX_COLOR[ev.effect.type] ?? 'var(--dim)', marginLeft: 41, marginTop: 2 }}>{ev.effect.text}</div>
          )}
        </div>
      ))}
    </div>
  );
}
