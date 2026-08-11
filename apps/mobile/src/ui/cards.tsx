// The card table, natively.
//
// This is the presentation people actually recognise as the game, so it is
// worth being precise about what did and did not survive the port:
//
//   · Card BACKS are real .jpg art (public/cardbacks/*.jpg, bundled here under
//     assets/). They port exactly — an <Image> with the same file.
//   · HEADSHOTS are plain remote URLs from core's media.ts, so <Image
//     source={{uri}}> renders the same photo the web does. Falling back to the
//     team logo when a player has no headshot mirrors the web.
//   · The card FACE is a radial gradient in CSS (#FDF8E9 → #F4EDDA → #E2D5B6)
//     over an 11px dot pattern. RN has no radial gradient, but it CAN tile an
//     image — so the dot layer is a real 11x11 PNG (91 bytes, generated to the
//     same rgba(184,134,59,.12) at the same spacing) drawn with
//     resizeMode="repeat" over the stock colour. What is still missing is the
//     gradient's centre highlight; the texture itself is now faithful.
//   · Cards DEAL IN — a short rise + fade, staggered by slot index, matching the
//     web's ct-dealin. Built on RN's own Animated rather than Reanimated: this
//     is an entrance transition on mount, not a gesture or a frame-by-frame
//     effect, and it does not justify a native dependency. The nuke/flip
//     moments will.
import { type ReactNode } from 'react';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { headshot, teamLogo } from '@drip/core/data/media';
import { storeGet } from '@drip/core/platform';
import { MONO } from '../theme.native';

// True playing-card ratio (2.5:3.5). The web sets it as --ct-aspect so both
// cards in a slot pair match height; here the same number keeps the pair square
// with each other regardless of content.
export const CARD_ASPECT = 0.714;

const STOCK = '#F4EDDA';       // middle of the web's face gradient
const STOCK_TILE = require('../../assets/card-stock.png');
const STOCK_EDGE = '#D8C9A4';  // its darkest stop, used as the border
const INK = '#201C12';
const INK_DIM = '#6B6047';
export const FELT = '#0B1F1A'; // --ct-felt, the table under the cards

// The photographic decks. `emerald` (the web default) is a generated SVG
// pattern with no file to bundle, so it maps to playbook here — a real deck
// rather than a blank rectangle. Same key the web stores under, so a future
// profile sync carries one value.
const BACKS: Record<string, ReturnType<typeof require>> = {
  playbook: require('../../assets/cardbacks/playbook.jpg'),
  blitz: require('../../assets/cardbacks/blitz.jpg'),
  rivalry: require('../../assets/cardbacks/rivalry.jpg'),
  allstar: require('../../assets/cardbacks/allstar.jpg'),
  heritage: require('../../assets/cardbacks/heritage.jpg'),
  gilded: require('../../assets/cardbacks/gilded.jpg'),
  cosmic: require('../../assets/cardbacks/cosmic.jpg'),
  fireworks: require('../../assets/cardbacks/fireworks.jpg'),
  battalion: require('../../assets/cardbacks/battalion.jpg'),
};

export function cardBackArt() {
  const skin = storeGet('gc-cardskin') ?? '';
  return BACKS[skin] ?? BACKS.playbook;
}

/** A dealt player card: headshot, name, position/team, sealed metric. */
/** Deal-in: rise + fade, staggered by index. Native driver, so it runs on the
 *  UI thread and a slow JS tick cannot stutter it. */
function useDealIn(idx: number) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 260,
      delay: Math.min(idx, 8) * 70,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [idx, v]);
  return {
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };
}

export function CardFace({ slug, name, pos, team, metric, bank, accent, idx = 0, onPress, onRemove, footer }: {
  slug: string;
  name: string;
  pos: string;
  team?: string | null;
  metric?: string | null;
  /** Banked score, when the worker has published one for this slot. */
  bank?: number | null;
  /** Top edge colour — the side this card belongs to. */
  accent: string;
  /** Deal order — staggers the entrance. */
  idx?: number;
  onPress?: () => void;
  onRemove?: () => void;
  footer?: ReactNode;
}) {
  const photo = headshot(slug);
  const logo = teamLogo(team);
  const src = photo ?? logo;

  const deal = useDealIn(idx);

  return (
    <Animated.View style={[{ flex: 1 }, deal]}>
    <Pressable onPress={onPress} style={{ flex: 1 }}>
    <ImageBackground
      source={STOCK_TILE}
      resizeMode="repeat"
      imageStyle={{ borderRadius: 8 }}
      style={{
        aspectRatio: CARD_ASPECT, backgroundColor: STOCK,
        borderWidth: StyleSheet.hairlineWidth, borderColor: STOCK_EDGE,
        borderTopWidth: 3, borderTopColor: accent,
        borderRadius: 8, padding: 8, alignItems: 'center', justifyContent: 'space-between',
      }}
    >
      {!!onRemove && (
        <Pressable onPress={onRemove} hitSlop={10} style={{ position: 'absolute', top: 5, right: 6, zIndex: 2 }}>
          <Text style={{ fontSize: 13, color: '#C0392B', fontWeight: '700' }}>✕</Text>
        </Pressable>
      )}

      <View style={{ alignItems: 'center', gap: 4, marginTop: 6 }}>
        <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: '#EDE4CB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {src
            ? <Image source={{ uri: src }} style={{ width: 56, height: 56 }} resizeMode={photo ? 'cover' : 'contain'} />
            : <Text style={{ fontFamily: MONO, fontSize: 16, color: INK_DIM }}>{pos}</Text>}
        </View>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '800', color: INK, letterSpacing: 0.2 }}>{name}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 9.5, color: INK_DIM }}>{pos}{team ? ` · ${team}` : ''}</Text>
      </View>

      {metric ? (
        <View style={{ backgroundColor: '#3A2E14', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4, maxWidth: '100%' }}>
          <Text numberOfLines={1} style={{ fontSize: 11, fontWeight: '700', color: '#F2D79A' }}>{metric}</Text>
        </View>
      ) : (
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: '#B8863B', borderStyle: 'dashed', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: '#8A6A28' }}>SEAL A METRIC</Text>
        </View>
      )}

      {bank != null ? (
        <Text style={{ fontFamily: MONO, fontSize: 15, fontWeight: '800', color: INK }}>{bank}</Text>
      ) : footer ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>{footer}</View>
      ) : <View style={{ height: 2 }} />}
    </ImageBackground>
    </Pressable>
    </Animated.View>
  );
}

/** The opponent's face-down pick. Real deck art, so it reads as a card rather
 *  than an empty panel. */
export function CardBack({ label = 'SEALED', idx = 0 }: { label?: string; idx?: number }) {
  const deal = useDealIn(idx);
  return (
    <Animated.View style={[{ flex: 1, aspectRatio: CARD_ASPECT, borderRadius: 8, overflow: 'hidden', backgroundColor: '#1A2740' }, deal]}>
      <Image source={cardBackArt()} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      <View style={{ position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' }}>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: '#E7DCC2' }}>{label}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

/** An unfilled slot — dashed, on the felt, same size as a card. */
export function CardEmpty({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1, aspectRatio: CARD_ASPECT, borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(233,185,89,0.45)', borderStyle: 'dashed',
        alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.03)',
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1, color: 'rgba(233,185,89,0.85)' }}>{label}</Text>
    </Pressable>
  );
}
