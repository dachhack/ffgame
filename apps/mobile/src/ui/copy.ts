// THE CLIPBOARD (v0.462.0) — one place, so a copy button behaves the same
// wherever the app grows one.
//
// The app went without a clipboard for a long time on purpose: LeagueInfo's
// invite link is `selectable` with a note saying a copy button "would mean
// pulling in a native module for a button the platform ships", and for a LINK
// that was right — the OS share sheet copies, and ⇪ SEND was already there.
//
// A league id is not a link. It is 36 characters of hex that nothing shares,
// nothing opens, and nobody should retype off a phone screen — founder:
// "Where in the app and web UI can I find and easy copy the league Id?" So
// expo-clipboard is now a dependency, and since it is here, the invite link
// gets the button too.
import * as Clipboard from 'expo-clipboard';
import { commit, warn } from './feedback';

/** Put `v` on the clipboard. Resolves true when it landed.
 *
 *  Never throws: a clipboard can be refused (a managed device, a simulator
 *  with no pasteboard), and a settings row is not worth an unhandled rejection
 *  — the caller shows "couldn't copy" and the value stays on screen to be
 *  selected by hand. The haptic doubles as the confirmation on a phone, where
 *  a tap with no feedback reads as a dead button. */
export async function copyText(v: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(v);
    commit();
    return true;
  } catch {
    warn();
    return false;
  }
}
