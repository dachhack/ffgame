// What a slot becomes once its window kicks off.
//
// Before kickoff a slot is two big portrait cards — that IS the game's premise,
// two sealed picks facing each other. Once the ball is live the interesting
// thing stops being the card and starts being what the player is doing, so the
// web swaps to a compact duel row: a MINI card carrying identity, and all the
// changing text laid beside it on the felt — game clock, metric, running score,
// coin, statline. This is that row (the web's LiveCard + MiniCard).
//
// WHY THE SWAP MATTERS AND ISN'T JUST DENSITY: a portrait card has nowhere to
// put a statline that changes every play, and a window with three duels of them
// is taller than a phone. The mini card keeps the object — same cream stock,
// same dot texture, same position suit — while handing the vertical space to the
// numbers that are actually moving.
//
// The LIQUID BANK FILL is the piece worth not losing: the card fills from the
// bottom as the score climbs (bank × 3.2%, capped at 92 so the name never
// drowns). It is the only place on the board where you can read a slot's state
// without reading a number.
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { headshot, teamLogo } from '@drip/core/data/media';
import type { Pos } from '@drip/core/theme';
import { useTheme, MONO, alpha } from '../theme.native';
import { useWobble, HotGlow } from './animations';
import { cardBackArt } from './cards';

const STOCK = '#F4EDDA';
const STOCK_TILE = require('../../assets/card-stock.png');
const INK = '#2A2312';
const INK_DIM = '#6E6650';
const CARD_W = 78;
// Floating: the web's `.ct-float` — narrower, and overhanging its panel top and
// bottom so the card reads as dealt ONTO the strip rather than boxed inside it.
// The 12px of negative margin is what buys the middle its width back.
const FLOAT_W = 72;
const FLOAT_OVERHANG = 12;

// Each side sits in its own panel on the felt, as on the web — warm stock-ish
// brown rather than loose on the green, so the two halves of a duel read as two
// objects instead of one run-on row.
const PANEL = {
  // TOP-aligned, not centred. The two panels in a duel are independent heights
  // — one metric name wraps to two lines, the other doesn't — and centring made
  // each card float to the middle of its own panel, so the pair sat at
  // different heights whenever the names differed in length.
  flex: 1, gap: 6, alignItems: 'flex-start' as const,
  backgroundColor: '#241E15', borderWidth: StyleSheet.hairlineWidth, borderColor: '#4A3F2A',
  borderRadius: 8, paddingHorizontal: 4, paddingVertical: 6,
  // The floating card overhangs; without this Android clips it at the panel edge.
  overflow: 'visible' as const,
};

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();

/** The mini physical card: identity, the liquid bank fill, and the hot/nuked
 *  states. Same stock and texture as the full card — it should read as the same
 *  object seen smaller, not as a different component. */
