import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings, VersionTag, PlayerImg, Avatar } from '../app/ui';
import { buildMatchup, defaultLineup, aiLineup, slotKey, banksAtClock, type ResolvedSlot } from '../engine/matchup';
import { YOU_TEAM_ID, gameForTeam, getTeam } from '../data/league';
import { DEMO_WEEK } from '../config';
import { METRICS } from '../data/metrics';
import { loadRealWeek, realPointsFor } from '../data/realPbp';
import { gamesInWindow } from '../data/nflSlate';
import { FX_COLOR, fmtClock, buildBeats, type Beat } from '../data/demoNarration';
import { avatarUrl } from '../data/media';
import { getProvider } from '../data/providers';
import { prefetchPlayerDirectory } from '../data/sleeperPlayers';
import { SlotFieldViews } from '../app/FieldView';
import { RequestCodeModal } from './RequestCode';
import { Faq } from './Faq';
import { DemoViewToggle } from './DemoOverlay';
import { track, Ev } from '../app/analytics';
import type { Player, WindowId } from '../types';

// The logged-out landing page IS the demo: one Drip Test League board (Week 2,
// Taco Time Titans vs Beach Day Ballers) rendered as a tight version of the
// hero board — both lineups by real game window, sealed opponent picks, hidden
// metrics, a power-up, and a RUN that plays the week out window by window.
// Engagement follows the guided-demo playbook: value before any ask (no gate),
// a couple of real decisions (star → metric → power-up) with everything else
// defaulted, then the identity ask ("More demo?" → Sleeper username) only
// after the payoff. All scoring is the real engine on real 2025 plays.

const TICK_MS = 400;
const EMP_SECONDS = 600;   // EMP freezes opponent drip for 10:00
const STAR_POS = ['QB', 'RB', 'WR', 'TE'] as const;

// The three power-ups offered as the third decision (each a real engine effect).
const POWER_OPTIONS = [
  { id: 'garbage-time', icon: '🗑️', name: 'Garbage Time', blurb: 'Every point you score in the final 5 minutes counts double.' },
  { id: 'emp', icon: '❄️', name: 'EMP', blurb: 'Freeze their drip clock for 10 minutes mid-game — passive points stop cold.' },
  { id: 'momentum', icon: '📈', name: 'Momentum', blurb: 'When your drip goes hot, it runs 3× instead of the usual 2×.' },
];

type Step = 'star' | 'metric' | 'power' | 'watch';
interface Star { key: string; winId: WindowId; winLabel: string; slotIndex: number; player: Player; oppName: string; pts: number; }

