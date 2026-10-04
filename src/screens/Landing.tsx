// THE FRONT DOOR (v0.614.0). Founder's revamp of the signed-out web flow:
//
//   Not logged in: Get account · Features (League Types · Competitive Modes ·
//   Positions · Scoring Options · Matchup Style) · Drip demo image, click to
//   demo. "Get account based on available counts … or get on waiting list."
//
// The demo used to BE the landing (DemoBoard, with the menu of switches above
// it). Now the landing is a page: the account door first — open while there
// is a spot (0422's cap), the waitlist when there isn't — then the five
// feature groups the founder named, each chip opening one line, then the
// demo as a picture you click into. The demo keeps its own route and its
// explainer; nothing there changed. Signed-in visitors never see this: the
// boot route sends them to their leagues, and a session found here does too.
import { useEffect, useState } from 'react';
import { useStore } from '../app/store';
import { SiteSettings } from '../app/ui';
import { Faq } from './Faq';
import { RequestCodeModal } from './RequestCode';
import { SITE_PITCH, LANDING_FEATURES, type FormatNote } from '@drip/core/data/leagueTagline';
import { signupOpen, getSession } from '@drip/core/data/liveApi';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { markBootSessionChecked } from './DemoBoard';

const cta: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--on-accent)', background: 'var(--you)', border: 'none', borderRadius: 7, padding: '13px 22px', cursor: 'pointer', whiteSpace: 'nowrap' };
const ghost: React.CSSProperties = { ...cta, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--bd)' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };

let sessionChecked = false;

/** Real screens from the running app (headless Chromium, v0.614.1). The
 *  ratio keeps every tile the same shape whatever the crop. */
