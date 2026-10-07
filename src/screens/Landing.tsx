// THE FRONT DOOR (v0.614.0; the funnel's revision, v0.650.0).
//
// Founder's revamp of the signed-out web flow, revised: the welcome and the
// dreamers line, "Count me in! | Sign in" with no small print under it, then
// the five feature groups — the chips stay — each with a rail of phone
// screens rotating beside them, and the matchup card doubling as the door to
// the demo ("Click here for a demo"). Bullseye joined the competitive modes.
//
// The screens are the founder's phone screenshots, dropped into
// public/brand/funnel/ under the names FUNNEL_SHOTS lists (the README there
// is the shooting list). A file that is not there yet draws as a labelled
// placeholder in the same frame, so the page keeps its shape while the rail
// fills in. Signed-in visitors never see this: the boot route sends them to
// their leagues, and a session found here does too.
import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings } from '../app/ui';
import { Faq } from './Faq';
import { RequestCodeModal } from './RequestCode';
import { FUNNEL, LANDING_FEATURES, type FormatNote } from '@drip/core/data/leagueTagline';
import { APP_VERSION } from '@drip/core/version';
import { signupOpen, getSession } from '@drip/core/data/liveApi';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { markBootSessionChecked } from './DemoBoard';

const cta: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 7, padding: '13px 22px', cursor: 'pointer', whiteSpace: 'nowrap' };
const ghost: React.CSSProperties = { ...cta, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--bd)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

let sessionChecked = false;

/** One screen on a card's rail. `file` lives in public/brand/funnel/ (a phone
 *  screenshot, portrait) unless `dir` says otherwise; `label` is the caption
 *  under it and the placeholder's text until the file exists. */
interface Shot { file: string; label: string; dir?: 'funnel' | 'brand' }

/** THE SHOOTING LIST. Every file here is one the founder makes on a phone;
 *  the README beside them repeats this list with what each one should show.
 *  Keyed by the feature heading in LANDING_FEATURES. */
export const FUNNEL_SHOTS: Record<string, Shot[]> = {
  'League types': [
    { file: 'league-redraft.png', label: 'Redraft' },
    { file: 'league-contract.png', label: 'Contract' },
    { file: 'league-full-college.png', label: 'Full college' },
    { file: 'league-mixed-college.png', label: 'Mixed college' },
    { file: 'league-devy-market.png', label: 'Devy market' },
  ],
  'Competitive modes': [
    { file: 'mode-vampire.png', label: 'Vampire' },
    { file: 'mode-guillotine.png', label: 'Guillotine' },
    { file: 'mode-golf.png', label: 'Golf' },
    { file: 'mode-bullseye.png', label: 'Bullseye' },
  ],
  'Positions': [
    { file: 'positions-scoped.png', label: 'Scoped & named positions' },
    { file: 'positions-hc-draft.png', label: 'HC draft' },
  ],
  'Scoring options': [
    { file: 'scoring-bestball-mix.png', label: 'Best ball & non-roster, mixed' },
    { file: 'scoring-scoped-bonuses.png', label: 'Scoped bonuses' },
  ],
  // The matchup card rotates the drip screens the site already has (shot in
  // the running app, v0.614.1) — landscape, so it gets the wide frame.
  'Matchup style': [
    { file: 'shot-drip-live.png', label: 'Drip · the Sunday window, live', dir: 'brand' },
    { file: 'shot-sealed.jpg', label: 'Drip · sealed picks before kickoff', dir: 'brand' },
    { file: 'shot-duel.png', label: 'Drip · a live duel', dir: 'brand' },
    { file: 'shot-classic.png', label: 'Classic · the board', dir: 'brand' },
  ],
};

const ROTATE_MS = 3600;

/** A rail of screens that rotates on its own: one frame, the shots crossfading
 *  through it, a caption and a dot per shot. Tap a dot to jump; the rail
 *  carries on from there. A missing file is a labelled placeholder, not a
 *  broken-image glyph, so the founder sees which slot each file fills. */
