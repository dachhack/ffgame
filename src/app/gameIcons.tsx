import { useState, type CSSProperties, type ReactNode } from 'react';
import { useStore, type IconSetName } from './store';

// Three switchable icon skins (picked in Settings, persisted like the theme):
//   emoji   — the classic glyphs, no image assets at all
//   factory — the "Football Factory" art set in public/icons/factory
//   pixel   — the retro "Pixel Bowl" sprites in public/icons/pixel
// Image sets share filenames; a missing file (e.g. a Pixel Bowl sprite that
// hasn't been drawn yet) falls back to the emoji at runtime via onError.

// The app deploys under a base path (GitHub Pages /ffgame/), so asset URLs
// must be prefixed with Vite's BASE_URL rather than starting at /.
const assetUrl = (set: IconSetName, name: string) => `${import.meta.env.BASE_URL}icons/${set}/${name}.png`;

/** Power-up id → asset basename. Ids missing here always keep their emoji. */
export const PU_ART: Record<string, string> = {
  'metric-swap': 'pu-metric-swap',
  'player-swap': 'pu-player-swap',
  'extra-slot': 'pu-extra-slot',
  'unlock-return': 'pu-return-yards',
  'unlock-carries-wipe': 'pu-carries-wipe',
  'unlock-combo-drip': 'pu-combo-drip',
  'unlock-pass-td10': 'pu-air-raid',
  'trick-play': 'pu-trick-play',
  'pick-six': 'pu-pick-six',
  'hail-mary': 'pu-hail-mary',
  'momentum': 'pu-momentum',
  'garbage-time': 'pu-garbage-time',
  'overtime': 'pu-overtime',
  'ot-shield': 'pu-ot-shield',
  'insurance': 'pu-insurance',
  'double-or-nothing': 'pu-double-or-nothing',
  'spy': 'pu-spy',
  'mulligan': 'pu-mulligan',
  'emp': 'pu-emp',
  'turnover-boost': 'pu-ball-hawk',
};

/** Narration-beat key → asset basename (see demoNarration lessonFor keys). */
export const FX_ART: Record<string, string> = {
  nuke: 'fx-nuke',
  erase: 'fx-erase',
  power: 'fx-power',
  coin: 'coin-gold',
  freeze: 'fx-freeze',
};

export const COIN_GOLD = 'coin-gold';
export const COIN_SILVER = 'coin-silver';
export const BRAND_MARK = 'brand-mark';
export const UI_ART = {
  rulebook: 'ui-rulebook',
  admin: 'ui-admin',
  scout: 'ui-scout',
  liveboard: 'ui-liveboard',
};

export const ICON_SETS: { id: IconSetName; name: string }[] = [
  { id: 'emoji', name: 'Classic Emoji' },
  { id: 'factory', name: 'Football Factory' },
  // Pixel Bowl is parked until its sprite set is ready — re-add
  // { id: 'pixel', name: 'Pixel Bowl' } here to revive the option
  // (the runtime plumbing and public/icons/pixel/README.md remain).
];

/** A raw emoji glyph bumped to icon size, so emoji read at the same scale as
 *  the art sets instead of shrinking to the surrounding label text. */
export function Emoji({ e, size = '1.35em', style }: { e?: ReactNode; size?: number | string; style?: CSSProperties }) {
  if (e == null) return null;
  return <span aria-hidden style={{ fontSize: size, lineHeight: 1, verticalAlign: '-0.14em', display: 'inline-block', ...style }}>{e}</span>;
}

/** Inline icon for the active set: an image sized in em (or px) for the art
 *  sets, the same-size emoji glyph for the emoji set — and the emoji again if
 *  the image fails to load (an undrawn Pixel Bowl sprite). `set` overrides the
 *  store's choice, for previews. */
export function GameIcon({ name, emoji, size = '1.15em', style, set }: {
  name: string; emoji?: ReactNode; size?: number | string; style?: CSSProperties; set?: IconSetName;
}) {
  const { iconSet } = useStore();
  const active = set ?? iconSet;
  const [failed, setFailed] = useState<string | null>(null);
  if (active === 'emoji' || failed === active) return <Emoji e={emoji} size={size} style={style} />;
  return (
    <img
      src={assetUrl(active, name)}
      alt=""
      aria-hidden
      onError={() => setFailed(active)}
      style={{ height: size, width: size, objectFit: 'contain', verticalAlign: '-0.22em', display: 'inline-block', flex: 'none', ...style }}
    />
  );
}

/** Power-up icon: set artwork when the id has some, else the data emoji. */
export function PuIcon({ id, emoji, size, style }: { id?: string; emoji?: ReactNode; size?: number | string; style?: CSSProperties }) {
  const name = id ? PU_ART[id] : undefined;
  if (!name) return <Emoji e={emoji} size={size} style={style} />;
  return <GameIcon name={name} emoji={emoji} size={size} style={style} />;
}

/** Live-event icon by narration key: set artwork when mapped, else the emoji. */
export function FxIcon({ k, emoji, size, style }: { k?: string; emoji?: ReactNode; size?: number | string; style?: CSSProperties }) {
  const name = k ? FX_ART[k] : undefined;
  if (!name) return <Emoji e={emoji} size={size} style={style} />;
  return <GameIcon name={name} emoji={emoji} size={size} style={style} />;
}

/** Drip coin — the set's coin artwork; the emoji set keeps the original
 *  minted-coin SVG (gold disc with the ◈ house mark). */
export function DripCoin({ size = 12 }: { size?: number }) {
  const { iconSet } = useStore();
  if (iconSet !== 'emoji') return <GameIcon name={COIN_GOLD} emoji={<CoinSvg size={size} />} size={size} style={{ verticalAlign: 'text-bottom' }} />;
  return <CoinSvg size={size} />;
}

function CoinSvg({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden style={{ display: 'inline-block', verticalAlign: 'text-bottom', flex: 'none' }}>
      <circle cx="8" cy="8" r="7" fill="#F2C14E" stroke="#9A6B12" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="5.1" fill="none" stroke="#C9952B" strokeWidth="0.9" />
      <path d="M8 4.6 L10.4 8 L8 11.4 L5.6 8 Z" fill="#9A6B12" />
    </svg>
  );
}
