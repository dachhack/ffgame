// THEME ASSERTIONS (v0.379.0) — the colorblind-accessible themes stay that way.
//
// Every theme named in ACCESSIBLE_THEMES (core/theme.ts) is held to:
//   1. WCAG contrast: text/mid/dimstrong ≥ 4.5:1 on bg AND surface; dim ≥ 3:1
//      (small mono labels); onAccent ≥ 4.5:1 on every you/opp/warn fill;
//      you/opp/warn ≥ 3:1 against the surface (UI component contrast).
//   2. CVD separability: you vs opp vs warn pairwise ΔE(Lab) ≥ 20 under
//      NORMAL vision and under simulated protanopia, deuteranopia and
//      tritanopia (Viénot/Brettel dichromat matrices in linear RGB).
//   3. Grayscale separability: you vs opp relative-luminance ratio ≥ 1.25 —
//      the pair must survive with all color gone.
//   4. The fx set's danger (nuke) vs boost (mult) reads apart under every
//      simulation too — the live board's fight is drawn in these two.
// Every OTHER theme gets one sanity check only (you ≠ opp): the classic
// palettes are allowed their green-vs-red; that is what these two are FOR.
import { THEMES, ACCESSIBLE_THEMES } from '../packages/core/src/theme.ts';

let fails = 0;
const ok = (name, cond) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}`); if (!cond) fails++; };

// ── color math ──────────────────────────────────────────────────────────────
const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linRgb = (h) => hex(h).map(lin);
const relLum = (h) => { const [r, g, b] = linRgb(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => {
  const [l1, l2] = [relLum(a), relLum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

// Dichromat simulation in linear RGB (Viénot 1999 protan/deutan; Brettel-style
// tritan approximation) — coarse on purpose: a guardrail, not a lab.
const SIMS = {
  normal: null,
  protan: [[0.10889, 0.89111, 0], [0.10889, 0.89111, 0], [0.00447, -0.00447, 1]],
  deutan: [[0.29031, 0.70969, 0], [0.29031, 0.70969, 0], [-0.02197, 0.02197, 1]],
  tritan: [[1, 0.15236, -0.15236], [0, 0.86717, 0.13283], [0, 0.86717, 0.13283]],
};
const applySim = (rgb, m) => (m ? m.map((row) => row[0] * rgb[0] + row[1] * rgb[1] + row[2] * rgb[2]) : rgb);

// linear RGB → XYZ (sRGB D65) → Lab
const toLab = (rgb) => {
  const [r, g, b] = rgb;
  const x = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x / 0.95047), f(y), f(z / 1.08883)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
const dE = (h1, h2, sim) => {
  const [a, b] = [toLab(applySim(linRgb(h1), sim)), toLab(applySim(linRgb(h2), sim))];
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
};

// ── the assertions ──────────────────────────────────────────────────────────
for (const name of ACCESSIBLE_THEMES) {
  const t = THEMES[name];
  ok(`${name}: theme exists`, !!t);
  if (!t) continue;

  for (const ground of ['bg', 'surface']) {
    ok(`${name}: text ≥ 4.5:1 on ${ground}`, contrast(t.text, t[ground]) >= 4.5);
    ok(`${name}: mid ≥ 4.5:1 on ${ground}`, contrast(t.mid, t[ground]) >= 4.5);
    ok(`${name}: dimstrong ≥ 4.5:1 on ${ground}`, contrast(t.dimstrong, t[ground]) >= 4.5);
    ok(`${name}: dim ≥ 3:1 on ${ground}`, contrast(t.dim, t[ground]) >= 3);
  }
  for (const accent of ['you', 'opp', 'warn']) {
    ok(`${name}: onAccent ≥ 4.5:1 on ${accent} fill`, contrast(t.onAccent, t[accent]) >= 4.5);
    ok(`${name}: ${accent} ≥ 3:1 against surface`, contrast(t[accent], t.surface) >= 3);
  }

  for (const [sim, m] of Object.entries(SIMS)) {
    ok(`${name}: you vs opp apart under ${sim} (ΔE ≥ 20)`, dE(t.you, t.opp, m) >= 20);
    ok(`${name}: you vs warn apart under ${sim} (ΔE ≥ 20)`, dE(t.you, t.warn, m) >= 20);
    ok(`${name}: opp vs warn apart under ${sim} (ΔE ≥ 20)`, dE(t.opp, t.warn, m) >= 20);
    ok(`${name}: nuke vs mult apart under ${sim} (ΔE ≥ 20)`, dE(t.fx.nuke, t.fx.mult, m) >= 20);
  }

  const [hi, lo] = [relLum(t.you), relLum(t.opp)].sort((a, b) => b - a);
  ok(`${name}: you vs opp survive grayscale (luminance ratio ≥ 1.25)`,
    (hi + 0.05) / (lo + 0.05) >= 1.25);
}

for (const [name, t] of Object.entries(THEMES)) {
  ok(`${name}: you and opp are not the same color`, t.you.toLowerCase() !== t.opp.toLowerCase());
}

if (fails) { console.log(`\n${fails} THEME ASSERTION(S) FAILED`); process.exit(1); }
console.log('\nALL THEME ASSERTIONS PASSED');
