// Theme for React Native.
//
// The tokens themselves are shared — THEMES/Theme come straight from
// @drip/core/theme, the same object the web app renders from. What can't be
// shared is the *applier*: the web flattens tokens into CSS custom properties
// and screens reference them as `var(--you)`, which RN has no equivalent for.
// Here a screen calls useTheme() and reads `t.you` directly.
//
// The other web-ism this replaces is `color-mix(in srgb, X N%, transparent)` —
// 97 of the ~133 uses in the web app are exactly that shape, which is just X at
// N% alpha. `alpha()` covers those; `mix()` covers blending two real colors.
import { createContext, useContext } from 'react';
import { THEMES, type Theme, type ThemeName, type Pos, type FxKey } from '@drip/core/theme';
import { storeGet, storeSet } from '@drip/core/platform';

export { THEMES };
export type { Theme, ThemeName, Pos, FxKey };

// Same key the web app uses, so a future shared-profile sync has one name to
// carry rather than two.
const THEME_KEY = 'gc-theme';
export const DEFAULT_THEME: ThemeName = 'neon';

export function loadTheme(): ThemeName {
  const s = storeGet(THEME_KEY) as ThemeName | null;
  return s && s in THEMES ? s : DEFAULT_THEME;
}
export function saveTheme(t: ThemeName): void { storeSet(THEME_KEY, t); }

export const ThemeCtx = createContext<Theme>(THEMES[DEFAULT_THEME]);
export const useTheme = (): Theme => useContext(ThemeCtx);

// ── Color math ───────────────────────────────────────────────────────────────
// RN accepts #rgb/#rrggbb/#rrggbbaa and rgba(), but does no computation, so the
// blending CSS did for us has to happen here.

interface Rgb { r: number; g: number; b: number; a: number }

function parse(c: string): Rgb | null {
  const s = c.trim();
  if (s.startsWith('#')) {
    const h = s.slice(1);
    const n = (i: number, len: number) => {
      const chunk = len === 1 ? h[i].repeat(2) : h.slice(i * 2, i * 2 + 2);
      return parseInt(chunk, 16);
    };
    if (h.length === 3 || h.length === 4) {
      return { r: n(0, 1), g: n(1, 1), b: n(2, 1), a: h.length === 4 ? n(3, 1) / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return { r: n(0, 2), g: n(1, 2), b: n(2, 2), a: h.length === 8 ? n(3, 2) / 255 : 1 };
    }
    return null;
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((x) => !Number.isNaN(x))) {
      return { r: parts[0], g: parts[1], b: parts[2], a: parts[3] ?? 1 };
    }
  }
  return null;
}

const clamp255 = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const rgba = (c: Rgb) => `rgba(${clamp255(c.r)}, ${clamp255(c.g)}, ${clamp255(c.b)}, ${Math.max(0, Math.min(1, c.a))})`;

/** `color-mix(in srgb, color N%, transparent)` — i.e. `color` at N% opacity.
 *  Unparseable input is returned untouched rather than throwing: a wrong tint is
 *  a visual nit, a crash mid-matchup is not. */
export function alpha(color: string, pct: number): string {
  const c = parse(color);
  if (!c) return color;
  return rgba({ ...c, a: c.a * (pct / 100) });
}

/** `color-mix(in srgb, a N%, b)` — N% of `a` blended over `b`, both opaque. */
export function mix(a: string, pct: number, b: string): string {
  const x = parse(a); const y = parse(b);
  if (!x || !y) return a;
  const w = pct / 100;
  return rgba({
    r: x.r * w + y.r * (1 - w),
    g: x.g * w + y.g * (1 - w),
    b: x.b * w + y.b * (1 - w),
    a: x.a * w + y.a * (1 - w),
  });
}

/** True for the two light themes — a few surfaces (shadows, card stock) need to
 *  know, and deriving it from the palette is guesswork. */
export const isLight = (name: ThemeName): boolean => name === 'daylight' || name === 'arctic';

// ── Type scale ───────────────────────────────────────────────────────────────
// The web app leans on two font families applied via className ('mono' and
// 'grotesk'). RN has no cascade, so they become explicit style objects. System
// monospace differs per platform; Space Grotesk needs expo-font before it can
// be named here, so headings fall back to the system sans for now.
import { Platform } from 'react-native';

export const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })!;

/** Global type scale (v0.265.0, recurved v0.266.0). The app's sizes were
 *  ported 1:1 from the web's CSS pixels, and what reads at arm's length on a
 *  laptop is squinty at phone distance.
 *
 *  v0.265.0 tried a MULTIPLIER (×1.15) and the founder's screenshot showed
 *  why that's the wrong shape: it preserves the problem. Small text is the
 *  complaint, and 8.5 × 1.15 ≈ 9.8 is still small — while the already-fine
 *  titles grew the most in absolute points. What's wanted is COMPRESSION:
 *  pull the small end up hard toward a readable floor and leave the large
 *  end alone. Sizes below the pivot close 40% of their distance to it;
 *  sizes at or above it don't move. Monotonic (hierarchy survives) and
 *  continuous at the pivot:
 *
 *    8 → 10.75 · 8.5 → 11 · 9 → 11.5 · 10 → 12 · 11 → 12.5 · 12 → 13.25
 *    13 → 13.75 · 14 → 14.5 · 15+ → unchanged
 *
 *  Applied inside the prims (Mono, Display, Chip, PrimaryButton, LinkButton,
 *  PosPill, Overlay chrome) AND across the management surfaces' raw <Text>
 *  (commish tools, settings sheets, team management) — the game surfaces
 *  (the board, the field, score digits) stay pixel-tuned and unscaled. */
export const TYPE_PIVOT = 15;
export const TYPE_SLOPE = 0.6;   // fraction of the gap to the pivot that remains
export const fs = (n: number) =>
  n >= TYPE_PIVOT ? n : Math.round((TYPE_PIVOT - (TYPE_PIVOT - n) * TYPE_SLOPE) * 4) / 4;

export const type = {
  mono: { fontFamily: MONO },
  grotesk: { fontWeight: '700' as const },
};
