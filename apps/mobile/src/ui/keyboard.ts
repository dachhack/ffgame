// THE KEYBOARD OWNS THE BOTTOM (v0.356.12, corrected in .13).
//
// Founder: "text box disappears behind keypad in chat in the app."
//
// WHY IT BROKE. The manifest asks for `adjustResize`, which on a classic
// Android window shrinks the app above the IME and lets a bottom-pinned
// composer ride up for free. This app is EDGE-TO-EDGE (`edgeToEdgeEnabled=true`
// in gradle.properties — Expo has forced it on since SDK 54, and Android 15
// forces it on any targetSdk 35 app anyway). An edge-to-edge window does not
// resize: it keeps its full height and draws behind the keyboard. So the
// composer stayed exactly where it was — at the bottom of the screen, under
// the keys — and `adjustResize` did nothing at all.
//
// WHY THE FIRST FIX STILL LANDED SHORT. Spending the reported keyboard height
// as padding moved the composer almost all the way and left it a stubborn
// ~38dp low. The reason is one line in RN's own ReactRootView:
//
//     int height = imeInsets.bottom - barInsets.bottom;
//
// `keyboardDidShow` reports the space the IME takes BEYOND the navigation bar,
// not the space it covers. The keyboard is drawn over the nav bar too, so the
// screen it actually hides is `height + barInsets.bottom`. This hook adds that
// back, which is why it returns an INSET rather than a height — what a caller
// wants is "how much of the bottom edge is behind the keyboard", and that is
// the number that was wrong.
//
// The same routine makes `endCoordinates.screenY` useless here: under
// adjustResize it is set to `mVisibleViewArea.bottom`, which an edge-to-edge
// window never shrinks for the IME. That is also why KeyboardAvoidingView
// cannot be the answer on this build — its Android path measures against
// exactly that screenY.
//
// iOS is not affected: it reports the keyboard's true height from the screen
// bottom, home indicator included, so the correction is Android-only.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** How much of the screen's bottom edge the keyboard is covering right now, in
 *  dp — 0 when it is down. Already counts the navigation bar, so never add a
 *  safe-area inset on top of it. On iOS the `will`-events let a composer
 *  travel with the keyboard rather than after it. */
export function useKeyboardInset(): number {
  const insets = useSafeAreaInsets();
  const [h, setH] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setH(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  if (h <= 0) return 0;
  return Platform.OS === 'android' ? h + insets.bottom : h;
}
