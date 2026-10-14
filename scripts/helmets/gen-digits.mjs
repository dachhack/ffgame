// HELMET NUMBERS AS PATHS (v0.713.0) — Jersey 15's digits 0–9 as SVG outlines,
// plus the slice of the helmet manifest the app needs to draw a number.
//
//   node scripts/helmets/gen-digits.mjs   (npm run gen:helmet-digits)
//
// Founder: "a mode that replaces the head shots and team logos with the
// helmets. For the headshots, superimpose the player's jersey number in a
// sporty font over the lower corner of the helmet in a consistent spot."
//
// The phone has no font loader (expo-font would be a native module, so an
// iPhone build), but it has react-native-svg. So the font never ships: its
// ten digit glyphs are read out of public/fonts/jersey-15.ttf here and baked as
// path data, and both apps draw the number as SVG shapes. The size, colours
// and anchor come from public/helmets/manifest.json (gen-helmets.mjs), so the
// app draws exactly what preview/sheet.png shows.
//
// A minimal TrueType reader: head, hhea, hmtx, loca, cmap (format 4), and
// simple glyf outlines (quadratic, implied on-curve points). Jersey 15's
// digits are simple glyphs; a composite one fails loudly rather than drawing
// a blank.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const FONT = join(ROOT, 'public', 'fonts', 'jersey-15.ttf');
const MANIFEST = join(ROOT, 'public', 'helmets', 'manifest.json');
const OUT = join(ROOT, 'packages', 'core', 'src', 'data', 'helmetSpec.ts');

const buf = readFileSync(FONT);
const u16 = (o) => buf.readUInt16BE(o);
const i16 = (o) => buf.readInt16BE(o);
const u32 = (o) => buf.readUInt32BE(o);

const tables = {};
for (let i = 0, n = u16(4); i < n; i++) {
  const r = 12 + 16 * i;
  tables[buf.toString('latin1', r, r + 4)] = { off: u32(r + 8), len: u32(r + 12) };
}
const need = (t) => { if (!tables[t]) throw new Error(`jersey-15.ttf has no ${t} table`); return tables[t].off; };

const head = need('head');
const unitsPerEm = u16(head + 18);
const longLoca = i16(head + 50) === 1;
const hhea = need('hhea');
const ascent = i16(hhea + 4);
const numHMetrics = u16(hhea + 34);
const hmtx = need('hmtx');
const advanceOf = (g) => u16(hmtx + 4 * Math.min(g, numHMetrics - 1));
const loca = need('loca');
const glyf = need('glyf');
const glyphRange = (g) => longLoca
  ? [u32(loca + 4 * g), u32(loca + 4 * g + 4)]
  : [u16(loca + 2 * g) * 2, u16(loca + 2 * g + 2) * 2];

// cmap: the first (3,1) or (0,*) subtable, format 4.
function glyphIndex(code) {
  const cmap = need('cmap');
  for (let i = 0, n = u16(cmap + 2); i < n; i++) {
    const pid = u16(cmap + 4 + 8 * i), eid = u16(cmap + 6 + 8 * i), sub = cmap + u32(cmap + 8 + 8 * i);
    if (!((pid === 3 && eid === 1) || pid === 0) || u16(sub) !== 4) continue;
    const segX2 = u16(sub + 6);
    const ends = sub + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < segX2 / 2; s++) {
      const end = u16(ends + 2 * s), start = u16(starts + 2 * s);
      if (code < start || code > end) continue;
      const delta = i16(deltas + 2 * s), ro = u16(ranges + 2 * s);
      if (ro === 0) return (code + delta) & 0xffff;
      const g = u16(ranges + 2 * s + ro + 2 * (code - start));
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
  }
  throw new Error(`no glyph for U+${code.toString(16)}`);
}

