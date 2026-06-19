// Design tokens from the Gridiron Clash handoff. Three interchangeable themes,
// applied as CSS custom properties on the app root. Default = "prime".

export type ThemeName = 'tactical' | 'neon' | 'prime';

export interface Theme {
  bg: string;
  surface: string;
  sh: string;
  bd: string;
  bdh: string;
  text: string;
  dim: string;
  faint: string;
  mid: string;
  dimstrong: string;
  you: string;
  opp: string;
  warn: string;
  fx: Record<FxKey, string>;
  pos: Record<Pos, { bg: string; fg: string; bd: string }>;
}

export type FxKey = 'nuke' | 'erase' | 'reset' | 'streak' | 'mult' | 'compression' | 'stop' | 'sys';
export type Pos = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF';

const POS_TACTICAL: Theme['pos'] = {
  QB: { bg: '#102339', fg: '#79B3FF', bd: '#1F3A60' },
  RB: { bg: '#13261A', fg: '#7FE38A', bd: '#22532A' },
  WR: { bg: '#1F1638', fg: '#B49AFF', bd: '#3F2A6F' },
  TE: { bg: '#2E1F0E', fg: '#F4B66B', bd: '#5B3E1F' },
  K: { bg: '#321414', fg: '#FF8585', bd: '#5C2222' },
  DEF: { bg: '#1F1F1D', fg: '#C2C0B2', bd: '#36352D' },
};

export const THEMES: Record<ThemeName, Theme> = {
  tactical: {
    bg: '#24221A', surface: '#2F2C23', sh: '#38352B', bd: '#3A3830', bdh: '#494638',
    text: '#F4F2E8', dim: '#9C9A8C', faint: '#6C6A5E', mid: '#ADAB9E', dimstrong: '#DEDCD1',
    you: '#36E59B', opp: '#FF5266', warn: '#FFB23B',
    fx: { nuke: '#FF4F62', erase: '#FF4F62', reset: '#FF9043', streak: '#B89AFF', mult: '#6AB6FF', compression: '#7FE38A', stop: '#B5B3A6', sys: '#8C8A7D' },
    pos: POS_TACTICAL,
  },
  neon: {
    bg: '#221E33', surface: '#2C2941', sh: '#363250', bd: '#3A3858', bdh: '#4A4870',
    text: '#F1EEFB', dim: '#A29FC0', faint: '#726F8C', mid: '#BFBCD6', dimstrong: '#D6D3E8',
    you: '#34E5D9', opp: '#FF3D88', warn: '#FFD24A',
    fx: { nuke: '#FF3D88', erase: '#FF3D88', reset: '#FF7E5C', streak: '#C29BFF', mult: '#34E5D9', compression: '#7FE38A', stop: '#B0AEC6', sys: '#9290B0' },
    pos: {
      QB: { bg: '#0E2A48', fg: '#5BC4FF', bd: '#1B4775' },
      RB: { bg: '#10291C', fg: '#5DE39C', bd: '#1F5236' },
      WR: { bg: '#221544', fg: '#C29BFF', bd: '#3E2877' },
      TE: { bg: '#2B1410', fg: '#FFA67B', bd: '#5A2C20' },
      K: { bg: '#37102B', fg: '#FF7BB2', bd: '#5E1F48' },
      DEF: { bg: '#1B1B27', fg: '#B0AEC6', bd: '#2E2D40' },
    },
  },
  prime: {
    bg: '#252116', surface: '#302C20', sh: '#3B3527', bd: '#3C3729', bdh: '#4D4737',
    text: '#F4F0E2', dim: '#ABA18D', faint: '#6F6857', mid: '#C7BDA8', dimstrong: '#DFD7C3',
    you: '#E2B254', opp: '#FF6E5C', warn: '#5BAEFF',
    fx: { nuke: '#FF6E5C', erase: '#FF6E5C', reset: '#E29D4E', streak: '#B69AE3', mult: '#5BAEFF', compression: '#6FCC8A', stop: '#A89E89', sys: '#7A7263' },
    pos: {
      QB: { bg: '#15263A', fg: '#7AB5FF', bd: '#243C5C' },
      RB: { bg: '#1A2818', fg: '#84CE93', bd: '#2D4830' },
      WR: { bg: '#1F1A36', fg: '#A89AE0', bd: '#332C56' },
      TE: { bg: '#2A1F0E', fg: '#E2B254', bd: '#48371D' },
      K: { bg: '#321B17', fg: '#FF6E5C', bd: '#532F2A' },
      DEF: { bg: '#1F1E1A', fg: '#B5AE9A', bd: '#322F28' },
    },
  },
};

// Fixed accents used across all themes.
export const LIVE_RED = '#FF4F62';
export const HOT_PURPLE = '#B89AFF';

/** Flatten a theme into the CSS custom properties the app reads. */
export function themeVars(t: Theme): Record<string, string> {
  const v: Record<string, string> = {
    '--bg': t.bg, '--surface': t.surface, '--sh': t.sh, '--bd': t.bd, '--bdh': t.bdh,
    '--text': t.text, '--dim': t.dim, '--faint': t.faint, '--mid': t.mid, '--dimstrong': t.dimstrong,
    '--you': t.you, '--opp': t.opp, '--warn': t.warn,
  };
  (Object.keys(t.fx) as FxKey[]).forEach((k) => { v[`--fx-${k}`] = t.fx[k]; });
  (Object.keys(t.pos) as Pos[]).forEach((p) => {
    v[`--pos-${p}-bg`] = t.pos[p].bg;
    v[`--pos-${p}-fg`] = t.pos[p].fg;
    v[`--pos-${p}-bd`] = t.pos[p].bd;
  });
  return v;
}
