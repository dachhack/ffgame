// Shared UI primitives for the management surfaces (super-admin + commissioner).
// Kept separate from the game-side ui.tsx: these are dense tool screens with
// their own visual language (mono labels, cards, underline tabs). Everything
// here pairs with the `.mgmt` CSS scope in styles.css, which handles the
// mobile adjustments (16px inputs so iOS doesn't zoom, taller tap targets,
// scrollable tab strips).
import { useEffect, useState, type CSSProperties } from 'react';

export const mono: CSSProperties = { fontFamily: 'var(--mono, monospace)' };
export const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14, marginBottom: 12 };
export const h: CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 10 };
export const subhead: CSSProperties = { ...mono, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', marginBottom: 7 };
// SQUARE, not pill (v0.213.0, founder's call: "I don't like the pill look of
// the buttons and field entrys"). One radius token for every control on the
// management surfaces, so a button and the input beside it share an edge
// treatment instead of one being a lozenge and the other a rounded rect.
export const RADIUS = 3;
export const chip: CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '4px 7px', color: 'var(--text)', background: 'var(--bg)' };
export const linkBtn: CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
export const btn = (active = false): CSSProperties => ({ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: active ? 'var(--on-accent)' : 'var(--text)', background: active ? 'var(--you)' : 'var(--bg)', border: `1px solid ${active ? 'var(--you)' : 'var(--bd)'}`, borderRadius: RADIUS, padding: '7px 10px', cursor: 'pointer' });
export const inp: CSSProperties = { fontFamily: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: RADIUS, padding: '8px 10px' };

export function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>{text}</div>;
}

/** Human-readable message from ANY thrown value. supabase-js network failures
 *  reject with a plain object (not an Error), so `instanceof Error` checks were
 *  collapsing the real cause into a generic fallback — read `.message` off
 *  whatever we got, and stringify the rest rather than hide it. */
export function errMsg(e: unknown, fallback = 'failed'): string {
  if (e instanceof Error) return e.message || fallback;
  if (e && typeof e === 'object') {
    const m = (e as { message?: unknown }).message;
    if (m) return String(m);
    try { return JSON.stringify(e); } catch { return fallback; }
  }
  return e ? String(e) : fallback;
}

export interface TabDef<T extends string = string> { id: T; label: string; badge?: number }

/** True on a desktop-width viewport. Drives the management surfaces' one
 *  structural difference: a grouped LEFT RAIL where there's room for it, the
 *  scrolling tab strip where there isn't. Media-query driven (not a resize
 *  listener) so it costs nothing while idle. */
export function useWide(min = 900): boolean {
  const q = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    setWide(m.matches);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return wide;
}

/** One titled group of destinations in the side rail. */
export interface NavGroup<T extends string = string> { title: string; items: TabDef<T>[] }

/** Grouped vertical navigation for the management surfaces (desktop).
 *
 *  WHY THIS EXISTS: these screens grew to ~15 destinations, and a single
 *  horizontal strip of 15 gives you no sense of WHEN you'd use any of them —
 *  season setup, weekly operations and diagnostics all read alike, and the
 *  overflow scrolls out of sight. Grouping by moment-of-use puts the whole map
 *  on screen at once and makes "where do I set scoring" answerable without
 *  hunting. Pairs with TabBar, which stays the narrow-screen presentation of
 *  the same list. */
export function SideNav<T extends string>({ groups, active, onSelect }: {
  groups: NavGroup<T>[]; active: T; onSelect: (id: T) => void;
}) {
  return (
    <nav role="tablist" aria-orientation="vertical" style={{ width: 176, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map((g) => (
        <div key={g.title}>
          <div style={{ ...subhead, marginBottom: 5, paddingLeft: 8 }}>{g.title}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {g.items.map((t) => {
              const on = t.id === active;
              return (
                <button key={t.id} role="tab" aria-selected={on} onClick={() => onSelect(t.id)} className="mono"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                    // The accent COLOR carries the selection, not a fill: on these
                    // themes --bg and --surface sit a hair apart, so a background
                    // swap alone left the active row unreadable as active.
                    background: on ? 'var(--bg)' : 'none', border: 'none',
                    borderLeft: `3px solid ${on ? 'var(--you)' : 'transparent'}`, borderRadius: '0 6px 6px 0',
                    color: on ? 'var(--you)' : 'var(--dim)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                    padding: '7px 9px', cursor: 'pointer',
                  }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
                  {t.badge != null && t.badge > 0 && (
                    <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--opp)', borderRadius: 8, padding: '1px 5px', lineHeight: 1.4 }}>{t.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/** Underline-style tab strip. Scrolls horizontally on narrow screens instead of
 *  wrapping (`.mgmt-tabs` hides its scrollbar), so it stays a single tidy row on
 *  mobile. `badge` renders an attention count (e.g. open code requests). */
export function TabBar<T extends string>({ tabs, active, onSelect, style, wrap = false }: {
  tabs: TabDef<T>[]; active: T; onSelect: (id: T) => void; style?: CSSProperties;
  /** Wrap onto a second line instead of scrolling sideways. For a SECONDARY
   *  strip inside an already-narrowed pane (the scoring groups), where a
   *  scrolled-off tab is a tab nobody finds — the primary league strip keeps
   *  scrolling, since it's full-width and one tidy row matters more there. */
  wrap?: boolean;
}) {
  return (
    <div className="mgmt-tabs" role="tablist" style={{ display: 'flex', gap: 2, ...(wrap ? { flexWrap: 'wrap' } : { overflowX: 'auto' }), borderBottom: '1px solid var(--bd)', ...style }}>
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} role="tab" aria-selected={on} onClick={() => onSelect(t.id)} className="mono"
            style={{
              flexShrink: 0, background: 'none', border: 'none', borderBottom: `2px solid ${on ? 'var(--you)' : 'transparent'}`, marginBottom: -1,
              color: on ? 'var(--text)' : 'var(--dim)', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.08em',
              padding: '9px 11px', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6,
            }}>
            {t.label}
            {t.badge != null && t.badge > 0 && (
              <span style={{ fontSize: 8.5, fontWeight: 700, color: 'var(--on-accent)', background: 'var(--opp)', borderRadius: 8, padding: '1px 5px', lineHeight: 1.4 }}>{t.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
