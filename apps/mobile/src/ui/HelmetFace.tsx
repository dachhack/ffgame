// HELMET MODE ON THE PHONE (v0.713.0). Founder: "a mode that replaces the head
// shots and team logos with the helmets … superimpose the player's jersey
// number in a sporty font over the lower corner of the helmet in a consistent
// spot."
//
// v0.713.4: yours face right, the opponent's face left ("Can we have helmets
// for the user face right and opposing helmets face left?"). The number rides
// the back of the shell either way: lower left facing right, lower right
// facing left.
//
// The same SVG the web draws (core helmetSvg: the helmet image with the number
// as Jersey 15 paths), through react-native-svg's SvgXml. No font loader, no
// native module, so no iPhone build.
import React from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { helmetMode, playerHelmet, helmetSvg, helmetFacing, type HelmetFacing } from '@drip/core/data/helmets';

/** A helmet with a number: a square at `size`, or filling its (square) parent
 *  when no size is given (the picker's and the deck cards' photo frames). */
export function HelmetFace({ team, num, size, facing }: { team: string; num: number | string | null; size?: number; facing?: HelmetFacing }) {
  const xml = helmetSvg(team, num, facing);
  if (!xml) return null;
  const dim = size ?? '100%';
  return (
    <View accessibilityRole="image" accessibilityLabel={num != null ? `${team} #${num}` : team} style={{ width: dim, height: dim }}>
      <SvgXml xml={xml} width="100%" height="100%" />
    </View>
  );
}

/** How big a helmet draws in a spot sized for a round photo (v0.713.5): 1.5×,
 *  because the helmet is a side view with air around it, not a cropped face. */
export const helmetSize = (photo: number) => Math.round(photo * 1.5);

/** A player's helmet when helmet mode is on and his team is known, else null
 *  (the caller draws its headshot as before). */
export function playerHelmetFace(slug: string | null | undefined, size?: number, teamHint?: string | null, opponent?: boolean): React.ReactElement | null {
  if (!helmetMode() || !slug || /^c-\d+$/.test(slug)) return null;
  const h = playerHelmet(slug, teamHint);
  return h ? <HelmetFace team={h.team} num={h.num} size={size} facing={helmetFacing(opponent)} /> : null;
}
