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

export function BrandLoading({ label }: { label?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: SPLASH_BG, alignItems: 'center', justifyContent: 'center', gap: 26 }}>
      <Image
        source={require('../../assets/splash.png')}
        style={{ width: 260, height: 260 }}
        resizeMode="contain"
      />
      <View style={{ alignItems: 'center', gap: 12 }}>
        <ActivityIndicator color={t.you} />
        {!!label && <Text style={{ fontFamily: MONO, fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{label}</Text>}
      </View>
    </View>
  );
}