export function DemoBoard() {
  const { navigate, sleeperUser, setSleeperUser, isSimLeague, exitSimLeague } = useStore();
  // Coming back from a Sleeper sim: restore the baked Drip Test League so the
  // board always builds from the demo rosters.
  useEffect(() => { if (isSimLeague) exitSimLeague(); }, [isSimLeague, exitSimLeague]);
  useEffect(() => { track(Ev.screenView, { screen: 'demo-board', week: DEMO_WEEK }); }, []);

  const youId = YOU_TEAM_ID;
  const oppId = gameForTeam(youId, DEMO_WEEK)?.oppId;
  const youTeam = getTeam(youId);
  const oppTeam = oppId ? getTeam(oppId) : undefined;

  const [ready, setReady] = useState(false);
  useEffect(() => {
    let alive = true;
    loadRealWeek(DEMO_WEEK).then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);
  const pts = useMemo(() => realPointsFor(DEMO_WEEK), [ready]); // curation only — never shown

  const base = useMemo(() => (ready ? defaultLineup(youId, DEMO_WEEK) : {}), [ready, youId]);
  const oppPicks = useMemo(() => (ready && oppId ? aiLineup(oppId, youId, DEMO_WEEK) : {}), [ready, oppId, youId]);
  const scout = useMemo(() => (ready && oppId ? buildMatchup(youId, oppId, DEMO_WEEK, base, oppPicks) : null), [ready, oppId, youId, base, oppPicks]);

  // The star choices: your best contested duel at each of QB/RB/WR/TE, top 3.
  const stars = useMemo<Star[]>(() => {
    if (!scout) return [];
    const byPos: Record<string, Star> = {};
    for (const w of scout.windows) for (const s of w.slots) {
      if (!s.you || !s.their || !s.events.length) continue;
      const p = s.you.player;
      if (!(STAR_POS as readonly string[]).includes(p.pos)) continue;
      const v = pts[p.id] ?? 0;
      if (!byPos[p.pos] || v > byPos[p.pos].pts) {
        byPos[p.pos] = { key: slotKey(w.window.id, s.slotIndex), winId: w.window.id, winLabel: w.window.label, slotIndex: s.slotIndex, player: p, oppName: s.their.player.name, pts: v };
      }
    }
    return Object.values(byPos).sort((a, b) => b.pts - a.pts).slice(0, 3);
  }, [scout, pts]);

  // ── The three decisions ────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>('star');
  const [starIdx, setStarIdx] = useState(0);
  const star = stars[starIdx] ?? null;
  const [chosenMetric, setChosenMetric] = useState<string | null>(null);
  const effMetric = chosenMetric ?? (star ? base[star.key]?.metricId ?? null : null);
  const metricOptions = useMemo(() => (star ? (METRICS[star.player.pos] ?? []).filter((m) => !m.lock && m.id !== 'fg').slice(0, 4) : []), [star]);
  const [chosenBuff, setChosenBuff] = useState('garbage-time');
  const armedPu = POWER_OPTIONS.find((p) => p.id === chosenBuff);

  const starWinMax = useMemo(() => {
    const w = scout?.windows.find((x) => x.window.id === star?.winId);
    return w ? w.slots.reduce((a, s) => s.events.reduce((m, e) => Math.max(m, e.clock), a), 0) : 0;
  }, [scout, star]);
  const empClock = Math.max(60, Math.round((starWinMax * 0.5) / 60) * 60);

  // Resolve the full week the viewer built — every slot, both sides, for real.
  const resolved = useMemo(() => {
    if (!ready || !oppId || !star || !effMetric) return null;
    const youPicks = { ...base, [star.key]: { playerId: star.player.id, metricId: effMetric } };
    const buffs = chosenBuff === 'emp' ? {} : { [chosenBuff]: true };
    const extras = chosenBuff === 'emp' ? { emp: { [star.winId]: empClock } } : {};
    return buildMatchup(youId, oppId, DEMO_WEEK, youPicks, oppPicks, {}, {}, {}, buffs, extras);
  }, [ready, oppId, youId, star, effMetric, chosenBuff, base, oppPicks, empClock]);

  const winMaxes = useMemo(() => (resolved ? resolved.windows.map((w) => w.slots.reduce((a, s) => s.events.reduce((m, e) => Math.max(m, e.clock), a), 0)) : []), [resolved]);

  // ── Window-sequenced playout (Thu → Sun early → Sun late → SNF → MNF) ──────
  const [wIdx, setWIdx] = useState(0);
  const [wClock, setWClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);

  const run = () => {
    track(Ev.demoRun, { star: star?.player.id ?? null, metric: effMetric, powerup: chosenBuff });
    setWIdx(0); setWClock(0); setEnded(false); setPlaying(true); setStep('watch');
  };
  const replay = () => { setWIdx(0); setWClock(0); setEnded(false); setPlaying(true); };
  const changePicks = () => { setPlaying(false); setEnded(false); setWIdx(0); setWClock(0); setStep('star'); };

  useEffect(() => {
    if (step !== 'watch' || !playing || ended || !resolved) return;
    const id = setInterval(() => {
      setWClock((c) => {
        const max = winMaxes[wIdx] ?? 0;
        const slots = resolved.windows[wIdx]?.slots.length ?? 1;
        const ticks = 16 + 5 * (slots - 1); // ~6-13s per window at 1×
        const stepSec = Math.max(30, Math.ceil(max / ticks));
        const n = c + stepSec * speed;
        if (n >= max) {
          if (wIdx + 1 < resolved.windows.length) { setWIdx(wIdx + 1); return 0; }
          setPlaying(false); setEnded(true); return max;
        }
        return n;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [step, playing, ended, wIdx, speed, resolved, winMaxes]);

  type WinState = 'upcoming' | 'live' | 'final';
  const winState = (i: number): WinState => {
    if (step !== 'watch') return 'upcoming';
    if (ended || i < wIdx) return 'final';
    return i === wIdx ? 'live' : 'upcoming';
  };
  const slotBanks = (s: ResolvedSlot, st: WinState) => {
    // An unopposed player is a BACKUP: it banks nothing in its own slot (its
    // score can sub into a starter slot at FINAL), so never tick it live —
    // the total would visibly drop when the engine zeroes it at the end.
    if (s.backup) return { you: 0, their: 0 };
    return st === 'final' ? { you: s.youFinal, their: s.theirFinal }
      : st === 'live' ? banksAtClock(s.events, wClock)
        : { you: 0, their: 0 };
  };

  let youTot = 0, theirTot = 0;
  if (resolved) {
    if (ended) { youTot = resolved.youFinal; theirTot = resolved.theirFinal; }
    else resolved.windows.forEach((w, i) => w.slots.forEach((s) => { const b = slotBanks(s, winState(i)); youTot += b.you; theirTot += b.their; }));
  }

  // Narration: teaching beats from the live window's merged events (+ the EMP).
  const beats = useMemo<Beat[]>(() => {
    const w = resolved?.windows[wIdx];
    if (!w) return [];
    const out = buildBeats(w.slots.flatMap((s) => s.events));
    if (chosenBuff === 'emp' && star && w.window.id === star.winId) {
      out.push({ clock: empClock, key: 'freeze', icon: '❄️', title: 'EMP — FREEZE', body: 'Your EMP fires: the opponent’s drip clock is frozen for 10 minutes. Passive points stop cold — only a touchdown can still score.' });
    }
    return out.sort((a, b) => a.clock - b.clock);
  }, [resolved, wIdx, chosenBuff, star, empClock]);
  const liveWin = resolved?.windows[wIdx];
  const winIntro: Beat | null = liveWin ? {
    clock: 0, key: 'intro', icon: '🏈', title: `${liveWin.window.label} — KICKOFF`,
    body: wIdx === 0
      ? 'The seal breaks: both sides’ players AND hidden metrics for this window are revealed only now, at kickoff. Watch the banks build.'
      : `${liveWin.window.sub} kicks off — the next sealed picks flip face-up.`,
  } : null;
  const activeBeat = beats.reduce<Beat | null>((acc, b) => (b.clock <= wClock ? b : acc), null) ?? winIntro;

  const featured = star ? resolved?.windows.find((w) => w.window.id === star.winId)?.slots.find((s) => s.slotIndex === star.slotIndex) ?? null : null;
  const frozen = chosenBuff === 'emp' && !!star && liveWin?.window.id === star.winId && wClock >= empClock && wClock < empClock + EMP_SECONDS && !ended;

  // ── "More demo?" — the persistent Sleeper handoff ──────────────────────────
  const [name, setName] = useState(sleeperUser?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const moreRef = useRef<HTMLInputElement>(null);
  const submitSleeper = async () => {
    const u = name.trim();
    if (!u || busy) return;
    setBusy(true); setErr(null);
    try {
      const user = await getProvider().resolveUser(u);
      if (!user) { setErr(`No Sleeper user “${u}”. Check the spelling.`); setBusy(false); return; }
      setSleeperUser(user);
      prefetchPlayerDirectory(); // ~5MB directory downloads while they browse leagues
      navigate({ name: 'leagues' });
    } catch {
      setErr('Could not reach Sleeper. Check your connection and try again.');
      setBusy(false);
    }
  };

  const [requesting, setRequesting] = useState(false);
  const [faq, setFaq] = useState(false);

  const header = (
    <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', flexWrap: 'wrap', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}>◈ DRIP FANTASY</span>
        {sleeperUser && <button onClick={() => navigate({ name: 'leagues' })} className="mono" style={chipBtn}>← {sleeperUser.displayName}’s leagues</button>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate({ name: 'live' })} className="mono" style={linkBtn}>sign in</button>
        <span style={{ color: 'var(--faint)' }}>·</span>
        <button onClick={() => setFaq(true)} className="mono" style={linkBtn}>FAQ</button>
        <DemoViewToggle view="clean" onSwitch={(v) => v === 'board' && navigate({ name: 'demo', view: 'board' })} />
        <VersionTag />
        <SiteSettings />
      </div>
    </header>
  );

  if (!ready || !resolved || !star || !youTeam || !oppTeam) {
    const broken = ready && scout && !stars.length;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {header}
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', letterSpacing: '0.08em' }}>
            {broken ? 'Demo unavailable — try the full board from the header toggle.' : 'Loading the demo board…'}
          </div>
        </main>
      </div>
    );
  }

  const stepOrder: Step[] = ['star', 'metric', 'power'];
  const stepIdx = stepOrder.indexOf(step); // -1 during watch
  const prompts: Record<Exclude<Step, 'watch'>, { title: string; sub: string }> = {
    star: { title: 'Pick your star', sub: 'Three of your stars, three positions — each in a live duel against one of their picks. Your choice slots into the board below.' },
    metric: { title: `Seal ${star.player.name}’s hidden metric`, sub: 'The metric decides HOW he scores — and how he attacks their player. Your opponent can’t see it until his game kicks off.' },
    power: { title: 'Arm one power-up', sub: 'Power-ups bend the live game. Arm one, then run the week and watch every window play out.' },
  };

  // ── Board pieces ───────────────────────────────────────────────────────────
  const scoreHdr = (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: '14px 14px 12px' }}>
      <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.16em', color: 'var(--faint)', textAlign: 'center' }}>DRIP TEST LEAGUE · WEEK {DEMO_WEEK} · REAL 2025 PLAYS</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <TeamSide team={youTeam.name} owner={youTeam.owner} ownerId={youTeam.ownerId} score={youTot} accent="var(--you)" you />
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.12em', flex: 'none' }}>
          {step === 'watch' && !ended && liveWin ? <span style={{ color: 'var(--you)' }}>{liveWin.window.label} · {fmtClock(wClock)}</span> : ended ? <span style={{ color: 'var(--you)' }}>FINAL</span> : 'VS'}
        </div>
        <TeamSide team={oppTeam.name} owner={oppTeam.owner} ownerId={oppTeam.ownerId} score={theirTot} accent="var(--opp)" />
      </div>
    </div>
  );

  const windowCards = resolved.windows.map((w, i) => {
    const st = winState(i);
    const games = gamesInWindow(DEMO_WEEK, w.window.id).length;
    const isStarWin = w.window.id === star.winId;
    return (
      <div key={w.window.id} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, marginTop: 10, overflow: 'hidden', opacity: step === 'watch' && st === 'upcoming' ? 0.65 : 1, transition: 'opacity .3s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--bg)' }}>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text)' }}>{w.window.label}</span>
          <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{w.window.time}{games > 0 ? ` · ${games} game${games > 1 ? 's' : ''}` : ''}</span>
          <span style={{ flex: 1 }} />
          {st === 'upcoming' && <span className="mono" style={{ ...stateChip, color: 'var(--dim)', borderColor: 'var(--bd)' }}>🔒 SEALED</span>}
          {st === 'live' && <span className="mono" style={{ ...stateChip, color: 'var(--you)', borderColor: 'color-mix(in srgb, var(--you) 45%, transparent)' }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: 'var(--you)', marginRight: 5, animation: 'bpulse 1.2s infinite' }} />LIVE</span>}
          {st === 'final' && <span className="mono" style={{ ...stateChip, color: 'var(--dim)', borderColor: 'var(--bd)' }}>FINAL</span>}
        </div>
        {w.slots.map((s) => {
          const b = slotBanks(s, st);
          const isFeatured = isStarWin && s.slotIndex === star.slotIndex;
          return (
            <SlotRow key={s.slotIndex} slot={s} state={st} you={b.you} their={b.their}
              featured={isFeatured && step !== 'watch'} frozen={isFeatured && frozen}
              armedPu={isFeatured && step === 'watch' ? armedPu : undefined} />
          );
        })}
        {/* the featured duel's live field — the same drive chart as the real board */}
        {isStarWin && st === 'live' && featured?.you && featured.their && (
          <div style={{ padding: '0 10px 10px' }}>
            <SlotFieldViews week={DEMO_WEEK} youTeam={featured.you.player.team} theirTeam={featured.their.player.team} youClock={wClock} theirClock={wClock} />
          </div>
        )}
      </div>
    );
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {header}
      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '6px 14px 96px' }}>
        <div style={{ width: '100%', maxWidth: 520 }}>
          {/* hero one-liner */}
          <div style={{ textAlign: 'center', margin: '6px 0 14px' }}>
            <div className="grotesk" style={{ fontSize: 'clamp(19px, 5.5vw, 26px)', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.15 }}>
              Fantasy football, but the picks are <span style={{ color: 'var(--you)' }}>sealed</span> and the game is <span style={{ color: 'var(--you)' }}>live</span>.
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 7, lineHeight: 1.5 }}>
              This is a real week from the Drip Test League. Make three calls, hit run, and watch it play out — in about a minute.
            </div>
          </div>

          {scoreHdr}

          {/* step prompt / watch narration / end card — always directly under the score */}
          {step !== 'watch' && (
            <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: '12px 14px', marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {stepOrder.map((s, i) => (
                  <span key={s} style={{ width: i === stepIdx ? 20 : 7, height: 7, borderRadius: 4, background: i <= stepIdx ? 'var(--you)' : 'var(--bd)', transition: 'all .2s' }} />
                ))}
                <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', marginLeft: 4 }}>STEP {stepIdx + 1} OF 3</span>
              </div>
              <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>{prompts[step as Exclude<Step, 'watch'>].title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.45 }}>{prompts[step as Exclude<Step, 'watch'>].sub}</div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                {step === 'star' && stars.map((d, i) => {
                  const on = starIdx === i;
                  return (
                    <button key={d.player.id} onClick={() => { setStarIdx(i); setChosenMetric(null); }} style={optCard(on)}>
                      <PlayerImg playerId={d.player.id} team={d.player.team} pos={d.player.pos} size={40} />
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div className="grotesk" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.player.name}</div>
                        <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', letterSpacing: '0.04em', marginTop: 2 }}>{d.player.pos} · {d.player.team} · {d.winLabel} · duels {d.oppName}</div>
                      </div>
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
                          <span className="grotesk" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{m.name}</span>
                          <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--you)', border: '1px solid color-mix(in srgb, var(--you) 45%, transparent)', background: 'color-mix(in srgb, var(--you) 12%, transparent)', borderRadius: 3, padding: '1px 5px' }}>{m.tag}</span>
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
                      <span style={{ fontSize: 22, lineHeight: 1 }}>{pu.icon}</span>
                      <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                        <div className="grotesk" style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>{pu.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.4 }}>{pu.blurb}</div>
                      </div>
                      {on && <span style={{ ...tick, alignSelf: 'center' }}>✓</span>}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                {stepIdx > 0 && <button onClick={() => setStep(stepOrder[stepIdx - 1])} className="mono" style={{ ...ctlBtn, flex: 'none' }}>← back</button>}
                <button
                  onClick={() => {
                    if (stepIdx < 2) { track(Ev.demoStep, { step: stepOrder[stepIdx + 1] }); setStep(stepOrder[stepIdx + 1]); }
                    else run();
                  }}
                  className="mono" style={{ ...cta, flex: 1, width: 'auto' }}
                >
                  {stepIdx < 2 ? 'Next →' : `▶ RUN WEEK ${DEMO_WEEK}`}
                </button>
              </div>
            </div>
          )}

          {step === 'watch' && !ended && (
            <div style={{ minHeight: 78, marginTop: 10, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: `3px solid ${activeBeat && FX_COLOR[activeBeat.key] ? FX_COLOR[activeBeat.key] : 'var(--you)'}`, borderRadius: 8, padding: '11px 13px', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 21, lineHeight: 1 }}>{activeBeat?.icon}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: activeBeat && FX_COLOR[activeBeat.key] ? FX_COLOR[activeBeat.key] : 'var(--you)' }}>{activeBeat?.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text)', marginTop: 3, lineHeight: 1.45 }}>{activeBeat?.body}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                <button onClick={() => setPlaying((p) => !p)} className="mono" style={miniBtn}>{playing ? '❚❚' : '▶'}</button>
                <button onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))} className="mono" style={miniBtn}>{speed}×</button>
              </div>
            </div>
          )}

          {ended && (
            <div style={{ marginTop: 10, background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
              <div className="grotesk" style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>
                {youTot >= theirTot ? `You took Week ${DEMO_WEEK}, ` : `They edged you, `}{Math.max(youTot, theirTot).toFixed(1)}–{Math.min(youTot, theirTot).toFixed(1)}.
              </div>
              {resolved.bonuses?.map((b) => (
                <div key={b.id} className="mono" style={{ fontSize: 9.5, color: 'var(--you)', marginTop: 5 }}>◇ {b.label} ({b.points > 0 ? '+' : ''}{b.points})</div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 7, lineHeight: 1.5 }}>
                Every duel you just watched was sealed picks, hidden metrics, and live effects on real NFL plays. Now picture it with your own roster.
              </div>
              <button onClick={() => { moreRef.current?.focus(); moreRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }} className="mono" style={{ ...cta, marginTop: 12 }}>
                More demo — run it with YOUR league →
              </button>
              <button onClick={() => setRequesting(true)} className="mono" style={{ ...cta, marginTop: 8, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--bd)' }}>
                ◈ Request a code for your league
              </button>
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 10 }}>
                <button onClick={replay} className="mono" style={linkBtn}>↺ replay</button>
                <button onClick={changePicks} className="mono" style={linkBtn}>↩ different picks</button>
                <button onClick={() => navigate({ name: 'live' })} className="mono" style={linkBtn}>sign in</button>
              </div>
            </div>
          )}

          {/* the board */}
          {windowCards}

          {/* effect legend during playout */}
          {step === 'watch' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', marginTop: 12 }}>
              {[['💧', 'DRIP'], ['💥', 'NUKE'], ['🩸', 'ERASE'], ['🗑️', 'POWER-UP'], ['❄️', 'EMP'], ['◇', 'COIN']].map(([icon, label]) => (
                <span key={label} className="mono" style={{ fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--faint)' }}>{icon} {label}</span>
              ))}
            </div>
          )}

          {/* request-a-code — the standing CTA under the board */}
          <div style={{ marginTop: 16, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
            <div className="grotesk" style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>Want this on your real league?</div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>We’ll set it up and send you a code — Sleeper · ESPN · MFL · Fleaflicker.</div>
            <button onClick={() => setRequesting(true)} className="mono" style={{ ...cta, marginTop: 10 }}>◈ Request a code for your league</button>
          </div>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 14 }}>
            <button onClick={() => navigate({ name: 'live' })} className="mono" style={linkBtn}>◈ Already invited? Sign in</button>
            <span style={{ color: 'var(--faint)' }}>·</span>
            <button onClick={() => setFaq(true)} className="mono" style={linkBtn}>Read the FAQ</button>
          </div>
        </div>
      </main>

      {/* persistent "More demo?" bar — the identity ask, always one glance away */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: 'color-mix(in srgb, var(--bg) 90%, transparent)', backdropFilter: 'blur(8px)', borderTop: '1px solid var(--bd)', padding: '9px 14px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', flex: 'none' }}>MORE DEMO?</span>
            <input
              ref={moreRef}
              value={name}
              onChange={(e) => { setName(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSleeper(); }}
              placeholder="your Sleeper username → your leagues"
              spellCheck={false} autoCapitalize="none" autoCorrect="off"
              style={{ flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 11px', outline: 'none' }}
            />
            <button onClick={submitSleeper} disabled={busy || !name.trim()} className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '9px 14px', cursor: busy ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
              {busy ? '…' : 'GO →'}
            </button>
          </div>
          {err && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginTop: 6 }}>{err}</div>}
        </div>
      </div>

      {requesting && <RequestCodeModal initialPlatform={sleeperUser ? 'Sleeper' : ''} onClose={() => setRequesting(false)} />}
      {faq && <Faq onClose={() => setFaq(false)} />}
    </div>
  );
}

