// THE KEYBOARD OWNS THE BOTTOM (v0.356.12).
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
// WHY NOT KeyboardAvoidingView. RN's KAV is written for the resize model: on
// Android it is normally handed `behavior={undefined}` precisely because the
// window was expected to do the work (SignIn.tsx does this). Under
// edge-to-edge there is no resize to lean on, and a behavior that assumes one
// double-counts the moment the window ever does resize. Reading the IME's own
// height and spending it as padding is the one answer that is right in both
// worlds: on iOS the window never resizes either, so the same number applies.
import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

/** How much of the screen's bottom edge the keyboard is covering right now, in
 *  dp — 0 when it is down. On Android this spans from the true screen bottom,
 *  so it already covers the gesture bar: never add a safe-area inset on top of
 *  it. iOS reports the same measure, and `will`-events there let the composer
 *  travel with the keyboard rather than after it. */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === 'ios';
    const show = Keyboard.addListener(ios ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setH(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(ios ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h;
}
