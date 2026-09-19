// THE MASCOT BUILDER (v0.420.0) — the landing's league builder, as a character.
//
// Founder: "Build a mascot! … Every selection changes the mascot in some way.
// Then hit a button and the mascot slides to the left and you can interact
// with dialogues to set the rest of the league up. … Go → share link."
//
// Two phases. BUILD: the mascot on a stage, four rows of option cards under
// it, each tap changing what it wears. SETUP: the mascot slides to the left
// and the right side becomes the checklist a real league needs — roster,
// scoring, teams, draft settings, waivers, a name — each row opening its own
// dialogue in place. GO signs the visitor in without leaving the page (email
// + password, or an emailed code), creates the league through the SAME calls
// the create screen uses, applies the dialogues as one blueprint, and hands
// back the share link. An account without the `native` flag is refused by
// the server; that path becomes a request-an-invite with the design attached.
//
// The four answers, the layer plan and the stash live in core (mascot.ts);
// this file is the web host: the stage, the cards, the dialogues, the run.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useStore } from '../app/store';
import { Emoji } from '../app/gameIcons';
import {
  MASCOT_STEPS, DEFAULT_BUILD, MASCOT_STASH_KEY,
  mascotLayers, mascotName, describeBuild, buildSeed, optionFor, parseBuild, serializeBuild,
  type MascotBuild, type MascotLayer, type MascotAnchor,
} from '@drip/core/data/mascot';
import { CLASSIC_SLOT_TYPES, DEFAULT_CLASSIC_ROSTER, DEFAULT_CLASSIC_SCORING } from '@drip/core/engine/classic';
import {
  createNativeLeague, seedLeaguePool, nativeGenerateSchedule, contractRosterDepth,
  getSession, signInPassword, signUpPassword, sendMagicLink, verifyEmailOtp, friendlyError,
  POS_CAP_KEYS, type PosCaps, type WaiverMode,
} from '@drip/core/data/liveApi';
import { applyBlueprint, type LeagueBlueprint } from '@drip/core/data/leagueBlueprint';
import { buildDraftPool } from '@drip/core/data/nativeLeague';
import { scheduleWeeksFor } from '@drip/core/data/league';
import { inviteLink } from '@drip/core/data/invite';
import { track, Ev } from '@drip/core/analytics';

// ── The setup the dialogues collect ─────────────────────────────────────────
type Dialog = 'roster' | 'scoring' | 'teams' | 'draft' | 'waivers';
interface Setup {
  name: string;
  teams: number;
  // roster
  roster: Record<string, number>;   // classic starting spots
  bench: number; taxi: number; ir: number;
  dripRoster: number;               // drip: roster size (8 start)
  caps: Record<string, number>;     // drip position limits (CAP_UNLIMITED = ∞)
  keepN: number; rookieN: number;
  // scoring
  ppr: number; passTd: number; tePrem: number; bestball: boolean;
  // draft
  pace: 'live' | 'slow'; clock: number; clockHrs: number; bellSecs: number; bellHrs: number; budget: number; maxLots: number;
  night: boolean; nightStart: number; nightEnd: number;
  // waivers
  waiverMode: WaiverMode; faab: number; clearMin: number; clearDow: number[]; holdDays: number; faAfter: boolean;
}
const CAP_UNLIMITED = 11;
const SETUP_KEY = 'dripMascotSetup';
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function defaultSetup(b: MascotBuild): Setup {
  const seed = buildSeed(b);
  return {
    name: '',
    teams: seed.format === 'guillotine' ? 18 : 10,
    roster: { ...DEFAULT_CLASSIC_ROSTER }, bench: 6, taxi: 0, ir: 1,
    dripRoster: 12, caps: { QB: 3, RB: CAP_UNLIMITED, WR: CAP_UNLIMITED, TE: 3, K: 1, DEF: 1 },
    keepN: 4, rookieN: 3,
    ppr: 1, passTd: 4, tePrem: 0, bestball: false,
    pace: 'live', clock: 90, clockHrs: 12, bellSecs: 15, bellHrs: 8, budget: 200, maxLots: 1,
    night: false, nightStart: 23 * 60, nightEnd: 8 * 60,
    waiverMode: 'faab', faab: seed.format === 'guillotine' ? 1000 : 100, clearMin: 3 * 60, clearDow: [3], holdDays: 1, faAfter: false,
  };
}
function readSetup(b: MascotBuild): Setup {
  const d = defaultSetup(b);
  try {
    const raw = localStorage.getItem(SETUP_KEY);
    if (!raw) return d;
    const j = JSON.parse(raw) as Partial<Setup>;
    // Numbers and booleans only, each checked — this string comes off a phone.
    const n = (k: keyof Setup, lo: number, hi: number) => { const v = j[k]; return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : (d[k] as number); };
    const bo = (k: keyof Setup) => (typeof j[k] === 'boolean' ? (j[k] as boolean) : (d[k] as boolean));
    return {
      ...d,
      name: typeof j.name === 'string' ? j.name.slice(0, 60) : '',
      teams: n('teams', 2, 32),
      roster: j.roster && typeof j.roster === 'object' ? Object.fromEntries(CLASSIC_SLOT_TYPES.map((t) => [t.type, Math.max(0, Math.min(6, Number((j.roster as Record<string, unknown>)[t.type]) || 0))]).filter(([, v]) => (v as number) > 0)) : d.roster,
      bench: n('bench', 0, 20), taxi: n('taxi', 0, 6), ir: n('ir', 0, 6), dripRoster: n('dripRoster', 8, 30),
      caps: j.caps && typeof j.caps === 'object' ? Object.fromEntries(POS_CAP_KEYS.map((k) => [k, Math.max(0, Math.min(CAP_UNLIMITED, Number((j.caps as Record<string, unknown>)[k]) || d.caps[k]))])) : d.caps,
      keepN: n('keepN', 1, 15), rookieN: n('rookieN', 1, 8),
      ppr: n('ppr', 0, 2), passTd: n('passTd', 1, 8), tePrem: n('tePrem', 0, 2), bestball: bo('bestball'),
      pace: j.pace === 'slow' ? 'slow' : 'live', clock: n('clock', 15, 600), clockHrs: n('clockHrs', 1, 48), bellSecs: n('bellSecs', 10, 60), bellHrs: n('bellHrs', 1, 48), budget: n('budget', 50, 1000), maxLots: n('maxLots', 1, 4),
      night: bo('night'), nightStart: n('nightStart', 0, 1439), nightEnd: n('nightEnd', 0, 1439),
      waiverMode: j.waiverMode === 'rolling' || j.waiverMode === 'standings' ? j.waiverMode : 'faab', faab: n('faab', 0, 5000), clearMin: n('clearMin', 0, 1439),
      clearDow: Array.isArray(j.clearDow) ? j.clearDow.filter((x): x is number => typeof x === 'number' && x >= 0 && x <= 6) : d.clearDow,
      holdDays: n('holdDays', 0, 7), faAfter: bo('faAfter'),
    };
  } catch { return d; }
}