// ── Presentational bits ───────────────────────────────────────────────────────

function TeamSide({ team, owner, ownerId, score, accent, you }: { team: string; owner: string; ownerId: string; score: number; accent: string; you?: boolean }) {
  const right = !you;
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: right ? 'right' : 'left' }}>
      <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 7 }}>
        <Avatar name={team} accent={accent} size={26} src={avatarUrl(ownerId)} />
        <div style={{ minWidth: 0 }}>
          <div className="grotesk" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{team}</div>
          <div className="mono" style={{ fontSize: 8, color: 'var(--faint)', marginTop: 1 }}>{you ? 'YOU · ' : ''}@{owner}</div>
        </div>
      </div>
      <div className="grotesk" style={{ fontSize: 30, fontWeight: 700, color: accent, marginTop: 6, lineHeight: 1 }}>{score.toFixed(1)}</div>
    </div>
  );
}

function MetricChip({ pos, metricId }: { pos: Player['pos']; metricId: string | null }) {
  const m = (METRICS[pos] ?? []).find((x) => x.id === metricId);
  if (!m) return null;
  const color = FX_COLOR[m.fx] ?? 'var(--you)';
  return (
    <span className="mono" title={m.ef} style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.06em', color, border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`, background: `color-mix(in srgb, ${color} 10%, transparent)`, borderRadius: 3, padding: '1px 5px', whiteSpace: 'nowrap' }}>
      {m.name} · {m.tag}
    </span>
  );
}

