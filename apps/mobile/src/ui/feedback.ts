// Touch feedback — the part of "feels native" that isn't visual.
//
// A web page acknowledges a tap by changing, eventually. A native app answers
// the finger immediately: the surface ripples, and the phone gives a small
// knock for anything that COMMITTED something. Without it every button in this
// app felt like a link, because that is exactly what a link does — nothing,
// until the page catches up.
//
// Three intensities, named for what happened rather than how hard they buzz, so
// call sites read as intent and the mapping can be tuned in one place:
//
//   tap()     you pressed a control        — light
//   commit()  something CHANGED because of it — medium (sealed, armed, bought)
//   warn()    the app refused              — a notification buzz, not an impact
//
// Every call is fire-and-forget and swallows its own failure. Haptics are a
// courtesy: a device without a motor, or a user who turned them off at the OS
// level, must not turn a tap into an unhandled rejection.
import * as Haptics from 'expo-haptics';

const quiet = (p: Promise<unknown>) => { void p.catch(() => {}); };

/** A control was pressed. */
export const tap = (): void =>
  quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));

/** The press changed something — a lineup sealed, a card armed, coin spent. */
export const commit = (): void =>
  quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));

/** The app said no. */
export const warn = (): void =>
  quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