function Rail({ shots, ratio, width, base, onTap }: { shots: Shot[]; ratio: string; width: number | string; base: string; onTap?: () => void }) {
  const [i, setI] = useState(0);
  const [missing, setMissing] = useState<Record<string, true>>({});
  useEffect(() => {
    if (shots.length < 2) return;
    const t = setInterval(() => setI((n) => (n + 1) % shots.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [shots.length, i]); // `i` in the deps: a tap on a dot restarts the clock from that shot.
  const cur = shots[Math.min(i, shots.length - 1)];
  if (!cur) return null;
  const frame: React.CSSProperties = { position: 'relative', width, aspectRatio: ratio, overflow: 'hidden', borderRadius: 8, background: 'var(--bg)', border: '1px solid var(--bd)', flex: 'none' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flex: 'none', width }}>
      <div role={onTap ? 'button' : undefined} onClick={onTap} style={{ ...frame, cursor: onTap ? 'pointer' : 'default' }}>
        {shots.map((s, k) => {
          // VERSIONED (v0.650.4): the service worker keeps images cache-first
          // by URL, so a screen replaced under the same name never reached an
          // installed browser. The version on the query makes each release a
          // new URL; the file on disk keeps its name.
          const src = `${base}brand/${s.dir === 'brand' ? '' : 'funnel/'}${s.file}?v=${APP_VERSION}`;
          const on = k === i;
          return missing[s.file]
            ? (on && <div key={s.file} className="mono" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 10, fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--faint)', lineHeight: 1.5 }}>{s.label.toUpperCase()}<br />SCREEN COMING</div>)
            : <img key={s.file} src={src} alt={s.label} loading={k === 0 ? 'eager' : 'lazy'} onError={() => setMissing((m) => ({ ...m, [s.file]: true }))}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', opacity: on ? 1 : 0, transition: 'opacity 600ms ease' }} />;
        })}
      </div>
      <div className="mono" style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--dim)', textAlign: 'center', lineHeight: 1.4, minHeight: 13 }}>{cur.label.toUpperCase()}</div>
      {shots.length > 1 && (
        <div style={{ display: 'flex', gap: 5 }}>
          {shots.map((s, k) => (
            <button key={s.file} aria-label={s.label} onClick={() => setI(k)}
              style={{ width: 6, height: 6, borderRadius: 3, padding: 0, border: 'none', cursor: 'pointer', background: k === i ? 'var(--you)' : 'var(--bd)' }} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Landing() {
  const { navigate } = useStore();
  const [door, setDoor] = useState<{ open: boolean; count: number; cap: number } | null>(null);
  const [faq, setFaq] = useState(false);
  const [waitlist, setWaitlist] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const narrow = typeof window !== 'undefined' && window.innerWidth < 640;

  // A signed-in player who lands here (OAuth return, magic link in a fresh
  // tab) belongs on their leagues. Once per app load, like the demo's check.
  useEffect(() => {
    if (sessionChecked || !liveConfigured()) return;
    sessionChecked = true;
    getSession().then((s) => { if (s) { markBootSessionChecked(); navigate({ name: 'live' }); } }).catch(() => {});
  }, [navigate]);
  useEffect(() => { let dead = false; signupOpen().then((d) => { if (!dead) setDoor(d); }); return () => { dead = true; }; }, []);
  // The door still has a cap (0422): when it is shut, "Count me in!" takes
  // the waiting-list form instead of the sign-up — the page says nothing
  // about it either way.
  const full = door != null && !door.open;
  const base = import.meta.env.BASE_URL;

  const countMeIn = () => (full ? setWaitlist(true) : navigate({ name: 'live', view: 'signup' }));
  const toDemo = () => navigate({ name: 'demo' });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', overflowX: 'hidden' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', gap: 8, flexWrap: 'wrap' }}>
        <img src={`${base}brand/hero-wordmark.png`} alt="Drip Fantasy" style={{ height: 26, width: 'auto' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={toDemo} className="mono" style={linkBtn}>demo</button>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <button onClick={() => setFaq(true)} className="mono" style={linkBtn}>FAQ</button>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <button onClick={() => navigate({ name: 'live' })} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>sign in</button>
          <SiteSettings minimal />
        </div>
      </header>

      {/* minWidth 0: a flex item's automatic minimum is its min-content width,
          and a percentage-width img inside would otherwise hand the whole
          page its intrinsic width and a sideways scroll on a phone. */}
      <main style={{ flex: 1, width: '100%', minWidth: 0, maxWidth: 640, margin: '0 auto', padding: '8px 16px 40px', boxSizing: 'border-box' }}>
        {/* ── WELCOME ─────────────────────────────────────────────────── */}
        <section style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', padding: '18px 0 8px' }}>
          <img src={`${base}brand/hero-mark.png`} alt="" style={{ height: narrow ? 150 : 210, width: 'auto', flex: 'none', margin: '0 auto' }} />
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <h1 className="grotesk" style={{ fontSize: 'clamp(24px, 4.6vw, 36px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.1, margin: 0, color: 'var(--text)' }}>{FUNNEL.welcome}</h1>
            <p style={{ fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.55, margin: '12px 0 0', maxWidth: '58ch' }}>
              {FUNNEL.pitch}{' '}
              <button onClick={() => setFaq(true)} className="mono" style={{ ...linkBtn, color: 'var(--you)', padding: 0, fontSize: 11 }}>({FUNNEL.more})</button>
            </p>
            <div className="grotesk" style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', marginTop: 18, letterSpacing: '-0.01em' }}>{FUNNEL.dreamers}</div>
            <p style={{ fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.55, margin: '6px 0 0', maxWidth: '58ch' }}>{FUNNEL.dreamersLine}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 18 }}>
              <button onClick={countMeIn} className="mono" style={cta}>{FUNNEL.cta}</button>
              <button onClick={() => navigate({ name: 'live' })} className="mono" style={ghost}>{FUNNEL.signIn}</button>
            </div>
          </div>
        </section>

        {/* ── FEATURES: one column (v0.650.2, founder: "a single column page
            with the screen shots under the chips"). Each card is the chips,
            then its rail of screens under them. The matchup card is the last
            one and the door to the demo. ─────────────────────────────── */}
        <section style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {LANDING_FEATURES.map((g) => {
            const open = g.notes.find((n: FormatNote) => openNote === `${g.heading}|${n.name}`);
            const matchup = g.heading === 'Matchup style';
            const shots = FUNNEL_SHOTS[g.heading] ?? [];
            const chips = (
              <>
                <div className="grotesk" style={{ fontSize: 16, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{g.heading}</div>
                <div className="mono" style={{ fontSize: 9, color: 'var(--faint)', letterSpacing: '0.06em', marginTop: 3 }}>{g.sub.toUpperCase()}</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                  {g.notes.map((n: FormatNote) => {
                    const key = `${g.heading}|${n.name}`;
                    const lit = openNote === key;
                    return (
                      <button key={n.name} className="mono" aria-pressed={lit} onClick={() => setOpenNote((o) => (o === key ? null : key))}
                        style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.05em', padding: '6px 10px', borderRadius: 5, cursor: 'pointer',
                          color: lit ? 'var(--on-accent)' : 'var(--text)', background: lit ? 'var(--you)' : 'var(--bg)', border: `1px solid ${lit ? 'var(--you)' : 'var(--bd)'}` }}>
                        {n.icon ? <span style={{ marginRight: 5 }}>{n.icon}</span> : null}{n.name.toUpperCase()}
                      </button>
                    );
                  })}
                </div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--dim)', lineHeight: 1.55, marginTop: 10, minHeight: 18 }}>
                  {open
                    ? <><b style={{ color: 'var(--text)' }}>{open.name}.</b> {open.line}</>
                    : <span style={{ color: 'var(--faint)' }}>Tap one to read what it changes.</span>}
                </div>
              </>
            );
            return (
              <div key={g.heading} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: '14px 14px 14px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {matchup ? (
                  <>
                    <div style={{ width: '100%' }}>{chips}</div>
                    {/* The demo door: the drip screens rotate under one button. */}
                    <div style={{ position: 'relative', width: '100%' }}>
                      <Rail shots={shots} ratio="16 / 9" width="100%" base={base} onTap={toDemo} />
                      <button onClick={toDemo} className="mono" title="Play a week of Drip — free, no sign-in"
                        style={{ ...cta, position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', padding: '11px 18px', boxShadow: '0 4px 18px rgba(0,0,0,0.35)' }}>
                        ▶ {FUNNEL.demo.toUpperCase()}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div>{chips}</div>
                    {/* The phone frame sits centred under the chips, big enough to read. */}
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <Rail shots={shots} ratio="9 / 19" width={narrow ? 200 : 220} base={base} />
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </section>

        <footer style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center', marginTop: 30, flexWrap: 'wrap' }}>
          <button onClick={() => setFaq(true)} className="mono" style={linkBtn}>FAQ</button>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <a href={`${base}rulebook/`} className="mono" style={{ ...linkBtn, textDecoration: 'none' }}>Rulebook</a>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <a href={`${base}privacy.html`} className="mono" style={{ ...linkBtn, textDecoration: 'none' }}>Privacy</a>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <button onClick={() => setWaitlist(true)} className="mono" style={linkBtn}>Ask us to set up a league</button>
        </footer>
      </main>

      {faq && <Faq onClose={() => setFaq(false)} />}
      {waitlist && <RequestCodeModal initialPlatform="" onClose={() => setWaitlist(false)} />}
    </div>
  );
}