function SlotRow({ slot, state, you, their, featured, frozen, armedPu }: {
  slot: ResolvedSlot; state: 'upcoming' | 'live' | 'final'; you: number; their: number;
  featured?: boolean; frozen?: boolean; armedPu?: { icon: string; name: string };
}) {
  const sealed = state === 'upcoming'; // opponent picks + metrics unseal at kickoff
  const side = (who: 'you' | 'their') => {
    const pick = who === 'you' ? slot.you : slot.their;
    const right = who === 'their';
    if (!pick) {
      return <div className="mono" style={{ flex: 1, minWidth: 0, fontSize: 8.5, color: 'var(--faint)', textAlign: right ? 'right' : 'left' }}>{who === 'you' ? '— empty —' : slot.you ? 'UNOPPOSED · you bank a backup' : '—'}</div>;
    }
    if (who === 'their' && sealed) {
      return (
        <div style={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
          <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', border: '1px dashed var(--bd)', borderRadius: 5, padding: '7px 10px' }}>🔒 SEALED PICK</span>
        </div>
      );
    }
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 7 }}>
        <div style={{ position: 'relative', flex: 'none', filter: who === 'their' && frozen ? 'grayscale(0.6) brightness(0.9)' : undefined }}>
          <PlayerImg playerId={pick.player.id} team={pick.player.team} pos={pick.player.pos} size={30} />
          {who === 'their' && frozen && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>❄️</span>}
        </div>
        <div style={{ minWidth: 0, textAlign: right ? 'right' : 'left' }}>
          <div className="grotesk" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pick.player.name}</div>
          <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 3, marginTop: 2, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 7.5, color: 'var(--faint)' }}>{pick.player.pos} · {pick.player.team}</span>
            {(who === 'you' || !sealed) && <MetricChip pos={pick.player.pos} metricId={pick.metricId} />}
            {who === 'you' && armedPu && <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, color: 'var(--fx-streak, #36D399)' }}>{armedPu.icon} {armedPu.name.toUpperCase()}</span>}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--bd)', ...(featured ? { boxShadow: 'inset 3px 0 0 var(--you), 0 0 0 1px color-mix(in srgb, var(--you) 35%, transparent)', background: 'color-mix(in srgb, var(--you) 6%, transparent)' } : {}) }}>
      {side('you')}
      <div className="mono" style={{ flex: 'none', minWidth: 68, textAlign: 'center' }}>
        {state === 'upcoming'
          ? <span style={{ fontSize: 9, color: 'var(--faint)' }}>–&nbsp;·&nbsp;–</span>
          : <span style={{ fontSize: 11.5, fontWeight: 700 }}>
              <span style={{ color: 'var(--you)' }}>{you.toFixed(1)}</span>
              <span style={{ color: 'var(--faint)' }}> · </span>
              <span style={{ color: 'var(--opp)' }}>{their.toFixed(1)}</span>
            </span>}
      </div>
      {side('their')}
    </div>
  );
}

const chipBtn: React.CSSProperties = { fontSize: 9, letterSpacing: '0.08em', color: 'var(--dim)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4, padding: '5px 8px', cursor: 'pointer' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
const stateChip: React.CSSProperties = { fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', border: '1px solid', borderRadius: 3, padding: '2px 6px', display: 'inline-flex', alignItems: 'center' };
const ctlBtn: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '8px 14px', cursor: 'pointer' };
const miniBtn: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 5, padding: '5px 9px', cursor: 'pointer' };
const cta: React.CSSProperties = { width: '100%', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 7, padding: '12px 0', cursor: 'pointer' };
const tick: React.CSSProperties = { flex: 'none', fontSize: 13, fontWeight: 700, color: 'var(--you)' };
const optCard = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', background: on ? 'color-mix(in srgb, var(--you) 9%, var(--surface))' : 'var(--surface)', border: `1.5px solid ${on ? 'var(--you)' : 'var(--bd)'}`, boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--you) 14%, transparent)' : 'none', transition: 'all .15s' });
