// Shared UI primitives for the management surfaces (super-admin + commissioner).
// Kept separate from the game-side ui.tsx: these are dense tool screens with
// their own visual language (mono labels, cards, underline tabs). Everything
// here pairs with the `.mgmt` CSS scope in styles.css, which handles the
// mobile adjustments (16px inputs so iOS doesn't zoom, taller tap targets,
// scrollable tab strips).
import type { CSSProperties } from 'react';

export const mono: CSSProperties = { fontFamily: 'var(--mono, monospace)' };
export const card: CSSProperties = { background: 'var(--surface)', border: '1px solid var(--bd)', borderRadius: 10, padding: 14, marginBottom: 12 };
export const h: CSSProperties = { fontSize: 10, letterSpacing: '0.12em', color: 'var(--dim)', fontWeight: 700, marginBottom: 10 };
export const subhead: CSSProperties = { ...mono, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em', color: 'var(--faint)', marginBottom: 7 };
export const chip: CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', border: '1px solid var(--bd)', borderRadius: 4, padding: '4px 7px', color: 'var(--text)', background: 'var(--bg)' };
export const linkBtn: CSSProperties = { background: 'none', border: 'none', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--dim)', cursor: 'pointer' };
export const btn = (active = false): CSSProperties => ({ fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: active ? 'var(--on-accent)' : 'var(--text)', background: active ? 'var(--you)' : 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '7px 10px', cursor: 'pointer' });
export const inp: CSSProperties = { fontFamily: 'inherit', fontSize: 13, color: 'var(--text)', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 6, padding: '8px 10px' };

export function Muted({ text }: { text: string }) {
  return <div className="mono" style={{ ...mono, fontSize: 10.5, color: 'var(--faint)' }}>{text}</div>;
}

export interface TabDef<T extends string = string> { id: T; label: string; badge?: number }

/** Underline-style tab strip. Scrolls horizontally on narrow screens instead of
 *  wrapping (`.mgmt-tabs` hides its scrollbar), so it stays a single tidy row on
 *  mobile. `badge` renders an attention count (e.g. open code requests). */
export function TabBar<T extends string>({ tabs, active, onSelect, style }: {
  tabs: TabDef<T>[]; active: T; onSelect: (id: T) => void; style?: CSSProperties;
}) {
  return (
    <div className="mgmt-tabs" role="tablist" style={{ display: 'flex', gap: 2, overflowX: 'auto', borderBottom: '1px solid var(--bd)', ...style }}>
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