const SITE_SHOTS: { file: string; title: string; line: string; alt: string; ratio: string; route: { name: 'demo'; view?: 'board' } | { name: 'classicSim' } }[] = [
  { file: 'shot-sealed.jpg', title: 'Sealed picks', line: 'Your opponent’s cards stay face-down until kickoff. Scout their pool, not their picks.', alt: 'A Drip lineup before kickoff: open spots on your side, the opponent’s picks shown as card backs', ratio: '4 / 3', route: { name: 'demo' } },
  { file: 'shot-duel.png', title: 'Live duels', line: 'Each spot is a head-to-head duel; every real NFL play drips points onto one side or the other.', alt: 'A Thursday-night duel: J. Jacobs against D. Samuel, the play log dripping points as the game runs', ratio: '4 / 3', route: { name: 'demo', view: 'board' } },
  { file: 'shot-classic.png', title: 'Classic board', line: 'A positional lineup and weekly totals, scored live. PPR, half, standard and best ball at a tap.', alt: 'The Classic board: two nine-man lineups side by side with live totals', ratio: '4 / 3', route: { name: 'classicSim' } },
  { file: 'shot-fields.png', title: 'Every game on a field', line: 'Each real game drawn live: the ball spot, the drive, the last play — one field per game on the slate.', alt: 'A live field: Jaguars at Bengals, the ball at the Cincinnati 16, second and fourteen', ratio: '4 / 3', route: { name: 'classicSim' } },
];

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
  const full = door != null && !door.open;
  const base = import.meta.env.BASE_URL;

  const getAccount = () => navigate({ name: 'live', view: 'signup' });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', overflowX: 'hidden' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', gap: 8, flexWrap: 'wrap' }}>
        <img src={`${base}brand/hero-wordmark.png`} alt="Drip Fantasy" style={{ height: 26, width: 'auto' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate({ name: 'demo' })} className="mono" style={linkBtn}>demo</button>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <button onClick={() => setFaq(true)} className="mono" style={linkBtn}>FAQ</button>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <button onClick={() => navigate({ name: 'live' })} className="mono" style={{ ...linkBtn, color: 'var(--you)' }}>sign in</button>
          <SiteSettings minimal />
        </div>
      </header>

      {/* minWidth 0: a flex item's automatic minimum is its min-content width,
          and the demo picture below (a percentage-width img) would otherwise
          hand the whole page its intrinsic 1280px and a sideways scroll on a
          phone. */}
      <main style={{ flex: 1, width: '100%', minWidth: 0, maxWidth: 880, margin: '0 auto', padding: '8px 16px 40px', boxSizing: 'border-box' }}>
        {/* ── GET ACCOUNT ─────────────────────────────────────────────── */}
        <section style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', padding: '18px 0 8px' }}>
          <img src={`${base}brand/hero-mark.png`} alt="" style={{ height: narrow ? 150 : 210, width: 'auto', flex: 'none', margin: '0 auto' }} />
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div className="mono" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--you)' }}>{SITE_PITCH.kicker}</div>
            <h1 className="grotesk" style={{ fontSize: 'clamp(26px, 5.2vw, 40px)', fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.08, margin: '8px 0 0', color: 'var(--text)' }}>{SITE_PITCH.headline}</h1>
            <p style={{ fontSize: 13.5, color: 'var(--dim)', lineHeight: 1.55, margin: '12px 0 0', maxWidth: '58ch' }}>{SITE_PITCH.sub}</p>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 18 }}>
              {full ? (
                <>
                  <button onClick={() => setWaitlist(true)} className="mono" style={cta}>Get on the waiting list →</button>
                  <button onClick={() => navigate({ name: 'live' })} className="mono" style={ghost}>Sign in</button>
                </>
              ) : (
                <>
                  <button onClick={getAccount} className="mono" style={cta}>Get account →</button>
                  <button onClick={() => navigate({ name: 'live' })} className="mono" style={ghost}>Sign in</button>
                </>
              )}
            </div>
            <div className="mono" style={{ fontSize: 9.5, color: full ? 'var(--warn, #c96)' : 'var(--faint)', letterSpacing: '0.06em', marginTop: 10, lineHeight: 1.6 }}>
              {door == null || !(door.cap > 0) ? 'FREE WHILE THERE’S A SPOT · ANY ACCOUNT CAN START A LEAGUE, BRING ONE IN, OR JOIN ONE'
                : full ? `FULL RIGHT NOW — ALL ${door.cap.toLocaleString()} SPOTS TAKEN. LEAVE YOUR EMAIL AND WE’LL TELL YOU WHEN ONE OPENS.`
                : `FREE · ${Math.max(0, door.cap - door.count).toLocaleString()} OF ${door.cap.toLocaleString()} SPOTS OPEN · ANY ACCOUNT CAN START A LEAGUE, BRING ONE IN, OR JOIN ONE`}
            </div>
          </div>
        </section>

        {/* ── FEATURES ────────────────────────────────────────────────── */}
        <section style={{ marginTop: 26 }}>
          <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--faint)', marginBottom: 10 }}>FEATURES · EVERY ONE A SWITCH A COMMISSIONER HAS · TAP A CHIP</div>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
            {LANDING_FEATURES.map((g) => {
              const open = g.notes.find((n: FormatNote) => openNote === `${g.heading}|${n.name}`);
              return (
                <div key={g.heading} style={{ background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: '14px 14px 12px', display: 'flex', flexDirection: 'column' }}>
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
                </div>
              );
            })}
          </div>
        </section>

        {/* ── PICTURES FROM THE SITE (founder: "Include pictures from the
            site") — real screens, shot from the running app, each one a door
            into the demo. ──────────────────────────────────────────────── */}
        <section style={{ marginTop: 26 }}>
          <div className="mono" style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--faint)', marginBottom: 10 }}>FROM THE SITE · TAP ONE TO PLAY IT</div>
          <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
            {SITE_SHOTS.map((s) => (
              <button key={s.file} onClick={() => navigate(s.route)} title={s.title}
                style={{ padding: 0, textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden', cursor: 'pointer', display: 'flex', flexDirection: 'column' }}>
                <div style={{ aspectRatio: s.ratio, overflow: 'hidden', background: 'var(--bg)' }}>
                  <img src={`${base}brand/${s.file}`} alt={s.alt} loading="lazy" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                </div>
                <div style={{ padding: '10px 12px 12px' }}>
                  <div className="grotesk" style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>{s.title}</div>
                  <div className="mono" style={{ fontSize: 9.5, color: 'var(--dim)', lineHeight: 1.5, marginTop: 3 }}>{s.line}</div>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* ── THE DEMO ────────────────────────────────────────────────── */}
        <section style={{ marginTop: 26 }}>
          <button onClick={() => navigate({ name: 'demo' })} title="Play a week of Drip — free, no sign-in"
            style={{ display: 'block', width: '100%', padding: 0, textAlign: 'left', background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 12, overflow: 'hidden', cursor: 'pointer' }}>
            <div style={{ position: 'relative' }}>
              <img src={`${base}brand/shot-drip-live.png`} alt="The Drip demo board live: the Sunday 1pm window battle, three duels dripping points, and a nuke caption" style={{ display: 'block', width: '100%', maxWidth: '100%', height: 'auto' }} />
              {!narrow && <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 55%, color-mix(in srgb, var(--surface) 92%, transparent) 100%)' }} />}
              {/* The caption rides the picture on a wide screen and sits under
                  it on a phone, where the picture is too small to carry it. */}
              <div className="mono" style={narrow
                ? { padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }
                : { position: 'absolute', left: 16, bottom: 14, right: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <span>
                  <span className="grotesk" style={{ display: 'block', fontSize: 20, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>Play a week of Drip</span>
                  <span style={{ fontSize: 10, color: 'var(--dim)', letterSpacing: '0.06em', lineHeight: 1.5 }}>SEALED PICKS · LIVE EFFECTS · REAL NFL PLAY-BY-PLAY · FREE, NO SIGN-IN</span>
                </span>
                <span style={{ ...cta, padding: '11px 18px', textAlign: 'center' }}>▶ OPEN THE DEMO</span>
              </div>
            </div>
          </button>
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