export function MiniCard({ side, slug, name, pos, team, bank, hot = false, nuked = false, idx = 0, float = false }: {
  side: 'you' | 'their';
  slug: string; name: string; pos: string; team?: string | null;
  bank?: number | null; hot?: boolean; nuked?: boolean; idx?: number;
  /** Overhang the container, as the web's `.ct-float` does on a score strip. */
  float?: boolean;
}) {
  const t = useTheme();
  const suit = t.pos[(pos as Pos)] ?? t.pos.DEF;
  const photo = headshot(slug);
  const logo = teamLogo(team);
  // The web animates `.ct-lcard` with ct-wob just like the full card — a mini
  // card sitting still next to a breathing one reads as a different kind of
  // object. Nuked cards stop moving, as on the web (`.ct-nuked` kills it).
  const wob = useWobble(idx);
  // The web's exact curve: 3.2% of the bank, capped at 92%.
  const fillPct = bank != null ? Math.max(0, Math.min(92, bank * 3.2)) : 0;

  return (
    <View style={float
      ? { width: FLOAT_W, marginTop: -FLOAT_OVERHANG, marginBottom: -FLOAT_OVERHANG, zIndex: 2 }
      : { width: CARD_W }}>
      <Animated.View
        style={{
          borderRadius: 8, borderWidth: 2, borderColor: '#000', overflow: 'hidden',
          backgroundColor: STOCK, opacity: nuked ? 0.72 : 1,
          ...(nuked ? {} : { transform: wob.transform }),
        }}
      >
        <View style={{ position: 'relative' }}>
          <View style={StyleSheet.absoluteFill}>
            <Image source={STOCK_TILE} resizeMode="repeat" style={{ width: '100%', height: '100%' }} />
          </View>
          {/* Liquid bank fill — anchored to the bottom edge, rising with score. */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0, height: `${fillPct}%`,
              backgroundColor: alpha(side === 'you' ? t.you : t.opp, 30),
              borderTopWidth: fillPct > 0 ? 1 : 0,
              borderTopColor: alpha(side === 'you' ? t.you : t.opp, 70),
            }}
          />

          <View style={{ padding: 5, paddingBottom: 6, gap: 3 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 3 }}>
              <View style={{ borderWidth: 1, borderColor: suit.bd, backgroundColor: suit.bg, borderRadius: 3, paddingHorizontal: 3.5, paddingVertical: 1.5 }}>
                <Text style={{ fontFamily: MONO, fontSize: 6.5, fontWeight: '700', color: suit.fg }}>{pos === 'DEF' ? 'DST' : pos}</Text>
              </View>
              {!!team && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2.5 }}>
                  {!!logo && <Image source={{ uri: logo }} style={{ width: 9, height: 9 }} resizeMode="contain" />}
                  <Text style={{ fontFamily: MONO, fontSize: 6.5, fontWeight: '700', color: INK_DIM }}>{team.toUpperCase()}</Text>
                </View>
              )}
            </View>

            <View style={{ height: float ? 46 : 50, borderRadius: 5, borderWidth: 1.5, borderColor: suit.fg, overflow: 'hidden', backgroundColor: '#EDE4CB', alignItems: 'center', justifyContent: 'center' }}>
              {photo
                ? <Image source={{ uri: photo }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                : logo
                  ? <Image source={{ uri: logo }} style={{ width: '70%', height: '70%' }} resizeMode="contain" />
                  : <Text style={{ fontFamily: MONO, fontSize: 13, color: suit.fg }}>{initials(name)}</Text>}
            </View>

            <Text numberOfLines={2} style={{ fontSize: 8.2, fontWeight: '800', letterSpacing: 0.2, lineHeight: 9.5, textAlign: 'center', color: INK, textTransform: 'uppercase' }}>
              {name}
            </Text>
          </View>

          {nuked && (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(30,8,10,0.62)' }}>
              <Text style={{ fontSize: 13 }}>☠</Text>
              <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '800', color: '#FF4F62', letterSpacing: 1 }}>NUKED</Text>
              {bank != null && <Text style={{ fontFamily: MONO, fontSize: 7, color: '#E7DCC2' }}>bank {fmt(bank)}</Text>}
            </View>
          )}
          {hot && !nuked && (
            <View pointerEvents="none" style={{ position: 'absolute', top: 3, right: 3, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 3, paddingHorizontal: 5, paddingVertical: 2 }}>
              <Text style={{ fontSize: 7, fontWeight: '700', color: '#E9B959' }}>🔥 HOT</Text>
            </View>
          )}
        </View>
      </Animated.View>
      {hot && !nuked && <HotGlow color={side === 'you' ? t.you : t.opp} />}
    </View>
  );
}

