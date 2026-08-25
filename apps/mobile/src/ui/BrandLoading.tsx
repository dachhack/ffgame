// The branded wait — what the launch shows once the native splash lets go.
//
// It exists because the native splash CANNOT show the lockup. Android 12+ masks
// `windowSplashScreenAnimatedIcon` to a circle, so anything tall loses its ends:
// the first build put the mark and the wordmark in that drawable and the
// wordmark's bottom was sliced off. The native splash is the MARK alone now,
// sized to survive the mask, and the full lockup lives here — in a view we
// control, where nothing is masked.
//
// Which also makes the launch read as one thing instead of two: the same art on
// the same ground, growing from the circle into the full lockup, rather than a
// brand plate followed by a bare spinner on a grey page.
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { useTheme, MONO } from '../theme.native';

/** The plate the splash is drawn on — sampled from the artwork's own ground, so
 *  the handover from the native splash is invisible. Deliberately NOT a theme
 *  token: the native splash colour is baked into the APK at build time and
 *  cannot follow a theme, so following one here would introduce the seam this
 *  screen exists to avoid. */
export const SPLASH_BG = '#163138';

export function BrandLoading({ label, themed = false }: {
  label?: string;
  /** IN-APP waits (v0.356.4, founder: "can we adapt that background for the
   *  app theme you are using?") follow the theme — returning to the leagues
   *  list mid-session has no native splash to match, so the fixed plate read
   *  as a jarring flash of dark blue on any other theme. The LAUNCH keeps
   *  the fixed plate (default): the native splash colour is baked into the
   *  APK and cannot follow a theme, and matching it is this screen's job.
   *  The lockup art is light-on-dark, so on a LIGHT theme the themed wait
   *  keeps a rounded tile of the splash ground behind the mark. */
  themed?: boolean;
}) {
  const t = useTheme();
  // Light theme ≈ a bright page ground. Read off the theme's own bg so this
  // file needs no theme NAME plumbed in.
  const hex = /^#([0-9a-f]{6})$/i.exec(t.bg)?.[1];
  const lightTheme = !!hex && (parseInt(hex.slice(0, 2), 16) + parseInt(hex.slice(2, 4), 16) + parseInt(hex.slice(4, 6), 16)) / 3 > 140;
  const tile = themed && lightTheme;
  return (
    <View style={{ flex: 1, backgroundColor: themed ? t.bg : SPLASH_BG, alignItems: 'center', justifyContent: 'center', gap: 26 }}>
      <View style={tile ? { backgroundColor: SPLASH_BG, borderRadius: 44, padding: 14 } : undefined}>
        <Image
          source={require('../../assets/splash.png')}
          style={{ width: tile ? 232 : 260, height: tile ? 232 : 260 }}
          resizeMode="contain"
        />
      </View>
      <View style={{ alignItems: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        {!!label && <Text style={{ fontFamily: MONO, fontSize: 11, color: themed ? t.dim : 'rgba(255,255,255,0.55)' }}>{label}</Text>}
      </View>
    </View>
  );
}
