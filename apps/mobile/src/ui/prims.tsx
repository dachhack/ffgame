// Themed primitives. The web app styles inline against CSS custom properties
// (`color: 'var(--dim)'`); RN has no cascade and no custom properties, so these
// wrap the handful of recurring shapes and read the palette from context.
//
// Deliberately small — this is not a component library. Anything used once
// belongs in the screen that uses it.
import { type ReactNode, useRef, useState } from 'react';
import { Text, View, Pressable, ScrollView, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme, MONO, alpha, fs } from '../theme.native';
import { tap } from './feedback';

type Tone = 'text' | 'dim' | 'faint' | 'mid' | 'you' | 'opp' | 'warn';

/** Monospace label — the web app's `className="mono"`, which is most of its
 *  small text. */
export function Mono({ children, size = 10, tone = 'dim', weight, track, style, numberOfLines }: {
  children: ReactNode; size?: number; tone?: Tone; weight?: '400' | '700';
  /** letterSpacing in em, matching the web values (0.06 → 0.06 * size). */
  track?: number;
  /** Clip rather than wrap — a fixed-width label column (a commissioner's own
   *  spot name can be any length) must not push the row it labels. */
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  // fs(): every caller's size rides the global type scale (theme.native).
  const sz = fs(size);
  return (
    <Text numberOfLines={numberOfLines} style={[
      { fontFamily: MONO, fontSize: sz, color: t[tone], lineHeight: sz * 1.45 },
      weight ? { fontWeight: weight } : null,
      track ? { letterSpacing: track * sz } : null,
      style,
    ]}>{children}</Text>
  );
}

/** Display text — the web app's `className="grotesk"`. Until expo-font loads
 *  Space Grotesk this is the system sans at the same weights, which is close
 *  enough to review layout against and wrong enough not to ship as final. */
export function Display({ children, size = 14, tone = 'text', style }: {
  children: ReactNode; size?: number; tone?: Tone; style?: StyleProp<TextStyle>;
}) {
  const t = useTheme();
  return <Text style={[{ fontSize: fs(size), fontWeight: '700', color: t[tone] }, style]}>{children}</Text>;
}

/** The web app's `card` style object: surface fill, hairline border, radius 8. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View style={[{ backgroundColor: t.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: t.bd, borderRadius: 8, padding: 16 }, style]}>
      {children}
    </View>
  );
}

/** Pill button — power-ups, unlocks, extra slots. `on` is the armed state.
 *
 *  The LABEL is the system font, not mono. Mono earns its place on data — a
 *  score, a clock, a count that should line up with the one under it — and on a
 *  control it just reads as a web dashboard. Same for the two buttons below. */
export function Chip({ label, on, disabled, dim, onPress, a11y, small }: {
  label: ReactNode; on?: boolean; disabled?: boolean; dim?: boolean; onPress?: () => void;
  /** Spoken name, for a chip whose label is an icon alone — the fill carries
   *  the state to the eye, and `selected` carries it to the screen reader. */
  a11y?: string;
  /** v0.638.1: a FILTER chip — one of a dozen in a strip above a list, where
   *  the list is the point. Two-thirds the height of a control chip. */
  small?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : () => { tap(); onPress?.(); }}
      // Hit slop rather than bigger padding: the chips wrap into dense rows and
      // growing them would reflow the layout, but a 10pt tap target fails
      // Apple's 44pt guidance outright.
      hitSlop={8}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={a11y}
      accessibilityState={a11y ? { selected: !!on, disabled: !!disabled } : undefined}
      // Ripple is the Android idiom and it is bounded by the pill because
      // `borderRadius` + overflow:hidden clip it; `pressed` covers iOS, which
      // has no ripple and expects the surface to dim instead.
      android_ripple={{ color: alpha(on ? t.onAccent : t.you, 22), foreground: true }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 4,
        overflow: 'hidden',
        backgroundColor: on ? t.you : t.bg,
        borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
        borderRadius: small ? 11 : 14, paddingVertical: small ? 4 : 8, paddingHorizontal: small ? 9 : 11,
        opacity: disabled ? 0.5 : dim ? 0.6 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontSize: small ? fs(10) : fs(11.5), fontWeight: '700', color: on ? t.onAccent : t.text }}>{label}</Text>
    </Pressable>
  );
}