// One simple glyph → an SVG path in font units, y flipped so +y is down and the
// baseline is y = 0 (the app scales and translates it onto the helmet).
function glyphPath(g) {
  const [a, b] = glyphRange(g);
  if (a === b) return '';
  let p = glyf + a;
  const nContours = i16(p);
  if (nContours < 0) throw new Error(`glyph ${g} is composite`);
  p += 10;
  const endPts = [];
  for (let i = 0; i < nContours; i++) { endPts.push(u16(p)); p += 2; }
  const nPts = endPts[nContours - 1] + 1;
  p += 2 + u16(p); // instructions
  const flags = [];
  while (flags.length < nPts) {
    const f = buf[p++];
    flags.push(f);
    if (f & 8) { let r = buf[p++]; while (r-- > 0) flags.push(f); }
  }
  const read = (short, same) => {
    const out = []; let v = 0;
    for (const f of flags) {
      if (f & short) { const d = buf[p++]; v += (f & same) ? d : -d; }
      else if (!(f & same)) { v += i16(p); p += 2; }
      out.push(v);
    }
    return out;
  };
  const xs = read(2, 16), ys = read(4, 32);
  const fmt = (n) => Math.round(n * 10) / 10;
  let d = '', start = 0;
  for (const end of endPts) {
    const pts = [];
    for (let i = start; i <= end; i++) pts.push({ x: xs[i], y: -ys[i], on: !!(flags[i] & 1) });
    start = end + 1;
    if (!pts.length) continue;
    // Begin on an on-curve point (or the midpoint of two off-curve ones).
    let first = pts.findIndex((q) => q.on);
    let origin;
    if (first < 0) { origin = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 }; first = 0; }
    else origin = pts[first];
    d += `M${fmt(origin.x)} ${fmt(origin.y)}`;
    let ctrl = null;
    for (let k = 1; k <= pts.length; k++) {
      const q = pts[(first + k) % pts.length];
      if (q.on) {
        d += ctrl ? `Q${fmt(ctrl.x)} ${fmt(ctrl.y)} ${fmt(q.x)} ${fmt(q.y)}` : `L${fmt(q.x)} ${fmt(q.y)}`;
        ctrl = null;
      } else if (ctrl) {
        const mid = { x: (ctrl.x + q.x) / 2, y: (ctrl.y + q.y) / 2 };
        d += `Q${fmt(ctrl.x)} ${fmt(ctrl.y)} ${fmt(mid.x)} ${fmt(mid.y)}`;
        ctrl = q;
      } else ctrl = q;
    }
    if (ctrl) d += `Q${fmt(ctrl.x)} ${fmt(ctrl.y)} ${fmt(origin.x)} ${fmt(origin.y)}`;
    d += 'Z';
  }
  return d;
}

// The digits, plus the letters a team unit wears instead of a number
// (v0.713.3, founder: "K on a helmet for Kicker D for Defense. HC, P").
const GLYPHS = '0123456789KDHCP';
const digits = {};
for (const ch of GLYPHS) {
  const g = glyphIndex(ch.charCodeAt(0));
  digits[ch] = { d: glyphPath(g), adv: advanceOf(g) };
  if (!digits[ch].d) throw new Error(`glyph ${ch} drew nothing`);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const teams = Object.fromEntries(Object.entries(manifest.teams).map(([abbr, t]) => [abbr, t.number]));

const spec = {
  size: manifest.size,
  number: { ...manifest.number, fontFile: undefined, font: undefined },
  unitsPerEm, ascent,
  digits,
  teams,
};
delete spec.number.fontFile; delete spec.number.font;

writeFileSync(OUT, `// GENERATED by scripts/helmets/gen-digits.mjs from public/fonts/jersey-15.ttf and
// public/helmets/manifest.json. Do not hand-edit: re-run after gen-helmets.
// Jersey 15 (SIL OFL) digits and the team-unit letters (K D H C P) as SVG paths in font units (baseline y = 0, +y down),
// with the manifest's number size, colours and anchor. See data/helmets.ts.
export interface HelmetDigit { d: string; adv: number }
export interface HelmetNumberAnchor { x: number; y: number; align: 'left' | 'right' }
export interface HelmetSpec {
  size: number;
  number: { fontSize: number; strokeWidth: number; outlineWidth: number; outlineColor: string; anchor: { left: HelmetNumberAnchor; right: HelmetNumberAnchor } };
  unitsPerEm: number; ascent: number;
  digits: Record<string, HelmetDigit>;
  teams: Record<string, { fill: string; stroke: string }>;
}
export const HELMET_SPEC: HelmetSpec = ${JSON.stringify(spec, null, 2)};
`);
console.log(`helmetSpec.ts: ${Object.keys(digits).length} glyphs, ${Object.keys(teams).length} teams, ${unitsPerEm} upm`);