const fmtEt = (m: number) => { const h = Math.floor(m / 60) % 24; const mm = m % 60; return `${h % 12 === 0 ? 12 : h % 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'} ET`; };

// ── Styles ─────────────────────────────────────────────────────────────────
const cta: CSSProperties = { fontSize: 11.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 7, padding: '12px 18px', cursor: 'pointer' };
const ghost: CSSProperties = { ...cta, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)' };
const link: CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer', padding: 0 };
const input: CSSProperties = { fontFamily: 'inherit', fontSize: 14, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '10px 12px', outline: 'none', width: '100%', boxSizing: 'border-box' };
const lbl: CSSProperties = { fontSize: 8.5, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 };

function Chip({ on, children, onClick, title, disabled }: { on?: boolean; children: React.ReactNode; onClick: () => void; title?: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} className="mono" style={{
      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.45 : 1,
      color: on ? 'var(--on-accent)' : 'var(--dim)', background: on ? 'var(--you)' : 'var(--surface)',
      border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, borderRadius: 999, padding: '5px 11px',
    }}>{children}</button>
  );
}
function Num({ v, set, min, max, step = 1, fmt }: { v: number; set: (n: number) => void; min: number; max: number; step?: number; fmt?: (n: number) => string }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button onClick={() => set(Math.max(min, v - step))} className="mono" style={{ ...ghost, padding: '6px 11px', borderRadius: 5 }}>−</button>
      <span className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', minWidth: 44, textAlign: 'center' }}>{fmt ? fmt(v) : v}</span>
      <button onClick={() => set(Math.min(max, v + step))} className="mono" style={{ ...ghost, padding: '6px 11px', borderRadius: 5 }}>＋</button>
    </div>
  );
}

// ── The stage ──────────────────────────────────────────────────────────────
// Sticker files that failed to load, remembered for the session so a missing
// file is asked for once, not on every re-render.
const missing = new Set<string>();
const BODY_COLOR: Record<string, string> = { redraft: '#35D07F', keeper: '#4F8CFF', dynasty: '#A86BFF', contract_dynasty: '#FF9F43' };
// Anchor boxes are tuned to the four cut-out bodies (public/mascot/base-*):
// full figures on a 1024 canvas, feet at the bottom, head in the top fifth,
// hands at about two-thirds down on either side.
const ANCHOR_BOX: Record<MascotAnchor, { top: number; left: number; width: number; height: number }> = {
  scene: { top: 0, left: 0, width: 100, height: 100 },
  body: { top: 0, left: 0, width: 100, height: 100 },
  back: { top: 6, left: 10, width: 80, height: 80 },
  neck: { top: 26, left: 34, width: 32, height: 12 },
  hand: { top: 52, left: 68, width: 26, height: 20 },
  head: { top: -4, left: 34, width: 32, height: 15 },
};

function PlaceholderBody({ type, name }: { type: string; name: string }) {
  const c = BODY_COLOR[type] ?? 'var(--you)';
  return (
    <svg viewBox="0 0 200 200" width="100%" height="100%" aria-label={name} role="img">
      <ellipse cx="72" cy="186" rx="22" ry="8" fill={c} opacity="0.85" />
      <ellipse cx="128" cy="186" rx="22" ry="8" fill={c} opacity="0.85" />
      <path d="M100 26c-46 0-70 34-70 84 0 40 26 70 70 70s70-30 70-70c0-50-24-84-70-84z" fill={c} stroke="#0d1f22" strokeWidth="5" />
      <ellipse cx="100" cy="130" rx="42" ry="34" fill="#ffffff" opacity="0.18" />
      <ellipse cx="78" cy="88" rx="13" ry="16" fill="#fff" stroke="#0d1f22" strokeWidth="4" />
      <ellipse cx="122" cy="88" rx="13" ry="16" fill="#fff" stroke="#0d1f22" strokeWidth="4" />
      <circle cx="81" cy="91" r="6" fill="#0d1f22" /><circle cx="119" cy="91" r="6" fill="#0d1f22" />
      <circle cx="83" cy="88" r="2" fill="#fff" /><circle cx="121" cy="88" r="2" fill="#fff" />
      <path d="M76 124q24 22 48 0" fill="none" stroke="#0d1f22" strokeWidth="5" strokeLinecap="round" />
      <path d="M30 118q-14 10-8 30" fill="none" stroke={c} strokeWidth="14" strokeLinecap="round" />
      <path d="M170 118q14 10 8 30" fill="none" stroke={c} strokeWidth="14" strokeLinecap="round" />
      <path d="M30 118q-14 10-8 30" fill="none" stroke="#0d1f22" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
      <path d="M170 118q14 10 8 30" fill="none" stroke="#0d1f22" strokeWidth="4" strokeLinecap="round" opacity="0.5" />
    </svg>
  );
}

function Sticker({ layer, type, name, size, onBody }: { layer: MascotLayer; type: string; name: string; size: number; onBody?: (baked: boolean) => void }) {
  // The chain of files to try: the layer's own, then its fallbacks (a geared
  // body falls back to the plain body), then the stand-in. Files already
  // known missing this session are skipped without a request.
  const chain = [layer.file, ...(layer.fallbacks ?? [])];
  const [idx, setIdx] = useState(() => { let i = 0; while (i < chain.length && missing.has(chain[i])) i++; return i; });
  const broken = idx >= chain.length;
  const file = chain[idx];
  const b = ANCHOR_BOX[layer.anchor];
  const isBody = layer.anchor === 'body';
  const isScene = layer.anchor === 'scene';
  // A placeholder emoji fills most of its anchor box and no more — the box is
  // the sticker's real footprint, so the stand-in must not cover the face.
  const px = Math.round((size * b.height) / 100 * (layer.anchor === 'back' ? 0.7 : 0.85));
  // A scene has no stand-in: nothing is drawn until the file exists.
  if (isScene && broken) return null;
  return (
    <div className={`mb-layer mb-${layer.key}`} style={{ position: 'absolute', top: `${b.top}%`, left: `${b.left}%`, width: `${b.width}%`, height: `${b.height}%`, zIndex: layer.z + 10, display: 'grid', placeItems: 'center', pointerEvents: 'none', ...(isScene ? { borderRadius: 16, overflow: 'hidden' } : {}) }}>
      {broken
        ? (isBody ? <PlaceholderBody type={type} name={name} /> : <Emoji e={layer.emoji} size={px} style={{ filter: 'drop-shadow(0 3px 6px rgba(0,0,0,.45))' }} />)
        : <img key={file} src={`${import.meta.env.BASE_URL}mascot/${file}.webp`} alt="" draggable={false}
            onLoad={() => { if (isBody && onBody) onBody(idx === 0 && chain.length > 1); }}
            onError={() => { missing.add(file); setIdx((i) => i + 1); if (isBody && onBody && idx + 1 >= chain.length) onBody(false); }}
            style={{ width: '100%', height: '100%', objectFit: isScene ? 'cover' : 'contain', ...(isScene ? { opacity: 0.92, maskImage: 'linear-gradient(to bottom, #000 78%, transparent)', WebkitMaskImage: 'linear-gradient(to bottom, #000 78%, transparent)' } : {}) }} />}
    </div>
  );
}

