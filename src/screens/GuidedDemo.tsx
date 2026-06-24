import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { ThemeSwitcher, PlayerImg } from '../app/ui';
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
//
// To make the demo show off the deeper game, the matchup is resolved with two
// real power-ups live: Garbage Time (armed pre-kick — doubles points in the
// final 5 minutes) and EMP (fired mid-window — freezes the opponent's drip clock
// for 10 minutes). Both are genuine engine effects, just pre-scripted here.

const TICK_MS = 400;
const TARGET_TICKS = 130; // ~52s to play through at 1×
const DEMO_BUFFS = { 'garbage-time': true }; // armed power-up, surfaced as buffNote events
const EMP_SECONDS = 600;                       // EMP freezes opponent drip for 10:00

type SlotSide = { player: Player; metricId: string };
interface Featured { gameLabel: string; winLabel: string; you: SlotSide; their: SlotSide; events: PbpEvent[]; }

const actionText = (play: string) => play.replace(/^[A-Z]{2,3}( D| TD)?:\s*/, '');

export function GuidedDemo() {
  const { navigate } = useStore();
  const youId = YOU_TEAM_ID;
  const oppId = gameForTeam(youId, DEMO_WEEK)?.oppId;

  // The demo week resolves from real 2025 play-by-play, which is fetched async —
  // build only once it's cached (mirrors Matchup.tsx's loadRealWeek → setReady).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRealWeek(DEMO_WEEK).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  // Pass 1 — resolve with the armed buff so we can pick the richest duel and
  // learn its window id (needed to aim the EMP).
  const scout = useMemo(() => {
    if (!ready || !oppId) return null;
    return buildMatchup(youId, oppId, DEMO_WEEK, defaultLineup(youId, DEMO_WEEK), aiLineup(oppId, youId, DEMO_WEEK), {}, {}, {}, DEMO_BUFFS, {});
  }, [ready, oppId, youId]);

  // The single richest head-to-head duel (most effects / coin / power-up / signature plays).
  const pick = useMemo(() => {
    if (!scout) return null;
    let best: { winId: string; winLabel: string; youPlayerId: string; maxClock: number } | null = null;
    let bestScore = -1;
    for (const w of scout.windows) {
      for (const s of w.slots) {
        if (!s.you || !s.their || s.events.length === 0) continue;
        const score = s.events.reduce((a, e) => a + (e.effect ? 3 : 0) + (e.coin ? 2 : 0) + (e.buffNote ? 4 : 0) + (e.sig ? 1 : 0), 0);
        if (score > bestScore) {
          bestScore = score;
          const mx = s.events.reduce((a, e) => Math.max(a, e.clock), 0);
          best = { winId: w.window.id, winLabel: w.window.label, youPlayerId: s.you.player.id, maxClock: mx };
        }
      }
    }
    return best;
  }, [scout]);

  // Fire EMP ~halfway through the featured duel (snapped to a clean minute).
  const empClock = useMemo(() => (pick ? Math.max(60, Math.round((pick.maxClock * 0.5) / 60) * 60) : 0), [pick]);

  // Pass 2 — re-resolve with the EMP aimed at the featured window so the
  // opponent's drip genuinely stops during the freeze.
  const matchup = useMemo(() => {
    if (!ready || !oppId || !pick) return null;
    return buildMatchup(youId, oppId, DEMO_WEEK, defaultLineup(youId, DEMO_WEEK), aiLineup(oppId, youId, DEMO_WEEK), {}, {}, {}, DEMO_BUFFS, { emp: { [pick.winId]: empClock } });
  }, [ready, oppId, youId, pick, empClock]);

  const featured = useMemo<Featured | null>(() => {
    if (!matchup || !pick) return null;
    const w = matchup.windows.find((w) => w.window.id === pick.winId);
    const s = w?.slots.find((x) => x.you?.player.id === pick.youPlayerId);
    if (!w || !s || !s.you || !s.their) return null;
    return { gameLabel: s.gameLabel, winLabel: w.window.label, you: s.you, their: s.their, events: s.events };
  }, [matchup, pick]);

  const events = featured?.events ?? [];
  const maxClock = useMemo(() => events.reduce((a, e) => Math.max(a, e.clock), 0), [events]);
  const step = Math.max(1, Math.round(maxClock / TARGET_TICKS));

  // Teaching beats from the events, plus a scripted EMP-freeze beat.
  const beats = useMemo<Beat[]>(() => {
    const out = buildBeats(events);
    if (empClock > 0) out.push({ clock: empClock, key: 'freeze', icon: '❄️', title: 'EMP — FREEZE', body: 'You fired EMP: the opponent’s drip clock is frozen for 10 minutes. Passive points stop cold — only a touchdown can still score.' });
    return out.sort((a, b) => a.clock - b.clock);
  }, [events, empClock]);

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

  const frozen = empClock > 0 && clock >= empClock && clock < empClock + EMP_SECONDS;

  // Keep the newest log line in view.
  const logRef = useRef<HTMLDivElement>(null);
  const revealed = events.filter((e) => e.clock <= clock);
  const youBank = revealed.length ? revealed[revealed.length - 1].youBank : 0;
  const theirBank = revealed.length ? revealed[revealed.length - 1].theirBank : 0;
  // Two-sided log: every scoring / notable play on either side (newest at bottom).
  const logRows = revealed.filter((e) => e.delta > 0 || e.effect || e.coin || e.sig || e.buffNote).slice(-9);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [logRows.length]);

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
    const isFrozen = side === 'their' && frozen;
    const right = side === 'their';
    return (
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', flex: 'none', filter: isFrozen ? 'grayscale(0.6) brightness(0.9)' : undefined }}>
            <PlayerImg playerId={p.player.id} team={p.player.team} pos={p.player.pos} size={44} />
            {isFrozen && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, textShadow: '0 0 6px rgba(0,0,0,.6)' }}>❄️</span>}
          </div>
          <div style={{ minWidth: 0, textAlign: right ? 'right' : 'left' }}>
            <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.player.name}</div>
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.04em', marginTop: 2 }}>{p.player.pos} · {p.player.team}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7, justifyContent: right ? 'flex-end' : 'flex-start' }}>
          <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)`, borderRadius: 3, padding: '2px 6px' }}>{met?.name ?? 'metric'} · {met?.tag ?? ''}</span>
          {side === 'you' && <span className="mono" title="An armed power-up: points in the final 5 minutes count double" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--fx-streak)', border: '1px solid color-mix(in srgb, var(--fx-streak) 45%, transparent)', background: 'color-mix(in srgb, var(--fx-streak) 12%, transparent)', borderRadius: 3, padding: '2px 6px' }}>🗑️ GARBAGE TIME</span>}
          {isFrozen && <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--fx-reset)', border: '1px solid color-mix(in srgb, var(--fx-reset) 55%, transparent)', background: 'color-mix(in srgb, var(--fx-reset) 14%, transparent)', borderRadius: 3, padding: '2px 6px' }}>❄️ DRIP FROZEN {fmtClock(Math.max(0, empClock + EMP_SECONDS - clock))}</span>}
        </div>
        <div className="grotesk" style={{ fontSize: 34, fontWeight: 700, color, marginTop: 8, lineHeight: 1, opacity: leading ? 1 : 0.78, textAlign: right ? 'right' : 'left' }}>{bank.toFixed(1)}</div>
        <div style={{ height: 4, background: 'var(--bd)', borderRadius: 3, marginTop: 8 }}>
          <div style={{ height: 4, width: `${Math.max(2, (bank / lead) * 100)}%`, background: isFrozen ? 'var(--fx-reset)' : color, borderRadius: 3, transition: 'width .3s ease', marginLeft: right ? 'auto' : 0 }} />
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
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6 }}>Two players, hidden metrics, live swings + power-ups — scored off real NFL plays. ~60 seconds.</div>
          </div>

          {/* the duel */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 }}>
            <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--faint)', textAlign: 'center', marginBottom: 12 }}>{featured.winLabel} · {featured.gameLabel}</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <Side side="you" />
              <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.14em', paddingTop: 14 }}>VS</div>
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

          {/* two-sided play log: your plays left, theirs right, clock down the middle */}
          <div style={{ marginTop: 12, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 7, padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
              <span className="mono" style={{ flex: 1, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', textAlign: 'right' }}>{featured.you.player.name.toUpperCase()}</span>
              <span className="mono" style={{ minWidth: 34, textAlign: 'center', fontSize: 8, color: 'var(--faint)' }}>CLOCK</span>
              <span className="mono" style={{ flex: 1, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--opp)', textAlign: 'left' }}>{featured.their.player.name.toUpperCase()}</span>
            </div>
            <div ref={logRef} style={{ maxHeight: 132, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
              {logRows.length === 0 && <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', textAlign: 'center', padding: '6px 0' }}>scoring plays appear here…</div>}
              {logRows.map((e, i) => {
                const mine = e.side === 'you';
                const cell = (
                  <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, flexDirection: mine ? 'row-reverse' : 'row', maxWidth: '100%', overflow: 'hidden' }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: mine ? 'var(--you)' : 'var(--opp)' }}>{actionText(e.play)}</span>
                    {e.delta > 0 && <span style={{ color: 'var(--text)', fontWeight: 700 }}>+{e.delta.toFixed(1)}</span>}
                    {e.effect && <span style={{ color: FX_COLOR[e.effect.type] ?? 'var(--text)', fontWeight: 700 }}>{e.effect.type.toUpperCase()}</span>}
                    {e.buffNote && <span style={{ color: 'var(--fx-streak)', fontWeight: 700 }}>🗑️×2</span>}
                    {e.coin && <span style={{ color: 'var(--you)' }}>◇</span>}
                  </span>
                );
                return (
                  <div key={i} className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 9.5 }}>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>{mine ? cell : ''}</span>
                    <span style={{ minWidth: 34, textAlign: 'center', color: 'var(--faint)' }}>{fmtClock(e.clock)}</span>
                    <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>{!mine ? cell : ''}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', marginTop: 14 }}>
            {[['💧', 'DRIP'], ['💥', 'NUKE'], ['🩸', 'ERASE'], ['🗑️', 'POWER-UP'], ['❄️', 'EMP FREEZE'], ['◇', 'COIN']].map(([icon, label]) => (
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
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>Pick a hidden metric for every player, arm power-ups like Garbage Time and EMP, then watch real NFL plays make your scores drip, nuke, freeze and swing live.</div>
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
