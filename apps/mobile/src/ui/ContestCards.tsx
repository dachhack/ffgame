// THE CARD TABLE, native (v0.677.0) — the phone's deck for a contest week.
// The web has the card-table kit (src/app/cardTable.tsx); the phone had no
// cards at all, so this is its own: a card FACE (headshot or crest, the suit
// chip, the spot, the points once the worker scores him) and a card BACK
// (the emerald lattice and the ◈ gem), and a FlipCard that turns from back
// to face when told to — the reveal at kickoff. The turn is a real 3D flip
// (rotateY with backface hidden), played on mount whenever `flipped` starts
// true, so a return to the matchup screen replays every turn.
import { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { headshot, teamLogo } from '@drip/core/data/media';
import { isGhostSlug } from '@drip/core/data/ghostCard';
import { useTheme, MONO, fs, mix, alpha, fsTight } from '../theme.native';
import { useCardSkin, CARD_BACKS, SKIN_FELT } from './cards';
import { playerHelmetFace } from './HelmetFace';

export const CARD_W = 96;
export const CARD_H = 138;
const GOLD = '#E9B959';
const FELT_DARK = '#083A27';
const STOCK = '#F7F0DC';
const INK = '#201C12';
const SUIT: Record<string, string> = { QB: '#B23A48', RB: '#2C6E49', WR: '#2B5EA7', TE: '#8A5A2B', K: '#6B4E9C', DEF: '#444', DST: '#444', HC: '#9A7B16' };

/** The felt: a dark green table with a soft vignette, behind any content. */
/** Relative luminance of a #rrggbb; the light themes' grounds sit above 0.5. */
const lum = (c: string) => { const m = /^#([0-9a-f]{6})$/i.exec(c.trim()); if (!m) return 0; const n = parseInt(m[1], 16); return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
export function FeltTable({ children }: { children: React.ReactNode }) {
  // THE DECK (v0.680.0): the felt takes the chosen deck's colour — and THE
  // COLOUR THEME (v0.682.1): the web kit's ground, ported. Dark themes: the
  // deck's felt 80% over the theme's ground; the light themes (daylight,
  // arctic): the ground lifted toward white over the felt. Flat (v0.682.2,
  // founder: "let's not do the gradient background") — no accent glows.
  const t = useTheme();
  const base = SKIN_FELT[useCardSkin()];
  const light = lum(t.bg) > 0.5;
  const ground = light ? mix(mix(t.bg, 72, '#FFFFFF'), 90, base) : mix(base, 80, t.bg);
  return (
    <View style={{ backgroundColor: ground, borderRadius: 14, padding: 10, borderWidth: 1, borderColor: light ? 'rgba(0,0,0,0.15)' : '#000', overflow: 'hidden' }}>
      {children}
    </View>
  );
}

/** THE SPOT'S NUMBER, BEFORE THE PICK (v0.699.2, founder: "put the spot target chip on the card in my team ... before
 *  selections happen"): the tie-breaker chip rides the back too, top-right, so the number is there as you choose. */
function BackChip({ chip, onChip }: { chip?: string | null; onChip?: () => void }) {
  if (chip == null) return null;
  return (
    <Pressable hitSlop={8} onPress={onChip} style={{ position: 'absolute', top: 6, right: 6, zIndex: 3, backgroundColor: '#2A2010', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '800', color: '#FFD86B' }}>{chip}</Text>
    </Pressable>
  );
}

export function CardBack({ seed, chip, onChip }: { seed: string;
  /** the tie-breaker's number on an open spot (v0.699.2); a tap explains it */ chip?: string | null; onChip?: () => void }) {
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
        <BackChip chip={chip} onChip={onChip} />
      </View>
    );
  }
  return (
    <View style={{ width: CARD_W, height: CARD_H, borderRadius: 10, backgroundColor: '#0F6B47', borderWidth: 2, borderColor: '#000', overflow: 'hidden', transform: [{ rotateZ: `${lean}deg` }], alignItems: 'center', justifyContent: 'center' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 5, left: 5, right: 5, bottom: 5, borderRadius: 7, borderWidth: 1.5, borderColor: GOLD, opacity: 0.8 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: 9, left: 9, right: 9, bottom: 9, borderRadius: 5, borderWidth: 0.7, borderColor: GOLD, opacity: 0.45 }} />
      <BackChip chip={chip} onChip={onChip} />
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

export function CardFace({ slug, name, pos, team, slot, points, mine, locked, foot, chip, onChip, chipTone = 'gold', badge }: {
  slug: string; name: string; pos: string; team?: string | null; slot?: string; points?: number | null;
  /** Bottom-right when there is no score yet: the builder's price (v0.681.0). */ foot?: string;
  /** THE TIE-BREAKER CHIP (v0.682.2): the spot's number, top-right, in place of the slot label; a tap explains it. */ chip?: string | null; onChip?: () => void;
  /** 'warn' (v0.685.2): the chip is a penalty (the dart's no-show zero), red. */ chipTone?: 'gold' | 'warn';
  /** THE PLAYS (v0.687.0): the play on this spot, as its icon beside the position. */ badge?: string;
  /** Your own card (gold trim) or theirs (red). */ mine?: boolean;
  /** His game has kicked off (the card is set). */ locked?: boolean;
}) {
  const uri = headshot(slug) ?? teamLogo(team ?? null, { slug });
  const suit = SUIT[pos.toUpperCase()] ?? '#555';
  const trim = mine ? GOLD : '#C8323E';
  return (
    <View style={{ width: CARD_W, height: CARD_H, borderRadius: 10, backgroundColor: STOCK, borderWidth: 2, borderColor: '#000', overflow: 'hidden', padding: 5 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
          <Text style={{ fontFamily: MONO, fontSize: fs(8), fontWeight: '800', color: '#fff', backgroundColor: suit, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 3, overflow: 'hidden' }}>{pos === 'DEF' ? 'DST' : pos}</Text>
          {badge ? <Text style={{ fontSize: fs(10) }}>{badge}</Text> : null}
        </View>
        {chip != null
          ? <Pressable hitSlop={8} onPress={onChip} style={{ backgroundColor: chipTone === 'warn' ? '#8E2430' : '#2A2010', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }}><Text style={{ fontFamily: MONO, fontSize: fs(9), fontWeight: '800', color: chipTone === 'warn' ? '#fff' : '#FFD86B' }}>{chip}</Text></Pressable>
          : slot ? <Text style={{ fontFamily: MONO, fontSize: fs(7), color: INK, opacity: 0.7, letterSpacing: 0.6 }}>{slot.toUpperCase()}</Text> : null}
      </View>
      <View style={{ flex: 1, marginTop: 4, borderRadius: 6, borderWidth: 1.2, borderColor: suit, backgroundColor: '#E8E0C8', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
        {isGhostSlug(slug)
          ? <View style={{ width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', backgroundColor: '#1A2B33' }}><Text style={{ fontSize: 30 }}>👻</Text></View>
          // HELMET MODE (v0.713.4, founder: "Numbers on helmets for weekly
          // contest leagues please"): the numbered helmet, yours facing right,
          // theirs facing left.
          : playerHelmetFace(slug, undefined, team, !mine) ?? (uri
          ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode={headshot(slug) ? 'cover' : 'contain'} />
          : <Text style={{ fontSize: 22, fontWeight: '800', color: suit }}>{name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()}</Text>)}
        {locked ? <View style={{ position: 'absolute', bottom: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 3, paddingHorizontal: 3 }}><Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ fontSize: fsTight(8), color: '#fff' }}>🔒</Text></View> : null}
      </View>
      <Text numberOfLines={1} style={{ marginTop: 3, fontSize: fs(9.5), fontWeight: '700', color: INK }}>{name}</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ fontFamily: MONO, fontSize: fs(7.5), color: INK, opacity: 0.65 }}>{team ?? ''}</Text>
        <Text style={{ fontFamily: MONO, fontSize: fs(11), fontWeight: '800', color: trim === GOLD ? '#8A6A12' : trim }}>{points != null ? points.toFixed(1) : foot ?? ''}</Text>
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
export function EmptyCard({ label, chip, chipTone = 'warn', onChip }: { label: string;
  /** THE PENALTY (v0.695.0): the dart's no-show charge on an empty spot, red, top-right — or, 'gold' (v0.699.2), the
   *  tie-breaker's number on the spot before a pick, a tap explaining it. */ chip?: string; chipTone?: 'gold' | 'warn'; onChip?: () => void }) {
  const t = useTheme();
  const warn = !!chip && chipTone === 'warn';
  return (
    <View style={{ width: CARD_W, height: CARD_H, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: warn ? alpha(t.warn, 60) : alpha(t.text, 30), alignItems: 'center', justifyContent: 'center' }}>
      {!!chip && (warn
        ? <Text style={{ position: 'absolute', top: 6, right: 6, fontFamily: MONO, fontSize: fs(9), fontWeight: '800', color: t.warn }}>{chip}</Text>
        : <BackChip chip={chip} onChip={onChip} />)}
      <Text style={{ fontFamily: MONO, fontSize: fs(7.5), color: alpha(t.text, 60), letterSpacing: 1 }}>{`${label.toUpperCase()} · EMPTY`}</Text>
      <Text style={{ color: t.faint, fontSize: 1 }}> </Text>
    </View>
  );
}
