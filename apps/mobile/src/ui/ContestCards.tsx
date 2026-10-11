// THE CARD TABLE, native (v0.677.0) — the phone's deck for a contest week.
// The web has the card-table kit (src/app/cardTable.tsx); the phone had no
// cards at all, so this is its own: a card FACE (headshot or crest, the suit
// chip, the spot, the points once the worker scores him) and a card BACK
// (the emerald lattice and the ◈ gem), and a FlipCard that turns from back
// to face when told to — the reveal at kickoff. The turn is a real 3D flip
// (rotateY with backface hidden), played on mount whenever `flipped` starts
// true, so a return to the matchup screen replays every turn.
import { useEffect, useRef } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { headshot, teamLogo } from '@drip/core/data/media';
import { useTheme, MONO, fs } from '../theme.native';
import { useCardSkin, CARD_BACKS, SKIN_FELT } from './cards';

export const CARD_W = 96;
export const CARD_H = 138;
const GOLD = '#E9B959';
const FELT_DARK = '#083A27';
const STOCK = '#F7F0DC';
const INK = '#201C12';
const SUIT: Record<string, string> = { QB: '#B23A48', RB: '#2C6E49', WR: '#2B5EA7', TE: '#8A5A2B', K: '#6B4E9C', DEF: '#444', DST: '#444', HC: '#9A7B16' };

/** The felt: a dark green table with a soft vignette, behind any content. */
export function FeltTable({ children }: { children: React.ReactNode }) {
  // THE DECK (v0.680.0): the felt takes the chosen deck's colour.
  const felt = SKIN_FELT[useCardSkin()];
  return (
    <View style={{ backgroundColor: felt, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: '#000', overflow: 'hidden' }}>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: 0.25, borderRadius: 14, transform: [{ scale: 1.2 }] }]} />
      {children}
    </View>
  );
}

export function CardBack({ seed }: { seed: string }) {
  // a touch of per-card lean so the column doesn't sit in lockstep
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const lean = ((h % 5) - 2) * 0.6;
  // THE DECK (v0.680.0): the back is the deck chosen under ⚙ → Cards, the
  // same art drip mode's sealed cards show, full-bleed under the border. A
  // deck with no bundled art (emerald) is the vector lattice below.
  const skin = useCardSkin();
  const art = CARD_BACKS[skin];
  if (art) {
    return (
      <View style={{ width: CARD_W, height: CARD_H, borderRadius: 10, backgroundColor: SKIN_FELT[skin], borderWidth: 2, borderColor: '#000', overflow: 'hidden', transform: [{ rotateZ: `${lean}deg` }] }}>
        <Image source={art} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      </View>
    );
  }
  return (
    <View style={{ width: CARD_W, height: CARD_H, borderRadius: 10, backgroundColor: '#0F6B47', borderWidth: 2, borderColor: '#000', overflow: 'hidden', transform: [{ rotateZ: `${lean}deg` }], alignItems: 'center', justifyContent: 'center' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, borderRadius: 7, borderWidth: 1.5, borderColor: GOLD, opacity: 0.8 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 9, left: 9, right: 9, bottom: 9, borderRadius: 5, borderWidth: 0.7, borderColor: GOLD, opacity: 0.45 }} />
      {/* the lattice: four rows of diamonds */}
      {[0, 1, 2, 3, 4].map((r) => (
        <View key={r} pointerEvents="none" style={{ position: 'absolute', top: 14 + r * 24, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-around', opacity: 0.35 }}>
          {[0, 1, 2, 3].map((c) => <View key={c} style={{ width: 9, height: 9, borderWidth: 0.8, borderColor: GOLD, transform: [{ rotateZ: '45deg' }] }} />)}
        </View>
      ))}
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: FELT_DARK, borderWidth: 1.5, borderColor: GOLD, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: GOLD, fontSize: 22, fontWeight: '800' }}>◈</Text>
      </View>
    </View>
  );
}

