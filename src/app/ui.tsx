import { useState, useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Session } from '@supabase/supabase-js';
import type { Pos, ThemeName } from '@drip/core/theme';
import { useStore, type CardSkin } from './store';
import { headshot, espnHeadshot, teamLogo } from '@drip/core/data/media';
import { injuryFor } from '@drip/core/data/injuries';
import { flagFor } from '@drip/core/data/commish';
import { REG_SEASON_WEEKS } from '@drip/core/data/league';
import { APP_VERSION, DATA_SOURCE } from '@drip/core/version';
import { Rulebook } from '../screens/Rulebook';
import { markBootSessionChecked } from '../screens/DemoBoard';
import { Faq } from '../screens/Faq';
import { GameIcon, UI_ART, BRAND_MARK, ICON_SETS } from './gameIcons';
import { liveConfigured } from '@drip/core/data/liveConfig';
import { getSession, onAuth, signOut, isAdmin } from '@drip/core/data/liveApi';

/** A league/team crest: the image when there is one, a lettered box when there
 *  is not (v0.324.0). The RULE lives in core (`crestFor`) so both platforms and
 *  the parity test agree on it; this is only the drawing.
 *
 *  `onError` matters as much as the fallback: a mirrored avatar whose upstream
 *  has since 404'd is indistinguishable from a good one until the browser tries
 *  it, and a broken-image icon is worse than the letter it replaced. */
export function Crest({ crest, size = 32, radius = 7 }: {
  crest: import('@drip/core/data/crest').Crest; size?: number; radius?: number;
}) {
  const [broken, setBroken] = useState(false);
  const box: React.CSSProperties = { width: size, height: size, borderRadius: radius, flexShrink: 0 };
  if (crest.url && !broken) {
    return <img src={crest.url} alt="" width={size} height={size} onError={() => setBroken(true)}
      style={{ ...box, objectFit: 'cover' }} />;
  }
  return (
    <div aria-hidden style={{
      ...box, background: 'var(--bg)', border: '1px solid var(--bd)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: Math.round(size * 0.44), color: 'var(--faint)',
    }}>{crest.initial}</div>
  );
}

/** True when the viewport is at/below `maxWidth` — drives the mobile layout. */
/** PULL DOWN TO REFRESH, the web's own (v0.369.1). Founder: "right now pull
 *  down kicks you back to your leagues" — the browser's native gesture
 *  reloads the whole SPA, which boots to the default screen. styles.css now
 *  claims overscroll (`overscroll-behavior-y: none`), and this hook is the
 *  replacement: pulled far enough DOWN from the very top of the page, it
 *  fires `onRefresh` on release — a data reload in place, never a page load.
 *
 *  Returns whether the pull is past the threshold RIGHT NOW, so the screen
 *  can show a "release to refresh" hint. `enabled` lets a board switch the
 *  gesture off while an overlay card is open — a drag inside a fixed-position
 *  sheet still reads window.scrollY = 0 and would fire a refresh under it.
 *  Listeners are passive and window-level: they observe, never preventDefault,
 *  so scrolling itself is untouched. */