function Stage({ build, size }: { build: MascotBuild; size: number }) {
  const layers = mascotLayers(build);
  const name = mascotName(build);
  // Did the body load a BAKED render (mode gear already on it)? Then the head
  // sticker and the cape stand down, or the mascot wears two visors.
  const [baked, setBaked] = useState(false);
  return (
    <div className="mb-stage" key={describeBuild(build)} style={{ position: 'relative', width: size, height: size, margin: '0 auto' }}>
      <div className="mb-glow" style={{ position: 'absolute', inset: '12% 8% 4% 8%', borderRadius: '50%', background: `radial-gradient(closest-side, ${BODY_COLOR[build.type]}44, transparent)`, zIndex: 9, filter: 'blur(6px)' }} />
      <div style={{ position: 'absolute', left: '18%', right: '18%', bottom: '1%', height: '4%', borderRadius: '50%', background: 'rgba(0,0,0,.4)', filter: 'blur(4px)', zIndex: 9 }} />
      {layers.filter((l) => !(l.unlessBaked && baked)).map((l) => <Sticker key={l.key} layer={l} type={build.type} name={name} size={size} onBody={l.key === 'body' ? setBaked : undefined} />)}
    </div>
  );
}

// ── The builder ────────────────────────────────────────────────────────────
export function MascotBuilder({ onPlay, onRequest, narrow }: {
  /** ▶ PLAY A WEEK on a matchup card — opens that game's demo under the panel. */
  onPlay: (g: 'drip' | 'classic') => void;
  /** The account cannot create leagues (no `native` flag): request a seat with the design attached. */
  onRequest: (note: string) => void;
  narrow: boolean;
}) {
  const { navigate } = useStore();
  const [build, setBuild] = useState<MascotBuild>(() => { try { return parseBuild(localStorage.getItem(MASCOT_STASH_KEY)) ?? DEFAULT_BUILD; } catch { return DEFAULT_BUILD; } });
  const [phase, setPhase] = useState<'build' | 'setup'>(() => { try { return localStorage.getItem(SETUP_KEY) ? 'setup' : 'build'; } catch { return 'build'; } });
  const [setup, setSetup] = useState<Setup>(() => readSetup(build));
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const seed = useMemo(() => buildSeed(build), [build]);
  const classic = seed.gameMode === 'classic';
  const patch = (p: Partial<Setup>) => setSetup((s) => ({ ...s, ...p }));

  useEffect(() => { try { localStorage.setItem(MASCOT_STASH_KEY, serializeBuild(build)); } catch { /* ignore */ } }, [build]);
  useEffect(() => { if (phase === 'setup') { try { localStorage.setItem(SETUP_KEY, JSON.stringify(setup)); } catch { /* ignore */ } } }, [setup, phase]);

  const pick = <K extends keyof MascotBuild>(key: K, id: MascotBuild[K]) => {
    setBuild((b) => {
      const next = { ...b, [key]: id } as MascotBuild;
      // Golf scores the classic way (set_league_golf refuses a drip league), so
      // a golf mascot with a chain on is not a league that can exist.
      if (next.mode === 'golf' && next.matchup === 'drip') next.matchup = key === 'matchup' ? 'drip' : 'classic';
      if (next.mode === 'golf' && next.matchup === 'drip') next.mode = 'classic';
      const ns = buildSeed(next);
      if (ns.format === 'guillotine' && setup.teams < 18) patch({ teams: 18, faab: setup.faab === 100 ? 1000 : setup.faab });
      return next;
    });
  };

  // ── the run ──
  type Go = { st: 'idle' } | { st: 'auth' } | { st: 'busy'; note: string } | { st: 'done'; code: string; leagueId: string; misses: string[] } | { st: 'denied'; why: string } | { st: 'error'; msg: string };
  const [go, setGo] = useState<Go>({ st: 'idle' });
  const [auth, setAuth] = useState<{ mode: 'password' | 'code'; email: string; password: string; token: string; sent: boolean; busy: boolean; err: string | null; info: string | null }>({ mode: 'password', email: '', password: '', token: '', sent: false, busy: false, err: null, info: null });

  const starters = Object.values(setup.roster).reduce((a, b) => a + b, 0);
  const rounds = classic ? starters + setup.bench + setup.taxi + setup.ir
    : build.type === 'contract_dynasty' ? contractRosterDepth(setup.teams, setup.budget) : setup.dripRoster;

  const createLeague = async () => {
    const name = setup.name.trim();
    setGo({ st: 'busy', note: `Creating ${name}…` });
    try {
      const pickSecs = setup.pace === 'slow' ? setup.clockHrs * 3600 : setup.clock;
      const lotSecs = setup.pace === 'slow' ? setup.bellHrs * 3600 : setup.bellSecs;
      const caps: PosCaps | null = classic ? null : (Object.fromEntries(POS_CAP_KEYS.map((k) => [k, setup.caps[k] >= CAP_UNLIMITED ? null : setup.caps[k]])) as PosCaps);
      const contN = build.type === 'keeper' ? setup.keepN : build.type === 'dynasty' || build.type === 'contract_dynasty' ? setup.rookieN : null;
      const r = await createNativeLeague(name, '2026', setup.teams, rounds, pickSecs, seed.draftMode, setup.budget, lotSecs,
        seed.draftMode === 'auction' ? setup.maxLots : 1,
        setup.night ? setup.nightStart : null, setup.night ? setup.nightEnd : null, caps, seed.gameMode, seed.continuity, contN);
      if (!r.ok || !r.league_id) {
        const msg = friendlyError(r.error ?? 'Could not create the league.');
        if (/native|feature|allowed|permission|flag/i.test(msg)) { track(Ev.mascotGo, { outcome: 'denied' }); setGo({ st: 'denied', why: msg }); }
        else { track(Ev.mascotGo, { outcome: 'error' }); setGo({ st: 'error', msg }); }
        return;
      }
      setGo({ st: 'busy', note: 'Applying your settings…' });
      const scoring: Record<string, number> = { ...DEFAULT_CLASSIC_SCORING, ppr: setup.ppr, passTd: setup.passTd, teRec: setup.tePrem };
      const bp: LeagueBlueprint = {
        sourceLeagueId: 'mascot',
        teams: setup.teams, rounds, pickSeconds: pickSecs, mode: seed.draftMode, budget: setup.budget, lotSeconds: lotSecs,
        maxLots: seed.draftMode === 'auction' ? setup.maxLots : 1,
        nightStartMin: setup.night ? setup.nightStart : null, nightEndMin: setup.night ? setup.nightEnd : null,
        posCaps: caps, gameMode: seed.gameMode, continuity: seed.continuity, continuityN: contN, format: seed.format,
        scoring: null,
        rules: {
          waiverMode: setup.waiverMode, faabBudget: setup.waiverMode === 'faab' ? setup.faab : null, tradeReview: null,
          waiverClearMin: setup.clearMin, waiverClearDow: setup.clearDow, faAfterWaiversDow: setup.faAfter ? setup.clearDow : [],
          waiverHoldDays: setup.holdDays, faStartMin: null, faEndMin: null, taxiMaxExp: null, taxiLock: null, irTags: null,
        },
        classic: classic ? {
          ppr: setup.ppr, golf: seed.golf, bestball: setup.bestball ? Object.keys(setup.roster) : null,
          roster: setup.roster, slots: null, shape: { bench: setup.bench, taxi: setup.taxi, ir: setup.ir }, scoring,
        } : null,
        unread: [],
      };
      const steps = await applyBlueprint(r.league_id, bp);
      const misses = steps.filter((s) => !s.ok).map((s) => `${s.step} — ${friendlyError(s.error ?? 'refused')}`);
      setGo({ st: 'busy', note: 'Building the 2026 player pool…' });
      const pool = await seedLeaguePool(r.league_id, await buildDraftPool((n) => setGo({ st: 'busy', note: n })));
      if (!pool.ok) misses.push(`player pool — ${friendlyError(pool.error ?? 'refused')}`);
      setGo({ st: 'busy', note: 'Generating the season schedule…' });
      const sched = await nativeGenerateSchedule(r.league_id, scheduleWeeksFor(seed.format));
      if (!sched.ok) misses.push(`schedule — ${friendlyError(sched.error ?? 'refused')}`);
      track(Ev.mascotGo, { outcome: 'created', game: seed.gameMode, format: seed.format, continuity: seed.continuity, misses: misses.length });
      try { localStorage.removeItem(SETUP_KEY); } catch { /* ignore */ }
      setGo({ st: 'done', code: r.invite_code ?? '', leagueId: r.league_id, misses });
    } catch (x) { track(Ev.mascotGo, { outcome: 'error' }); setGo({ st: 'error', msg: friendlyError(x) }); }
  };

  const onGo = async () => {
    if (!setup.name.trim()) { setGo({ st: 'error', msg: 'Give the league a name first.' }); return; }
    const s = await getSession().catch(() => null);
    if (!s) { setGo({ st: 'auth' }); return; }
    await createLeague();
  };

  const runAuth = async (fn: () => Promise<void>) => {
    setAuth((a) => ({ ...a, busy: true, err: null }));
    try { await fn(); } catch (x) { setAuth((a) => ({ ...a, err: friendlyError(x) })); }
    finally { setAuth((a) => ({ ...a, busy: false })); }
  };
  const afterSignIn = async () => { const s = await getSession(); if (s) await createLeague(); else setAuth((a) => ({ ...a, err: 'Signed in, but no session came back — try again.' })); };

  // ── copy for the checklist rows ──
  const rosterLine = classic
    ? `${starters} starters (${Object.entries(setup.roster).map(([k, v]) => `${v} ${k}`).join(', ')}) · ${setup.bench} bench${setup.taxi ? ` · ${setup.taxi} taxi` : ''}${setup.ir ? ` · ${setup.ir} IR` : ''}`
    : `${rounds} spots · 8 weekly starters in kickoff windows${build.type === 'contract_dynasty' ? ' · deep roster for the salary market' : ''}`;
  const scoringLine = classic
    ? `${setup.ppr === 0 ? 'Standard' : setup.ppr === 0.5 ? 'Half PPR' : setup.ppr === 1 ? 'Full PPR' : `${setup.ppr} per catch`} · ${setup.passTd}-pt pass TD${setup.tePrem ? ` · TE +${setup.tePrem}` : ''}${setup.bestball ? ' · best ball' : ''}${seed.golf ? ' · golf' : ''}`
    : 'Drip scoring: sealed metrics, drips, nukes and power-ups — the game’s own';
  const draftLine = `${seed.draftMode === 'auction' ? `Auction · $${setup.budget}` : 'Snake'} · ${setup.pace === 'live' ? `live, ${setup.pace === 'live' ? setup.clock : setup.clockHrs}s a pick` : `slow, ${setup.clockHrs}h a pick`}${setup.night ? ` · paused ${fmtEt(setup.nightStart)}–${fmtEt(setup.nightEnd)}` : ''}`;
  const waiverLine = `${setup.waiverMode === 'faab' ? `FAAB $${setup.faab}` : setup.waiverMode === 'rolling' ? 'Rolling order' : 'Reverse standings'} · clears ${setup.clearDow.length ? setup.clearDow.map((d) => DOW[d]).join('/') : 'daily'} ${fmtEt(setup.clearMin)} · ${setup.holdDays}-day hold · free agents ${setup.faAfter ? 'after waivers clear' : 'instant'}`;

  const requestNote = `Designed on the site: ${describeBuild(build)} · ${setup.teams} teams · ${setup.name.trim() || 'unnamed'} · ${rosterLine} · ${scoringLine} · ${draftLine} · ${waiverLine}`;

  const stageSize = phase === 'build' ? (narrow ? 250 : 320) : (narrow ? 140 : 220);

  // ── render ──
  return (
    <>
      <MascotCss />
      <div className={`mb ${phase === 'setup' ? 'mb-setup' : 'mb-build'}`}>
        {/* the mascot column: the stage, its name, what it's wearing */}
        <div className="mb-left">
          <Stage build={build} size={stageSize} />
          <div className="mb-leftText">
          <div className="grotesk" style={{ fontSize: phase === 'build' ? 20 : 16, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)', marginTop: 6 }}>{mascotName(build)}</div>
          <div className="mono" style={{ fontSize: 10, color: 'var(--you)', fontWeight: 700, letterSpacing: '0.06em', marginTop: 3 }}>{describeBuild(build)}</div>
          {phase === 'build' && (
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5, marginTop: 6, maxWidth: 360, marginInline: 'auto' }}>
              Wearing {optionFor('matchup', build.matchup).wears}, {optionFor('draft', build.draft).wears}{build.mode !== 'classic' ? `, ${optionFor('mode', build.mode).wears}` : ''}.
            </div>
          )}
          {phase === 'setup' && go.st !== 'done' && (
            <button onClick={() => { setPhase('build'); setDialog(null); setGo({ st: 'idle' }); }} className="mono" style={{ ...link, marginTop: 8 }}>← change the mascot</button>
          )}
          </div>
        </div>

        {/* BUILD: four rows of cards */}
        {phase === 'build' && (
          <div className="mb-steps">
            {MASCOT_STEPS.map((step) => (
              <div key={step.key}>
                <div className="mono mb-h">{step.heading}</div>
                <div className="mb-strip">
                  {step.options.map((o) => {
                    const on = build[step.key] === o.id;
                    const golfLocked = step.key === 'mode' && o.id === 'golf' && build.matchup === 'drip';
                    return (
                      <div key={o.id} role="button" tabIndex={0} aria-pressed={on} className={`mb-card${on ? ' on' : ''}${golfLocked ? ' locked' : ''}`}
                        title={golfLocked ? 'Golf scores the classic way — it switches you to Classic Fantasy' : o.wears}
                        onClick={() => pick(step.key, o.id as never)}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(step.key, o.id as never); } }}>
                        <div className="mb-icon"><Emoji e={o.icon} size={20} /></div>
                        <div className="grotesk mb-name">{o.name}</div>
                        <div className="mono mb-line">{o.line}</div>
                        {golfLocked && <div className="mono mb-tag">CLASSIC SCORING</div>}
                        {step.key === 'matchup' && (
                          <button className="mono mb-play" onClick={(e) => { e.stopPropagation(); track(Ev.mascotPlay, { game: o.id }); onPlay(o.id as 'drip' | 'classic'); }} title={`Play a free demo week of ${o.name}`}>▶ PLAY A WEEK</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 14px 12px' }}>
              <button onClick={() => { setPhase('setup'); setSetup((s) => ({ ...s, teams: Math.max(s.teams, seed.minTeams) })); }} className="mono" style={{ ...cta, boxShadow: '0 0 22px color-mix(in srgb, var(--you) 40%, transparent)' }}>
                BUILD THIS LEAGUE →
              </button>
              <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>Then the roster, scoring, teams, draft and waivers — and a link to share.</span>
            </div>
          </div>
        )}

        {/* SETUP: the checklist, each row its own dialogue */}
        {phase === 'setup' && (
          <div className="mb-setuplist">
            {go.st === 'done' ? (
              <div style={{ padding: '14px 14px 16px' }}>
                <div className="mono" style={{ ...lbl, color: 'var(--you)' }}>YOUR LEAGUE IS LIVE</div>
                <div className="grotesk" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', marginTop: 4 }}>{setup.name}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>{describeBuild(build)} · {setup.teams} teams. Send this link — it seats a friend the moment they sign in.</div>
                {go.code ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <input readOnly value={inviteLink(go.code)} onFocus={(e) => e.currentTarget.select()} style={{ ...input, flex: '1 1 240px', fontSize: 12 }} />
                    <button onClick={() => { void navigator.clipboard?.writeText(inviteLink(go.code)); }} className="mono" style={cta}>Copy link</button>
                    {typeof navigator !== 'undefined' && 'share' in navigator && (
                      <button onClick={() => { void navigator.share({ title: setup.name, text: `Join ${setup.name} — ${describeBuild(build)}`, url: inviteLink(go.code) }).catch(() => {}); }} className="mono" style={ghost}>Share…</button>
                    )}
                  </div>
                ) : <div className="mono" style={{ fontSize: 10, color: 'var(--warn)', marginTop: 10 }}>The league is made, but no invite code came back — it is on your commissioner dashboard.</div>}
                {go.misses.length > 0 && (
                  <div className="mono" style={{ fontSize: 10, color: 'var(--warn)', marginTop: 10, lineHeight: 1.5 }}>
                    Everything else landed, but these settings were refused and are still at their defaults — fix them on the league's settings tabs:
                    {go.misses.map((m) => <div key={m}>· {m}</div>)}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
                  <button onClick={() => navigate({ name: 'live' })} className="mono" style={cta}>Open my league →</button>
                  <button onClick={() => { setGo({ st: 'idle' }); setPhase('build'); setSetup(defaultSetup(build)); }} className="mono" style={link}>build another</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ padding: '12px 14px 4px' }}>
                  <div className="mono" style={lbl}>LEAGUE NAME</div>
                  <input value={setup.name} onChange={(e) => patch({ name: e.target.value.slice(0, 60) })} placeholder={`e.g. ${mascotName(build)}’s ${optionFor('mode', build.mode).name} League`} style={{ ...input, marginTop: 6 }} />
                </div>
                {([
                  ['roster', 'ROSTER', rosterLine],
                  ['scoring', 'SCORING', scoringLine],
                  ['teams', 'TEAMS', `${setup.teams} teams${seed.format === 'guillotine' ? ' · one eliminated a week, the survivor wins' : ''}`],
                  ['draft', 'DRAFT SETTINGS', draftLine],
                  ['waivers', 'WAIVERS', waiverLine],
                ] as [Dialog, string, string][]).map(([id, title, line]) => (
                  <div key={id} className={`mb-row${dialog === id ? ' open' : ''}`}>
                    <button onClick={() => setDialog(dialog === id ? null : id)} className="mb-rowhead">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="mono" style={lbl}>{title}</div>
                        <div className="mono" style={{ fontSize: 10, color: 'var(--text)', lineHeight: 1.5, marginTop: 3 }}>{line}</div>
                      </div>
                      <span className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: 'var(--you)', flex: 'none' }}>{dialog === id ? 'DONE ✓' : 'EDIT'}</span>
                    </button>
                    {dialog === id && (
                      <div className="mb-dialog">
                        {id === 'roster' && (classic ? (
                          <>
                            <div className="mono" style={lbl}>STARTING SPOTS</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '8px 14px', marginTop: 8 }}>
                              {CLASSIC_SLOT_TYPES.map((t) => (
                                <div key={t.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{t.label}</span>
                                  <Num v={setup.roster[t.type] ?? 0} min={0} max={6} set={(n) => { const r = { ...setup.roster }; if (n <= 0) delete r[t.type]; else r[t.type] = n; patch({ roster: r }); }} />
                                </div>
                              ))}
                            </div>
                            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
                              <div><div className="mono" style={lbl}>BENCH</div><Num v={setup.bench} min={0} max={20} set={(n) => patch({ bench: n })} /></div>
                              <div><div className="mono" style={lbl}>TAXI</div><Num v={setup.taxi} min={0} max={6} set={(n) => patch({ taxi: n })} /></div>
                              <div><div className="mono" style={lbl}>IR</div><Num v={setup.ir} min={0} max={6} set={(n) => patch({ ir: n })} /></div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                              <div><div className="mono" style={lbl}>ROSTER SIZE</div><Num v={setup.dripRoster} min={8} max={30} set={(n) => patch({ dripRoster: n })} /></div>
                            </div>
                            <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 6, lineHeight: 1.5 }}>Eight play each week, one per kickoff-window slot; the rest are bench.{build.type === 'contract_dynasty' ? ' A contract league sizes the roster to its salary market instead.' : ''}</div>
                            <div className="mono" style={{ ...lbl, marginTop: 12 }}>POSITION LIMITS</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '8px 14px', marginTop: 8 }}>
                              {POS_CAP_KEYS.map((k) => (
                                <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>{k === 'DEF' ? 'D/ST' : k}</span>
                                  <Num v={setup.caps[k]} min={0} max={CAP_UNLIMITED} set={(n) => patch({ caps: { ...setup.caps, [k]: n } })} fmt={(n) => (n >= CAP_UNLIMITED ? '∞' : String(n))} />
                                </div>
                              ))}
                            </div>
                          </>
                        ))}
                        {id === 'roster' && build.type === 'keeper' && (
                          <div style={{ marginTop: 14 }}><div className="mono" style={lbl}>KEEPERS PER TEAM</div><Num v={setup.keepN} min={1} max={15} set={(n) => patch({ keepN: n })} /></div>
                        )}
                        {id === 'roster' && (build.type === 'dynasty' || build.type === 'contract_dynasty') && (
                          <div style={{ marginTop: 14 }}><div className="mono" style={lbl}>ROOKIE DRAFT ROUNDS (EACH SPRING)</div><Num v={setup.rookieN} min={1} max={8} set={(n) => patch({ rookieN: n })} /></div>
                        )}

                        {id === 'scoring' && (classic ? (
                          <>
                            <div className="mono" style={lbl}>RECEPTIONS</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                              {[[0, 'Standard'], [0.5, 'Half PPR'], [1, 'Full PPR']].map(([v, t]) => <Chip key={String(v)} on={setup.ppr === v} onClick={() => patch({ ppr: v as number })}>{t as string}</Chip>)}
                            </div>
                            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
                              <div><div className="mono" style={lbl}>PASSING TD</div><Num v={setup.passTd} min={1} max={8} set={(n) => patch({ passTd: n })} /></div>
                              <div><div className="mono" style={lbl}>TE PREMIUM (+ PER CATCH)</div><Num v={setup.tePrem} min={0} max={2} step={0.5} set={(n) => patch({ tePrem: n })} /></div>
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                              <Chip on={setup.bestball} onClick={() => patch({ bestball: !setup.bestball })}>BEST BALL</Chip>
                              <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>your best lineup is started for you after the fact</span>
                            </div>
                            <div className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', marginTop: 10, lineHeight: 1.5 }}>Every other knob — about forty, IDP and kickers included — is on the league's SCORING tab once it exists.{seed.golf ? ' Golf is on: the lowest weekly total wins.' : ''}</div>
                          </>
                        ) : (
                          <div className="mono" style={{ fontSize: 10, color: 'var(--dim)', lineHeight: 1.6 }}>
                            Drip scoring is the game itself: every starter carries a sealed metric that decides how his real game becomes points and what it fires at the slot across from him. The TD bonus, yard multiplier and turnover penalty are tunable on the league's SCORING tab once it exists.
                          </div>
                        ))}

                        {id === 'teams' && (
                          <>
                            <Num v={setup.teams} min={seed.minTeams} max={32} set={(n) => patch({ teams: n })} />
                            <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 8, lineHeight: 1.5 }}>
                              {seed.format === 'guillotine' ? 'Guillotine plays all 17 weeks; 18 teams reaches one survivor on the final week, fewer simply finish earlier.' : seed.format === 'vampire' ? 'Appoint the coven — any number of vampires — in COMMISH before the draft.' : 'Even numbers keep every week a full slate of matchups.'}
                            </div>
                          </>
                        )}

                        {id === 'draft' && (
                          <>
                            <div className="mono" style={lbl}>PACE</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                              <Chip on={setup.pace === 'live'} onClick={() => patch({ pace: 'live' })}>LIVE — everyone in the room</Chip>
                              <Chip on={setup.pace === 'slow'} onClick={() => patch({ pace: 'slow' })}>SLOW — over days</Chip>
                            </div>
                            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
                              {setup.pace === 'live'
                                ? <div><div className="mono" style={lbl}>{seed.draftMode === 'auction' ? 'NOMINATION CLOCK (SEC)' : 'PICK CLOCK (SEC)'}</div><Num v={setup.clock} min={15} max={600} step={15} set={(n) => patch({ clock: n })} /></div>
                                : <div><div className="mono" style={lbl}>{seed.draftMode === 'auction' ? 'NOMINATION WINDOW (HRS)' : 'PICK CLOCK (HRS)'}</div><Num v={setup.clockHrs} min={1} max={48} set={(n) => patch({ clockHrs: n })} /></div>}
                              {seed.draftMode === 'auction' && <div><div className="mono" style={lbl}>BUDGET ($ / TEAM)</div><Num v={setup.budget} min={50} max={1000} step={25} set={(n) => patch({ budget: n })} /></div>}
                              {seed.draftMode === 'auction' && (setup.pace === 'live'
                                ? <div><div className="mono" style={lbl}>BID BELL (SEC)</div><Num v={setup.bellSecs} min={10} max={60} step={5} set={(n) => patch({ bellSecs: n })} /></div>
                                : <div><div className="mono" style={lbl}>BID WINDOW (HRS)</div><Num v={setup.bellHrs} min={1} max={48} set={(n) => patch({ bellHrs: n })} /></div>)}
                              {seed.draftMode === 'auction' && <div><div className="mono" style={lbl}>LOTS AT ONCE</div><Num v={setup.maxLots} min={1} max={4} set={(n) => patch({ maxLots: n })} /></div>}
                            </div>
                            {build.type === 'contract_dynasty' && build.draft === 'snake' && (
                              <div className="mono" style={{ fontSize: 9.5, color: 'var(--warn)', marginTop: 10, lineHeight: 1.5 }}>A contract league drafts by auction whatever the mascot's holding — the winning bid IS the salary.</div>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                              <Chip on={setup.night} onClick={() => patch({ night: !setup.night })}>OVERNIGHT PAUSE</Chip>
                              {setup.night && (
                                <>
                                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>from</span>
                                  <Num v={setup.nightStart} min={0} max={1425} step={15} set={(n) => patch({ nightStart: n })} fmt={fmtEt} />
                                  <span className="mono" style={{ fontSize: 9.5, color: 'var(--dim)' }}>to</span>
                                  <Num v={setup.nightEnd} min={0} max={1425} step={15} set={(n) => patch({ nightEnd: n })} fmt={fmtEt} />
                                </>
                              )}
                            </div>
                          </>
                        )}

                        {id === 'waivers' && (
                          <>
                            <div className="mono" style={lbl}>CLAIMS</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                              <Chip on={setup.waiverMode === 'faab'} onClick={() => patch({ waiverMode: 'faab' })}>FAAB — blind bids</Chip>
                              <Chip on={setup.waiverMode === 'rolling'} onClick={() => patch({ waiverMode: 'rolling' })}>ROLLING ORDER</Chip>
                              <Chip on={setup.waiverMode === 'standings'} onClick={() => patch({ waiverMode: 'standings' })}>REVERSE STANDINGS</Chip>
                            </div>
                            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 14 }}>
                              {setup.waiverMode === 'faab' && <div><div className="mono" style={lbl}>FAAB BUDGET ($)</div><Num v={setup.faab} min={0} max={5000} step={50} set={(n) => patch({ faab: n })} /></div>}
                              <div><div className="mono" style={lbl}>CLEAR TIME</div><Num v={setup.clearMin} min={0} max={1425} step={15} set={(n) => patch({ clearMin: n })} fmt={fmtEt} /></div>
                              <div><div className="mono" style={lbl}>HOLD (DAYS)</div><Num v={setup.holdDays} min={0} max={7} set={(n) => patch({ holdDays: n })} /></div>
                            </div>
                            <div className="mono" style={{ ...lbl, marginTop: 14 }}>CLEAR DAYS</div>
                            <div style={{ display: 'flex', gap: 5, marginTop: 6, flexWrap: 'wrap' }}>
                              {DOW.map((d, i) => <Chip key={d} on={setup.clearDow.includes(i)} onClick={() => patch({ clearDow: setup.clearDow.includes(i) ? setup.clearDow.filter((x) => x !== i) : [...setup.clearDow, i].sort() })}>{d}</Chip>)}
                              <span className="mono" style={{ fontSize: 9.5, color: 'var(--faint)', alignSelf: 'center' }}>{setup.clearDow.length ? '' : 'none picked = every day'}</span>
                            </div>
                            <div className="mono" style={{ ...lbl, marginTop: 14 }}>FREE AGENTS</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                              <Chip on={!setup.faAfter} onClick={() => patch({ faAfter: false })}>INSTANT — first come, first served</Chip>
                              <Chip on={setup.faAfter} onClick={() => patch({ faAfter: true })}>AFTER WAIVERS CLEAR</Chip>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* GO */}
                <div style={{ padding: '12px 14px 14px' }}>
                  {go.st === 'auth' ? (
                    <div className="mb-dialog" style={{ marginTop: 0 }}>
                      <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>One thing first: who’s the commissioner?</div>
                      <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>Sign in or make an account and {setup.name.trim()} is created the moment you’re through. Nothing you set above is lost.</div>
                      <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                        <Chip on={auth.mode === 'password'} onClick={() => setAuth((a) => ({ ...a, mode: 'password', err: null }))}>EMAIL + PASSWORD</Chip>
                        <Chip on={auth.mode === 'code'} onClick={() => setAuth((a) => ({ ...a, mode: 'code', err: null }))}>EMAIL ME A CODE</Chip>
                      </div>
                      <input value={auth.email} onChange={(e) => setAuth((a) => ({ ...a, email: e.target.value }))} type="email" inputMode="email" placeholder="you@example.com" autoComplete="email" style={{ ...input, marginTop: 10 }} />
                      {auth.mode === 'password' ? (
                        <>
                          <input value={auth.password} onChange={(e) => setAuth((a) => ({ ...a, password: e.target.value }))} type="password" placeholder="password" autoComplete="current-password" style={{ ...input, marginTop: 8 }} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                            <button disabled={auth.busy || !auth.email || !auth.password} onClick={() => void runAuth(async () => { await signInPassword(auth.email, auth.password); await afterSignIn(); })} className="mono" style={{ ...cta, opacity: auth.busy ? 0.6 : 1 }}>SIGN IN & CREATE →</button>
                            <button disabled={auth.busy || !auth.email || !auth.password} onClick={() => void runAuth(async () => { const r = await signUpPassword(auth.email, auth.password); if (r.needsConfirm) setAuth((a) => ({ ...a, info: 'Account created — confirm the email we sent, then come back and tap SIGN IN.' })); else await afterSignIn(); })} className="mono" style={{ ...ghost, opacity: auth.busy ? 0.6 : 1 }}>CREATE ACCOUNT</button>
                          </div>
                        </>
                      ) : (
                        <>
                          {auth.sent && <input value={auth.token} onChange={(e) => setAuth((a) => ({ ...a, token: e.target.value }))} inputMode="numeric" placeholder="the 6-digit code" style={{ ...input, marginTop: 8, letterSpacing: '0.2em' }} />}
                          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                            {!auth.sent
                              ? <button disabled={auth.busy || !auth.email} onClick={() => void runAuth(async () => { await sendMagicLink(auth.email); setAuth((a) => ({ ...a, sent: true, info: 'Code sent — check your email.' })); })} className="mono" style={{ ...cta, opacity: auth.busy ? 0.6 : 1 }}>SEND CODE →</button>
                              : <>
                                <button disabled={auth.busy || auth.token.trim().length < 6} onClick={() => void runAuth(async () => { await verifyEmailOtp(auth.email, auth.token); await afterSignIn(); })} className="mono" style={{ ...cta, opacity: auth.busy ? 0.6 : 1 }}>VERIFY & CREATE →</button>
                                <button disabled={auth.busy} onClick={() => void runAuth(async () => { await sendMagicLink(auth.email); setAuth((a) => ({ ...a, info: 'New code sent.' })); })} className="mono" style={link}>resend</button>
                              </>}
                          </div>
                        </>
                      )}
                      {auth.info && <div className="mono" style={{ fontSize: 10, color: 'var(--you)', marginTop: 8 }}>{auth.info}</div>}
                      {auth.err && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8 }}>{auth.err}</div>}
                      <button onClick={() => setGo({ st: 'idle' })} className="mono" style={{ ...link, marginTop: 10 }}>← back</button>
                    </div>
                  ) : go.st === 'busy' ? (
                    <div className="mono" style={{ fontSize: 10.5, color: 'var(--you)', fontWeight: 700 }}>⏳ {go.note}</div>
                  ) : go.st === 'denied' ? (
                    <div className="mb-dialog" style={{ marginTop: 0 }}>
                      <div className="grotesk" style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Your league is designed. The pilot is invite-only.</div>
                      <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', marginTop: 4, lineHeight: 1.5 }}>This account can’t open leagues yet. Request a seat and the design rides along — we build exactly this and send you the link.</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                        <button onClick={() => onRequest(requestNote)} className="mono" style={cta}>◈ Request this league</button>
                        <button onClick={() => setGo({ st: 'idle' })} className="mono" style={link}>← back</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => void onGo()} className="mono" style={{ ...cta, width: '100%', padding: '14px 0', fontSize: 12.5, boxShadow: '0 0 22px color-mix(in srgb, var(--you) 40%, transparent)' }}>GO — CREATE {setup.name.trim() ? setup.name.trim().toUpperCase() : 'THE LEAGUE'} & GET THE LINK →</button>
                      {go.st === 'error' && <div className="mono" style={{ fontSize: 10, color: 'var(--opp)', marginTop: 8, lineHeight: 1.5 }}>{go.msg}</div>}
                      <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>You’ll sign in (or make an account) at this step. Everything above is saved on this device until then.</div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ── the sheet ──────────────────────────────────────────────────────────────
const CSS = `
.mb{margin-top:18px;border:1px solid var(--bd);border-radius:12px;overflow:hidden;background:
  radial-gradient(120% 80% at 0% 0%, color-mix(in srgb, var(--you) 14%, transparent), transparent 60%),
  radial-gradient(90% 70% at 100% 100%, color-mix(in srgb, var(--opp) 8%, transparent), transparent 60%),
  var(--surface);display:grid;grid-template-columns:1fr;transition:grid-template-columns .45s ease}
.mb>*{min-width:0}
.mb-steps,.mb-setuplist{overflow:hidden}
.mb-left{text-align:center;padding:16px 14px 8px;transition:padding .45s ease}
.mb-stage{animation:mb-pop .42s cubic-bezier(.2,1.4,.4,1)}
@keyframes mb-pop{0%{transform:translateY(6px) scale(.94)}60%{transform:translateY(-4px) scale(1.03)}100%{transform:none}}
.mb-glow{animation:mb-breathe 3.2s ease-in-out infinite}
@keyframes mb-breathe{0%,100%{opacity:.7}50%{opacity:1}}
.mb-layer{transition:transform .35s ease}
.mb-h{font-size:8px;font-weight:700;letter-spacing:.14em;color:var(--faint);padding:8px 14px 0}
.mb-strip{display:flex;gap:8px;min-width:0;overflow-x:auto;padding:6px 14px 10px;scroll-snap-type:x proximity;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.mb-strip::-webkit-scrollbar{display:none}
.mb-card{flex:0 0 156px;scroll-snap-align:start;position:relative;display:flex;flex-direction:column;gap:5px;padding:10px 11px 9px;border-radius:10px;border:1px solid var(--bd);background:var(--bg);cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;outline:none;
  transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background .18s ease}
.mb-card:hover,.mb-card:focus-visible{transform:translateY(-2px);border-color:color-mix(in srgb,var(--you) 45%,var(--bd))}
.mb-card.on{border-color:var(--you);background:color-mix(in srgb,var(--you) 12%,var(--bg));box-shadow:0 0 0 1px var(--you) inset,0 8px 24px color-mix(in srgb,var(--you) 22%,transparent)}
.mb-card.on::after{content:'✓';position:absolute;top:7px;right:9px;font:700 10px/1 monospace;color:var(--you)}
.mb-card.locked{opacity:.75}
.mb-icon{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,var(--you) 10%,transparent);border:1px solid color-mix(in srgb,var(--you) 25%,transparent)}
.mb-card.on .mb-icon{background:color-mix(in srgb,var(--you) 28%,transparent);border-color:var(--you)}
.mb-name{font-size:13px;font-weight:700;color:var(--text);letter-spacing:-.01em}
.mb-line{font-size:9.5px;line-height:1.45;color:var(--dim);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.mb-tag{font-size:7.5px;font-weight:700;letter-spacing:.12em;color:var(--warn);border:1px dashed color-mix(in srgb,var(--warn) 50%,var(--bd));border-radius:4px;padding:2px 6px;align-self:flex-start}
.mb-play{margin-top:auto;align-self:flex-start;font-size:8.5px;font-weight:700;letter-spacing:.1em;padding:5px 9px;border-radius:5px;border:1px solid color-mix(in srgb,var(--you) 55%,var(--bd));background:var(--you);color:var(--on-accent);cursor:pointer;box-shadow:0 0 14px color-mix(in srgb,var(--you) 35%,transparent)}
.mb-play:hover{filter:brightness(1.08)}
.mb-setuplist{border-top:1px solid var(--bd);animation:mb-in .45s ease}
@keyframes mb-in{from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}}
.mb-row{border-top:1px solid var(--bd)}
.mb-rowhead{width:100%;display:flex;align-items:center;gap:10px;text-align:left;background:none;border:none;padding:11px 14px;cursor:pointer;color:inherit;font:inherit}
.mb-row.open .mb-rowhead{background:color-mix(in srgb,var(--you) 6%,transparent)}
.mb-dialog{margin:0 14px 12px;padding:12px 13px;border-radius:9px;border:1px solid color-mix(in srgb,var(--you) 35%,var(--bd));background:var(--bg);animation:mb-in .3s ease}
@media (min-width:720px){
  .mb-strip{flex-wrap:wrap;overflow:visible}.mb-card{flex:1 1 150px;max-width:220px}
  .mb.mb-setup{grid-template-columns:260px 1fr}
  .mb.mb-setup .mb-left{padding:22px 14px;border-right:1px solid var(--bd);animation:mb-slide .45s ease}
  .mb.mb-setup .mb-setuplist{border-top:none}
  @keyframes mb-slide{from{transform:translateX(60%)}to{transform:none}}
}
@media (max-width:719px){
  .mb.mb-setup .mb-left{display:flex;align-items:center;gap:12px;text-align:left;padding:10px 14px}
  .mb.mb-setup .mb-left .mb-stage{margin:0;flex:none}
  .mb.mb-setup .mb-leftText{min-width:0;flex:1}
  .mb.mb-setup .mb-leftText>*{margin-top:2px !important}
}
`;
function MascotCss() {
  useEffect(() => {
    if (document.getElementById('mb-css')) return;
    const el = document.createElement('style');
    el.id = 'mb-css';
    el.textContent = CSS;
    document.head.appendChild(el);
  }, []);
  return null;
}
