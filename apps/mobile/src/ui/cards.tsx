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
//     web's ct-dealin. The reveal flip, idle wobble, nuke burst, hot glow and
//     score tick live in ./animations.tsx and are wired in below.
//
// All of it runs on RN's own Animated with the native driver. That was an open
// question — the note here used to say the nuke and flip moments would be what
// finally justified react-native-reanimated. Having built them: they don't.
// Every moment on this board is a declarative timing over opacity and transform,
// which is exactly what the native driver takes off the JS thread. Reanimated
// pays for itself on gestures and on animations that must read values back
// mid-flight; this board has neither. See the header of animations.tsx.
import { type ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { headshot, teamLogo } from '@drip/core/data/media';
import { storeGet, storeSet } from '@drip/core/platform';
import { MONO } from '../theme.native';
import { useFlipIn, useWobble, useShake, useScoreTick, NukeBurst, HotGlow } from './animations';

// True playing-card ratio (2.5:3.5). The web sets it as --ct-aspect so both
// cards in a slot pair match height; here the same number keeps the pair square
// with each other regardless of content.
export const CARD_ASPECT = 0.714;

/** SETUP-BOARD CARD SIZE — a player setting, not a constant.
 *
 *  A slot pair is two flex:1 cards, so left alone they take the full width:
 *  ~152pt each and ~213 tall on a phone, which is about one slot per screenful.
 *  Smaller fits a window at a glance; larger is nicer to look at and easier to
 *  hit. That is taste, not a correct answer, so it is in Settings next to the
 *  theme and the deck.
 *
 *  `w` caps the width (null = the old uncapped, full-width behaviour) and `s`
 *  scales what is inside it. Both are needed: everything in a card is a fixed
 *  pt size, so a 122pt card still holding a 60pt portrait and a 13pt name reads
 *  as a cramped big card rather than a small one.
 *
 *  Applies to the SETUP board only. The revealed cards in a live duel are the
 *  thing you are watching, and shrinking those to fit more of a board you have
 *  finished editing is the wrong trade — so only SetupRow opts in. */
export type CardSize = 'small' | 'medium' | 'large';
export const CARD_SIZES: { id: CardSize; name: string; w: number | null; s: number }[] = [
  { id: 'small', name: 'Small', w: 122, s: 0.82 },
  { id: 'medium', name: 'Medium', w: 146, s: 0.91 },
  { id: 'large', name: 'Large', w: null, s: 1 },
];

export const CARD_SIZE_KEY = 'gc-cardsize';

export function loadCardSize(): CardSize {
  const s = storeGet(CARD_SIZE_KEY) as CardSize | null;
  return CARD_SIZES.some((o) => o.id === s) ? (s as CardSize) : 'small';
}
export function saveCardSize(s: CardSize): void { storeSet(CARD_SIZE_KEY, s); }

/** Scale a fixed pt size by the chosen card's factor. k = 1 is a no-op, so
 *  the same expression serves the full-size card. */
const cs = (n: number, k: number) => Math.round(n * k * 10) / 10;

const sizeSpec = (size?: CardSize) => CARD_SIZES.find((o) => o.id === (size ?? loadCardSize())) ?? CARD_SIZES[0];

const STOCK = '#F4EDDA';       // middle of the web's face gradient
const STOCK_TILE = require('../../assets/card-stock.png');
const STOCK_EDGE = '#D8C9A4';  // its darkest stop, used as the border
const INK = '#201C12';
const INK_DIM = '#6B6047';
export const FELT = '#0B1F1A'; // --ct-felt, the table under the cards

// The photographic decks. Same ids and the same key the web stores under
// (`gc-cardskin`), so a future profile sync carries one value.
export type CardSkin = 'emerald' | 'playbook' | 'blitz' | 'rivalry' | 'allstar' | 'heritage' | 'gilded' | 'cosmic' | 'fireworks' | 'battalion';

/** Deck art by skin. `emerald` is deliberately absent: on the web it's a plain
 *  woven pattern with no file to bundle, so it has no entry and falls through to
 *  playbook below — a real deck rather than a blank rectangle. Exported so the
 *  settings picker shows the actual art you're choosing. */
export const CARD_BACKS: Partial<Record<CardSkin, ReturnType<typeof require>>> = {
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

export const CARD_SKIN_KEY = 'gc-cardskin';

export function loadCardSkin(): CardSkin {
  const s = storeGet(CARD_SKIN_KEY) as CardSkin | null;
  return s && SKINS.includes(s) ? s : 'playbook';
}
export function saveCardSkin(s: CardSkin): void { storeSet(CARD_SKIN_KEY, s); }

const SKINS: CardSkin[] = ['emerald', 'playbook', 'blitz', 'rivalry', 'allstar', 'heritage', 'gilded', 'cosmic', 'fireworks', 'battalion'];

export function cardBackArt() {
  return CARD_BACKS[loadCardSkin()] ?? CARD_BACKS.playbook;
}

/** A dealt player card: headshot, name, position/team, sealed metric. */
/** Deal-in: rise + fade, staggered by index. Native driver, so it runs on the
 *  UI thread and a slow JS tick cannot stutter it. */
function useDealIn(idx: number, play = true) {
  const v = useRef(new Animated.Value(play ? 0 : 1)).current;
  useEffect(() => {
    if (!play) return;
    Animated.timing(v, {
      toValue: 1,
      duration: 260,
      delay: Math.min(idx, 8) * 70,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [idx, play, v]);
  return {
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
  };
}


/** Whatever the variant hooks put in a transform list — typed off the hooks
 *  themselves so the shell can't drift from what they actually produce. */
type CardTx = ReturnType<typeof useFlipIn>['transform'][number]
  | ReturnType<typeof useShake>['transform'][number]
  | ReturnType<typeof useWobble>['transform'][number];

/** The card BOX — every slot on the board is one of these, whatever is drawn
 *  inside it.
 *
 *  It exists because the three variants kept disagreeing. They had the same
 *  flex and aspectRatio and still looked like different sizes, because the
 *  differences had moved into the TRANSFORMS: a face wobbled on an inner view
 *  while a back wobbled on its outer one, and an empty slot had no wobble and no
 *  deal at all — so it sat perfectly still beside a neighbour rotating 0.9° and
 *  drifting 2px, which reads as "these are different sizes" long before it reads
 *  as "one of them is moving".
 *
 *  One component owns the box, the entrance and the idle motion. A variant may
 *  add a transform (the reveal flip, the nuke shake) but cannot own the shape. */
function CardShell({ idx = 0, deal: playDeal = true, size, extra = [], style, children }: {
  idx?: number;
  /** False when another entrance is playing instead (the reveal flip). */
  deal?: boolean;
  /** Setup-board sizing. Absent = uncapped, the live-duel size. */
  size?: CardSize;
  /** Variant transforms. Prepended, because `perspective` has to lead the list. */
  extra?: CardTx[];
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const deal = useDealIn(idx, playDeal);
  const wob = useWobble(idx);
  return (
    <Animated.View
      style={[
        { flex: 1, aspectRatio: CARD_ASPECT },
        size ? { maxWidth: sizeSpec(size).w ?? undefined } : null,
        style,
        { opacity: deal.opacity, transform: [...extra, ...deal.transform, ...wob.transform] },
      ]}
    >
      {children}
    </Animated.View>
  );
}

export function CardFace({ slug, name, pos, team, metric, bank, accent, idx = 0, flip = false, hot = false, nuked = false, size, onPress, onRemove, footer }: {
  size?: CardSize;
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
  /** This card just turned face-up — play the reveal rather than the deal.
   *  Only true for a slot the board watched go from sealed to revealed. */
  flip?: boolean;
  /** Worker-published slot flags (matchup_state.slot_scores). */
  hot?: boolean;
  nuked?: boolean;
  onPress?: () => void;
  onRemove?: () => void;
  footer?: ReactNode;
}) {
  const photo = headshot(slug);
  const logo = teamLogo(team);
  const src = photo ?? logo;

  // Deal and flip are two ways of ARRIVING and a card does exactly one of them:
  // dealt onto the board on first paint, or turned face-up when its window
  // kicks off. Running both would read as two separate entrances for one event.
  //
  // Latched, because `flip` is true only for the render pass in which the board
  // noticed the reveal. Without the latch it would fall back to false a frame
  // later, restart the deal, and re-fade a card that is already on the table.
  const flipLatch = useRef(flip);
  if (flip) flipLatch.current = true;
  const doFlip = flipLatch.current;

  // One transform list rather than a wrapper view per effect. These touch
  // disjoint properties — perspective/rotateY from the flip, translateY from the
  // deal, rotateZ from the wobble, translateX from the shake — so concatenating
  // composes them correctly. Order matters only for perspective, which must lead.
  const flipIn = useFlipIn(doFlip);
  const shake = useShake(nuked);
  const tick = useScoreTick(bank);
  // 1 when no size was asked for — the live-duel card is unscaled.
  const sc = size ? sizeSpec(size).s : 1;

  // aspectRatio sits on the OUTERMOST view, the same place CardBack and
  // CardEmpty put it. It used to live on the ImageBackground below, which meant
  // a face was sized by its content chain while a back was sized by the rule —
  // so a filled slot and the sealed card beside it were laid out two different
  // ways and only agreed by luck. Same rule, same box.
  return (
    <CardShell idx={idx} deal={!doFlip} size={size} extra={[...flipIn.transform, ...shake.transform]}>
    <Pressable onPress={onPress} style={{ flex: 1 }}>
    <ImageBackground
      source={STOCK_TILE}
      resizeMode="repeat"
      imageStyle={{ borderRadius: 8 }}
      style={{
        flex: 1, backgroundColor: STOCK,
        borderWidth: StyleSheet.hairlineWidth, borderColor: STOCK_EDGE,
        borderTopWidth: 3, borderTopColor: accent,
        borderRadius: 8, padding: cs(8, sc), alignItems: 'center', justifyContent: 'space-between',
      }}
    >
      {!!onRemove && (
        <Pressable onPress={onRemove} hitSlop={10} style={{ position: 'absolute', top: 5, right: 6, zIndex: 2 }}>
          <Text style={{ fontSize: 13, color: '#C0392B', fontWeight: '700' }}>✕</Text>
        </Pressable>
      )}

      {/* Square art in a position-coloured frame, not a circle.
          This was the only portrait in the app still round: the web's card art
          (.ct-art) is a bordered rounded rectangle, and both the picker's mini
          cards and LiveCard already matched it. A circle also crops a headshot
          worse — it cuts the corners off exactly where the shoulders and helmet
          are, on images already framed head-and-shoulders. */}
      <View style={{ alignItems: 'center', gap: cs(4, sc), marginTop: cs(6, sc) }}>
        <View style={{ width: cs(60, sc), height: cs(60, sc), borderRadius: 7, borderWidth: 1.5, borderColor: accent, backgroundColor: '#EDE4CB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
          {src
            ? <Image source={{ uri: src }} style={{ width: '100%', height: '100%' }} resizeMode={photo ? 'cover' : 'contain'} />
            : <Text style={{ fontFamily: MONO, fontSize: cs(16, sc), color: INK_DIM }}>{pos}</Text>}
        </View>
        <Text numberOfLines={1} style={{ fontSize: cs(13, sc), fontWeight: '800', color: INK, letterSpacing: 0.2 }}>{name}</Text>
        <Text style={{ fontFamily: MONO, fontSize: cs(9.5, sc), color: INK_DIM }}>{pos}{team ? ` · ${team}` : ''}</Text>
      </View>

      {metric ? (
        <View style={{ backgroundColor: '#3A2E14', borderRadius: 5, paddingHorizontal: cs(8, sc), paddingVertical: cs(4, sc), maxWidth: '100%' }}>
          <Text numberOfLines={1} style={{ fontSize: cs(11, sc), fontWeight: '700', color: '#F2D79A' }}>{metric}</Text>
        </View>
      ) : (
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: '#B8863B', borderStyle: 'dashed', borderRadius: 5, paddingHorizontal: cs(8, sc), paddingVertical: cs(4, sc) }}>
          <Text style={{ fontFamily: MONO, fontSize: cs(9, sc), fontWeight: '700', color: '#8A6A28' }}>SEAL A METRIC</Text>
        </View>
      )}

      {bank != null ? (
        <Animated.Text style={[{ fontFamily: MONO, fontSize: cs(15, sc), fontWeight: '800', color: INK }, tick]}>{bank}</Animated.Text>
      ) : footer ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>{footer}</View>
      ) : <View style={{ height: 2 }} />}
    </ImageBackground>
    {/* Overlays sit outside the card face so they aren't clipped by its radius
        and don't inherit its padding. */}
    {hot && !nuked && <HotGlow color={accent} />}
    <NukeBurst play={nuked} />
    </Pressable>
    </CardShell>
  );
}

/** The opponent's face-down pick. Real deck art, so it reads as a card rather
 *  than an empty panel. */
export function CardBack({ label = 'SEALED', idx = 0, size, onPress, actionLabel }: {
  label?: string; idx?: number; size?: CardSize; onPress?: () => void; actionLabel?: string;
}) {
  return (
    <CardShell idx={idx} size={size} style={{ borderRadius: 8, overflow: 'hidden', backgroundColor: '#1A2740' }}>
      <Image source={cardBackArt()} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
      <Pressable onPress={onPress} disabled={!onPress} style={{ position: 'absolute', inset: 0, justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 8 }}>
        <View style={{ backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 3 }}>
          <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: '#E7DCC2' }}>{actionLabel ?? label}</Text>
        </View>
      </Pressable>
    </CardShell>
  );
}

/** An unfilled slot — dashed, on the felt, and the same box as a card because it
 *  is literally the same shell. It deals and breathes too: a static dashed
 *  rectangle beside a wobbling card is what made the pair look mismatched. */
export function CardEmpty({ label, idx = 0, size, onPress }: { label: string; idx?: number; size?: CardSize; onPress?: () => void }) {
  const sc = size ? sizeSpec(size).s : 1;
  return (
    <CardShell
      idx={idx}
      size={size}
      style={{
        borderRadius: 8,
        borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(233,185,89,0.45)', borderStyle: 'dashed',
        backgroundColor: 'rgba(255,255,255,0.03)',
      }}
    >
      <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 6 }}>
        <Text style={{ fontFamily: MONO, fontSize: cs(10, sc), fontWeight: '700', letterSpacing: 1, textAlign: 'center', color: 'rgba(233,185,89,0.85)' }}>{label}</Text>
      </Pressable>
    </CardShell>
  );
}
