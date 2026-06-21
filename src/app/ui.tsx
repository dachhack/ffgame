import { useState, useEffect, type CSSProperties, type ReactNode } from 'react';
import type { Pos, ThemeName } from '../theme';
import { THEMES } from '../theme';
import { useStore } from './store';
import { headshot, teamLogo } from '../data/media';
import { injuryFor } from '../data/injuries';
import { APP_VERSION, DATA_SOURCE } from './version';

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

export function useTheme() {
  const { theme } = useStore();
  return THEMES[theme];
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

// Player image: ESPN headshot → team logo → position pill.
export function PlayerImg({ playerId, team, pos, size = 30 }: { playerId: string; team?: string | null; pos: Pos; size?: number }) {
  return (
    <Img src={headshot(playerId)} size={size} radius={Math.round(size * 0.3)} alt={playerId}
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

export function ThemeSwitcher() {
  const { theme, setTheme, bigText, setBigText } = useStore();
  const opts: { id: ThemeName; label: string }[] = [
    { id: 'prime', label: 'P' },
    { id: 'tactical', label: 'T' },
    { id: 'neon', label: 'N' },
    { id: 'slate', label: 'S' },
    { id: 'dusk', label: 'U' },
    { id: 'daylight', label: 'D' },
    { id: 'arctic', label: 'A' },
  ];
  return (
    <div style={{ display: 'flex', gap: 3, flex: 'none', alignItems: 'center' }}>
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
      <button
        onClick={() => setBigText(!bigText)}
        title={bigText ? 'Larger text: on (tap for normal)' : 'Larger text: off (tap to enlarge)'}
        aria-pressed={bigText}
        style={{
          height: 22, padding: '0 6px', marginLeft: 3, borderRadius: 4, fontFamily: MONO, fontWeight: 700, lineHeight: 1,
          display: 'inline-flex', alignItems: 'baseline', gap: 1,
          background: bigText ? 'var(--sh)' : 'var(--surface)',
          border: `1px solid ${bigText ? 'var(--you)' : 'var(--bd)'}`,
          color: bigText ? 'var(--you)' : 'var(--dim)',
        }}
      >
        <span style={{ fontSize: 9 }}>A</span><span style={{ fontSize: 12 }}>A</span>
      </button>
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
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.1 }}>
        <div className="grotesk" style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.12em', color: 'var(--text)', whiteSpace: 'nowrap' }}>
          DRIP LEAGUE FF
        </div>
        <div className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 7.5, letterSpacing: '0.06em', color: 'var(--faint)', marginTop: 2, whiteSpace: 'nowrap' }}>
          <span>{APP_VERSION}</span>
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
        height: isMobile ? 'auto' : 60, minHeight: 52, flex: 'none', background: 'var(--bg)', borderBottom: '1px solid var(--bd)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: 6,
        padding: isMobile ? '7px 10px' : '0 18px',
        position: 'sticky', top: 0, zIndex: 40, gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>{left}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 14, whiteSpace: 'nowrap', flexWrap: 'wrap' }}>{right}</div>
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