/** A single line of chips that scrolls sideways (v0.638.1, founder: "compact
 *  chips, make them scroll off screen with (more)"). Chips that WRAP cost
 *  rows of the list you are reading; chips that scroll cost a swipe — and a
 *  chip cut off at the edge was the only sign there was more. So the strip
 *  wears a CAP on whichever edge has chips behind it: a › or ‹ on the
 *  surface colour, which also pages the strip when tapped. Measured, not
 *  guessed: the caps appear only while something is actually out of view. */
export function ChipStrip({ children, style, gap = 6, bg }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number;
  /** The colour behind the strip, for the caps (the card's surface by default). */
  bg?: string;
}) {
  const t = useTheme();
  const ref = useRef<ScrollView>(null);
  const [frame, setFrame] = useState(0);
  const [content, setContent] = useState(0);
  const [x, setX] = useState(0);
  const moreRight = frame > 0 && content - x - frame > 4;
  const moreLeft = x > 4;
  const page = (dir: 1 | -1) => { tap(); ref.current?.scrollTo({ x: Math.max(0, x + dir * frame * 0.7), animated: true }); };
  const cap = (side: 'left' | 'right') => (
    <Pressable onPress={() => page(side === 'right' ? 1 : -1)} hitSlop={6}
      accessibilityRole="button" accessibilityLabel={side === 'right' ? 'more filters' : 'back'}
      style={{ position: 'absolute', top: 0, bottom: 0, [side]: 0, width: 26, justifyContent: 'center',
        alignItems: side === 'right' ? 'flex-end' : 'flex-start', backgroundColor: bg ?? t.surface, opacity: 0.96 }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(13), fontWeight: '700', color: t.dim, paddingHorizontal: 4 }}>{side === 'right' ? '›' : '‹'}</Text>
    </Pressable>
  );
  return (
    <View style={[{ flexGrow: 0, flexShrink: 0 }, style]} onLayout={(e) => setFrame(e.nativeEvent.layout.width)}>
      <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false}
        onContentSizeChange={(w) => setContent(w)}
        onScroll={(e) => setX(e.nativeEvent.contentOffset.x)} scrollEventThrottle={48}
        contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap, paddingRight: 4 }}>
        {children}
      </ScrollView>
      {moreRight && cap('right')}
      {moreLeft && cap('left')}
    </View>
  );
}

/** Full-width primary action (SEAL LINEUP). */
export function PrimaryButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : () => { tap(); onPress(); }}
      android_ripple={{ color: alpha(t.onAccent, 24), foreground: true }}
      style={({ pressed }) => ({
        backgroundColor: t.you, borderRadius: 10, paddingVertical: 15,
        alignItems: 'center', overflow: 'hidden',
        opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      <Text style={{ fontSize: fs(15), fontWeight: '700', letterSpacing: 0.3, color: t.onAccent }}>{label}</Text>
    </Pressable>
  );
}

/** Low-emphasis text action (← back, ↻ retry). */
export function LinkButton({ label, tone = 'dim', onPress }: { label: string; tone?: Tone; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tap(); onPress(); }} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontSize: fs(13), fontWeight: '600', color: t[tone] }}>{label}</Text>
    </Pressable>
  );
}

/** Position pill (QB/RB/WR…) in that position's themed colors. */
export function PosPill({ pos, size = 9 }: { pos: string; size?: number }) {
  const t = useTheme();
  const c = t.pos[pos as keyof typeof t.pos] ?? { bg: t.sh, fg: t.dim, bd: t.bd };
  return (
    <View style={{ backgroundColor: c.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.bd, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: fs(size), fontWeight: '700', color: c.fg }}>{pos}</Text>
    </View>
  );
}

/** Tinted callout box — the web's `color-mix(… 12%, transparent)` fill with a
 *  35%-alpha border, which is its standard "notice" treatment. */
export function Notice({ children, tone = 'you' }: { children: ReactNode; tone?: Tone }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: alpha(t[tone], 12), borderWidth: StyleSheet.hairlineWidth, borderColor: alpha(t[tone], 35), borderRadius: 8, padding: 9 }}>
      {children}
    </View>
  );
}
