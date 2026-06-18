import type { CSSProperties, ReactNode } from 'react';
import type { Pos, ThemeName } from '../theme';
import { THEMES } from '../theme';
import { useStore } from './store';

export function useTheme() {
  const { theme } = useStore();
  return THEMES[theme];
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const GROTESK = "'Space Grotesk', system-ui, sans-serif";

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
export function Avatar({ name, accent = 'var(--you)', size = 30 }: { name: string; accent?: string; size?: number }) {
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase() || '?';
  return (
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
}

export function ThemeSwitcher() {
  const { theme, setTheme } = useStore();
  const opts: { id: ThemeName; label: string }[] = [
    { id: 'tactical', label: 'T' },
    { id: 'neon', label: 'N' },
    { id: 'prime', label: 'P' },
  ];
  return (
    <div style={{ display: 'flex', gap: 3, flex: 'none' }}>
      {opts.map((o) => {
        const active = theme === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setTheme(o.id)}
            title={o.id}
            style={{
              width: 22, height: 22, borderRadius: 4, fontFamily: MONO, fontSize: 10, fontWeight: 700,
              background: active ? 'var(--sh)' : 'var(--surface)',
              border: `1px solid ${active ? 'var(--you)' : 'var(--bd)'}`,
              color: active ? 'var(--you)' : 'var(--dim)',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Brand({ onClick }: { onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, cursor: onClick ? 'pointer' : 'default' }}
    >
      <div style={{ width: 13, height: 13, background: 'var(--you)', transform: 'rotate(45deg)', flex: 'none' }} />
      <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)', whiteSpace: 'nowrap' }}>
        GRIDIRON CLASH
      </div>
    </div>
  );
}

export function Header({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <header
      style={{
        height: 60, flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 18px',
        position: 'sticky', top: 0, zIndex: 40, gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>{left}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, whiteSpace: 'nowrap', flex: 'none' }}>{right}</div>
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
