import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings, VersionTag, PlayerImg, Avatar, useIsMobile } from '../app/ui';
import { buildMatchup, defaultLineup, aiLineup, slotKey, slotsFor, windowPools, byePlayers, banksAtClock, type ResolvedSlot } from '../engine/matchup';
import { YOU_TEAM_ID, gameForTeam, getTeam } from '../data/league';
import { DEMO_WEEK } from '../config';
import { METRICS } from '../data/metrics';
import { loadRealWeek } from '../data/realPbp';
import { gamesInWindow, windowsForWeek } from '../data/nflSlate';
import { FX_COLOR, fmtClock, buildBeats, type Beat } from '../data/demoNarration';
import { avatarUrl } from '../data/media';
import { getProvider } from '../data/providers';
import { prefetchPlayerDirectory } from '../data/sleeperPlayers';
import { getSession } from '../data/liveApi';
import { SlotFieldViews } from '../app/FieldView';
import { SetupRow, PlayerPicker, RosterAside, ScoutModal } from './Matchup';
import { RequestCodeModal } from './RequestCode';
import { Faq } from './Faq';
import { track, Ev } from '../app/analytics';
import { PuIcon, FxIcon, GameIcon, Emoji, COIN_GOLD, BRAND_MARK } from '../app/gameIcons';
import type { Pick, Player, WindowId } from '../types';

const actionText = (play: string) => play.replace(/^[A-Z]{2,3}( D| TD)?:\s*/, '');

// A signed-in player who lands here (first OAuth redirect, a magic link opened
// in a fresh tab — anything that beats the dripLive flag) belongs on their
// leagues screen. Checked ONCE per app load, so an intentional later visit to
// the demo (e.g. via the back button) is never hijacked.
let bootSessionChecked = false;
/** Disarm the boot session check — called by sign-out before landing here, so
 *  the async signOut can't race the check and bounce the user back to `live`. */
export function markBootSessionChecked(): void { bootSessionChecked = true; }

// The logged-out landing page IS the demo: one Drip Test League board (Week 2,
// Taco Time Titans vs Beach Day Ballers) that sets up EXACTLY like the hero
// board — both full rosters on the rails, drag (or tap) a player onto a spot,
// seal his hidden metric from the same inline picker, scout the opponent's
// window pools — then arm a power-up and RUN the week window by window.
// Engagement follows the guided-demo playbook: value before any ask (no gate),
// real interaction with everything skippable (auto-fill), and the identity ask
// ("More demo?" → Sleeper username) only after the payoff. All scoring is the
// real engine on real 2025 plays.

const TICK_MS = 400;
const EMP_AT = 1800;      // EMP fires at halftime of the featured window…
const EMP_SECONDS = 600;  // …freezing opponent drip for 10:00

// The three power-ups offered before the run (each a real engine effect).
const POWER_OPTIONS = [
  { id: 'garbage-time', icon: '🗑️', name: 'Garbage Time', blurb: 'Final-5-minute points count double.' },
  { id: 'emp', icon: '❄️', name: 'EMP', blurb: 'Freeze their drip clock for 10 min mid-game.' },
  { id: 'momentum', icon: '📈', name: 'Momentum', blurb: 'Hot drips run 3× instead of 2×.' },
];

