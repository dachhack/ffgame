// Themed primitives. The web app styles inline against CSS custom properties
// (`color: 'var(--dim)'`); RN has no cascade and no custom properties, so these
// wrap the handful of recurring shapes and read the palette from context.
//
// Deliberately small — this is not a component library. Anything used once
// belongs in the screen that uses it.
import { type ReactNode } from 'react';
import { Text, View, Pressable, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme, MONO, alpha } from '../theme.native';
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
  return (
    <Text numberOfLines={numberOfLines} style={[
      { fontFamily: MONO, fontSize: size, color: t[tone], lineHeight: size * 1.45 },
      weight ? { fontWeight: weight } : null,
      track ? { letterSpacing: track * size } : null,
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
  return <Text style={[{ fontSize: size, fontWeight: '700', color: t[tone] }, style]}>{children}</Text>;
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
export function Chip({ label, on, disabled, dim, onPress }: {
  label: ReactNode; on?: boolean; disabled?: boolean; dim?: boolean; onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={disabled ? undefined : () => { tap(); onPress?.(); }}
      // Hit slop rather than bigger padding: the chips wrap into dense rows and
      // growing them would reflow the layout, but a 10pt tap target fails
      // Apple's 44pt guidance outright.
      hitSlop={8}
      // Ripple is the Android idiom and it is bounded by the pill because
      // `borderRadius` + overflow:hidden clip it; `pressed` covers iOS, which
      // has no ripple and expects the surface to dim instead.
      android_ripple={{ color: alpha(on ? t.onAccent : t.you, 22), foreground: true }}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 4,
        overflow: 'hidden',
        backgroundColor: on ? t.you : t.bg,
        borderWidth: StyleSheet.hairlineWidth, borderColor: on ? t.you : t.bd,
        borderRadius: 14, paddingVertical: 8, paddingHorizontal: 11,
        opacity: disabled ? 0.5 : dim ? 0.6 : pressed ? 0.75 : 1,
      })}
    >
      <Text style={{ fontSize: 11.5, fontWeight: '700', color: on ? t.onAccent : t.text }}>{label}</Text>
    </Pressable>
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
      <Text style={{ fontSize: 15, fontWeight: '700', letterSpacing: 0.3, color: t.onAccent }}>{label}</Text>
    </Pressable>
  );
}

/** Low-emphasis text action (← back, ↻ retry). */
export function LinkButton({ label, tone = 'dim', onPress }: { label: string; tone?: Tone; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => { tap(); onPress(); }} hitSlop={10} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: t[tone] }}>{label}</Text>
    </Pressable>
  );
}

/** Position pill (QB/RB/WR…) in that position's themed colors. */
export function PosPill({ pos, size = 9 }: { pos: string; size?: number }) {
  const t = useTheme();
  const c = t.pos[pos as keyof typeof t.pos] ?? { bg: t.sh, fg: t.dim, bd: t.bd };
  return (
    <View style={{ backgroundColor: c.bg, borderWidth: StyleSheet.hairlineWidth, borderColor: c.bd, borderRadius: 3, paddingHorizontal: 5, paddingVertical: 1 }}>
      <Text style={{ fontFamily: MONO, fontSize: size, fontWeight: '700', color: c.fg }}>{pos}</Text>
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
