// Is the EMPTY SLOT legible on every theme? (v0.357.1)
//
// Founder, holding up a light-theme board: "pick a player spot in the app card
// battle is washed out. Can we check that it is visible in each of the
// themes?" — so this checks, and keeps checking.
//
// The empty card was painted a fixed gold on a 3%-white fill: drawn for a dark
// board, where it measured 5.3–5.8:1, and never re-measured on the two light
// palettes, where it was 1.59:1 and 1.62:1. That is below the 3:1 floor for
// LARGE text, and this label is 10px. Gold on near-white is barely a colour.
//
// The fix reads the theme's own `warn` token, which each palette already tunes
// to its own ground. This asserts that stays true — including for the eighth
// theme nobody has written yet, which is the actual point of a check rather
// than a one-time fix.
//
// Ratios are WCAG 2.1 relative luminance. Thresholds: 4.5:1 for the label (it
// is small text, so the normal-text bar), 3:1 for the dashed border (a UI
// boundary, per 1.4.11 non-text contrast).
import { THEMES } from '../packages/core/src/theme.ts';

const TEXT_MIN = 4.5;
const BORDER_MIN = 3.0;

// Mirrors ui/cards.tsx CardEmpty. Keep in step with it — that file names this
// script so the next person changing either finds the other.
const FILL_PCT = 2;     // alpha(t.warn, 2)   — the slot's tint
const BORDER_PCT = 85;  // alpha(t.warn, 85)  — the dashed edge

const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 1, 2].map((i) => parseInt(s.slice(i * 2, i * 2 + 2), 16));
};
const lin = (c) => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
};
/** `fg` at `pct` opacity composited over opaque `bg`. */
const over = (fg, pct, bg) => fg.map((c, i) => (c * pct) / 100 + bg[i] * (1 - pct / 100));

let failed = 0;
console.log('empty-slot card — "+ PICK A PLAYER" on each theme\n');
console.log('theme       label   border');
for (const [name, t] of Object.entries(THEMES)) {
  const surface = hex(t.surface);
  const warn = hex(t.warn);
  // The card's own tint sits between the label and the surface.
  const card = over(warn, FILL_PCT, surface);
  const label = ratio(warn, card);
  const border = ratio(over(warn, BORDER_PCT, card), card);
  const bad = label < TEXT_MIN || border < BORDER_MIN;
  if (bad) failed++;
  console.log(
    `${name.padEnd(11)} ${label.toFixed(2).padStart(5)}   ${border.toFixed(2).padStart(5)}` +
    (bad ? `   ✗ below ${label < TEXT_MIN ? `${TEXT_MIN}:1 text` : `${BORDER_MIN}:1 border`}` : ''),
  );
}

if (failed) {
  console.error(`\n${failed} theme${failed === 1 ? '' : 's'} cannot read the empty slot.`);
  process.exit(1);
}
console.log('\nALL THEMES READ THE EMPTY SLOT');
