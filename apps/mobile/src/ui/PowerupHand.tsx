// Your hand — owned power-ups fanned along the bottom of the board.
//
// Ported from the web's PowerupHand (cardTable.tsx). The hand IS your
// inventory: you buy cards in the shop, they land here, and arming one spends
// the card rather than coin. That ordering matters — see the note on arming in
// LivePicks — because coin is charged once, at purchase.
//
// The web fans at most 6 and hides the rest behind an overflow tile. A phone is
// narrower still, so this scrolls horizontally instead: same idea, no card ever
// becomes unreachable, and nothing overlaps into unhittable slivers.
import { useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useEffect, useRef } from 'react';
import { powerupById } from '@drip/core/data/powerups';
import { useTheme, MONO } from '../theme.native';
import { Mono } from './prims';
import { Overlay } from './Overlay';

export interface HandCard {
  id: string;
  qty: number;
  /** False when this card can't be played right now (wrong phase, capacity). */
  usable: boolean;
  /** Why not, or when it can be — shown on the tip. */
  note?: string;
  armed?: boolean;
}

export function PowerupHand({ cards, busyId, onArm, onDisarm }: {
  cards: HandCard[];
  busyId?: string | null;
  onArm: (id: string) => void;
  onDisarm: (id: string) => void;
}) {
  const t = useTheme();
  const [tip, setTip] = useState<HandCard | null>(null);
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(rise, { toValue: cards.length ? 1 : 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [cards.length, rise]);

  if (!cards.length) return null;
  const pu = tip ? powerupById(tip.id) : null;

  return (
    <>
      <Animated.View
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(11,31,26,0.96)',
          borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.bdh,
          paddingTop: 8, paddingBottom: 10,
          opacity: rise,
          transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [90, 0] }) }],
        }}
      >
        <Mono size={8.5} tone="faint" track={0.12} style={{ paddingHorizontal: 14, marginBottom: 6 }}>
          YOUR HAND · {cards.reduce((n, c) => n + c.qty, 0)} CARD{cards.reduce((n, c) => n + c.qty, 0) === 1 ? '' : 'S'}
        </Mono>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 14 }}>
          {cards.map((c) => {
            const p = powerupById(c.id);
            const dim = !c.usable && !c.armed;
            return (
              <Pressable
                key={c.id}
                onPress={() => setTip(c)}
                style={{
                  width: 84, borderRadius: 8, padding: 8, gap: 4, alignItems: 'center',
                  backgroundColor: c.armed ? t.you : '#241E15',
                  borderWidth: c.armed ? 0 : StyleSheet.hairlineWidth,
                  borderColor: '#4A3F2A',
                  opacity: busyId === c.id ? 0.5 : dim ? 0.45 : 1,
                }}
              >
                <Text style={{ fontSize: 20 }}>{p?.icon ?? '◈'}</Text>
                <Text numberOfLines={2} style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', textAlign: 'center', color: c.armed ? t.onAccent : '#E5D9BC' }}>
                  {(p?.name ?? c.id).toUpperCase()}
                </Text>
                {c.qty > 1 && <Mono size={8} tone="faint">×{c.qty}</Mono>}
                {c.armed && <Mono size={8} weight="700" style={{ color: t.onAccent }}>ARMED</Mono>}
              </Pressable>
            );
          })}
        </ScrollView>
      </Animated.View>

      <Overlay
        visible={!!tip}
        title={pu?.name ?? ''}
        subtitle={pu ? (pu.kind === 'metric' ? 'METRIC · 1 WK' : pu.timing === 'pre' ? 'PRE-MATCH' : 'REAL-TIME') : undefined}
        titleLeft={<Text style={{ fontSize: 28 }}>{pu?.icon ?? '◈'}</Text>}
        onClose={() => setTip(null)}
        footer={tip ? (
          tip.armed ? (
            <Pressable
              onPress={() => { onDisarm(tip.id); setTip(null); }}
              style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, paddingVertical: 13, alignItems: 'center' }}
            >
              <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1, color: t.dim }}>DISARM · RETURN TO HAND</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => { if (tip.usable) { onArm(tip.id); setTip(null); } }}
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
          <Text style={{ fontSize: 13, color: t.text, lineHeight: 20 }}>{pu?.blurb}</Text>
          {!!tip?.note && <Mono size={10} tone="warn">{tip.note}</Mono>}
          {!!tip && tip.qty > 1 && <Mono size={10} tone="faint">You own {tip.qty}.</Mono>}
        </ScrollView>
      </Overlay>
    </>
  );
}
