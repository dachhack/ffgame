import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Pos, ThemeName } from '../theme';
import { useStore, type CardSkin } from './store';
import { headshot, espnHeadshot, teamLogo } from '../data/media';
import { injuryFor } from '../data/injuries';
import { REG_SEASON_WEEKS } from '../data/league';
import { APP_VERSION, DATA_SOURCE } from './version';
import { Rulebook } from '../screens/Rulebook';
import { markBootSessionChecked } from '../screens/DemoBoard';
import { Faq } from '../screens/Faq';
import { GameIcon, UI_ART, BRAND_MARK, ICON_SETS } from './gameIcons';
import { liveConfigured } from '../data/supabaseClient';
import { getSession, onAuth, signOut, isAdmin } from '../data/liveApi';

/** True when the viewport is at/below `maxWidth` — drives the mobile layout. */
export function useIsMobile(maxWidth = 760): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(`(max-width:${maxWidth}px)`).matches);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width:${maxWidth}px)`);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [maxWidth]);
  return m;
}

/** Dimmed full-screen backdrop for modal cards, anchored to the VISUAL viewport.
 *
 *  `position: fixed; inset: 0` pins to the *layout* viewport. On phones the two
 *  diverge whenever the page is zoomed — e.g. iOS auto-zooms into a small text
 *  field and stays zoomed — and a plain fixed overlay then opens wherever the
 *  layout origin happens to be: hanging off the right edge, or above the fold
 *  entirely once you've scrolled down to a late window. Tracking
 *  window.visualViewport keeps the backdrop (and the card in it) over what's
 *  actually on screen.
 */
export function ModalBackdrop({ onClick, zIndex = 70, padTop = 40, children }: {
  onClick?: () => void; zIndex?: number; padTop?: number; children: ReactNode;
}) {
  // null → the viewports agree; plain inset:0 is exact (and never re-renders).
  const [vv, setVv] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useEffect(() => {
    const v = window.visualViewport;
    if (!v) return;
    const update = () => {
      const zoomed = v.scale !== 1 || v.offsetTop !== 0 || v.offsetLeft !== 0;
      setVv(zoomed ? { top: v.offsetTop, left: v.offsetLeft, width: v.width, height: v.height } : null);
    };
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => { v.removeEventListener('resize', update); v.removeEventListener('scroll', update); };
  }, []);
  return (
    <div
      onClick={onClick}
      style={{
        position: 'fixed',
        ...(vv ? { top: vv.top, left: vv.left, width: vv.width, height: vv.height } : { inset: 0 }),
        background: 'rgba(0,0,0,0.6)', zIndex, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: `${padTop}px 16px`, overflow: 'auto',
      }}
    >
      {children}
    </div>
  );
}

const INJURY_COLOR: Record<string, string> = { O: '#FF4F62', IR: '#C2304A', D: '#FF8A3D', Q: '#E8B23A' };
const INJURY_LABEL: Record<string, string> = { O: 'Out', IR: 'Injured Reserve', D: 'Doubtful', Q: 'Questionable' };
/** Info-only weekly injury / IR badge for a player slug, or nothing. */
export function InjuryBadge({ week, slug, style }: { week: number; slug: string; style?: CSSProperties }) {
  const s = injuryFor(week, slug);
  if (!s) return null;
  const c = INJURY_COLOR[s];
  return (
    <span className="mono" title={INJURY_LABEL[s]} style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.04em', color: c, border: `1px solid ${c}`, borderRadius: 2, padding: '0 3px', lineHeight: 1.5, flex: 'none', ...style }}>{s}</span>
  );
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const GROTESK = "'Space Grotesk', system-ui, sans-serif";

// An image that swaps to a fallback node if it fails to load (offline / 404).
export function Img({ src, size, radius, alt, fallback }: { src?: string | null; size: number; radius?: number; alt?: string; fallback: ReactNode }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt ?? ''}
      width={size}
      height={size}
      onError={() => setBad(true)}
      style={{ width: size, height: size, borderRadius: radius ?? Math.round(size * 0.22), objectFit: 'cover', flex: 'none', background: 'var(--surface)' }}
    />
  );
}

// Player image: ESPN headshot → team logo → position pill. `espnId` covers
// players outside the baked slug→headshot map (2026 rookies — native-league
// pools carry the directory's espn_id per player).
export function PlayerImg({ playerId, espnId, team, pos, size = 30 }: { playerId: string; espnId?: string | null; team?: string | null; pos: Pos; size?: number }) {
  return (
    <Img src={headshot(playerId) ?? espnHeadshot(espnId)} size={size} radius={Math.round(size * 0.3)} alt={playerId}
      fallback={<Img src={teamLogo(team)} size={size} radius={Math.round(size * 0.3)} fallback={<PosPill pos={pos} />} />} />
  );
}

export function PosPill({ pos, style }: { pos: Pos; style?: CSSProperties }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', padding: '2px 6px', borderRadius: 3,
        fontFamily: MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
        background: `var(--pos-${pos}-bg)`, color: `var(--pos-${pos}-fg)`, border: `1px solid var(--pos-${pos}-bd)`,
        ...style,
      }}
    >
      {pos}
    </span>
  );
}

/** Initials-in-a-box avatar, tinted by an accent color. */
export function Avatar({ name, accent = 'var(--you)', size = 30, src }: { name: string; accent?: string; size?: number; src?: string | null }) {
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
  const fallback = (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.22, flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in srgb, ${accent} 18%, transparent)`,
        border: `1px solid color-mix(in srgb, ${accent} 45%, transparent)`,
        color: accent, fontFamily: GROTESK, fontWeight: 700, fontSize: size * 0.36, letterSpacing: '0.02em',
      }}
    >
      {initials}
    </div>
  );
  if (src) return <Img src={src} size={size} radius={Math.round(size * 0.22)} alt={name} fallback={fallback} />;
  return fallback;
}

