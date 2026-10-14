// HELMET MODE (v0.713.0). Founder: "we want a mode that replaces the head shots
// and team logos with the helmets. For the headshots, superimpose the player's
// jersey number in a sporty font over the lower corner of the helmet in a
// consistent spot."
//
// A per-device switch (like the theme). When it is on:
//   • teamLogo() answers with the team's helmet (media.ts), so every logo in
//     the app becomes a helmet with no change at the call site;
//   • the headshot components draw helmetSvg(): the helmet with the player's
//     number at the manifest's anchor, in Jersey 15, as SVG paths
//     (helmetSpec.ts, generated from the font), so the phone needs no font
//     loader and no iPhone build;
//   • headshot() answers null, so any headshot spot not yet converted falls
//     back to its team logo, which is now a helmet.
// Mark-free mode gets the PLAIN helmets (abbreviation only, no nickname), the
// variant gen-helmets makes for it. College teams have no helmets: their logo
// rules (media.ts) are untouched.
import { storeGet, storeSet } from '../platform';
import { isMarkFree } from './markFree';
import { SITE_ORIGIN } from './invite';
import { HELMET_SPEC } from './helmetSpec';
import { normTeam } from './teamCodes';
import { PLAYER_BIO } from './playerBio';
import { teamFor } from './playerTeam';

const KEY = 'drip:helmets';
const listeners = new Set<() => void>();
let on: boolean | null = null;

/** Whether helmet mode is on for this device. */
export function helmetMode(): boolean {
  if (on === null) on = storeGet(KEY) === 'true';
  return on;
}
/** Turn helmet mode on or off on this device; listeners hear the change. */
export function setHelmetMode(next: boolean): void {
  storeSet(KEY, String(next));
  const changed = helmetMode() !== next;
  on = next;
  if (changed) for (const l of listeners) l();
}
/** Hear helmet mode change; returns the unsubscribe. */
export function onHelmetMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Which way a helmet faces: 'left' has the face mask on the left. */
export type HelmetFacing = 'left' | 'right';

/** The manifest's key for a team code (LA → LAR, WSH → WAS), or null. */
export function helmetTeam(team: string | null | undefined): string | null {
  if (!team) return null;
  const want = normTeam(team);
  for (const k of Object.keys(HELMET_SPEC.teams)) if (normTeam(k) === want) return k;
  return null;
}

/** The helmet image for a team, or null for a team without one. */
export function helmetUrl(team: string | null | undefined, facing: HelmetFacing = 'left'): string | null {
  const k = helmetTeam(team);
  if (!k) return null;
  return `${SITE_ORIGIN}/helmets/png/${k}-${facing}${isMarkFree() ? '-plain' : ''}.png`;
}

/** What a TEAM UNIT wears instead of a number (v0.713.3, founder: "K on a
 *  helmet for Kicker D for Defense. HC, P"). Unit slugs are `jax-k`,
 *  `hou-dst`, `kc-hc`, `kc-p` (slugMeta). */
const UNIT_LABEL: Record<string, string> = { k: 'K', dst: 'D', hc: 'HC', p: 'P' };
function teamUnit(slug: string): { team: string; label: string } | null {
  const m = /^([a-z]{2,3})-(k|dst|hc|p)$/.exec(slug);
  const team = m ? helmetTeam(m[1]) : null;
  return m && team ? { team, label: UNIT_LABEL[m[2]] } : null;
}

/** A player's helmet: his current team and what goes on it: his jersey
 *  number, or a team unit's letters (K, D, HC, P). `num` is null when there is
 *  nothing to print. */
export function playerHelmet(slug: string | null | undefined, teamHint?: string | null): { team: string; num: number | string | null } | null {
  const unit = slug ? teamUnit(slug) : null;
  if (unit) return { team: unit.team, num: unit.label };
  const team = helmetTeam((slug && teamFor(slug)) || teamHint);
  if (!team) return null;
  const num = slug ? PLAYER_BIO[slug]?.num : undefined;
  return { team, num: typeof num === 'number' && num >= 0 && num <= 99 ? num : null };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** The number's SVG paths, in the helmet's own 0..size coordinates: the
 *  manifest's two layers (dark outline under the team stroke, the fill on top),
 *  right-aligned at the anchor for a left-facing helmet, left-aligned for a
 *  right-facing one. Empty for no number. */
/** How much bigger than the manifest's size the number is drawn (v0.713.2,
 *  founder, from the phone: "Looks great. Let's try it with bigger numbers").
 *  The manifest sized it to fit "88" in the decal zone at 256px; at the 30–54px
 *  the app actually draws, it wants to be bolder. It stays pinned to the same
 *  lower corner (the anchor), so it grows up and in over the shell. */
export const HELMET_NUMBER_SCALE = 1.45;

export function helmetNumberSvg(team: string, num: number | string | null, facing: HelmetFacing = 'left', scaleBy = HELMET_NUMBER_SCALE): string {
  if (num == null || num === '') return '';
  const S = HELMET_SPEC;
  const k = helmetTeam(team);
  const colors = (k && S.teams[k]) || { fill: '#FFFFFF', stroke: '#10131A' };
  const a = S.number.anchor[facing];
  const fs = S.number.fontSize * S.size * scaleBy; // font size in helmet px
  const scale = fs / S.unitsPerEm;
  // Only glyphs the spec carries (digits, K D H C P); anything else is skipped.
  const chars = String(num).toUpperCase().split('').filter((c) => S.digits[c]);
  if (!chars.length) return '';
  const width = chars.reduce((w, c) => w + S.digits[c].adv, 0) * scale;
  const x0 = a.x * S.size - (a.align === 'right' ? width : 0);
  const y = a.y * S.size;
  let pen = 0;
  const glyphs = chars.map((c) => {
    const g = S.digits[c];
    const at = `translate(${(x0 + pen * scale).toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})`;
    pen += g.adv;
    return { at, d: g.d };
  });
  // Three plain layers, no paint-order (react-native-svg doesn't support it):
  // the dark outline's stroke, the team stroke over it, then the fill. That is
  // what the manifest's two paint-order layers draw. Stroke widths are in
  // helmet px; the glyph is scaled, so divide back out.
  const stroke = (color: string, w: number) => glyphs.map((g) =>
    `<path transform="${g.at}" d="${g.d}" fill="none" stroke="${esc(color)}" stroke-width="${((w * fs) / scale).toFixed(1)}" stroke-linejoin="round"/>`).join('');
  const fill = glyphs.map((g) => `<path transform="${g.at}" d="${g.d}" fill="${esc(colors.fill)}"/>`).join('');
  return stroke(S.number.outlineColor, S.number.outlineWidth) + stroke(colors.stroke, S.number.strokeWidth) + fill;
}

/** A whole player helmet as one SVG document: the helmet image with the
 *  number over it. Web renders it inline; the phone through SvgXml. */
export function helmetSvg(team: string, num: number | string | null, facing: HelmetFacing = 'left'): string | null {
  const url = helmetUrl(team, facing);
  if (!url) return null;
  const S = HELMET_SPEC.size;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${S} ${S}" width="100%" height="100%">`
    + `<image href="${esc(url)}" xlink:href="${esc(url)}" x="0" y="0" width="${S}" height="${S}"/>`
    + helmetNumberSvg(team, num, facing)
    + `</svg>`;
}
