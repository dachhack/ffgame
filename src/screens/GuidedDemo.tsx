import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { ThemeSwitcher } from '../app/ui';
import { buildMatchup, defaultLineup, aiLineup } from '../engine/matchup';
import { YOU_TEAM_ID, gameForTeam } from '../data/league';
import { DEMO_WEEK } from '../config';
import { METRICS } from '../data/metrics';
import { loadRealWeek } from '../data/realPbp';
import { FX_COLOR, fmtClock, buildBeats, type Beat } from '../data/demoNarration';
import { DemoViewToggle } from './DemoOverlay';
import type { PbpEvent, Player } from '../types';

// A best-in-class, zero-effort intro to Drip: it auto-plays one real resolved
// duel (from the deterministic engine) and narrates the core mechanics in plain
// English as they happen. No lineup-setting, no jargon up front — just watch.
// This is the "clean" view; a toggle flips to the authentic in-game board.

const TICK_MS = 400;
const TARGET_TICKS = 130; // ~52s to play through at 1×

type SlotSide = { player: Player; metricId: string };
interface Featured { gameLabel: string; winLabel: string; you: SlotSide; their: SlotSide; events: PbpEvent[]; }

const actionText = (play: string) => play.replace(/^[A-Z]{2,3}( D| TD)?:\s*/, '');

