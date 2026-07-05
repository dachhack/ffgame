import type { CSSProperties, ReactNode } from 'react';

// Custom artwork for game icons (art assets in public/icons). Slots without
// art keep their emoji — PuIcon/FxIcon fall back to the glyph they're given.

// The app deploys under a base path (GitHub Pages /ffgame/), so asset URLs
// must be prefixed with Vite's BASE_URL rather than starting at /.
const asset = (name: string) => `${import.meta.env.BASE_URL}icons/${name}.png`;

/** Power-up id → asset. Ids missing here intentionally keep their emoji. */
export const PU_ART: Record<string, string> = {
  'metric-swap': asset('pu-metric-swap'),
  'player-swap': asset('pu-player-swap'),
  'extra-slot': asset('pu-extra-slot'),
  'unlock-return': asset('pu-return-yards'),
  'unlock-carries-wipe': asset('pu-carries-wipe'),
  'unlock-combo-drip': asset('pu-combo-drip'),
  'unlock-pass-td10': asset('pu-air-raid'),
  'trick-play': asset('pu-trick-play'),
  'pick-six': asset('pu-pick-six'),
  'hail-mary': asset('pu-hail-mary'),
  'momentum': asset('pu-momentum'),
  'garbage-time': asset('pu-garbage-time'),
  'overtime': asset('pu-overtime'),
  'ot-shield': asset('pu-ot-shield'),
  'insurance': asset('pu-insurance'),
  'double-or-nothing': asset('pu-double-or-nothing'),
  'spy': asset('pu-spy'),
  'mulligan': asset('pu-mulligan'),
  'emp': asset('pu-emp'),
  'turnover-boost': asset('pu-ball-hawk'),
};

/** Narration-beat key → asset (see demoNarration lessonFor keys). */
export const FX_ART: Record<string, string> = {
  nuke: asset('fx-nuke'),
  erase: asset('fx-erase'),
  power: asset('fx-power'),
  coin: asset('coin-gold'),
  freeze: asset('fx-freeze'),
};

export const COIN_GOLD = asset('coin-gold');
export const COIN_SILVER = asset('coin-silver');
export const BRAND_MARK = asset('brand-mark');
export const UI_ART = {
  rulebook: asset('ui-rulebook'),
  admin: asset('ui-admin'),
  scout: asset('ui-scout'),
  liveboard: asset('ui-liveboard'),
};

/** Inline icon image, sized in em so it scales with the surrounding text. */
export function GameIcon({ src, size = '1.15em', style }: { src: string; size?: number | string; style?: CSSProperties }) {
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      style={{ height: size, width: size, objectFit: 'contain', verticalAlign: '-0.22em', display: 'inline-block', flex: 'none', ...style }}
    />
  );
}

/** Power-up icon: custom art when the id has some, else the data emoji. */
export function PuIcon({ id, emoji, size, style }: { id?: string; emoji?: ReactNode; size?: number | string; style?: CSSProperties }) {
  const src = id ? PU_ART[id] : undefined;
  if (src) return <GameIcon src={src} size={size} style={style} />;
  return <>{emoji ?? null}</>;
}

/** Live-event icon by narration key: custom art when mapped, else the emoji. */
export function FxIcon({ k, emoji, size, style }: { k?: string; emoji?: ReactNode; size?: number | string; style?: CSSProperties }) {
  const src = k ? FX_ART[k] : undefined;
  if (src) return <GameIcon src={src} size={size} style={style} />;
  return <>{emoji ?? null}</>;
}