export function usePullRefresh(onRefresh: () => void, enabled = true, scrollTop?: () => number): boolean {
  const [armed, setArmed] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const cb = useRef(onRefresh); cb.current = onRefresh;
  const en = useRef(enabled); en.current = enabled;
  // The scroller whose "am I at the top?" this pull reads. The page by
  // default; an OVERLAY with its own scroll container (the All-fields board)
  // passes its element's scrollTop, because window.scrollY never moves inside
  // a fixed-position sheet.
  const top = useRef(scrollTop); top.current = scrollTop;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const atTop = () => (top.current ? top.current() : window.scrollY) <= 0;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      // Only a pull that BEGINS at the top of the scroller counts — mid-scroll
      // drags are scrolling, and must never fire a surprise reload.
      start.current = en.current && atTop() && t ? { x: t.clientX, y: t.clientY } : null;
      armedRef.current = false; setArmed(false);
    };
    const onMove = (e: TouchEvent) => {
      const s = start.current; const t = e.touches[0];
      if (!s || !t) return;
      // 90px down, mostly vertical, still at the top: the classic PTR shape.
      const on = t.clientY - s.y > 90 && Math.abs(t.clientX - s.x) < 60 && atTop();
      if (on !== armedRef.current) { armedRef.current = on; setArmed(on); }
    };
    const onEnd = () => {
      if (armedRef.current) cb.current();
      start.current = null; armedRef.current = false; setArmed(false);
    };
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, []);
  return armed;
}

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
      // ── THE SOFT KEYBOARD (v0.327.0) ──────────────────────────────────
      // Founder: "when you type in the chat, your keyboard covers the chat
      // window." The zoom test above misses it entirely. On Android Chrome an
      // open keyboard shrinks the VISUAL viewport and leaves the LAYOUT one
      // alone — scale stays 1, both offsets stay 0 — so `zoomed` was false,
      // this fell back to `inset: 0`, and the card was laid out against a
      // full-screen height whose bottom third was under the keyboard. The
      // composer lives at the bottom of that card. So did the send button.
      //
      // THE THRESHOLD IS NOT A FUDGE. The visual viewport also shrinks by a
      // few dozen pixels when the URL bar slides in, and reacting to that
      // would make every modal jitter as the page scrolls. A keyboard costs
      // 250-350px; 120 is comfortably above the browser chrome and well below
      // any keyboard.
      const keyboard = window.innerHeight - v.height > 120;
      setVv(zoomed || keyboard ? { top: v.offsetTop, left: v.offsetLeft, width: v.width, height: v.height } : null);
    };
    update();
    v.addEventListener('resize', update);
    v.addEventListener('scroll', update);
    return () => { v.removeEventListener('resize', update); v.removeEventListener('scroll', update); };
  }, []);
  // Portal to <body> so the fixed overlay always resolves against the viewport —
  // otherwise an ancestor with a transform/filter (a card animation, etc.) traps
  // `position: fixed` inside its own stacking context and the modal can render
  // *under* the sticky header regardless of z-index.
  return createPortal(
    <div
      onClick={onClick}
      style={{
        position: 'fixed',
        ...(vv ? { top: vv.top, left: vv.left, width: vv.width, height: vv.height } : { inset: 0 }),
        background: 'rgba(0,0,0,0.6)', zIndex, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        // Less headroom once the keyboard has taken most of the screen: 40px of
        // it is a tenth of what's left, and it buys nothing.
        padding: `${vv ? Math.min(padTop, 12) : padTop}px 16px`, overflow: 'auto',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/** A TITLED POPUP — the web's copy of the app's Overlay (bottom sheet).
 *
 *  Founder: "stick with the pop up for all the items where we have that in the
 *  app." The app answers every menu selection the same way: the thing you
 *  picked arrives over the page you picked it from, and dismissing puts you
 *  back exactly where you were. The web had been answering the same selections
 *  by EXPANDING a panel somewhere in the page — which reads as a different
 *  interaction (the menu moves, the page grows, and on a phone the panel can
 *  land below the fold), and left two idioms in one product.
 *
 *  A centred card rather than a bottom sheet: the sheet is the phone gesture
 *  language (a thumb at the bottom edge, a drag to throw it away) and the web
 *  has neither a thumb nor that expectation. What matters is what the founder
 *  asked for — over the page, one dismiss from gone, the menu untouched behind
 *  it — and this is that with the desktop's manners.
 *
 *  BODY SCROLLS, CHROME DOESN'T: the card is a flex column with a viewport cap,
 *  the header sizes to its content, and the body is the one child allowed to
 *  shrink — the same rule the app's sheet settles on. Wide content (a scoring
 *  table, a register) scrolls sideways INSIDE the body, so the page behind
 *  never scrolls sideways. */
export function Sheet({ title, subtitle, onClose, max = 620, children }: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  /** Card width cap. Reference tables want more room than a settings form. */
  max?: number;
  children: ReactNode;
}) {
  // Escape closes it — the keyboard's ✕, and the thing every dialog on the web
  // is expected to do.
  useEffect(() => {
    const on = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);
  return (
    // ── THE LAYER MATTERS (v0.297.2) ──────────────────────────────────────
    // 60, not 80. A Sheet is a CONTAINER for a destination, and the things a
    // destination opens — the ⚑ kit's note and flag editors, the avatar
    // picker, a confirm — are ModalBackdrop's default 70. At 80 this sheet
    // covered them: they opened, painted underneath, and read to the founder
    // as "manage flags and write note don't do anything". Below the modal
    // layer, above the page (the header is 50-58), and portaled last so it
    // still wins against anything else that also says 60.
    <ModalBackdrop onClick={onClose} zIndex={60} padTop={26}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{
          background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10,
          width: '100%', maxWidth: max, maxHeight: '86vh',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          boxShadow: '0 18px 50px rgba(0,0,0,0.45)',
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '13px 15px 11px', borderBottom: '1px solid var(--bd)', flexShrink: 0 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="grotesk" style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>{title}</div>
            {!!subtitle && (
              <div className="mono" style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--faint)', marginTop: 3 }}>{subtitle}</div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="mono"
            style={{ background: 'none', border: 'none', color: 'var(--dim)', fontSize: 15, lineHeight: 1, cursor: 'pointer', padding: 2, flexShrink: 0 }}>✕</button>
        </div>
        {/* minHeight: 0 is what lets a flex child actually shrink — without it
            the body grows to its content and the cap clips the bottom off. */}
        <div style={{ minHeight: 0, overflowY: 'auto', overflowX: 'auto', padding: '12px 15px 18px' }}>{children}</div>
      </div>
    </ModalBackdrop>
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

/** The commissioner's flag on a player (0141), or nothing. Same anatomy as
 *  the injury badge so the two sit side by side; purple so it never reads as
 *  a medical designation. */
export function FlagChip({ slug, style }: { slug: string; style?: CSSProperties }) {
  const label = flagFor(slug);
  if (!label) return null;
  return (
    <span className="mono" title={`commissioner: ${label}`} style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: '0.04em', color: '#A87BD8', border: '1px solid #A87BD8', borderRadius: 2, padding: '0 3px', lineHeight: 1.5, flex: 'none', maxWidth: 92, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...style }}>⚑ {label}</span>
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
/** `minimal` (the logged-out demo landing): hide the theme / icon / card-deck
 *  customizers — a 12-skin picker on a first visit reads as scope creep, and
 *  nobody customizes before they're convinced. Accessibility toggles and the
 *  Rulebook / FAQ / sign-in links stay. Signed-in screens keep the full menu. */
export function SiteSettings({ superAdmin, minimal }: { superAdmin?: () => void; minimal?: boolean }) {
  const { theme, setTheme, iconSet, setIconSet, cardSkin, setCardSkin, bigText, setBigText, setSleeperUser, navigate } = useStore();
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
    if (!liveConfigured()) return;
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
  const cb = (n: string) => `${import.meta.env.BASE_URL}cardbacks/${n}.jpg`;
  const skins: { id: CardSkin; name: string; felt: string; back: string; img?: string }[] = [
    { id: 'emerald', name: 'Emerald Table', felt: '#123A2F', back: '#7E2430' },
    { id: 'playbook', name: 'Playbook', felt: '#10203A', back: '#10203A', img: cb('playbook') },
    { id: 'blitz', name: 'Blitz', felt: '#0E1A30', back: '#0E1A30', img: cb('blitz') },
    { id: 'rivalry', name: 'Rivalry', felt: '#2A0C10', back: '#2A0C10', img: cb('rivalry') },
    { id: 'allstar', name: 'All-Star', felt: '#12213A', back: '#12213A', img: cb('allstar') },
    { id: 'heritage', name: 'Heritage', felt: '#12100A', back: '#12100A', img: cb('heritage') },
    { id: 'gilded', name: 'Gilded', felt: '#1E1608', back: '#1E1608', img: cb('gilded') },
    { id: 'cosmic', name: 'Cosmic', felt: '#0E1024', back: '#0E1024', img: cb('cosmic') },
    { id: 'fireworks', name: 'Fireworks', felt: '#14122E', back: '#14122E', img: cb('fireworks') },
    { id: 'battalion', name: 'Battalion', felt: '#16180E', back: '#16180E', img: cb('battalion') },
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
          {!minimal && <div>
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
          </div>}
          {!minimal && <div>
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
          </div>}
          {!minimal && <div>
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
          </div>}
          <div>
            <div style={lbl}>DISPLAY</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
              <button onClick={() => setBigText(!bigText)} aria-pressed={bigText} title="Bigger fine print" style={toggle(bigText)}>
                <span style={{ fontSize: 9 }}>A</span><span style={{ fontSize: 12 }}>A</span><span>Bigger</span>
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
          {liveConfigured() && !session && (
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
            <div className="mono" style={{ borderTop: '1px solid var(--bd)', paddingTop: 12, marginTop: -2, fontSize: 10, color: 'var(--dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', color: 'var(--faint)' }}>SIGNED IN</span><br />
              <span style={{ color: 'var(--text)', fontWeight: 700 }}>{session.user.email ?? 'this device'}</span>
            </div>
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
/** OVERFLOW HIDDEN, not just minWidth: 0 (v0.290.0). The wordmark and the
 *  version line are both `nowrap` inside a column a flex row is free to
 *  squeeze, and nothing here clipped — so on a narrow phone the shrinking did
 *  nothing and "DRIP FANTASY" simply PAINTED OVER whatever chip sat beside it
 *  (the founder's screenshot: "DRIP FANTA" with a button on top of it).
 *  Clipping makes a squeeze visible and harmless instead of invisible and
 *  wrong. */
export function Brand({ onClick, hideDataSource = false }: { onClick?: () => void; hideDataSource?: boolean }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, overflow: 'hidden', cursor: onClick ? 'pointer' : 'default' }}
    >
      <GameIcon name={BRAND_MARK} emoji={<div style={{ width: 13, height: 13, background: 'var(--you)', transform: 'rotate(45deg)', flex: 'none' }} />} size={18} style={{ verticalAlign: 'middle' }} />
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', lineHeight: 1.1 }}>
        <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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

// ⓘ — THE EXPLAINER, FOLDED AWAY. The app's rule since v0.350.2 (founder:
// "instead of explaining everything, let's have info chips with pop ups"),
// brought to the web because the founder asked for it on both hosts: a control
// gets its LABEL and, when it needs explaining, one ⓘ beside it; the paragraph
// opens on demand. DYNAMIC STATUS LINES STAY INLINE — state is not
// explanation, and folding "3 seats left" behind a tap would hide the very
// thing the screen is for.
//
// The web had ⓘ twice already (the player dot on a board row, the metric
// sheet) and no shared component, which is how the settings screens grew a
// paragraph under every control instead.
export function InfoChip({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={(e) => { e.stopPropagation(); setOpen(true); }} aria-label={`About ${title}`}
        className="mono"
        style={{
          flex: 'none', fontSize: 11, fontWeight: 700, color: 'var(--faint)',
          background: 'none', border: 'none', padding: '0 2px', cursor: 'help', lineHeight: 1,
        }}>ⓘ</button>
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)} max={460}>
          <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{children}</div>
        </Sheet>
      )}
    </>
  );
}

/** A section label with its ⓘ — the arrangement nearly every caller wants. */
export function LabelInfo({ label, title, info, style }: {
  label: string; title?: string; info: ReactNode; style?: React.CSSProperties;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5, ...style }}>
      <span className="mono" style={{ fontSize: 9, letterSpacing: '0.14em', color: 'var(--faint)', fontWeight: 700 }}>{label}</span>
      <InfoChip title={title ?? label}>{info}</InfoChip>
    </div>
  );
}

/** NO GAME THIS WEEK (v0.364.0).
 *
 *  An odd-sized league sits one seat out every week — 0064's schedule pads the
 *  field with a ghost and skips that pair — and until now every screen read the
 *  missing matchup row as "the schedule isn't ready", or worse: the drip board
 *  fell through to a BAKED DEMO OPPONENT that does not exist in a real league,
 *  and threw on its name.
 *
 *  `bye` is the whole distinction and it is knowable locally: if anyone else
 *  plays that week, the schedule is fine and this seat is on bye. If nobody
 *  does, it genuinely has not been built. Saying the wrong one blames the
 *  commissioner for a schedule that is working. */
export function NoGameScreen({ week, bye, onBack, backLabel = '\u2190 LEAGUE', children }: {
  week: number; bye: boolean; onBack?: () => void; backLabel?: string; children?: ReactNode;
}) {
  return (
    <div className="mono" style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 240, color: 'var(--dim)', fontSize: 12, letterSpacing: '0.06em', textAlign: 'center', padding: 20 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
        {bye ? `WEEK ${week} \u00b7 BYE` : `NO WEEK ${week} MATCHUP YET`}
      </div>
      <div style={{ color: 'var(--faint)', fontSize: 10.5, maxWidth: 330, lineHeight: 1.6, letterSpacing: 0 }}>
        {bye
          ? 'Your league has an odd number of teams, so one team sits out each week and this week it\u2019s yours. Nothing to set — your record and your roster carry over untouched.'
          : 'The rest of the league has no game this week either. Matchups appear once the commissioner generates the schedule.'}
      </div>
      {children}
      {onBack && (
        <button onClick={onBack} style={{ fontFamily: 'inherit', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text)', background: 'var(--surface)', border: '1px solid var(--bdh)', borderRadius: 6, padding: '8px 18px', cursor: 'pointer' }}>
          {backLabel}
        </button>
      )}
    </div>
  );
}

export const fonts = { MONO, GROTESK };
