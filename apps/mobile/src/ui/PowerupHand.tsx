// Your hand — owned power-ups FANNED along the bottom of the board.
//
// Ported from the web's PowerupHand (cardTable.tsx), fan and all. The hand IS
// your inventory: you buy cards in the shop, they land here, and arming one
// spends the card rather than coin. That ordering matters — see the note on
// arming in LivePicks — because coin is charged once, at purchase.
//
// This used to be a horizontal strip of flat tiles, on the reasoning that a
// phone is too narrow to fan without overlapping cards into unhittable slivers.
// That reasoning was wrong about the arithmetic: at six cards the fan spreads
// 56px of an 78px card, so every card keeps a target wider than a fingertip,
// and the web's own overflow tile handles the case where it wouldn't. What the
// strip lost was the thing that makes a hand read as a hand — cards overlapping
// at a rake, one lifting out when you touch it.
//
// So: same geometry as the web. Cards peek up from the bottom edge, rotated
// about the centre; tapping one straightens it, lifts it, and opens its tip
// above with the ARM / DISARM action. At most MAX_HAND fan, the rest sit behind
// a "+N MORE" tile that opens the full list.
import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { powerupById } from '@drip/core/data/powerups';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Overlay, sheetBodyMax } from './Overlay';

export interface HandCard {
  id: string;
  qty: number;
  /** False when this card can't be played right now (wrong phase, capacity). */
  usable: boolean;
  /** Why not, or when it can be — shown on the tip. */
  note?: string;
  armed?: boolean;
}

const CARD_W = 78;
const CARD_H = 106;
const MAX_HAND = 6;
/** Card stock: the web's dark leather. RN has no radial-gradient, so this is the
 *  gradient's midpoint as a flat fill — the dot texture reads as noise at 78px
 *  anyway, and the black rim + hard shadow are what actually sell it. */
const STOCK = '#2A2115';
const STOCK_EDGE = '#000';
const INK = '#EFE4C8';