export function DemoBoard() {
  const { navigate, sleeperUser, setSleeperUser, isSimLeague, exitSimLeague } = useStore();
  // Rails need ~900px; below that the rosters render as fluid panels instead.
  const narrow = useIsMobile(920);
  // Coming back from a Sleeper sim: restore the baked Drip Test League so the
  // board always builds from the demo rosters.
  useEffect(() => { if (isSimLeague) exitSimLeague(); }, [isSimLeague, exitSimLeague]);
  useEffect(() => { track(Ev.screenView, { screen: 'demo-board', week: DEMO_WEEK }); }, []);
  // Logged-in players go straight to their leagues (see bootSessionChecked).
  useEffect(() => {
    if (bootSessionChecked) return;
    bootSessionChecked = true;
    getSession().then((s) => { if (s) navigate({ name: 'live' }); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const wins = useMemo(() => (ready ? windowsForWeek(DEMO_WEEK) : []), [ready]);
  const youPools = useMemo(() => (ready ? windowPools(youId, DEMO_WEEK) : {}), [ready, youId]);
  const oppPools = useMemo(() => (ready && oppId ? windowPools(oppId, DEMO_WEEK) : {}), [ready, oppId]);
  const byeYou = useMemo(() => (ready ? byePlayers(youId, DEMO_WEEK) : []), [ready, youId]);
  const byeTheir = useMemo(() => (ready && oppId ? byePlayers(oppId, DEMO_WEEK) : []), [ready, oppId]);
  const playerWindow = useMemo(() => {
    const m = new Map<string, WindowId>();
    for (const w of Object.keys(youPools)) for (const p of youPools[w]) m.set(p.id, w);
    return m;
  }, [youPools]);
  const defaults = useMemo(() => (ready ? defaultLineup(youId, DEMO_WEEK) : {}), [ready, youId]);
  const oppPicks = useMemo(() => (ready && oppId ? aiLineup(oppId, youId, DEMO_WEEK) : {}), [ready, oppId, youId]);

  // ── Lineup building — the same semantics as the hero board ────────────────
  const [phase, setPhase] = useState<'setup' | 'watch'>('setup');
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const [selSlot, setSelSlot] = useState<string | null>(null);
  const [pickerSlot, setPickerSlot] = useState<{ key: string; win: WindowId } | null>(null);
  const [scoutWin, setScoutWin] = useState<WindowId | null>(null);
  // Desktop: both roster rails on display. Narrow screens: both panels start
  // collapsed so the board itself is within the first swipe.
  const [rosterOpen, setRosterOpen] = useState(() => {
    const wide = !window.matchMedia('(max-width:920px)').matches;
    return { you: wide, their: wide };
  });
  const [chosenBuff, setChosenBuff] = useState('garbage-time');
  // The viewer's FIRST placement is the featured duel (auto-opened log/field +
  // EMP target).
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  // Per-slot expanded LOG & FIELD panels during the watch phase.
  const [openSlots, setOpenSlots] = useState<Record<string, boolean>>({});
  const armedPu = POWER_OPTIONS.find((p) => p.id === chosenBuff);

  // Keep each window filled top-down (spot 2 never filled while spot 1 is empty).
  const compact = (p: Record<string, Pick>) => {
    const out: Record<string, Pick> = {};
    for (const w of windowsForWeek(DEMO_WEEK)) {
      const n = slotsFor(w.id, DEMO_WEEK);
      let idx = 0;
      for (let i = 0; i < n; i++) { const pk = p[slotKey(w.id, i)]; if (pk) out[slotKey(w.id, idx++)] = pk; }
    }
    return out;
  };
  // Fill every remaining spot from the default lineup (each auto pick arrives
  // with its best metric already sealed), never duplicating a placed player.
  const autoFill = (cur: Record<string, Pick>) => {
    const used = new Set(Object.values(cur).map((p) => p.playerId));
    const out = { ...cur };
    for (const w of windowsForWeek(DEMO_WEEK)) {
      const n = slotsFor(w.id, DEMO_WEEK);
      const queue: Pick[] = [];
      for (let i = 0; i < n; i++) { const pk = defaults[slotKey(w.id, i)]; if (pk && !used.has(pk.playerId)) queue.push(pk); }
      for (let i = 0; i < n; i++) {
        const k = slotKey(w.id, i);
        if (!out[k]) { const pk = queue.shift(); if (pk) { out[k] = pk; used.add(pk.playerId); } }
      }
    }
    return compact(out);
  };

  const assignFromRoster = (playerId: string) => {
    if (phase !== 'setup') return;
    const win = playerWindow.get(playerId);
    if (!win) return;
    const n = slotsFor(win, DEMO_WEEK);
    for (let i = 0; i < n; i++) { const k = slotKey(win, i); if (picks[k]?.playerId === playerId) { setSelSlot(k); return; } }
    const nx = { ...picks };
    for (const k of Object.keys(nx)) if (nx[k].playerId === playerId) delete nx[k];
    let target = slotKey(win, 0); // full window replaces spot 0, like the hero board
    for (let i = 0; i < n; i++) { const k = slotKey(win, i); if (!nx[k]) { target = k; break; } }
    nx[target] = { playerId, metricId: null };
    if (!Object.keys(picks).length) track(Ev.demoStep, { step: 'place' });
    if (!featuredId) setFeaturedId(playerId);
    setPicks(compact(nx));
    setSelSlot(null);
    setPickerSlot(null);
  };
  const assignToSlot = (key: string, playerId: string) => {
    const nx = { ...picks };
    for (const k of Object.keys(nx)) if (nx[k].playerId === playerId) delete nx[k];
    nx[key] = { playerId, metricId: null };
    if (!Object.keys(picks).length) track(Ev.demoStep, { step: 'place' });
    if (!featuredId) setFeaturedId(playerId);
    setPicks(compact(nx));
    setSelSlot(null);
    setPickerSlot(null);
  };
  const pickMetricFor = (key: string, metricId: string) => {
    if (!Object.values(picks).some((p) => p.metricId)) track(Ev.demoStep, { step: 'metric' });
    setPicks((prev) => (prev[key] ? { ...prev, [key]: { ...prev[key], metricId } } : prev));
    setSelSlot(null);
  };
  const clearSlot = (key: string) => {
    const nx = { ...picks };
    delete nx[key];
    setPicks(compact(nx));
    setSelSlot(null);
  };

  const placedN = Object.keys(picks).length;
  const pendingMetric = Object.values(picks).some((p) => !p.metricId);
  // RUN unlocks only on a full board: every spot filled, every metric sealed.
  const totalSlots = wins.reduce((a, w) => a + slotsFor(w.id, DEMO_WEEK), 0);
  const allFilled = totalSlots > 0 && placedN >= totalSlots;
  const canRun = allFilled && !pendingMetric;
  // Guidance targets: the single next spot to fill, and any picks still
  // missing their sealed metric — each gets the pulsing guide-ring.
  const firstEmptyKey = useMemo(() => {
    for (const w of wins) {
      const n = slotsFor(w.id, DEMO_WEEK);
      for (let i = 0; i < n; i++) { const k = slotKey(w.id, i); if (!picks[k]) return k; }
    }
    return null;
  }, [wins, picks]);
  // Tapping the ghosted RUN button redirects attention instead of no-opping:
  // the step card shakes and the hint flips to the warn color for a beat.
  const [nudged, setNudged] = useState(0);
  useEffect(() => {
    if (!nudged) return;
    const t = setTimeout(() => setNudged(0), 1600);
    return () => clearTimeout(t);
  }, [nudged]);

  // ── RUN — auto-fill the rest, resolve the whole week for real ─────────────
  const [runPicks, setRunPicks] = useState<Record<string, Pick> | null>(null);
  const run = () => {
    if (!canRun) return;
    track(Ev.demoRun, { placed: placedN, powerup: chosenBuff });
    const fp = autoFill(picks);
    setRunPicks(fp);
    // Auto-open the featured duel's LOG & FIELD panel so the deepest view is
    // on display without a tap.
    const fid = featuredId && Object.values(fp).some((p) => p.playerId === featuredId) ? featuredId : Object.values(fp)[0]?.playerId;
    const fkey = Object.entries(fp).find(([, p]) => p.playerId === fid)?.[0];
    setOpenSlots(fkey ? { [fkey]: true } : {});
    setWIdx(0); setWClock(0); setEnded(false); setPlaying(true); setPhase('watch');
  };
  const replay = () => { setWIdx(0); setWClock(0); setEnded(false); setPlaying(true); };
  // Full reset — a pristine board, back at step ①.
  const backToStart = () => {
    setPhase('setup'); setPicks({}); setRunPicks(null); setFeaturedId(null); setOpenSlots({});
    setChosenBuff('garbage-time'); setSelSlot(null); setPlaying(false); setEnded(false); setWIdx(0); setWClock(0);
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { /* ignore */ }
  };
  const changePicks = () => {
    // Hand the full (auto-filled) board back as editable picks so the viewer
    // can tweak any spot, hero-board style.
    if (runPicks) setPicks(runPicks);
    setRunPicks(null); setPlaying(false); setEnded(false); setWIdx(0); setWClock(0); setPhase('setup');
  };

  // The featured pick (first placement, else the board's first spot).
  const featId = useMemo(() => {
    if (!runPicks) return null;
    if (featuredId && Object.values(runPicks).some((p) => p.playerId === featuredId)) return featuredId;
    return Object.values(runPicks)[0]?.playerId ?? null;
  }, [runPicks, featuredId]);
  const empWin = useMemo<WindowId | null>(() => {
    if (!runPicks) return null;
    const entry = Object.entries(runPicks).find(([, p]) => p.playerId === featId) ?? Object.entries(runPicks)[0];
    return entry ? (entry[0].split('#')[0] as WindowId) : null;
  }, [runPicks, featId]);

  const resolved = useMemo(() => {
    if (!ready || !oppId || !runPicks) return null;
    const buffs = chosenBuff === 'emp' ? {} : { [chosenBuff]: true };
    const extras = chosenBuff === 'emp' && empWin ? { emp: { [empWin]: EMP_AT } } : {};
    return buildMatchup(youId, oppId, DEMO_WEEK, runPicks, oppPicks, {}, {}, {}, buffs, extras);
  }, [ready, oppId, youId, runPicks, chosenBuff, empWin, oppPicks]);

  const winMaxes = useMemo(() => (resolved ? resolved.windows.map((w) => w.slots.reduce((a, s) => s.events.reduce((m, e) => Math.max(m, e.clock), a), 0)) : []), [resolved]);

  // ── Window-sequenced playout (Thu → Sun early → Sun late → SNF → MNF) ──────
  const [wIdx, setWIdx] = useState(0);
  const [wClock, setWClock] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);

  useEffect(() => {
    if (phase !== 'watch' || !playing || ended || !resolved) return;
    const id = setInterval(() => {
      setWClock((c) => {
        const max = winMaxes[wIdx] ?? 0;
        const slots = resolved.windows[wIdx]?.slots.length ?? 1;
        const ticks = 64 + 20 * (slots - 1); // ~27-53s per window at 1× (2×/4× available)
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
  }, [phase, playing, ended, wIdx, speed, resolved, winMaxes]);

  type WinState = 'upcoming' | 'live' | 'final';
  const winState = (i: number): WinState => {
    if (phase !== 'watch') return 'upcoming';
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
    if (chosenBuff === 'emp' && w.window.id === empWin) {
      out.push({ clock: EMP_AT, key: 'freeze', icon: '❄️', title: 'EMP — FREEZE', body: 'Your EMP fires: the opponent’s drip clock is frozen for 10 minutes. Passive points stop cold — only a touchdown can still score.' });
    }
    return out.sort((a, b) => a.clock - b.clock);
  }, [resolved, wIdx, chosenBuff, empWin]);
  const liveWin = resolved?.windows[wIdx];
  const winIntro: Beat | null = liveWin ? {
    clock: 0, key: 'intro', icon: '🏈', title: `${liveWin.window.label} — KICKOFF`,
    body: wIdx === 0
      ? 'The seal breaks: both sides’ players AND hidden metrics for this window are revealed only now, at kickoff. Watch the banks build.'
      : `${liveWin.window.sub} kicks off — the next sealed picks flip face-up.`,
  } : null;
  const activeBeat = beats.reduce<Beat | null>((acc, b) => (b.clock <= wClock ? b : acc), null) ?? winIntro;

  const featuredSlot = useMemo(() => {
    if (!resolved || !featId) return null;
    for (const w of resolved.windows) for (const s of w.slots) if (s.you?.player.id === featId && s.their) return { winId: w.window.id as WindowId, slotIndex: s.slotIndex, slot: s };
    return null;
  }, [resolved, featId]);
  const frozen = chosenBuff === 'emp' && phase === 'watch' && !ended && liveWin?.window.id === empWin && wClock >= EMP_AT && wClock < EMP_AT + EMP_SECONDS;

  // ── "More demo?" — the persistent Sleeper handoff ──────────────────────────
  const [name, setName] = useState(sleeperUser?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
        <span className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)' }}><GameIcon name={BRAND_MARK} emoji="◈" size="1.4em" /> DRIP FANTASY</span>
        {phase === 'watch' && ended && (
          <button onClick={backToStart} className="mono" style={{ ...chipBtn, color: 'var(--you)', borderColor: 'color-mix(in srgb, var(--you) 45%, var(--bd))' }}>↺ BACK TO START</button>
        )}
        {sleeperUser && <button onClick={() => navigate({ name: 'leagues' })} className="mono" style={chipBtn}>← {sleeperUser.displayName}’s leagues</button>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={() => navigate({ name: 'live' })} className="mono" style={linkBtn}>sign in</button>
        <span style={{ color: 'var(--faint)' }}>·</span>
        <button onClick={() => setFaq(true)} className="mono" style={linkBtn}>FAQ</button>
        <VersionTag />
        <SiteSettings />
      </div>
    </header>
  );

  if (!ready || !youTeam || !oppTeam || !oppId) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {header}
        <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div className="mono" style={{ fontSize: 11, color: 'var(--dim)', letterSpacing: '0.08em' }}>Loading the demo board…</div>
        </main>
      </div>
    );
  }

  // Guided prompt: derived from the board state, not a modal wizard.
  const promptIdx = !allFilled ? 0 : pendingMetric ? 1 : 2;
  const prompts = [
    { title: 'Build your lineup', sub: narrow ? 'Open YOUR ROSTER below and tap a player (or tap any + spot) to field him. A player can only play in the window his real NFL game falls in.' : 'Drag a player from YOUR ROSTER onto a spot (or tap a spot). A player can only play in the window his real NFL game falls in.' },
    { title: 'Seal his hidden metric', sub: 'Pick how he scores, right on the spot. Your opponent can’t see it until his game kicks off — and you can 🔍 SCOUT who they could field against you.' },
    { title: 'Arm a power-up & run the week', sub: 'One power-up bends the live games — pick your edge, then run it.' },
  ];

  // ── Board pieces ───────────────────────────────────────────────────────────
  const scoreHdr = (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: '14px 14px 12px' }}>
      <div className="mono" style={{ fontSize: 8.5, letterSpacing: '0.16em', color: 'var(--faint)', textAlign: 'center' }}>DRIP TEST LEAGUE · WEEK {DEMO_WEEK} · REAL 2025 PLAYS</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <TeamSide team={youTeam.name} owner={youTeam.owner} ownerId={youTeam.ownerId} score={youTot} accent="var(--you)" you />
        <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.12em', flex: 'none' }}>
          {phase === 'watch' && !ended && liveWin ? <span style={{ color: 'var(--you)' }}>{liveWin.window.label} · {fmtClock(wClock)}</span> : ended ? <span style={{ color: 'var(--you)' }}>FINAL</span> : 'VS'}
        </div>
        <TeamSide team={oppTeam.name} owner={oppTeam.owner} ownerId={oppTeam.ownerId} score={theirTot} accent="var(--opp)" />
      </div>
    </div>
  );

  const windowCards = wins.map((w, i) => {
    const st = winState(i);
    const games = gamesInWindow(DEMO_WEEK, w.id).length;
    const nSlots = slotsFor(w.id, DEMO_WEEK);
    const rslots = phase === 'watch' && resolved ? resolved.windows[i]?.slots ?? [] : [];
    const isFeatWin = featuredSlot?.winId === w.id;
    return (
      <div key={w.id} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, marginTop: 10, overflow: 'hidden', opacity: phase === 'watch' && st === 'upcoming' ? 0.65 : 1, transition: 'opacity .3s' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--bd)', background: 'var(--bg)' }}>
          <span className="mono" style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--text)' }}>{w.label}</span>
          <span className="mono" style={{ fontSize: 8.5, color: 'var(--faint)' }}>{w.time}{games > 0 ? ` · ${games} game${games > 1 ? 's' : ''}` : ''}</span>
          <span style={{ flex: 1 }} />
          {st === 'upcoming' && <span className="mono" style={{ ...stateChip, color: 'var(--dim)', borderColor: 'var(--bd)' }}><Emoji e="🔒" size="1.25em" /> SEALED</span>}
          {st === 'live' && <span className="mono" style={{ ...stateChip, color: 'var(--you)', borderColor: 'color-mix(in srgb, var(--you) 45%, transparent)' }}><span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: 3, background: 'var(--you)', marginRight: 5, animation: 'bpulse 1.2s infinite' }} />LIVE</span>}
          {st === 'final' && <span className="mono" style={{ ...stateChip, color: 'var(--dim)', borderColor: 'var(--bd)' }}>FINAL</span>}
        </div>
        {phase === 'setup' ? (
          <div style={{ padding: '10px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Array.from({ length: nSlots }, (_, si) => {
              const key = slotKey(w.id, si);
              // Walk the viewer: ring the next spot to fill, then any pick
              // whose hidden metric still needs sealing.
              const guide = (!allFilled && key === firstEmptyKey)
                || (!!picks[key] && !picks[key].metricId);
              return (
                <div key={key} className={guide ? 'guide-ring' : undefined} style={{ borderRadius: 7 }}>
                  <SetupRow
                    slotKeyStr={key} winId={w.id} week={DEMO_WEEK} pick={picks[key]} selected={selSlot === key}
                    inventory={{}} armed={{}} appliedPu={[]} applyMode={null} onApplyToSpot={() => {}}
                    onOpenPicker={() => { setPickerSlot({ key, win: w.id }); setSelSlot(key); }}
                    onPickMetric={(m) => pickMetricFor(key, m)}
                    onClearSlot={() => clearSlot(key)}
                    onDropPlayer={(id) => assignFromRoster(id)}
                    onScout={() => setScoutWin(w.id)}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          rslots.map((s) => {
            const key = slotKey(w.id, s.slotIndex);
            const b = slotBanks(s, st);
            const isFeatured = isFeatWin && s.slotIndex === featuredSlot?.slotIndex;
            // Once a window has kicked off, every duel expands into its play
            // log + the live field(s) — the same depth as the real board.
            const canOpen = st !== 'upcoming' && s.events.length > 0;
            const open = canOpen && !!openSlots[key];
            const winClock = st === 'live' ? wClock : winMaxes[i] ?? 0;
            return (
              <div key={key} style={{ borderBottom: '1px solid var(--bd)' }}>
                <SlotRow slot={s} state={st} you={b.you} their={b.their} noBorder
                  frozen={isFeatured && frozen} armedPu={isFeatured ? armedPu : undefined} />
                {canOpen && (
                  <div style={{ padding: '0 12px 8px' }}>
                    <div style={{ textAlign: 'center' }}>
                      <button onClick={() => setOpenSlots((o) => ({ ...o, [key]: !open }))} className="mono" style={{ background: 'none', border: 'none', fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: open ? 'var(--you)' : 'var(--faint)', cursor: 'pointer', padding: '2px 8px' }}>
                        {open ? '▴ HIDE LOG & FIELD' : '▾ LOG & FIELD'}
                      </button>
                    </div>
                    {open && (
                      <>
                        <DuelLog slot={s} clock={winClock} live={st === 'live'} armedPu={armedPu} />
                        <SlotFieldViews week={DEMO_WEEK} youTeam={s.you?.player.team} theirTeam={s.their?.player.team} youClock={winClock} theirClock={winClock} />
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {header}
      <main style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: 14, padding: '6px 14px 96px' }}>
        {/* your full roster — the hero board's drag rail (desktop, setup only) */}
        {phase === 'setup' && !narrow && (
          <RosterAside side="you" pools={youPools} picks={picks} onPlayer={assignFromRoster} phase="setup" collapsed={!rosterOpen.you} onToggle={() => setRosterOpen((o) => ({ ...o, you: !o.you }))} bye={byeYou} week={DEMO_WEEK} />
        )}

        <div style={{ width: '100%', maxWidth: 520 }}>
          {/* hero one-liner */}
          <div style={{ textAlign: 'center', margin: '6px 0 14px' }}>
            <div className="grotesk" style={{ fontSize: 'clamp(19px, 5.5vw, 26px)', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', lineHeight: 1.15 }}>
              Fantasy football, but the picks are <span style={{ color: 'var(--you)' }}>sealed</span> and the game is <span style={{ color: 'var(--you)' }}>live</span>.
            </div>
          </div>

          {scoreHdr}

          {/* guided prompt + power-ups + run — always directly under the score */}
          {phase === 'setup' && (
            <div key={nudged} style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 8, padding: '12px 14px', marginTop: 10, animation: nudged ? 'shake .35s ease' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {prompts.map((_, i) => (
                  <span key={i} style={{ width: i === promptIdx ? 20 : 7, height: 7, borderRadius: 4, background: i <= promptIdx ? 'var(--you)' : 'var(--bd)', transition: 'all .2s' }} />
                ))}
                <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', marginLeft: 4 }}>STEP {promptIdx + 1} OF 3</span>
              </div>
              <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 8 }}>{prompts[promptIdx].title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.45 }}>{prompts[promptIdx].sub}</div>

              {/* power-ups appear once the first pick is sealed */}
              {promptIdx === 2 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                  {POWER_OPTIONS.map((pu) => {
                    const on = chosenBuff === pu.id;
                    return (
                      <button key={pu.id} onClick={() => setChosenBuff(pu.id)} title={pu.blurb} style={{ ...optCard(on), flex: 1, flexDirection: 'column', gap: 4, padding: '9px 6px', alignItems: 'center', textAlign: 'center' }}>
                        <span style={{ fontSize: 24, lineHeight: 1 }}><PuIcon id={pu.id} emoji={pu.icon} size={30} /></span>
                        <span className="grotesk" style={{ fontSize: 11, fontWeight: 700, color: 'var(--text)' }}>{pu.name}</span>
                        <span style={{ fontSize: 8.5, color: 'var(--dim)', lineHeight: 1.35 }}>{pu.blurb}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                <button onClick={() => setPicks(autoFill(picks))} className="mono" style={{ ...ctlBtn, flex: 'none' }}>✦ AUTO-FILL</button>
                <button
                  onClick={() => (canRun ? run() : setNudged(Date.now()))}
                  aria-disabled={!canRun}
                  className="mono"
                  style={{
                    ...cta, flex: 1, width: 'auto',
                    ...(canRun
                      ? { boxShadow: '0 0 18px color-mix(in srgb, var(--you) 25%, transparent)' }
                      : { background: 'var(--surface)', color: 'var(--faint)', border: '1px dashed var(--bd)', cursor: 'default' }),
                  }}
                >
                  ▶ RUN WEEK {DEMO_WEEK}
                </button>
              </div>
              {!canRun && (
                <div className="mono" style={{ fontSize: 8.5, fontWeight: nudged ? 700 : 400, color: nudged ? 'var(--warn)' : 'var(--faint)', marginTop: 7, textAlign: 'center', transition: 'color .2s' }}>
                  {!allFilled ? `↑ fill every spot to run — ${placedN}/${totalSlots} set (✦ AUTO-FILL does the rest)` : '↑ seal a metric on every glowing spot first'}
                </div>
              )}
            </div>
          )}

          {/* mobile: the same roster rails as fluid panels */}
          {phase === 'setup' && narrow && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setRosterOpen((o) => ({ ...o, you: !o.you }))} className={promptIdx === 0 && !rosterOpen.you ? 'mono guide-ring' : 'mono'} style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '8px', borderRadius: 4, background: 'var(--surface)', border: `1px solid ${rosterOpen.you ? 'var(--you)' : 'var(--bd)'}`, color: rosterOpen.you ? 'var(--you)' : 'var(--dim)', cursor: 'pointer' }}>{rosterOpen.you ? '▾' : '▸'} YOUR ROSTER</button>
                <button onClick={() => setRosterOpen((o) => ({ ...o, their: !o.their }))} className="mono" style={{ flex: 1, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.08em', padding: '8px', borderRadius: 4, background: 'var(--surface)', border: `1px solid ${rosterOpen.their ? 'var(--opp)' : 'var(--bd)'}`, color: rosterOpen.their ? 'var(--opp)' : 'var(--dim)', cursor: 'pointer' }}>{rosterOpen.their ? '▾' : '▸'} THEIR ROSTER</button>
              </div>
              {rosterOpen.you && <RosterAside side="you" pools={youPools} picks={picks} onPlayer={assignFromRoster} phase="setup" collapsed={false} onToggle={() => setRosterOpen((o) => ({ ...o, you: !o.you }))} bye={byeYou} week={DEMO_WEEK} fluid />}
              {rosterOpen.their && <RosterAside side="their" pools={oppPools} picks={{}} phase="setup" sealed collapsed={false} onToggle={() => setRosterOpen((o) => ({ ...o, their: !o.their }))} bye={byeTheir} week={DEMO_WEEK} fluid />}
            </div>
          )}

          {phase === 'watch' && !ended && (
            <div style={{ minHeight: 78, marginTop: 10, background: 'var(--bg)', border: '1px solid var(--bd)', borderLeft: `3px solid ${activeBeat && FX_COLOR[activeBeat.key] ? FX_COLOR[activeBeat.key] : 'var(--you)'}`, borderRadius: 8, padding: '11px 13px', display: 'flex', gap: 11, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 21, lineHeight: 1 }}><FxIcon k={activeBeat?.key} emoji={activeBeat?.icon} size={24} /></span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em', color: activeBeat && FX_COLOR[activeBeat.key] ? FX_COLOR[activeBeat.key] : 'var(--you)' }}>{activeBeat?.title}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text)', marginTop: 3, lineHeight: 1.45 }}>{activeBeat?.body}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                <button onClick={() => setPlaying((p) => !p)} className="mono" style={miniBtn}>{playing ? '❚❚' : '▶'}</button>
                <button onClick={() => setSpeed((s) => (s === 4 ? 1 : (s * 2) as 2 | 4))} className="mono" title="Playback speed" style={miniBtn}>{speed}×</button>
              </div>
            </div>
          )}

          {ended && resolved && (
            <div style={{ marginTop: 10, background: 'var(--surface)', border: '1px solid var(--bd)', borderLeft: '3px solid var(--you)', borderRadius: 10, padding: 16, textAlign: 'center' }}>
              <div className="grotesk" style={{ fontSize: 19, fontWeight: 700, color: 'var(--text)' }}>
                {youTot >= theirTot ? `You took Week ${DEMO_WEEK}, ` : `They edged you, `}{Math.max(youTot, theirTot).toFixed(1)}–{Math.min(youTot, theirTot).toFixed(1)}.
              </div>
              {resolved.bonuses?.map((b) => (
                <div key={b.id} className="mono" style={{ fontSize: 9.5, color: 'var(--you)', marginTop: 5 }}><GameIcon name={COIN_GOLD} emoji="◇" size="1.2em" /> {b.label} ({b.points > 0 ? '+' : ''}{b.points})</div>
              ))}
              <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 7, lineHeight: 1.5 }}>
                Every duel you just watched was sealed picks, hidden metrics, and live effects on real NFL plays. Now picture it with your own roster.
              </div>
              {/* More demo — the actual input, right here at the conversion moment */}
              <div style={{ marginTop: 12, textAlign: 'left' }}>
                <label className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--you)' }}>MORE DEMO — RUN IT WITH YOUR LEAGUE</label>
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <input
                    value={name}
                    onChange={(e) => { setName(e.target.value); setErr(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitSleeper(); }}
                    placeholder="your Sleeper username"
                    spellCheck={false} autoCapitalize="none" autoCorrect="off"
                    style={{ flex: 1, minWidth: 0, fontFamily: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px', outline: 'none' }}
                  />
                  <button onClick={submitSleeper} disabled={busy || !name.trim()} className="mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 6, padding: '0 16px', cursor: busy ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.6 : 1, whiteSpace: 'nowrap' }}>
                    {busy ? 'loading…' : 'GO →'}
                  </button>
                </div>
                {err && <div className="mono" style={{ fontSize: 9.5, color: 'var(--opp)', marginTop: 6 }}>{err}</div>}
                <div className="mono" style={{ fontSize: 8.5, color: 'var(--faint)', marginTop: 6 }}>Sleeper public API — username only, never a password.</div>
              </div>
              <button onClick={() => setRequesting(true)} className="mono" style={{ ...cta, marginTop: 12, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--bd)' }}>
                ◈ Request a code for your league
              </button>
              <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={replay} className="mono" style={linkBtn}>↺ replay</button>
                <button onClick={changePicks} className="mono" style={linkBtn}>↩ change my lineup</button>
                <button onClick={backToStart} className="mono" style={linkBtn}>⇤ back to start</button>
                <button onClick={() => navigate({ name: 'live' })} className="mono" style={linkBtn}>sign in</button>
              </div>
            </div>
          )}

          {/* the board */}
          {windowCards}

          {/* effect legend during playout */}
          {phase === 'watch' && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', justifyContent: 'center', marginTop: 12 }}>
              {([['drip', '💧', 'DRIP'], ['nuke', '💥', 'NUKE'], ['erase', '🩸', 'ERASE'], ['power', '🗑️', 'POWER-UP'], ['freeze', '❄️', 'EMP'], ['coin', '◇', 'COIN']] as const).map(([k, icon, label]) => (
                <span key={label} className="mono" style={{ fontSize: 8.5, letterSpacing: '0.06em', color: 'var(--faint)' }}><FxIcon k={k} emoji={icon} size="1.4em" /> {label}</span>
              ))}
            </div>
          )}

          {/* request-a-code — the standing CTA under the board */}
          <div style={{ marginTop: 16, background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14, textAlign: 'center' }}>
            <div className="grotesk" style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text)' }}>Want this on your real league?</div>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>We’ll set it up and send you a code — Sleeper · ESPN · MFL · Fleaflicker.</div>
            <button onClick={() => setRequesting(true)} className="mono" style={{ ...cta, marginTop: 10 }}><GameIcon name={BRAND_MARK} emoji="◈" size="1.3em" /> Request a code for your league</button>
          </div>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 14 }}>
            <button onClick={() => navigate({ name: 'live' })} className="mono" style={linkBtn}><GameIcon name={BRAND_MARK} emoji="◈" size="1.3em" /> Already invited? Sign in</button>
            <span style={{ color: 'var(--faint)' }}>·</span>
            <button onClick={() => setFaq(true)} className="mono" style={linkBtn}>Read the FAQ</button>
          </div>
        </div>

        {/* the opponent's full roster — visible pool, sealed picks (desktop, setup only) */}
        {phase === 'setup' && !narrow && (
          <RosterAside side="their" pools={oppPools} picks={{}} phase="setup" sealed collapsed={!rosterOpen.their} onToggle={() => setRosterOpen((o) => ({ ...o, their: !o.their }))} bye={byeTheir} week={DEMO_WEEK} />
        )}
      </main>

      {/* persistent "More demo?" bar — the identity ask, always one glance away */}
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 50, background: 'color-mix(in srgb, var(--bg) 90%, transparent)', backdropFilter: 'blur(8px)', borderTop: '1px solid var(--bd)', padding: '9px 14px' }}>
        <div style={{ maxWidth: 520, margin: '0 auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', flex: 'none' }}>MORE DEMO?</span>
            <input
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

      {/* hero-board modals: tap-a-spot player picker + opponent-pool scout */}
      {pickerSlot && (
        <PlayerPicker
          win={pickerSlot.win} week={DEMO_WEEK} players={youPools[pickerSlot.win] ?? []} currentId={picks[pickerSlot.key]?.playerId}
          onPick={(id) => assignToSlot(pickerSlot.key, id)}
          onRemove={() => { clearSlot(pickerSlot.key); setPickerSlot(null); }}
          onClose={() => { setPickerSlot(null); setSelSlot(null); }}
        />
      )}
      {scoutWin && <ScoutModal win={scoutWin} week={DEMO_WEEK} pool={oppPools[scoutWin] ?? []} oppName={oppTeam.name} onClose={() => setScoutWin(null)} />}
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

// Two-sided play log for one duel — scoring plays, effects, power-up notes and
// coin, revealed up to the window's clock (the GuidedDemo log, per slot).
function DuelLog({ slot, clock, live, armedPu }: { slot: ResolvedSlot; clock: number; live: boolean; armedPu?: { id: string; icon: string } }) {
  const logRef = useRef<HTMLDivElement>(null);
  const rows = slot.events.filter((e) => e.clock <= clock && (e.delta > 0 || e.effect || e.coin || e.sig || e.buffNote));
  useEffect(() => { if (live) logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }); }, [rows.length, live]);
  return (
    <div style={{ background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 7, padding: '8px 10px', marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6 }}>
        <span className="mono" style={{ flex: 1, fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--you)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.you?.player.name.toUpperCase() ?? ''}</span>
        <span className="mono" style={{ minWidth: 34, textAlign: 'center', fontSize: 7.5, color: 'var(--faint)' }}>CLOCK</span>
        <span className="mono" style={{ flex: 1, fontSize: 8, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--opp)', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{slot.their?.player.name.toUpperCase() ?? ''}</span>
      </div>
      <div ref={logRef} style={{ maxHeight: 140, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.length === 0 && <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', textAlign: 'center', padding: '4px 0' }}>scoring plays appear here…</div>}
        {rows.map((e, ri) => {
          const mine = e.side === 'you';
          const cell = (
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, flexDirection: mine ? 'row-reverse' : 'row', maxWidth: '100%', overflow: 'hidden' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: mine ? 'var(--you)' : 'var(--opp)' }}>{actionText(e.play)}</span>
              {e.delta > 0 && <span style={{ color: 'var(--text)', fontWeight: 700 }}>+{e.delta.toFixed(1)}</span>}
              {e.effect && <span style={{ color: FX_COLOR[e.effect.type] ?? 'var(--text)', fontWeight: 700 }}>{e.effect.type === 'streak' ? '🔥 ' : ''}{e.effect.type.toUpperCase()}</span>}
              {e.buffNote && <span style={{ color: 'var(--fx-streak, #36D399)', fontWeight: 700 }}><PuIcon id={armedPu?.id} emoji={armedPu?.icon ?? '🗑️'} size="1.2em" />×2</span>}
              {e.coin && <span style={{ color: 'var(--you)' }}><GameIcon name={COIN_GOLD} emoji="◇" size="1.2em" /></span>}
            </span>
          );
          return (
            <div key={ri} className="mono" style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 9 }}>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'right' }}>{mine ? cell : ''}</span>
              <span style={{ minWidth: 34, textAlign: 'center', color: 'var(--faint)' }}>{fmtClock(e.clock)}</span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>{!mine ? cell : ''}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SlotRow({ slot, state, you, their, frozen, armedPu, noBorder }: {
  slot: ResolvedSlot; state: 'upcoming' | 'live' | 'final'; you: number; their: number;
  frozen?: boolean; armedPu?: { id?: string; icon: string; name: string }; noBorder?: boolean;
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
          <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--dim)', border: '1px dashed var(--bd)', borderRadius: 5, padding: '7px 10px' }}><Emoji e="🔒" size="1.25em" /> SEALED PICK</span>
        </div>
      );
    }
    return (
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: right ? 'row-reverse' : 'row', alignItems: 'center', gap: 7 }}>
        <div style={{ position: 'relative', flex: 'none', filter: who === 'their' && frozen ? 'grayscale(0.6) brightness(0.9)' : undefined }}>
          <PlayerImg playerId={pick.player.id} team={pick.player.team} pos={pick.player.pos} size={30} />
          {who === 'their' && frozen && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}><FxIcon k="freeze" emoji="❄️" size={18} /></span>}
        </div>
        <div style={{ minWidth: 0, textAlign: right ? 'right' : 'left' }}>
          <div className="grotesk" style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pick.player.name}</div>
          <div style={{ display: 'flex', flexDirection: right ? 'row-reverse' : 'row', flexWrap: 'wrap', gap: 3, marginTop: 2, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 7.5, color: 'var(--faint)' }}>{pick.player.pos} · {pick.player.team}</span>
            {(who === 'you' || !sealed) && <MetricChip pos={pick.player.pos} metricId={pick.metricId} />}
            {who === 'you' && armedPu && <span className="mono" style={{ fontSize: 7.5, fontWeight: 700, color: 'var(--fx-streak, #36D399)' }}><PuIcon id={armedPu.id} emoji={armedPu.icon} size="1.4em" /> {armedPu.name.toUpperCase()}</span>}
          </div>
        </div>
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: noBorder ? 'none' : '1px solid var(--bd)' }}>
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
const optCard = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', background: on ? 'color-mix(in srgb, var(--you) 9%, var(--surface))' : 'var(--surface)', border: `1.5px solid ${on ? 'var(--you)' : 'var(--bd)'}`, boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--you) 14%, transparent)' : 'none', transition: 'all .15s' });
