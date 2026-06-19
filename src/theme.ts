// Design tokens from the Gridiron Clash handoff. Three interchangeable themes,
// applied as CSS custom properties on the app root. Default = "prime".

export type ThemeName = 'tactical' | 'neon' | 'prime' | 'daylight' | 'arctic' | 'slate' | 'dusk';

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
  onAccent: string; // text/icon color that sits on a you/opp/warn fill (dark on light themes, light on dark)
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
    you: '#36E59B', opp: '#FF5266', warn: '#FFB23B', onAccent: '#161510',
    fx: { nuke: '#FF4F62', erase: '#FF4F62', reset: '#FF9043', streak: '#B89AFF', mult: '#6AB6FF', compression: '#7FE38A', stop: '#B5B3A6', sys: '#8C8A7D' },
    pos: POS_TACTICAL,
  },
  neon: {
    bg: '#221E33', surface: '#2C2941', sh: '#363250', bd: '#3A3858', bdh: '#4A4870',
    text: '#F1EEFB', dim: '#A29FC0', faint: '#726F8C', mid: '#BFBCD6', dimstrong: '#D6D3E8',
    you: '#34E5D9', opp: '#FF3D88', warn: '#FFD24A', onAccent: '#14111F',
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
    you: '#E2B254', opp: '#FF6E5C', warn: '#5BAEFF', onAccent: '#16140E',
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

  // ── Light themes ──────────────────────────────────────────────────────────
  // Warm paper light mode. Accents are deep enough that white (onAccent) reads
  // on a you/opp/warn fill, and dark enough to read as text on the light surface.
  daylight: {
    bg: '#EFEADd', surface: '#FBF9F2', sh: '#E7E1D2', bd: '#DAD3C2', bdh: '#C5BCA6',
    text: '#241F16', dim: '#6E6857', faint: '#998F79', mid: '#4C4736', dimstrong: '#332E22',
    you: '#1C8A57', opp: '#CC3A38', warn: '#2C6FC9', onAccent: '#FFFFFF',
    fx: { nuke: '#CB372D', erase: '#CB372D', reset: '#B7741B', streak: '#6A45C9', mult: '#2C6FC9', compression: '#1C8A4C', stop: '#7A6F58', sys: '#8A8270' },
    pos: {
      QB: { bg: '#DCEAFB', fg: '#1C5BA6', bd: '#A9CBF0' },
      RB: { bg: '#D9F0DD', fg: '#1F7A43', bd: '#A6D9B2' },
      WR: { bg: '#E6DEF8', fg: '#5B3FB0', bd: '#C7B8EC' },
      TE: { bg: '#FBEAD0', fg: '#9A6418', bd: '#EBCF9F' },
      K: { bg: '#FBDADA', fg: '#C0332F', bd: '#F0B3B0' },
      DEF: { bg: '#E7E5DC', fg: '#5A5446', bd: '#CFCABA' },
    },
  },
  // Cool, crisp light mode.
  arctic: {
    bg: '#E9EEF3', surface: '#FBFCFE', sh: '#DEE5EE', bd: '#D1D9E3', bdh: '#BAC4D1',
    text: '#1B2230', dim: '#5E6A7B', faint: '#94A1B2', mid: '#3D4757', dimstrong: '#28303D',
    you: '#0E8C7A', opp: '#CC3552', warn: '#1F6FC7', onAccent: '#FFFFFF',
    fx: { nuke: '#CF3450', erase: '#CF3450', reset: '#C2761F', streak: '#5A46C0', mult: '#1F6FC7', compression: '#0E8268', stop: '#67707D', sys: '#7C8794' },
    pos: {
      QB: { bg: '#DCEBFA', fg: '#1B5FA8', bd: '#AECDEE' },
      RB: { bg: '#D7EFEA', fg: '#10796A', bd: '#A6DACF' },
      WR: { bg: '#E3E0F7', fg: '#4E45B5', bd: '#C2BCEB' },
      TE: { bg: '#F6E8D6', fg: '#9A6A22', bd: '#E5CFAE' },
      K: { bg: '#FAD9DE', fg: '#C23250', bd: '#EEB1BD' },
      DEF: { bg: '#E4E7EC', fg: '#54606E', bd: '#CAD0D8' },
    },
  },
  // Daylight's palette (green primary, red/blue accents) on a warm dark backdrop
  // — the dark twin of the light "daylight" theme.
  dusk: {
    bg: '#211D15', surface: '#2C2820', sh: '#393327', bd: '#3A352A', bdh: '#4B4536',
    text: '#F3EFE2', dim: '#A79C87', faint: '#6E6655', mid: '#C6BCA6', dimstrong: '#DED6C2',
    you: '#46C386', opp: '#ED5A50', warn: '#5C9CEF', onAccent: '#211D15',
    fx: { nuke: '#ED5A50', erase: '#ED5A50', reset: '#E0954A', streak: '#B69AE3', mult: '#5C9CEF', compression: '#5FC489', stop: '#A89E89', sys: '#7A7263' },
    pos: {
      QB: { bg: '#15263A', fg: '#7AB5FF', bd: '#243C5C' },
      RB: { bg: '#16301F', fg: '#67D79A', bd: '#27512F' },
      WR: { bg: '#221A38', fg: '#B69AE3', bd: '#3A2F5A' },
      TE: { bg: '#2C2210', fg: '#E5B257', bd: '#4C3B1D' },
      K: { bg: '#341C18', fg: '#ED6A60', bd: '#552F2A' },
      DEF: { bg: '#201E18', fg: '#B5AC96', bd: '#332F27' },
    },
  },
  // Cool dark slate-blue, teal accent.
  slate: {
    bg: '#1A1E26', surface: '#232834', sh: '#2C323F', bd: '#2F3540', bdh: '#3E4654',
    text: '#EAEEF5', dim: '#94A0B2', faint: '#5E6878', mid: '#AEB8C6', dimstrong: '#CFD6E0',
    you: '#4FD1C5', opp: '#FF6B81', warn: '#F5B53D', onAccent: '#11151C',
    fx: { nuke: '#FF6B81', erase: '#FF6B81', reset: '#F59E5C', streak: '#B79BFF', mult: '#5BB6FF', compression: '#6FCF97', stop: '#A7B0BE', sys: '#94A0B2' },
    pos: {
      QB: { bg: '#13283F', fg: '#74B6FF', bd: '#21466B' },
      RB: { bg: '#13302A', fg: '#5FE3B8', bd: '#1F5747' },
      WR: { bg: '#221C3E', fg: '#B79BFF', bd: '#3A3163' },
      TE: { bg: '#2E2410', fg: '#F5C24E', bd: '#4E3E1D' },
      K: { bg: '#341A24', fg: '#FF6B81', bd: '#562C3A' },
      DEF: { bg: '#1F232C', fg: '#AEB8C6', bd: '#333A45' },
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
    '--you': t.you, '--opp': t.opp, '--warn': t.warn, '--on-accent': t.onAccent,
  };
  (Object.keys(t.fx) as FxKey[]).forEach((k) => { v[`--fx-${k}`] = t.fx[k]; });
  (Object.keys(t.pos) as Pos[]).forEach((p) => {
    v[`--pos-${p}-bg`] = t.pos[p].bg;
    v[`--pos-${p}-fg`] = t.pos[p].fg;
    v[`--pos-${p}-bd`] = t.pos[p].bd;
  });
  return v;
}
