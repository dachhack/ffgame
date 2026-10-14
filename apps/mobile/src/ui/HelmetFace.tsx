// HELMET MODE ON THE PHONE (v0.713.0). Founder: "a mode that replaces the head
// shots and team logos with the helmets … superimpose the player's jersey
// number in a sporty font over the lower corner of the helmet in a consistent
// spot."
//
// The same SVG the web draws (core helmetSvg: the helmet image with the number
// as Jersey 15 paths), through react-native-svg's SvgXml. No font loader, no
// native module, so no iPhone build. Every helmet faces left, so the number
// sits in the same lower-right corner everywhere.
import React from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { helmetMode, playerHelmet, helmetSvg } from '@drip/core/data/helmets';

/** A helmet with a number: a square at `size`, or filling its (square) parent
 *  when no size is given (the picker's and the deck cards' photo frames). */
export function HelmetFace({ team, num, size }: { team: string; num: number | null; size?: number }) {
  const xml = helmetSvg(team, num);
  if (!xml) return null;
  const dim = size ?? '100%';
  return (
    <View accessibilityRole="image" accessibilityLabel={num != null ? `${team} #${num}` : team} style={{ width: dim, height: dim }}>
      <SvgXml xml={xml} width="100%" height="100%" />
    </View>
  );
}

/** A player's helmet when helmet mode is on and his team is known, else null
 *  (the caller draws its headshot as before). */
export function playerHelmetFace(slug: string | null | undefined, size?: number, teamHint?: string | null): React.ReactElement | null {
  if (!helmetMode() || !slug || /^c-\d+$/.test(slug)) return null;
  const h = playerHelmet(slug, teamHint);
  return h ? <HelmetFace team={h.team} num={h.num} size={size} /> : null;
}