export function CardFace({ slug, name, pos, team, slot, points, mine, locked }: {
  slug: string; name: string; pos: string; team?: string | null; slot?: string; points?: number | null;
  /** Your own card (gold trim) or theirs (red). */ mine?: boolean;
  /** His game has kicked off (the card is set). */ locked?: boolean;
}) {
  const uri = headshot(slug) ?? teamLogo(team ?? null, { slug });
  const suit = SUIT[pos.toUpperCase()] ?? '#555';
  const trim = mine ? GOLD : '#C8323E';
  return (
    <View style={{ width: CARD_W, height: CARD_H, borderRadius: 10, backgroundColor: STOCK, borderWidth: 2, borderColor: '#000', overflow: 'hidden', padding: 5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '800', color: '#fff', backgroundColor: suit, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, overflow: 'hidden' }}>{pos === 'DEF' ? 'DST' : pos}</Text>
        {slot ? <Text style={{ fontFamily: MONO, fontSize: fs(7), color: INK, opacity: 0.7, letterSpacing: 0.6 }}>{slot.toUpperCase()}</Text> : null}
      </View>
      <View style={{ flex: 1, marginTop: 4, borderRadius: 6, borderWidth: 1.2, borderColor: suit, backgroundColor: '#E8E0C8', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {uri
          ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode={headshot(slug) ? 'cover' : 'contain'} />
          : <Text style={{ fontSize: 22, fontWeight: '800', color: suit }}>{name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}</Text>}
        {locked ? <View style={{ position: 'absolute', bottom: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 3, paddingHorizontal: 3 }}><Text style={{ fontSize: 8, color: '#fff' }}>🔒</Text></View> : null}
      </View>
      <Text numberOfLines={1} style={{ marginTop: 3, fontSize: fs(9.5), fontWeight: '700', color: INK }}>{name}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(7.5), color: INK, opacity: 0.65 }}>{team ?? ''}</Text>
        <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '800', color: trim === GOLD ? '#8A6A12' : trim }}>{points != null ? points.toFixed(1) : ''}</Text>
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', top: 1, left: 1, right: 1, bottom: 1, borderRadius: 8, borderWidth: 1, borderColor: trim, opacity: 0.7 }} />
    </View>
  );
}

/** Back on one side, face on the other; `flipped` true shows the face. A card
 *  that starts flipped turns over on mount (the reveal replays each visit),
 *  staggered by `idx`; one that becomes flipped while on screen turns then. */
export function FlipCard({ flipped, idx = 0, back, face }: { flipped: boolean; idx?: number; back: React.ReactNode; face: React.ReactNode }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // The JS driver, not the native one: the first live deal (v0.679.0) left
    // every card on its back on a real phone — the native-driven turn never
    // landed. Nine cards for half a second is nothing for the bridge, and the
    // end state is pinned whether the timing finishes or is cut short.
    const to = flipped ? 1 : 0;
    const anim = Animated.timing(v, { toValue: to, duration: 550, delay: flipped ? idx * 90 : 0, useNativeDriver: false });
    anim.start(() => v.setValue(to));
    const pin = setTimeout(() => v.setValue(to), 550 + idx * 90 + 400);
    return () => { clearTimeout(pin); anim.stop(); v.setValue(to); };
  }, [flipped, idx, v]);
  const backRot = v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const faceRot = v.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  return (
    <View style={{ width: CARD_W, height: CARD_H }}>
      <Animated.View style={[StyleSheet.absoluteFill, { backfaceVisibility: 'hidden', transform: [{ perspective: 700 }, { rotateY: backRot }] }]}>{back}</Animated.View>
      <Animated.View style={[StyleSheet.absoluteFill, { backfaceVisibility: 'hidden', transform: [{ perspective: 700 }, { rotateY: faceRot }] }]}>{face}</Animated.View>
    </View>
  );
}

/** An empty spot on the table. */
export function EmptyCard({ label }: { label: string }) {
  const t = useTheme();
  return (
    <View style={{ width: CARD_W, height: CARD_H, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(7.5), color: 'rgba(255,255,255,0.6)', letterSpacing: 1 }}>{`${label.toUpperCase()} · EMPTY`}</Text>
      <Text style={{ color: t.faint, fontSize: 1 }}> </Text>
    </View>
  );
}