export function GuidedDemo() {
  const { navigate } = useStore();

  // The demo week resolves from real 2025 play-by-play, which is fetched async —
  // build only once it's cached (mirrors Matchup.tsx's loadRealWeek → setReady).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRealWeek(DEMO_WEEK).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // One deterministic, fully-resolved matchup from the baked demo league.
  const matchup = useMemo(() => {
    if (!ready) return null;
    const youId = YOU_TEAM_ID;
    const oppId = gameForTeam(youId, DEMO_WEEK)?.oppId;
    if (!oppId) return null;
    return buildMatchup(youId, oppId, DEMO_WEEK, defaultLineup(youId, DEMO_WEEK), aiLineup(oppId, youId, DEMO_WEEK));
  }, [ready]);

  // Feature the single richest head-to-head duel (most effects / coin / signature plays).
  const featured = useMemo<Featured | null>(() => {
    if (!matchup) return null;
    let best: Featured | null = null;
    let bestScore = -1;
    for (const w of matchup.windows) {
      for (const s of w.slots) {
        if (!s.you || !s.their || s.events.length === 0) continue;
        const score = s.events.reduce((a, e) => a + (e.effect ? 3 : 0) + (e.coin ? 2 : 0) + (e.sig ? 1 : 0), 0);
        if (score > bestScore) { bestScore = score; best = { gameLabel: s.gameLabel, winLabel: w.window.label, you: s.you, their: s.their, events: s.events }; }
      }
    }
    return best;
  }, [matchup]);

  const events = featured?.events ?? [];
  const maxClock = useMemo(() => events.reduce((a, e) => Math.max(a, e.clock), 0), [events]);
  const step = Math.max(1, Math.round(maxClock / TARGET_TICKS));

  const beats = useMemo<Beat[]>(() => buildBeats(events), [events]);

  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);

  useEffect(() => {
    if (!playing || maxClock === 0) return;
    const id = setInterval(() => {
      setClock((c) => {
        const n = c + step * speed;
        if (n >= maxClock) { setPlaying(false); setEnded(true); return maxClock; }
        return n;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, step, maxClock]);

  const replay = () => { setClock(0); setEnded(false); setPlaying(true); };

  // Keep the newest log line in view.
  const logRef = useRef<HTMLDivElement>(null);
  const revealed = events.filter((e) => e.clock <= clock);
  const youBank = revealed.length ? revealed[revealed.length - 1].youBank : 0;
  const theirBank = revealed.length ? revealed[revealed.length - 1].theirBank : 0;
  const notable = revealed.filter((e) => e.effect || e.coin || e.sig).slice(-6);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [notable.length]);

  const youMet = featured ? METRICS[featured.you.player.pos]?.find((x) => x.id === featured.you.metricId) : undefined;
  const theirMet = featured ? METRICS[featured.their.player.pos]?.find((x) => x.id === featured.their.metricId) : undefined;

  const activeBeat = beats.reduce<Beat | null>((acc, b) => (b.clock <= clock ? b : acc), null);
  const intro: Beat | null = featured ? {
    clock: 0, key: 'intro', icon: '👀', title: 'KICKOFF',
    body: `${featured.you.player.name} (${youMet?.tag ?? '—'}) vs ${featured.their.player.name} (${theirMet?.tag ?? '—'}). Watch the scores build — then collide.`,
  } : null;
  const shown = activeBeat ?? intro;

  const header = (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}>◈ DRIP LEAGUE FF · DEMO</span>
        <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>← back</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <DemoViewToggle view="clean" onSwitch={(v) => v === 'board' && navigate({ name: 'demo', view: 'board' })} />
        <ThemeSwitcher />
      </div>
    </header>
  );

  if (!featured) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {header}
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {!ready
            ? <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', letterSpacing: '0.08em' }}>Loading the demo…</div>
            : <div className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>Demo unavailable. <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ background: 'none', border: 'none', color: 'var(--you)', cursor: 'pointer' }}>← back</button></div>}
        </main>
      </div>
    );
  }

  const lead = Math.max(youBank, theirBank, 1);
  const Side = ({ side }: { side: 'you' | 'their' }) => {
    const p = side === 'you' ? featured.you : featured.their;
    const met = side === 'you' ? youMet : theirMet;
    const bank = side === 'you' ? youBank : theirBank;
    const color = side === 'you' ? 'var(--you)' : 'var(--opp)';
    const leading = bank >= (side === 'you' ? theirBank : youBank);
    return (
      <div style={{ flex: 1, minWidth: 0, textAlign: side === 'you' ? 'left' : 'right' }}>
        <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.player.name}</div>
        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.04em', marginTop: 2 }}>{p.player.pos} · {p.player.team}</div>
        <div style={{ display: 'inline-flex', marginTop: 6 }}>
          <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)`, borderRadius: 3, padding: '2px 6px' }}>{met?.name ?? 'metric'} · {met?.tag ?? ''}</span>
        </div>
        <div className="grotesk" style={{ fontSize: 34, fontWeight: 700, color, marginTop: 8, lineHeight: 1, opacity: leading ? 1 : 0.78 }}>{bank.toFixed(1)}</div>
        <div style={{ height: 4, background: 'var(--bd)', borderRadius: 3, marginTop: 8 }}>
          <div style={{ height: 4, width: `${Math.max(2, (bank / lead) * 100)}%`, background: color, borderRadius: 3, transition: 'width .3s ease', marginLeft: side === 'their' ? 'auto' : 0 }} />
        </div>
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {header}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '18px 16px 40px' }}>
        <div style={{ width: '100%', maxWidth: 480, position: 'relative' }}>
          <div style={{ textAlign: 'center', marginBottom: 16 }}>
            <div className="grotesk" style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Watch a matchup play out</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6 }}>Two players, hidden metrics, live swings — scored off real NFL plays. ~60 seconds.</div>
          </div>

          {/* the duel */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 }}>
            <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--faint)', textAlign: 'center', marginBottom: 12 }}>{featured.winLabel} · {featured.gameLabel}</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <Side side="you" />
              <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.14em', paddingTop: 28 }}>VS</div>
              <Side side="their" />
            </div>
            {/* clock / progress */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <span className="mono" style={{ fontSize: 9, color: 'var(--dim)', minWidth: 34 }}>{fmtClock(clock)}</span>
              <div style={{ flex: 1, height: 3, background: 'var(--bd)', borderRadius: 3 }}>
                <div style={{ height: 3, width: `${maxClock ? (clock / maxClock) * 100 : 0}%`, background: 'var(--you)', borderRadius: 3, transition: 'width .3s linear' }} />
              </div>
            </div>
          </div>

          {/* narration callout */}
          <div style={{ minHeight: 86, marginTop: 12, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: `3px solid ${shown && FX_COLOR[shown.key] ? FX_COLOR[shown.key] : 'var(--you)'}`, borderRadius: 7, padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{shown?.icon}</span>
            <div style={{ minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: shown && FX_COLOR[shown.key] ? FX_COLOR[shown.key] : 'var(--you)' }}>{shown?.title}</div>
              <div style={{ fontSize: 12, color: 'var(--text)', marginTop: 4, lineHeight: 1.45 }}>{shown?.body}</div>
            </div>
          </div>

          {/* rolling log of notable plays */}
          <div ref={logRef} style={{ marginTop: 12, maxHeight: 120, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
            {notable.map((e, i) => (
              <div key={i} className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 10, color: 'var(--dim)' }}>
                <span style={{ color: 'var(--faint)', minWidth: 30 }}>{fmtClock(e.clock)}</span>
                <span style={{ color: e.side === 'you' ? 'var(--you)' : 'var(--opp)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{actionText(e.play)}</span>
                {e.delta > 0 && <span style={{ color: 'var(--text)' }}>+{e.delta.toFixed(1)}</span>}
                {e.effect && <span style={{ color: FX_COLOR[e.effect.type] ?? 'var(--text)', fontWeight: 700 }}>{e.effect.type.toUpperCase()}</span>}
                {e.coin && <span style={{ color: 'var(--you)' }}>◇</span>}
              </div>
            ))}
          </div>

          {/* legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', marginTop: 14 }}>
            {[['💧', 'DRIP'], ['💥', 'NUKE'], ['🩸', 'ERASE'], ['◇', 'COIN']].map(([icon, label]) => (
              <span key={label} className="mono" style={{ fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--faint)' }}>{icon} {label}</span>
            ))}
          </div>

          {/* controls */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 16 }}>
            <button onClick={() => (ended ? replay() : setPlaying((p) => !p))} className="mono" style={ctlBtn}>{ended ? '↺ REPLAY' : playing ? '❚❚ PAUSE' : '▶ PLAY'}</button>
            {!ended && <button onClick={replay} className="mono" style={ctlBtn}>↺ RESTART</button>}
            {!ended && <button onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))} className="mono" style={ctlBtn}>{speed}×</button>}
          </div>

          {/* end card */}
          {ended && (
            <div style={{ marginTop: 18, background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: 18, textAlign: 'center' }}>
              <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>That’s Drip.</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>Pick a hidden metric for every player, then watch real NFL plays make your scores drip, nuke and swing live.</div>
              <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ ...cta, marginTop: 14 }}>◈ See your real league in the game →</button>
              <button onClick={() => navigate({ name: 'live' })} className="mono" style={{ ...cta, marginTop: 9, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--bd)' }}>join the live H2H pilot →</button>
              <button onClick={replay} className="mono" style={{ background: 'none', border: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', cursor: 'pointer', marginTop: 12 }}>↺ watch again</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const ctlBtn: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 14px', cursor: 'pointer' };
const cta: React.CSSProperties = { width: '100%', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '12px 0', cursor: 'pointer' };