/** Site settings — one gear chip that opens a popover with the theme picker + text
 *  toggles (previously inline chips). `superAdmin`, when provided, adds a super-admin
 *  entry at the bottom (shown only for admins in the live app). */
export function SiteSettings({ superAdmin }: { superAdmin?: () => void }) {
  const { theme, setTheme, iconSet, setIconSet, cardSkin, setCardSkin, bigText, setBigText, fullStats, setFullStats, setSleeperUser, navigate } = useStore();
  const [open, setOpen] = useState(false);
  // Which side the dropdown opens toward — chosen on open so it never flies off
  // screen when the gear sits near an edge (e.g. wrapped to the far left on the
  // demo board header). Left-half gear → open rightward; right-half → leftward.
  const [menuAlign, setMenuAlign] = useState<'left' | 'right'>('right');
  const [rules, setRules] = useState(false);
  const [faq, setFaq] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [admin, setAdmin] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Mirror the Supabase auth session so a signed-in player can sign out from any
  // page (this gear lives in every screen's header). No-op for the static build.
  useEffect(() => {
    if (!liveConfigured) return;
    getSession().then(setSession).catch(() => {});
    return onAuth((s) => setSession(s));
  }, []);
  // Resolve super-admin status from the session so the admin entry is reachable
  // from the gear on ANY screen, not just the Live onboarding header. Server-side
  // is_admin() + RLS are the real gate; this only decides whether to show the link.
  useEffect(() => {
    if (!session) { setAdmin(false); return; }
    isAdmin().then(setAdmin).catch(() => setAdmin(false));
  }, [session]);
  useEffect(() => {
    if (!open) return;
    if (ref.current) setMenuAlign(ref.current.getBoundingClientRect().left < window.innerWidth / 2 ? 'left' : 'right');
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const opts: { id: ThemeName; name: string }[] = [
    { id: 'neon', name: 'Drip' },
    { id: 'slate', name: 'Night Rider' },
    { id: 'dusk', name: 'Deep Thoughts' },
    { id: 'prime', name: 'All Gold' },
    { id: 'daylight', name: 'Feeling Lucky' },
    { id: 'arctic', name: 'Arctic Journey' },
  ];
  // Card-deck skins: a swatch (felt ground + a peek of the sealed card back).
  const skins: { id: CardSkin; name: string; felt: string; back: string; img?: string }[] = [
    { id: 'emerald', name: 'Emerald Table', felt: '#123A2F', back: '#7E2430' },
  ];
  const lbl: CSSProperties = { fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--faint)' };
  const toggle = (on: boolean): CSSProperties => ({
    height: 24, padding: '0 9px', borderRadius: 4, fontFamily: MONO, fontWeight: 700, fontSize: 10.5, lineHeight: 1, cursor: 'pointer',
    display: 'inline-flex', alignItems: 'center', gap: 5,
    background: on ? 'var(--sh)' : 'var(--bg)', border: `1px solid ${on ? 'var(--you)' : 'var(--bd)'}`, color: on ? 'var(--you)' : 'var(--dim)',
  });

  return (
    <div ref={ref} style={{ position: 'relative', flex: 'none' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Settings"
        aria-expanded={open}
        style={{
          width: 34, height: 34, borderRadius: 5, fontSize: 15, lineHeight: 1, cursor: 'pointer',
          background: open ? 'var(--sh)' : 'var(--surface)', border: `1px solid ${open ? 'var(--you)' : 'var(--bd)'}`,
          color: open ? 'var(--you)' : 'var(--dim)',
        }}
      >
        ⚙
      </button>
      {open && (
        <div
          style={{
            position: 'absolute', top: 40, [menuAlign]: 0, zIndex: 60, width: 208, maxWidth: 'calc(100vw - 16px)',
            background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 8, padding: 12,
            boxShadow: '0 10px 28px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: 14,
          }}
        >
          <div>
            <div style={lbl}>THEME</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 7 }}>
              {opts.map((o) => {
                const active = theme === o.id;
                return (
                  <button key={o.id} onClick={() => setTheme(o.id)} title={o.id}
                    style={{ textAlign: 'left', padding: '7px 10px', borderRadius: 5, fontFamily: MONO, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      background: active ? 'var(--sh)' : 'var(--bg)', border: `1px solid ${active ? 'var(--you)' : 'var(--bd)'}`, color: active ? 'var(--you)' : 'var(--dim)' }}>
                    {o.name}{active ? ' ✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={lbl}>ICONS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 7 }}>
              {ICON_SETS.map((s) => {
                const active = iconSet === s.id;
                return (
                  <button key={s.id} onClick={() => setIconSet(s.id)} title={s.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 7, textAlign: 'left', padding: '7px 10px', borderRadius: 5, fontFamily: MONO, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      background: active ? 'var(--sh)' : 'var(--bg)', border: `1px solid ${active ? 'var(--you)' : 'var(--bd)'}`, color: active ? 'var(--you)' : 'var(--dim)' }}>
                    <GameIcon name="coin-gold" emoji="◈" size="1.4em" set={s.id} />
                    <span style={{ flex: 1 }}>{s.name}</span>{active ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={lbl}>CARD DECK</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 7 }}>
              {skins.map((s) => {
                const active = cardSkin === s.id;
                return (
                  <button key={s.id} onClick={() => setCardSkin(s.id)} title={s.id}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', padding: '6px 9px', borderRadius: 5, fontFamily: MONO, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                      background: active ? 'var(--sh)' : 'var(--bg)', border: `1px solid ${active ? 'var(--you)' : 'var(--bd)'}`, color: active ? 'var(--you)' : 'var(--dim)' }}>
                    <span style={{ flex: 'none', width: 24, height: 16, borderRadius: 3, border: '1px solid rgba(0,0,0,0.5)', background: s.felt, position: 'relative', overflow: 'hidden' }}>
                      {s.img
                        ? <span style={{ position: 'absolute', inset: 0, background: `url(${s.img}) center/cover` }} />
                        : <span style={{ position: 'absolute', top: 2, right: 2, bottom: 2, width: 8, borderRadius: 2, background: s.back, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }} />}
                    </span>
                    <span style={{ flex: 1 }}>{s.name}</span>{active ? '✓' : ''}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <div style={lbl}>DISPLAY</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
              <button onClick={() => setBigText(!bigText)} aria-pressed={bigText} title="Bigger fine print" style={toggle(bigText)}>
                <span style={{ fontSize: 9 }}>A</span><span style={{ fontSize: 12 }}>A</span><span>Bigger</span>
              </button>
              <button onClick={() => setFullStats(!fullStats)} aria-pressed={fullStats} title="Show full stat lines instead of truncating" style={toggle(fullStats)}>
                Full stats
              </button>
            </div>
          </div>
          <button
            onClick={() => { setOpen(false); setRules(true); }}
            className="mono"
            style={{ width: '100%', borderTop: '1px solid var(--bd)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', paddingTop: 12, textAlign: 'left', background: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)', cursor: 'pointer' }}
          >
            <GameIcon name={UI_ART.rulebook} emoji="📖" size="1.5em" /> Rulebook
          </button>
          <button
            onClick={() => { setOpen(false); setFaq(true); }}
            className="mono"
            style={{ width: '100%', borderTop: '1px solid var(--bd)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', paddingTop: 12, marginTop: -2, textAlign: 'left', background: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)', cursor: 'pointer' }}
          >
            ❓ FAQ
          </button>
          {(superAdmin || admin) && (
            <button
              onClick={() => {
                setOpen(false);
                // On the Live screen the parent passes an in-place opener (swaps the
                // onboarding view); elsewhere, deep-link into the Live admin panel.
                if (superAdmin) superAdmin();
                else navigate({ name: 'live', view: 'admin' });
              }}
              className="mono"
              style={{ width: '100%', borderTop: '1px solid var(--bd)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', paddingTop: 12, marginTop: -2, textAlign: 'left', background: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)', cursor: 'pointer' }}
            >
              <GameIcon name={UI_ART.admin} emoji="⚡" size="1.5em" /> Super admin →
            </button>
          )}
          {liveConfigured && !session && (
            <button
              onClick={() => { setOpen(false); navigate({ name: 'live' }); }}
              className="mono"
              title="Sign in to the live H2H pilot"
              style={{ width: '100%', borderTop: '1px solid var(--bd)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', paddingTop: 12, marginTop: -2, textAlign: 'left', background: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--text)', cursor: 'pointer' }}
            >
              ◢ Sign in
            </button>
          )}
          {session && (
            <button
              onClick={() => {
                setOpen(false);
                signOut().catch(() => {});
                // A clean logout drops the live boot flag, forgets the cached
                // Sleeper "example" user (kept separately from the auth
                // session), and returns to the demo landing.
                try { localStorage.removeItem('dripLive'); } catch { /* ignore */ }
                setSleeperUser(null);
                markBootSessionChecked(); // don't let the demo's boot check race the async signOut
                navigate({ name: 'demo' });
              }}
              className="mono"
              title={session.user.email ?? 'Sign out'}
              style={{ width: '100%', borderTop: '1px solid var(--bd)', borderLeft: 'none', borderRight: 'none', borderBottom: 'none', paddingTop: 12, textAlign: 'left', background: 'none', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: 'var(--dim)', cursor: 'pointer' }}
            >
              ⏻ Sign out
            </button>
          )}
        </div>
      )}
      {rules && <Rulebook onClose={() => setRules(false)} />}
      {faq && <Faq onClose={() => setFaq(false)} onOpenRulebook={() => setRules(true)} />}
    </div>
  );
}

/** Demo role/week picker — assume any team and jump to any week before setup. */
export function DemoControls({ compact }: { compact?: boolean }) {
  const { youTeamId, setYouTeam, demoWeek, setDemoWeek, activeLeague, isSimLeague } = useStore();
  // "Play as any team" + the DEMO badge belong to the built-in sandbox demo only.
  // For a real Sleeper-loaded league (or a live pilot) you ARE your team, so those
  // affordances read as demo bleed — keep just the week navigator there.
  const sandbox = !isSimLeague;
  const teams = [...activeLeague.teams].sort((a, b) => a.seed - b.seed);
  const selStyle: CSSProperties = {
    fontFamily: MONO, fontSize: 11, fontWeight: 700, color: 'var(--text)',
    background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 4,
    padding: '6px 8px', maxWidth: '100%',
  };
  const lbl: CSSProperties = { fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)' };
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        background: 'var(--surface)', border: `1px ${sandbox ? 'dashed var(--bdh)' : 'solid var(--bd)'}`, borderRadius: 6,
        padding: compact ? '8px 12px' : '10px 14px',
      }}
    >
      {sandbox && <span className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--warn)', border: '1px solid var(--warn)', borderRadius: 3, padding: '2px 6px' }}>DEMO</span>}
      {sandbox && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span style={lbl}>PLAY AS</span>
          <select value={youTeamId} onChange={(e) => setYouTeam(e.target.value)} style={selStyle}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={lbl}>WEEK</span>
        <select value={demoWeek} onChange={(e) => setDemoWeek(Number(e.target.value))} style={selStyle}>
          {Array.from({ length: REG_SEASON_WEEKS }, (_, i) => i + 1).map((w) => <option key={w} value={w}>Week {w}</option>)}
        </select>
      </div>
    </div>
  );
}

// Small faint version readout for headers that don't use <Brand> (which shows
// the version under the wordmark) — keeps the running build identifiable on
// every page.
export function VersionTag({ style }: { style?: CSSProperties }) {
  return (
    <span className="mono" title="app version" style={{ fontSize: 8.5, letterSpacing: '0.08em', color: 'var(--faint)', whiteSpace: 'nowrap', ...style }}>{APP_VERSION}</span>
  );
}

// `hideDataSource` drops the "· data Stathead" attribution (the hero/live board
// isn't a 2025-data replay, so the demo attribution would mislead there).
export function Brand({ onClick, hideDataSource = false }: { onClick?: () => void; hideDataSource?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, cursor: onClick ? 'pointer' : 'default' }}
    >
      <GameIcon name={BRAND_MARK} emoji={<div style={{ width: 13, height: 13, background: 'var(--you)', transform: 'rotate(45deg)', flex: 'none' }} />} size={18} style={{ verticalAlign: 'middle' }} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.1 }}>
        <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)', whiteSpace: 'nowrap' }}>
          DRIP FANTASY
        </div>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 7.5, letterSpacing: '0.06em', color: 'var(--faint)', marginTop: 2, whiteSpace: 'nowrap' }}>
          <span>{APP_VERSION}</span>
          {!hideDataSource && <>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>data</span>
            <a
              href={DATA_SOURCE.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--you)', textDecoration: 'none', fontWeight: 700 }}
            >
              {DATA_SOURCE.name} ↗
            </a>
          </>}
        </div>
      </div>
    </div>
  );
}

export function Header({ left, right }: { left: ReactNode; right?: ReactNode }) {
  const isMobile = useIsMobile();
  return (
    <header
      style={{
        height: 'auto', minHeight: isMobile ? 52 : 60, flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 8,
        padding: isMobile ? '7px 10px' : '8px 16px',
        position: 'sticky', top: 0, zIndex: 40, gap: isMobile ? 12 : 10,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 10, minWidth: 0, flexWrap: isMobile ? 'wrap' : 'nowrap' }}>{left}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 12, whiteSpace: 'nowrap', flexWrap: isMobile ? 'wrap' : 'nowrap' }}>{right}</div>
    </header>
  );
}

export function UserChip({ handle, sub }: { handle: string; sub?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ textAlign: 'right' }}>
        <div className="grotesk" style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)' }}>{handle}</div>
        {sub && <div className="mono" style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--faint)' }}>{sub}</div>}
      </div>
      <Avatar name={handle} accent="var(--you)" />
    </div>
  );
}

export const fonts = { MONO, GROTESK };