/** One side of a live duel: the mini card plus everything that changes. */
export function LiveCard({ side, slug, name, pos, team, sealed = false, unopposed = false, gameLabel, metricName, stat, bank, hot = false, nuked = false, coin, idx = 0, onPress }: {
  side: 'you' | 'their';
  slug?: string; name?: string; pos?: string; team?: string | null;
  /** Face-down: the deck's back at the mini footprint, no identity leaked. */
  sealed?: boolean;
  /** The window kicked and this side genuinely has nobody here — a fact, not a
   *  secret (0137-era honesty fix). Renders an explicit empty seat instead of
   *  a card back that promises a flip that will never come. */
  unopposed?: boolean;
  gameLabel?: string | null;
  metricName?: string | null;
  stat?: string | null;
  /** Running points; null hides the score column (pre-kick). */
  bank?: number | null;
  hot?: boolean; nuked?: boolean;
  coin?: number | null;
  idx?: number;
  onPress?: () => void;
}) {
  const t = useTheme();
  const accent = side === 'you' ? t.you : t.opp;
  // The opponent's row mirrors, so the two sides read outward from the middle
  // rather than both marching left — the same reversal the web does with
  // `.ct-live.ct-opp { flex-direction: row-reverse }`.
  const mirror = side === 'their';

  if (unopposed) {
    return (
      <View style={[PANEL, { flexDirection: mirror ? 'row-reverse' : 'row' }]}>
        <View style={{ width: FLOAT_W, height: 106, marginTop: -FLOAT_OVERHANG, marginBottom: -FLOAT_OVERHANG, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}>
          <Text style={{ fontSize: 17, color: t.faint }}>—</Text>
        </View>
        <View style={{ flex: 1, alignItems: mirror ? 'flex-end' : 'flex-start', gap: 3 }}>
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: '800', letterSpacing: 1, color: t.dim }}>NO PLAYER</Text>
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 8, color: t.faint }}>unopposed — the facing player subs as a backup</Text>
        </View>
      </View>
    );
  }
  if (sealed) {
    return (
      <View style={[PANEL, { flexDirection: mirror ? 'row-reverse' : 'row' }]}>
        <View style={{ width: FLOAT_W, height: 106, marginTop: -FLOAT_OVERHANG, marginBottom: -FLOAT_OVERHANG, zIndex: 2, borderRadius: 8, borderWidth: 2, borderColor: '#000', overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
          <Image source={cardBackArt()} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
          <Text style={{ fontSize: 17, color: '#E9B959' }}>◈</Text>
        </View>
        <View style={{ flex: 1, alignItems: mirror ? 'flex-end' : 'flex-start', gap: 3 }}>
          <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 999, paddingHorizontal: 6, paddingVertical: 2 }}>
            <Text style={{ fontFamily: MONO, fontSize: 7.5, fontWeight: '800', letterSpacing: 1, color: t.dim }}>🔒 SEALED PICK</Text>
          </View>
          <Text style={{ fontFamily: MONO, fontSize: 8, color: t.faint }}>flips face-up at kickoff</Text>
        </View>
      </View>
    );
  }

  return (
    <Pressable onPress={onPress} style={[PANEL, { flexDirection: mirror ? 'row-reverse' : 'row' }]}>
      <MiniCard float side={side} slug={slug ?? ''} name={name ?? ''} pos={pos ?? 'DEF'} team={team} bank={bank} hot={hot} nuked={nuked} idx={idx} />

      <View style={{ flex: 1, minWidth: 0, alignItems: mirror ? 'flex-end' : 'flex-start', gap: 3 }}>
        {!!gameLabel && (
          <Text numberOfLines={1} style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: t.dimstrong }}>{gameLabel}</Text>
        )}
        {/* The metric chip carries the SIDE's colour, not one shared gold — on
            the web yours reads teal and theirs red, which is how you tell the
            two halves apart at a glance when both are mid-sentence. Two lines
            rather than one truncated: "Receiving Yards" ellipsed to
            "Receiving …" loses the only word that distinguishes it from
            "Receiving TDs". */}
        {!!metricName && (
          <View style={{ backgroundColor: alpha(accent, 14), borderWidth: StyleSheet.hairlineWidth, borderColor: alpha(accent, 55), borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3, maxWidth: '100%' }}>
            <Text numberOfLines={2} style={{ fontSize: 11, fontWeight: '800', color: accent, textAlign: mirror ? 'right' : 'left' }}>{metricName}</Text>
          </View>
        )}
        {/* Score sits under the chip rather than in its own column: the web
            wraps it exactly this way below 560px, and a phone is always below
            560px. */}
        {bank != null && (
          <View style={{ flexDirection: mirror ? 'row-reverse' : 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ fontSize: 26, fontWeight: '800', lineHeight: 28, color: nuked ? '#FF4F62' : accent, textDecorationLine: nuked ? 'line-through' : 'none' }}>
              {fmt(bank)}
            </Text>
            <Text style={{ fontFamily: MONO, fontSize: 7, color: t.faint, letterSpacing: 1 }}>PTS</Text>
            {coin != null && coin !== 0 && (
              <Text style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: t.warn }}>🪙 {coin > 0 ? '+' : ''}{coin}</Text>
            )}
          </View>
        )}
        {!!stat && (
          <Text numberOfLines={2} style={{ fontSize: 8.6, lineHeight: 12, color: t.dimstrong, textAlign: mirror ? 'right' : 'left' }}>{stat}</Text>
        )}
      </View>
    </Pressable>
  );
}