export function PowerupHand({ cards, busyId, onArm, onDisarm }: {
  cards: HandCard[];
  busyId?: string | null;
  onArm: (id: string) => void;
  onDisarm: (id: string) => void;
}) {
  const t = useTheme();
  // App.tsx's SafeAreaView deliberately omits the bottom edge so the hand can sit
  // against the screen edge — which makes clearing the home indicator this
  // component's job, exactly as env(safe-area-inset-bottom) is on the web.
  const insets = useSafeAreaInsets();
  const [raised, setRaised] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rise, { toValue: cards.length ? 1 : 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [cards.length, rise]);

  // A card that leaves the hand (armed away, consumed) must not stay raised —
  // the tip would hang over the board with nothing under it.
  useEffect(() => {
    if (raised && !cards.some((c) => c.id === raised)) setRaised(null);
  }, [cards, raised]);

  if (!cards.length) return null;

  const overflow = cards.length > MAX_HAND;
  // Keep the raised card visible even when it would fall into the overflow.
  let shown = overflow ? cards.slice(0, MAX_HAND - 1) : cards;
  if (overflow && raised && !shown.some((c) => c.id === raised)) {
    const rc = cards.find((c) => c.id === raised);
    if (rc) shown = [...shown.slice(0, MAX_HAND - 2), rc];
  }
  const hidden = cards.length - shown.length;
  const n = shown.length + (overflow ? 1 : 0);
  // Fan width is bounded by the SCREEN, not a fixed 320 like the web — a phone
  // is narrower than the web's hand box and a fixed spread would push the outer
  // cards off the edge.
  const room = Math.max(0, Dimensions.get('window').width - CARD_W - 24);
  const spread = n > 1 ? Math.min(56, room / (n - 1)) : 0;
  const total = cards.reduce((s, c) => s + c.qty, 0);

  const tip = raised ? cards.find((c) => c.id === raised) ?? null : null;
  const tipPu = tip ? powerupById(tip.id) : null;

  return (
    <>
      {/* box-none: the board keeps scrolling between and behind the cards —
          only the cards themselves take touches. */}
      <Animated.View
        pointerEvents="box-none"
        style={{
          position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 8, height: CARD_H + 40,
          opacity: rise,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) }],
        }}
      >
        <Mono size={8.5} tone="faint" track={0.24} style={{ textAlign: 'center', marginBottom: 4 }}>
          YOUR HAND · {total} CARD{total === 1 ? '' : 'S'}
        </Mono>

        {shown.map((c, i) => {
          const p = powerupById(c.id);
          const off = i - (n - 1) / 2;
          const isRaised = raised === c.id;
          const dim = !c.usable && !c.armed;
          return (
            <Pressable
              key={c.id}
              onPress={() => setRaised((r) => (r === c.id ? null : c.id))}
              style={{
                position: 'absolute', bottom: 0, left: '50%',
                width: CARD_W, height: CARD_H,
                marginLeft: -CARD_W / 2,
                // Raised: straighten, lift clear of its neighbours. Unraised:
                // rake from the centre and sink so only the top two-thirds show.
                transform: isRaised
                  ? [{ translateX: off * spread }, { translateY: -14 }, { rotate: '0deg' }, { scale: 1.07 }]
                  : [{ translateX: off * spread }, { translateY: 26 }, { rotate: `${off * 4}deg` }],
                zIndex: isRaised ? 60 : 10 + i,
                elevation: isRaised ? 60 : 10 + i,
                opacity: busyId === c.id ? 0.5 : dim && !isRaised ? 0.55 : 1,
              }}
            >
              <View
                style={{
                  flex: 1, borderRadius: 9, borderWidth: 2, borderColor: STOCK_EDGE,
                  backgroundColor: c.armed ? t.you : STOCK,
                  padding: 6, alignItems: 'center',
                  // The web's `box-shadow: 0 5px 0` — a hard offset, not a blur.
                  shadowColor: '#000', shadowOpacity: 0.7, shadowRadius: 0,
                  shadowOffset: { width: 0, height: 4 },
                }}
              >
                <Text style={{ fontSize: 19, marginTop: 2 }}>{p?.icon ?? '◈'}</Text>
                <Text
                  numberOfLines={3}
                  style={{
                    fontFamily: MONO, fontSize: 8.6, fontWeight: '700', textAlign: 'center',
                    marginTop: 5, letterSpacing: 0.4, color: c.armed ? t.onAccent : INK,
                  }}
                >
                  {(p?.name ?? c.id).toUpperCase()}
                </Text>
                <View style={{ flex: 1 }} />
                {c.armed && <Mono size={6.6} weight="700" track={0.08} style={{ color: t.onAccent }}>ARMED</Mono>}
              </View>
              {c.qty > 1 && (
                <View style={{ position: 'absolute', top: -7, right: -6, backgroundColor: '#E9B959', borderWidth: 2, borderColor: '#000', borderRadius: 999, paddingHorizontal: 5, paddingVertical: 1 }}>
                  <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '800', color: '#241A08' }}>×{c.qty}</Text>
                </View>
              )}
            </Pressable>
          );
        })}

        {overflow && (
          <Pressable
            onPress={() => setListOpen(true)}
            style={{
              position: 'absolute', bottom: 0, left: '50%',
              width: CARD_W, height: CARD_H, marginLeft: -CARD_W / 2,
              transform: [
                { translateX: (shown.length - (n - 1) / 2) * spread },
                { translateY: 26 },
                { rotate: `${(shown.length - (n - 1) / 2) * 4}deg` },
              ],
              zIndex: 10 + shown.length, elevation: 10 + shown.length,
            }}
          >
            <View style={{ flex: 1, borderRadius: 9, borderWidth: 2, borderStyle: 'dashed', borderColor: STOCK_EDGE, backgroundColor: '#1C160C', padding: 6, alignItems: 'center' }}>
              <Text style={{ fontSize: 19, marginTop: 8 }}>🃏</Text>
              <Text style={{ fontFamily: MONO, fontSize: 8.6, fontWeight: '700', color: INK, marginTop: 5 }}>+{hidden} MORE</Text>
              <View style={{ flex: 1 }} />
              <Mono size={6.6} tone="faint" track={0.08}>TAP FOR ALL</Mono>
            </View>
          </Pressable>
        )}
      </Animated.View>

      {/* The tip. The web anchors it to the card; here it is anchored to the
          hand so an outer card's tip can't run off the screen edge. */}
      <Overlay
        visible={!!tip}
        title={tipPu?.name ?? ''}
        subtitle={tipPu ? (tipPu.kind === 'metric' ? 'METRIC · 1 WK' : tipPu.timing === 'pre' ? 'PRE-MATCH' : 'REAL-TIME') : undefined}
        titleLeft={<Text style={{ fontSize: 28 }}>{tipPu?.icon ?? '◈'}</Text>}
        onClose={() => setRaised(null)}
        footer={tip ? (
          tip.armed ? (
            <Pressable
              onPress={() => { onDisarm(tip.id); setRaised(null); }}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingVertical: 13, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: t.dim }}>DISARM · RETURN TO HAND</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => { if (tip.usable) { onArm(tip.id); setRaised(null); } }}
              disabled={!tip.usable}
              style={{ backgroundColor: tip.usable ? t.you : t.sh, borderRadius: 8, paddingVertical: 14, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: tip.usable ? t.onAccent : t.faint }}>
                {tip.usable ? 'ARM' : 'CAN’T PLAY YET'}
              </Text>
            </Pressable>
          )
        ) : undefined}
      >
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
          <Text style={{ fontSize: 13, color: t.text, lineHeight: 20 }}>{tipPu?.blurb}</Text>
          {!!tip?.note && <Mono size={10} tone="warn">{tip.note}</Mono>}
          {!!tip && tip.qty > 1 && <Mono size={10} tone="faint">You own {tip.qty}.</Mono>}
        </ScrollView>
      </Overlay>

      {/* The full hand, for when the fan overflows. Same rows, no geometry. */}
      <Overlay
        visible={listOpen}
        title="Your hand"
        subtitle={`${total} CARD${total === 1 ? '' : 'S'} · TAP ONE TO PLAY IT`}
        onClose={() => setListOpen(false)}
      >
        <ScrollView style={{ maxHeight: sheetBodyMax(130) }} contentContainerStyle={{ padding: 12, gap: 8 }}>
          {cards.map((c) => {
            const p = powerupById(c.id);
            return (
              <Pressable
                key={c.id}
                onPress={() => { setListOpen(false); setRaised(c.id); }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: t.bg, borderWidth: StyleSheet.hairlineWidth,
                  borderColor: c.armed ? t.you : t.bd, borderRadius: 8, padding: 10,
                  opacity: !c.usable && !c.armed ? 0.6 : 1,
                }}
              >
                <Text style={{ fontSize: 22 }}>{p?.icon ?? '◈'}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: t.text }}>{p?.name ?? c.id}</Text>
                  {!!c.note && <Mono size={9} tone="warn" style={{ marginTop: 2 }}>{c.note}</Mono>}
                </View>
                {c.qty > 1 && <Mono size={9.5} tone="faint">×{c.qty}</Mono>}
                {c.armed && <Mono size={9} weight="700" tone="you">ARMED</Mono>}
              </Pressable>
            );
          })}
        </ScrollView>
      </Overlay>
    </>
  );
}
