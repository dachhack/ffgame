import { useMemo, useRef, useState, useEffect } from 'react';
import { useStore } from '../app/store';
import { ThemeSwitcher, PlayerImg } from '../app/ui';
import { buildMatchup, defaultLineup, aiLineup, slotKey } from '../engine/matchup';
import { YOU_TEAM_ID, gameForTeam } from '../data/league';
import { DEMO_WEEK } from '../config';
import { METRICS } from '../data/metrics';
import { loadRealWeek, realPointsFor } from '../data/realPbp';
import { FX_COLOR, fmtClock, buildBeats, type Beat } from '../data/demoNarration';
import { DemoViewToggle } from './DemoOverlay';
import { SleeperHandoff } from './SleeperHandoff';
import type { PbpEvent, WindowId } from '../types';

// A best-in-class, zero-effort intro to Drip. Good game design is about CHOICES,
// so the demo lets the viewer make the three that define a lineup —
//   1. pick one of three STAR duels (different positions)
//   2. choose its hidden metric   3. arm a power-up
// — then auto-plays the duel those choices produce, narrated in plain English.
// Every choice is resolved through the real engine, and the three duels are
// curated to be the most exciting, back-and-forth games on the slate.
// This is the "clean" view; a toggle flips to the authentic in-game board.

const TICK_MS = 400;
const TARGET_TICKS = 130; // ~52s to play through at 1×
const EMP_SECONDS = 600;  // EMP freezes opponent drip for 10:00
const STAR_FLOOR = 10;    // real weekly points to qualify as a "star"
const TARGET_POS = ['QB', 'RB', 'WR', 'TE'] as const;

// The three power-ups offered as a choice (each a real engine effect).
const POWER_OPTIONS = [
  { id: 'garbage-time', icon: '🗑️', name: 'Garbage Time', blurb: 'Every point you score in the final 5 minutes counts double.' },
  { id: 'emp', icon: '❄️', name: 'EMP', blurb: 'Freeze their drip clock for 10 minutes mid-game — passive points stop cold.' },
  { id: 'momentum', icon: '📈', name: 'Momentum', blurb: 'When your drip goes hot, it runs 3× instead of the usual 2×.' },
];

const actionText = (play: string) => play.replace(/^[A-Z]{2,3}( D| TD)?:\s*/, '');

// Lead changes + final margin across a resolved slot's timeline — how exciting /
// back-and-forth the duel is.
function excitement(events: PbpEvent[]) {
  let flips = 0, prev = 0;
  for (const e of events) {
    const d = (e.youBank ?? 0) - (e.theirBank ?? 0);
    if (Math.sign(d) && prev && Math.sign(d) !== prev) flips++;
    if (Math.sign(d)) prev = Math.sign(d);
  }
  const l = events[events.length - 1];
  return { flips, margin: l ? Math.abs((l.youBank ?? 0) - (l.theirBank ?? 0)) : 0 };
}

type Step = 'pick' | 'metric' | 'power' | 'watch';
interface Duel { winId: WindowId; winLabel: string; slotIndex: number; pos: string; playerId: string; playerName: string; team: string | null; oppName: string; bestMetric: string; flips: number; margin: number; tag: string; maxClock: number; }
interface Featured { gameLabel: string; winLabel: string; you: { player: { id: string; name: string; team: string | null; pos: string }; metricId: string }; their: { player: { id: string; name: string; team: string | null; pos: string }; metricId: string }; events: PbpEvent[]; }

