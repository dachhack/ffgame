import { FX_COLOR, fmtClock, type Beat } from '../data/demoNarration';
import { SleeperHandoff } from './SleeperHandoff';

// Presentational chrome shared by the two demo views. The narrated controls +
// end-card sit UNDER the real in-game live board (Matchup demo mode); the view
// toggle lets a viewer flip between the clean simulation (DemoBoard) and the
// authentic board so they see both "how it's taught" and "how it'll play".

type DemoView = 'clean' | 'board';

/** Segmented [▣ CLEAN | ▦ REAL BOARD] switch shown in both demo headers. */
export function DemoViewToggle({ view, onSwitch }: { view: DemoView; onSwitch: (v: DemoView) => void }) {
  return (
    <div style={{ display: 'flex', gap: 2, padding: 3, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4 }} title="Switch between the clean explainer and the real in-game board">
      {(['clean', 'board'] as DemoView[]).map((v) => (
        <button key={v} onClick={() => onSwitch(v)} className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', padding: '5px 9px', borderRadius: 3, border: 'none', background: view === v ? 'var(--sh)' : 'transparent', color: view === v ? 'var(--you)' : 'var(--dim)', cursor: 'pointer' }}>
          {v === 'clean' ? '▣ CLEAN' : '▦ REAL BOARD'}
        </button>
      ))}
    </div>
  );
}

interface DemoOverlayProps {
  beat: Beat | null;
  clock: number;
  maxClock: number;
  playing: boolean;
  ended: boolean;
  speed: number;
  onToggle: () => void;
  onReplay: () => void;
  onCycleSpeed: () => void;
  onSeeLeague: () => void;
  onJoinPilot: () => void;
}

/** Plain-English narration + pacing controls layered beneath the real board. */
export function DemoOverlay(p: DemoOverlayProps) {
  const accent = p.beat && FX_COLOR[p.beat.key] ? FX_COLOR[p.beat.key] : 'var(--you)';
  return (
    <div style={{ width: '100%', maxWidth: 560, margin: '14px auto 0' }}>
      {/* narration callout */}
      <div style={{ minHeight: 84, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: `3px solid ${accent}`, borderRadius: 7, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{ fontSize: 22, lineHeight: 1 }}>{p.beat?.icon ?? '👀'}</span>
        <div style={{ minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: accent }}>{p.beat?.title ?? 'KICKOFF'}</div>
          <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 4, lineHeight: 1.45 }}>{p.beat?.body ?? 'Watch the banked scores build on each side — then collide.'}</div>
        </div>
      </div>

      {/* clock / progress */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
        <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', minWidth: 34 }}>{fmtClock(p.clock)}</span>
        <div style={{ flex: 1, height: 3, background: 'var(--bd)', borderRadius: 3 }}>
          <div style={{ height: 3, width: `${p.maxClock ? (p.clock / p.maxClock) * 100 : 0}%`, background: 'var(--you)', borderRadius: 3, transition: 'width .3s linear' }} />
        </div>
      </div>

      {/* legend */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', marginTop: 12 }}>
        {[['💧', 'DRIP'], ['💥', 'NUKE'], ['🩸', 'ERASE'], ['🗑️', 'POWER-UP'], ['◇', 'COIN']].map(([icon, label]) => (
          <span key={label} className="mono" style={{ fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--faint)' }}>{icon} {label}</span>
        ))}
      </div>

      {/* controls */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 14 }}>
        <button onClick={p.onToggle} className="mono" style={ctlBtn}>{p.ended ? '↺ REPLAY' : p.playing ? '❚❚ PAUSE' : '▶ PLAY'}</button>
        {!p.ended && <button onClick={p.onReplay} className="mono" style={ctlBtn}>↺ RESTART</button>}
        {!p.ended && <button onClick={p.onCycleSpeed} className="mono" style={ctlBtn}>{p.speed}×</button>}
      </div>

      {/* end card */}
      {p.ended && (
        <div style={{ marginTop: 18, background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: 18, textAlign: 'center' }}>
          <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>That’s Drip.</div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>That was the real in-game board — the same screen you play on. Now load your own team onto it:</div>
          <div style={{ marginTop: 14 }}><SleeperHandoff /></div>
          <button onClick={p.onJoinPilot} className="mono" style={{ ...cta, marginTop: 12, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--bd)' }}>join the live H2H pilot →</button>
          <button onClick={p.onReplay} className="mono" style={{ background: 'none', border: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', cursor: 'pointer', marginTop: 12 }}>↺ watch again</button>
        </div>
      )}
    </div>
  );
}

const ctlBtn: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 14px', cursor: 'pointer' };
const cta: React.CSSProperties = { width: '100%', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '12px 0', cursor: 'pointer' };