export function GuidedDemo() {
  const { navigate } = useStore();
  const youId = YOU_TEAM_ID;
  const oppId = gameForTeam(youId, DEMO_WEEK)?.oppId;

  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRealWeek(DEMO_WEEK).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  const pts = useMemo(() => realPointsFor(DEMO_WEEK), [ready]);

  // Curate up to three star duels — one per position — each tuned to its most
  // exciting metric (most lead changes, tightest margin). All real engine runs.
  const duels = useMemo<Duel[]>(() => {
    if (!ready || !oppId) return [];
    const base = defaultLineup(youId, DEMO_WEEK);
    const opp = aiLineup(oppId, youId, DEMO_WEEK);
    const scout = buildMatchup(youId, oppId, DEMO_WEEK, base, opp);
    const slots: { winId: WindowId; winLabel: string; slotIndex: number; pos: string; player: any; oppName: string; starPts: number; maxClock: number }[] = [];
    for (const w of scout.windows) for (const s of w.slots) {
      if (!s.you || !s.their || !s.events.length) continue;
      slots.push({ winId: w.window.id as WindowId, winLabel: w.window.label, slotIndex: s.slotIndex, pos: s.you.player.pos, player: s.you.player, oppName: s.their.player.name, starPts: pts[s.you.player.id] ?? 0, maxClock: s.events.reduce((a, e) => Math.max(a, e.clock), 0) });
    }
    const out: Duel[] = [];
    for (const pos of TARGET_POS) {
      const cand = slots.filter((x) => x.pos === pos && x.starPts >= STAR_FLOOR).sort((a, b) => b.starPts - a.starPts)[0];
      if (!cand) continue;
      const key = slotKey(cand.winId, cand.slotIndex);
      let best: { id: string; flips: number; margin: number; score: number } | null = null;
      for (const m of (METRICS[pos] ?? []).filter((mm) => !mm.lock)) {
        const res = buildMatchup(youId, oppId, DEMO_WEEK, { ...base, [key]: { playerId: cand.player.id, metricId: m.id } }, opp);
        const ss = res.windows.find((w) => w.window.id === cand.winId)?.slots.find((x) => x.slotIndex === cand.slotIndex);
        if (!ss) continue;
        const ex = excitement(ss.events);
        const score = ex.flips * 10 - ex.margin * 0.6;
        if (!best || score > best.score) best = { id: m.id, flips: ex.flips, margin: ex.margin, score };
      }
      if (!best) continue;
      const tag = best.margin <= 8 ? 'NAILBITER' : best.flips >= 4 ? 'BACK & FORTH' : best.margin <= 18 ? 'SHOOTOUT' : 'SLUGFEST';
      out.push({ winId: cand.winId, winLabel: cand.winLabel, slotIndex: cand.slotIndex, pos, playerId: cand.player.id, playerName: cand.player.name, team: cand.player.team, oppName: cand.oppName, bestMetric: best.id, flips: best.flips, margin: best.margin, tag, maxClock: cand.maxClock });
    }
    return out.sort((a, b) => (b.flips - a.flips) || (a.margin - b.margin)).slice(0, 3);
  }, [ready, oppId, youId, pts]);

  const [step, setStep] = useState<Step>('pick');
  const [optIdx, setOptIdx] = useState(0);
  const [chosenMetric, setChosenMetric] = useState<string | null>(null);
  const [chosenBuff, setChosenBuff] = useState<string>('garbage-time');
  const opt = duels[optIdx] ?? null;
  const effMetric = chosenMetric ?? opt?.bestMetric ?? null;
  const metricOptions = useMemo(() => (opt ? (METRICS[opt.pos as keyof typeof METRICS] ?? []).filter((m) => !m.lock).slice(0, 4) : []), [opt]);
  const empClock = useMemo(() => (opt ? Math.max(60, Math.round((opt.maxClock * 0.5) / 60) * 60) : 0), [opt]);

  // Resolve the duel the viewer built.
  const matchup = useMemo(() => {
    if (!ready || !oppId || !opt || !effMetric) return null;
    const key = slotKey(opt.winId, opt.slotIndex);
    const youPicks = { ...defaultLineup(youId, DEMO_WEEK), [key]: { playerId: opt.playerId, metricId: effMetric } };
    const buffs = chosenBuff === 'emp' ? {} : { [chosenBuff]: true };
    const extras = chosenBuff === 'emp' ? { emp: { [opt.winId]: empClock } } : {};
    return buildMatchup(youId, oppId, DEMO_WEEK, youPicks, aiLineup(oppId, youId, DEMO_WEEK), {}, {}, {}, buffs, extras);
  }, [ready, oppId, youId, opt, effMetric, chosenBuff, empClock]);

  const featured = useMemo<Featured | null>(() => {
    if (!matchup || !opt) return null;
    const w = matchup.windows.find((w) => w.window.id === opt.winId);
    const s = w?.slots.find((x) => x.slotIndex === opt.slotIndex);
    if (!w || !s || !s.you || !s.their) return null;
    return { gameLabel: s.gameLabel, winLabel: w.window.label, you: s.you, their: s.their, events: s.events };
  }, [matchup, opt]);

  const events = featured?.events ?? [];
  const maxClock = useMemo(() => events.reduce((a, e) => Math.max(a, e.clock), 0), [events]);
  const stepSec = Math.max(1, Math.round(maxClock / TARGET_TICKS));
  const frozenBuff = chosenBuff === 'emp';

  const beats = useMemo<Beat[]>(() => {
    const out = buildBeats(events);
    if (frozenBuff && empClock > 0) out.push({ clock: empClock, key: 'freeze', icon: '❄️', title: 'EMP — FREEZE', body: 'Your EMP fires: the opponent’s drip clock is frozen for 10 minutes. Passive points stop cold — only a touchdown can still score.' });
    return out.sort((a, b) => a.clock - b.clock);
  }, [events, frozenBuff, empClock]);

  const [clock, setClock] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  useEffect(() => { if (step === 'watch') { setClock(0); setEnded(false); setPlaying(true); } }, [step]);

  useEffect(() => {
    if (step !== 'watch' || !playing || maxClock === 0) return;
    const id = setInterval(() => {
      setClock((c) => {
        const n = c + stepSec * speed;
        if (n >= maxClock) { setPlaying(false); setEnded(true); return maxClock; }
        return n;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [step, playing, speed, stepSec, maxClock]);

  const replay = () => { setClock(0); setEnded(false); setPlaying(true); };
  const restart = () => { setOptIdx(0); setChosenMetric(null); setChosenBuff('garbage-time'); setStep('pick'); };

  const frozen = frozenBuff && empClock > 0 && clock >= empClock && clock < empClock + EMP_SECONDS;
  const armedPu = POWER_OPTIONS.find((p) => p.id === chosenBuff);

  const logRef = useRef<HTMLDivElement>(null);
  const revealed = events.filter((e) => e.clock <= clock);
  const youBank = revealed.length ? revealed[revealed.length - 1].youBank : 0;
  const theirBank = revealed.length ? revealed[revealed.length - 1].theirBank : 0;
  const logRows = revealed.filter((e) => e.delta > 0 || e.effect || e.coin || e.sig || e.buffNote).slice(-9);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [logRows.length]);

  const youMet = featured ? METRICS[featured.you.player.pos as keyof typeof METRICS]?.find((x) => x.id === featured.you.metricId) : undefined;
  const theirMet = featured ? METRICS[featured.their.player.pos as keyof typeof METRICS]?.find((x) => x.id === featured.their.metricId) : undefined;

  const activeBeat = beats.reduce<Beat | null>((acc, b) => (b.clock <= clock ? b : acc), null);
  const intro: Beat | null = featured ? {
    clock: 0, key: 'intro', icon: '👀', title: 'KICKOFF',
    body: `You fielded ${featured.you.player.name} on ${youMet?.name ?? 'a hidden metric'} (${youMet?.tag ?? '—'}), armed ${armedPu?.name}. Watch it play out.`,
  } : null;
  const shown = activeBeat ?? intro;

  const header = (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', flexWrap: 'wrap', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}>◈ DRIP FANTASY · DEMO</span>
        <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' }}>← back</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <DemoViewToggle view="clean" onSwitch={(v) => v === 'board' && navigate({ name: 'demo', view: 'board' })} />
        <ThemeSwitcher />
      </div>
    </header>
  );

  if (!opt || !featured) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {header}
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          {(!ready || (duels.length > 0 && !featured))
            ? <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', letterSpacing: '0.08em' }}>Loading the demo…</div>
            : <div className="mono" style={{ fontSize: 12, color: 'var(--dim)' }}>Demo unavailable. <button onClick={() => navigate({ name: 'splash' })} className="mono" style={{ background: 'none', border: 'none', color: 'var(--you)', cursor: 'pointer' }}>← back</button></div>}
        </main>
      </div>
    );
  }

  // ── CHOICE STEPS ──────────────────────────────────────────────────────────
  if (step !== 'watch') {
    const order: Step[] = ['pick', 'metric', 'power'];
    const idx = order.indexOf(step);
    const titles = ['Pick your star', 'Choose its hidden metric', 'Arm a power-up'];
    const subs = [
      'Three star players, three positions — each a live, back-and-forth duel off real Week 4 plays. Pick one.',
      'Your metric is hidden from your opponent. It decides how this player scores — and how he attacks theirs.',
      'One power-up can tilt the whole game. Pick how you’ll swing it.',
    ];
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {header}
        <main style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '18px 16px 40px' }}>
          <div style={{ width: '100%', maxWidth: 480 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 12 }}>
              {order.map((s, i) => (
                <span key={s} style={{ width: i === idx ? 22 : 7, height: 7, borderRadius: 4, background: i <= idx ? 'var(--you)' : 'var(--bd)', transition: 'all .2s' }} />
              ))}
            </div>
            <div style={{ textAlign: 'center', marginBottom: 4 }}>
              <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)' }}>STEP {idx + 1} OF 3{idx > 0 ? ` · ${opt.playerName.toUpperCase()}` : ''}</div>
              <div className="grotesk" style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginTop: 4 }}>{titles[idx]}</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, lineHeight: 1.45 }}>{subs[idx]}</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginTop: 16 }}>
              {step === 'pick' && duels.map((d, i) => {
                const on = optIdx === i;
                return (
                  <button key={d.playerId} onClick={() => { setOptIdx(i); setChosenMetric(null); }} style={optCard(on)}>
                    <PlayerImg playerId={d.playerId} team={d.team} pos={d.pos as any} size={44} />
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.playerName}</div>
                      <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.04em', marginTop: 2 }}>{d.pos} · {d.team} · vs {d.oppName}</div>
                    </div>
                    <span className="mono" style={{ flex: 'none', fontSize: 7.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--fx-streak)', border: '1px solid color-mix(in srgb, var(--fx-streak) 45%, transparent)', background: 'color-mix(in srgb, var(--fx-streak) 12%, transparent)', borderRadius: 3, padding: '2px 5px' }}>🔥 {d.tag}</span>
                    {on && <span style={tick}>✓</span>}
                  </button>
                );
              })}

              {step === 'metric' && metricOptions.map((m) => {
                const on = effMetric === m.id;
                return (
                  <button key={m.id} onClick={() => setChosenMetric(m.id)} style={{ ...optCard(on), alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <span className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{m.name}</span>
                        <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', border: '1px solid color-mix(in srgb, var(--you) 45%, transparent)', background: 'color-mix(in srgb, var(--you) 12%, transparent)', borderRadius: 3, padding: '1px 5px' }}>{m.tag}</span>
                        {m.id === opt.bestMetric && <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--fx-streak)' }}>★ liveliest</span>}
                      </div>
                      <div style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.4 }}>{m.ef}</div>
                    </div>
                    {on && <span style={{ ...tick, alignSelf: 'center' }}>✓</span>}
                  </button>
                );
              })}

              {step === 'power' && POWER_OPTIONS.map((pu) => {
                const on = chosenBuff === pu.id;
                return (
                  <button key={pu.id} onClick={() => setChosenBuff(pu.id)} style={{ ...optCard(on), alignItems: 'flex-start' }}>
                    <span style={{ fontSize: 24, lineHeight: 1 }}>{pu.icon}</span>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{pu.name}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.4 }}>{pu.blurb}</div>
                    </div>
                    {on && <span style={{ ...tick, alignSelf: 'center' }}>✓</span>}
                  </button>
                );
              })}
            </div>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              {idx > 0 && <button onClick={() => setStep(order[idx - 1])} className="mono" style={{ ...ctlBtn, flex: 'none' }}>← back</button>}
              <button onClick={() => setStep(idx < 2 ? order[idx + 1] : 'watch')} className="mono" style={{ ...cta, flex: 1, width: 'auto' }}>{idx < 2 ? 'Next →' : '▶ Watch it play out'}</button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── WATCH ─────────────────────────────────────────────────────────────────
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
            <PlayerImg playerId={p.player.id} team={p.player.team} pos={p.player.pos as any} size={44} />
            {isFrozen && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, textShadow: '0 0 6px rgba(0,0,0,.6)' }}>❄️</span>}
          </div>
          <div style={{ minWidth: 0, textAlign: right ? 'right' : 'left' }}>
            <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.player.name}</div>
            <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.04em', marginTop: 2 }}>{p.player.pos} · {p.player.team}</div>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7, justifyContent: right ? 'flex-end' : 'flex-start' }}>
          <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 12%, transparent)`, borderRadius: 3, padding: '2px 6px' }}>{met?.name ?? 'metric'} · {met?.tag ?? ''}</span>
          {side === 'you' && armedPu && <span className="mono" style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--fx-streak)', border: '1px solid color-mix(in srgb, var(--fx-streak) 45%, transparent)', background: 'color-mix(in srgb, var(--fx-streak) 12%, transparent)', borderRadius: 3, padding: '2px 6px' }}>{armedPu.icon} {armedPu.name.toUpperCase()}</span>}
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
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' }}>Your duel, live</div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6 }}>The star, metric and power-up you chose — scored off real NFL plays.</div>
          </div>

          {/* the duel */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 16 }}>
            <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--faint)', textAlign: 'center', marginBottom: 12 }}>{featured.winLabel} · {featured.gameLabel}</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <Side side="you" />
              <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.14em', paddingTop: 14 }}>VS</div>
              <Side side="their" />
            </div>
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

          {/* two-sided play log */}
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
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button onClick={() => (ended ? replay() : setPlaying((p) => !p))} className="mono" style={ctlBtn}>{ended ? '↺ REPLAY' : playing ? '❚❚ PAUSE' : '▶ PLAY'}</button>
            {!ended && <button onClick={replay} className="mono" style={ctlBtn}>↺ RESTART</button>}
            {!ended && <button onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))} className="mono" style={ctlBtn}>{speed}×</button>}
            <button onClick={restart} className="mono" style={ctlBtn}>↩ CHANGE PICKS</button>
          </div>

          {/* end card */}
          {ended && (
            <div style={{ marginTop: 18, background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: 18, textAlign: 'center' }}>
              <div className="grotesk" style={{ fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>{youBank >= theirBank ? 'You took it.' : Math.abs(youBank - theirBank) <= 8 ? 'So close.' : 'That one got away.'} That’s one slot.</div>
              <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>Every star, every hidden metric, every power-up — your call, across all eight slots. Now run it with your own team:</div>
              <div style={{ marginTop: 14 }}><SleeperHandoff /></div>
              <button onClick={() => navigate({ name: 'live' })} className="mono" style={{ ...cta, marginTop: 12, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--bd)' }}>join the live H2H pilot →</button>
              <button onClick={restart} className="mono" style={{ background: 'none', border: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', cursor: 'pointer', marginTop: 12 }}>↩ make different picks</button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const ctlBtn: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 14px', cursor: 'pointer' };
const cta: React.CSSProperties = { width: '100%', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '12px 0', cursor: 'pointer' };
const tick: React.CSSProperties = { flex: 'none', fontSize: 13, fontWeight: 700, color: 'var(--you)' };
const optCard = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 13px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', background: on ? 'color-mix(in srgb, var(--you) 9%, var(--surface))' : 'var(--surface)', border: `1.5px solid ${on ? 'var(--you)' : 'var(--bd)'}`, boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--you) 14%, transparent)' : 'none', transition: 'all .15s' });
